// Brickbox Royale audio engine.
//
// Everything is synthesised with the Web Audio API: chiptune SFX patches (pulse/triangle/saw
// oscillators, filtered noise, pitch envelopes, arpeggios) and looping music driven by a
// look-ahead step sequencer that schedules notes on the AudioContext clock.
//
// Safe everywhere: without Web Audio (Node, old browsers) every call is a silent no-op, and no
// public call ever throws. The AudioContext is only created/resumed inside audio.unlock(), which
// the game calls from its first pointerdown (iOS needs a user gesture).

const LOOKAHEAD = 0.12; // seconds of music scheduled ahead of the clock
const TICK_MS = 25; // scheduler wake-up interval (timing precision comes from the audio clock)
const FADE = 0.8; // music crossfade time
const MAX_VOICES = 24; // global SFX voice cap
const MUSIC_LEVEL = 0.55; // music bus headroom relative to SFX

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const num = (x, d) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const rnd = (a, b) => a + Math.random() * (b - a);
/** MIDI note number -> Hz */
const M = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ---------------------------------------------------------------------------------------------
// Per-context shared resources (noise buffer, pulse waves, drive curve) — built once, reused.
// ---------------------------------------------------------------------------------------------

const resCache = new WeakMap();
function res(ac) {
  let r = resCache.get(ac);
  if (!r) resCache.set(ac, (r = { waves: {} }));
  return r;
}

function noiseBuffer(ac) {
  const r = res(ac);
  if (!r.noise) {
    const len = Math.floor(ac.sampleRate * 2);
    const b = ac.createBuffer(1, len, ac.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    r.noise = b;
  }
  return r.noise;
}

/** Band-limited pulse wave with the given duty cycle (NES-style 12.5% / 25%). */
function pulseWave(ac, duty) {
  const r = res(ac);
  const key = 'p' + duty;
  if (!r.waves[key]) {
    const n = 40;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let k = 1; k < n; k++) {
      re[k] = Math.sin(2 * Math.PI * k * duty) / (Math.PI * k);
      im[k] = (1 - Math.cos(2 * Math.PI * k * duty)) / (Math.PI * k);
    }
    r.waves[key] = ac.createPeriodicWave(re, im);
  }
  return r.waves[key];
}

function setWave(ac, osc, type) {
  if (type === 'pulse25' || type === 'pulse12') {
    try {
      osc.setPeriodicWave(pulseWave(ac, type === 'pulse25' ? 0.25 : 0.125));
      return;
    } catch {
      type = 'square';
    }
  }
  osc.type = type || 'square';
}

function driveCurve(ac) {
  const r = res(ac);
  if (!r.drive) {
    const n = 1024;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) c[i] = Math.tanh((i / (n - 1) * 2 - 1) * 3);
    r.drive = c;
  }
  return r.drive;
}

// ---------------------------------------------------------------------------------------------
// Synth building blocks. A "voice" v = { ac, out, p (pitch mult), t (start time), nyq, srcs }.
// All times passed to helpers are offsets from v.t.
// ---------------------------------------------------------------------------------------------

const F = (v, f) => clamp(f * v.p, 1, v.nyq);

function track(v, src, stopAt) {
  if (!v.srcs) return; // music one-shots are not tracked
  v.srcs.push(src);
  v.live++;
  if (stopAt > v.end) v.end = stopAt;
  src.onended = () => {
    if (--v.live <= 0) releaseVoice(v);
  };
}

/** Attack -> optional hold -> exponential decay envelope on an AudioParam. */
function env(p, st, dur, vol, a, hold) {
  a = Math.min(a, dur * 0.9);
  hold = Math.min(hold, Math.max(0, dur - a - 0.005));
  p.setValueAtTime(0, st);
  p.linearRampToValueAtTime(vol, st + a);
  if (hold > 0) p.setValueAtTime(vol, st + a + hold);
  p.exponentialRampToValueAtTime(0.0001, st + dur);
  p.setValueAtTime(0, st + dur + 0.005);
}

/**
 * Oscillator note with optional pitch sweep f0 -> f1.
 * o: { a, hold, sweep (sweep time), lin (linear sweep), detune, to (destination node) }
 */
function tone(v, type, f0, f1, t, dur, vol, o = {}) {
  const ac = v.ac;
  const st = v.t + t;
  const osc = ac.createOscillator();
  setWave(ac, osc, type);
  const fr = osc.frequency;
  fr.setValueAtTime(F(v, f0), st);
  if (f1 != null && f1 !== f0) {
    const et = st + Math.max(0.005, o.sweep ?? dur);
    if (o.lin) fr.linearRampToValueAtTime(F(v, f1), et);
    else fr.exponentialRampToValueAtTime(F(v, f1), et);
  }
  if (o.detune) osc.detune.value = o.detune;
  const g = ac.createGain();
  env(g.gain, st, dur, vol, o.a ?? 0.003, o.hold ?? 0);
  osc.connect(g);
  g.connect(o.to || v.out);
  osc.start(st);
  const stop = st + dur + 0.03;
  osc.stop(stop);
  track(v, osc, stop);
  return { osc, g };
}

/**
 * Filtered white-noise burst.
 * o: { type ('lowpass'|'highpass'|'bandpass'), f0, f1 (filter sweep), sweep, q, a, hold, to }
 */
function noise(v, t, dur, vol, o = {}) {
  const ac = v.ac;
  const st = v.t + t;
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  src.loop = true;
  const f = ac.createBiquadFilter();
  f.type = o.type || 'lowpass';
  f.frequency.setValueAtTime(F(v, o.f0 ?? 4000), st);
  if (o.f1) f.frequency.exponentialRampToValueAtTime(F(v, o.f1), st + Math.max(0.005, o.sweep ?? dur));
  f.Q.value = o.q ?? (f.type === 'bandpass' ? 1 : 0.7);
  const g = ac.createGain();
  env(g.gain, st, dur, vol, o.a ?? 0.002, o.hold ?? 0);
  src.connect(f);
  f.connect(g);
  g.connect(o.to || v.out);
  src.start(st, Math.random() * 1.5);
  const stop = st + dur + 0.03;
  src.stop(stop);
  track(v, src, stop);
  return { src, f, g };
}

/** LFO added onto an AudioParam (vibrato on detune/frequency, tremolo on gain...). */
function lfo(v, param, rate, depth, t, dur, type = 'sine') {
  const ac = v.ac;
  const st = v.t + t;
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(rate, st);
  const g = ac.createGain();
  g.gain.value = depth;
  o.connect(g);
  g.connect(param);
  o.start(st);
  const stop = st + dur + 0.03;
  o.stop(stop);
  track(v, o, stop);
  return { osc: o, g };
}

/** Tremolo node: route sources into it; gain wobbles between 1-2*depth and 1. */
function trem(v, rate, depth, t, dur, type = 'sine') {
  const g = v.ac.createGain();
  g.gain.value = 1 - depth;
  g.connect(v.out);
  lfo(v, g.gain, rate, depth, t, dur, type);
  return g;
}

function filt(v, type, f, q = 0.7) {
  const b = v.ac.createBiquadFilter();
  b.type = type;
  b.frequency.value = F(v, f);
  b.Q.value = q;
  b.connect(v.out);
  return b;
}

/** Big explosion body, shared by several patches. */
function boom(v, t, s = 1) {
  noise(v, t, 0.95 * s, 0.55, { type: 'lowpass', f0: 2600, f1: 110, sweep: 0.8 * s });
  noise(v, t, 0.1, 0.32, { type: 'highpass', f0: 1800 });
  tone(v, 'sine', 105, 28, t, 0.7 * s, 0.6, { sweep: 0.5 * s });
  tone(v, 'square', 72, 30, t, 0.28, 0.13);
  noise(v, t + 0.08, 0.9 * s, 0.28, { type: 'lowpass', f0: 380, f1: 70, a: 0.12 });
}

/** Soft wooden hammer knock, shared by the building patches. */
function knock(v, t, s = 1) {
  noise(v, t, 0.03, 0.22 * s, { type: 'bandpass', f0: 1600, q: 2.5 });
  tone(v, 'triangle', 720, 540, t, 0.05, 0.2 * s, { sweep: 0.04 });
  tone(v, 'sine', 210, 110, t, 0.06, 0.3 * s);
}

// ---------------------------------------------------------------------------------------------
// SFX patches. meta: cd = per-name cooldown (s), max = concurrent voices of this name,
// prio = steal priority (higher wins), vary = random pitch spread, duck = music duck time (s).
// ---------------------------------------------------------------------------------------------

const PATCHES = {};
function def(name, fn, meta = {}) {
  PATCHES[name] = {
    fn,
    cd: meta.cd ?? 0.035,
    max: meta.max ?? 4,
    prio: meta.prio ?? 1,
    vary: meta.vary ?? 0,
    duck: meta.duck ?? 0,
  };
}

// --- UI ---
def('ui_click', (v) => {
  tone(v, 'square', 1800, 1100, 0, 0.035, 0.12, { sweep: 0.03 });
  tone(v, 'triangle', 900, null, 0, 0.045, 0.22);
}, { cd: 0.025, prio: 2, max: 3 });

def('ui_back', (v) => {
  tone(v, 'pulse25', 880, 660, 0, 0.05, 0.2);
  tone(v, 'pulse25', 587, 440, 0.055, 0.08, 0.2);
}, { cd: 0.05, prio: 2 });

def('ui_error', (v) => {
  for (const t of [0, 0.11]) {
    tone(v, 'square', 155, 145, t, 0.09, 0.15, { hold: 0.05 });
    tone(v, 'sawtooth', 104, null, t, 0.09, 0.1, { hold: 0.05 });
  }
}, { cd: 0.15, prio: 2, max: 1 });

def('card_select', (v) => {
  tone(v, 'triangle', 520, 790, 0, 0.08, 0.3, { sweep: 0.03 });
  tone(v, 'pulse12', 1580, null, 0.01, 0.04, 0.08);
}, { cd: 0.03, prio: 2 });

def('deploy', (v) => {
  tone(v, 'pulse25', 250, 900, 0, 0.14, 0.2, { sweep: 0.11 });
  tone(v, 'triangle', 125, 250, 0, 0.14, 0.32, { sweep: 0.1 });
  tone(v, 'square', 1320, null, 0.11, 0.06, 0.06);
  noise(v, 0, 0.09, 0.16, { type: 'lowpass', f0: 2200, f1: 400 });
}, { cd: 0.05, vary: 0.02 });

def('elixir_full', (v) => {
  tone(v, 'sine', 480, 1150, 0, 0.12, 0.3, { sweep: 0.08 });
  tone(v, 'triangle', M(84), null, 0.08, 0.28, 0.16);
  tone(v, 'triangle', M(91), null, 0.14, 0.32, 0.1);
}, { cd: 0.3, prio: 2, max: 1 });

// --- Weapons ---
def('shoot_pistol', (v) => {
  noise(v, 0, 0.07, 0.34, { type: 'bandpass', f0: 2600, f1: 900, q: 0.8 });
  tone(v, 'square', 820, 170, 0, 0.08, 0.15);
  tone(v, 'sine', 160, 70, 0, 0.06, 0.25);
}, { prio: 0, vary: 0.06 });

def('shoot_rifle', (v) => {
  noise(v, 0, 0.1, 0.38, { type: 'lowpass', f0: 6500, f1: 700 });
  tone(v, 'square', 520, 90, 0, 0.09, 0.16);
  tone(v, 'sine', 150, 50, 0, 0.09, 0.4);
}, { prio: 0, vary: 0.05 });

def('shoot_shotgun', (v) => {
  noise(v, 0, 0.26, 0.5, { type: 'lowpass', f0: 4200, f1: 300 });
  noise(v, 0, 0.04, 0.28, { type: 'highpass', f0: 3000 });
  tone(v, 'sine', 170, 40, 0, 0.2, 0.55);
  tone(v, 'square', 300, 60, 0, 0.1, 0.12);
  noise(v, 0.28, 0.04, 0.12, { type: 'bandpass', f0: 1800, q: 4 }); // pump: chk-
  noise(v, 0.36, 0.04, 0.12, { type: 'bandpass', f0: 1400, q: 4 }); //        -chk
}, { cd: 0.06, prio: 0, max: 3, vary: 0.04 });

def('shoot_laser', (v) => {
  tone(v, 'square', 1700, 210, 0, 0.16, 0.2);
  tone(v, 'sawtooth', 1730, 215, 0, 0.16, 0.08);
}, { prio: 0, vary: 0.05 });

def('shoot_rocket', (v) => {
  tone(v, 'sine', 130, 45, 0, 0.2, 0.5);
  noise(v, 0, 0.12, 0.25, { type: 'lowpass', f0: 1500, f1: 300 });
  noise(v, 0.02, 0.5, 0.25, { type: 'bandpass', f0: 450, f1: 2400, q: 1.2, a: 0.06 });
  tone(v, 'sawtooth', 85, 170, 0.02, 0.45, 0.06);
}, { cd: 0.06, prio: 0, max: 3, vary: 0.04 });

