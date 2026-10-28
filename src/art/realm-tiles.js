/**
 * Brickbox Royale — "Tiny Gods" realm terrain renderer.
 *
 * Renders a tile map (Uint8Array of REALM_TILES, w x h) into one pre-rendered canvas of
 * (w*16) x (h*16) px in the look of an arena biome (see tiles.js BIOMES). Per frame the game only
 * draws the visible part of that canvas plus cheap animated overlays (drawRealmWater, drawTerritory).
 *
 * - Coastlines are smoothed with a per-pixel field (rounded corners, wet sand, beach, foam, shallows).
 * - Borders between land types are jittered with low-frequency noise so they never look square.
 * - FOREST, MOUNTAIN and CRYSTAL tiles get pixel-art overlays that may overlap the tile above.
 * - Everything is deterministic for (tiles, biomeId, seed), so renderRealmTile() can redraw a single
 *   tile + neighbours later and get identical pixels around it.
 *
 * Coordinates: drawRealmWater / drawTerritory draw in world pixels (tile x * 16), so call them with
 * the same transform you use to draw the pre-rendered map canvas.
 * Canvas size note: iOS Safari caps a canvas at ~16.7M px, i.e. maps up to 256x256 tiles.
 */

import { px, outline } from './icons.js';
import { makeCanvas } from './sprite-cache.js';
import { PALETTE, hexToRgb, mix, TEAM_COLORS } from './palette.js';
import { BIOMES } from './tiles.js';

/** Tile type ids. */
export const REALM_TILES = Object.freeze({
  DEEP: 0, WATER: 1, SAND: 2, GRASS: 3, FOREST: 4, HILL: 5, MOUNTAIN: 6, ASH: 7, SNOW: 8, LAVA: 9, MUD: 10, CRYSTAL: 11, PATH: 12,
});
const T = REALM_TILES;
const TS = 16;
const TYPE_COUNT = 13;

const isWet = (t) => t === T.DEEP || t === T.WATER;

// ---------------------------------------------------------------------------------------------
// Hashing / noise (deterministic, seedable)
// ---------------------------------------------------------------------------------------------

