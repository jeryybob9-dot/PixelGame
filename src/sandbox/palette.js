// God Box — terrain colours (pure). Colours are packed as ABGR uint32 for ImageData.
import { T, B, H, IS_WATER } from './constants.js';
import { hash2 } from './rng.js';

export function hexToRgb(hex) {
  if (hex.startsWith('hsl')) {
    const m = hex.match(/hsl\((\d+)\s+(\d+)%\s+(\d+)%\)/);
    if (m) return hslToRgb(+m[1], +m[2] / 100, +m[3] / 100);
  }
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export function hslToRgb(hDeg, s, l) {
  const k = (n) => (n + hDeg / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
export const pack = (r, g, b, a = 255) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
const P = (hex) => hexToRgb(hex);

// [meadow, desert, swamp, frost, candy, void]
const GRASS = ['#5aa843', '#dcc47c', '#5e7a3a', '#e4ecf2', '#f2a6c9', '#4b3a5f'].map(P);
const GRASS2 = ['#4c9638', '#ccb26a', '#506b31', '#d2dde8', '#e690ba', '#3e3051'].map(P);
const FOREST = ['#2f7a32', '#8aa040', '#3b5a2a', '#2e5e4c', '#c2509a', '#2a1f38'].map(P);
const FOREST2 = ['#1f5a24', '#5f7a2a', '#28401e', '#1d4234', '#8f3274', '#1a1226'].map(P);
const FOREST3 = ['#4a9a3c', '#b0b850', '#4f7234', '#e8f0f4', '#ffd0e4', '#6a5080'].map(P);
const HILLS = ['#7f9a4f', '#c9a35f', '#6b7a45', '#c3ced8', '#e0a0d0', '#5a4a6a'].map(P);
const SAND = ['#e2cf8a', '#ecd89a', '#b8ae7a', '#d8dce0', '#fbe0b0', '#7a6a7a'].map(P);
const MOUNT = ['#7d7570', '#a08060', '#6e6a5e', '#9aa6b4', '#b88aa8', '#4b4458'].map(P);
const SHALLOW = ['#2f6fb0', '#3a7fb8', '#3a6a5a', '#4a86c0', '#6fb0e8', '#3a3060'].map(P);
const DEEP = ['#1d3b73', '#1f4278', '#1f3f50', '#24467c', '#3a6ab0', '#1c1638'].map(P);

const SNOW = P('#f2f5fa');
const SNOW2 = P('#dde5ef');
const LAVA = P('#ff5a1f');
const LAVA2 = P('#ffa52e');
const LAVA3 = P('#b0301a');
const ASH = P('#4a4542');
const ASH2 = P('#5c5652');
const STONE = P('#6e6a68');
const ICE = P('#a9d8f0');
const ICE2 = P('#d0ecfa');
const SOIL = P('#7a5a30');
const CROPS = ['#7a5a30', '#6f9a3a', '#a8b83a', '#e0c040'].map(P);
const WASTE = P('#6b6b3a');
const WASTE2 = P('#57572e');
const ACID = P('#8cff3a');
const ACID2 = P('#5fd32a');
const CRACK = P('#1a1414');
const GOLD = P('#ffd24a');

/**
 * Display colour of one tile as [r,g,b] (no shading).
 * @returns {number[]}
 */
export function baseColor(t, b, x, y, aux = 0) {
  const n = hash2(x, y, 911);
  switch (t) {
    case T.DEEP: return DEEP[b];
    case T.SHALLOW: return SHALLOW[b];
    case T.SAND: return SAND[b];
    case T.GRASS: return n < 0.3 ? GRASS2[b] : GRASS[b];
    case T.FOREST: return n < 0.38 ? FOREST2[b] : n > 0.88 ? FOREST3[b] : FOREST[b];
    case T.HILLS: return n < 0.25 ? GRASS2[b] : HILLS[b];
    case T.MOUNTAIN: return MOUNT[b];
    case T.SNOW: return n < 0.3 ? SNOW2 : SNOW;
    case T.LAVA: return n < 0.2 ? LAVA2 : n > 0.85 ? LAVA3 : LAVA;
    case T.ASH: return n < 0.4 ? ASH2 : ASH;
    case T.STONE: return STONE;
    case T.ICE: return n < 0.25 ? ICE2 : ICE;
    case T.FARM: return y % 2 === 0 ? CROPS[Math.min(3, aux)] : SOIL;
    case T.WASTE: return n < 0.4 ? WASTE2 : WASTE;
    case T.ACID: return n < 0.35 ? ACID2 : ACID;
    case T.CRACK: return CRACK;
    case T.ORE: return n < 0.35 ? GOLD : MOUNT[b];
    default: return [255, 0, 255];
  }
}

const SHADE_K = new Float32Array(32);
SHADE_K[T.GRASS] = 0.5;
SHADE_K[T.FOREST] = 0.6;
SHADE_K[T.HILLS] = 1.1;
SHADE_K[T.MOUNTAIN] = 1.4;
SHADE_K[T.SNOW] = 1.2;
SHADE_K[T.ORE] = 1.4;
SHADE_K[T.SAND] = 0.5;
SHADE_K[T.STONE] = 0.8;
SHADE_K[T.ASH] = 0.5;
SHADE_K[T.WASTE] = 0.5;

/** Final shaded colour of tile i, packed ABGR. */
export function tileColor(s, i) {
  const w = s.w;
  const x = i % w;
  const y = (i / w) | 0;
  const t = s.tile[i];
  const b = s.biome[i];
  const c = baseColor(t, b, x, y, s.aux[i]);
  let r = c[0];
  let g = c[1];
  let bl = c[2];
  const hgt = s.height;
  if (IS_WATER[t]) {
    const depth = Math.min(1, Math.max(0, hgt[i] / H.SEA));
    const f = t === T.DEEP ? 0.7 + depth * 0.45 : 0.9 + depth * 0.15;
    r *= f;
    g *= f;
    bl *= f;
    if (t === T.SHALLOW) {
      const tl = s.tile;
      const shore =
        (x > 0 && !IS_WATER[tl[i - 1]]) || (x < w - 1 && !IS_WATER[tl[i + 1]]) ||
        (y > 0 && !IS_WATER[tl[i - w]]) || (y < s.h - 1 && !IS_WATER[tl[i + w]]);
      if (shore) {
        r = r * 0.7 + 255 * 0.3;
        g = g * 0.7 + 255 * 0.3;
        bl = bl * 0.7 + 255 * 0.3;
      }
    }
  } else {
    const k = SHADE_K[t];
    if (k) {
      const xl = x > 0 ? i - 1 : i;
      const xr = x < w - 1 ? i + 1 : i;
      const yu = y > 0 ? i - w : i;
      const yd = y < s.h - 1 ? i + w : i;
      let sh = (hgt[xr] - hgt[xl] + hgt[yd] - hgt[yu]) * k;
      if (sh > 36) sh = 36;
      else if (sh < -36) sh = -36;
      r += sh;
      g += sh;
      bl += sh;
    }
    const jitter = (hash2(x, y, 77) - 0.5) * 10;
    r += jitter;
    g += jitter;
    bl += jitter;
  }
  r = r < 0 ? 0 : r > 255 ? 255 : r;
  g = g < 0 ? 0 : g > 255 ? 255 : g;
  bl = bl < 0 ? 0 : bl > 255 ? 255 : bl;
  return pack(r | 0, g | 0, bl | 0);
}

/** CSS colour for a tile type/biome (used by particles sucked into black holes). */
export function tileCss(t, b) {
  const c = baseColor(t, b, 0, 1, 0);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export const BIOME_SWATCH = {
  grass: GRASS.map(([r, g, b]) => `rgb(${r},${g},${b})`),
  forest: FOREST.map(([r, g, b]) => `rgb(${r},${g},${b})`),
};
export { B };