def('shoot_sniper', (v) => {
  noise(v, 0, 0.06, 0.45, { type: 'highpass', f0: 1400 });
  tone(v, 'square', 1500, 70, 0, 0.3, 0.16, { sweep: 0.2 });
  tone(v, 'sine', 120, 38, 0, 0.3, 0.4);
  noise(v, 0.14, 0.18, 0.1, { type: 'bandpass', f0: 1300, f1: 400 }); // echo off the walls
  noise(v, 0.3, 0.2, 0.05, { type: 'bandpass', f0: 900, f1: 300 });
}, { cd: 0.08, prio: 0, max: 2 });

def('shoot_flame', (v) => {
  const tr = trem(v, 23, 0.3, 0, 0.3, 'square');
  noise(v, 0, 0.3, 0.42, { type: 'bandpass', f0: 800, f1: 500, q: 0.7, a: 0.03, to: tr });
  for (let i = 0; i < 4; i++) noise(v, 0.03 + rnd(0, 0.22), 0.015, 0.14, { type: 'highpass', f0: 3500 });
}, { cd: 0.06, prio: 0, max: 3, vary: 0.05 });

def('shoot_zap', (v) => {
  const z = tone(v, 'sawtooth', 900, null, 0, 0.16, 0.13);
  for (let i = 1; i < 9; i++) z.osc.frequency.setValueAtTime(F(v, rnd(250, 1700)), v.t + i * 0.017);
  tone(v, 'square', 3000, 500, 0, 0.09, 0.06);
  noise(v, 0, 0.05, 0.18, { type: 'highpass', f0: 5000 });
}, { prio: 0, vary: 0.05 });

def('shoot_minigun', (v) => {
  noise(v, 0, 0.04, 0.28, { type: 'bandpass', f0: 3000, f1: 1200, q: 0.7 });
  tone(v, 'square', 680, 200, 0, 0.045, 0.11);
  tone(v, 'sine', 140, 70, 0, 0.04, 0.22);
}, { cd: 0.03, prio: 0, max: 3, vary: 0.08 });

// --- Combat ---
def('melee_hit', (v) => {
  noise(v, 0, 0.08, 0.4, { type: 'lowpass', f0: 2200, f1: 400 });
  tone(v, 'sine', 210, 55, 0, 0.1, 0.5);
  tone(v, 'square', 320, 100, 0, 0.04, 0.1);
}, { prio: 0, vary: 0.08 });

def('sword_slash', (v) => {
  noise(v, 0, 0.14, 0.45, { type: 'bandpass', f0: 1100, f1: 6500, q: 1.4, a: 0.04 });
  tone(v, 'triangle', 2650, 2500, 0.05, 0.14, 0.07);
  tone(v, 'pulse12', 3720, null, 0.05, 0.07, 0.03);
}, { prio: 0, vary: 0.06 });

def('arrow', (v) => {
  tone(v, 'triangle', 1000, 520, 0, 0.07, 0.25);
  noise(v, 0.01, 0.13, 0.15, { type: 'highpass', f0: 2800, f1: 6000, a: 0.04 });
}, { prio: 0, vary: 0.07 });

def('magic', (v) => {
  [84, 88, 91, 96, 93].forEach((m, i) => tone(v, i & 1 ? 'triangle' : 'sine', M(m), null, i * 0.035, 0.2, 0.12));
  const sw = tone(v, 'triangle', 400, 1300, 0, 0.32, 0.1, { a: 0.05 });
  lfo(v, sw.osc.detune, 14, 40, 0, 0.32);
}, { vary: 0.04 });

def('explosion_small', (v) => {
  noise(v, 0, 0.4, 0.6, { type: 'lowpass', f0: 3600, f1: 250 });
  tone(v, 'sine', 135, 38, 0, 0.32, 0.6);
  tone(v, 'square', 90, 40, 0, 0.13, 0.12);
}, { cd: 0.04, max: 4, vary: 0.06 });

def('explosion_big', (v) => boom(v, 0, 1), { cd: 0.06, prio: 2, max: 3, vary: 0.04 });

def('meteor', (v) => {
  tone(v, 'sine', 2300, 380, 0, 0.5, 0.16, { a: 0.12, hold: 0.25 }); // falling whistle
  tone(v, 'triangle', 2320, 384, 0, 0.5, 0.06, { a: 0.12, hold: 0.25 });
  noise(v, 0, 0.5, 0.12, { type: 'bandpass', f0: 800, f1: 2000, a: 0.4 });
  boom(v, 0.46, 1.1);
}, { cd: 0.08, prio: 2, max: 3 });

def('lightning', (v) => {
  noise(v, 0, 0.09, 0.7, { type: 'highpass', f0: 1800 });
  for (let i = 0; i < 8; i++) {
    noise(v, i * 0.035 + rnd(0, 0.02), 0.03, 0.32 * (1 - i / 10), { type: 'bandpass', f0: rnd(1800, 6000), q: 1.2 });
  }
  const z = tone(v, 'sawtooth', 70, null, 0, 0.32, 0.18);
  for (let i = 1; i < 10; i++) z.osc.frequency.setValueAtTime(F(v, rnd(40, 140)), v.t + i * 0.03);
  noise(v, 0.05, 0.8, 0.35, { type: 'lowpass', f0: 700, f1: 90, a: 0.03 });
  tone(v, 'sine', 85, 34, 0.02, 0.55, 0.45);
}, { cd: 0.06, prio: 2, max: 3 });

def('freeze', (v) => {
  noise(v, 0, 0.05, 0.3, { type: 'bandpass', f0: 4200, q: 2 });
  [2093, 2637, 3136, 3520, 4186].forEach((f, i) => {
    const t = 0.02 + i * 0.035;
    tone(v, 'triangle', f, null, t, 0.65 - i * 0.06, 0.08);
    tone(v, 'sine', f * 1.006, null, t, 0.6 - i * 0.06, 0.05); // slow beating = glassy shimmer
  });
  noise(v, 0, 0.6, 0.07, { type: 'highpass', f0: 6500, a: 0.15 });
  tone(v, 'sine', 5200, 2600, 0, 0.3, 0.035);
}, { cd: 0.06, max: 3 });

def('heal', (v) => {
  [72, 76, 79, 84].forEach((m, i) => {
    tone(v, 'triangle', M(m), null, i * 0.07, 0.45, 0.17, { a: 0.02 });
    tone(v, 'sine', M(m + 12), null, i * 0.07, 0.35, 0.05, { a: 0.02 });
  });
  noise(v, 0.05, 0.45, 0.04, { type: 'highpass', f0: 7000, a: 0.2 });
}, { cd: 0.08, max: 2 });

def('poison', (v) => {
  for (let i = 0; i < 6; i++) {
    tone(v, 'sine', rnd(240, 420), rnd(700, 1200), i * 0.065 + rnd(0, 0.03), 0.07, 0.24, { sweep: 0.05 });
  }
  noise(v, 0, 0.4, 0.1, { type: 'lowpass', f0: 900, f1: 350 });
  tone(v, 'sawtooth', 70, 55, 0, 0.35, 0.05);
}, { cd: 0.06, vary: 0.05 });

def('fire_ignite', (v) => {
  noise(v, 0, 0.45, 0.4, { type: 'bandpass', f0: 280, f1: 2600, q: 0.9, a: 0.12 });
  for (let i = 0; i < 6; i++) noise(v, 0.12 + rnd(0, 0.33), 0.012, 0.18, { type: 'highpass', f0: 3000 });
  tone(v, 'sine', 90, 150, 0, 0.32, 0.2, { a: 0.08 });
}, { cd: 0.06, vary: 0.05 });

// --- Towers ---
def('tower_hit', (v) => {
  noise(v, 0, 0.1, 0.38, { type: 'lowpass', f0: 1300, f1: 300 });
  tone(v, 'square', 150, 85, 0, 0.1, 0.17);
  tone(v, 'triangle', 430, 390, 0, 0.14, 0.12);
}, { cd: 0.05, vary: 0.06 });

def('tower_destroy', (v) => {
  boom(v, 0, 1.2);
  for (let i = 0; i < 7; i++) {
    noise(v, 0.15 + i * 0.08 + rnd(0, 0.04), 0.09, 0.22, { type: 'bandpass', f0: rnd(500, 1500), q: 1.5 });
  }
  tone(v, 'square', 300, 55, 0.05, 0.85, 0.08);
}, { cd: 0.1, prio: 3, max: 2, duck: 0.8 });

def('king_activate', (v) => {
  [67, 74].forEach((m) => tone(v, 'sawtooth', M(m), null, 0, 0.16, 0.1, { hold: 0.08 }));
  [72, 76, 79, 84].forEach((m) => tone(v, 'pulse25', M(m), null, 0.18, 0.6, 0.08, { hold: 0.25 }));
  tone(v, 'triangle', M(48), null, 0.18, 0.6, 0.3, { hold: 0.2 });
  tone(v, 'sine', 160, 45, 0, 0.18, 0.5);
  tone(v, 'sine', 160, 45, 0.18, 0.22, 0.55);
  noise(v, 0.18, 0.18, 0.3, { type: 'bandpass', f0: 2200, q: 0.7 });
}, { cd: 0.3, prio: 3, max: 1 });

// --- Units & heroes ---
def('unit_die', (v) => {
  tone(v, 'square', 620, 130, 0, 0.18, 0.2);
  noise(v, 0.02, 0.12, 0.18, { type: 'lowpass', f0: 1600, f1: 300 });
}, { prio: 0, vary: 0.1 });

def('hero_die', (v) => {
  const d = tone(v, 'square', 880, 110, 0, 0.6, 0.16);
  lfo(v, d.osc.detune, 11, 60, 0, 0.6);
  noise(v, 0, 0.16, 0.3, { type: 'lowpass', f0: 2600, f1: 300 });
  tone(v, 'triangle', 131, 65, 0.52, 0.4, 0.35);
  tone(v, 'sine', 98, 49, 0.52, 0.4, 0.3);
}, { cd: 0.2, prio: 3, max: 1 });

def('hero_respawn', (v) => {
  tone(v, 'triangle', 260, 1050, 0, 0.45, 0.22, { a: 0.05, sweep: 0.4 });
  [72, 76, 79, 84, 88].forEach((m, i) => tone(v, 'pulse12', M(m), null, 0.06 + i * 0.07, 0.14, 0.09));
  noise(v, 0, 0.45, 0.06, { type: 'bandpass', f0: 1000, f1: 7000, a: 0.3 });
}, { cd: 0.2, prio: 3, max: 1 });

def('form_upgrade', (v) => {
  for (let i = 0; i < 16; i++) tone(v, 'pulse25', M(60 + i), null, i * 0.03, 0.05, 0.1);
  noise(v, 0, 0.5, 0.15, { type: 'bandpass', f0: 500, f1: 5000, a: 0.45 });
  [72, 76, 79, 84].forEach((m) => {
    tone(v, 'pulse25', M(m), null, 0.5, 0.8, 0.06, { hold: 0.3 });
    tone(v, 'triangle', M(m), null, 0.5, 0.9, 0.08, { hold: 0.3 });
  });
  tone(v, 'triangle', M(48), null, 0.5, 0.8, 0.3, { hold: 0.3 });
  tone(v, 'sine', 140, 40, 0.5, 0.3, 0.4);
  noise(v, 0.5, 0.6, 0.18, { type: 'highpass', f0: 5000 });
}, { cd: 0.3, prio: 4, max: 1, duck: 1.4 });

// --- Economy & rewards ---
def('brick_collect', (v) => {
  tone(v, 'square', M(67), null, 0, 0.05, 0.11);
  tone(v, 'square', M(74), null, 0.05, 0.1, 0.11);
  tone(v, 'triangle', 200, 150, 0, 0.09, 0.32);
  noise(v, 0, 0.03, 0.15, { type: 'bandpass', f0: 1500, q: 2 });
}, { cd: 0.04, vary: 0.03 });

def('coin', (v) => {
  tone(v, 'pulse25', M(83), null, 0, 0.09, 0.22, { hold: 0.06 });
  tone(v, 'pulse25', M(88), null, 0.075, 0.4, 0.22, { hold: 0.06 });
}, { cd: 0.04, prio: 2, max: 4 });

def('gem', (v) => {
  [88, 92, 95, 100].forEach((m, i) => tone(v, i & 1 ? 'pulse12' : 'triangle', M(m), null, i * 0.045, 0.22, 0.19));
  tone(v, 'sine', M(107), null, 0.16, 0.35, 0.05);
  tone(v, 'sine', M(107) * 1.007, null, 0.17, 0.35, 0.04);
}, { cd: 0.05, prio: 2, max: 3 });

