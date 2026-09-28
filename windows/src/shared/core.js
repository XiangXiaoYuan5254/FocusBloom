// 主进程和界面共用的数据模型与统计逻辑，对应 macOS 版的 Models.swift 和 AppStore 里的计算属性。
// 同一份文件既能被 Node require，也能在界面里用 <script> 直接加载（挂到 window.FocusCore）。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.FocusCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;

  const SECTIONS = [
    { id: 'focus', title: '专注', icon: 'timer' },
    { id: 'insights', title: '洞察', icon: 'chart-spline' },
    { id: 'history', title: '记录', icon: 'history' },
    { id: 'settings', title: '设置', icon: 'sliders-horizontal' }
  ];

  const AMBIENT_SOUNDS = [
    { id: 'rain', title: '雨声', detail: '雨落在树叶上', icon: 'cloud-rain', tint: 'blue' },
    { id: 'waves', title: '海浪', detail: '沙滩上的浪花', icon: 'waves', tint: 'blue' },
    { id: 'stream', title: '溪流', detail: '林间的小溪', icon: 'droplet', tint: 'mint' },
    { id: 'wind', title: '风声', detail: '松林里的风', icon: 'wind', tint: 'mint' },
    { id: 'fire', title: '篝火', detail: '壁炉里的柴火', icon: 'flame', tint: 'coral' },
    { id: 'birds', title: '鸟鸣', detail: '清晨湖边的鸟鸣', icon: 'bird', tint: 'mint' },
    { id: 'crickets', title: '虫鸣', detail: '夏夜花园的蟋蟀', icon: 'moon-star', tint: 'amber' },
    // 除棕噪音外都是内置的真实录音（Resources/Ambient），棕噪音在本机实时生成。
    { id: 'brownNoise', title: '棕噪音', detail: '低沉平稳的底噪', icon: 'audio-lines', tint: 'amber' }
  ];
  const AMBIENT_IDS = AMBIENT_SOUNDS.map((sound) => sound.id);

  // 提示音沿用 macOS 版的名字（数据文件互通），声音由界面用 Web Audio 合成。
  const SOUNDS = ['Glass', 'Ping', 'Pop', 'Tink', 'Submarine', 'Purr', 'Morse'];
  const REMINDER_SOUND_OPTIONS = ['随机', ...SOUNDS];
  const COMPLETION_SOUND_OPTIONS = [...SOUNDS, 'Hero'];
  const SOUND_LABELS = {
    随机: '随机',
    Glass: '玻璃',
    Ping: '清铃',
    Pop: '气泡',
    Tink: '轻敲',
    Submarine: '声呐',
    Purr: '低鸣',
    Morse: '电码',
    Hero: '凯旋'
  };

  // Windows 上通过系统媒体控制（SMTC）操作播放器；pattern 匹配媒体会话的 AppUserModelId。
  const MUSIC_PLAYERS = [
    { id: 'netease', title: '网易云音乐', process: 'cloudmusic', pattern: 'cloudmusic', startName: '网易云音乐|NetEase Cloud ?Music|CloudMusic' },
    { id: 'qqmusic', title: 'QQ 音乐', process: 'QQMusic', pattern: 'QQMusic', startName: 'QQ ?音乐|QQMusic' },
    { id: 'applemusic', title: 'Apple Music', process: 'AppleMusic', pattern: 'AppleMusic', startName: '^Apple Music' },
    { id: 'spotify', title: 'Spotify', process: 'Spotify', pattern: 'Spotify', startName: '^Spotify' },
    { id: 'any', title: '正在使用的播放器', process: '', pattern: '', startName: '' }
  ];

  const UNCATEGORIZED = '未分类';

  function defaultSettings() {
    return {
      selectedDurationMinutes: 50,
      reminderMinimumMinutes: 3,
      reminderMaximumMinutes: 5,
      microBreakSeconds: 10,
      reminderSound: 'Glass',
      completionSound: 'Hero',
      showNextReminder: false,
      autoPlayMusic: false,
      // 以下两项只给 macOS 版使用，原样保留，保证数据文件拷回 Mac 时仍能读取。
      musicService: 'Apple Music',
      musicSource: '整个资料库',
      playlistName: '',
      appearanceMode: 'dark',
      floatingTimerOnMinimize: true,
      floatingSignalButtons: false,
      taskNames: [],
      selectedTaskName: null,
      ambientSounds: [],
      ambientVolumes: {},
      ambientMasterVolume: 0.7,
      ambientFollowsFocus: true,
      // Windows 版独有的设置，macOS 版解码时会忽略。
      musicPlayer: 'netease',
      closeToTray: true,
      autoCheckUpdates: true
    };
  }

  function clamp(value, lower, upper) {
    return Math.min(upper, Math.max(lower, value));
  }

  function toInt(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : fallback;
  }

  function toUnit(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? clamp(number, 0, 1) : fallback;
  }

  function normalizedTaskName(name) {
    return Array.from(String(name ?? '').trim()).slice(0, 40).join('');
  }

  function sameTaskName(a, b) {
    return a.localeCompare(b, 'zh-CN', { sensitivity: 'base' }) === 0;
  }

  /// 对应 AppStore.normalizedSettings，同时把读进来的字段修正成正确的类型。
  function normalizeSettings(value) {
    const defaults = defaultSettings();
    const input = value && typeof value === 'object' ? value : {};
    const result = { ...defaults, ...input };

    result.reminderMinimumMinutes = clamp(toInt(result.reminderMinimumMinutes, defaults.reminderMinimumMinutes), 1, 60);
    result.reminderMaximumMinutes = clamp(
      toInt(result.reminderMaximumMinutes, defaults.reminderMaximumMinutes),
      result.reminderMinimumMinutes,
      90
    );
    result.microBreakSeconds = clamp(toInt(result.microBreakSeconds, defaults.microBreakSeconds), 5, 60);
    result.selectedDurationMinutes = clamp(toInt(result.selectedDurationMinutes, defaults.selectedDurationMinutes), 1, 1440);

    if (!REMINDER_SOUND_OPTIONS.includes(result.reminderSound)) result.reminderSound = defaults.reminderSound;
    if (!COMPLETION_SOUND_OPTIONS.includes(result.completionSound)) result.completionSound = defaults.completionSound;
    for (const key of ['showNextReminder', 'autoPlayMusic', 'floatingTimerOnMinimize', 'floatingSignalButtons', 'ambientFollowsFocus', 'closeToTray', 'autoCheckUpdates']) {
      result[key] = typeof result[key] === 'boolean' ? result[key] : defaults[key];
    }
    result.appearanceMode = result.appearanceMode === 'light' ? 'light' : 'dark';
    if (!MUSIC_PLAYERS.some((player) => player.id === result.musicPlayer)) result.musicPlayer = defaults.musicPlayer;
    if (typeof result.playlistName !== 'string') result.playlistName = '';

    const uniqueTasks = [];
    for (const task of Array.isArray(result.taskNames) ? result.taskNames : []) {
      const name = normalizedTaskName(task);
      if (name && !uniqueTasks.some((existing) => sameTaskName(existing, name))) {
        uniqueTasks.push(name);
      }
    }
    result.taskNames = uniqueTasks;
    const selected = result.selectedTaskName == null ? null : normalizedTaskName(result.selectedTaskName);
    result.selectedTaskName = selected && uniqueTasks.includes(selected) ? selected : null;

    // 声音按字符串保存，未知的名字直接丢掉，不会影响整个文件。
    const sounds = Array.isArray(result.ambientSounds) ? result.ambientSounds : [];
    result.ambientSounds = sounds.filter((id, index) => AMBIENT_IDS.includes(id) && sounds.indexOf(id) === index);
    const volumes = {};
    const rawVolumes = result.ambientVolumes && typeof result.ambientVolumes === 'object' ? result.ambientVolumes : {};
    for (const [id, volume] of Object.entries(rawVolumes)) {
      const number = Number(volume);
      if (Number.isFinite(number)) volumes[id] = clamp(number, 0, 1);
    }
    result.ambientVolumes = volumes;
    result.ambientMasterVolume = toUnit(result.ambientMasterVolume, defaults.ambientMasterVolume);
    return result;
  }

  function settingsEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function ambientVolume(settings, id) {
    const volume = settings.ambientVolumes ? settings.ambientVolumes[id] : undefined;
    return typeof volume === 'number' ? volume : 0.7;
  }

  /// 播放器需要的目标音量（按听感曲线取平方），和设置里的原始滑块值分开。
  function ambientLevels(settings) {
    const selected = new Set(settings.ambientSounds || []);
    const sounds = {};
    for (const id of AMBIENT_IDS) {
      const volume = selected.has(id) ? ambientVolume(settings, id) : 0;
      sounds[id] = volume * volume;
    }
    const master = settings.ambientMasterVolume ?? 0.7;
    return { master: master * master, sounds };
  }

  // ---- 单轮记录 ----

  function countEvents(events, kind) {
    return (events || []).filter((event) => event.kind === kind).length;
  }

  function mindWanderCount(session) {
    return countEvents(session.events, 'mindWander');
  }

  function fatigueCount(session) {
    return countEvents(session.events, 'fatigue');
  }

  function reminderCount(session) {
    return countEvents(session.events, 'reminder');
  }

  function focusedMinutes(session) {
    return Math.round(session.focusedSeconds / 60);
  }

  function firstLapseMinute(session) {
    const lapse = (session.events || []).find((event) => event.kind === 'mindWander');
    return lapse ? Math.max(1, Math.floor(lapse.elapsedSeconds / 60)) : null;
  }

  function displayTaskName(session) {
    const trimmed = (session.taskName || '').trim();
    return trimmed || UNCATEGORIZED;
  }

  // ---- 日期 ----

  function startOfDay(time) {
    const date = new Date(time);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  function addDays(dayStart, days) {
    const date = new Date(dayStart);
    date.setDate(date.getDate() + days);
    return date.getTime();
  }

  function isSameDay(a, b) {
    return startOfDay(a) === startOfDay(b);
  }

  // ---- 统计（对应 AppStore 的计算属性） ----

  function todaySessions(sessions, now = Date.now()) {
    return sessions.filter((session) => isSameDay(session.startedAt, now));
  }

  function sum(list, pick) {
    return list.reduce((total, item) => total + pick(item), 0);
  }

  function streakDays(sessions, now = Date.now()) {
    const activeDays = new Set(sessions.map((session) => startOfDay(session.startedAt)));
    let day = startOfDay(now);
    if (!activeDays.has(day)) day = addDays(day, -1);
    let streak = 0;
    while (activeDays.has(day)) {
      streak += 1;
      day = addDays(day, -1);
    }
    return streak;
  }

  function attentionCapacityMinutes(sessions) {
    const recent = sessions.slice(0, 12);
    if (recent.length === 0) return 30;
    const spans = recent
      .map((session) => {
        const minutes = focusedMinutes(session);
        const lapse = firstLapseMinute(session);
        if (lapse !== null) return Math.max(10, lapse);
        if (session.focusRating >= 4) return Math.max(10, minutes);
        return Math.max(10, Math.min(minutes, Math.trunc(minutes * 0.75)));
      })
      .sort((a, b) => a - b);
    return Math.min(120, spans[Math.floor(spans.length / 2)]);
  }

  function recommendedMinutes(sessions) {
    if (sessions.length < 3) return 30;
    const successful = sessions
      .slice(0, 3)
      .every((session) => session.completed && session.focusRating >= 4 && session.endEnergy >= 2 && mindWanderCount(session) <= 1);
    const base = attentionCapacityMinutes(sessions);
    return Math.min(120, Math.max(20, successful ? base + 5 : base));
  }

  function weeklySummaries(sessions, now = Date.now()) {
    const today = startOfDay(now);
    const result = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = addDays(today, -offset);
      const daySessions = sessions.filter((session) => startOfDay(session.startedAt) === date);
      result.push({
        date,
        minutes: sum(daySessions, focusedMinutes),
        sessions: daySessions.length,
        wanderCount: sum(daySessions, mindWanderCount)
      });
    }
    return result;
  }

  function taskSummaries(sessions) {
    const groups = new Map();
    for (const session of sessions) {
      const name = displayTaskName(session);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(session);
    }
    return Array.from(groups, ([name, list]) => ({
      name,
      focusedMinutes: sum(list, focusedMinutes),
      sessions: list.length,
      averageFocus: list.length ? sum(list, (session) => session.focusRating) / list.length : 0
    })).sort((a, b) => {
      if (a.focusedMinutes === b.focusedMinutes) {
        return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
      }
      return b.focusedMinutes - a.focusedMinutes;
    });
  }

  // ---- 显示 ----

  function formatClock(seconds) {
    const safe = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(safe / 60);
    return `${String(minutes).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
  }

  function energyText(value) {
    return ['', '很低', '偏低', '一般', '不错', '充沛'][clamp(value, 1, 5)];
  }

  function isSessionActive(phase) {
    return phase === 'focusing' || phase === 'paused' || phase === 'microBreak';
  }

  function progress(runtime) {
    if (!runtime.plannedSeconds) return 0;
    return clamp(runtime.focusedElapsedSeconds / runtime.plannedSeconds, 0, 1);
  }

  function musicPlayer(id) {
    return MUSIC_PLAYERS.find((player) => player.id === id) || MUSIC_PLAYERS[0];
  }

  return {
    DAY_MS,
    SECTIONS,
    AMBIENT_SOUNDS,
    AMBIENT_IDS,
    SOUNDS,
    REMINDER_SOUND_OPTIONS,
    COMPLETION_SOUND_OPTIONS,
    SOUND_LABELS,
    MUSIC_PLAYERS,
    UNCATEGORIZED,
    defaultSettings,
    normalizeSettings,
    normalizedTaskName,
    sameTaskName,
    settingsEqual,
    ambientVolume,
    ambientLevels,
    mindWanderCount,
    fatigueCount,
    reminderCount,
    focusedMinutes,
    firstLapseMinute,
    displayTaskName,
    startOfDay,
    addDays,
    isSameDay,
    todaySessions,
    sum,
    streakDays,
    attentionCapacityMinutes,
    recommendedMinutes,
    weeklySummaries,
    taskSummaries,
    formatClock,
    energyText,
    isSessionActive,
    progress,
    musicPlayer,
    clamp
  };
});
