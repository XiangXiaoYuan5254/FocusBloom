// 专注计时、设置和记录的唯一数据源，对应 macOS 版的 AppStore.swift。
// 运行在主进程：主窗口、悬浮窗和托盘菜单都只是它的视图，最小化或关到托盘后计时照常进行。
const { EventEmitter } = require('events');
const core = require('../shared/core');
const { newId } = require('./persistence');

function randomInt(lower, upper) {
  return lower + Math.floor(Math.random() * (upper - lower + 1));
}

class AppStore extends EventEmitter {
  /**
   * @param {object} options
   * @param {{load: Function, save: Function}} options.persistence
   * @param {(playerId: string) => Promise<string>} options.playMusic
   * @param {(sessions: object[]) => Promise<boolean>} options.exportCSV
   */
  constructor({ persistence, playMusic, exportCSV }) {
    super();
    this.persistence = persistence;
    this.playMusicImpl = playMusic;
    this.exportCSVImpl = exportCSV;

    const data = persistence.load();
    this.settings = data.settings;
    this.sessions = data.sessions;

    this.runtime = {
      phase: 'idle',
      remainingSeconds: 0,
      breakRemainingSeconds: 0,
      focusedElapsedSeconds: 0,
      plannedSeconds: 0,
      currentEvents: [],
      currentStartEnergy: 4,
      draftTaskName: null,
      showCompletionSheet: false,
      musicMessage: null,
      toast: null,
      isAmbientPlaying: false,
      nextReminderSeconds: null
    };

    this.focusEndDate = null;
    this.microBreakEndDate = null;
    this.nextReminderDate = null;
    this.pausedRemaining = 0;
    this.draft = null;
    this.pendingCompleted = false;
    this.toastSerial = 0;
    this.toastTimer = null;
    this.saveTimer = null;
    this.lastRuntimeJSON = '';

    this.timer = setInterval(() => this.tick(), 250);
  }

  dispose() {
    clearInterval(this.timer);
    this.flush();
  }

  // ---- 对外状态 ----

  get isSessionActive() {
    return core.isSessionActive(this.runtime.phase);
  }

  get selectedTaskName() {
    const selected = (this.settings.selectedTaskName || '').trim();
    return selected && this.settings.taskNames.includes(selected) ? selected : null;
  }

  get currentTaskDisplayName() {
    return (this.draft && this.draft.taskName) || this.selectedTaskName || core.UNCATEGORIZED;
  }

  snapshot() {
    return { settings: this.settings, sessions: this.sessions, runtime: this.runtime };
  }

  // ---- 设置 ----

  updateSettings(patch) {
    if (!patch || typeof patch !== 'object') return;
    this.setSettings({ ...this.settings, ...patch });
  }

  setSettings(next) {
    const normalized = core.normalizeSettings(next);
    if (core.settingsEqual(normalized, this.settings)) {
      // 规范化可能把界面上的值改了回去，照样广播一次，让界面对齐。
      this.emit('settings', this.settings);
      return;
    }
    this.settings = normalized;
    this.emit('settings', this.settings);
    this.scheduleSave();
  }

  toggleAppearance() {
    this.updateSettings({ appearanceMode: this.settings.appearanceMode === 'dark' ? 'light' : 'dark' });
  }

  // ---- 专注轮次 ----

  startSession(minutes) {
    if (this.isSessionActive) return;
    const duration = core.clamp(Math.round(Number(minutes) || this.settings.selectedDurationMinutes), 1, 1440);
    this.updateSettings({ selectedDurationMinutes: duration });

    const taskName = this.selectedTaskName;
    this.draft = {
      startedAt: Date.now(),
      plannedMinutes: duration,
      taskName,
      startEnergy: this.runtime.currentStartEnergy
    };
    const plannedSeconds = duration * 60;
    Object.assign(this.runtime, {
      currentEvents: [],
      plannedSeconds,
      remainingSeconds: plannedSeconds,
      focusedElapsedSeconds: 0,
      draftTaskName: taskName,
      phase: 'focusing',
      musicMessage: null
    });
    this.pausedRemaining = plannedSeconds;
    this.focusEndDate = Date.now() + plannedSeconds * 1000;
    this.microBreakEndDate = null;
    this.pendingCompleted = false;
    this.scheduleNextReminder();
    if (this.settings.ambientFollowsFocus) this.playAmbient();
    this.toast('开始这一轮。先只做好眼前的一小段。');
    this.emitRuntime();
  }

