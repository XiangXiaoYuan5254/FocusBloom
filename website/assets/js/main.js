/* =========================================================
   站点配置：发布新版本时只需要改这里
   ========================================================= */
const SITE = {
  version: 'v1.1.0',
  requirement: 'macOS 14+ · Apple 芯片',
  format: '.zip',
  // 官网直链：把打包好的 zip 放到 website/downloads/ 下即可；
  // 也可以换成 CDN / 对象存储地址。
  downloadUrl: 'downloads/FocusBloom-macOS.zip',
  repo: 'https://github.com/XiangXiaoYuan5254/FocusBloom',
  // 官网直链不可用时（例如还没上传 zip），自动改用 GitHub 最新 Release 里的同名文件
  fallbackAsset: 'FocusBloom-macOS.zip',
};

const LINKS = {
  download: SITE.downloadUrl,
  github: SITE.repo,
  releases: `${SITE.repo}/releases/latest`,
  issues: `${SITE.repo}/issues`,
  credits: `${SITE.repo}/blob/main/Resources/Ambient/CREDITS.md`,
};

const TEXTS = {
  version: SITE.version,
  requirement: SITE.requirement,
  format: SITE.format,
  year: String(new Date().getFullYear()),
};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);
const pad = (n) => String(n).padStart(2, '0');

/* ---------- 链接与文案 ---------- */

function applyConfig() {
  $$('[data-link]').forEach((el) => {
    const href = LINKS[el.dataset.link];
    if (href) el.setAttribute('href', href);
  });
  $$('[data-text]').forEach((el) => {
    const text = TEXTS[el.dataset.text];
    if (text) el.textContent = text;
  });
  $$('[data-link="download"]').forEach((el) => {
    const name = SITE.downloadUrl.split('/').pop();
    if (name) el.setAttribute('download', name);
  });
  checkDownload();
}

function checkDownload() {
  const fallback = `${SITE.repo}/releases/latest/download/${SITE.fallbackAsset}`;
  const useFallback = () => $$('[data-link="download"]').forEach((el) => el.setAttribute('href', fallback));
  if (location.protocol === 'file:') { useFallback(); return; }
  fetch(SITE.downloadUrl, { method: 'HEAD', cache: 'no-store' })
    .then((r) => { if (!r.ok) useFallback(); })
    .catch(useFallback);
}

/* ---------- 导航 ---------- */

function initNav() {
  const nav = $('#nav');
  const update = () => nav.classList.toggle('scrolled', window.scrollY > 12);
  update();
  window.addEventListener('scroll', update, { passive: true });
}

/* ---------- 进场动画 ---------- */