function hash3(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const NOISE_N = 128;
const noiseCache = new Map();
/** Tileable 128x128 value noise (two octaves), values 0..1, per seed. */
function noiseTex(seed) {
  let tex = noiseCache.get(seed);
  if (tex) return tex;
  tex = new Float32Array(NOISE_N * NOISE_N);
  const octave = (cell, amp, salt) => {
    const cells = NOISE_N / cell;
    const v = (i, j) => hash3(((i % cells) + cells) % cells, ((j % cells) + cells) % cells, seed * 31 + salt);
    for (let y = 0; y < NOISE_N; y++) {
      for (let x = 0; x < NOISE_N; x++) {
        const fx = x / cell;
        const fy = y / cell;
        const i = Math.floor(fx);
        const j = Math.floor(fy);
        let u = fx - i;
        let w = fy - j;
        u = u * u * (3 - 2 * u);
        w = w * w * (3 - 2 * w);
        const a = v(i, j) + (v(i + 1, j) - v(i, j)) * u;
        const b = v(i, j + 1) + (v(i + 1, j + 1) - v(i, j + 1)) * u;
        tex[y * NOISE_N + x] += (a + (b - a) * w) * amp;
      }
    }
  };
  octave(16, 0.65, 1);
  octave(4, 0.35, 2);
  if (noiseCache.size > 8) noiseCache.clear();
  noiseCache.set(seed, tex);
  return tex;
}

// ---------------------------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------------------------

const RGB = (hex) => hexToRgb(hex);
const darken = (hex, k) => mix(hex, '#1a1022', k);
const lighten = (hex, k) => mix(hex, '#ffffff', k);

/** Overlay material maps per biome (material letter -> palette char). */
const TREE_STYLE = {
  meadow: { shapes: ['round', 'round', 'pine'], map: { v: 'v', V: 'V', m: 'm', b: 'b', n: 'n', y: 'r' } },
  desert: { shapes: ['palm', 'palm', 'cactus'], map: { v: 'v', V: 'V', m: 'm', b: 'b', n: 'B', y: 'y' } },
  frost: { shapes: ['pine', 'pine', 'pine'], map: { v: 'w', V: 'V', m: 'm', b: 'B', n: 'n', y: 'i' } },
  swamp: { shapes: ['willow', 'willow', 'dead'], map: { v: 'V', V: 'm', m: 'k', b: 'B', n: 'n', y: 'v' } },
  crystal: { shapes: ['round', 'round', 'pine'], map: { v: 'c', V: 'C', m: 'x', b: 'u', n: 'U', y: 'q' } },
  lava: { shapes: ['dead', 'dead', 'pine'], map: { v: 'a', V: 'k', m: 'o', b: 'd', n: 'k', y: 'y' } },
  candy: { shapes: ['round', 'lolli', 'round'], map: { v: 'w', V: 'q', m: 'e', b: 'w', n: 'r', y: 'y' } },
  void: { shapes: ['dead', 'round', 'spire'], map: { v: 'q', V: 'p', m: 'P', b: 'k', n: 'o', y: 'q' } },
};
const ROCK_STYLE = {
  meadow: { g: 'g', G: 'G', d: 'd', k: 'k', w: 'w' },
  desert: { g: 'b', G: 'a', d: 'A', k: 'n', w: 'b' },
  frost: { g: 'i', G: 'c', d: 'C', k: 'x', w: 'w' },
  swamp: { g: 'G', G: 'd', d: 'm', k: 'k', w: 'V' },
  crystal: { g: 'p', G: 'P', d: 'k', k: 'o', w: 'j' },
  lava: { g: 'B', G: 'n', d: 'k', k: 'o', w: 'a' },
  candy: { g: 'b', G: 'B', d: 'n', k: 'n', w: 'w' },
  void: { g: 'P', G: 'k', d: 'k', k: 'o', w: 'q' },
};

const palCache = new Map();
/** Full colour set for a biome (hex strings + pre-parsed rgb tables). */
function realmPalette(biomeId) {
  const id = BIOMES[biomeId] ? biomeId : 'meadow';
  let P = palCache.get(id);
  if (P) return P;
  const b = BIOMES[id];
  const [g0, g1] = b.ground;
  let water = { ...b.water };
  if (id === 'lava') water = { deep: '#141a26', mid: '#26324a', light: '#46597a', foam: '#8d9bb4' };
  const deep = darken(water.deep, 0.15);
  const rock = ROCK_STYLE[id];
  const c = {
    [T.DEEP]: [lighten(deep, 0.08), deep, darken(deep, 0.08), darken(deep, 0.2)],
    [T.WATER]: [lighten(water.mid, 0.12), water.mid, mix(water.mid, water.deep, 0.25), mix(water.mid, water.deep, 0.5)],
    [T.SAND]: ['#f7e8bb', '#ecd59c', '#dfc387', '#c6a66c'],
    [T.GRASS]: [lighten(g0, 0.12), g0, g1, darken(g1, 0.18)],
    [T.FOREST]: [darken(g0, 0.12), darken(g1, 0.2), darken(g1, 0.28), darken(g1, 0.4)],
    [T.HILL]: [lighten(g0, 0.12), g0, g1, darken(g1, 0.18)],
    [T.MOUNTAIN]: [PALETTE[rock.g], PALETTE[rock.G], PALETTE[rock.d], PALETTE[rock.k]],
    [T.ASH]: ['#6e6268', '#4a4248', '#3e373d', '#2a2428'],
    [T.SNOW]: ['#ffffff', '#eef5fb', '#dde9f3', '#b9cde0'],
    [T.LAVA]: ['#ffe066', '#ff8f2e', '#e8582a', '#5c1d20'],
    [T.MUD]: ['#8c7150', '#6e5739', '#5d4930', '#3d4846'],
    [T.CRYSTAL]: [PALETTE[rock.G], PALETTE[rock.d], PALETTE[rock.d], PALETTE[rock.k]],
    [T.PATH]: ['#dcbd82', '#c7a46b', '#b18e58', '#8f6d44'],
  };
  const over = {
    desert: { [T.SAND]: ['#fff3d2', '#f6e3b0', '#ead39a', '#d8bc84'], [T.PATH]: ['#d9b276', '#c69a5e', '#b0864e', '#8d6a3e'] },
    frost: {
      [T.SAND]: ['#e6eaf0', '#c9ced8', '#b3b9c6', '#8f96a8'], [T.MUD]: ['#9aa2b4', '#7d8598', '#6a7286', '#4e5568'],
      [T.PATH]: ['#c8d4e2', '#b2c0d2', '#9eaec4', '#7c8ca4'], [T.ASH]: ['#7a7480', '#5a5560', '#4a4550', '#34303a'],
    },
    swamp: { [T.SAND]: ['#b2a170', '#9a8a5c', '#887a50', '#6c6040'], [T.PATH]: ['#9a8a62', '#857552', '#726446', '#5a4e36'] },
    crystal: { [T.SAND]: ['#c9c4e6', '#aaa4cc', '#968fbc', '#77709e'], [T.PATH]: ['#9d97c4', '#8680b0', '#726c9c', '#5a5480'] },
    lava: {
      [T.SAND]: ['#6e6266', '#58494e', '#4a3d42', '#352a2e'], [T.PATH]: ['#7a5e52', '#644a40', '#533c34', '#3e2c26'],
      [T.ASH]: ['#5a5054', '#3e363a', '#332c30', '#221c20'],
    },
    candy: {
      [T.SAND]: ['#ffffff', '#fff4e6', '#f8e4cc', '#e8c8a8'], [T.PATH]: ['#f6d29a', '#e8bc7e', '#d6a66a', '#b88650'],
      [T.MUD]: ['#9a6040', '#7a4a30', '#663c26', '#4a2a1a'], [T.ASH]: ['#7a5050', '#5a3a3a', '#4a2e2e', '#341e1e'],
      [T.SNOW]: ['#ffffff', '#fffaf4', '#fbeee4', '#f0d8cc'],
    },
    void: {
      [T.SAND]: ['#6a6280', '#4e4862', '#433e56', '#322d42'], [T.PATH]: ['#6e6496', '#5a5078', '#4c446a', '#3a3354'],
      [T.SNOW]: ['#efe8ff', '#d8d0f0', '#c4bce0', '#a49cc8'], [T.MUD]: ['#4a3a5a', '#3a2c4a', '#30243e', '#22182e'],
    },
  }[id];
  if (over) Object.assign(c, over);
  P = {
    id,
    hex: c,
    rgb: Object.fromEntries(Object.entries(c).map(([k, list]) => [k, list.map(RGB)])),
    water: { deep, mid: water.mid, shallow: mix(water.mid, water.light, 0.45), foam: water.foam, glint: water.light },
    wetSand: RGB(darken(c[T.SAND][2], 0.12)),
    foam: RGB(water.foam),
    shallow: RGB(mix(water.mid, water.light, 0.4)),
    speck: b.speck.map(RGB),
    detail: b.detail,
    tree: TREE_STYLE[id],
    rock,
    hillHi: RGB(lighten(g0, 0.2)),
    hillLo: RGB(darken(g1, 0.22)),
    hillRim: RGB(darken(g1, 0.36)),
  };
  palCache.set(id, P);
  return P;
}

/**
 * A representative colour for a tile type (minimap).
 * @param {number} type REALM_TILES value
 * @param {string} biomeId
 * @returns {string} '#rrggbb'
 */
export function realmTileColor(type, biomeId) {
  const P = realmPalette(biomeId);
  if (type === T.FOREST) return PALETTE[P.tree.map.V] ?? P.hex[T.FOREST][1];
  if (type === T.MOUNTAIN) return PALETTE[P.rock.G];
  if (type === T.CRYSTAL) return '#3be8d0';
  return (P.hex[type] ?? P.hex[T.GRASS])[1];
}

// ---------------------------------------------------------------------------------------------
// Overlay art (material letters, recoloured per biome)
// ---------------------------------------------------------------------------------------------

const OV = (s) => outline(px(s));
const TREES = {
  round: OV(`
    ...vvv...
    ..vvvvV..
    .vvvvVVV.
    vvvvVVVVm
    vvvVVVVmm
    .VVVVVmm.
    ..mVmmm..
    ....bn...
    ....bn...
    ...bbnn..
  `),
  pine: OV(`
    ...v...
    ..vvV..
    ..vVm..
    .vvVVm.
    ..vVm..
    .vvVVm.
    vvVVVmm
    .vVVmm.
    vvVVVmm
    ...bn..
    ...bn..
  `),
  palm: OV(`
    .vV....Vv..
    vvVV.VVVvv.
    v...VVV...v
    ...vVbVm...
    ..v..b..m..
    .....bn....
    ....bn.....
    ....bn.....
    ....bn.....
    ...bbnn....
  `),
  cactus: OV(`
    ...vV...
    .v.vV...
    .vVvV.v.
    ..VvV.V.
    ...vVVV.
    ...vV...
    ...vV...
    ..bbnn..
  `),
  willow: OV(`
    ...vvv...
    .vvvvvV..
    vvvvVVVVm
    vmvVVmVmm
    vm.VbmVm.
    vm..bn.m.
    .m..bn...
    ...bbnn..
  `),
  dead: OV(`
    .y.....y.
    ..n.n.n..
    ...nbn...
    .y.nb.n..
    ..nnbnn..
    ....bn...
    ....bn...
    ...bbnn..
  `),
  spire: OV(`
    ...y...
    ..vV...
    ..vVm..
    .vvVm..
    .vVVmm.
    vvVVVmm
    ..bnn..
    ..bnn..
  `),
  lolli: OV(`
    ..vVVm..
    .vVvvVm.
    .VvmmvV.
    .vVvVVm.
    ..mVVm..
    ....b...
    ....b...
    ....n...
    ...bbn..
  `),
};
const MOUNTAINS = [
  OV(`
    .......w........
    ......wwg.......
    .....wwgGd......
    ....gwgGGdd.....
    ....ggGGGddd....
    ...gggGGGdddd...
    ...ggGGGGddddk..
    ..gggGGGdddddk..
    ..ggGGGGddddddk.
    .gggGGGddddddkk.
    .ggGGGGdddddkkk.
    gggGGGddddddkkkk
    ggGGGGdddddkkkkk
    gGGGGddddddkkkkk
  `),
  OV(`
    ....w...........
    ...wwg.....w....
    ..wwgGd...wwG...
    ..gwGGd..gwGGd..
    .ggGGGddgggGGdd.
    .ggGGGdggGGGddd.
    gggGGddgGGGGdddk
    ggGGGdggGGGddddk
    ggGGdgggGGddddkk
    gGGGgggGGGddddkk
    gGGggGGGGdddddkk
    gGGgGGGGddddddkk
    gGgGGGGdddddkkkk
  `),
  OV(`
    ......ww........
    .....wwgd.......
    ....wwgGdd......
    ...ggwGGddd.....
    ..gggGGGdddd....
    ..ggGGGddddd....
    .gggGGGdddddk...
    .ggGGGddddddkk..
    gggGGGdddddkkk..
    ggGGGGddddkkkkk.
    gGGGGdddddkkkkkk
    GGGGdddddkkkkkkk
  `),
];
const BOULDER = OV(`
  .gGd.
  gGGdd
  Gddkk
`);
const CRYSTALS = [
  OV(`
    ....i.....
    ...ij..q..
    ...ijC.qp.
    .i.ijCqpP.
    .ijijCqpP.
    .ijCjCCpP.
    ijjCCCxPP.
    .xxxxxxx..
  `),
  OV(`
    ......q...
    ..i...qp..
    .ij..qpP..
    .ijC.qpPi.
    ijjCqqpPjC
    ijCCqpPPjC
    .xxxxxxxx.
  `),
];

/** Blit material rows into the buffer with a material->palette map. */
function blitOverlay(buf, rows, gx, gy, map, flip = false) {
  for (let j = 0; j < rows.length; j++) {
    const r = rows[j];
    const n = r.length;
    for (let i = 0; i < n; i++) {
      const ch = flip ? r[n - 1 - i] : r[i];
      if (ch === '.') continue;
      const pc = ch === 'o' ? 'o' : map[ch] ?? ch;
      const hex = PALETTE[pc];
      if (hex) buf.setRGB(gx + i, gy + j, RGB(hex));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Pixel buffer covering a world-pixel rectangle
// ---------------------------------------------------------------------------------------------

class RBuf {
  constructor(x0, y0, w, h) {
    this.x0 = x0;
    this.y0 = y0;
    this.w = w;
    this.h = h;
    this.d = new Uint8ClampedArray(w * h * 4);
  }
  setRGB(gx, gy, c) {
    const x = gx - this.x0;
    const y = gy - this.y0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.d[i] = c[0];
    this.d[i + 1] = c[1];
    this.d[i + 2] = c[2];
    this.d[i + 3] = 255;
  }
  blend(gx, gy, c, a) {
    const x = gx - this.x0;
    const y = gy - this.y0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const d = this.d;
    d[i] += (c[0] - d[i]) * a;
    d[i + 1] += (c[1] - d[i + 1]) * a;
    d[i + 2] += (c[2] - d[i + 2]) * a;
  }
}

// ---------------------------------------------------------------------------------------------
// Map painting
// ---------------------------------------------------------------------------------------------

/** Context shared by the painters for one render. */
function makeCtx(tiles, w, h, biomeId, seed) {
  const P = realmPalette(biomeId);
  const s = (seed | 0) ^ 0x5bd1e995;
  const N = noiseTex(s & 0xffff);
  const ox = Math.floor(hash3(1, 2, s) * NOISE_N);
  const oy = Math.floor(hash3(3, 4, s) * NOISE_N);
  const at = (tx, ty) => (tx < 0 || ty < 0 || tx >= w || ty >= h ? T.DEEP : tiles[ty * w + tx]);
  const noise = (gx, gy) => N[((gy + oy) & (NOISE_N - 1)) * NOISE_N + ((gx + ox) & (NOISE_N - 1))];
  return { tiles, w, h, P, s, at, noise };
}

// Gaussian weights of the 3x3 neighbour tiles for every pixel offset inside a tile, plus how much
// the tile's own type is favoured (1 at the centre, 0 at the edges).
const SIGMA = 0.55;
const KW = new Float32Array(TS * TS * 9);
const OWN = new Float32Array(TS * TS);
(() => {
  for (let py = 0; py < TS; py++) {
    for (let pxl = 0; pxl < TS; pxl++) {
      const ox = (pxl + 0.5) / TS - 0.5;
      const oy = (py + 0.5) / TS - 0.5;
      let sum = 0;
      const base = (py * TS + pxl) * 9;
      for (let k = 0; k < 9; k++) {
        const dx = (k % 3) - 1 - ox;
        const dy = Math.floor(k / 3) - 1 - oy;
        const wgt = Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA));
        KW[base + k] = wgt;
        sum += wgt;
      }
      for (let k = 0; k < 9; k++) KW[base + k] /= sum;
      const c = Math.max(Math.abs(ox), Math.abs(oy));
      const e = Math.min(1, Math.max(0, (c - 0.08) / (0.42 - 0.08)));
      OWN[py * TS + pxl] = 1 - e * e * (3 - 2 * e);
    }
  }
})();

const scores = new Float32Array(TYPE_COUNT);
/**
 * Smoothed terrain at a world pixel: the type with the highest Gaussian-weighted vote among the 3x3
 * neighbour tiles (own tile favoured near its centre, a little noise for organic edges).
 * Returns the land fraction f (0 = water .. 1 = land) and writes the winning wet / dry types.
 */
const pick = { f: 0, wet: T.WATER, dry: T.GRASS };
function smoothAt(C, tx, ty, pxl, py, gx, gy) {
  scores.fill(0);
  const base = (py * TS + pxl) * 9;
  for (let k = 0; k < 9; k++) scores[C.at(tx + (k % 3) - 1, ty + Math.floor(k / 3) - 1)] += KW[base + k];
  const own = C.at(tx, ty);
  scores[own] += OWN[py * TS + pxl] * 1.2 + (C.noise(gx * 2 + 31, gy * 2 + 17) - 0.5) * 0.3;
  let land = 0;
  let wet = 0;
  let bestWet = -1;
  let bestDry = -1;
  pick.wet = T.WATER;
  pick.dry = T.SAND;
  for (let t = 0; t < TYPE_COUNT; t++) {
    const v = scores[t];
    if (v <= 0) continue;
    if (isWet(t)) {
      wet += v;
      if (v > bestWet) {
        bestWet = v;
        pick.wet = t;
      }
    } else {
      land += v;
      if (v > bestDry) {
        bestDry = v;
        pick.dry = t;
      }
    }
  }
  pick.f = land / (land + wet || 1) + (C.noise(gx * 3, gy * 3) - 0.5) * 0.12;
  return pick;
}

/** Land fraction at a world pixel (used to keep overlays and details off the water). */
function landField(C, gx, gy) {
  const tx = Math.floor(gx / TS);
  const ty = Math.floor(gy / TS);
  return smoothAt(C, tx, ty, gx - tx * TS, gy - ty * TS, gx, gy).f;
}

function groundRGB(C, type, gx, gy) {
  const pal = C.P.rgb[type] ?? C.P.rgb[T.GRASS];
  const n = C.noise(gx, gy);
  const r = hash3(gx, gy, C.s);
  switch (type) {
    case T.DEEP:
    case T.WATER: {
      const wave = (gy + Math.floor(n * 7) + (gx >> 3)) % 9 === 0 && r < 0.55;
      return wave ? pal[0] : n > 0.62 ? pal[2] : pal[1];
    }
    case T.SAND:
      if ((gy * 2 + gx + Math.floor(n * 10)) % 11 === 0) return pal[2];
      return r < 0.04 ? pal[0] : r > 0.97 ? pal[3] : n > 0.6 ? pal[2] : pal[1];
    case T.LAVA:
      if (n > 0.66) return pal[3];
      if (n > 0.6) return pal[2];
      return r < 0.06 ? pal[0] : n < 0.35 ? pal[0] : pal[1];
    case T.MUD:
      if (n > 0.64) return r < 0.1 ? pal[2] : pal[3];
      return r < 0.05 ? pal[0] : n > 0.5 ? pal[2] : pal[1];
    case T.ASH:
      if (r < 0.012) return RGB('#f0873c');
      if (r < 0.016) return RGB('#ffd84d');
      return r < 0.06 ? pal[0] : n > 0.58 ? pal[2] : n < 0.3 ? pal[3] : pal[1];
    case T.SNOW:
      if (r < 0.015) return pal[0];
      return n > 0.66 ? pal[3] : n > 0.55 ? pal[2] : pal[1];
    case T.PATH:
      return r < 0.04 ? pal[0] : r > 0.95 ? pal[3] : n > 0.55 ? pal[2] : pal[1];
    case T.MOUNTAIN:
    case T.CRYSTAL:
      return r < 0.05 ? pal[0] : n > 0.55 ? pal[2] : pal[1];
    default: {
      // grass-like (GRASS, FOREST floor, HILL)
      if (r < 0.035) return C.P.speck[Math.floor(r * 1000) % C.P.speck.length];
      if (r > 0.975) return pal[3];
      return n > 0.6 ? pal[2] : n < 0.28 ? pal[0] : pal[1];
    }
  }
}

/** Paint ground + details for tiles [tx0..tx1] x [ty0..ty1]. */
function paintGround(C, buf, tx0, ty0, tx1, ty1) {
  const { at, P } = C;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const t = at(tx, ty);
      const wet = isWet(t);
      let coastal = false;
      let mixed = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const n = at(tx + dx, ty + dy);
          if (isWet(n) !== wet) coastal = true;
          if (n !== t) mixed = true;
        }
      }
      const x0 = tx * TS;
      const y0 = ty * TS;
      for (let py = 0; py < TS; py++) {
        for (let pxl = 0; pxl < TS; pxl++) {
          const gx = x0 + pxl;
          const gy = y0 + py;
          let water = wet;
          let dist = 99;
          let tt = t;
          if (mixed) {
            const sm = smoothAt(C, tx, ty, pxl, py, gx, gy);
            water = sm.f < 0.5;
            if (coastal) dist = Math.abs(sm.f - 0.5) * 16;
            tt = water ? sm.wet : sm.dry;
          }
          let c = groundRGB(C, tt, gx, gy);
          if (coastal) {
            if (!water) {
              const beach = 3 + (C.noise(gx * 2, gy * 2) - 0.5) * 2.4;
              if (dist < 1.2) c = P.wetSand;
              else if (dist < beach && tt !== T.MOUNTAIN && tt !== T.CRYSTAL) c = groundRGB(C, T.SAND, gx, gy);
            } else if (dist < 1) c = P.foam;
            else if (dist < 3.6 && (dist > 1.8 || (gx + gy) % 2)) c = P.shallow;
          }
          buf.setRGB(gx, gy, c);
        }
      }
      paintDetails(C, buf, tx, ty, t, coastal);
    }
  }
}