def('chest_open', (v) => {
  noise(v, 0, 0.09, 0.35, { type: 'lowpass', f0: 900, f1: 200 });
  tone(v, 'sine', 110, 55, 0, 0.14, 0.4);
  tone(v, 'square', 200, 650, 0.08, 0.09, 0.1);
  [72, 76, 79, 84].forEach((m, i) => tone(v, 'pulse25', M(m), null, 0.16 + i * 0.06, 0.16, 0.13));
  [84, 88, 91].forEach((m) => tone(v, 'triangle', M(m), null, 0.4, 0.7, 0.08, { hold: 0.15 }));
  noise(v, 0.4, 0.5, 0.06, { type: 'highpass', f0: 6500, a: 0.05 });
}, { cd: 0.2, prio: 3, max: 2 });

def('card_reveal', (v) => {
  noise(v, 0, 0.2, 0.18, { type: 'bandpass', f0: 600, f1: 3500, a: 0.14 });
  tone(v, 'pulse25', M(91), null, 0.16, 0.38, 0.12);
  tone(v, 'triangle', M(79), null, 0.16, 0.42, 0.15);
  tone(v, 'sine', M(103), null, 0.16, 0.25, 0.04);
}, { cd: 0.08, prio: 3, max: 2 });

def('rarity_up', (v) => {
  [72, 76, 79, 83, 86, 91].forEach((m, i) => tone(v, 'pulse25', M(m), null, i * 0.05, 0.12, 0.12));
  [79, 83, 86, 91].forEach((m) => {
    tone(v, 'triangle', M(m), null, 0.32, 0.65, 0.08, { hold: 0.2 });
    tone(v, 'pulse12', M(m + 12), null, 0.32, 0.45, 0.03, { hold: 0.1 });
  });
  noise(v, 0.3, 0.5, 0.06, { type: 'highpass', f0: 6000 });
}, { cd: 0.15, prio: 3, max: 2 });

// --- Match flow jingles ---
def('victory', (v) => {
  const lead = [[67, 0, 0.1], [72, 0.1, 0.1], [76, 0.2, 0.1], [79, 0.3, 0.22], [76, 0.54, 0.1], [79, 0.65, 0.2], [84, 0.86, 0.8]];
  for (const [m, t, d] of lead) {
    tone(v, 'pulse25', M(m), null, t, d + 0.05, 0.13, { hold: d * 0.6 });
    tone(v, 'pulse12', M(m + 12), null, t, d, 0.03, { hold: d * 0.4 });
  }
  for (const [m, t, d] of [[48, 0, 0.3], [55, 0.3, 0.5], [48, 0.86, 0.85]]) {
    tone(v, 'triangle', M(m), null, t, d, 0.32, { hold: d * 0.7 });
  }
  [64, 67, 72].forEach((m) => tone(v, 'triangle', M(m), null, 0.86, 0.9, 0.07, { hold: 0.4 }));
  [0, 0.3, 0.65, 0.86].forEach((t) => tone(v, 'sine', 150, 45, t, 0.16, 0.45));
  noise(v, 0.86, 0.7, 0.12, { type: 'highpass', f0: 5000 });
}, { cd: 1, prio: 4, max: 1, duck: 2 });

def('defeat', (v) => {
  const f = filt(v, 'lowpass', 1400, 2);
  for (const [m, t, d] of [[67, 0, 0.3], [66, 0.32, 0.3], [65, 0.64, 0.3]]) {
    tone(v, 'sawtooth', M(m), M(m) * 0.97, t, d, 0.22, { hold: d * 0.5, to: f });
    tone(v, 'triangle', M(m - 24), null, t, d, 0.25, { hold: d * 0.5 });
  }
  const w = tone(v, 'sawtooth', M(64), M(63), 0.96, 1.0, 0.22, { hold: 0.5, to: f });
  lfo(v, w.osc.detune, 6, 30, 1.0, 0.95);
  tone(v, 'triangle', M(40), null, 0.96, 1.0, 0.28, { hold: 0.5 });
}, { cd: 1, prio: 4, max: 1, duck: 2.2 });

def('draw', (v) => {
  for (const [m, t, d] of [[72, 0, 0.14], [76, 0.15, 0.14], [74, 0.3, 0.55]]) {
    tone(v, 'pulse25', M(m), null, t, d, 0.13, { hold: d * 0.5 });
  }
  const h = tone(v, 'pulse12', M(74), null, 0.3, 0.55, 0.04, { hold: 0.2 });
  lfo(v, h.osc.detune, 6, 20, 0.3, 0.55);
  for (const [m, t, d] of [[48, 0, 0.28], [43, 0.3, 0.6]]) tone(v, 'triangle', M(m), null, t, d, 0.3, { hold: d * 0.5 });
}, { cd: 1, prio: 4, max: 1, duck: 1.2 });

def('countdown', (v) => {
  tone(v, 'square', 880, null, 0, 0.16, 0.15, { hold: 0.08 });
  tone(v, 'triangle', 440, null, 0, 0.16, 0.2, { hold: 0.08 });
}, { cd: 0.2, prio: 3, max: 2 });

def('fight', (v) => {
  tone(v, 'square', 1760, null, 0, 0.4, 0.12, { hold: 0.18 });
  tone(v, 'triangle', 880, null, 0, 0.4, 0.2, { hold: 0.18 });
  [72, 76, 79].forEach((m) => tone(v, 'sawtooth', M(m), null, 0, 0.32, 0.06, { hold: 0.1 }));
  noise(v, 0, 0.3, 0.25, { type: 'highpass', f0: 3000 });
  tone(v, 'sine', 160, 40, 0, 0.25, 0.6);
}, { cd: 0.3, prio: 3, max: 1 });

def('overtime', (v) => {
  for (let i = 0; i < 4; i++) tone(v, 'square', i & 1 ? 660 : 880, null, i * 0.16, 0.14, 0.12, { hold: 0.08 });
  [0, 0.32].forEach((t) => tone(v, 'sine', 130, 45, t, 0.22, 0.5));
  tone(v, 'sawtooth', 110, 220, 0, 0.64, 0.06, { a: 0.1 });
}, { cd: 0.5, prio: 3, max: 1 });

def('double_elixir', (v) => {
  tone(v, 'pulse25', 300, 1200, 0, 0.25, 0.16, { sweep: 0.22 });
  tone(v, 'pulse25', 450, 1800, 0.22, 0.3, 0.16, { sweep: 0.26 });
  [84, 88, 91, 96].forEach((m, i) => tone(v, 'pulse12', M(m), null, 0.48 + i * 0.05, 0.18, 0.08));
  for (let i = 0; i < 3; i++) tone(v, 'sine', 400, 1000, 0.05 + i * 0.12, 0.06, 0.16, { sweep: 0.05 });
}, { cd: 0.5, prio: 3, max: 1 });

def('emote', (v) => {
  tone(v, 'square', 1100, 1500, 0, 0.06, 0.16, { sweep: 0.04 });
  tone(v, 'square', 1500, 2000, 0.07, 0.08, 0.16, { sweep: 0.05 });
}, { cd: 0.1, prio: 2, max: 2 });

def('level_up', (v) => {
  [72, 76, 79, 84].forEach((m, i) => tone(v, 'pulse25', M(m), null, i * 0.07, 0.12, 0.13));
  [88, 91, 88, 91].forEach((m, i) => tone(v, 'pulse12', M(m), null, 0.28 + i * 0.045, 0.05, 0.06));
  [84, 88, 91].forEach((m) => {
    tone(v, 'triangle', M(m), null, 0.3, 0.9, 0.08, { hold: 0.35 });
    tone(v, 'pulse25', M(m - 12), null, 0.3, 0.8, 0.04, { hold: 0.3 });
  });
  tone(v, 'triangle', M(48), M(60), 0, 0.3, 0.3, { sweep: 0.28 });
  tone(v, 'triangle', M(48), null, 0.3, 0.8, 0.3, { hold: 0.3 });
  noise(v, 0.3, 0.6, 0.1, { type: 'highpass', f0: 5500 });
}, { cd: 0.5, prio: 4, max: 1, duck: 1.2 });

// --- World / RTS / god powers ---
def('build', (v) => {
  for (let i = 0; i < 3; i++) {
    const t = i * 0.11;
    noise(v, t, 0.045, 0.32, { type: 'bandpass', f0: 1800, q: 3 });
    tone(v, 'square', 220, 150, t, 0.05, 0.13);
    tone(v, 'triangle', 900, 840, t, 0.04, 0.08);
  }
}, { cd: 0.08, vary: 0.05 });

def('earthquake', (v) => {
  const tr = trem(v, 9, 0.35, 0, 1.6);
  noise(v, 0, 1.6, 0.65, { type: 'lowpass', f0: 220, f1: 90, a: 0.15, to: tr });
  tone(v, 'sine', 48, 32, 0, 1.6, 0.6, { a: 0.1, to: tr });
  tone(v, 'sawtooth', 55, 40, 0, 1.4, 0.06, { a: 0.2 });
  for (let i = 0; i < 6; i++) noise(v, 0.1 + rnd(0, 1.2), 0.1, 0.18, { type: 'bandpass', f0: rnd(300, 900), q: 2 });
}, { cd: 0.25, prio: 2, max: 2 });

def('black_hole', (v) => {
  const f = filt(v, 'lowpass', 1600);
  f.frequency.setValueAtTime(F(v, 1600), v.t);
  f.frequency.exponentialRampToValueAtTime(F(v, 180), v.t + 1.3);
  const s = tone(v, 'sawtooth', 420, 45, 0, 1.3, 0.2, { to: f, a: 0.05 });
  const l = lfo(v, s.osc.detune, 6, 120, 0, 1.3);
  l.osc.frequency.linearRampToValueAtTime(22, v.t + 1.3); // the swirl speeds up as it collapses
  noise(v, 0, 1.0, 0.32, { type: 'bandpass', f0: 3000, f1: 200, q: 1.5, a: 0.9 });
  tone(v, 'sine', 75, 30, 0.95, 0.5, 0.6);
}, { cd: 0.2, prio: 2, max: 2 });

def('zombie_infect', (v) => {
  const f = filt(v, 'bandpass', 550, 3);
  const g = tone(v, 'sawtooth', 150, 92, 0, 0.65, 0.55, { a: 0.06, to: f });
  lfo(v, g.osc.detune, 5, 35, 0, 0.65);
  noise(v, 0, 0.14, 0.25, { type: 'bandpass', f0: 700, f1: 280, q: 4 });
  tone(v, 'sine', 300, 120, 0.02, 0.12, 0.15);
}, { cd: 0.1, vary: 0.06 });

def('sheep', (v) => {
  // "b-aa-aa-a": a buzzy source through three vowel formants, opening from "b" to "aa",
  // with a fast pitch/amplitude wobble for the bleat.
  const ac = v.ac;
  const st = v.t;
  const tr = trem(v, 23, 0.45, 0, 0.62);
  const split = ac.createGain();
  [[900, 7, 1], [1350, 9, 0.6], [2700, 12, 0.25]].forEach(([fq, q, g], i) => {
    const b = ac.createBiquadFilter();
    b.type = 'bandpass';
    b.Q.value = q;
    if (i === 0) {
      b.frequency.setValueAtTime(F(v, 350), st);
      b.frequency.linearRampToValueAtTime(F(v, fq), st + 0.07);
    } else b.frequency.value = F(v, fq);
    const gg = ac.createGain();
    gg.gain.value = g * 2.4;
    split.connect(b);
    b.connect(gg);
    gg.connect(tr);
  });
  const z = tone(v, 'sawtooth', 290, null, 0, 0.62, 0.6, { a: 0.03, hold: 0.4, to: split });
  z.osc.frequency.linearRampToValueAtTime(F(v, 330), st + 0.08);
  z.osc.frequency.exponentialRampToValueAtTime(F(v, 245), st + 0.6);
  lfo(v, z.osc.detune, 23, 30, 0, 0.62);
  tone(v, 'pulse12', 580, 500, 0, 0.5, 0.025, { a: 0.03, to: tr });
  noise(v, 0, 0.06, 0.06, { type: 'bandpass', f0: 1200 });
}, { cd: 0.15, max: 3, vary: 0.08 });