function initReveal() {
  const items = $$('[data-reveal]');
  if (!('IntersectionObserver' in window) || reduceMotion) {
    items.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  items.forEach((el) => io.observe(el));
}

/* ---------- 首屏 App 界面：缩放、倾斜、实时倒计时 ---------- */

function initMock() {
  const mock = $('#mock');
  const tilt = $('#stageTilt');
  if (!mock || !tilt) return;

  const DESIGN_W = 1200;
  const DESIGN_H = 790;
  const zoomSupported = CSS.supports('zoom', '0.5');

  const fit = () => {
    const s = Math.min(1, tilt.clientWidth / DESIGN_W);
    if (zoomSupported) {
      mock.style.zoom = s;
    } else {
      mock.style.transformOrigin = '0 0';
      mock.style.transform = `scale(${s})`;
      tilt.style.height = `${DESIGN_H * s}px`;
    }
  };
  fit();
  new ResizeObserver(fit).observe(tilt);
  requestAnimationFrame(() => mock.classList.add('ready'));

  // 滚动时从倾斜过渡到平视
  if (!reduceMotion) {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const rect = tilt.getBoundingClientRect();
        const vh = window.innerHeight;
        const p = clamp((vh - rect.top) / (vh * 0.85), 0, 1);
        tilt.style.setProperty('--tilt', `${(1 - p) * 16}deg`);
        ticking = false;
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
  }

  // —— 模拟一轮专注：倒计时 → 随机提示 → 10 秒微休息 → 继续 ——
  const el = {
    time: $('#mockTime'),
    caption: $('#mockCaption'),
    title: $('#mockTitle'),
    ring: $('#ringBar'),
    flRing: $('#flBar'),
    flTime: $('#flTime'),
    flStatus: $('#flStatus'),
    flWander: $('#flWander'),
    liveWander: $('#mockWanderLive'),
    pillWander: $('#mockWanderPill'),
    toast: $('#mockToast'),
  };

  const TOTAL = 60 * 60;
  const TASK = '论文写作';
  const state = {
    phase: 'focusing',
    remaining: 23 * 60 + 48,
    breakLeft: 0,
    nextReminderIn: Math.round(rand(8, 13)),
    focusTicks: 0,
    cycle: 0,
    wander: 1,
    todayWander: 3,
  };

  const setTitle = (text) => {
    if (el.title.textContent === text) return;
    el.title.style.opacity = 0;
    setTimeout(() => { el.title.textContent = text; el.title.style.opacity = 1; }, 250);
  };

  const render = () => {
    const progress = 1 - state.remaining / TOTAL;
    el.ring.style.strokeDashoffset = String(1000 - 1000 * progress);
    mock.dataset.phase = state.phase === 'break' ? 'break' : 'focusing';

    if (state.phase === 'break') {
      el.time.textContent = String(state.breakLeft);
      el.caption.textContent = `${TASK} · 闭眼 · 松肩 · 慢呼吸`;
      el.flTime.textContent = `${state.breakLeft} 秒`;
      el.flStatus.textContent = '微休息';
      el.flRing.style.strokeDashoffset = '0';
      setTitle('让大脑安静十秒');
    } else {
      const t = `${pad(Math.floor(state.remaining / 60))}:${pad(state.remaining % 60)}`;
      el.time.textContent = t;
      el.caption.textContent = `${TASK} · 净专注剩余`;
      el.flTime.textContent = t;
      el.flStatus.textContent = '专注中';
      el.flRing.style.strokeDashoffset = String(1000 - 1000 * progress);
      setTitle('把注意力放回眼前');
    }
    el.flWander.textContent = String(state.wander);
    el.liveWander.textContent = `${state.wander} 次`;
    el.pillWander.textContent = `${state.todayWander} 次`;
  };

  let toastTimer;
  const showToast = () => {
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 3200);
  };

  const tick = () => {
    if (state.phase === 'break') {
      state.breakLeft -= 1;
      if (state.breakLeft <= 0) {
        state.phase = 'focusing';
        state.nextReminderIn = Math.round(rand(9, 15));
        state.focusTicks = 0;
        state.cycle += 1;
      }
    } else {
      state.remaining = Math.max(0, state.remaining - 1);
      state.focusTicks += 1;
      state.nextReminderIn -= 1;
      // 每隔一轮提示，模拟一次“我走神了”
      if (state.cycle % 2 === 1 && state.focusTicks === 4 && state.wander < 6) {
        state.wander += 1;
        state.todayWander += 1;
        showToast();
      }
      if (state.remaining <= 60) state.remaining = 23 * 60 + 48; // 循环演示
      if (state.nextReminderIn <= 0) {
        state.phase = 'break';
        state.breakLeft = 10;
      }
    }
    render();
  };

  render();
  if (reduceMotion) return;

  let timer = null;
  let visible = true;
  const run = () => {
    const shouldRun = visible && !document.hidden;
    if (shouldRun && !timer) timer = setInterval(tick, 1000);
    if (!shouldRun && timer) { clearInterval(timer); timer = null; }
  };
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; run(); }).observe(mock);
  document.addEventListener('visibilitychange', run);
  run();
}

/* ---------- 工作方式：随机提示时间轴 ---------- */