/** Small per-tile ground decorations (deterministic per tile). */
function paintDetails(C, buf, tx, ty, t, coastal) {
  const { P, s } = C;
  const x0 = tx * TS;
  const y0 = ty * TS;
  const r = (k) => hash3(tx * 7 + k, ty * 13 - k, s + 77);
  const ok = (x, y) => !coastal || landField(C, x0 + x, y0 + y) > 0.62;
  const put = (x, y, hex) => {
    if (ok(x, y)) buf.setRGB(x0 + x, y0 + y, RGB(hex));
  };
  const cx = 4 + Math.floor(r(1) * 8);
  const cy = 5 + Math.floor(r(2) * 8);
  if (t === T.GRASS || t === T.HILL) {
    const roll = r(3);
    const dark = '#' + P.speck[1].map((v) => v.toString(16).padStart(2, '0')).join('');
    const light = '#' + P.speck[2].map((v) => v.toString(16).padStart(2, '0')).join('');
    switch (P.detail) {
      case 'grass':
        if (roll < 0.55) {
          put(cx, cy, dark);
          put(cx + 2, cy, dark);
          put(cx + 1, cy - 1, dark);
          put(cx + 1, cy - 2, light);
        } else if (roll < 0.68) {
          put(cx, cy, '#fbf7ef');
          put(cx, cy - 1, r(4) < 0.5 ? '#ffd84d' : '#ff86cf');
        }
        break;
      case 'sand':
        if (roll < 0.4) {
          put(cx, cy, '#b39a4a');
          put(cx + 1, cy - 1, '#c8b05c');
          put(cx + 2, cy, '#b39a4a');
        } else if (roll < 0.47) {
          put(cx, cy, '#43a047');
          put(cx, cy - 1, '#43a047');
          put(cx - 1, cy - 1, '#43a047');
        }
        break;
      case 'snow':
        if (roll < 0.35) {
          put(cx, cy, '#5f8a6a');
          put(cx + 1, cy - 1, '#5f8a6a');
        } else if (roll < 0.6) put(cx, cy, '#ffffff');
        break;
      case 'swamp':
        if (roll < 0.35) {
          for (let i = 0; i < 4; i++) put(cx + i, cy, '#46603a');
          put(cx + 1, cy - 1, '#46603a');
          put(cx + 2, cy - 1, '#46603a');
        } else if (roll < 0.55) {
          put(cx, cy, '#7a8f4f');
          put(cx, cy - 1, '#7a8f4f');
        }
        break;
      case 'crystal':
        if (roll < 0.3) {
          put(cx, cy, '#3be8d0');
          put(cx, cy - 1, '#d2fff8');
        }
        break;
      case 'cracks':
        if (roll < 0.4) for (let i = 0; i < 5; i++) put(cx + i, cy + (i % 2), i === 2 ? '#ffae3c' : '#e8582a');
        break;
      case 'sprinkles':
        for (let i = 0; i < 3; i++) {
          if (r(10 + i) < 0.6) {
            const cols = ['#ff86cf', '#66dcff', '#ffd84d', '#8de05e', '#fbf7ef', '#a65ef0'];
            const c = cols[Math.floor(r(20 + i) * cols.length)];
            const x = 2 + Math.floor(r(30 + i) * 12);
            const y = 2 + Math.floor(r(40 + i) * 12);
            put(x, y, c);
            if (r(50 + i) < 0.5) put(x + 1, y, c);
            else put(x, y + 1, c);
          }
        }
        break;
      case 'stars':
        if (roll < 0.3) put(cx, cy, r(5) < 0.3 ? '#ff86cf' : '#c8c9dc');
        break;
      default:
        break;
    }
  } else if (t === T.SAND && r(3) < 0.12) {
    put(cx, cy, '#fbf7ef');
    put(cx + 1, cy, '#c6a66c');
  } else if (t === T.ASH && r(3) < 0.25) {
    // burnt stump
    put(cx, cy - 1, '#2a1b33');
    put(cx + 1, cy - 1, '#3f2f55');
    put(cx, cy, '#3f2f55');
    put(cx + 1, cy, '#2a1b33');
    put(cx + 2, cy, '#f0873c');
  } else if (t === T.MUD && r(3) < 0.35) {
    put(cx, cy, '#43a047');
    put(cx, cy - 1, '#43a047');
    put(cx, cy - 2, '#8de05e');
    put(cx + 2, cy, '#43a047');
    put(cx + 2, cy - 1, '#5c3a2a');
  } else if (t === T.SNOW && r(3) < 0.2) {
    put(cx, cy, '#b9cde0');
    put(cx + 1, cy, '#b9cde0');
    put(cx, cy - 1, '#ffffff');
  } else if (t === T.PATH && r(3) < 0.3) {
    put(cx, cy, '#8f8eab');
    put(cx + 1, cy, '#5d5a7c');
  }
}

