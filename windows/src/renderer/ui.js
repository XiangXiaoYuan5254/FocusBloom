// 主窗口和悬浮窗共用的界面零件，对应 macOS 版 Theme.swift 里的按钮样式、卡片和指标组件。
(function () {
  const { h } = preact;
  const { useEffect, useState } = preactHooks;
  const html = htm.bind(h);

  // 实心版本，对应 SF Symbols 的 leaf.fill / flame.fill。
  window.BloomIcons['leaf-fill'] = window.BloomIcons.leaf.replace('<path ', '<path fill="currentColor" ');
  window.BloomIcons['flame-fill'] = window.BloomIcons.flame.replace('<path ', '<path fill="currentColor" ');

  function cx(...names) {
    return names.filter(Boolean).join(' ');
  }

  function Icon({ name, size = 16, stroke = 2, filled = false, class: className }) {
    return html`<svg
      class=${cx('icon', className)}
      width=${size}
      height=${size}
      viewBox="0 0 24 24"
      fill=${filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      stroke-width=${stroke}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML=${{ __html: window.BloomIcons[name] || '' }}
    />`;
  }

  function Button({ variant = 'secondary', icon, iconFilled, children, class: className, ...props }) {
    return html`<button type="button" class=${cx('btn', `btn-${variant}`, className)} ...${props}>
      ${icon && html`<${Icon} name=${icon} size=${14} filled=${iconFilled} />`}
      ${children != null && html`<span>${children}</span>`}
    </button>`;
  }

  function Toggle({ checked, onChange, disabled, children, title, class: className }) {
    return html`<label class=${cx('toggle', disabled && 'is-disabled', className)} title=${title}>
      ${children && html`<span class="toggle-label">${children}</span>`}
      <input
        type="checkbox"
        role="switch"
        checked=${checked}
        disabled=${disabled}
        onChange=${(event) => onChange(event.currentTarget.checked)}
      />
      <span class="toggle-track"><span class="toggle-thumb"></span></span>
    </label>`;
  }

  function Stepper({ value, min, max, step = 1, onChange, disabled, label }) {
    const set = (next) => onChange(Math.min(max, Math.max(min, next)));
    return html`<span class=${cx('stepper', disabled && 'is-disabled')}>
      <button type="button" aria-label=${`减少${label || ''}`} disabled=${disabled || value <= min} onClick=${() => set(value - step)}>
        <${Icon} name="minus" size=${12} stroke=${2.4} />
      </button>
      <button type="button" aria-label=${`增加${label || ''}`} disabled=${disabled || value >= max} onClick=${() => set(value + step)}>
        <${Icon} name="plus" size=${12} stroke=${2.4} />
      </button>
    </span>`;
  }

  /// 可以直接输入的整数框：输入时不打扰，回车或离开时才提交并校正范围。
  function NumberField({ value, min, max, onCommit, disabled, class: className, label }) {
    const [draft, setDraft] = useState(null);
    useEffect(() => setDraft(null), [value]);
    const commit = () => {
      if (draft === null) return;
      const number = parseInt(draft, 10);
      setDraft(null);
      if (Number.isFinite(number)) onCommit(Math.min(max, Math.max(min, number)));
    };
    return html`<input
      class=${cx('number-field', className)}
      inputmode="numeric"
      aria-label=${label}
      disabled=${disabled}
      value=${draft ?? String(value)}
      onInput=${(event) => setDraft(event.currentTarget.value.replace(/[^\d]/g, ''))}
      onBlur=${commit}
      onKeyDown=${(event) => {
        if (event.key === 'Enter') {
          commit();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          setDraft(null);
          event.currentTarget.blur();
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          const base = parseInt(draft ?? value, 10) || value;
          onCommit(Math.min(max, Math.max(min, base + (event.key === 'ArrowUp' ? 1 : -1))));
          setDraft(null);
        }
      }}
    />`;
  }

  function Slider({ value, onInput, disabled, tint = 'mint', class: className, label }) {
    const percent = Math.round(value * 100);
    return html`<input
      type="range"
      class=${cx('slider', `tint-${tint}`, className)}
      min="0"
      max="1"
      step="0.01"
      aria-label=${label}
      disabled=${disabled}
      value=${value}
      style=${{ '--fill': `${percent}%` }}
      onInput=${(event) => onInput(Number(event.currentTarget.value))}
    />`;
  }

  function SectionHeading({ eyebrow, title, subtitle }) {
    return html`<div class="section-heading">
      <div class="eyebrow">${eyebrow}</div>
      <h1>${title}</h1>
      ${subtitle && html`<p>${subtitle}</p>`}
    </div>`;
  }

  function MetricPill({ icon, value, label, tint = 'mint' }) {
    return html`<div class=${cx('metric-pill', `tint-${tint}`)}>
      <span class="metric-pill-icon"><${Icon} name=${icon} size=${14} /></span>
      <span>
        <span class="metric-pill-value">${value}</span>
        <span class="metric-pill-label">${label}</span>
      </span>
    </div>`;
  }

  function Card({ strong, padding, class: className, children, ...props }) {
    return html`<section class=${cx('card', strong && 'card-strong', className)} style=${padding ? { padding: `${padding}px` } : undefined} ...${props}>
      ${children}
    </section>`;
  }

  function Modal({ onDismiss, children, class: className }) {
    useEffect(() => {
      const onKey = (event) => {
        if (event.key === 'Escape' && onDismiss) onDismiss();
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [onDismiss]);
    return html`<div class="modal-layer">
      <div class="modal-backdrop" onClick=${onDismiss}></div>
      <div class=${cx('modal', className)} role="dialog" aria-modal="true">${children}</div>
    </div>`;
  }

  window.BloomUI = { html, cx, Icon, Button, Toggle, Stepper, NumberField, Slider, SectionHeading, MetricPill, Card, Modal };
})();