function initTimeline() {
  const bellsEl = $('#tlBells');
  const marksEl = $('#tlMarks');
  const track = $('.tl-track');
  const summary = $('#tlSummary');
  const plot = $('.tl-plot');
  if (!bellsEl) return;

  const LENGTH = 60;
  let range = [3, 5];
  let bells = [];

  const pickMarks = () => {
    // 两次走神 + 一次疲劳，彼此间隔足够，标签不会相互遮挡
    for (let attempt = 0; attempt < 50; attempt++) {
      const a = rand(9, 24);
      const b = rand(a + 9, 40);
      const c = rand(Math.max(b + 9, 44), 56);
      if (b < 40 && c < 57) return [
        { t: a, kind: 'wander' },
        { t: b, kind: 'wander' },
        { t: c, kind: 'fatigue' },
      ];
    }
    return [{ t: 16, kind: 'wander' }, { t: 31, kind: 'wander' }, { t: 49, kind: 'fatigue' }];
  };

  const generate = () => {
    bells = [];
    let t = 0;
    while (true) {
      t += rand(range[0], range[1]);
      if (t >= LENGTH - 0.5) break;
      bells.push(t);
    }
    const gaps = bells.map((b, i) => b - (i ? bells[i - 1] : 0));
    const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    summary.textContent = `本轮共 ${bells.length} 次随机提示，平均间隔 ${avg.toFixed(1)} 分钟`;

    bellsEl.innerHTML = '';
    $$('.tl-break', track).forEach((n) => n.remove());
    bells.forEach((b, i) => {
      const left = `${(b / LENGTH) * 100}%`;
      const bell = document.createElement('span');
      bell.className = 'tl-bell';
      bell.style.left = left;
      bell.style.animationDelay = `${i * 35}ms`;
      bell.innerHTML = '<svg class="i"><use href="#i-bell"/></svg>';
      bellsEl.appendChild(bell);

      const br = document.createElement('span');
      br.className = 'tl-break';
      br.style.left = left;
      track.appendChild(br);
    });

    marksEl.innerHTML = '';
    pickMarks().forEach(({ t, kind }) => {
      const m = document.createElement('span');
      m.className = 'tl-mark';
      m.style.left = `${(t / LENGTH) * 100}%`;
      m.style.setProperty('--c', kind === 'wander' ? 'var(--coral)' : 'var(--amber)');
      m.innerHTML = `<span>${kind === 'wander' ? '走神' : '疲劳'}<span class="m-min"> · 第 ${Math.round(t)} 分钟</span></span>`;
      marksEl.appendChild(m);
    });
  };

  $$('.seg button').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.seg button').forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
      range = btn.dataset.range.split(',').map(Number);
      generate();
    });
  });
  $('#tlReroll').addEventListener('click', generate);
  generate();

  // 播放头扫过时，提示铃轻轻晃动
  if (reduceMotion) {
    plot.style.setProperty('--p', '62%');
    return;
  }
  const DURATION = 16000;
  let start = null;
  let last = 0;
  let raf = null;
  const frame = (now) => {
    if (start === null) start = now;
    const p = ((now - start) % DURATION) / DURATION;
    plot.style.setProperty('--p', `${p * 100}%`);
    const minute = p * LENGTH;
    const lastMinute = last * LENGTH;
    const nodes = bellsEl.children;
    bells.forEach((b, i) => {
      if (b > lastMinute && b <= minute && nodes[i]) {
        nodes[i].classList.remove('dinging');
        void nodes[i].offsetWidth;
        nodes[i].classList.add('dinging');
      }
    });
    last = p;
    raf = requestAnimationFrame(frame);
  };
  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting && !raf) { start = null; last = 0; raf = requestAnimationFrame(frame); }
    if (!entry.isIntersecting && raf) { cancelAnimationFrame(raf); raf = null; }
  }).observe(plot);
}

/* ---------- 环境音混音器（Web Audio） ---------- */