/** Overlays (hills, trees, mountains, crystals) for tiles in rows/cols range, in back-to-front order. */
function paintOverlays(C, buf, tx0, ty0, tx1, ty1) {
  const { at, P, s } = C;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (tx < 0 || ty < 0 || tx >= C.w || ty >= C.h) continue;
      const t = at(tx, ty);
      if (t !== T.HILL && t !== T.FOREST && t !== T.MOUNTAIN && t !== T.CRYSTAL) continue;
      const x0 = tx * TS;
      const y0 = ty * TS;
      const r = (k) => hash3(tx * 31 + k, ty * 17 + k * 3, s + 991);
      const coastal = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [1, -1], [-1, 1]].some(([dx, dy]) => isWet(at(tx + dx, ty + dy)));
      const land = (x, y) => !coastal || landField(C, x, y) > 0.6;
      if (t === T.HILL) paintHill(C, buf, x0, y0, r, land);
      else if (t === T.FOREST) {
        const spots = [
          [3 + Math.floor(r(1) * 3), 7 + Math.floor(r(2) * 2)],
          [10 + Math.floor(r(3) * 3), 5 + Math.floor(r(4) * 3)],
          [6 + Math.floor(r(5) * 4), 13 + Math.floor(r(6) * 2)],
        ];
        if (r(7) < 0.5) spots.push([12 + Math.floor(r(8) * 2), 14]);
        spots.sort((a, b) => a[1] - b[1]);
        spots.forEach(([bx, by], i) => {
          if (!land(x0 + bx, y0 + by)) return;
          const shapes = P.tree.shapes;
          const shape = TREES[shapes[Math.floor(r(10 + i) * shapes.length)]];
          const flip = r(20 + i) < 0.5;
          blitOverlay(buf, shape, x0 + bx - (shape[0].length >> 1), y0 + by - shape.length + 1, P.tree.map, flip);
        });
      } else if (t === T.MOUNTAIN) {
        if (!land(x0 + 8, y0 + 12)) continue;
        const m = MOUNTAINS[Math.floor(r(1) * MOUNTAINS.length)];
        const flip = r(2) < 0.5;
        const jx = Math.floor(r(3) * 5) - 2;
        const jy = Math.floor(r(4) * 3) - 1;
        blitOverlay(buf, m, x0 + 8 - (m[0].length >> 1) + jx, y0 + TS - m.length + 1 + jy, P.rock, flip);
        // a boulder at the foot now and then
        if (r(5) < 0.35) blitOverlay(buf, BOULDER, x0 + 2 + Math.floor(r(6) * 10), y0 + 11, P.rock, r(7) < 0.5);
      } else if (t === T.CRYSTAL) {
        const n = r(9) < 0.5 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const cr = CRYSTALS[Math.floor(r(1 + i) * CRYSTALS.length)];
          const bx = n === 1 ? 8 : i === 0 ? 5 : 11;
          const by = n === 1 ? 14 : i === 0 ? 10 : 15;
          if (!land(x0 + bx, y0 + by)) continue;
          blitOverlay(buf, cr, x0 + bx - (cr[0].length >> 1), y0 + by - cr.length + 1, {}, r(5 + i) < 0.5);
        }
      }
    }
  }
}