  togglePause() {
    const runtime = this.runtime;
    if (runtime.phase === 'focusing') {
      this.pausedRemaining = Math.max(0, this.focusEndDate ? (this.focusEndDate - Date.now()) / 1000 : runtime.remainingSeconds);
      this.focusEndDate = null;
      this.nextReminderDate = null;
      this.appendEvent('pause');
      runtime.phase = 'paused';
      if (this.settings.ambientFollowsFocus) this.stopAmbient();
    } else if (runtime.phase === 'paused') {
      this.focusEndDate = Date.now() + this.pausedRemaining * 1000;
      this.appendEvent('resume');
      runtime.phase = 'focusing';
      this.scheduleNextReminder();
      if (this.settings.ambientFollowsFocus) this.playAmbient();
    }
    this.emitRuntime();
  }

  stopSessionEarly() {
    if (!this.isSessionActive) return;
    this.finishSession(false);
  }

  abandonSession() {
    if (!this.isSessionActive && this.runtime.phase !== 'completed' && !this.draft) return;
    this.focusEndDate = null;
    this.microBreakEndDate = null;
    this.nextReminderDate = null;
    this.pausedRemaining = 0;
    this.draft = null;
    this.pendingCompleted = false;
    Object.assign(this.runtime, {
      phase: 'idle',
      plannedSeconds: 0,
      remainingSeconds: 0,
      breakRemainingSeconds: 0,
      focusedElapsedSeconds: 0,
      currentEvents: [],
      draftTaskName: null,
      showCompletionSheet: false,
      musicMessage: null
    });
    if (this.settings.ambientFollowsFocus) this.stopAmbient();
    this.toast('这轮已放弃，不会计入任何专注数据。');
    this.emitRuntime();
  }

  recordMindWander() {
    if (this.runtime.phase !== 'focusing' && this.runtime.phase !== 'paused') return;
    this.appendEvent('mindWander');
    this.toast('记下了。发现走神，本身就是注意力回来了。');
    this.emitRuntime();
  }

  recordFatigue() {
    if (this.runtime.phase !== 'focusing' && this.runtime.phase !== 'paused') return;
    this.appendEvent('fatigue');
    this.toast('已记录疲劳信号。必要时提前结束比硬撑更有价值。');
    this.emitRuntime();
  }

  skipMicroBreak() {
    if (this.runtime.phase !== 'microBreak') return;
    this.resumeAfterMicroBreak();
    this.emitRuntime();
  }

  saveCompletion({ focusRating, endEnergy, note } = {}) {
    const draft = this.draft;
    if (!draft) return;
    const session = {
      id: newId(),
      startedAt: draft.startedAt,
      endedAt: Date.now(),
      taskName: draft.taskName,
      plannedMinutes: draft.plannedMinutes,
      focusedSeconds: this.runtime.focusedElapsedSeconds,
      reminderMinimumMinutes: this.settings.reminderMinimumMinutes,
      reminderMaximumMinutes: this.settings.reminderMaximumMinutes,
      microBreakSeconds: this.settings.microBreakSeconds,
      events: this.runtime.currentEvents,
      startEnergy: draft.startEnergy,
      endEnergy: core.clamp(Math.round(Number(endEnergy) || 3), 1, 5),
      focusRating: core.clamp(Math.round(Number(focusRating) || 4), 1, 5),
      completed: this.pendingCompleted,
      note: typeof note === 'string' ? note : ''
    };
    this.sessions = [session, ...this.sessions];
    this.draft = null;
    Object.assign(this.runtime, { phase: 'idle', showCompletionSheet: false, draftTaskName: null });
    this.saveNow();
    this.emit('sessions', this.sessions);
    this.toast('这一轮已存入你的专注档案。');
    this.emitRuntime();
  }

  setStartEnergy(value) {
    const energy = core.clamp(Math.round(Number(value) || 4), 1, 5);
    this.runtime.currentStartEnergy = energy;
    if (this.draft) this.draft.startEnergy = energy;
    this.emitRuntime();
  }

  // ---- 任务 ----

  selectTask(name) {
    if (this.isSessionActive) return;
    if (name == null) {
      this.updateSettings({ selectedTaskName: null });
      return;
    }
    const trimmed = core.normalizedTaskName(name);
    this.updateSettings({ selectedTaskName: this.settings.taskNames.includes(trimmed) ? trimmed : null });
  }