const SOUNDS = [
  { id: 'rain', name: '雨声', desc: '雨落在树叶上', icon: 'i-rain', tint: '#84B9FF' },
  { id: 'waves', name: '海浪', desc: '沙滩上的浪花', icon: 'i-waves', tint: '#6CCBDD' },
  { id: 'stream', name: '溪流', desc: '林间的小溪', icon: 'i-drop', tint: '#78D7B2' },
  { id: 'wind', name: '风声', desc: '松林里的风', icon: 'i-wind', tint: '#A8C9BE' },
  { id: 'fire', name: '篝火', desc: '壁炉里的柴火', icon: 'i-fire', tint: '#FF9A79' },
  { id: 'birds', name: '鸟鸣', desc: '清晨湖边的鸟鸣', icon: 'i-bird', tint: '#F4C978' },
  { id: 'crickets', name: '虫鸣', desc: '夏夜花园的蟋蟀', icon: 'i-night', tint: '#B7A8FF' },
  { id: 'brown', name: '棕噪音', desc: '低沉平稳的底噪', icon: 'i-noise', tint: '#D2B08C', synth: true },
];

function initMixer() {
  const grid = $('#mxGrid');
  if (!grid) return;
  const toggleBtn = $('#mxToggle');
  const toggleLabel = $('span', toggleBtn);
  const status = $('#mxStatus');
  const icon = $('#mxIcon');
  const masterInput = $('#mxMaster');

  let ctx = null;
  let master = null;
  let paused = false;
  const tracks = new Map();

  const setFill = (input) => input.style.setProperty('--fill', `${input.value * 100}%`);

  SOUNDS.forEach((s) => {
    const tile = document.createElement('div');
    tile.className = 'snd';
    tile.style.setProperty('--tint', s.tint);
    tile.innerHTML = `
      <button type="button" class="snd-hit" aria-pressed="false" aria-label="${s.name}：${s.desc}"></button>
      <span class="snd-ic"><svg class="i"><use href="#${s.icon}"/></svg></span>
      <span class="snd-state" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="snd-name">${s.name}</span>
      <span class="snd-desc">${s.desc}</span>
      <div class="snd-vol"><input type="range" min="0" max="1" step="0.01" value="0.6" aria-label="${s.name}音量"></div>`;
    grid.appendChild(tile);

    const track = { ...s, tile, on: false, buffer: null, source: null, gain: null, volume: 0.6, loading: null };
    tracks.set(s.id, track);

    $('.snd-hit', tile).addEventListener('click', () => toggleTrack(track));
    const vol = $('input', tile);
    setFill(vol);
    vol.addEventListener('input', () => {
      track.volume = Number(vol.value);
      setFill(vol);
      if (track.gain) track.gain.gain.setTargetAtTime(track.volume, ctx.currentTime, 0.05);
    });
  });

  setFill(masterInput);
  masterInput.addEventListener('input', () => {
    setFill(masterInput);
    if (master) master.gain.setTargetAtTime(Number(masterInput.value), ctx.currentTime, 0.05);
  });

  const ensureContext = () => {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = Number(masterInput.value);
    master.connect(ctx.destination);
  };

  const brownNoise = () => {
    // 与 App 相同的棕噪音算法，首尾交叉淡化成无缝循环
    const sr = ctx.sampleRate;
    const len = sr * 8;
    const fade = sr;
    const buffer = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const raw = new Float32Array(len + fade);
      let last = 0;
      for (let i = 0; i < raw.length; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        raw[i] = last * 3.5;
      }
      const out = buffer.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const v = i < fade ? raw[i] * (i / fade) + raw[len + i] * (1 - i / fade) : raw[i];
        out[i] = v * 0.4;
      }
    }
    return buffer;
  };

  const load = (track) => {
    if (track.buffer) return Promise.resolve(track.buffer);
    if (track.loading) return track.loading;
    if (track.synth) {
      track.buffer = brownNoise();
      return Promise.resolve(track.buffer);
    }
    track.loading = fetch(`assets/audio/${track.id}.m4a`)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then((data) => new Promise((resolve, reject) => ctx.decodeAudioData(data, resolve, reject)))
      .then((buffer) => { track.buffer = buffer; return buffer; })
      .finally(() => { track.loading = null; });
    return track.loading;
  };

  const start = (track) => {
    const source = ctx.createBufferSource();
    source.buffer = track.buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(track.volume, ctx.currentTime, 0.25);
    source.connect(gain).connect(master);
    source.start(0, Math.random() * track.buffer.duration);
    track.source = source;
    track.gain = gain;
  };

  const stop = (track) => {
    if (!track.source) return;
    const { source, gain } = track;
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
    setTimeout(() => { try { source.stop(); } catch (_) {} source.disconnect(); gain.disconnect(); }, 600);
    track.source = null;
    track.gain = null;
  };

  const refresh = () => {
    const active = [...tracks.values()].filter((t) => t.on);
    const playing = active.length > 0 && !paused;
    toggleBtn.disabled = active.length === 0;
    toggleBtn.classList.toggle('playing', playing);
    toggleLabel.textContent = playing ? '暂停' : '播放';
    icon.classList.toggle('playing', playing);
    tracks.forEach((t) => t.tile.classList.toggle('live', t.on && !!t.source && !paused));
    if (!active.length) status.textContent = '点选任意声音开始播放，可以同时叠加多种';
    else if (paused) status.textContent = `已暂停 · ${active.map((t) => t.name).join(' + ')}`;
    else status.textContent = `正在播放 · ${active.map((t) => t.name).join(' + ')}`;
  };

  const toggleTrack = async (track) => {
    ensureContext();
    track.on = !track.on;
    track.tile.classList.toggle('on', track.on);
    $('.snd-hit', track.tile).setAttribute('aria-pressed', String(track.on));

    if (!track.on) { stop(track); refresh(); return; }

    // 打开一个声音时，如果整体处于暂停，就恢复播放
    if (paused || ctx.state === 'suspended') { paused = false; ctx.resume(); }
    refresh();
    track.tile.classList.add('loading');
    try {
      await load(track);
      if (track.on && !track.source) start(track);
    } catch (err) {
      track.on = false;
      track.tile.classList.remove('on');
      status.textContent = `${track.name}加载失败，请稍后再试`;
    } finally {
      track.tile.classList.remove('loading');
      refresh();
    }
  };

  toggleBtn.addEventListener('click', () => {
    if (!ctx) return;
    paused = !paused;
    if (paused) ctx.suspend(); else ctx.resume();
    refresh();
  });
}