function paintHill(C, buf, x0, y0, r, land) {
  const { P } = C;
  const cx = 8 + (r(1) - 0.5) * 2;
  const cy = 10;
  const rx = 7.2;
  const ry = 5.2;
  for (let y = 2; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      if (!land(x0 + x, y0 + y)) continue;
      const lit = -dx - dy;
      if (d > 0.78 && dy > 0.2) buf.setRGB(x0 + x, y0 + y, P.hillRim);
      else if (lit > 0.55) buf.setRGB(x0 + x, y0 + y, P.hillHi);
      else if (lit < -0.45) buf.setRGB(x0 + x, y0 + y, P.hillLo);
    }
  }
}

function paintRegion(C, buf, tx0, ty0, tx1, ty1) {
  paintGround(C, buf, tx0, ty0, tx1, ty1);
  paintOverlays(C, buf, tx0 - 1, ty0 - 1, tx1 + 1, ty1 + 1);
}

function bufToImage(buf, g) {
  const img = g.createImageData(buf.w, buf.h);
  img.data.set(buf.d);
  return img;
}

/**
 * Pre-render the whole realm map.
 * @param {Uint8Array|number[]} tiles REALM_TILES per tile, row-major (index = y * w + x)
 * @param {number} w @param {number} h tiles
 * @param {string} biomeId meadow | desert | frost | swamp | crystal | lava | candy | void
 * @param {number} [seed]
 * @returns {HTMLCanvasElement} (w*16) x (h*16)
 */