def('dragon_roar', (v) => {
  const ac = v.ac;
  const st = v.t;
  const sh = ac.createWaveShaper();
  sh.curve = driveCurve(ac);
  const f = ac.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = 3;
  f.frequency.setValueAtTime(F(v, 500), st);
  f.frequency.linearRampToValueAtTime(F(v, 1400), st + 0.25);
  f.frequency.exponentialRampToValueAtTime(F(v, 300), st + 1.2);
  const tr = trem(v, 27, 0.4, 0, 1.25);
  sh.connect(f);
  f.connect(tr);
  [95, 101, 143].forEach((hz) => {
    const z = tone(v, 'sawtooth', hz, null, 0, 1.25, 0.22, { a: 0.08, hold: 0.6, to: sh });
    z.osc.frequency.linearRampToValueAtTime(F(v, hz * 1.25), st + 0.25);
    z.osc.frequency.exponentialRampToValueAtTime(F(v, hz * 0.6), st + 1.2);
  });
  noise(v, 0, 1.2, 0.3, { type: 'bandpass', f0: 700, f1: 260, q: 0.8, a: 0.1, to: tr });
}, { cd: 0.3, prio: 2, max: 2 });

def('ufo', (v) => {
  const a = tone(v, 'sine', 520, 900, 0, 0.9, 0.2, { a: 0.05, hold: 0.6, lin: true });
  lfo(v, a.osc.frequency, 11, 130, 0, 0.9);
  const b = tone(v, 'triangle', 1040, 1800, 0, 0.9, 0.07, { a: 0.05, hold: 0.6, lin: true });
  lfo(v, b.osc.frequency, 11, 260, 0, 0.9);
}, { cd: 0.2, max: 2 });

def('splash', (v) => {
  noise(v, 0, 0.05, 0.3, { type: 'highpass', f0: 2000 });
  noise(v, 0, 0.38, 0.42, { type: 'bandpass', f0: 2600, f1: 450, q: 0.8 });
  [0.12, 0.19, 0.27].forEach((t) => tone(v, 'sine', rnd(380, 520), rnd(850, 1100), t, 0.06, 0.18, { sweep: 0.05 }));
}, { cd: 0.05, vary: 0.06 });

def('mine_pick', (v) => {
  tone(v, 'square', 1870, null, 0, 0.06, 0.07);
  tone(v, 'triangle', 2810, null, 0, 0.14, 0.12);
  tone(v, 'sine', 4230, null, 0, 0.1, 0.05);
  noise(v, 0, 0.04, 0.32, { type: 'bandpass', f0: 2500, q: 1.5 });
  tone(v, 'sine', 190, 90, 0, 0.07, 0.35);
}, { cd: 0.06, prio: 0, vary: 0.06 });

def('nuke', (v) => {
  noise(v, 0, 0.16, 0.6, { type: 'highpass', f0: 900 });
  tone(v, 'sine', 95, 24, 0, 1.6, 0.6, { sweep: 1.4 });
  tone(v, 'square', 70, 25, 0, 0.6, 0.13);
  const tr = trem(v, 7, 0.3, 0.3, 3.2);
  noise(v, 0, 3.6, 0.55, { type: 'lowpass', f0: 1400, f1: 75, sweep: 3.3, a: 0.04, hold: 0.9, to: tr });
  noise(v, 0.25, 2.8, 0.25, { type: 'bandpass', f0: 500, f1: 120, a: 0.3 });
  tone(v, 'sawtooth', 220, 30, 0.1, 3, 0.05, { a: 0.3 });
}, { cd: 1, prio: 4, max: 1, duck: 3 });

// --- Realm: village, ages, day/night ---
def('horn', (v) => {
  // Brass: detuned saws scoop up into pitch while a lowpass opens with the swell, then sag off.
  const st = v.t;
  const f = filt(v, 'lowpass', 400, 1.2);
  f.frequency.setValueAtTime(F(v, 400), st);
  f.frequency.linearRampToValueAtTime(F(v, 1700), st + 0.3);
  f.frequency.exponentialRampToValueAtTime(F(v, 500), st + 0.9);
  for (const d of [-9, 9]) {
    const h = tone(v, 'sawtooth', M(45) * 0.93, M(45), 0, 0.9, 0.14, { a: 0.16, hold: 0.5, sweep: 0.12, detune: d, to: f });
    h.osc.frequency.setValueAtTime(F(v, M(45)), st + 0.7);
    h.osc.frequency.exponentialRampToValueAtTime(F(v, M(45) * 0.94), st + 0.9);
    lfo(v, h.osc.detune, 5.5, 10, 0.3, 0.6);
  }
  tone(v, 'square', M(45), null, 0.03, 0.85, 0.04, { a: 0.2, hold: 0.4, to: f });
  tone(v, 'triangle', M(33), null, 0, 0.9, 0.24, { a: 0.15, hold: 0.5 });
  noise(v, 0, 0.3, 0.05, { type: 'bandpass', f0: 900, q: 1, a: 0.1 }); // breath
}, { cd: 0.4, prio: 3, max: 1 });

def('built', (v) => {
  knock(v, 0);
  knock(v, 0.09);
  [79, 84, 88].forEach((m, i) => {
    tone(v, 'triangle', M(m), null, 0.2 + i * 0.06, i === 2 ? 0.26 : 0.12, 0.15, { hold: 0.03 });
    tone(v, 'pulse12', M(m + 12), null, 0.2 + i * 0.06, 0.08, 0.03);
  });
  noise(v, 0.32, 0.22, 0.04, { type: 'highpass', f0: 7000 });
}, { cd: 0.1, prio: 2, max: 2, vary: 0.02 });

def('hammer', (v) => knock(v, 0, 0.7), { cd: 0.05, prio: 0, max: 3, vary: 0.08 });

def('age_up', (v) => {
  // Gong: inharmonic sine partials that settle slightly flat, a beating pair and a mallet thump.
  [[1, 0.3, 1.4], [1.52, 0.12, 1.1], [2.03, 0.09, 0.9], [2.74, 0.06, 0.7], [3.9, 0.03, 0.5]].forEach(([r, vol, d]) => {
    tone(v, 'sine', 98 * r * 1.02, 98 * r, 0, d, vol, { sweep: 0.3 });
  });
  tone(v, 'sine', 98 * 1.012, null, 0, 1.3, 0.12);
  noise(v, 0, 0.14, 0.22, { type: 'lowpass', f0: 1200, f1: 200 });
  for (const [m, t, d] of [[67, 0.3, 0.1], [72, 0.42, 0.1], [76, 0.54, 0.1], [79, 0.66, 0.68]]) {
    tone(v, 'pulse25', M(m), null, t, d + 0.05, 0.12, { hold: d * 0.6 });
    tone(v, 'triangle', M(m - 12), null, t, d + 0.05, 0.1, { hold: d * 0.6 });
  }
  [64, 72].forEach((m) => tone(v, 'triangle', M(m), null, 0.66, 0.7, 0.07, { hold: 0.3 }));
  tone(v, 'triangle', M(48), null, 0.66, 0.7, 0.28, { hold: 0.3 });
  noise(v, 0.66, 0.6, 0.08, { type: 'highpass', f0: 5500 });
}, { cd: 1, prio: 4, max: 1, duck: 1.4 });

def('night', (v) => {
  const w = noise(v, 0, 1.2, 0.08, { type: 'bandpass', f0: 350, f1: 900, sweep: 0.6, q: 2, a: 0.4 }); // wind
  w.f.frequency.exponentialRampToValueAtTime(F(v, 300), v.t + 1.2);
  [[75, 0], [72, 0.3]].forEach(([m, t]) => {
    tone(v, 'sine', M(m), null, t, 0.85, 0.15);
    tone(v, 'triangle', M(m - 12), null, t, 0.7, 0.07);
    tone(v, 'sine', M(m) * 2.76, null, t, 0.3, 0.025); // bell overtone
  });
  [0.62, 0.86].forEach((t, i) => tone(v, 'sine', 392, 350, t, 0.2 + i * 0.12, 0.1, { a: 0.05 })); // owl: hoo-hoo
}, { cd: 1, prio: 3, max: 1 });

def('dawn', (v) => {
  [65, 69, 72, 77, 81].forEach((m, i) => {
    tone(v, 'triangle', M(m), null, i * 0.08, 0.6 - i * 0.04, 0.14, { a: 0.03 });
    tone(v, 'sine', M(m + 12), null, i * 0.08, 0.4, 0.04, { a: 0.03 });
  });
  tone(v, 'triangle', M(53), null, 0, 0.9, 0.18, { a: 0.2, hold: 0.3 });
  [93, 96, 100].forEach((m, i) => tone(v, 'pulse12', M(m), null, 0.42 + i * 0.06, 0.12, 0.03)); // sparkle
  noise(v, 0.35, 0.5, 0.04, { type: 'highpass', f0: 7000, a: 0.15 });
}, { cd: 1, prio: 3, max: 1 });

def('raid', (v) => {
  for (const t of [0, 0.2, 0.4]) {
    [[1, 0.14, 0.38], [2.42, 0.06, 0.25], [3.9, 0.03, 0.15], [5.4, 0.015, 0.1]].forEach(([r, vol, d]) => {
      tone(v, 'sine', 980 * r, null, t, d, vol);
    });
    tone(v, 'sine', 980 * 1.008, null, t, 0.38, 0.08); // beating = ringing bell
    tone(v, 'square', 980, null, t, 0.04, 0.05);
    noise(v, t, 0.02, 0.15, { type: 'bandpass', f0: 3500, q: 1.5 }); // clapper
  }
}, { cd: 0.6, prio: 3, max: 1 });

def('wolf_howl', (v) => {
  // "a-woooo": glide up from a low yip, hold with a widening vibrato, then sag away.
  const st = v.t;
  const oscs = [['sine', 1, 0.22], ['triangle', 2, 0.03]].map(([type, r, vol]) => {
    const h = tone(v, type, 300 * r, 560 * r, 0, 1, vol, { a: 0.08, hold: 0.5, sweep: 0.25 });
    h.osc.frequency.setValueAtTime(F(v, 560 * r), st + 0.6);
    h.osc.frequency.exponentialRampToValueAtTime(F(v, 380 * r), st + 1);
    return h.osc;
  });
  const l = lfo(v, oscs[0].detune, 5.5, 0, 0, 1);
  l.g.connect(oscs[1].detune);
  l.g.gain.setValueAtTime(0, st + 0.25);
  l.g.gain.linearRampToValueAtTime(35, st + 0.75);
  noise(v, 0, 0.9, 0.03, { type: 'bandpass', f0: 600, f1: 1100, q: 3, a: 0.2 }); // breath
}, { cd: 0.4, max: 2, vary: 0.05 });

def('relic', (v) => {
  [79, 83, 86, 90, 91, 95].forEach((m, i) => tone(v, i & 1 ? 'pulse12' : 'triangle', M(m), null, i * 0.05, 0.2, 0.13));
  const tr = trem(v, 10, 0.35, 0.3, 0.7);
  [91, 95, 98].forEach((m) => {
    tone(v, 'sine', M(m), null, 0.3, 0.7, 0.06, { a: 0.04, to: tr });
    tone(v, 'sine', M(m) * 1.006, null, 0.3, 0.7, 0.04, { a: 0.04, to: tr }); // slow beating = shimmer
  });
  tone(v, 'triangle', M(67), null, 0.3, 0.6, 0.15, { hold: 0.15 });
  noise(v, 0.2, 0.75, 0.05, { type: 'highpass', f0: 6500, a: 0.2 });
}, { cd: 0.2, prio: 3, max: 2 });

def('shrine', (v) => {
  // Choir-like "aah": each chord tone is a detuned triangle pair plus a soft sine octave,
  // swelling in together under one gentle shared vibrato.
  const f = filt(v, 'lowpass', 2400);
  const oscs = [];
  [60, 64, 67, 72].forEach((m, i) => {
    for (const d of [-7, 7]) oscs.push(tone(v, 'triangle', M(m), null, i * 0.04, 1.2, 0.07, { a: 0.35, hold: 0.35, detune: d, to: f }).osc);
    tone(v, 'sine', M(m + 12), null, i * 0.04, 1.1, 0.025, { a: 0.4, hold: 0.3 });
  });
  const l = lfo(v, oscs[0].detune, 5, 10, 0.2, 1);
  for (const o of oscs.slice(1)) l.g.connect(o.detune);
  tone(v, 'sine', M(48), null, 0, 1.2, 0.2, { a: 0.3, hold: 0.4 });
  noise(v, 0, 0.9, 0.03, { type: 'bandpass', f0: 1200, q: 0.8, a: 0.4 }); // breath
}, { cd: 0.5, prio: 3, max: 1 });

def('villager', (v) => {
  tone(v, 'sine', 500, 1100, 0, 0.06, 0.22, { sweep: 0.04 }); // pop
  tone(v, 'pulse25', M(84), null, 0.05, 0.08, 0.08);
  tone(v, 'triangle', M(88), null, 0.07, 0.08, 0.1);
}, { cd: 0.06, max: 3, vary: 0.06 });