/* ---------- 洞察：图表 ---------- */

function initCharts() {
  // 最近 7 天专注时长（示例数据）
  const bars = $('#weekBars');
  if (bars) {
    const minutes = [45, 90, 30, 110, 80, 60, 125];
    const MAX = 150;
    const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const today = new Date().getDay();
    minutes.forEach((m, i) => {
      const offset = minutes.length - 1 - i;
      const label = offset === 0 ? '今天' : names[(today - offset + 7) % 7];
      const bar = document.createElement('div');
      bar.className = `bar${offset === 0 ? ' today' : ''}`;
      bar.style.setProperty('--h', `${(m / MAX) * 100}%`);
      bar.setAttribute('role', 'img');
      bar.setAttribute('aria-label', `${label}：${m} 分钟`);
      bar.innerHTML = `<span class="bar-val">${m}</span><span class="bar-col"></span><span class="bar-label">${label}</span>`;
      bars.appendChild(bar);
    });
  }

  // 专注质量趋势：最近 10 轮复盘评分（示例数据），与 App 一致用 Catmull-Rom 平滑
  const host = $('#trend');
  if (!host) return;
  const ratings = [3, 3, 4, 3, 4, 4, 5, 4, 5, 5];
  const tip = document.createElement('div');
  tip.className = 'tip';
  host.appendChild(tip);

  const draw = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    const L = 26, R = 12, T = 12, B = 28;
    const x = (i) => L + (i / (ratings.length - 1)) * (w - L - R);
    const y = (v) => T + (1 - (v - 1) / 4) * (h - T - B);
    const pts = ratings.map((v, i) => [x(i), y(v)]);

    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
    }
    const area = `${d} L${pts[pts.length - 1][0]},${h - B} L${pts[0][0]},${h - B} Z`;

    const grid = [1, 2, 3, 4, 5].map((v) => `<line x1="${L}" x2="${w - R}" y1="${y(v)}" y2="${y(v)}"/>`).join('');
    const yLabels = [1, 2, 3, 4, 5].map((v) => `<text x="${L - 12}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');
    const xLabels = ratings.map((_, i) => `<text x="${x(i)}" y="${h - 6}" text-anchor="middle">${i + 1}</text>`).join('');
    const dots = pts.map(([px, py]) => `<circle cx="${px}" cy="${py}" r="4" fill="var(--blue)" stroke="#0C1619" stroke-width="2"/>`).join('');

    const svg = `
      <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="最近 10 轮专注评分，从 3 分逐步上升到 5 分">
        <defs>
          <linearGradient id="trendArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#84B9FF" stop-opacity=".22"/>
            <stop offset="1" stop-color="#84B9FF" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <g class="grid">${grid}</g>
        <g class="axis">${yLabels}${xLabels}</g>
        <path class="trend-area" d="${area}" fill="url(#trendArea)"/>
        <path class="trend-line" d="${d}" pathLength="1"/>
        <g class="trend-dots">${dots}</g>
        <g class="trend-hover" style="display:none">
          <line y1="${T}" y2="${h - B}"/>
          <circle r="6"/>
        </g>
        <rect x="${L}" y="0" width="${w - L - R}" height="${h}" fill="transparent" class="hit"/>
      </svg>`;
    $$('svg', host).forEach((n) => n.remove());
    host.insertAdjacentHTML('afterbegin', svg);

    const hover = $('.trend-hover', host);
    const hit = $('.hit', host);
    const move = (evt) => {
      const rect = host.getBoundingClientRect();
      const mx = evt.clientX - rect.left;
      const i = clamp(Math.round(((mx - L) / (w - L - R)) * (ratings.length - 1)), 0, ratings.length - 1);
      const [px, py] = pts[i];
      hover.style.display = '';
      $('line', hover).setAttribute('x1', px);
      $('line', hover).setAttribute('x2', px);
      $('circle', hover).setAttribute('cx', px);
      $('circle', hover).setAttribute('cy', py);
      tip.innerHTML = `<span>第 ${i + 1} 轮</span>　<b>${ratings[i]}</b> <span>分</span>`;
      tip.style.left = `${px}px`;
      tip.style.top = `${py}px`;
      tip.classList.add('show');
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerleave', () => { hover.style.display = 'none'; tip.classList.remove('show'); });
  };

  draw();
  let rw = host.clientWidth;
  new ResizeObserver(() => {
    if (host.clientWidth !== rw) { rw = host.clientWidth; draw(); }
  }).observe(host);
}

/* ---------- 复制命令 ---------- */

function initCopy() {
  $$('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const source = $(btn.dataset.copy);
      const text = source.textContent.split('\n').map((l) => l.replace(/^\$\s?/, '')).join('\n').trim();
      try {
        await navigator.clipboard.writeText(text);
        btn.classList.add('done');
        $('span', btn).textContent = '已复制';
        setTimeout(() => { btn.classList.remove('done'); $('span', btn).textContent = '复制'; }, 1800);
      } catch (_) {
        const range = document.createRange();
        range.selectNodeContents(source);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  applyConfig();
  initNav();
  initReveal();
  initMock();
  initTimeline();
  initMixer();
  initCharts();
  initCopy();
});