export function renderRealmMap(tiles, w, h, biomeId, seed = 1) {
  const c = makeCanvas(w * TS, h * TS);
  const g = c.getContext ? c.getContext('2d') : null;
  if (!g) return c;
  const C = makeCtx(tiles, w, h, biomeId, seed);
  // paint in horizontal bands to keep peak memory modest on phones
  const band = 16;
  for (let ty = 0; ty < h; ty += band) {
    const ty1 = Math.min(h - 1, ty + band - 1);
    const buf = new RBuf(0, ty * TS, w * TS, (ty1 - ty + 1) * TS);
    paintRegion(C, buf, 0, ty, w - 1, ty1);
    g.putImageData(bufToImage(buf, g), 0, ty * TS);
  }
  return c;
}

/**
 * Redraw one tile (and the neighbours whose shoreline / blending / overlays depend on it) into a
 * canvas made by renderRealmMap. Uses putImageData, so the context transform is ignored.
 * @param {CanvasRenderingContext2D} ctx context of the pre-rendered map canvas
 * @param {Uint8Array|number[]} tiles @param {number} w @param {number} h
 * @param {number} x @param {number} y tile that changed
 * @param {string} biomeId @param {number} [seed] same seed as renderRealmMap
 */
export function renderRealmTile(ctx, tiles, w, h, x, y, biomeId, seed = 1) {
  if (!ctx || !ctx.putImageData) return;
  const tx0 = Math.max(0, x - 1);
  const ty0 = Math.max(0, y - 1);
  const tx1 = Math.min(w - 1, x + 1);
  const ty1 = Math.min(h - 1, y + 1);
  const C = makeCtx(tiles, w, h, biomeId, seed);
  const buf = new RBuf(tx0 * TS, ty0 * TS, (tx1 - tx0 + 1) * TS, (ty1 - ty0 + 1) * TS);
  paintRegion(C, buf, tx0, ty0, tx1, ty1);
  ctx.putImageData(bufToImage(buf, ctx), tx0 * TS, ty0 * TS);
}