def('faith', (v) => {
  [[84, 0], [91, 0.06]].forEach(([m, t]) => {
    tone(v, 'sine', M(m), null, t, 0.34, 0.13, { a: 0.01 });
    tone(v, 'triangle', M(m) * 1.004, null, t, 0.3, 0.05, { a: 0.01 });
  });
  noise(v, 0.04, 0.3, 0.03, { type: 'highpass', f0: 7500, a: 0.1 });
}, { cd: 0.05, max: 3, vary: 0.02 });

def('disaster', (v) => {
  const tr = trem(v, 7, 0.3, 0, 1);
  noise(v, 0, 1, 0.4, { type: 'lowpass', f0: 320, f1: 110, a: 0.2, hold: 0.3, to: tr });
  const f = filt(v, 'lowpass', 900, 1.5);
  [M(40), M(46)].forEach((hz) => tone(v, 'sawtooth', hz, hz * 0.94, 0.05, 0.95, 0.11, { a: 0.12, hold: 0.35, to: f })); // tritone
  tone(v, 'sine', 70, 40, 0, 1, 0.45, { a: 0.1 });
}, { cd: 0.6, prio: 3, max: 1, duck: 1 });

/** Every SFX name this module can play. */
export const SFX_NAMES = Object.freeze(Object.keys(PATCHES));

// ---------------------------------------------------------------------------------------------
// Music data. Melodies are written as scale degrees, one token per equal slice of the bar:
//   "1".."9" degree (8 = octave), "'" octave up, "," octave down, "#"/"b" accidental,
//   "-" hold previous note, "." rest.  8 tokens = eighth notes, 16 = sixteenths, 4 = quarters.
// Chords are scale degrees (diatonic triads), spread evenly over the section.
// Bass pattern (16 chars): R root, r soft root, O octave, F fifth, T third, L low fifth, - hold, . rest.
// Drum lines (16 chars): x hit, X accent, g ghost, . rest. k kick, s snare, h hat, o open hat, t tom.
// ---------------------------------------------------------------------------------------------

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygdom: [0, 1, 4, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  locrian: [0, 1, 3, 5, 6, 8, 10],
};

const THEME_DATA = {
  // Catchy heroic main-menu theme.
  menu: {
    bpm: 132, root: 72, scale: 'major',
    lead: { wave: 'pulse25', vol: 0.13, vib: 10 },
    bass: { oct: -2, pattern: 'R.O.R.O.R.O.R.O.' },
    arp: { wave: 'pulse12', vol: 0.04, oct: -1, rate: 1, shape: 'up' },
    drums: {
      k: 'x.......x.x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.',
      fill: { s: '....x.....x.xxxx' },
    },
    sections: {
      A: {
        chords: '1 5 6 4 1 5 4 5',
        lead: [
          '1 . 1 5 . 5 4 3', '2 - - 5, 2 3 4 2', "3 . 3 1' . 1' 7 6", '5 - - - 4 - 3 -',
          '1 . 1 5 . 5 4 3', '2 - - 5, 2 3 4 5', "6 . 6 1' 7 6 5 4", '5 - - - - - . .',
        ],
      },
      B: {
        chords: '4 5 3 6 4 5 1 5', arp: true,
        lead: [
          "1' - - 7 6 - 5 -", '7 - - 6 5 - 2 -', '3 - - 5 7 - 5 -', "6 - - - 1' - 7 6",
          "4 - 6 - 1' - 6 -", "5 - 7 - 2' - 7 -", "1' - 7 - 5 - 3 -", '2 - 3 - 4 - 7, -',
        ],
      },
    },
  },

  // Arena 1: cheerful, adventurous.
  meadow: {
    bpm: 140, root: 67, scale: 'major',
    lead: { wave: 'square', vol: 0.1, lp: 3800, vib: 8 },
    bass: { oct: -2, pattern: 'R.F.O.F.R.F.O.F.' },
    arp: { wave: 'pulse12', vol: 0.04, oct: -1, rate: 1, shape: 'updown' },
    drums: {
      k: 'x.....x.x.......', s: '....x.......x...', h: '..x...x...x...x.',
      fill: { s: '....x.......x.xx' },
    },
    sections: {
      A: {
        chords: '1 4 1 5 1 4 5 1',
        lead: [
          '1 - 3 5 - 3 5 6', "1' - 6 4 - 6 5 4", "3 - 5 1' - 5 3 1", '2 - - 5, 7, - 2 -',
          '1 - 3 5 - 3 5 6', "1' - 6 4 - 6 1' 2'", "2' - 1' 7 - 5 6 7", "1' - - - 5 - . .",
        ],
      },
      B: {
        chords: '6 3 4 1 6 3 4 5', arp: true,
        lead: [
          "6 - - 5 6 1' - 6", '5 - - 3 5 7 - 5', "4 - - 3 4 6 - 1'", '5 - - - 3 - 1 -',
          "6 - 7 - 1' - 2' -", "3' - 2' - 7 - 5 -", "1' - 7 6 - 5 4 3", '2 - 5, - 7, - 2 -',
        ],
      },
    },
  },

  // Phrygian-dominant snake-charmer vibe.
  desert: {
    bpm: 112, root: 64, scale: 'phrygdom',
    lead: { wave: 'sawtooth', vol: 0.1, lp: 2200, q: 2, vib: 18, vibRate: 6 },
    bass: { oct: -2, pattern: 'R..R..R.R..R..F.' },
    arp: { wave: 'pulse12', vol: 0.035, oct: 0, rate: 2, shape: 'updown' },
    echo: { steps: 3, fb: 0.25, mix: 0.2 },
    drums: {
      k: 'x.....x...x.....', s: '........x.......', h: 'x...x...x...x...', t: '...x..x.x....x.x',
      fill: { t: 'x.x.x.x.x.xxx.xx' },
    },
    sections: {
      A: {
        chords: '1 2 1 2 1 7 2 1',
        lead: [
          '1 2 3 - 2 1 - -', '2 3 4 - 3 2 1 2', '3 4 3 2 3 - - - 5 - 4 - 3 - 2 -', '2 - - - 1 - - -',
          '5 6 5 4 3 4 3 2', '1 2 3 2 1 7, 1 -', '2 - 3 - 2 1 7, 6,', '1 - - - - - . .',
        ],
      },
      B: {
        chords: '4 4 2 2 7 7 1 1', arp: true,
        lead: [
          "1' - 7 6 5 - 6 -", '4 - 5 6 5 4 3 -', '6 - 5 4 3 - 2 -', '2 3 2 1 2 - - -',
          '7, 1 2 3 4 - 3 2', '1 - 2 - 7, - 6, -', "1 2 3 4 5 6 7 1'", "1' - - - . . . .",
        ],
      },
    },
  },

  // Icy and sparkly: floaty lead, constant shimmering arps with echo.
  frost: {
    bpm: 112, root: 64, scale: 'minor',
    lead: { wave: 'pulse12', vol: 0.12, vib: 14, sus: 0.7, dec: 0.4 },
    bass: { oct: -2, pattern: 'R.......R...F...' },
    arp: { wave: 'triangle', vol: 0.06, oct: 1, rate: 1, shape: 'up', span: 2 },
    pad: { wave: 'triangle', vol: 0.035, oct: -1 },
    echo: { steps: 3, fb: 0.35, mix: 0.3 },
    drums: { vol: 0.6, k: 'x.........x.....', s: '........x.......', h: 'x.x.x.x.x.x.x.x.' },
    sections: {
      A: {
        chords: '1 1 6 6 3 3 7 7', arp: true,
        lead: [
          '5 - - - 3 - 5 -', "1' - 7 - 5 - - -", '6 - - - 5 - 3 -', '5 - - - - - . .',
          '7 - - - 5 - 7 -', "2' - 1' - 7 - - -", "4 - 7 - 2' - 4' -", "2' - - - . . . .",
        ],
      },
      B: {
        chords: '4 4 5 5 1 1 7 7', arp: true,
        lead: [
          "1' - - 7 6 - 4 -", "6 - 1' - 6 - 4 -", "2' - - 1' 7 - 5 -", "7 - 2' - 5 - - -",
          "3' - - 2' 1' - 5 -", "1' - - - 7 - 1' -", "2' - 1' - 7 - 6 -", "7 - - - 2' - - -",
        ],
      },
    },
  },

  // Slow, bouncy, swung swamp shuffle.
  swamp: {
    bpm: 92, root: 62, scale: 'dorian', swing: 0.55,
    lead: { wave: 'pulse25', vol: 0.13, glide: 0.025, vib: 15 },
    bass: { oct: -1, pattern: 'R...O.R.R...O.F.' },
    arp: { wave: 'pulse12', vol: 0.035, oct: 0, rate: 2, shape: 'up' },
    drums: {
      k: 'x.....x.x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', t: '..........x...x.',
      fill: { t: '........x.x.x.x.' },
    },
    sections: {
      A: {
        chords: '1 1 4 4 1 1 5 4',
        lead: [
          '1 . 3 . 4 3 1 .', '5 - - 3 4 - 3 1', "4 . 6 . 1' 6 4 .", "2' - - 1' 6 - 4 -",
          '1 . 3 . 4 3 1 .', '5 - - 3 4 - 6 7', "5 - 7 - 1' 7 5 -", '4 - - - 2 - 1 -',
        ],
      },
      B: {
        chords: '7 7 4 4 7 7 5 5', arp: true,
        lead: [
          "7 . 2' . 4' 2' 7 .", '6 - - 5 6 - 7 -', "4 . 6 . 1' . 6 4", '3 - 2 - 1 - - -',
          "7 . 2' . 4' 2' 7 .", "2' - 1' - 7 - 6 -", "5 . 7 . 1' 7 5 3", '5 - - - - - . .',
        ],
      },
    },
  },

  // Lydian sparkle with bell-like echoes.
  crystal: {
    bpm: 120, root: 60, scale: 'lydian',
    lead: { wave: 'pulse12', vol: 0.12, vib: 8 },
    bass: { oct: -1, pattern: 'R.......R.....F.' },
    arp: { wave: 'triangle', vol: 0.055, oct: 1, rate: 1, shape: 'updown', span: 2 },
    pad: { wave: 'sine', vol: 0.05, oct: 0 },
    echo: { steps: 3, fb: 0.3, mix: 0.25 },
    drums: { vol: 0.75, k: 'x.......x.......', s: '....x.......x...', h: '..x...x...x...x.' },
    sections: {
      A: {
        chords: '1 1 2 2 6 6 2 2',
        lead: [
          "5 - 1' - 2' - 3' -", "2' - 1' - 5 - - -", "6 - 2' - 3' - 4' -", "3' - 2' - 6 - - -",
          "3' - - 2' 1' - 6 -", "1' - - 7 6 - 5 -", "6 - 2' - 4' - 6' -", "5' - 4' - 3' - 2' -",
        ],
      },
      B: {
        chords: '6 6 5 5 1 1 2 2', arp: true,
        lead: [
          "3' - - - 1' - 6 -", "7 - 1' - 6 - - -", "2' - - - 7 - 5 -", '6 - 7 - 5 - - -',
          "1' - 2' - 3' - 5' -", "4' - 3' - 2' - - -", "3' - 4' - 6' - 4' -", "2' - - - - - . .",
        ],
      },
    },
  },

  // Driving harmonic-minor rock.
  lava: {
    bpm: 152, root: 69, scale: 'harmonic',
    lead: { wave: 'square', vol: 0.1, lp: 3000, vib: 8 },
    bass: { wave: 'pulse25', vol: 0.2, lp: 900, layer: null, oct: -2, pattern: 'R.R.R.R.R.R.R.O.' },
    arp: { wave: 'pulse12', vol: 0.035, oct: 0, rate: 1, shape: 'up' },
    drums: {
      k: 'x...x...x...x...', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', o: '..............x.',
      fill: { s: '....x.......xxxx' },
    },
    sections: {
      A: {
        chords: '1 1 6 6 4 4 5 5',
        lead: [
          '1 . 1 . 5 - 4 3', '2 - 3 - 1 - - -', "6 . 6 . 1' - 6 5", '4 - 5 - 6 - - -',
          "4 . 4 . 1' - 6 4", '3 - 4 - 6 - 5 4', '5, 7, 2 5 7 5 2 7,', '5 - - - 7, - - -',
        ],
      },
      B: {
        chords: '4 4 1 1 6 6 5 5', arp: true,
        lead: [
          "6 - - 4 6 - 1' -", "1' - 6 - 4 - 6 -", "5 - - 3 5 - 1' -", "7 - 1' - 5 - - -",
          "1' . 1' . 7 6 5 6", "4 - 5 - 6 - 1' -", "7 - 1' - 2' - 3' -", "2' - - - 7 - - -",
        ],
      },
    },
  },

  // Bright, bouncy major.
  candy: {
    bpm: 140, root: 65, scale: 'major',
    lead: { wave: 'pulse25', vol: 0.13, gate: 0.7 },
    bass: { oct: -1, pattern: 'R.O.F.O.R.O.F.O.' },
    arp: { wave: 'pulse12', vol: 0.035, oct: 1, rate: 1, shape: 'up' },
    echo: { steps: 2, fb: 0.2, mix: 0.15 },
    drums: {
      k: 'x.......x.x.....', s: '....x.......x..x', h: '..x...x...x...x.',
      fill: { s: '....x.......xxxx' },
    },
    sections: {
      A: {
        chords: '1 6 4 5 1 6 2 5',
        lead: [
          "1 3 5 3 1' - 5 -", '6 - 5 - 3 - 2 -', "4 6 1' 6 4' - 3' -", "2' - 1' - 7 - 5 -",
          "1 3 5 3 1' - 5 -", "6 - 1' - 2' - 3' -", "4' - 3' - 2' - 1' -", "2' - 7 - 5 - . .",
        ],
      },
      B: {
        chords: '4 5 3 6 4 5 1 1', arp: true,
        lead: [
          '4 - - 3 4 - 6 -', '5 - - 4 5 - 7 -', '3 - - 2 3 - 5 -', '6 - - - 5 - 6 -',
          "1' - 6 - 4 - 6 -", "2' - 7 - 5 - 7 -", "1' - 2' - 3' - 4' -", "5' - 1' - . . . .",
        ],
      },
    },
  },

  // Eerie: locrian, slow, drones, heavy echo, random twinkles.
  void: {
    bpm: 80, root: 61, scale: 'locrian',
    lead: { wave: 'triangle', vol: 0.2, vib: 25, vibRate: 4.5, sus: 0.7, dec: 0.5 },
    bass: { oct: -2, vol: 0.28, pattern: 'R---------------' },
    arp: { wave: 'pulse12', vol: 0.03, oct: 1, rate: 2, shape: 'random', span: 2 },
    pad: { wave: 'sawtooth', vol: 0.025, oct: -1, lp: 900 },
    echo: { steps: 6, fb: 0.45, mix: 0.35 },
    drums: { vol: 0.7, k: 'x...............', o: '..............x.' },
    sections: {
      A: {
        chords: '1 2 1 2 6 5 1 1',
        lead: [
          "1' - - - - - 7 -", '6 - - - - - . .', '3 - - - 5 - - -', '4 - - - - - . .',
          "3 - - - 1' - - -", "2' - - - 1' - 7 -", '5 - - - - - 4 -', '1 - - - - - . .',
        ],
      },
      B: {
        chords: '4 4 3 3 2 2 1 1', arp: true,
        lead: [
          "1' - - 2' 1' - 6 -", '. . . . 4 - - -', '5 - - 6 5 - 3 -', '7 - - - - - . .',
          '6 - - 7 6 - 4 -', '2 - - - - - . .', "1' - - - 7 - 5 -", '1 - - - - - - -',
        ],
      },
    },
  },

  // Calm ambient for the God Box sandbox: soft pads, gentle arps, no drums.
  godbox: {
    bpm: 72, root: 62, scale: 'major',
    lead: { wave: 'triangle', vol: 0.17, vib: 10, sus: 0.75, dec: 0.6, atk: 0.02 },
    bass: { wave: 'sine', oct: -2, vol: 0.3, layer: null, pattern: 'R.......F.......' },
    arp: { wave: 'triangle', vol: 0.04, oct: 1, rate: 2, shape: 'updown' },
    pad: { wave: 'triangle', vol: 0.05, oct: -1, a: 0.8, rel: 1 },
    echo: { steps: 6, fb: 0.4, mix: 0.3 },
    sections: {
      A: {
        chords: '1 1 4 4 6 6 5 5', arp: true,
        lead: [
          '3 - - - 5 - - -', '6 - - - 5 - - -', '4 - - - 6 - - -', "1' - - - 7 - 6 -",
          '5 - - - 3 - - -', '2 - - - 3 - - -', '5 - - - 2 - - -', '3 - - - - - . .',
        ],
      },
      B: {
        chords: '4 4 1 1 2 2 5 5', arp: true,
        lead: [
          "1' - - - 2' - - -", "3' - - - 2' - 1' -", '6 - - - 5 - - -', '3 - - - - - . .',
          '2 - - - 4 - 5 -', '6 - - - 5 - - -', '5 - - - 7 - - -', '6 - - - 5 - . .',
        ],
      },
    },
  },

  // Tense survival waves: galloping bass, staccato stabs.
  waves: {
    bpm: 144, root: 64, scale: 'harmonic',
    lead: { wave: 'square', vol: 0.1, lp: 2800, gate: 0.6 },
    bass: { wave: 'pulse25', vol: 0.2, lp: 800, layer: null, oct: -2, pattern: 'R.RRR.RRR.RRR.RR' },
    arp: { wave: 'pulse12', vol: 0.035, oct: 0, rate: 1, shape: 'down' },
    drums: {
      k: 'x..x..x.x..x..x.', s: '....x.......x...', h: 'x.gxx.gxx.gxx.gx',
      fill: { s: '....x...x.x.xxxx' },
    },
    sections: {
      A: {
        chords: '1 1 6 6 1 1 5 5',
        lead: [
          '1 . . 1 . . 2 3', '2 . . 1 . . 7, .', '6 . . 6 . . 5 4', '5 - - - 3 - - -',
          '1 . . 1 . . 2 3', "5 . . 3 . . 1' 7", "7 - - - 2' - - -", '5 - - - 7, - - -',
        ],
      },
      B: {
        chords: '4 4 1 1 6 6 5 5', arp: true,
        lead: [
          "4 - 6 - 1' - 6 -", "2' - 1' - 7 - 6 -", '5 - 3 - 1 - 3 -', '5 - - - - - . .',
          "6 - 1' - 3' - 1' -", "2' - - 1' 7 - 6 -", "7 - 2' - 5' - 2' -", '7 - - - . . . .',
        ],
      },
    },
  },
};

