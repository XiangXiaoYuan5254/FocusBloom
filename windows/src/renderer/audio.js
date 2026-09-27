// 声音部分，对应 macOS 版的 AmbientPlayer.swift、AmbientSynth.swift 和系统提示音（NSSound）。
// 只在主窗口里运行（主窗口关到托盘时只是隐藏，页面仍在），悬浮窗不加载这个文件。
(function () {
  const IDS = FocusCore.AMBIENT_IDS;
  // 音量按指数曲线平滑过渡：主音量淡入 0.8 秒、淡出 0.45 秒，单个声音 0.3 秒，和 Mac 版一致。
  const MASTER_UP = 0.8;
  const MASTER_DOWN = 0.45;
  const SOUND_TIME = 0.3;
  const SETTLE = 8; // 经过 8 个时间常数后可以视为到位
  const RELEASE_BUFFER_AFTER = 60_000;

  function ramp(param, goal, timeConstant, now) {
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(now);
    } else {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
    }
    param.setTargetAtTime(goal, now, timeConstant);
  }

  // ---- 棕噪音 ----

  /// 按 AmbientSynth.swift 的算法离线生成一段棕噪音，首尾交叉淡化成无缝循环。
  /// 左右声道共享大部分成分，700 Hz 以上滚降，再叠一点很慢的起伏。
  function renderBrownNoise(sampleRate, seconds = 40, fadeSeconds = 3, warmupSeconds = 1) {
    let state = (Math.random() * 0xffffffff) >>> 0 || 1;
    const step = () => {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
    };
    const white = () => {
      step();
      return (state | 0) / 2147483648;
    };
    const unit = () => {
      step();
      return (state >>> 8) / 16777216;
    };
    const range = (lower, upper) => lower + (upper - lower) * unit();

    const brown = () => {
      let last = 0;
      return () => {
        last = (last + 0.02 * white()) / 1.02;
        return last * 3.5;
      };
    };

    function biquad(kind, frequency, q) {
      const omega = (2 * Math.PI * Math.min(frequency, sampleRate * 0.45)) / sampleRate;
      const cos = Math.cos(omega);
      const alpha = Math.sin(omega) / (2 * q);
      const a0 = 1 + alpha;
      const b =
        kind === 'low'
          ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
          : [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
      const [b0, b1, b2] = b.map((value) => value / a0);
      const a1 = (-2 * cos) / a0;
      const a2 = (1 - alpha) / a0;
      let z1 = 0;
      let z2 = 0;
      return (input) => {
        const output = b0 * input + z1;
        z1 = b1 * input - a1 * output + z2;
        z2 = b2 * input - a2 * output;
        return output;
      };
    }

    function drift(lower, upper, holdMin, holdMax, smoothing) {
      const coefficient = 1 - Math.exp(-1 / (smoothing * sampleRate));
      let value = range(lower, upper);
      let intermediate = value;
      let target = value;
      let countdown = 0;
      return () => {
        countdown -= 1;
        if (countdown <= 0) {
          target = range(lower, upper);
          countdown = Math.floor(range(holdMin * sampleRate, holdMax * sampleRate));
        }
        intermediate += (target - intermediate) * coefficient;
        value += (intermediate - value) * coefficient;
        return value;
      };
    }

    const shared = brown();
    const sideLeft = brown();
    const sideRight = brown();
    const highLeft = biquad('high', 30, 0.707);
    const highRight = biquad('high', 30, 0.707);
    const lowLeft = biquad('low', 700, 0.6);
    const lowRight = biquad('low', 700, 0.6);
    const breath = drift(0.82, 1, 5, 12, 3);

    const warmup = Math.floor(warmupSeconds * sampleRate);
    const length = Math.floor(seconds * sampleRate);
    const fade = Math.floor(fadeSeconds * sampleRate);
    const rawLeft = new Float32Array(length + fade);
    const rawRight = new Float32Array(length + fade);
    for (let index = -warmup; index < length + fade; index += 1) {
      const swell = breath() * 0.95;
      const common = shared() * 0.8;
      const left = lowLeft(highLeft(common + sideLeft() * 0.6)) * swell;
      const right = lowRight(highRight(common + sideRight() * 0.6)) * swell;
      if (index >= 0) {
        rawLeft[index] = left;
        rawRight[index] = right;
      }
    }

    // 开头 fade 个采样和多生成的尾巴做等功率交叉，循环回到开头时刚好接上结尾。
    const left = rawLeft.slice(0, length);
    const right = rawRight.slice(0, length);
    for (let index = 0; index < fade; index += 1) {
      const position = index / fade;
      const fadeIn = Math.sin((position * Math.PI) / 2);
      const fadeOut = Math.cos((position * Math.PI) / 2);
      left[index] = rawLeft[index] * fadeIn + rawLeft[length + index] * fadeOut;
      right[index] = rawRight[index] * fadeIn + rawRight[length + index] * fadeOut;
    }
    return [left, right];
  }

  // ---- 环境音混音 ----

  /// 每种声音一个循环播放的 AudioBuffer（样本级无缝），各自一个音量节点，汇到总线后经过限制器，叠多种也不会破音。
  /// 录音在第一次选中时才解码，停用一分钟后释放，避免常驻内存。
  class AmbientEngine {
    constructor({ loadAsset, onFailure }) {
      this.loadAsset = loadAsset;
      this.onFailure = onFailure;
      this.ctx = null;
      this.tracks = new Map();
      this.playing = false;
      this.levels = { master: 0, sounds: {} };
      this.stopTimer = null;
    }

    ensureContext() {
      if (this.ctx) return this.ctx;
      const ctx = new AudioContext({ latencyHint: 'playback' });
      const bus = ctx.createGain();
      bus.gain.value = 0;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
      bus.connect(limiter).connect(ctx.destination);
      this.ctx = ctx;
      this.bus = bus;
      return ctx;
    }

    update(playing, levels) {
      this.playing = playing;
      this.levels = levels;
      if (!playing && !this.ctx) return;
      if (playing) {
        let ctx;
        try {
          ctx = this.ensureContext();
        } catch (error) {
          console.error('ambient context failed', error);
          this.onFailure();
          return;
        }
        clearTimeout(this.stopTimer);
        this.stopTimer = null;
        if (ctx.state !== 'running') {
          ctx.resume().catch((error) => {
            console.error('ambient resume failed', error);
            this.onFailure();
          });
        }
      }
      this.sync();
    }

    sync() {
      const ctx = this.ctx;
      if (!ctx) return;
      const now = ctx.currentTime;
      const masterGoal = this.playing ? this.levels.master : 0;
      ramp(this.bus.gain, masterGoal, masterGoal > this.bus.gain.value ? MASTER_UP : MASTER_DOWN, now);

      if (!this.playing) {
        // 等主音量淡出后停掉所有声音、挂起音频设备，避免空转耗电。
        if (!this.stopTimer) {
          this.stopTimer = setTimeout(() => {
            this.stopTimer = null;
            if (this.playing) return;
            for (const id of this.tracks.keys()) this.stopTrack(id);
            ctx.suspend().catch(() => {});
          }, MASTER_DOWN * SETTLE * 1000);
        }
        return;
      }

      for (const id of IDS) {
        const goal = this.levels.sounds[id] || 0;
        const track = this.tracks.get(id);
        if (goal > 0) {
          if (!track) {
            this.loadTrack(id);
            continue;
          }
          clearTimeout(track.releaseTimer);
          track.releaseTimer = null;
          if (!track.buffer) continue;
          if (!track.source) this.startTrack(id, track);
          clearTimeout(track.stopTimer);
          track.stopTimer = null;
          ramp(track.gain.gain, goal, SOUND_TIME, now);
        } else if (track && track.source) {
          ramp(track.gain.gain, 0, SOUND_TIME, now);
          if (!track.stopTimer) {
            track.stopTimer = setTimeout(() => {
              track.stopTimer = null;
              if (!(this.playing && this.levels.sounds[id] > 0)) this.stopTrack(id);
            }, SOUND_TIME * SETTLE * 1000);
          }
        }
      }
    }

    loadTrack(id) {
      const track = { buffer: null, source: null, gain: null, failed: false };
      this.tracks.set(id, track);
      const ready =
        id === 'brownNoise'
          ? Promise.resolve().then(() => {
              const [left, right] = renderBrownNoise(this.ctx.sampleRate);
              const buffer = this.ctx.createBuffer(2, left.length, this.ctx.sampleRate);
              buffer.copyToChannel(left, 0);
              buffer.copyToChannel(right, 1);
              return buffer;
            })
          : this.loadAsset(id).then((bytes) => {
              const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
              return this.ctx.decodeAudioData(data);
            });
      ready.then(
        (buffer) => {
          if (this.tracks.get(id) !== track) return;
          track.buffer = buffer;
          this.sync();
        },
        (error) => {
          console.error(`ambient sound ${id} failed to load`, error);
          track.failed = true;
        }
      );
    }

    startTrack(id, track) {
      const ctx = this.ctx;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.bus);
      const source = ctx.createBufferSource();
      source.buffer = track.buffer;
      source.loop = true;
      source.connect(gain);
      // 每次从随机位置开始，不会总是听到同一个开头。
      source.start(0, track.buffer.duration * Math.random() * 0.95);
      track.source = source;
      track.gain = gain;
    }

    stopTrack(id) {
      const track = this.tracks.get(id);
      if (!track) return;
      clearTimeout(track.stopTimer);
      track.stopTimer = null;
      if (track.source) {
        try {
          track.source.stop();
        } catch {}
        track.source.disconnect();
        track.gain.disconnect();
        track.source = null;
        track.gain = null;
      }
      if (!track.releaseTimer) {
        track.releaseTimer = setTimeout(() => {
          if (!track.source) this.tracks.delete(id);
        }, RELEASE_BUFFER_AFTER);
      }
    }
  }

  // ---- 提示音 ----

  /// 用合成音代替 macOS 的系统提示音，名字保持一致，风格尽量接近。
  class ChimePlayer {
    constructor() {
      this.ctx = null;
      this.idleTimer = null;
    }

    ensureContext() {
      if (!this.ctx) {
        const ctx = new AudioContext();
        const output = ctx.createGain();
        output.gain.value = 0.42;
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -6;
        limiter.ratio.value = 12;
        output.connect(limiter).connect(ctx.destination);
        this.ctx = ctx;
        this.output = output;
      }
      return this.ctx;
    }

    play(name) {
      let ctx;
      try {
        ctx = this.ensureContext();
      } catch (error) {
        console.error('chime context failed', error);
        return;
      }
      clearTimeout(this.idleTimer);
      const start = () => {
        const recipe = RECIPES[name] || RECIPES.Glass;
        const duration = recipe(ctx, this.output, ctx.currentTime + 0.02);
        this.idleTimer = setTimeout(() => ctx.suspend().catch(() => {}), (duration + 2) * 1000);
      };
      if (ctx.state === 'running') start();
      else ctx.resume().then(start, (error) => console.error('chime resume failed', error));
    }
  }

  function tone(ctx, destination, { frequency, type = 'sine', at, attack = 0.004, decay, peak, glideTo, glideTime = 0.06 }) {
    const oscillator = ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    if (glideTo) oscillator.frequency.exponentialRampToValueAtTime(glideTo, at + glideTime);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + attack);
    gain.gain.setTargetAtTime(0, at + attack, decay);
    oscillator.connect(gain).connect(destination);
    oscillator.start(at);
    const end = at + attack + decay * SETTLE;
    oscillator.stop(end);
    return end;
  }

  /// 钟声：基频加几个非谐泛音，高泛音衰减得更快。
  function bell(ctx, destination, at, frequency, partials, decay, peak = 0.5) {
    let end = at;
    for (const [ratio, amount] of partials) {
      end = Math.max(end, tone(ctx, destination, { frequency: frequency * ratio, at, decay: decay / Math.sqrt(ratio), peak: peak * amount }));
    }
    return end;
  }

  function beep(ctx, destination, at, frequency, length, peak) {
    const oscillator = ctx.createOscillator();
    oscillator.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + 0.006);
    gain.gain.setValueAtTime(peak, at + length - 0.012);
    gain.gain.linearRampToValueAtTime(0, at + length);
    oscillator.connect(gain).connect(destination);
    oscillator.start(at);
    oscillator.stop(at + length + 0.02);
    return at + length;
  }

  const RECIPES = {
    Glass: (ctx, out, at) => bell(ctx, out, at, 1567.98, [[1, 1], [2.76, 0.34], [5.4, 0.14]], 0.42) - ctx.currentTime,
    Ping: (ctx, out, at) => bell(ctx, out, at, 1318.51, [[1, 1], [2, 0.22]], 0.3, 0.55) - ctx.currentTime,
    Pop: (ctx, out, at) =>
      tone(ctx, out, { frequency: 720, glideTo: 170, glideTime: 0.07, at, attack: 0.002, decay: 0.035, peak: 0.75 }) - ctx.currentTime,
    Tink: (ctx, out, at) => bell(ctx, out, at, 3135.96, [[1, 1], [2.32, 0.3]], 0.07, 0.4) - ctx.currentTime,
    Submarine: (ctx, out, at) => {
      const echo = ctx.createDelay(1);
      echo.delayTime.value = 0.24;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.32;
      const damp = ctx.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = 1400;
      const input = ctx.createGain();
      input.connect(out);
      input.connect(echo);
      echo.connect(damp).connect(feedback).connect(echo);
      feedback.connect(out);
      const end = Math.max(
        tone(ctx, input, { frequency: 440, at, attack: 0.01, decay: 0.5, peak: 0.55 }),
        tone(ctx, input, { frequency: 880, at, attack: 0.01, decay: 0.25, peak: 0.12 })
      );
      return end + 1.5 - ctx.currentTime;
    },
    Purr: (ctx, out, at) => {
      const oscillator = ctx.createOscillator();
      oscillator.type = 'sawtooth';
      oscillator.frequency.value = 110;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 650;
      const tremolo = ctx.createGain();
      tremolo.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 24;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 0.5;
      lfo.connect(lfoDepth).connect(tremolo.gain);
      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(0.5, at + 0.05);
      envelope.gain.setValueAtTime(0.5, at + 0.42);
      envelope.gain.linearRampToValueAtTime(0, at + 0.6);
      oscillator.connect(filter).connect(tremolo).connect(envelope).connect(out);
      oscillator.start(at);
      lfo.start(at);
      oscillator.stop(at + 0.65);
      lfo.stop(at + 0.65);
      return at + 0.65 - ctx.currentTime;
    },
    Morse: (ctx, out, at) => {
      // · — ·
      let time = at;
      for (const length of [0.07, 0.2, 0.07]) {
        time = beep(ctx, out, time, 784, length, 0.4) + 0.07;
      }
      return time - ctx.currentTime;
    },
    Hero: (ctx, out, at) => {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      let end = at;
      notes.forEach((frequency, index) => {
        const last = index === notes.length - 1;
        end = Math.max(end, bell(ctx, out, at + index * 0.11, frequency, [[1, 1], [2, 0.18], [3, 0.07]], last ? 0.9 : 0.35, last ? 0.5 : 0.38));
      });
      return end - ctx.currentTime;
    }
  };

  window.BloomAudio = { AmbientEngine, ChimePlayer, renderBrownNoise };
})();