// ---------------------------------------------------------------------------------------------
// Per-frame overlays (cheap, view-clipped)
// ---------------------------------------------------------------------------------------------

function viewRange(view, w, h) {
  const v = view ?? { x0: 0, y0: 0, x1: w, y1: h };
  return [Math.max(0, Math.floor(v.x0)), Math.max(0, Math.floor(v.y0)), Math.min(w - 1, Math.ceil(v.x1)), Math.min(h - 1, Math.ceil(v.y1))];
}

/**
 * Animate WATER / DEEP glints and LAVA bubbles on the visible tiles only. Draws in world pixels.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Uint8Array|number[]} tiles @param {number} w @param {number} h
 * @param {string} biomeId @param {number} t seconds
 * @param {{x0:number,y0:number,x1:number,y1:number}} [view] visible rect in tiles
 */
export function drawRealmWater(ctx, tiles, w, h, biomeId, t, view) {
  if (!ctx) return;
  const P = realmPalette(biomeId);
  const [x0, y0, x1, y1] = viewRange(view, w, h);
  const glint = new Path2DLike();
  const glint2 = new Path2DLike();
  const lavaHi = new Path2DLike();
  const lavaMid = new Path2DLike();
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const type = tiles[ty * w + tx];
      if (type !== T.WATER && type !== T.DEEP && type !== T.LAVA) continue;
      const h1 = hash3(tx, ty, 7);
      const h2 = hash3(tx, ty, 13);
      const bx = tx * TS;
      const by = ty * TS;
      if (type === T.LAVA) {
        const ph = (t * 0.7 + h1) % 1;
        const s = Math.sin(ph * Math.PI * 2);
        const gx = bx + 4 + Math.floor(h2 * 8);
        const gy = by + 4 + Math.floor(h1 * 8);
        if (s > 0.3) lavaHi.rect(gx, gy, 2, 2);
        if (s > 0.75) lavaMid.rect(gx - 1, gy, 4, 2);
        const ph2 = (t * 0.45 + h2) % 1;
        if (ph2 < 0.5) lavaMid.rect(bx + 3 + Math.floor(((h1 * 9) % 1) * 9) + Math.floor(ph2 * 4), by + 11, 3, 1);
        continue;
      }
      // two drifting glints per tile, kept in the always-wet tile centre (4..11)
      for (let k = 0; k < 2; k++) {
        const hk = k ? h2 : h1;
        const ph = (t * (0.35 + hk * 0.3) + hk * 7) % 1;
        const life = Math.sin(ph * Math.PI);
        if (life < 0.3) continue;
        const len = life > 0.75 ? 3 : 2;
        const gx = bx + 4 + Math.floor(((hk * 13) % 1) * 5) + Math.floor(ph * 3);
        const gy = by + 4 + Math.floor(((hk * 29) % 1) * 8);
        (k ? glint2 : glint).rect(gx, gy, len, 1);
      }
    }
  }
  ctx.save();
  ctx.globalAlpha *= 0.85;
  glint.fill(ctx, P.water.glint);
  ctx.globalAlpha *= 0.8;
  glint2.fill(ctx, P.water.foam);
  ctx.restore();
  lavaMid.fill(ctx, '#ffae3c');
  lavaHi.fill(ctx, '#fff1a8');
}