  addTask(name) {
    if (this.isSessionActive) return false;
    const trimmed = core.normalizedTaskName(name);
    if (!trimmed) return false;
    const existing = this.settings.taskNames.find((task) => core.sameTaskName(task, trimmed));
    if (existing) {
      this.updateSettings({ selectedTaskName: existing });
      this.toast(`已选择任务“${existing}”。`);
      return true;
    }
    this.updateSettings({ taskNames: [...this.settings.taskNames, trimmed], selectedTaskName: trimmed });
    this.toast(`已新增并选择任务“${trimmed}”。`);
    return true;
  }

  removeTask(name) {
    const patch = { taskNames: this.settings.taskNames.filter((task) => task !== name) };
    if (this.settings.selectedTaskName === name) patch.selectedTaskName = null;
    this.updateSettings(patch);
    this.toast(`已从任务列表移除“${name}”，历史记录仍保留。`);
  }

  // ---- 声音与音乐 ----

  playSound(name) {
    const resolved = name === '随机' ? core.SOUNDS[Math.floor(Math.random() * core.SOUNDS.length)] : name;
    this.emit('chime', resolved);
  }

  testMusic() {
    const player = core.musicPlayer(this.settings.musicPlayer);
    this.setMusicMessage(`正在连接“${player.title}”…`);
    const request = (this.musicRequest = Symbol('music'));
    Promise.resolve()
      .then(() => this.playMusicImpl(player.id))
      .then(
        (track) => {
          if (this.musicRequest === request) this.setMusicMessage(`正在播放：${track}`);
        },
        (error) => {
          if (this.musicRequest === request) this.setMusicMessage(`播放失败：${error && error.message ? error.message : error}`);
        }
      );
  }

  setMusicMessage(message) {
    this.runtime.musicMessage = message;
    this.emitRuntime();
  }

  toggleAmbientSound(id) {
    if (!core.AMBIENT_IDS.includes(id)) return;
    const selected = [...this.settings.ambientSounds];
    const index = selected.indexOf(id);
    if (index >= 0) {
      selected.splice(index, 1);
      this.updateSettings({ ambientSounds: selected });
      if (selected.length === 0) this.stopAmbient();
    } else {
      selected.push(id);
      this.updateSettings({ ambientSounds: selected });
      // 点一下就能试听，不用再去按播放。
      this.playAmbient();
    }
    this.emitRuntime();
  }

  setAmbientVolume(id, volume) {
    if (!core.AMBIENT_IDS.includes(id)) return;
    this.updateSettings({ ambientVolumes: { ...this.settings.ambientVolumes, [id]: Number(volume) } });
  }

  toggleAmbientPlayback() {
    if (this.runtime.isAmbientPlaying) {
      this.stopAmbient();
    } else {
      if (this.settings.ambientSounds.length === 0) this.updateSettings({ ambientSounds: ['rain'] });
      this.playAmbient();
    }
    this.emitRuntime();
  }

  /// 界面里的音频引擎启动失败时回报。
  ambientFailed() {
    if (!this.runtime.isAmbientPlaying) return;
    this.runtime.isAmbientPlaying = false;
    this.toast('环境音无法播放，请检查声音输出设备。');
    this.emitRuntime();
  }

  playAmbient() {
    if (this.settings.ambientSounds.length === 0) return;
    this.runtime.isAmbientPlaying = true;
  }

  stopAmbient() {
    this.runtime.isAmbientPlaying = false;
  }

  // ---- 记录 ----

  async exportCSV() {
    const exported = await this.exportCSVImpl(this.sessions);
    this.toast(exported ? 'CSV 已导出。' : '没有导出文件。');
    this.emitRuntime();
  }

  clearHistory() {
    this.sessions = [];
    this.saveNow();
    this.emit('sessions', this.sessions);
    this.toast('专注记录已清空。');
    this.emitRuntime();
  }

  removeSession(id) {
    this.sessions = this.sessions.filter((session) => session.id !== id);
    this.saveNow();
    this.emit('sessions', this.sessions);
  }

  // ---- 计时 ----