/** Every music theme name. */
export const MUSIC_THEMES = Object.freeze(Object.keys(THEME_DATA));

// Instrument defaults.
const LEAD = { wave: 'pulse25', vol: 0.13, gate: 0.88, atk: 0.004, hold: 0.04, dec: 0.18, sus: 0.55, rel: 0.03, vib: 0, vibRate: 5.5 };
const BASS = { wave: 'triangle', vol: 0.3, gate: 0.82, atk: 0.003, hold: 0.03, dec: 0.25, sus: 0.8, rel: 0.02, oct: -2, lp: 1800, layer: { wave: 'pulse25', mix: 0.22, oct: 1 } };
const ARP = { wave: 'pulse12', vol: 0.04, gate: 0.55, atk: 0.002, hold: 0.01, dec: 0.08, sus: 0.4, rel: 0.02, oct: 0, rate: 1, shape: 'up', span: 1 };
const PAD = { wave: 'triangle', vol: 0.04, oct: -1, a: 0.4, rel: 0.6, detune: 7 };

const scaleSemi = (scale, i) => scale[((i % scale.length) + scale.length) % scale.length] + 12 * Math.floor(i / scale.length);

function noteSemi(scale, tok, label) {
  const m = /^([1-9])([#b]?)([',]*)$/.exec(tok);
  if (!m) throw new Error(`${label}: bad note "${tok}"`);
  let semi = scaleSemi(scale, +m[1] - 1) + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  for (const c of m[3]) semi += c === "'" ? 12 : -12;
  return semi;
}

function parseBar(str, steps, scale, label) {
  const toks = str.trim().split(/\s+/);
  const per = steps / toks.length;
  if (!Number.isInteger(per)) throw new Error(`${label}: ${toks.length} tokens do not fit ${steps} steps`);
  const out = new Array(steps).fill(null);
  let last = null;
  toks.forEach((tok, i) => {
    if (tok === '-') {
      if (last) last.len += per;
    } else if (tok === '.') {
      last = null;
    } else {
      last = { semi: noteSemi(scale, tok, label), len: per };
      out[i * per] = last;
    }
  });
  return out;
}

function parsePattern(str, steps, label, valid) {
  const p = str.replace(/\s+/g, '');
  if (p.length !== steps) throw new Error(`${label}: pattern needs ${steps} steps, got ${p.length}`);
  const out = new Array(steps).fill(null);
  for (let i = 0; i < steps; i++) {
    const c = p[i];
    if (c === '.' || c === '-') continue;
    if (!valid.includes(c)) throw new Error(`${label}: bad pattern char "${c}"`);
    let len = 1;
    while (p[i + len] === '-') len++;
    out[i] = { c, len };
  }
  return out;
}

function makeChord(scale, tok, arp, label) {
  const m = /^([1-7])$/.exec(tok);
  if (!m) throw new Error(`${label}: bad chord "${tok}"`);
  const idx = +m[1] - 1;
  const tones = [0, 2, 4].map((k) => scaleSemi(scale, idx + k));
  let r = tones[0] % 12;
  if (r > 6) r -= 12; // keep the bass line compact around the tonic
  const ch = { tones, bass: r - tones[0], third: tones[1] - tones[0], fifth: tones[2] - tones[0], seq: null };
  if (arp) {
    const up = arp.span >= 2 ? [...tones, ...tones.map((x) => x + 12), tones[0] + 24] : [...tones, tones[0] + 12];
    ch.seq = arp.shape === 'down' ? up.slice().reverse() : arp.shape === 'updown' ? [...up, ...up.slice(1, -1).reverse()] : up;
  }
  return ch;
}

const COMPILED = new Map();

/**
 * Compile a theme's text data into step tables (cached). Exported for tests/tools.
 * @param {string} name
 */
export function _compileTheme(name) {
  if (COMPILED.has(name)) return COMPILED.get(name);
  const d = Object.prototype.hasOwnProperty.call(THEME_DATA, name) ? THEME_DATA[name] : null;
  if (!d) return null;
  const scale = SCALES[d.scale];
  if (!scale) throw new Error(`${name}: unknown scale ${d.scale}`);
  const steps = 16;
  const lead = { ...LEAD, ...d.lead };
  const bass = { ...BASS, ...d.bass };
  const arp = d.arp ? { ...ARP, ...d.arp } : null;
  const pad = d.pad ? { ...PAD, ...d.pad } : null;
  const drumLines = (dr, label) => {
    for (const k of ['k', 's', 'h', 'o', 't']) if (dr[k]) parsePattern(dr[k], steps, `${label}.${k}`, 'xXg');
  };
  const drums = d.drums ? { vol: 1, ...d.drums } : null;
  if (drums) {
    drumLines(drums, `${name}.drums`);
    if (drums.fill) drumLines(drums.fill, `${name}.fill`);
  }
  const sections = {};
  for (const key of Object.keys(d.sections)) {
    const sd = d.sections[key];
    const label = `${name}.${key}`;
    const bars = sd.lead.length;
    const total = bars * steps;
    const chords = sd.chords.trim().split(/\s+/).map((t) => makeChord(scale, t, arp, label));
    const chordAt = new Uint8Array(total);
    const chordStart = new Uint8Array(total);
    const chordLen = new Uint16Array(total);
    for (let i = 0; i < total; i++) chordAt[i] = Math.floor((i * chords.length) / total);
    for (let i = 0; i < total; i++) {
      if (i > 0 && chordAt[i] === chordAt[i - 1]) continue;
      let j = i;
      while (j < total && chordAt[j] === chordAt[i]) j++;
      chordStart[i] = 1;
      chordLen[i] = j - i;
    }
    sections[key] = {
      key, bars, chords, chordAt, chordStart, chordLen,
      lead: sd.lead.map((b, i) => parseBar(b, steps, scale, `${label}.lead[${i}]`)),
      bass: parsePattern(sd.bass || bass.pattern, steps, `${label}.bass`, 'RrOFTL'),
      arp: !!sd.arp,
      drums: drums,
    };
  }
  const form = (d.form || ['A', 'B']).map((k) => sections[k]);
  const th = {
    name, bpm: d.bpm, root: d.root, swing: d.swing || 0, steps, scale: d.scale,
    lead, bass, arp, pad, drums, echo: d.echo || null, form, sections,
    bassRoot: d.root + 12 * bass.oct,
  };
  COMPILED.set(name, th);
  return th;
}

// ---------------------------------------------------------------------------------------------
// Music players. Lead / bass / arp are persistent oscillator "channels" (like a real chip): one
// oscillator each, re-pitched and re-enveloped per note, so no nodes are created per note.
// Drums and pads are short one-shots.
// ---------------------------------------------------------------------------------------------

class Channel {
  constructor(ac, dest, send, inst) {
    this.inst = inst;
    this.g = ac.createGain();
    this.g.gain.value = 0;
    this.oscs = [];
    this.mults = [];
    this.nodes = [this.g];
    const add = (wave, mult, mix) => {
      const o = ac.createOscillator();
      setWave(ac, o, wave);
      if (mix === 1) o.connect(this.g);
      else {
        const lg = ac.createGain();
        lg.gain.value = mix;
        o.connect(lg);
        lg.connect(this.g);
        this.nodes.push(lg);
      }
      this.oscs.push(o);
      this.mults.push(mult);
    };
    add(inst.wave, 1, 1);
    if (inst.layer) add(inst.layer.wave, Math.pow(2, inst.layer.oct || 0), inst.layer.mix);
    let tail = this.g;
    if (inst.lp) {
      const f = ac.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = inst.lp;
      f.Q.value = inst.q || 0.7;
      this.g.connect(f);
      tail = f;
      this.nodes.push(f);
    }
    tail.connect(dest);
    if (send) tail.connect(send);
    if (inst.vib) {
      this.lfo = ac.createOscillator();
      this.lfo.frequency.value = inst.vibRate || 5.5;
      this.lfoG = ac.createGain();
      this.lfoG.gain.value = 0;
      this.lfo.connect(this.lfoG);
      for (const o of this.oscs) this.lfoG.connect(o.detune);
      this.nodes.push(this.lfoG);
      this.lfo.start();
    }
    for (const o of this.oscs) o.start();
  }

  play(t, hz, dur, vel = 1) {
    const i = this.inst;
    const pk = i.vol * vel;
    for (let k = 0; k < this.oscs.length; k++) {
      const f = this.oscs[k].frequency;
      if (i.glide) f.setTargetAtTime(hz * this.mults[k], t, i.glide);
      else f.setValueAtTime(hz * this.mults[k], t);
    }
    const gate = Math.max(0.02, dur * i.gate);
    const g = this.g.gain;
    g.setTargetAtTime(pk, t, i.atk);
    g.setTargetAtTime(pk * i.sus, t + Math.min(i.hold, gate * 0.5), i.dec);
    g.setTargetAtTime(0, t + gate, i.rel);
    if (this.lfoG) {
      const lg = this.lfoG.gain;
      lg.setValueAtTime(0, t);
      lg.linearRampToValueAtTime(i.vib, t + Math.min(gate, 0.3));
    }
  }

  stop(t) {
    for (const o of this.oscs) try { o.stop(t); } catch { /* already stopped */ }
    if (this.lfo) try { this.lfo.stop(t); } catch { /* already stopped */ }
  }

  disconnect() {
    for (const n of [...this.oscs, ...this.nodes]) try { n.disconnect(); } catch { /* ignore */ }
    if (this.lfo) try { this.lfo.disconnect(); } catch { /* ignore */ }
  }
}

class Player {
  /**
   * @param {BaseAudioContext} ac
   * @param {AudioNode} dest
   * @param {object} th compiled theme
   * @param {number} startAt context time of the first step
   * @param {{intensity: () => number, silent: () => boolean}} opts
   */
  constructor(ac, dest, th, startAt, opts) {
    this.ac = ac;
    this.th = th;
    this.opts = opts;
    this.next = startAt;
    this.fi = 0;
    this.bar = 0;
    this.s = 0;
    this.loop = 0;
    this.endAt = 0;
    this.dead = false;
    this.out = ac.createGain();
    this.out.connect(dest);
    this.fx = [];
    const nyq = ac.sampleRate * 0.45;
    let send = null;
    if (th.echo) {
      send = ac.createGain();
      const dl = ac.createDelay(2);
      dl.delayTime.value = (th.echo.steps * 15) / th.bpm;
      const fb = ac.createGain();
      fb.gain.value = th.echo.fb;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2600;
      const wet = ac.createGain();
      wet.gain.value = th.echo.mix;
      send.connect(dl);
      dl.connect(lp);
      lp.connect(fb);
      fb.connect(dl);
      lp.connect(wet);
      wet.connect(this.out);
      this.fx.push(send, dl, lp, fb, wet);
    }
    this.lead = new Channel(ac, this.out, send, th.lead);
    this.bass = new Channel(ac, this.out, null, th.bass);
    this.arp = th.arp ? new Channel(ac, this.out, send, th.arp) : null;
    const bus = (vol, lp, wet) => {
      const g = ac.createGain();
      g.gain.value = vol;
      let tail = g;
      if (lp) {
        const f = ac.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = lp;
        g.connect(f);
        tail = f;
        this.fx.push(f);
      }
      tail.connect(this.out);
      if (wet && send) tail.connect(send);
      this.fx.push(g);
      return { ac, out: g, p: 1, t: 0, nyq, srcs: null };
    };
    this.dv = th.drums ? bus(th.drums.vol) : null;
    this.pv = th.pad ? bus(th.pad.vol, th.pad.lp, true) : null;
  }

  stepDur() {
    return 15 / (this.th.bpm * (1 + 0.12 * clamp(this.opts.intensity(), 0, 1)));
  }

  /** Schedule every step that starts before `until` (context time). */
  schedule(until) {
    const th = this.th;
    while (this.next < until) {
      const d = this.stepDur();
      this.playStep(this.next, d);
      this.next += d;
      if (++this.s >= th.steps) {
        this.s = 0;
        if (++this.bar >= th.form[this.fi].bars) {
          this.bar = 0;
          if (++this.fi >= th.form.length) {
            this.fi = 0;
            this.loop++;
          }
        }
      }
    }
  }

  playStep(t, d) {
    if (this.opts.silent()) return;
    const th = this.th;
    const sec = th.form[this.fi];
    const { bar, s } = this;
    const gs = bar * th.steps + s;
    const I = clamp(this.opts.intensity(), 0, 1);
    const alt = (this.loop & 1) === 1;
    const tt = t + ((s & 3) === 2 ? th.swing * d : 0);
    const chord = sec.chords[sec.chordAt[gs]];

    if (this.pv && sec.chordStart[gs]) this.playPad(t, chord, sec.chordLen[gs] * d);

    const ev = sec.lead[bar][s];
    if (ev) this.lead.play(tt, M(th.root + ev.semi), ev.len * d);

    const b = sec.bass[s];
    if (b) {
      const off = b.c === 'O' ? 12 : b.c === 'F' ? chord.fifth : b.c === 'T' ? chord.third : b.c === 'L' ? chord.fifth - 12 : 0;
      this.bass.play(tt, M(th.bassRoot + chord.tones[0] + chord.bass + off), b.len * d, b.c === 'r' ? 0.6 : 1);
    }

    const A = th.arp;
    if (this.arp && (sec.arp || alt || I >= 0.45) && gs % A.rate === 0) {
      const n = (gs / A.rate) | 0;
      const seq = chord.seq;
      const idx = A.shape === 'random' ? ((n * 2654435761) >>> 0) % seq.length : n % seq.length;
      this.arp.play(tt, M(th.root + 12 * A.oct + seq[idx]), A.rate * d, s % 4 === 0 ? 1 : 0.75);
    }

    if (this.dv) this.playDrums(tt, sec, bar === sec.bars - 1, I, alt);
  }

  playPad(t, chord, len) {
    const P = this.th.pad;
    for (const semi of chord.tones) {
      const hz = M(this.th.root + 12 * P.oct + semi);
      tone(this.pv, P.wave, hz, null, t, len + P.rel, 0.33, { a: P.a, hold: Math.max(0, len - P.a) });
      if (P.detune) tone(this.pv, P.wave, hz, null, t, len + P.rel, 0.2, { a: P.a, hold: Math.max(0, len - P.a), detune: P.detune });
    }
  }

  playDrums(t, sec, last, I, alt) {
    const D = sec.drums;
    const Fl = last && D.fill ? D.fill : null;
    const s = this.s;
    const at = (k) => {
      const line = (Fl && Fl[k]) || D[k];
      return line ? line[s] : '.';
    };
    let k = at('k');
    let sn = at('s');
    let h = at('h');
    const o = at('o');
    const tm = at('t');
    // Intensity: busier hats, extra kicks and snare rolls.
    if ((I >= 0.35 || alt) && h === '.' && (s & 1) === 0) h = 'g';
    if (I >= 0.7 && h === '.') h = 'g';
    if (I >= 0.55 && k === '.' && (s === 8 || s === 14)) k = 'g';
    if (I >= 0.85 && last && s >= 12 && sn === '.') sn = 'x';
    const vel = (c) => (c === 'X' ? 1.3 : c === 'g' ? 0.5 : 1);
    const v = this.dv;
    if (k !== '.') {
      const a = vel(k);
      tone(v, 'sine', 170, 42, t, 0.18, 0.9 * a, { sweep: 0.09 });
      tone(v, 'square', 420, 90, t, 0.02, 0.12 * a);
    }
    if (sn !== '.') {
      const a = vel(sn);
      noise(v, t, 0.13, 0.4 * a, { type: 'bandpass', f0: 2200, q: 0.6 });
      tone(v, 'triangle', 190, 150, t, 0.07, 0.3 * a);
    }
    if (h !== '.') noise(v, t, 0.035, 0.14 * vel(h), { type: 'highpass', f0: 7000 });
    if (o !== '.') noise(v, t, 0.16, 0.12 * vel(o), { type: 'highpass', f0: 6000 });
    if (tm !== '.') tone(v, 'triangle', 240, 120, t, 0.16, 0.45 * vel(tm), { sweep: 0.12 });
  }

  /** Stop every node at time t (default: now). */
  destroy(t) {
    if (this.dead) return;
    this.dead = true;
    const at = t ?? this.ac.currentTime + 0.02;
    for (const ch of [this.lead, this.bass, this.arp]) if (ch) ch.stop(at);
    if (t == null) {
      for (const ch of [this.lead, this.bass, this.arp]) if (ch) ch.disconnect();
      for (const n of this.fx) try { n.disconnect(); } catch { /* ignore */ }
      try { this.out.disconnect(); } catch { /* ignore */ }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Engine state, graph and lifecycle.
// ---------------------------------------------------------------------------------------------

const S = {
  ctx: null,
  mix: null, // buses -> mix -> compressor -> limiter -> master -> destination
  master: null,
  sfxBus: null,
  musicBus: null,
  duck: null,
  analyser: null,
  musicVolume: 0.7,
  sfxVolume: 1,
  muted: false,
  intensity: 0,
  theme: null,
  current: null,
  players: [],
  voices: [],
  last: new Map(),
  timer: null,
  errors: 0,
  lastError: '',
  primed: false,
  gestureArmed: false,
  hiddenSuspended: false,
  lifecycle: false,
};

const hasWindow = () => typeof window !== 'undefined' && typeof window.addEventListener === 'function';
const hasDocument = () => typeof document !== 'undefined' && typeof document.addEventListener === 'function';

function fail(e) {
  S.errors++;
  S.lastError = String((e && e.message) || e);
  if (S.errors <= 3) {
    try { console.warn('[audio]', e); } catch { /* ignore */ }
  }
}

const musicGain = () => S.musicVolume * S.musicVolume * MUSIC_LEVEL; // squared = perceptual slider
const sfxGain = () => S.sfxVolume * S.sfxVolume;

function setParam(p, value, tc = 0.04) {
  const now = S.ctx.currentTime;
  p.cancelScheduledValues(now);
  p.setValueAtTime(p.value, now);
  p.setTargetAtTime(value, now, tc);
}

function createContext() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return false;
  let ctx;
  try {
    ctx = new AC({ latencyHint: 'interactive' });
  } catch {
    try { ctx = new AC(); } catch { return false; }
  }
  S.ctx = ctx;
  S.primed = false;
  S.players = [];
  S.current = null;
  S.voices = [];
  S.last.clear();
  S.analyser = null;

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 10;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -2.5;
  lim.knee.value = 0;
  lim.ratio.value = 20;
  lim.attack.value = 0.001;
  lim.release.value = 0.06;
  S.mix = ctx.createGain();
  S.master = ctx.createGain();
  S.master.gain.value = S.muted ? 0 : 0.95;
  S.sfxBus = ctx.createGain();
  S.sfxBus.gain.value = sfxGain();
  S.musicBus = ctx.createGain();
  S.musicBus.gain.value = musicGain();
  S.duck = ctx.createGain();
  S.duck.connect(S.musicBus);
  S.musicBus.connect(S.mix);
  S.sfxBus.connect(S.mix);
  S.mix.connect(comp);
  comp.connect(lim);
  lim.connect(S.master);
  S.master.connect(ctx.destination);

  const onState = () => {
    if (S.ctx !== ctx) return;
    const st = ctx.state;
    if (st === 'running') {
      S.hiddenSuspended = false;
      disarmGesture();
      ensureTimer();
    } else if (st === 'closed') {
      S.ctx = null;
      stopTimer();
    } else if (!(S.hiddenSuspended && hasDocument() && document.hidden)) {
      // 'interrupted' (iOS call/Siri) or an unexpected 'suspended': resume on the next tap.
      armGesture();
    }
  };
  try {
    if (ctx.addEventListener) ctx.addEventListener('statechange', onState);
    else ctx.onstatechange = onState;
  } catch { /* ignore */ }
  installLifecycle();
  return true;
}

function resumeCtx() {
  const ctx = S.ctx;
  if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
  try {
    const p = ctx.resume();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        if (S.ctx === ctx && ctx.state === 'running') {
          S.hiddenSuspended = false;
          disarmGesture();
          ensureTimer();
        }
      }, () => { /* needs a gesture: the armed listeners retry */ });
    }
  } catch { /* ignore */ }
}

// iOS only honours resume() inside some gestures (touchend/click, not always pointerdown), so
// while the context is not running every tap/click/key retries the unlock.
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'mousedown', 'click', 'keydown'];
function onGesture() {
  if (!S.ctx || S.ctx.state === 'running') disarmGesture();
  else unlock();
}
function armGesture() {
  if (S.gestureArmed || !hasWindow()) return;
  S.gestureArmed = true;
  for (const e of GESTURES) window.addEventListener(e, onGesture, { capture: true, passive: true });
}
function disarmGesture() {
  if (!S.gestureArmed || !hasWindow()) return;
  S.gestureArmed = false;
  for (const e of GESTURES) window.removeEventListener(e, onGesture, { capture: true });
}