/** Batches rects and fills them with one call (Path2D is not available in every test runtime). */
class Path2DLike {
  constructor() {
    this.r = [];
  }
  rect(x, y, w, h) {
    this.r.push(x, y, w, h);
  }
  fill(ctx, color) {
    if (!this.r.length) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < this.r.length; i += 4) ctx.rect(this.r[i], this.r[i + 1], this.r[i + 2], this.r[i + 3]);
    ctx.fill();
  }
}

/**
 * Team territory: ~12% team tint on owned tiles + crisp 1px dashed border where ownership changes.
 * Draws in world pixels, visible rect only.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Int8Array|number[]} owner -1 none, 0 blue, 1 red (row-major w x h)
 * @param {number} w @param {number} h
 * @param {{x0:number,y0:number,x1:number,y1:number}} [view] visible rect in tiles
 */
export function drawTerritory(ctx, owner, w, h, view) {
  if (!ctx) return;
  const [x0, y0, x1, y1] = viewRange(view, w, h);
  const own = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : owner[y * w + x]);
  for (const team of [0, 1]) {
    const tint = new Path2DLike();
    const dash = new Path2DLike();
    const shade = new Path2DLike();
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (own(tx, ty) !== team) continue;
        const bx = tx * TS;
        const by = ty * TS;
        tint.rect(bx, by, TS, TS);
        // dashes 2 on / 2 off, aligned to world pixels so they line up across tiles
        if (own(tx, ty - 1) !== team) for (let i = 0; i < TS; i += 4) {
          dash.rect(bx + i, by, 2, 1);
          shade.rect(bx + i, by + 1, 2, 1);
        }
        if (own(tx, ty + 1) !== team) for (let i = 2; i < TS; i += 4) {
          dash.rect(bx + i, by + TS - 1, 2, 1);
          shade.rect(bx + i, by + TS - 2, 2, 1);
        }
        if (own(tx - 1, ty) !== team) for (let i = 2; i < TS; i += 4) {
          dash.rect(bx, by + i, 1, 2);
          shade.rect(bx + 1, by + i, 1, 2);
        }
        if (own(tx + 1, ty) !== team) for (let i = 0; i < TS; i += 4) {
          dash.rect(bx + TS - 1, by + i, 1, 2);
          shade.rect(bx + TS - 2, by + i, 1, 2);
        }
      }
    }
    const tc = TEAM_COLORS[team];
    ctx.save();
    ctx.globalAlpha *= 0.12;
    tint.fill(ctx, tc.main);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha *= 0.45;
    shade.fill(ctx, tc.dark);
    ctx.restore();
    dash.fill(ctx, tc.light);
  }
}

/** Biome ids supported by the realm renderer (same as the arenas). */
export const REALM_BIOMES = Object.freeze(Object.keys(BIOMES));
export { TYPE_COUNT as REALM_TILE_COUNT };
