// 主窗口界面：侧边栏 + 专注 / 洞察 / 记录 / 设置四页，以及结束确认和复盘面板。
// 对应 macOS 版的 FocusBloomApp.swift（ContentView、SidebarView）、FocusView、InsightsView、
// HistoryView、SettingsView 和 AmbientSoundsView。
(function () {
  const { html, cx, Icon, Button, Toggle, Stepper, NumberField, Slider, SectionHeading, MetricPill, Card, Modal } = BloomUI;
  const { render } = preact;
  const { useEffect, useLayoutEffect, useMemo, useRef, useState } = preactHooks;
  const core = FocusCore;
  const { useBloom, updateSettings, act } = BloomClient;

  document.documentElement.dataset.platform = window.bloom.platform;

  const ambient = new BloomAudio.AmbientEngine({
    loadAsset: (id) => window.bloom.loadAmbient(id),
    onFailure: () => act('ambientFailed')
  });
  const chimes = new BloomAudio.ChimePlayer();
  window.bloom.on('chime', (name) => chimes.play(name));

  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function useStats(sessions) {
    const dayKey = core.startOfDay(Date.now());
    return useMemo(() => {
      const today = core.todaySessions(sessions);
      return {
        todayCount: today.length,
        todayMinutes: core.sum(today, core.focusedMinutes),
        todayWanderCount: core.sum(today, core.mindWanderCount),
        streakDays: core.streakDays(sessions),
        capacity: core.attentionCapacityMinutes(sessions),
        recommended: core.recommendedMinutes(sessions),
        weekly: core.weeklySummaries(sessions),
        tasks: core.taskSummaries(sessions)
      };
    }, [sessions, dayKey]);
  }

  function taskDisplayName(settings, runtime) {
    const selected = settings.selectedTaskName && settings.taskNames.includes(settings.selectedTaskName) ? settings.selectedTaskName : null;
    return runtime.draftTaskName || selected || core.UNCATEGORIZED;
  }

  // ---- 应用外壳 ----

  function App() {
    const state = useBloom();
    const [section, setSection] = useState('focus');
    const [endDialog, setEndDialog] = useState(false);
    const scrollRef = useRef(null);
    const { settings, runtime, sessions } = state;
    const phase = runtime ? runtime.phase : 'idle';
    const levels = settings ? core.ambientLevels(settings) : null;
    const levelsKey = JSON.stringify(levels);
    const stats = useStats(sessions);

    // 在渲染时就切换主题：子组件（计时环 canvas）绘制时要读到新的颜色变量。
    if (settings) document.documentElement.dataset.theme = settings.appearanceMode;

    useEffect(() => {
      if (runtime && levels) ambient.update(runtime.isAmbientPlaying, levels);
    }, [runtime && runtime.isAmbientPlaying, levelsKey]);

    useEffect(() => {
      if (!core.isSessionActive(phase)) setEndDialog(false);
    }, [phase]);

    useLayoutEffect(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [section]);

    if (!state.ready) return null;

    const ctx = {
      settings,
      runtime,
      sessions,
      stats,
      update: state.update,
      meta: state.meta,
      active: core.isSessionActive(phase),
      taskName: taskDisplayName(settings, runtime),
      setSection,
      openEndDialog: () => setEndDialog(true)
    };

    const pages = { focus: FocusPage, insights: InsightsPage, history: HistoryPage, settings: SettingsPage };
    const Page = pages[section];

    return html`<div class="app">
      <${Sidebar} ctx=${ctx} section=${section} />
      <main class="detail">
        <div class="titlebar"></div>
        <div class="scroll" ref=${scrollRef}>
          <${Page} ctx=${ctx} />
        </div>
        ${runtime.toast &&
        html`<div class="toast" key=${runtime.toast.id} role="status">
          <${Icon} name="circle-check" size=${16} class="toast-icon" />
          <span>${runtime.toast.message}</span>
        </div>`}
      </main>
      ${endDialog &&
      html`<${SessionEndDialog}
        onContinue=${() => setEndDialog(false)}
        onReview=${() => {
          setEndDialog(false);
          act('stopSessionEarly');
        }}
        onAbandon=${() => {
          setEndDialog(false);
          act('abandonSession');
        }}
      />`}
      ${runtime.showCompletionSheet && html`<${CompletionSheet} ctx=${ctx} />`}
    </div>`;
  }

  function Sidebar({ ctx, section }) {
    const { settings, stats, active } = ctx;
    const dark = settings.appearanceMode === 'dark';
    return html`<aside class="sidebar">
      <div class="brand">
        <span class="brand-mark"><${Icon} name="leaf-fill" size=${19} /></span>
        <span class="brand-text">
          <span class="brand-name">专注芽</span>
          <span class="brand-sub">FOCUSBLOOM</span>
        </span>
      </div>
      <nav class="nav">
        ${core.SECTIONS.map(
          (item) => html`<button
            key=${item.id}
            type="button"
            class=${cx('nav-item', section === item.id && 'is-active')}
            aria-current=${section === item.id ? 'page' : undefined}
            onClick=${() => ctx.setSection(item.id)}
          >
            <${Icon} name=${item.icon} size=${16} stroke=${2.2} />
            <span>${item.title}</span>
            ${item.id === 'focus' && active && html`<span class="nav-dot" title="正在专注"></span>`}
          </button>`
        )}
      </nav>
      <div class="sidebar-spacer"></div>
      <${UpdateNotice} update=${ctx.update} active=${active} />
      <button type="button" class=${cx('appearance-toggle', dark ? 'tint-amber' : 'tint-blue')} onClick=${() => act('toggleAppearance')}>
        <span class="appearance-icon"><${Icon} name=${dark ? 'sun' : 'moon-star'} size=${14} /></span>
        <span>${dark ? '切换到日间模式' : '切换到夜间模式'}</span>
      </button>
      <div class="today-card">
        <div class="today-label">今天</div>
        <div class="today-metrics">
          <div><span class="today-value num">${stats.todayMinutes}</span><span class="today-unit">分钟</span></div>
          <div><span class="today-value num">${stats.todayCount}</span><span class="today-unit">轮</span></div>
        </div>
        <div class="hairline"></div>
        <div class="today-streak">
          <${Icon} name="flame-fill" size=${14} class="text-amber" />
          <span>${stats.streakDays === 0 ? '从今天开始' : `连续 ${stats.streakDays} 天`}</span>
        </div>
      </div>
    </aside>`;
  }

  // 新版本下载好后（免安装版是发现新版本时）在侧边栏轻轻提示；专注中不显示，不打断这一轮。
  function UpdateNotice({ update, active }) {
    if (active || !update || (update.status !== 'downloaded' && update.status !== 'available')) return null;
    const ready = update.status === 'downloaded';
    return html`<div class="update-notice" role="status">
      <div class="update-notice-title">
        <${Icon} name="circle-arrow-down" size=${15} class="text-mint" />
        <strong>新版本 v${update.version}</strong>
      </div>
      <p>${ready ? '已在后台下载好，重启即可完成更新。' : '免安装版需要下载新的压缩包替换。'}</p>
      <${Button}
        variant="primary"
        class="btn-compact btn-block"
        onClick=${() => window.bloom.command(ready ? 'install-update' : 'open-download-page')}
      >
        ${ready ? '重启并更新' : '前往下载'}
      <//>
    </div>`;
  }

  // ---- 专注页 ----

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 11) return '早上好';
    if (hour < 14) return '中午好';
    if (hour < 19) return '下午好';
    return '晚上好';
  }

  function FocusPage({ ctx }) {
    const { runtime, stats, active } = ctx;
    const activeTitle =
      runtime.phase === 'microBreak' ? '让大脑安静十秒' : runtime.phase === 'paused' ? '暂停不是中断，是选择' : '把注意力放回眼前';
    return html`<div class="page">
      <header class="page-header">
        <${SectionHeading}
          eyebrow=${greeting()}
          title=${active ? activeTitle : '今天，练习一次完整的注意'}
          subtitle=${active ? '计时只统计净专注时间，微休息不会占用本轮时长。' : '目标不是硬撑得更久，而是越来越了解自己的注意力。'}
        />
        <div class="header-metrics">
          <${MetricPill} icon="clock" value=${`${stats.todayMinutes} 分钟`} label="今日专注" />
          <${MetricPill} icon="crosshair" value=${`${stats.todayWanderCount} 次`} label="今日走神" tint="coral" />
          <${MetricPill} icon="flame" value=${`${stats.streakDays} 天`} label="连续记录" tint="amber" />
        </div>
      </header>
      <div class="focus-row">
        <${TimerCard} ctx=${ctx} />
        <${ControlCard} ctx=${ctx} />
      </div>
      ${active ? html`<${LiveSignals} ctx=${ctx} />` : html`<${TrainingHint} ctx=${ctx} />`}
      <${AmbientCard} ctx=${ctx} />
    </div>`;
  }

  function Ring({ size, stroke, progress, tint, class: className }) {
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const center = size / 2;
    return html`<svg class=${cx('ring', className)} width=${size} height=${size} viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle class="ring-track" cx=${center} cy=${center} r=${radius} stroke-width=${stroke} />
      <circle
        class=${cx('ring-progress', tint && `stroke-${tint}`)}
        cx=${center}
        cy=${center}
        r=${radius}
        stroke-width=${stroke}
        stroke-dasharray=${circumference}
        stroke-dashoffset=${circumference * (1 - progress)}
        transform="rotate(-90 ${center} ${center})"
      />
    </svg>`;
  }

  function rgba(hex, alpha) {
    const value = parseInt(hex.replace('#', ''), 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
  }

  /// 主计时环：从 12 点方向开始的角度渐变（薄荷绿 → 亮绿 → 蓝 → 薄荷绿），对应 Mac 版的 AngularGradient。
  /// SVG 没有角度渐变，这里用 canvas 画。
  function GradientRing({ size, stroke, progress, theme }) {
    const ref = useRef(null);
    const glow = 26;
    useLayoutEffect(() => {
      const canvas = ref.current;
      const ratio = window.devicePixelRatio || 1;
      const full = size + glow * 2;
      canvas.width = Math.round(full * ratio);
      canvas.height = Math.round(full * ratio);
      const context = canvas.getContext('2d');
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, full, full);

      const styles = getComputedStyle(document.documentElement);
      const color = (name) => styles.getPropertyValue(name).trim();
      const center = full / 2;
      const radius = (size - stroke) / 2;
      const start = -Math.PI / 2;
      context.lineWidth = stroke;

      context.strokeStyle = color('--ring-track');
      context.beginPath();
      context.arc(center, center, radius, 0, Math.PI * 2);
      context.stroke();

      const gradient = context.createConicGradient(start, center, center);
      gradient.addColorStop(0, color('--mint'));
      gradient.addColorStop(1 / 3, color('--mint-bright'));
      gradient.addColorStop(2 / 3, color('--blue'));
      gradient.addColorStop(1, color('--mint'));
      context.strokeStyle = gradient;
      context.lineCap = 'round';
      context.shadowColor = rgba(color('--mint'), 0.24);
      context.shadowBlur = 18;
      context.beginPath();
      context.arc(center, center, radius, start, start + Math.PI * 2 * progress);
      context.stroke();
    }, [size, stroke, progress, theme]);
    return html`<canvas
      ref=${ref}
      class="ring-canvas"
      style=${{ width: `${size + glow * 2}px`, height: `${size + glow * 2}px`, margin: `-${glow}px` }}
      aria-hidden="true"
    ></canvas>`;
  }

  function TimerCard({ ctx }) {
    const { settings, runtime, active, taskName } = ctx;
    const phase = runtime.phase;
    const phaseIcon = { microBreak: 'sparkles', paused: 'circle-pause', focusing: 'leaf-fill' }[phase] || 'circle-dashed';
    const phaseTint = { microBreak: 'blue', paused: 'amber' }[phase] || 'mint';
    const timerText =
      phase === 'microBreak'
        ? String(runtime.breakRemainingSeconds)
        : phase === 'idle'
          ? core.formatClock(settings.selectedDurationMinutes * 60)
          : core.formatClock(runtime.remainingSeconds);
    const caption = {
      microBreak: `${taskName} · 闭眼 · 松肩 · 慢呼吸`,
      paused: `${taskName} · 已暂停`,
      focusing: `${taskName} · 净专注剩余`
    }[phase] || '准备开始';
    const progress = active ? Math.max(0.01, core.progress(runtime)) : 1;
    const showNext = settings.showNextReminder && active && phase !== 'microBreak';

    return html`<section class="timer-card">
      <div class="ring-wrap">
        <${GradientRing} size=${285} stroke=${17} progress=${progress} theme=${settings.appearanceMode} />
        <div class="ring-center">
          <span class=${`text-${phaseTint}`}><${Icon} name=${phaseIcon} size=${20} /></span>
          <span class="timer-text num">${timerText}</span>
          <span class="timer-caption" title=${caption}>${caption}</span>
        </div>
      </div>
      <div class="timer-actions">
        ${phase === 'idle' &&
        html`<${Button} variant="primary" icon="play" iconFilled class="min-135" onClick=${() => act('startSession')}>开始这一轮<//>`}
        ${phase === 'microBreak' &&
        html`<${Button} variant="primary" icon="arrow-right" onClick=${() => act('skipMicroBreak')}>提前继续<//>
          <${Button} icon="square" iconFilled onClick=${ctx.openEndDialog}>结束<//>`}
        ${(phase === 'focusing' || phase === 'paused') &&
        html`<${Button}
            variant="primary"
            icon=${phase === 'paused' ? 'play' : 'pause'}
            iconFilled
            class="min-95"
            onClick=${() => act('togglePause')}
            >${phase === 'paused' ? '继续' : '暂停'}<//
          >
          <${Button} icon="square" iconFilled onClick=${ctx.openEndDialog}>结束<//>`}
      </div>
      <div class="timer-metrics">
        <${TimerMetric} icon="hourglass" title=${`${settings.selectedDurationMinutes} 分钟`} caption="本轮目标" />
        <span class="vdivider"></span>
        <${TimerMetric}
          icon="bell-ring"
          title=${`${settings.reminderMinimumMinutes}–${settings.reminderMaximumMinutes} 分钟`}
          caption="随机提示"
        />
        ${showNext &&
        html`<span class="vdivider"></span>
          <${TimerMetric}
            icon="eye"
            title=${runtime.nextReminderSeconds == null ? '—' : core.formatClock(runtime.nextReminderSeconds)}
            caption="下次提示"
          />`}
      </div>
    </section>`;
  }

  function TimerMetric({ icon, title, caption }) {
    return html`<div class="timer-metric">
      <${Icon} name=${icon} size=${14} class="text-mint" />
      <span>
        <span class="timer-metric-title num">${title}</span>
        <span class="timer-metric-caption">${caption}</span>
      </span>
    </div>`;
  }

  function ControlCard({ ctx }) {
    const { settings, runtime, active, taskName } = ctx;
    const [creating, setCreating] = useState(false);
    const [newTask, setNewTask] = useState('');
    const newTaskRef = useRef(null);
    useEffect(() => {
      if (creating && newTaskRef.current) newTaskRef.current.focus();
    }, [creating]);
    const selected = settings.selectedTaskName && settings.taskNames.includes(settings.selectedTaskName) ? settings.selectedTaskName : '';
    const player = core.musicPlayer(settings.musicPlayer);

    const commitTask = async () => {
      if (!newTask.trim()) return;
      if (await act('addTask', newTask)) {
        setNewTask('');
        setCreating(false);
      }
    };

    return html`<fieldset class="card card-strong control-card" disabled=${active}>
      <div class="card-title-row">
        <div>
          <h2 class="card-title">${active ? '本轮设置' : '设计这一轮'}</h2>
          <p class="card-subtitle">${active ? '开始后锁定，避免反复调整。' : '先选一个今天愿意完成的长度。'}</p>
        </div>
        <${Icon} name="gauge" size=${18} class="text-mint" />
      </div>

      <div class="control-group">
        <${ControlLabel} title="本轮任务" value=${taskName} />
        <div class="task-picker">
          <select
            class="select"
            aria-label="本轮任务"
            value=${selected}
            onChange=${(event) => act('selectTask', event.currentTarget.value || null)}
          >
            <option value="">${core.UNCATEGORIZED}</option>
            ${settings.taskNames.map((task) => html`<option key=${task} value=${task}>${task}</option>`)}
          </select>
          <button
            type="button"
            class="icon-button"
            title=${creating ? '取消新增任务' : '新增任务'}
            aria-label=${creating ? '取消新增任务' : '新增任务'}
            onClick=${() => setCreating(!creating)}
          >
            <${Icon} name=${creating ? 'x' : 'plus'} size=${14} stroke=${2.4} />
          </button>
        </div>
        ${creating &&
        html`<div class="task-creator">
          <input
            class="text-field"
            placeholder="例如：力扣、AI 学习"
            maxlength="40"
            value=${newTask}
            ref=${newTaskRef}
            onInput=${(event) => setNewTask(event.currentTarget.value)}
            onKeyDown=${(event) => event.key === 'Enter' && commitTask()}
          />
          <${Button} variant="primary" class="btn-compact" disabled=${!newTask.trim()} onClick=${commitTask}>添加<//>
        </div>`}
      </div>

      <div class="hairline"></div>

      <div class="control-group">
        <${ControlLabel} title="专注时长" value=${`${settings.selectedDurationMinutes} 分钟`} />
        <div class="duration-row">
          ${[30, 60, 90].map(
            (minutes) => html`<button
              key=${minutes}
              type="button"
              class=${cx('duration-button num', settings.selectedDurationMinutes === minutes && 'is-selected')}
              onClick=${() => updateSettings({ selectedDurationMinutes: minutes })}
            >
              ${minutes}
            </button>`
          )}
          <div class="duration-custom">
            <${NumberField}
              label="自定义专注分钟"
              value=${settings.selectedDurationMinutes}
              min=${1}
              max=${1440}
              onCommit=${(value) => updateSettings({ selectedDurationMinutes: value })}
            />
            <span class="unit">分</span>
            <${Stepper}
              label="专注时长"
              value=${settings.selectedDurationMinutes}
              min=${1}
              max=${1440}
              onChange=${(value) => updateSettings({ selectedDurationMinutes: value })}
            />
          </div>
        </div>
      </div>

      <div class="hairline"></div>

      <div class="control-group">
        <${ControlLabel}
          title="随机提示区间"
          value=${`${settings.reminderMinimumMinutes}–${settings.reminderMaximumMinutes} 分钟`}
        />
        <div class="interval-row">
          <${MinuteStepper}
            title="最早"
            value=${settings.reminderMinimumMinutes}
            min=${1}
            max=${60}
            onChange=${(value) => updateSettings({ reminderMinimumMinutes: value })}
          />
          <${Icon} name="arrow-right" size=${13} class="text-secondary" />
          <${MinuteStepper}
            title="最晚"
            value=${settings.reminderMaximumMinutes}
            min=${Math.max(1, settings.reminderMinimumMinutes)}
            max=${90}
            onChange=${(value) => updateSettings({ reminderMaximumMinutes: value })}
          />
        </div>
      </div>

      <div class="hairline"></div>

      <div class="control-group">
        <${ControlLabel} title="开始前精力" value=${core.energyText(runtime.currentStartEnergy)} />
        <div class="energy-row">
          ${[1, 2, 3, 4, 5].map(
            (level) => html`<button
              key=${level}
              type="button"
              class=${cx('energy-dot', level <= runtime.currentStartEnergy && 'is-on')}
              aria-label=${`精力 ${level} 格`}
              onClick=${() => act('setStartEnergy', level)}
            >
              <span></span>
            </button>`
          )}
        </div>
      </div>

      <div class=${cx('music-hint', settings.autoPlayMusic && 'is-on')}>
        <${Icon} name=${settings.autoPlayMusic && player.id === 'netease' ? 'cloud' : 'music'} size=${15} />
        <span>
          ${settings.autoPlayMusic
            ? player.id === 'any'
              ? '结束后让正在使用的播放器放下一首'
              : `结束后播放${player.title}下一首`
            : '可在设置中开启结束音乐'}
        </span>
      </div>
    </fieldset>`;
  }

  function ControlLabel({ title, value }) {
    return html`<div class="control-label">
      <span>${title}</span>
      <strong>${value}</strong>
    </div>`;
  }

  function MinuteStepper({ title, value, min, max, onChange }) {
    return html`<div class="minute-stepper">
      <span class="minute-stepper-title">${title}</span>
      <span class="minute-stepper-row">
        <span class="minute-stepper-value num">${value}</span>
        <span class="unit">分</span>
        <${Stepper} label=${title} value=${value} min=${min} max=${max} onChange=${onChange} />
      </span>
    </div>`;
  }

  function LiveSignals({ ctx }) {
    const events = ctx.runtime.currentEvents;
    const breakNow = ctx.runtime.phase === 'microBreak';
    return html`<${Card} class="signal-card">
      <div class="signal-copy">
        <h3>注意力掉线了？</h3>
        <p>点一下即可，不评价自己。越诚实的数据，越能看清你的节律。</p>
      </div>
      <${LiveButton}
        title="我走神了"
        count=${events.filter((event) => event.kind === 'mindWander').length}
        icon="crosshair"
        tint="coral"
        disabled=${breakNow}
        onClick=${() => act('recordMindWander')}
      />
      <${LiveButton}
        title="我开始累了"
        count=${events.filter((event) => event.kind === 'fatigue').length}
        icon="battery-low"
        tint="amber"
        disabled=${breakNow}
        onClick=${() => act('recordFatigue')}
      />
    <//>`;
  }

  function LiveButton({ title, count, icon, tint, disabled, onClick }) {
    return html`<button type="button" class=${cx('live-button', `tint-${tint}`)} disabled=${disabled} onClick=${onClick}>
      <${Icon} name=${icon} size=${17} class="tinted" />
      <span>
        <span class="live-button-title">${title}</span>
        <span class="live-button-count">${count} 次</span>
      </span>
    </button>`;
  }

  function TrainingHint({ ctx }) {
    const recommended = ctx.stats.recommended;
    return html`<${Card} class="hint-card">
      <span class="round-icon tint-blue" style=${{ width: '50px', height: '50px' }}><${Icon} name="sprout" size=${22} /></span>
      <div class="hint-copy">
        <h3>今天的建议：先做 ${recommended} 分钟</h3>
        <p>建议来自最近的完成率、走神点和精力变化。连续三轮状态良好后，只增加 5 分钟。</p>
      </div>
      <${Button} onClick=${() => updateSettings({ selectedDurationMinutes: recommended })}>采用建议<//>
    <//>`;
  }

  function AmbientCard({ ctx }) {
    const { settings, runtime } = ctx;
    const playing = runtime.isAmbientPlaying;
    const selected = settings.ambientSounds;
    const names = selected.map((id) => core.AMBIENT_SOUNDS.find((sound) => sound.id === id).title);
    const status =
      names.length === 0 ? '点选下面的声音即可试听，可以叠加多种一起放。' : `${playing ? '正在播放' : '已选'}：${names.join(' + ')}`;

    return html`<${Card} class="ambient-card">
      <div class="ambient-header">
        <span class=${cx('round-icon tint-mint', playing && 'is-pulsing')} style=${{ width: '42px', height: '42px' }}>
          <${Icon} name="audio-lines" size=${18} />
        </span>
        <div class="ambient-title">
          <h3>环境音</h3>
          <p title=${status}>${status}</p>
        </div>
        <${Toggle}
          class="toggle-small"
          checked=${settings.ambientFollowsFocus}
          title="开始专注时自动播放，暂停、结束或放弃时自动停下"
          onChange=${(value) => updateSettings({ ambientFollowsFocus: value })}
          >随专注播放<//
        >
        <div class="master-volume" title="环境音总音量">
          <${Icon} name="volume-1" size=${13} class="text-secondary" />
          <${Slider}
            label="环境音总音量"
            value=${settings.ambientMasterVolume}
            onInput=${(value) => updateSettings({ ambientMasterVolume: value })}
          />
          <${Icon} name="volume-2" size=${13} class="text-secondary" />
        </div>
        <${Button} icon=${playing ? 'pause' : 'play'} iconFilled class="min-62" onClick=${() => act('toggleAmbientPlayback')}>
          ${playing ? '暂停' : '播放'}
        <//>
      </div>
      <div class="ambient-grid">
        ${core.AMBIENT_SOUNDS.map((sound) => {
          const isSelected = selected.includes(sound.id);
          return html`<div key=${sound.id} class=${cx('ambient-tile', `tint-${sound.tint}`, isSelected && 'is-selected')}>
            <button
              type="button"
              class="ambient-toggle"
              title=${isSelected ? '移出混音' : '加入混音'}
              aria-pressed=${isSelected}
              onClick=${() => act('toggleAmbientSound', sound.id)}
            >
              <span class="ambient-icon"><${Icon} name=${sound.icon} size=${14} /></span>
              <span class="ambient-text">
                <span class="ambient-name">${sound.title}</span>
                <span class="ambient-detail">${sound.detail}</span>
              </span>
              ${isSelected && html`<${Icon} name="circle-check" size=${15} class="tinted ambient-check" />`}
            </button>
            <${Slider}
              label=${`${sound.title}音量`}
              tint=${sound.tint}
              disabled=${!isSelected}
              value=${core.ambientVolume(settings, sound.id)}
              onInput=${(value) => updateSettings({ ambientVolumes: { ...settings.ambientVolumes, [sound.id]: value } })}
            />
          </div>`;
        })}
      </div>
    <//>`;
  }

  // ---- 结束确认与复盘 ----

  function SessionEndDialog({ onContinue, onReview, onAbandon }) {
    return html`<${Modal} onDismiss=${onContinue} class="end-dialog">
      <div class="dialog-head">
        <span class="round-icon tint-mint" style=${{ width: '48px', height: '48px' }}><${Icon} name="leaf-fill" size=${20} /></span>
        <div class="dialog-head-text">
          <h2>如何结束这一轮？</h2>
          <p>你可以保留已经完成的部分，也可以把这次尝试当作没有发生。</p>
        </div>
        <button type="button" class="close-button" title="继续专注" aria-label="继续专注" onClick=${onContinue}>
          <${Icon} name="x" size=${13} stroke=${2.6} />
        </button>
      </div>
      <div class="decision-list">
        <${DecisionButton}
          title="结束并记录"
          detail="进入复盘，保留已经完成的专注时间"
          icon="circle-check"
          tint="mint"
          onClick=${onReview}
        />
        <${DecisionButton}
          title="放弃本轮"
          detail="不保存时间、走神、疲劳和微休息记录"
          icon="trash-2"
          tint="coral"
          onClick=${onAbandon}
        />
      </div>
      <button type="button" class="link-button" onClick=${onContinue}>返回继续专注</button>
    <//>`;
  }

  function DecisionButton({ title, detail, icon, tint, onClick }) {
    return html`<button type="button" class=${cx('decision-button', `tint-${tint}`)} onClick=${onClick}>
      <span class="decision-icon"><${Icon} name=${icon} size=${18} /></span>
      <span class="decision-text">
        <strong>${title}</strong>
        <span>${detail}</span>
      </span>
      <${Icon} name="chevron-right" size=${14} stroke=${2.6} class="tinted" />
    </button>`;
  }

  function ConfirmDialog({ icon = 'trash-2', title, message, confirmLabel, cancelLabel = '取消', onCancel, onConfirm }) {
    return html`<${Modal} onDismiss=${onCancel} class="confirm-dialog">
      <span class="round-icon tint-coral" style=${{ width: '48px', height: '48px' }}><${Icon} name=${icon} size=${19} /></span>
      <div class="confirm-text">
        <h2>${title}</h2>
        <p>${message}</p>
      </div>
      <div class="confirm-actions">
        <${Button} onClick=${onCancel}>${cancelLabel}<//>
        <${Button} variant="danger" icon=${icon} onClick=${onConfirm}>${confirmLabel}<//>
      </div>
    <//>`;
  }

  function CompletionSheet({ ctx }) {
    const { runtime, taskName } = ctx;
    const [focusRating, setFocusRating] = useState(4);
    const [endEnergy, setEndEnergy] = useState(3);
    const [note, setNote] = useState('');
    const [confirmAbandon, setConfirmAbandon] = useState(false);
    const count = (kind) => runtime.currentEvents.filter((event) => event.kind === kind).length;
    const categorized = taskName !== core.UNCATEGORIZED;
    const save = () => act('saveCompletion', { focusRating, endEnergy, note });

    return html`<${Modal} class="completion-sheet">
      <div class="completion-head">
        <div>
          <h2>本轮完成</h2>
          <p>花一分钟复盘，注意力训练才会留下可比较的数据。</p>
          <span class=${cx('task-chip', categorized ? 'tint-blue' : 'tint-muted')}><${Icon} name="tag" size=${11} />${taskName}</span>
        </div>
        <span class="round-icon tint-mint" style=${{ width: '54px', height: '54px' }}><${Icon} name="check" size=${24} stroke=${2.8} /></span>
      </div>
      <div class="summary-boxes">
        <${SummaryBox} value=${Math.floor(runtime.focusedElapsedSeconds / 60)} label="专注分钟" tint="mint" />
        <${SummaryBox} value=${count('mindWander')} label="走神次数" tint="coral" />
        <${SummaryBox} value=${count('reminder')} label="微休息" tint="blue" />
      </div>
      <${RatingRow} title="整体专注程度" value=${focusRating} low="很散" high="很稳" tint="mint" onChange=${setFocusRating} />
      <${RatingRow} title="结束时的精力" value=${endEnergy} low="耗尽" high="充沛" tint="amber" onChange=${setEndEnergy} />
      <label class="note-field">
        <span>一句话记录（可选）</span>
        <input
          class="text-field text-field-large"
          placeholder="例如：30 分钟后开始费力，做题比看课更容易保持注意…"
          value=${note}
          onInput=${(event) => setNote(event.currentTarget.value)}
          onKeyDown=${(event) => event.key === 'Enter' && event.ctrlKey && save()}
        />
      </label>
      ${runtime.musicMessage &&
      html`<div class="music-message"><${Icon} name="music" size=${14} class="text-coral" /><span>${runtime.musicMessage}</span></div>`}
      <div class="completion-actions">
        <span class="completion-footnote">记录感觉，不给今天的自己打分。</span>
        <${Button} variant="ghost-danger" onClick=${() => setConfirmAbandon(true)}>放弃且不保存<//>
        <${Button} variant="primary" onClick=${save}>保存复盘<//>
      </div>
      ${confirmAbandon &&
      html`<${ConfirmDialog}
        title="放弃这轮专注？"
        message="本轮时间和事件不会写入统计或历史记录。"
        cancelLabel="返回复盘"
        confirmLabel="确认放弃"
        onCancel=${() => setConfirmAbandon(false)}
        onConfirm=${() => {
          setConfirmAbandon(false);
          act('abandonSession');
        }}
      />`}
    <//>`;
  }

  function SummaryBox({ value, label, tint }) {
    return html`<div class=${cx('summary-box', `tint-${tint}`)}>
      <span class="summary-value num">${value}</span>
      <span class="summary-label">${label}</span>
    </div>`;
  }

  function RatingRow({ title, value, low, high, tint, onChange }) {
    return html`<div class="rating-row">
      <span class="rating-title">${title}</span>
      <div class=${cx('rating-scale', `tint-${tint}`)} role="radiogroup" aria-label=${title}>
        <span class="rating-end">${low}</span>
        ${[1, 2, 3, 4, 5].map(
          (level) => html`<button
            key=${level}
            type="button"
            role="radio"
            aria-checked=${level === value}
            aria-label=${`${title} ${level} 分`}
            class=${cx('rating-step', level <= value && 'is-on')}
            onClick=${() => onChange(level)}
          ></button>`
        )}
        <span class="rating-end rating-end-high">${high}</span>
      </div>
    </div>`;
  }

  // ---- 洞察页 ----

  function useWidth() {
    const ref = useRef(null);
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
      const element = ref.current;
      if (!element) return undefined;
      const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
      observer.observe(element);
      setWidth(Math.floor(element.getBoundingClientRect().width));
      return () => observer.disconnect();
    }, []);
    return [ref, width];
  }

  function niceScale(maximum, targetTicks = 4) {
    if (maximum <= 0) return { top: 60, step: 20 };
    const raw = maximum / targetTicks;
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    // 分钟只取整数刻度。
    const step = Math.max(1, [1, 2, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw));
    return { top: Math.ceil(maximum / step) * step, step };
  }

  function InsightsPage({ ctx }) {
    const { sessions, stats } = ctx;
    const withTime = sessions.filter((session) => session.focusedSeconds > 0);
    const totalMinutes = core.sum(withTime, core.focusedMinutes);
    const wanderRate = totalMinutes > 0 ? `${((core.sum(withTime, core.mindWanderCount) / totalMinutes) * 60).toFixed(1)} 次/时` : '—';
    const energyDelta =
      withTime.length > 0 ? core.sum(withTime, (session) => session.endEnergy - session.startEnergy) / withTime.length : null;
    const energyText = energyDelta === null ? '—' : `${energyDelta >= 0 ? '+' : ''}${energyDelta.toFixed(1)} 格`;

    return html`<div class="page">
      <header class="page-header">
        <${SectionHeading} eyebrow="Attention Lab" title="看见你的注意力节律" subtitle="用趋势做调整，不用某一次状态定义自己。" />
        <span class="badge">基于最近 ${Math.min(12, sessions.length)} 轮</span>
      </header>
      <div class="insight-metrics">
        <${InsightMetric} icon="brain" value=${`${stats.capacity} 分钟`} label="当前稳定专注估计" footnote="走神前时长的中位估计" tint="mint" />
        <${InsightMetric} icon="trending-up" value=${`${stats.recommended} 分钟`} label="下一轮建议" footnote="连续稳定后每次只加 5 分钟" tint="blue" />
        <${InsightMetric} icon="crosshair" value=${wanderRate} label="平均走神率" footnote="每小时主动记录次数" tint="coral" />
        <${InsightMetric} icon="heart-pulse" value=${energyText} label="平均精力变化" footnote="开始与结束的主观差值" tint="amber" />
      </div>
      <div class="split-row">
        <${WeeklyChart} days=${stats.weekly} />
        <${TrainingPlan} ctx=${ctx} />
      </div>
      <${TaskBreakdown} summaries=${stats.tasks} />
      <div class="split-row">
        <${QualityTrend} sessions=${sessions} />
        <${Interpretation} />
      </div>
    </div>`;
  }

  function InsightMetric({ icon, value, label, footnote, tint }) {
    return html`<${Card} class=${cx('insight-metric', `tint-${tint}`)} padding=${17}>
      <div class="insight-metric-top">
        <${Icon} name=${icon} size=${17} class="tinted" />
        <span class="tint-dot"></span>
      </div>
      <div>
        <div class="insight-metric-value num">${value}</div>
        <div class="insight-metric-label">${label}</div>
      </div>
      <div class="insight-metric-footnote">${footnote}</div>
    <//>`;
  }

  function ChartHeader({ title, subtitle, icon }) {
    return html`<div class="card-title-row">
      <div>
        <h2 class="card-title card-title-small">${title}</h2>
        <p class="card-subtitle">${subtitle}</p>
      </div>
      <${Icon} name=${icon} size=${17} class="text-mint" />
    </div>`;
  }

  function WeeklyChart({ days }) {
    const { top, step } = niceScale(Math.max(...days.map((day) => day.minutes)));
    const ticks = [];
    for (let value = 0; value <= top; value += step) ticks.push(value);
    const today = core.startOfDay(Date.now());
    return html`<${Card} class="chart-card">
      <${ChartHeader} title="最近 7 天" subtitle="净专注分钟" icon="calendar" />
      <div class="bar-chart">
        <div class="bar-grid">
          ${ticks.map(
            (tick) => html`<div key=${tick} class="bar-grid-line" style=${{ bottom: `${(tick / top) * 100}%` }}>
              <span class="num">${tick}</span>
            </div>`
          )}
        </div>
        <div class="bars">
          ${days.map(
            (day) => html`<div key=${day.date} class="bar-column">
              <div
                class=${cx('bar', day.date === today && 'is-today')}
                style=${{ height: `${(day.minutes / top) * 100}%` }}
                title=${`${new Date(day.date).getMonth() + 1}月${new Date(day.date).getDate()}日：${day.minutes} 分钟，${day.sessions} 轮`}
              ></div>
            </div>`
          )}
        </div>
        <div class="bar-labels">
          ${days.map((day) => html`<span key=${day.date} class=${cx(day.date === today && 'is-today')}>${WEEKDAYS[new Date(day.date).getDay()]}</span>`)}
        </div>
      </div>
    <//>`;
  }

  function TrainingPlan({ ctx }) {
    const { stats } = ctx;
    return html`<${Card} strong class="plan-card">
      <${ChartHeader} title="渐进训练" subtitle="下一阶段" icon="trending-up" />
      <div class="plan-ring">
        <${Ring} size=${128} stroke=${12} progress=${Math.min(1, stats.capacity / 120)} tint="mint" />
        <div class="ring-center">
          <span class="plan-value num">${stats.recommended}</span>
          <span class="plan-unit">分钟</span>
        </div>
      </div>
      <ol class="plan-steps">
        <li><span>1</span>先稳定完成建议时长</li>
        <li><span>2</span>连续 3 轮：评分 ≥ 4、走神 ≤ 1</li>
        <li><span>3</span>下一轮增加 5 分钟</li>
      </ol>
      <${Button}
        class="btn-block"
        onClick=${() => {
          updateSettings({ selectedDurationMinutes: stats.recommended });
          ctx.setSection('focus');
        }}
        >把建议用于下一轮<//
      >
    <//>`;
  }

  function TaskBreakdown({ summaries }) {
    const shown = summaries.slice(0, 8);
    const maximum = Math.max(1, ...shown.map((summary) => summary.focusedMinutes));
    return html`<${Card} class="task-card">
      <${ChartHeader} title="任务专注分布" subtitle="按任务汇总全部专注记录；已从任务列表移除的历史任务仍会保留" icon="tag" />
      ${shown.length === 0
        ? html`<div class="empty-inline"><${Icon} name="tag" size=${24} /><span>完成一轮后，这里会出现任务统计</span></div>`
        : html`<div class="task-table">
            <div class="task-table-head">
              <span>任务</span><span>专注占比</span><span>分钟</span><span>轮次</span><span>评分</span>
            </div>
            ${shown.map((summary) => {
              const uncategorized = summary.name === core.UNCATEGORIZED;
              return html`<div key=${summary.name} class=${cx('task-table-row', uncategorized && 'is-muted')}>
                <span class="task-name"><${Icon} name="tag" size=${11} class="task-tag" /><span title=${summary.name}>${summary.name}</span></span>
                <span class="task-bar"><span style=${{ width: `${(summary.focusedMinutes / maximum) * 100}%` }}></span></span>
                <span class="num">${summary.focusedMinutes}</span>
                <span class="num">${summary.sessions}</span>
                <span class="num">${summary.averageFocus.toFixed(1)}</span>
              </div>`;
            })}
            ${summaries.length > shown.length && html`<p class="footnote">仅显示专注分钟最多的前 ${shown.length} 个任务。</p>`}
          </div>`}
    <//>`;
  }

  function smoothPath(points) {
    if (points.length < 2) return '';
    let path = `M${points[0][0]},${points[0][1]}`;
    for (let index = 0; index < points.length - 1; index += 1) {
      const [x0, y0] = points[index - 1] || points[index];
      const [x1, y1] = points[index];
      const [x2, y2] = points[index + 1];
      const [x3, y3] = points[index + 2] || points[index + 1];
      const c1 = [x1 + (x2 - x0) / 6, y1 + (y2 - y0) / 6];
      const c2 = [x2 - (x3 - x1) / 6, y2 - (y3 - y1) / 6];
      path += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${x2},${y2}`;
    }
    return path;
  }

  function QualityTrend({ sessions }) {
    const values = sessions.slice(0, 10).reverse();
    const [ref, width] = useWidth();
    const height = 180;
    const left = 26;
    const right = 12;
    const top = 10;
    const bottom = 26;
    const plotWidth = Math.max(0, width - left - right);
    const plotHeight = height - top - bottom;
    const x = (index) => left + (values.length === 1 ? plotWidth / 2 : (index / (values.length - 1)) * plotWidth);
    const y = (rating) => top + ((5 - rating) / 4) * plotHeight;
    const points = values.map((session, index) => [x(index), y(core.clamp(session.focusRating, 1, 5))]);

    return html`<${Card} class="chart-card">
      <${ChartHeader} title="专注质量趋势" subtitle="每轮复盘评分（1–5）" icon="activity" />
      ${values.length === 0
        ? html`<div class="empty-inline empty-chart"><${Icon} name="chart-line" size=${25} /><span>完成第一轮后，这里会出现趋势</span></div>`
        : html`<div class="line-chart" ref=${ref}>
            ${width > 0 &&
            html`<svg width=${width} height=${height} viewBox="0 0 ${width} ${height}" role="img" aria-label="最近 ${values.length} 轮的专注评分">
              ${[1, 2, 3, 4, 5].map(
                (rating) => html`<g key=${rating}>
                  <line class="grid-line" x1=${left} x2=${width - right} y1=${y(rating)} y2=${y(rating)} />
                  <text class="axis-label" x=${left - 10} y=${y(rating)} text-anchor="end" dominant-baseline="middle">${rating}</text>
                </g>`
              )}
              ${values.map(
                (_session, index) =>
                  html`<text key=${index} class="axis-label" x=${x(index)} y=${height - 6} text-anchor="middle">${index + 1}</text>`
              )}
              <path class="trend-line" d=${smoothPath(points)} />
              ${points.map(
                ([px, py], index) => html`<circle key=${index} class="trend-point" cx=${px} cy=${py} r="4">
                  <title>第 ${index + 1} 轮：${values[index].focusRating} 分</title>
                </circle>`
              )}
            </svg>`}
          </div>`}
    <//>`;
  }

  function Interpretation() {
    const rows = [
      ['mint', '稳定区', '评分稳定、走神率下降、结束时仍有余力。可以小幅增加时长。'],
      ['amber', '训练边缘', '后半程更费力，但仍能完成且次日状态正常。先保持，不急着加量。'],
      ['coral', '恢复信号', '走神突然变多、精力连续下降或烦躁，优先检查睡眠、压力与任务难度。']
    ];
    return html`<${Card} class="interpret-card">
      <${ChartHeader} title="怎么读这些数据" subtitle="重要的不是越久越好" icon="text-search" />
      ${rows.map(
        ([tint, title, text]) => html`<div key=${title} class=${cx('interpret-row', `tint-${tint}`)}>
          <span class="interpret-bar"></span>
          <div>
            <strong>${title}</strong>
            <p>${text}</p>
          </div>
        </div>`
      )}
      <p class="footnote">这里是个人训练记录，不是医学诊断。若注意力变化持续影响生活，值得咨询专业人士。</p>
    <//>`;
  }

  // ---- 记录页 ----

  function HistoryPage({ ctx }) {
    const { sessions } = ctx;
    const [pendingDelete, setPendingDelete] = useState(null);
    const average = sessions.length ? core.sum(sessions, (session) => session.focusRating) / sessions.length : 0;

    return html`<div class="page">
      <header class="page-header">
        <${SectionHeading} eyebrow="Focus Journal" title="每一轮，都是一条线索" subtitle="记录不是监督，而是帮你找到更适合自己的节律。" />
        <${Button} icon="share" onClick=${() => act('exportCSV')}>导出 CSV<//>
      </header>
      ${sessions.length === 0
        ? html`<${Card} class="empty-state">
            <span class="round-icon tint-mint" style=${{ width: '76px', height: '76px' }}><${Icon} name="leaf" size=${30} /></span>
            <h2>还没有专注记录</h2>
            <p>完成第一轮后，时长、走神、精力和复盘会出现在这里。</p>
            <${Button} variant="primary" onClick=${() => ctx.setSection('focus')}>去开始第一轮<//>
          <//>`
        : html`<div class="history-metrics">
              <${HistoryMetric} icon="layout-grid" value=${sessions.length} label="总轮次" />
              <${HistoryMetric} icon="clock" value=${core.sum(sessions, core.focusedMinutes)} label="累计分钟" />
              <${HistoryMetric} icon="sparkles" value=${average.toFixed(1)} label="平均专注评分" />
            </div>
            <div class="session-list">
              ${sessions.map((session) => html`<${SessionRow} key=${session.id} session=${session} onDelete=${() => setPendingDelete(session)} />`)}
            </div>`}
      ${pendingDelete &&
      html`<${ConfirmDialog}
        title="删除这条专注记录？"
        message="删除后无法恢复。"
        confirmLabel="删除"
        onCancel=${() => setPendingDelete(null)}
        onConfirm=${() => {
          act('removeSession', pendingDelete.id);
          setPendingDelete(null);
        }}
      />`}
    </div>`;
  }

  function HistoryMetric({ icon, value, label }) {
    return html`<${Card} class="history-metric" padding=${15}>
      <span class="round-icon tint-mint" style=${{ width: '38px', height: '38px' }}><${Icon} name=${icon} size=${16} /></span>
      <span>
        <span class="history-metric-value num">${value}</span>
        <span class="history-metric-label">${label}</span>
      </span>
    <//>`;
  }

  function SessionRow({ session, onDelete }) {
    const date = new Date(session.startedAt);
    const task = core.displayTaskName(session);
    return html`<article class="session-row" onContextMenu=${(event) => {
      event.preventDefault();
      onDelete();
    }}>
      <div class="session-date">
        <span class="session-day num">${pad(date.getDate())}</span>
        <span class="session-month">${date.getMonth() + 1}月</span>
      </div>
      <span class=${cx('session-bar', session.completed ? 'tint-mint' : 'tint-amber')}></span>
      <div class="session-main">
        <div class="session-title">
          <strong>${core.focusedMinutes(session)} 分钟专注</strong>
          <span class=${cx('task-chip', task === core.UNCATEGORIZED ? 'tint-muted' : 'tint-blue')} title=${task}>
            <${Icon} name="tag" size=${10} /><span>${task}</span>
          </span>
          <span class=${cx('status-chip', session.completed ? 'tint-mint' : 'tint-amber')}>${session.completed ? '已完成' : '提前结束'}</span>
        </div>
        <p class="session-note" title=${session.note}>${session.note || '没有写本轮备注'}</p>
      </div>
      <${SessionMetric} value=${`${session.focusRating}/5`} label="专注" />
      <${SessionMetric} value=${core.mindWanderCount(session)} label="走神" />
      <${SessionMetric} value=${`${session.startEnergy}→${session.endEnergy}`} label="精力" />
      <${SessionMetric} value=${`${session.reminderMinimumMinutes}–${session.reminderMaximumMinutes}`} label="提示/分" />
      <span class="session-time num">${pad(date.getHours())}:${pad(date.getMinutes())}</span>
      <button type="button" class="session-delete" title="删除这条记录" aria-label="删除这条记录" onClick=${onDelete}>
        <${Icon} name="trash-2" size=${14} />
      </button>
    </article>`;
  }

  function SessionMetric({ value, label }) {
    return html`<div class="session-metric">
      <strong class="num">${value}</strong>
      <span>${label}</span>
    </div>`;
  }

  // ---- 设置页 ----

  function SettingsPage({ ctx }) {
    const [confirmClear, setConfirmClear] = useState(false);
    return html`<div class="page">
      <${SectionHeading} eyebrow="Preferences" title="让工具适应你" subtitle="这些是每一轮开始时使用的默认值，开始后不会改变当前轮次。" />
      <div class="settings-grid">
        <div class="settings-column">
          <${ReminderSettings} ctx=${ctx} />
          <${MusicSettings} ctx=${ctx} />
        </div>
        <div class="settings-column settings-column-narrow">
          <${SessionSettings} ctx=${ctx} />
          <${TaskSettings} ctx=${ctx} />
          <${DataSettings} ctx=${ctx} onClear=${() => setConfirmClear(true)} />
          <${UpdateSettings} ctx=${ctx} />
          <${Card} strong class="philosophy-card" padding=${18}>
            <${Icon} name="quote" size=${17} class="text-mint" />
            <p>训练注意力，不是逼自己忽略疲劳；是更早发现疲劳、更准确地选择继续或休息。</p>
            <span>专注芽 · 本地优先 · 无账号 · v${ctx.meta.version}</span>
          <//>
        </div>
      </div>
      ${confirmClear &&
      html`<${ConfirmDialog}
        title="清空全部专注记录？"
        message="此操作无法撤销。建议先导出 CSV 备份。"
        confirmLabel="永久清空"
        onCancel=${() => setConfirmClear(false)}
        onConfirm=${() => {
          setConfirmClear(false);
          act('clearHistory');
        }}
      />`}
    </div>`;
  }

  function SettingsCard({ title, subtitle, icon, children }) {
    return html`<${Card} class="settings-card" padding=${19}>
      <div class="card-title-row">
        <div>
          <h2 class="card-title card-title-small">${title}</h2>
          <p class="card-subtitle">${subtitle}</p>
        </div>
        <${Icon} name=${icon} size=${17} class="text-mint" />
      </div>
      <div class="hairline"></div>
      ${children}
    <//>`;
  }

  function SettingRow({ title, detail, children }) {
    return html`<div class="setting-row">
      <div class="setting-text">
        <strong>${title}</strong>
        <span>${detail}</span>
      </div>
      <div class="setting-accessory">${children}</div>
    </div>`;
  }

  function ValueStepper({ text, value, min, max, onChange, label }) {
    return html`<span class="value-stepper">
      <span class="num">${text}</span>
      <${Stepper} label=${label} value=${value} min=${min} max=${max} onChange=${onChange} />
    </span>`;
  }

  function SoundPicker({ value, options, onChange }) {
    return html`<span class="sound-picker">
      <select class="select" value=${value} aria-label="选择提示音" onChange=${(event) => onChange(event.currentTarget.value)}>
        ${options.map((option) => html`<option key=${option} value=${option}>${core.SOUND_LABELS[option] || option}</option>`)}
      </select>
      <button type="button" class="icon-button icon-button-plain" title="试听" aria-label="试听" onClick=${() => act('playSound', value)}>
        <${Icon} name="volume-2" size=${16} />
      </button>
    </span>`;
  }

  function ReminderSettings({ ctx }) {
    const { settings } = ctx;
    return html`<${SettingsCard} title="随机提示" subtitle="控制微休息出现的节律" icon="bell-ring">
      <${SettingRow} title="最早响起" detail="每次提示后重新随机">
        <${ValueStepper}
          label="最早响起"
          text=${`${settings.reminderMinimumMinutes} 分钟`}
          value=${settings.reminderMinimumMinutes}
          min=${1}
          max=${60}
          onChange=${(value) => updateSettings({ reminderMinimumMinutes: value })}
        />
      <//>
      <${SettingRow} title="最晚响起" detail="必须晚于或等于最早时间">
        <${ValueStepper}
          label="最晚响起"
          text=${`${settings.reminderMaximumMinutes} 分钟`}
          value=${settings.reminderMaximumMinutes}
          min=${Math.max(1, settings.reminderMinimumMinutes)}
          max=${90}
          onChange=${(value) => updateSettings({ reminderMaximumMinutes: value })}
        />
      <//>
      <${SettingRow} title="微休息长度" detail="建议闭眼、松肩，不碰手机">
        <${ValueStepper}
          label="微休息长度"
          text=${`${settings.microBreakSeconds} 秒`}
          value=${settings.microBreakSeconds}
          min=${5}
          max=${60}
          onChange=${(value) => updateSettings({ microBreakSeconds: value })}
        />
      <//>
      <${SettingRow} title="提示音" detail="短促但不刺耳">
        <${SoundPicker}
          value=${settings.reminderSound}
          options=${core.REMINDER_SOUND_OPTIONS}
          onChange=${(value) => updateSettings({ reminderSound: value })}
        />
      <//>
      <${Toggle} class="toggle-row" checked=${settings.showNextReminder} onChange=${(value) => updateSettings({ showNextReminder: value })}>
        显示下一次提示的倒计时
      <//>
    <//>`;
  }

  function MusicSettings({ ctx }) {
    const { settings, runtime } = ctx;
    const player = core.musicPlayer(settings.musicPlayer);
    const message = runtime.musicMessage;
    return html`<${SettingsCard} title="结束音乐" subtitle="一轮结束后，用音乐切换状态" icon=${player.id === 'netease' ? 'cloud' : 'music'}>
      <${Toggle} class="toggle-row toggle-strong" checked=${settings.autoPlayMusic} onChange=${(value) => updateSettings({ autoPlayMusic: value })}>
        结束后自动播放下一首
      <//>
      ${settings.autoPlayMusic &&
      html`<${SettingRow} title="播放器" detail="选择专注结束时控制的播放器">
          <select
            class="select select-wide"
            aria-label="播放器"
            value=${player.id}
            onChange=${(event) => updateSettings({ musicPlayer: event.currentTarget.value })}
          >
            ${core.MUSIC_PLAYERS.map((option) => html`<option key=${option.id} value=${option.id}>${option.title}</option>`)}
          </select>
        <//>
        <p class="setting-note">
          ${player.id === 'any'
            ? '专注结束时，让正在使用的播放器切到下一首并开始播放。'
            : `专注结束时，${player.title}会切到播放列表的下一首并从头播放；把它的播放模式设为“随机播放”，就是每次随机换一首。播放器没打开时会先在后台启动它。`}
          已在播放时不会打断。
        </p>
        <div class="music-test">
          <div>
            <strong>需要播放器支持 Windows 媒体控制</strong>
            <span>调节音量时，系统浮窗里能看到歌曲名就可以。</span>
          </div>
          <${Button} onClick=${() => act('testMusic')}>测试播放<//>
        </div>
        ${message && html`<p class=${cx('music-status', message.includes('失败') ? 'text-coral' : 'text-mint')}>${message}</p>`}`}
    <//>`;
  }

  function SessionSettings({ ctx }) {
    const { settings } = ctx;
    return html`<${SettingsCard} title="专注轮次" subtitle="默认时长与结束反馈" icon="timer">
      <${SettingRow} title="默认时长" detail="仍可在专注页快速选择">
        <span class="duration-setting">
          <${NumberField}
            class="number-field-boxed"
            label="默认时长"
            value=${settings.selectedDurationMinutes}
            min=${1}
            max=${1440}
            onCommit=${(value) => updateSettings({ selectedDurationMinutes: value })}
          />
          <span class="unit">分钟</span>
          <${Stepper}
            label="默认时长"
            value=${settings.selectedDurationMinutes}
            min=${1}
            max=${1440}
            onChange=${(value) => updateSettings({ selectedDurationMinutes: value })}
          />
        </span>
      <//>
      <${SettingRow} title="结束提示音" detail="音乐开始前的完成信号">
        <${SoundPicker}
          value=${settings.completionSound}
          options=${core.COMPLETION_SOUND_OPTIONS}
          onChange=${(value) => updateSettings({ completionSound: value })}
        />
      <//>
      <div class="hairline"></div>
      <${Toggle}
        class="toggle-row"
        checked=${settings.floatingTimerOnMinimize}
        onChange=${(value) => updateSettings({ floatingTimerOnMinimize: value })}
      >
        <span class="toggle-copy">
          <strong>最小化时悬浮倒计时</strong>
          <span>仅在计时中显示；可拖动，恢复主窗口后自动隐藏</span>
        </span>
      <//>
      <${Toggle}
        class="toggle-row"
        checked=${settings.floatingSignalButtons}
        onChange=${(value) => updateSettings({ floatingSignalButtons: value })}
      >
        <span class="toggle-copy">
          <strong>最小化时悬浮状态按钮</strong>
          <span>可单独显示“我走神了”和“我开始累了”，无需倒计时</span>
        </span>
      <//>
      <${Toggle} class="toggle-row" checked=${settings.closeToTray} onChange=${(value) => updateSettings({ closeToTray: value })}>
        <span class="toggle-copy">
          <strong>关闭窗口时留在托盘</strong>
          <span>计时继续进行，可以在任务栏右下角的图标里快速记录</span>
        </span>
      <//>
    <//>`;
  }

  function TaskSettings({ ctx }) {
    const { settings, sessions, active } = ctx;
    const [name, setName] = useState('');
    const add = async () => {
      if (!name.trim() || active) return;
      if (await act('addTask', name)) setName('');
    };
    const counts = useMemo(() => {
      const map = new Map();
      for (const session of sessions) {
        const task = core.displayTaskName(session);
        map.set(task, (map.get(task) || 0) + 1);
      }
      return map;
    }, [sessions]);

    return html`<${SettingsCard} title="任务管理" subtitle="用于每轮选择与分类统计" icon="tag">
      <div class="task-creator">
        <input
          class="text-field"
          placeholder="新增任务名称"
          maxlength="40"
          disabled=${active}
          value=${name}
          onInput=${(event) => setName(event.currentTarget.value)}
          onKeyDown=${(event) => event.key === 'Enter' && add()}
        />
        <button type="button" class="icon-button" aria-label="新增任务" disabled=${active || !name.trim()} onClick=${add}>
          <${Icon} name="plus" size=${14} stroke=${2.4} />
        </button>
      </div>
      ${settings.taskNames.length === 0
        ? html`<div class="task-empty"><${Icon} name="tag" size=${14} /><span>还没有自定义任务，可在这里或专注页新增。</span></div>`
        : html`<div class="task-list">
            ${settings.taskNames.map(
              (task) => html`<div key=${task} class="task-item">
                <${Icon} name="tag" size=${12} class="text-mint" />
                <span class="task-item-name" title=${task}>${task}</span>
                ${settings.selectedTaskName === task && html`<span class="current-chip">当前</span>`}
                <span class="task-item-count">${counts.get(task) || 0} 轮</span>
                <button
                  type="button"
                  class="close-button close-button-small"
                  title="从任务列表移除；历史记录仍保留"
                  aria-label=${`移除任务 ${task}`}
                  onClick=${() => act('removeTask', task)}
                >
                  <${Icon} name="x" size=${11} stroke=${2.6} />
                </button>
              </div>`
            )}
          </div>`}
      <p class="footnote">移除任务不会删除已经归档的专注记录和统计。</p>
    <//>`;
  }

  function DataSettings({ ctx, onClear }) {
    return html`<${SettingsCard} title="数据" subtitle="全部记录只保存在这台电脑" icon="hard-drive">
      <${Button} class="btn-row" icon="share" onClick=${() => act('exportCSV')}>
        导出全部记录<span class="btn-tag">CSV</span>
      <//>
      <${Button} class="btn-row" icon="hard-drive" onClick=${() => window.bloom.command('open-data-folder')}>
        打开数据文件夹
      <//>
      <${Button} class="btn-row btn-danger-text" icon="trash-2" disabled=${ctx.sessions.length === 0} onClick=${onClear}>
        清空专注记录
      <//>
      <p class="footnote data-path" title=${ctx.meta.dataFile}>${ctx.meta.dataFile}</p>
    <//>`;
  }

  function updateStatusText(update, settings) {
    switch (update.status) {
      case 'checking':
        return '正在检查新版本…';
      case 'latest':
        return '已是最新版本';
      case 'downloading':
        return `正在下载 v${update.version}（${update.percent}%）`;
      case 'downloaded':
        return `v${update.version} 已下载，重启即可更新`;
      case 'available':
        return `发现新版本 v${update.version}`;
      case 'error':
        return update.message;
      case 'unsupported':
        return '开发版不检查更新';
      default:
        return settings.autoCheckUpdates ? '启动后会自动检查' : '自动检查已关闭';
    }
  }

  function UpdateSettings({ ctx }) {
    const { settings, active } = ctx;
    const update = ctx.update || { status: 'unsupported' };
    const { status } = update;
    const busy = status === 'checking' || status === 'downloading';
    let action;
    if (status === 'downloaded') {
      action = html`<${Button} variant="primary" class="btn-compact btn-block" icon="refresh-cw" disabled=${active} onClick=${() => window.bloom.command('install-update')}>
        重启并更新到 v${update.version}
      <//>`;
    } else if (status === 'available') {
      action = html`<${Button} variant="primary" class="btn-compact btn-block" icon="circle-arrow-down" onClick=${() => window.bloom.command('open-download-page')}>
        前往下载 v${update.version}
      <//>`;
    } else {
      action = html`<${Button} class="btn-row" icon="refresh-cw" disabled=${busy || status === 'unsupported'} onClick=${() => window.bloom.command('check-update')}>
        ${busy ? '正在检查…' : '检查更新'}
      <//>`;
    }
    return html`<${SettingsCard} title="软件更新" subtitle="新版本会从 GitHub Release 下载" icon="circle-arrow-down">
      <${SettingRow} title=${`当前版本 v${ctx.meta.version}`} detail=${updateStatusText(update, settings)} />
      <${Toggle} class="toggle-row" checked=${settings.autoCheckUpdates} onChange=${(value) => updateSettings({ autoCheckUpdates: value })}>
        <span class="toggle-copy">
          <strong>自动检查更新</strong>
          <span>${update.canInstall === false ? '发现新版本时提醒你下载' : '有新版本时在后台下载，退出专注芽时自动安装'}</span>
        </span>
      <//>
      ${action}
      ${status === 'downloaded' && active && html`<p class="footnote">专注结束后再更新，不会打断这一轮。</p>`}
    <//>`;
  }

  BloomClient.ready.then(() => render(html`<${App} />`, document.getElementById('app')));
})();