function onVisibility() {
  const ctx = S.ctx;
  if (!ctx || ctx.state === 'closed') return;
  if (document.hidden) {
    // Backgrounded: pause the whole graph (saves battery, avoids a burst of queued notes).
    if (ctx.state === 'running') {
      S.hiddenSuspended = true;
      try {
        const p = ctx.suspend();
        if (p && p.catch) p.catch(() => {});
      } catch { /* ignore */ }
    }
  } else {
    resumeCtx();
    // iOS may refuse to resume until the next user gesture (or report 'interrupted').
    if (ctx.state !== 'running') armGesture();
  }
}

function installLifecycle() {
  if (S.lifecycle || !hasDocument()) return;
  S.lifecycle = true;
  document.addEventListener('visibilitychange', onVisibility);
  if (hasWindow()) window.addEventListener('pageshow', onVisibility);
}

function ensureTimer() {
  if (S.timer || !S.players.length) return;
  S.timer = setInterval(tick, TICK_MS);
}
function stopTimer() {
  if (S.timer) clearInterval(S.timer);
  S.timer = null;
}

function tick() {
  try {
    const ctx = S.ctx;
    if (!ctx) return stopTimer();
    if (ctx.state !== 'running') return;
    const now = ctx.currentTime;
    for (const p of S.players) {
      if (p.dead) continue;
      if (p.endAt && now >= p.endAt) {
        p.destroy();
        continue;
      }
      if (p.next < now - 0.25) p.next = now + 0.03; // main thread stalled: skip ahead, don't flood
      p.schedule(Math.min(now + LOOKAHEAD, p.endAt || Infinity));
    }
    S.players = S.players.filter((p) => !p.dead);
    if (!S.players.length) stopTimer();
  } catch (e) {
    fail(e);
  }
}