  tick() {
    const now = Date.now();
    const runtime = this.runtime;
    if (runtime.phase === 'focusing') {
      const remaining = Math.max(0, this.focusEndDate ? (this.focusEndDate - now) / 1000 : this.pausedRemaining);
      runtime.remainingSeconds = Math.ceil(remaining);
      runtime.focusedElapsedSeconds = Math.max(0, runtime.plannedSeconds - runtime.remainingSeconds);
      if (remaining <= 0) {
        this.finishSession(true);
      } else if (this.nextReminderDate && now >= this.nextReminderDate) {
        this.beginMicroBreak();
      }
    } else if (runtime.phase === 'microBreak') {
      const remaining = Math.max(0, this.microBreakEndDate ? (this.microBreakEndDate - now) / 1000 : 0);
      runtime.breakRemainingSeconds = Math.ceil(remaining);
      if (remaining <= 0) this.resumeAfterMicroBreak();
    }
    runtime.nextReminderSeconds =
      runtime.phase === 'focusing' && this.nextReminderDate ? Math.max(0, Math.floor((this.nextReminderDate - now) / 1000)) : null;
    this.emitRuntime();
  }

  beginMicroBreak() {
    this.pausedRemaining = Math.max(0, this.focusEndDate ? (this.focusEndDate - Date.now()) / 1000 : this.runtime.remainingSeconds);
    this.focusEndDate = null;
    this.nextReminderDate = null;
    this.runtime.breakRemainingSeconds = this.settings.microBreakSeconds;
    this.microBreakEndDate = Date.now() + this.settings.microBreakSeconds * 1000;
    this.appendEvent('reminder');
    this.runtime.phase = 'microBreak';
    this.playSound(this.settings.reminderSound);
  }

  resumeAfterMicroBreak() {
    this.microBreakEndDate = null;
    this.runtime.breakRemainingSeconds = 0;
    this.focusEndDate = Date.now() + this.pausedRemaining * 1000;
    this.runtime.phase = 'focusing';
    this.scheduleNextReminder();
  }

  finishSession(completed) {
    const runtime = this.runtime;
    if (runtime.phase === 'focusing') {
      const remaining = Math.max(0, this.focusEndDate ? (this.focusEndDate - Date.now()) / 1000 : 0);
      runtime.remainingSeconds = Math.ceil(remaining);
      runtime.focusedElapsedSeconds = Math.max(0, runtime.plannedSeconds - runtime.remainingSeconds);
    }
    this.pendingCompleted = completed;
    this.focusEndDate = null;
    this.nextReminderDate = null;
    this.microBreakEndDate = null;
    runtime.phase = 'completed';
    runtime.showCompletionSheet = true;
    this.playSound(this.settings.completionSound);

    // 结束音乐要接上时也停掉环境音，免得两者叠在一起。
    if (this.settings.ambientFollowsFocus || this.settings.autoPlayMusic) this.stopAmbient();
    if (this.settings.autoPlayMusic) this.testMusic();
    this.emitRuntime();
    this.emit('completed', { completed });
  }

  scheduleNextReminder() {
    const minimum = Math.max(1, this.settings.reminderMinimumMinutes * 60);
    const maximum = Math.max(minimum, this.settings.reminderMaximumMinutes * 60);
    const interval = randomInt(minimum, maximum);
    if (interval >= Math.max(0, Math.floor(this.pausedRemaining))) {
      this.nextReminderDate = null;
      return;
    }
    this.nextReminderDate = Date.now() + interval * 1000;
  }

  appendEvent(kind) {
    this.runtime.currentEvents = [
      ...this.runtime.currentEvents,
      { id: newId(), date: Date.now(), elapsedSeconds: this.runtime.focusedElapsedSeconds, kind }
    ];
  }

  toast(message) {
    this.toastSerial += 1;
    const id = this.toastSerial;
    this.runtime.toast = { id, message };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      if (this.runtime.toast && this.runtime.toast.id === id) {
        this.runtime.toast = null;
        this.emitRuntime();
      }
    }, 3000);
    this.emitRuntime();
  }

  /// 只有真的变了才通知界面，计时每 250ms 检查一次，但数字每秒才变一次。
  emitRuntime() {
    const json = JSON.stringify(this.runtime);
    if (json === this.lastRuntimeJSON) return;
    this.lastRuntimeJSON = json;
    this.emit('runtime', this.runtime);
  }

  // ---- 保存 ----

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 250);
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.persistence.save(this.settings, this.sessions);
  }

  flush() {
    if (this.saveTimer) this.saveNow();
  }
}

module.exports = { AppStore };
