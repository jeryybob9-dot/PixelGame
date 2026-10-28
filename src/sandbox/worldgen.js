// God Box — procedural world generation (pure, deterministic by seed, no DOM).
import { T, B, F, H } from './constants.js';
import { fbm, hash2, makeRng, rnd, clamp, smoothstep } from './rng.js';

/**
 * Elevation map: warped fBm continents, ridged mountain chains, ocean at the edges.
 * Kept separate so saves can store only the difference from the generated map.
 * @param {number} w
 * @param {number} h
 * @param {number} seed uint32
 * @returns {Uint8Array}
 */
export function generateHeight(w, h, seed) {
  const n = w * h;
  const raw = new Float32Array(n);
  const s = seed | 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const qx = fbm(x * 0.021, y * 0.021, s + 101, 3) - 0.5;
      const qy = fbm(x * 0.021 + 5.2, y * 0.021 + 1.3, s + 202, 3) - 0.5;
      const wx = x + qx * 38;
      const wy = y + qy * 38;
      let e = fbm(wx * 0.017, wy * 0.017, s, 5);
      const ridge = 1 - Math.abs(fbm(wx * 0.028, wy * 0.028, s + 303, 3) * 2 - 1);
      e += Math.pow(ridge, 6) * 0.12 * smoothstep(0.45, 0.6, e);
      const nx = ((x + 0.5) / w) * 2 - 1;
      const ny = ((y + 0.5) / h) * 2 - 1;
      const d = Math.max(Math.abs(nx), Math.abs(ny));
      e -= smoothstep(0.62, 1.0, d) * 0.4;
      raw[y * w + x] = e;
    }
  }
  // Map raw values through quantile anchors so every seed gets a similar land/mountain balance.
  const sorted = raw.slice().sort();
  const P = [0, 0.3, 0.47, 0.52, 0.82, 0.915, 0.968, 1];
  const HV = [24, H.DEEP, H.SEA, H.SAND, H.GRASS, H.HILLS, H.MOUNT, 240];
  const Q = P.map((p) => sorted[Math.min(n - 1, Math.floor(p * (n - 1)))]);
  const height = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const v = raw[i];
    let k = 0;
    while (k < Q.length - 2 && v > Q[k + 1]) k++;
    const span = Q[k + 1] - Q[k] || 1e-6;
    const t = clamp((v - Q[k]) / span, 0, 1);
    let hv = Math.round(HV[k] + (HV[k + 1] - HV[k]) * t);
    // Keep a ring of ocean around the map.
    const x = i % w;
    const y = (i / w) | 0;
    const e = Math.min(x, y, w - 1 - x, h - 1 - y);
    if (e < 5) hv = Math.min(hv, H.DEEP - 22 + e * 8);
    height[i] = clamp(hv, 0, 255);
  }
  return height;
}

/** Natural tile for a given height (ignores biome). */
export function baseTileForHeight(hgt) {
  if (hgt < H.DEEP) return T.DEEP;
  if (hgt < H.SEA) return T.SHALLOW;
  if (hgt < H.SAND) return T.SAND;
  if (hgt < H.GRASS) return T.GRASS;
  if (hgt < H.HILLS) return T.HILLS;
  if (hgt < H.MOUNT) return T.MOUNTAIN;
  return T.SNOW;
}

const FOREST_AT = [0.56, 0.74, 0.5, 0.53, 0.57, 0.56];

/**
 * Generate a full terrain set for a world.
 * @param {{w:number,h:number,seed:number}} opts
 * @returns {{w:number,h:number,seed:number,height:Uint8Array,tile:Uint8Array,biome:Uint8Array,flags:Uint8Array}}
 */
export function generateTerrain({ w, h, seed }) {
  seed = seed >>> 0;
  const n = w * h;
  const height = generateHeight(w, h, seed);
  const tile = new Uint8Array(n);
  const biome = new Uint8Array(n);
  const flags = new Uint8Array(n);
  const rng = makeRng(seed ^ 0xb5297a4d);
  const s = seed | 0;

  // Biome centres: forced variety first, then weighted random picks.
  const count = Math.max(7, Math.round((w * h) / 2100));
  const forced = [B.MEADOW, B.MEADOW, B.DESERT, B.FROST, B.SWAMP, B.MEADOW];
  if (rnd(rng) < 0.7) forced.push(B.CANDY);
  if (rnd(rng) < 0.6) forced.push(B.VOID);
  const centres = [];
  for (let k = 0; k < count; k++) {
    let cx = 0;
    let cy = 0;
    for (let tries = 0; tries < 14; tries++) {
      cx = 4 + rnd(rng) * (w - 8);
      cy = 4 + rnd(rng) * (h - 8);
      if (height[(cy | 0) * w + (cx | 0)] >= H.SEA) break;
    }
    let type;
    if (k < forced.length) type = forced[k];
    else {
      const lat = cy / h;
      const r = rnd(rng);
      if (lat < 0.22 && r < 0.45) type = B.FROST;
      else if (lat > 0.55 && r < 0.3) type = B.DESERT;
      else if (r < 0.62) type = B.MEADOW;
      else if (r < 0.74) type = B.SWAMP;
      else if (r < 0.86) type = B.DESERT;
      else type = B.FROST;
    }
    // Frost likes the north, desert the south.
    if (type === B.FROST && k < forced.length) cy = 4 + rnd(rng) * h * 0.3;
    if (type === B.DESERT && k < forced.length) cy = h * 0.55 + rnd(rng) * h * 0.4;
    centres.push({ x: cx, y: cy, type, weight: type === B.CANDY || type === B.VOID ? 1.6 : 1 });
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const jx = x + (fbm(x * 0.07, y * 0.07, s + 404, 2) - 0.5) * 22;
      const jy = y + (fbm(x * 0.07, y * 0.07, s + 505, 2) - 0.5) * 22;
      let best = 0;
      let bd = Infinity;
      for (let k = 0; k < centres.length; k++) {
        const c = centres[k];
        const dx = jx - c.x;
        const dy = jy - c.y;
        const d = (dx * dx + dy * dy) * c.weight;
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      const bio = centres[best].type;
      biome[i] = bio;
      const hgt = height[i];
      const m = fbm(x * 0.06, y * 0.06, s + 99, 3);
      let t = baseTileForHeight(hgt);
      if (t === T.SHALLOW && bio === B.FROST && hgt > H.DEEP + 3) t = T.ICE;
      else if (t === T.GRASS) {
        if (m > FOREST_AT[bio]) t = T.FOREST;
        else if (bio === B.SWAMP && m < 0.38 && hash2(x, y, s) < 0.75) t = T.SHALLOW;
      } else if (t === T.HILLS) {
        if (m > 0.66 && bio !== B.DESERT) t = T.FOREST;
      } else if (t === T.MOUNTAIN) {
        if (hash2(x, y, s + 7) < 0.035) t = T.ORE;
      }
      tile[i] = t;
    }
  }
  return { w, h, seed, height, tile, biome, flags };
}

/** Fraction of tiles that are land. Handy for tests and tuning. */
export function landRatio(terrain) {
  let land = 0;
  for (let i = 0; i < terrain.tile.length; i++) if (terrain.height[i] >= H.SEA) land++;
  return land / terrain.tile.length;
}

export { F };