function liveOpts() {
  return {
    intensity: () => S.intensity,
    silent: () => S.muted || S.musicVolume <= 0.001,
  };
}

function switchTo(theme) {
  const ctx = S.ctx;
  const now = ctx.currentTime;
  if (S.current) {
    const old = S.current;
    const g = old.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + FADE);
    old.endAt = now + FADE + 0.05;
    S.current = null;
  }
  if (theme) {
    const th = _compileTheme(theme);
    const p = new Player(ctx, S.duck, th, now + 0.06, liveOpts());
    p.out.gain.setValueAtTime(0, now);
    p.out.gain.linearRampToValueAtTime(1, now + FADE);
    S.current = p;
    S.players.push(p);
  }
  ensureTimer();
  tick();
}

function duckMusic(secs) {
  const g = S.duck.gain;
  const now = S.ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.setTargetAtTime(0.3, now, 0.03);
  g.setTargetAtTime(1, now + secs, 0.3);
}

function releaseVoice(v) {
  if (v.gone) return;
  v.gone = true;
  try { v.out.disconnect(); } catch { /* ignore */ }
  if (v.panner) try { v.panner.disconnect(); } catch { /* ignore */ }
}

function stealVoice(v, now) {
  if (v.gone) return;
  try {
    const g = v.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + 0.02);
    for (const s of v.srcs) try { s.stop(now + 0.03); } catch { /* ignore */ }
  } catch { /* ignore */ }
  v.end = now + 0.03;
  v.stolen = true;
}

function makeVoice(ac, dest, vol, pan, pitch, t) {
  const out = ac.createGain();
  out.gain.value = vol;
  let panner = null;
  if (pan && typeof ac.createStereoPanner === 'function') {
    panner = ac.createStereoPanner();
    panner.pan.value = pan;
    out.connect(panner);
    panner.connect(dest);
  } else out.connect(dest);
  return { ac, out, panner, p: pitch, t, end: t, srcs: [], live: 0, nyq: ac.sampleRate * 0.45, name: '', prio: 1 };
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/**
 * Create or resume the AudioContext. Call from the first pointerdown (and freely afterwards).
 * Starts any music requested before unlock. No-op without Web Audio.
 */
function unlock() {
  try {
    if (!S.ctx || S.ctx.state === 'closed') {
      if (!createContext()) return;
    }
    const ctx = S.ctx;
    if (ctx.state !== 'running') {
      S.hiddenSuspended = false;
      resumeCtx();
    }
    if (!S.primed || ctx.state !== 'running') {
      // iOS: starting a (silent) source inside the gesture fully unlocks output.
      const b = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.connect(ctx.destination);
      src.start(0);
      S.primed = true;
    }
    if (ctx.state !== 'running') armGesture();
    if (S.theme && !S.current) switchTo(S.theme);
  } catch (e) {
    fail(e);
  }
}

/**
 * Play a sound effect (fire-and-forget). Unknown names are ignored.
 * @param {string} name one of SFX_NAMES
 * @param {{volume?: number, pitch?: number, pan?: number}} [opts] volume 0..2, pitch multiplier, pan -1..1
 */
function sfx(name, opts) {
  try {
    const patch = Object.prototype.hasOwnProperty.call(PATCHES, name) ? PATCHES[name] : null;
    const ctx = S.ctx;
    if (!patch || !ctx || ctx.state !== 'running' || S.muted || S.sfxVolume <= 0) return;
    const o = opts || {};
    const vol = clamp(num(o.volume, 1), 0, 2);
    if (vol <= 0) return;
    const now = ctx.currentTime;
    const last = S.last.get(name);
    if (last !== undefined && now - last < patch.cd && now >= last) return;

    // Polyphony: per-name cap first, then the global cap (steal the oldest lower-priority voice).
    S.voices = S.voices.filter((v) => !v.gone && v.end > now);
    const same = S.voices.filter((v) => v.name === name && !v.stolen);
    if (same.length >= patch.max) stealVoice(same[0], now);
    else {
      const live = S.voices.filter((v) => !v.stolen);
      if (live.length >= MAX_VOICES) {
        const victim = live.find((v) => v.prio <= patch.prio);
        if (!victim) return;
        stealVoice(victim, now);
      }
    }
    S.last.set(name, now);

    const pitch = clamp(num(o.pitch, 1), 0.25, 4) * (patch.vary ? 1 + rnd(-patch.vary, patch.vary) : 1);
    const v = makeVoice(ctx, S.sfxBus, vol, clamp(num(o.pan, 0), -1, 1), pitch, now + 0.005);
    v.name = name;
    v.prio = patch.prio;
    patch.fn(v);
    S.voices.push(v);
    if (patch.duck && S.current) duckMusic(patch.duck);
  } catch (e) {
    fail(e);
  }
}

/**
 * Crossfade to a music theme. Same theme = no-op, null = stop, unknown names are ignored.
 * May be called before unlock(); the theme then starts on unlock.
 * @param {string|null} theme one of MUSIC_THEMES
 */
function music(theme) {
  try {
    const t = theme == null ? null : String(theme);
    if (t !== null && !Object.prototype.hasOwnProperty.call(THEME_DATA, t)) return;
    if (t === S.theme) return;
    S.theme = t;
    if (S.ctx && S.ctx.state !== 'closed') switchTo(t);
  } catch (e) {
    fail(e);
  }
}

/** @param {number} v 0..1 */
function setMusicVolume(v) {
  try {
    S.musicVolume = clamp(num(v, S.musicVolume), 0, 1);
    if (S.ctx) setParam(S.musicBus.gain, musicGain());
  } catch (e) {
    fail(e);
  }
}

/** @param {number} v 0..1 */
function setSfxVolume(v) {
  try {
    S.sfxVolume = clamp(num(v, S.sfxVolume), 0, 1);
    if (S.ctx) setParam(S.sfxBus.gain, sfxGain());
  } catch (e) {
    fail(e);
  }
}

/** @param {boolean} m */
function setMuted(m) {
  try {
    S.muted = !!m;
    if (S.ctx) setParam(S.master.gain, S.muted ? 0 : 0.95, 0.03);
  } catch (e) {
    fail(e);
  }
}

/**
 * Battle music tension: 0 = normal, 1 = overtime / towers low (faster, more drums and arps).
 * @param {number} x 0..1
 */
function setIntensity(x) {
  S.intensity = clamp(num(x, 0), 0, 1);
}

/** Debug snapshot (used by tools/audio-test.html and tests). */
function info() {
  return {
    state: S.ctx ? S.ctx.state : hasAudio() ? 'locked' : 'unavailable',
    theme: S.theme,
    voices: S.voices.filter((v) => !v.gone && S.ctx && v.end > S.ctx.currentTime).length,
    players: S.players.length,
    errors: S.errors,
    lastError: S.lastError,
  };
}

/** An AnalyserNode on the final output (created on demand), or null before unlock. */
function analyser() {
  try {
    if (!S.ctx) return null;
    if (!S.analyser) {
      S.analyser = S.ctx.createAnalyser();
      S.analyser.fftSize = 2048;
      S.master.connect(S.analyser);
    }
    return S.analyser;
  } catch (e) {
    fail(e);
    return null;
  }
}

const hasAudio = () => !!(globalThis.AudioContext || globalThis.webkitAudioContext);

export const audio = {
  unlock,
  sfx,
  music,
  setMusicVolume,
  setSfxVolume,
  setMuted,
  setIntensity,
  get musicVolume() { return S.musicVolume; },
  get sfxVolume() { return S.sfxVolume; },
  get muted() { return S.muted; },
  get intensity() { return S.intensity; },
  /** Requested music theme (or null). */
  get theme() { return S.theme; },
  /** True once the AudioContext is running. */
  get unlocked() { return !!S.ctx && S.ctx.state === 'running'; },
  info,
  analyser,
  sfxNames: SFX_NAMES,
  themes: MUSIC_THEMES,
};

export default audio;

// ---------------------------------------------------------------------------------------------
// Offline rendering helpers (dev tools / automated checks). Resolve to an AudioBuffer or null.
// ---------------------------------------------------------------------------------------------

function offlineCtx(seconds, sampleRate) {
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!OAC) return null;
  return new OAC(2, Math.ceil(seconds * sampleRate), sampleRate);
}

/**
 * Render one SFX patch offline (no compressor), e.g. to check levels.
 * @param {string} name
 * @param {{volume?: number, pitch?: number, pan?: number, seconds?: number, sampleRate?: number}} [opts]
 * @returns {Promise<AudioBuffer|null>}
 */
export async function renderSfx(name, opts = {}) {
  const patch = Object.prototype.hasOwnProperty.call(PATCHES, name) ? PATCHES[name] : null;
  const oc = patch && offlineCtx(opts.seconds || 4, opts.sampleRate || 44100);
  if (!oc) return null;
  const v = makeVoice(oc, oc.destination, clamp(num(opts.volume, 1), 0, 2), clamp(num(opts.pan, 0), -1, 1), clamp(num(opts.pitch, 1), 0.25, 4), 0.01);
  patch.fn(v);
  return oc.startRendering();
}

/**
 * Render a music theme offline at full volume (no compressor).
 * @param {string} theme
 * @param {{seconds?: number, intensity?: number, sampleRate?: number}} [opts]
 * @returns {Promise<AudioBuffer|null>}
 */
export async function renderMusic(theme, opts = {}) {
  const th = _compileTheme(theme);
  const secs = opts.seconds || 10;
  const oc = th && offlineCtx(secs, opts.sampleRate || 22050);
  if (!oc) return null;
  const I = clamp(num(opts.intensity, 0), 0, 1);
  const p = new Player(oc, oc.destination, th, 0.02, { intensity: () => I, silent: () => false });
  p.out.gain.value = MUSIC_LEVEL;
  p.schedule(secs);
  p.destroy(secs);
  return oc.startRendering();
}
