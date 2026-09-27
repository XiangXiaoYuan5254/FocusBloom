// 主窗口最小化或关到托盘后的悬浮倒计时，对应 macOS 版的 FloatingTimerView.swift。
// 整块卡片都可以拖动；显示哪些部分由设置里的两个开关决定，窗口尺寸由主进程配合调整。
(function () {
  const { html, cx, Icon } = BloomUI;
  const { render } = preact;
  const { useEffect } = preactHooks;
  const core = FocusCore;
  const { useBloom, act } = BloomClient;

  function FloatingTimer() {
    const { ready, settings, runtime } = useBloom();

    useEffect(() => {
      if (settings) document.documentElement.dataset.theme = settings.appearanceMode;
    }, [settings && settings.appearanceMode]);

    if (!ready) return null;
    const phase = runtime.phase;
    const showsTimer = settings.floatingTimerOnMinimize;
    const showsSignals = settings.floatingSignalButtons;
    const tint = { microBreak: 'blue', paused: 'amber' }[phase] || 'mint';
    const status = { microBreak: '微休息', paused: '已暂停' }[phase] || '专注中';
    const icon = { microBreak: 'sparkles', paused: 'pause' }[phase] || 'leaf-fill';
    const timerText = phase === 'microBreak' ? `${runtime.breakRemainingSeconds} 秒` : core.formatClock(runtime.remainingSeconds);
    const progress = phase === 'microBreak' ? 1 : Math.max(0.02, core.progress(runtime));
    const radius = 22;
    const circumference = 2 * Math.PI * radius;
    const count = (kind) => runtime.currentEvents.filter((event) => event.kind === kind).length;
    const breakNow = phase === 'microBreak';

    return html`<div class=${cx('floating-card', `tint-${tint}`, showsTimer ? 'has-timer' : 'signals-only')}>
      ${showsTimer &&
      html`<div class="floating-timer">
        <div class="floating-ring">
          <svg width="49" height="49" viewBox="0 0 49 49" aria-hidden="true">
            <circle class="ring-track" cx="24.5" cy="24.5" r=${radius} stroke-width="5" />
            <circle
              class="ring-progress tinted-stroke"
              cx="24.5"
              cy="24.5"
              r=${radius}
              stroke-width="5"
              stroke-dasharray=${circumference}
              stroke-dashoffset=${circumference * (1 - progress)}
              transform="rotate(-90 24.5 24.5)"
            />
          </svg>
          <span class="floating-ring-icon tinted"><${Icon} name=${icon} size=${15} filled=${phase === 'paused'} /></span>
        </div>
        <div class="floating-status">
          <span class="floating-label"><span class="tint-dot"></span>${status}</span>
          <span class="floating-time num">${timerText}</span>
        </div>
        <div class="floating-buttons">
          ${(phase === 'focusing' || phase === 'paused') &&
          html`<button
            type="button"
            class="floating-button"
            title=${phase === 'paused' ? '继续' : '暂停'}
            aria-label=${phase === 'paused' ? '继续' : '暂停'}
            onClick=${() => act('togglePause')}
          >
            <${Icon} name=${phase === 'paused' ? 'play' : 'pause'} size=${12} filled stroke=${2.4} />
          </button>`}
          ${breakNow &&
          html`<button type="button" class="floating-button" title="提前继续" aria-label="提前继续" onClick=${() => act('skipMicroBreak')}>
            <${Icon} name="arrow-right" size=${12} stroke=${2.6} />
          </button>`}
          <button
            type="button"
            class="floating-button"
            title="返回主窗口"
            aria-label="返回主窗口"
            onClick=${() => window.bloom.command('restore-main')}
          >
            <${Icon} name="maximize-2" size=${12} stroke=${2.6} />
          </button>
        </div>
      </div>`}
      ${showsTimer && showsSignals && html`<div class="floating-divider"></div>`}
      ${showsSignals &&
      html`<div class="floating-signals">
        <${SignalButton} title="我走神了" icon="crosshair" tint="coral" count=${count('mindWander')} disabled=${breakNow} onClick=${() => act('recordMindWander')} />
        <${SignalButton} title="我开始累了" icon="battery-low" tint="amber" count=${count('fatigue')} disabled=${breakNow} onClick=${() => act('recordFatigue')} />
      </div>`}
    </div>`;
  }

  function SignalButton({ title, icon, tint, count, disabled, onClick }) {
    return html`<button
      type="button"
      class=${cx('signal-button', `tint-${tint}`)}
      title=${`${title}，本轮已记录 ${count} 次`}
      disabled=${disabled}
      onClick=${onClick}
    >
      <${Icon} name=${icon} size=${13} class="tinted" />
      <span class="signal-title">${title}</span>
      <span class="signal-count num tinted">${count}</span>
    </button>`;
  }

  BloomClient.ready.then(() => render(html`<${FloatingTimer} />`, document.getElementById('app')));
})();
