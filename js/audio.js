// Soft, lo-fi sound effects synthesised with the Web Audio API (no audio files).
// Everything runs through a low-pass filter and a gentle feedback delay for a warm, mellow feel.

const Sound = {
  ctx: null, master: null, filter: null,
  volume: 0.5, muted: false,

  init() {
    if (this.ctx || typeof window === 'undefined') return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass'; this.filter.frequency.value = 1900; this.filter.Q.value = 0.6;
      // lo-fi tail: short feedback delay
      const delay = ctx.createDelay(1); delay.delayTime.value = 0.27;
      const fb = ctx.createGain(); fb.gain.value = 0.28;
      const wet = ctx.createGain(); wet.gain.value = 0.35;
      this.filter.connect(this.master);
      this.filter.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(this.master);
      this.master.connect(ctx.destination);
      this.applyVolume();
    } catch (e) { this.ctx = null; }
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); this.applyVolume(); },
  setMuted(m) { this.muted = m; this.applyVolume(); },
  applyVolume() { if (this.master) this.master.gain.value = this.muted ? 0 : this.volume * this.volume * 0.7; },

  // One soft note: two slightly detuned oscillators with a rounded envelope.
  note(freq, { type = 'triangle', dur = 0.4, at = 0, vol = 1, detune = 6 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime + at;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol * 0.5, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(vol * 0.25, t0 + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    for (const d of [-detune, detune]) {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = freq; o.detune.value = d;
      o.connect(g); o.start(t0); o.stop(t0 + dur + 0.05);
    }
    g.connect(this.filter);
  },
  // Filtered noise burst (paper, wind, surf).
  hush({ dur = 0.25, at = 0, vol = 0.3, freq = 1200 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime + at;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp); bp.connect(g); g.connect(this.filter);
    src.start(t0);
  },
  seq(freqs, gap, opts) { freqs.forEach((f, i) => this.note(f, Object.assign({}, opts, { at: (opts.at || 0) + i * gap }))); },

  play(name) {
    if (!this.ctx || this.muted) return;
    this.resume();
    const N = (f, o) => this.note(f, o), S = (fs, gap, o) => this.seq(fs, gap, o);
    switch (name) {
      case 'select':  N(880, { dur: 0.09, vol: 0.18, type: 'sine' }); break;
      case 'build':   S([392, 523.25], 0.09, { dur: 0.45, vol: 0.6 }); break;           // G4 C5
      case 'expand':  S([440, 659.25], 0.1, { dur: 0.4, vol: 0.5 }); break;             // A4 E5
      case 'village': S([392, 493.88, 587.33], 0.1, { dur: 0.6, vol: 0.55 }); break;    // G B D
      case 'upgrade': S([523.25, 659.25, 783.99, 1046.5], 0.09, { dur: 0.7, vol: 0.5 }); break;
      case 'castle':  S([196, 293.66], 0.14, { dur: 0.8, vol: 0.7, type: 'triangle', detune: 4 }); break;
      case 'trade':   S([392, 493.88, 587.33], 0.02, { dur: 0.9, vol: 0.4 }); break;    // soft G major chord
      case 'peace':   S([523.25, 659.25, 783.99], 0.03, { dur: 1.1, vol: 0.45, type: 'sine' }); break;
      case 'war':     N(110, { dur: 0.9, vol: 0.9, type: 'sawtooth', detune: 10 }); N(130.81, { dur: 0.9, vol: 0.5, at: 0.05, type: 'triangle' }); this.hush({ dur: 0.5, vol: 0.2, freq: 300 }); break;
      case 'conquer': S([146.83, 110], 0.16, { dur: 0.7, vol: 0.8, type: 'triangle' }); this.hush({ dur: 0.35, vol: 0.25, freq: 500 }); break;
      case 'edict':   S([329.63, 415.3, 493.88], 0.08, { dur: 0.7, vol: 0.45 }); break; // E G# B
      case 'card':    this.hush({ dur: 0.22, vol: 0.35, freq: 1600 }); N(783.99, { dur: 0.3, vol: 0.3, at: 0.08, type: 'sine' }); break;
      case 'draw':    this.hush({ dur: 0.18, vol: 0.2, freq: 1400 }); S([523.25, 587.33, 659.25], 0.06, { dur: 0.3, vol: 0.25, type: 'sine' }); break;
      case 'turn':    S([659.25, 880], 0.12, { dur: 0.5, vol: 0.35, type: 'sine' }); break;
      case 'bad':     S([329.63, 261.63], 0.18, { dur: 0.7, vol: 0.55, type: 'triangle' }); break;
      case 'event':   S([587.33, 739.99, 587.33], 0.1, { dur: 0.45, vol: 0.35, type: 'sine' }); break;
      case 'error':   N(150, { dur: 0.13, vol: 0.5, type: 'square', detune: 3 }); break;
      case 'win':     S([523.25, 659.25, 783.99, 1046.5, 1318.5], 0.11, { dur: 1.2, vol: 0.5 }); break;
      case 'lose':    S([392, 349.23, 311.13, 261.63], 0.2, { dur: 1.0, vol: 0.5, type: 'triangle' }); break;
    }
  },
};
