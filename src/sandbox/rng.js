// God Box — seeded randomness and noise (pure, no DOM).

/**
 * FNV-1a hash of a string.
 * @param {string} str
 * @returns {number} uint32
 */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Turn a user seed (number or text) into a uint32. Empty input gives a random seed.
 * @param {string|number|undefined} input
 */
export function seedFromInput(input) {
  if (typeof input === 'number' && Number.isFinite(input)) return input >>> 0;
  const str = String(input ?? '').trim();
  if (!str) return (Math.random() * 4294967296) >>> 0;
  if (/^\d{1,9}$/.test(str)) return Number(str) >>> 0;
  return hashString(str);
}

/**
 * mulberry32 step: advances `o.rs` and returns a float in [0, 1).
 * Any object with a numeric `rs` field works (the sim state uses this so saves keep determinism).
 * @param {{rs:number}} o
 */
export function rnd(o) {
  let t = (o.rs = (o.rs + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** @param {number} seed */
export function makeRng(seed) {
  return { rs: seed >>> 0 };
}

/** Deterministic hash of integer coordinates to [0, 1). */
export function hash2(x, y, seed) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smoothly interpolated value noise in [0, 1). */
export function valueNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal (fBm) value noise in roughly [0, 1). */
export function fbm(x, y, seed, octaves = 4) {
  let sum = 0;
  let amp = 1;
  let f = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * f, y * f, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
