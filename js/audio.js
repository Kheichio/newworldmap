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
      case 'fanfare': S([523.25, 659.25, 783.99, 1046.5], 0.13, { dur: 1.4, vol: 0.55 }); S([392, 523.25], 0.02, { dur: 1.6, vol: 0.3, at: 0.5 }); break;
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

// Generative ambient music: a slow random walk over diatonic chords with a sparse pentatonic melody,
// vinyl crackle and a wandering low-pass cutoff. Mood 'war' shifts to the relative minor with a soft drum.
const Music = {
  volume: 0.35, muted: false, playing: false, mood: 'peace',
  bpm: 66, key: 0, chordIdx: 0, beat: 0, timer: null,
  gain: null, filter: null, crackle: null, lfoT: 0,
  // scale degrees (semitones from the key) for I ii iii IV V vi
  CHORDS: [[0, 4, 7], [2, 5, 9], [4, 7, 11], [5, 9, 12], [7, 11, 14], [9, 12, 16]],
  NEXT: { 0: [5, 3, 1, 2], 1: [4, 3], 2: [5, 3], 3: [4, 0, 1], 4: [0, 5], 5: [3, 1, 4] },
  PENTA: [0, 2, 4, 7, 9],

  setup() {
    if (this.gain || !Sound.ctx) return;
    const ctx = Sound.ctx;
    this.gain = ctx.createGain(); this.gain.gain.value = 0;
    this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 1500; this.filter.Q.value = 0.5;
    const delay = ctx.createDelay(1); delay.delayTime.value = 0.42;
    const fb = ctx.createGain(); fb.gain.value = 0.35;
    const wet = ctx.createGain(); wet.gain.value = 0.3;
    this.filter.connect(this.gain);
    this.filter.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(this.gain);
    this.gain.connect(ctx.destination);
    this.applyVolume();
  },
  applyVolume() { if (this.gain) this.gain.gain.setTargetAtTime(this.muted || !this.playing ? 0 : this.volume * this.volume * 0.5, Sound.ctx.currentTime, 0.4); },
  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); this.applyVolume(); },
  setMuted(m) { this.muted = m; this.applyVolume(); },
  setMood(m) { this.mood = m; },

  start() {
    Sound.init();
    if (!Sound.ctx) return;
    this.setup();
    if (this.playing) return;
    this.playing = true;
    this.key = Math.floor(Math.random() * 12);
    this.chordIdx = 0; this.beat = 0;
    this.applyVolume();
    this.startCrackle();
    const tick = () => { if (!this.playing) return; this.step(); this.timer = setTimeout(tick, 60000 / this.bpm); };
    tick();
  },
  stop() {
    this.playing = false;
    clearTimeout(this.timer);
    this.applyVolume();
    if (this.crackle) { try { this.crackle.stop(); } catch (e) { /* already stopped */ } this.crackle = null; }
  },
  freq(semi) { return 220 * Math.pow(2, (this.key + semi) / 12); },
  // a soft sustained voice
  voice(f, dur, vol, type = 'triangle', at = 0) {
    const ctx = Sound.ctx, t0 = ctx.currentTime + at;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(1.2, dur * 0.3));
    g.gain.setValueAtTime(vol, t0 + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    for (const d of [-5, 5]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = d;
      o.connect(g); o.start(t0); o.stop(t0 + dur + 0.1);
    }
    g.connect(this.filter);
  },
  step() {
    const ctx = Sound.ctx;
    if (document.hidden) { this.beat++; return; }
    const beatLen = 60 / this.bpm;
    const war = this.mood === 'war';
    // chord change every 8 beats
    if (this.beat % 8 === 0) {
      const opts = this.NEXT[this.chordIdx];
      this.chordIdx = opts[Math.floor(Math.random() * opts.length)];
      if (war && Math.random() < 0.5) this.chordIdx = 5; // lean on vi
      const chord = this.CHORDS[this.chordIdx];
      const dur = beatLen * 8.5;
      for (let i = 0; i < chord.length; i++) this.voice(this.freq(chord[i] - 12), dur, 0.16 - i * 0.03, 'triangle');
      this.voice(this.freq(chord[0] - 24), dur, 0.2, 'sine'); // bass
    }
    // sparse melody on even beats
    if (this.beat % 2 === 0 && Math.random() < (war ? 0.4 : 0.6)) {
      const chord = this.CHORDS[this.chordIdx];
      const pool = this.PENTA.map(p => p + (war ? 9 : 0));
      const n = pool[Math.floor(Math.random() * pool.length)] + (Math.random() < 0.3 ? 12 : 0);
      this.voice(this.freq(n + 12), beatLen * (1.5 + Math.random() * 2), 0.09, 'sine', Math.random() * 0.1);
      void chord;
    }
    // war: soft low drum on beats 1 and 3
    if (war && this.beat % 4 === 0) {
      const t0 = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(110, t0); o.frequency.exponentialRampToValueAtTime(45, t0 + 0.25);
      g.gain.setValueAtTime(0.35, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      o.connect(g); g.connect(this.filter); o.start(t0); o.stop(t0 + 0.4);
    }
    // tape wobble: slow wander of the cutoff
    this.lfoT += beatLen;
    this.filter.frequency.setTargetAtTime(1500 + Math.sin(this.lfoT / 30 * Math.PI * 2) * 500, ctx.currentTime, 0.5);
    this.beat++;
  },
  startCrackle() {
    const ctx = Sound.ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() < 0.002 ? (Math.random() * 2 - 1) * 0.6 : (Math.random() * 2 - 1) * 0.02;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const g = ctx.createGain(); g.gain.value = 0.25;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    src.connect(hp); hp.connect(g); g.connect(this.gain);
    src.start();
    this.crackle = src;
  },
};
