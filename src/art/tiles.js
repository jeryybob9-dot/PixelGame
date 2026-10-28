/**
 * Brickbox Royale — arena backgrounds (8 biomes) and the animated river.
 *
 * World: 18 x 32 tiles of 16 px = 288 x 512. Team 1 (red) holds the top half, team 0 (blue) the bottom.
 * River rows 15-16 (y 240-272), bridges on columns 2-4 and 13-15, tower pads under the 6 towers,
 * decorations only on the outer columns (0 and 17) so they never hide units.
 */

import { px, outline } from './icons.js';
import { makeCanvas } from './sprite-cache.js';
import { PALETTE, hexToRgb, mix, TEAM_COLORS } from './palette.js';

export const TILE = 16;
export const ARENA_W = 288;
export const ARENA_H = 512;
/** River rows 15-16 in px. Water is visible between WATER_TOP and WATER_BOTTOM (banks overlap the edges). */
export const RIVER_Y = 240;
export const RIVER_H = 32;
const WATER_TOP = 243;
const WATER_BOTTOM = 270;
/** Bridge spans in px: [x0, x1). */
export const BRIDGES_PX = Object.freeze([
  [32, 80],
  [208, 256],
]);

/**
 * Biome definitions. Colours are hex; `props` are decoration types drawn on the outer columns.
 * `liquid` picks the river animation: water | lava | goo | void | soda | ice.
 */
export const BIOMES = Object.freeze({
  meadow: {
    id: 'meadow', name: 'Meadow',
    ground: ['#6cb553', '#64ab4c'], speck: ['#7fc960', '#589a42', '#8bd36b'], detail: 'grass', rim: '#4f8f3d',
    path: '#b8a36a', accent: '#ffd84d',
    bank: ['#8a6a44', '#5c4130', '#a88a5c'],
    liquid: 'water', water: { deep: '#2a5fb0', mid: '#3a86d6', light: '#78c4f2', foam: '#d8f2ff' },
    bridge: { kind: 'wood', deck: '#c88f55', dark: '#8e5a32', rail: '#5c3a2a', light: '#e3b07a' },
    pad: { top: '#bdbccd', side: '#9897b3', dark: '#5d5a7c' },
    props: ['tree', 'bush', 'flowers', 'rock', 'tree', 'bush'],
  },
  desert: {
    id: 'desert', name: 'Desert',
    ground: ['#e6c47c', '#ddb970'], speck: ['#f0d391', '#c9a25a', '#d6ad66'], detail: 'sand', rim: '#c79e58',
    path: '#c99f5f', accent: '#f08a3c',
    bank: ['#b98a4c', '#8a5f34', '#d9ad6c'],
    liquid: 'water', water: { deep: '#1f7f9e', mid: '#2fa8c2', light: '#79dbe6', foam: '#dcfbff' },
    bridge: { kind: 'brick', deck: '#d8a15e', dark: '#a0683a', rail: '#7a4a2a', light: '#f0c27e' },
    pad: { top: '#e0c9a0', side: '#bfa274', dark: '#8a6a44' },
    props: ['cactus', 'rock', 'bones', 'cactus', 'tumbleweed'],
  },
  frost: {
    id: 'frost', name: 'Frost Peaks',
    ground: ['#dbe7f0', '#d0dfea'], speck: ['#f4fbff', '#b9cde0', '#c6d8e8'], detail: 'snow', rim: '#b7cadd',
    path: '#c2d2e2', accent: '#66dcff',
    bank: ['#8fa6c0', '#5d6f90', '#e8f2fa'],
    liquid: 'ice', water: { deep: '#2c6fb6', mid: '#4a9ad8', light: '#a6dcf6', foam: '#f2fbff' },
    bridge: { kind: 'wood', deck: '#b48a62', dark: '#7a5638', rail: '#4f3628', light: '#eef6fb' },
    pad: { top: '#c8d1e0', side: '#9aa6bf', dark: '#5f6a8a' },
    props: ['pine', 'snowrock', 'icecrystal', 'pine', 'snowman'],
  },
  swamp: {
    id: 'swamp', name: 'Gloom Swamp',
    ground: ['#5f7d4b', '#577444'], speck: ['#6d8d55', '#4a653a', '#7a8f4f'], detail: 'swamp', rim: '#45603a',
    path: '#6b6a44', accent: '#8de05e',
    bank: ['#5a4a32', '#3c3024', '#77654a'],
    liquid: 'goo', water: { deep: '#2f4a32', mid: '#46663e', light: '#7fa356', foam: '#b6d77a' },
    bridge: { kind: 'wood', deck: '#8e7350', dark: '#5f4a32', rail: '#3c3024', light: '#a88c62' },
    pad: { top: '#8e968a', side: '#6c7468', dark: '#454c44' },
    props: ['deadtree', 'mushroom', 'reeds', 'deadtree', 'reeds'],
  },
  crystal: {
    id: 'crystal', name: 'Crystal Caves',
    ground: ['#5d628f', '#575b87'], speck: ['#6a70a0', '#4b4f7a', '#7d84b8'], detail: 'crystal', rim: '#464a74',
    path: '#6e6a96', accent: '#3be8d0',
    bank: ['#463f6e', '#2e2850', '#6b63a0'],
    liquid: 'water', water: { deep: '#1d6f86', mid: '#22a6b0', light: '#5fe9dc', foam: '#d2fff8' },
    bridge: { kind: 'stone', deck: '#8f8eab', dark: '#5d5a7c', rail: '#3f3a60', light: '#c8c9dc' },
    pad: { top: '#9a97c0', side: '#77739f', dark: '#4a4672' },
    props: ['crystal', 'glowshroom', 'crystal', 'rock2'],
  },
  lava: {
    id: 'lava', name: 'Lava Forge',
    ground: ['#4b3a3f', '#443438'], speck: ['#57444a', '#3a2c30', '#6a4a44'], detail: 'cracks', rim: '#3a2c30',
    path: '#5a4440', accent: '#f08a3c',
    bank: ['#2f2226', '#1e1518', '#5a3a34'],
    liquid: 'lava', water: { deep: '#a32e2b', mid: '#e8582a', light: '#ffae3c', foam: '#fff1a8' },
    bridge: { kind: 'iron', deck: '#6b6680', dark: '#45405a', rail: '#2a2438', light: '#9a96b0' },
    pad: { top: '#6a6070', side: '#4f4656', dark: '#30283a' },
    props: ['obsidian', 'vent', 'charred', 'obsidian'],
  },
  candy: {
    id: 'candy', name: 'Candy Land',
    ground: ['#f4c8da', '#eebfd2'], speck: ['#fbd9e6', '#e3a9c0', '#ffffff'], detail: 'sprinkles', rim: '#e3a9c0',
    path: '#f7dcb0', accent: '#ff86cf',
    bank: ['#8a5236', '#5e3424', '#b8764e'],
    liquid: 'soda', water: { deep: '#c2477f', mid: '#e86aa6', light: '#ffa7cf', foam: '#ffe6f2' },
    bridge: { kind: 'wafer', deck: '#f2c27a', dark: '#c48a4a', rail: '#8a5236', light: '#ffe0a8' },
    pad: { top: '#fff1e0', side: '#f2cfa8', dark: '#c48a6a' },
    props: ['lollipop', 'candycane', 'gumdrop', 'lollipop'],
  },
  void: {
    id: 'void', name: 'The Void',
    ground: ['#2b2344', '#271f3e'], speck: ['#3a2f5a', '#1f1830', '#463a6e'], detail: 'stars', rim: '#1e1832',
    path: '#352b52', accent: '#a65ef0',
    bank: ['#1a1428', '#0f0b18', '#4a3a78'],
    liquid: 'void', water: { deep: '#14081f', mid: '#3a1660', light: '#a65ef0', foam: '#ff86cf' },
    bridge: { kind: 'rune', deck: '#4a4270', dark: '#2e2850', rail: '#1a1428', light: '#a65ef0' },
    pad: { top: '#4a4470', side: '#363058', dark: '#1e1a36' },
    props: ['floatrock', 'runepillar', 'voideye', 'floatrock'],
  },
});

// ---------------------------------------------------------------------------------------------
// Pixel buffer
// ---------------------------------------------------------------------------------------------

function mulberry32(a) {
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

class Buf {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.d = new Uint8ClampedArray(w * h * 4);
  }
  set(x, y, hex, a = 1) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || !hex) return;
    const [r, g, b] = hexToRgb(hex);
    const i = (y * this.w + x) * 4;
    const d = this.d;
    if (a >= 1) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
    } else {
      d[i] = d[i] + (r - d[i]) * a;
      d[i + 1] = d[i + 1] + (g - d[i + 1]) * a;
      d[i + 2] = d[i + 2] + (b - d[i + 2]) * a;
      d[i + 3] = Math.max(d[i + 3], Math.round(255 * a));
    }
  }
  rect(x, y, w, h, hex, a = 1) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, hex, a);
  }
  /** Palette rows at (x, y) (top-left). */
  rows(rows, x, y, map = null) {
    for (let j = 0; j < rows.length; j++) {
      const r = rows[j];
      for (let i = 0; i < r.length; i++) {
        const ch = r[i];
        if (ch === '.') continue;
        const hex = (map && map[ch]) || PALETTE[ch];
        if (hex) this.set(x + i, y + j, hex);
      }
    }
  }
  toCanvas() {
    const c = makeCanvas(this.w, this.h);
    const g = c.getContext ? c.getContext('2d') : null;
    if (!g) return c;
    const img = g.createImageData(this.w, this.h);
    img.data.set(this.d);
    g.putImageData(img, 0, 0);
    return c;
  }
}

// ---------------------------------------------------------------------------------------------
// Decoration props (palette rows; outlined)
// ---------------------------------------------------------------------------------------------

const P = (s) => outline(px(s));
const PROPS = {
  tree: P(`
    ..............
    .....vvvV.....
    ...vvvvvvVV...
    ..vvhvvvVVVV..
    ..vvvvvvVVVm..
    .vvvvvVVVVVmm.
    .vvvvVVVVVmmm.
    .VvvVVVVVmmmm.
    ..VVVVVmmmmm..
    ...mmVVmmmm...
    .....bBn......
    .....bBn......
    .....bBn......
    ....bbBnn.....
    ..............
  `),
  bush: P(`
    ...........
    ...vvv.vv..
    ..vvhvvvVV.
    .vvvvvVVVVm
    .VvvVVVVmmm
    ..VVVmmmmm.
    ...........
  `),
  flowers: P(`
    .........
    .y....q..
    yhy..qwq.
    .y.r..q..
    .V.rwr.V.
    .V..r..V.
    .........
  `),
  rock: P(`
    ..........
    ...gggG...
    ..gGGGGd..
    .gGGGGGdd.
    .GGGGdddd.
    ..dddddd..
    ..........
  `),
  rock2: P(`
    ..........
    ...GGGd...
    ..GGdddk..
    .GGddddkk.
    .dddddkkk.
    ..kkkkkk..
    ..........
  `),
  cactus: P(`
    ..........
    ....vV....
    ....vV....
    .v..vV....
    .vV.vV.vV.
    .vVVvV.vV.
    ..VVvVVVV.
    ....vVVV..
    ....vV....
    ....vV....
    ...bbBn...
    ..........
  `),
  bones: P(`
    ..........
    ...uuuU...
    ..uouuoU..
    ..uuuuUU..
    ...ukuk...
    u.......Uu
    .uUUUUUUu.
    ..........
  `),
  tumbleweed: P(`
    .........
    ..bBb.B..
    .B.bBbBb.
    .bBb.bBB.
    .BbBBb.b.
    ..bB.Bb..
    .........
  `),
  pine: P(`
    ............
    .....ww.....
    ....wwwV....
    ....VwVV....
    ...wwwwwV...
    ...VVwVVm...
    ..wwwwwwwV..
    ..VVVwVVmm..
    .wwwwwwwwwV.
    .VVVVVVmmmm.
    .....Bn.....
    .....Bn.....
    ............
  `),
  snowrock: P(`
    ..........
    ...www....
    ..wwwwwi..
    .GwiwwGGd.
    .GGGGdddd.
    ..dddddd..
    ..........
  `),
  icecrystal: P(`
    .........
    ....i....
    ...ic....
    ...icC.i.
    .i.icCic.
    .icicCiC.
    .icCcCCC.
    ..CCCCC..
    .........
  `),
  snowman: P(`
    .........
    ...kkk...
    ..kkkkk..
    ...www...
    ..wowow..
    ..wwaww..
    ...www...
    ..wwwwwg.
    .wTwwwwgg
    .wwwwwwgg
    ..wwwwgg.
    .........
  `),
  deadtree: P(`
    ............
    ..n......n..
    ...n.n..n...
    ....nBnn....
    ..n..Bn.....
    ...nnBn..n..
    .....Bnnn...
    .....Bn.....
    .....Bn.....
    ....BBnn....
    ............
  `),
  mushroom: P(`
    .........
    ...rrrr..
    ..rwrrwR.
    .rrrrwrRR
    ..RRRRRR.
    ....ww...
    ....wg...
    ...wwgg..
    .........
  `),
  reeds: P(`
    ........
    ..n...n.
    ..B.n.B.
    ..V.B.V.
    .vV.V.Vm
    .vV.VvVm
    .VvmVVmm
    ........
  `),
  crystal: P(`
    ..........
    .....j....
    ....jjC...
    ..q.jhC...
    ..pqjjC.j.
    ..pPjjCjjC
    .pPPjjCjjC
    .pPPCCCCCC
    ..dddddd..
    ..........
  `),
  glowshroom: P(`
    .........
    ...jjjj..
    ..jhjjjC.
    .jjjjjjCC
    ..CCCCCC.
    ....ig...
    ...iigg..
    .........
  `),
  obsidian: P(`
    ..........
    ....k.....
    ...kP.....
    ...kPk.k..
    ..kkPkkP..
    ..kPPkkPk.
    .kkPkkkPk.
    .kPkkkPPk.
    ..kkkkkk..
    ..........
  `),
  vent: P(`
    ...........
    ...r.a.....
    ....a.r....
    ..ddddddd..
    .ddkayakdd.
    .dkkyhykkd.
    ..ddddddd..
    ...........
  `),
  charred: P(`
    ..........
    ..k....k..
    ...k..k...
    ...kkkk.k.
    .k..kk.k..
    ..kk.kkk..
    ....kk....
    ....ka....
    ....kk....
    ...kkkk...
    ..........
  `),
  lollipop: P(`
    ........
    ..qqqq..
    .qwqqeq.
    .qqeqqe.
    .qeqweq.
    .eqqeqe.
    ..eeee..
    ....w...
    ....w...
    ....w...
    ....w...
    ...www..
    ........
  `),
  candycane: P(`
    ........
    ..rwwr..
    .wr..wr.
    .r....w.
    ......r.
    ......w.
    ......r.
    ......w.
    ......r.
    ......w.
    ........
  `),
  gumdrop: P(`
    .........
    ...vvv...
    ..vwvvV..
    .vvvvVVV.
    .vvvVVVm.
    .VVVVmmm.
    .........
  `),
  floatrock: P(`
    ...........
    ..dGGGGd...
    .dGGgGGGdk.
    .kddGGddkk.
    ..kkddkkk..
    ...kkkk....
    ....kk.....
    ...........
    ....p......
    ...........
  `),
  runepillar: P(`
    ........
    ..dGGd..
    ..GGdd..
    ..GpPd..
    ..GPpd..
    ..GGdd..
    ..GqPd..
    ..GPdd..
    ..GGdd..
    .dGGddk.
    .kkkkkk.
    ........
  `),
  voideye: P(`
    ...........
    ...PPPPP...
    ..PpppppP..
    .PpwwwwwpP.
    .PwwkPkwwP.
    .PpwwwwwpP.
    ..PpppppP..
    ...PPPPP...
    ...........
  `),
};

// ---------------------------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------------------------

/** Tower footprints in tiles: [cx, cy, size, team]. */
const TOWERS = [
  [3.5, 25.5, 3, 0],
  [14.5, 25.5, 3, 0],
  [9, 29, 4, 0],
  [3.5, 6.5, 3, 1],
  [14.5, 6.5, 3, 1],
  [9, 3, 4, 1],
];

const bgCache = new Map();

/**
 * Render the static arena background (cached per biome + seed).
 * @param {string} biomeId meadow | desert | frost | swamp | crystal | lava | candy | void
 * @param {number} [seed]
 * @returns {HTMLCanvasElement}
 */
export function renderArenaBackground(biomeId, seed = 1) {
  const b = BIOMES[biomeId] ?? BIOMES.meadow;
  const key = b.id + ':' + seed;
  const hit = bgCache.get(key);
  if (hit) return hit;
  const rand = mulberry32((seed >>> 0) ^ hashStr(b.id));
  const buf = new Buf(ARENA_W, ARENA_H);
  drawGround(buf, b, rand);
  drawRiverBed(buf, b, rand);
  drawBridges(buf, b, rand);
  for (const t of TOWERS) drawPad(buf, b, t);
  drawProps(buf, b, rand);
  const c = buf.toCanvas();
  if (bgCache.size > 8) bgCache.clear();
  bgCache.set(key, c);
  return c;
}

function teamTint(hex, y) {
  // enemy half (top) leans warm, player half (bottom) leans cool — very subtle
  if (y < RIVER_Y) return mix(hex, TEAM_COLORS[1].main, 0.06);
  if (y >= RIVER_Y + RIVER_H) return mix(hex, TEAM_COLORS[0].main, 0.06);
  return hex;
}

function drawGround(buf, b, rand) {
  const tints = new Map();
  const tint = (hex, y) => {
    const k = hex + (y < RIVER_Y ? 'a' : 'b');
    let v = tints.get(k);
    if (!v) {
      v = teamTint(hex, y);
      tints.set(k, v);
    }
    return v;
  };
  for (let ty = 0; ty < 32; ty++) {
    for (let tx = 0; tx < 18; tx++) {
      const edge = tx === 0 || tx === 17;
      let base = b.ground[(tx + ty) % 2];
      if (edge) base = mix(base, b.rim, 0.55);
      const y0 = ty * TILE;
      const x0 = tx * TILE;
      const c = tint(base, y0);
      const hi = tint(mix(base, '#ffffff', 0.05), y0);
      const lo = tint(mix(base, '#1a1022', 0.06), y0);
      buf.rect(x0, y0, TILE, TILE, c);
      // subtle board bevel
      buf.rect(x0, y0, TILE, 1, hi);
      buf.rect(x0, y0 + 1, 1, TILE - 1, hi);
      buf.rect(x0, y0 + TILE - 1, TILE, 1, lo);
      buf.rect(x0 + TILE - 1, y0, 1, TILE - 1, lo);
      // noise speckles
      const n = 5 + Math.floor(rand() * 5);
      for (let i = 0; i < n; i++) {
        const sx = x0 + 1 + Math.floor(rand() * (TILE - 2));
        const sy = y0 + 1 + Math.floor(rand() * (TILE - 2));
        buf.set(sx, sy, tint(b.speck[Math.floor(rand() * b.speck.length)], y0), 0.8);
      }
      detail(buf, b, rand, x0, y0, tint);
    }
  }
}

function detail(buf, b, rand, x0, y0, tint) {
  const r = rand();
  const sx = x0 + 2 + Math.floor(rand() * 11);
  const sy = y0 + 3 + Math.floor(rand() * 10);
  switch (b.detail) {
    case 'grass':
      if (r < 0.5) {
        const dark = tint(b.speck[1], y0);
        const light = tint(b.speck[2], y0);
        buf.set(sx, sy, dark);
        buf.set(sx + 2, sy, dark);
        buf.set(sx + 1, sy - 1, dark);
        buf.set(sx + 1, sy - 2, light);
        buf.set(sx, sy - 1, light);
      } else if (r < 0.58) {
        buf.set(sx, sy, '#fbf7ef');
        buf.set(sx, sy - 1, '#ffd84d');
      }
      break;
    case 'sand':
      if (r < 0.45) {
        const dark = tint(b.speck[1], y0);
        buf.rect(sx, sy, 4, 1, dark, 0.7);
        buf.rect(sx + 1, sy - 1, 3, 1, tint(b.speck[0], y0), 0.8);
      } else if (r < 0.52) buf.set(sx, sy, '#c9a25a');
      break;
    case 'snow':
      if (r < 0.35) buf.set(sx, sy, '#ffffff');
      else if (r < 0.55) {
        buf.rect(sx, sy, 3, 1, tint(b.speck[1], y0), 0.6);
      }
      break;
    case 'swamp':
      if (r < 0.3) {
        const c = tint('#46603a', y0);
        buf.rect(sx, sy, 4, 2, c, 0.8);
        buf.rect(sx + 1, sy - 1, 2, 1, c, 0.8);
        buf.set(sx + 1, sy, tint('#6d8d55', y0), 0.6);
      } else if (r < 0.5) {
        buf.set(sx, sy, tint(b.speck[2], y0));
        buf.set(sx, sy - 1, tint(b.speck[2], y0));
      }
      break;
    case 'crystal':
      if (r < 0.25) {
        buf.set(sx, sy, '#3be8d0');
        buf.set(sx, sy - 1, '#d2fff8', 0.8);
      } else if (r < 0.35) buf.set(sx, sy, '#a65ef0', 0.8);
      break;
    case 'cracks':
      if (r < 0.35) {
        let x = sx;
        let y = sy;
        for (let i = 0; i < 5; i++) {
          buf.set(x, y, i === 2 ? '#ffae3c' : '#e8582a', 0.85);
          x += rand() < 0.5 ? 1 : 0;
          y += rand() < 0.5 ? 1 : -1;
          x += 1;
        }
      }
      break;
    case 'sprinkles':
      if (r < 0.7) {
        const cols = ['#ff86cf', '#66dcff', '#ffd84d', '#8de05e', '#fbf7ef', '#a65ef0'];
        const c = cols[Math.floor(rand() * cols.length)];
        if (rand() < 0.5) buf.rect(sx, sy, 2, 1, c);
        else buf.rect(sx, sy, 1, 2, c);
      }
      break;
    case 'stars':
      if (r < 0.3) buf.set(sx, sy, rand() < 0.3 ? '#ff86cf' : '#c8c9dc', 0.8);
      else if (r < 0.36) {
        buf.set(sx, sy, '#fbf7ef');
        buf.set(sx - 1, sy, '#a65ef0', 0.6);
        buf.set(sx + 1, sy, '#a65ef0', 0.6);
        buf.set(sx, sy - 1, '#a65ef0', 0.6);
        buf.set(sx, sy + 1, '#a65ef0', 0.6);
      }
      break;
    default:
      break;
  }
}

/** Faint worn lanes from the princess towers to the bridges. */
function drawPaths(buf, b, rand) {
  for (const [x0, x1] of BRIDGES_PX) {
    const cx = (x0 + x1) / 2;
    for (const [ya, yb] of [
      [128, 236],
      [276, 384],
    ]) {
      for (let y = ya; y < yb; y++) {
        const wob = Math.round(Math.sin(y * 0.09 + cx) * 1.5);
        const hw = 13;
        for (let x = cx - hw + wob; x < cx + hw + wob; x++) {
          const edge = x < cx - hw + wob + 2 || x >= cx + hw + wob - 2;
          const a = edge ? 0.18 : 0.32;
          if (rand() < (edge ? 0.6 : 0.95)) buf.set(x, y, b.path, a);
        }
      }
    }
  }
}

function drawRiverBed(buf, b, rand) {
  const [bankC, faceC, lipC] = b.bank;
  // far bank face (top) — visible vertical face
  buf.rect(0, RIVER_Y - 2, ARENA_W, 2, lipC);
  buf.rect(0, RIVER_Y, ARENA_W, 3, faceC);
  // water bed
  buf.rect(0, WATER_TOP, ARENA_W, WATER_BOTTOM - WATER_TOP, b.water.deep);
  buf.rect(0, WATER_TOP, ARENA_W, 2, mix(b.water.deep, '#1a1022', 0.35));
  // near bank lip (bottom)
  buf.rect(0, WATER_BOTTOM, ARENA_W, 2, bankC);
  buf.rect(0, WATER_BOTTOM + 2, ARENA_W, 1, lipC);
  buf.rect(0, RIVER_Y + RIVER_H + 1, ARENA_W, 1, mix(bankC, '#1a1022', 0.25), 0.5);
  // pebbles / texture on the banks
  for (let x = 0; x < ARENA_W; x += 2 + Math.floor(rand() * 5)) {
    buf.set(x, RIVER_Y + Math.floor(rand() * 3), rand() < 0.5 ? bankC : lipC);
    if (rand() < 0.5) buf.rect(x, WATER_BOTTOM + Math.floor(rand() * 2), 2, 1, faceC, 0.7);
    if (rand() < 0.3) buf.set(x, RIVER_Y - 3, faceC, 0.5);
  }
}

function drawBridges(buf, b, rand) {
  const br = b.bridge;
  for (const [x0, x1] of BRIDGES_PX) {
    const y0 = RIVER_Y - 6;
    const y1 = RIVER_Y + RIVER_H + 6;
    const w = x1 - x0;
    // shadow on the water to the right/below
    buf.rect(x1, WATER_TOP, 2, WATER_BOTTOM - WATER_TOP, '#1a1022', 0.35);
    // deck
    buf.rect(x0, y0, w, y1 - y0, br.deck);
    if (br.kind === 'wood' || br.kind === 'wafer') {
      for (let y = y0; y < y1; y += 5) {
        buf.rect(x0, y, w, 1, br.light);
        buf.rect(x0, y + 4, w, 1, br.dark);
        // plank seams
        const seam = x0 + 6 + Math.floor(rand() * (w - 12));
        buf.rect(seam, y + 1, 1, 3, br.dark, 0.6);
        // nails
        buf.set(x0 + 4, y + 2, br.rail, 0.8);
        buf.set(x1 - 5, y + 2, br.rail, 0.8);
        if (br.kind === 'wafer') {
          for (let x = x0 + 3; x < x1 - 2; x += 4) buf.set(x, y + 2, br.dark, 0.7);
        }
      }
      if (b.id === 'frost') {
        for (let i = 0; i < 26; i++) buf.rect(x0 + Math.floor(rand() * (w - 3)), y0 + Math.floor(rand() * (y1 - y0)), 2 + Math.floor(rand() * 3), 1, '#f4fbff', 0.9);
      }
      if (b.id === 'swamp') {
        for (let i = 0; i < 18; i++) buf.rect(x0 + Math.floor(rand() * (w - 3)), y0 + Math.floor(rand() * (y1 - y0)), 2, 1, '#6d8d55', 0.8);
      }
    } else {
      // masonry deck (brick / stone / iron / rune)
      for (let y = y0; y < y1; y += 4) {
        const off = ((y - y0) / 4) % 2 ? 4 : 0;
        buf.rect(x0, y + 3, w, 1, br.dark);
        for (let x = x0 + off; x < x1; x += 8) buf.rect(x, y, 1, 3, br.dark);
        buf.rect(x0, y, w, 1, br.light, 0.35);
      }
      if (br.kind === 'iron') {
        for (let y = y0 + 2; y < y1; y += 8) for (let x = x0 + 3; x < x1; x += 8) buf.set(x, y, br.light);
      }
      if (br.kind === 'rune') {
        for (let y = y0 + 6; y < y1 - 4; y += 10) {
          const cx = Math.floor((x0 + x1) / 2);
          buf.rect(cx - 2, y, 5, 1, br.light, 0.8);
          buf.rect(cx, y - 2, 1, 5, br.light, 0.8);
        }
      }
    }
    // side rails with posts
    for (const rx of [x0, x1 - 3]) {
      buf.rect(rx, y0 - 2, 3, y1 - y0 + 4, br.rail);
      buf.rect(rx + 1, y0 - 2, 1, y1 - y0 + 4, br.light, 0.45);
      for (let y = y0 - 3; y < y1 + 2; y += 12) {
        buf.rect(rx - 1, y, 5, 4, br.rail);
        buf.rect(rx, y, 3, 1, br.light, 0.7);
      }
    }
    // shadow under the deck edge on the bottom bank
    buf.rect(x0, y1 + 2, w, 1, '#1a1022', 0.25);
  }
}

function drawPad(buf, b, [cx, cy, size, team]) {
  const p = b.pad;
  const m = -2;
  const x0 = Math.round((cx - size / 2) * TILE) - m;
  const y0 = Math.round((cy - size / 2) * TILE) - m;
  const w = size * TILE + m * 2;
  const h = size * TILE + m * 2;
  const tc = TEAM_COLORS[team];
  // drop shadow
  buf.rect(x0 + 2, y0 + h, w - 2, 2, '#1a1022', 0.25);
  buf.rect(x0 + w, y0 + 2, 2, h, '#1a1022', 0.2);
  // border
  buf.rect(x0, y0, w, h, p.dark);
  buf.rect(x0 + 1, y0 + 1, w - 2, h - 2, mix(p.side, tc.dark, 0.35));
  // stone slabs
  const s = 8;
  for (let y = y0 + 3; y < y0 + h - 3; y += s) {
    const row = Math.floor((y - y0) / s);
    for (let x = x0 + 3 - (row % 2 ? s / 2 : 0); x < x0 + w - 3; x += s) {
      const xa = Math.max(x, x0 + 3);
      const xb = Math.min(x + s, x0 + w - 3);
      const yb = Math.min(y + s, y0 + h - 3);
      if (xb <= xa) continue;
      buf.rect(xa, y, xb - xa, yb - y, p.top);
      buf.rect(xa, y, xb - xa, 1, mix(p.top, '#ffffff', 0.25));
      buf.rect(xa, yb - 1, xb - xa, 1, p.side);
      buf.rect(xb - 1, y, 1, yb - y, p.side);
    }
  }
  // team trim corners
  for (const [qx, qy] of [
    [x0 + 1, y0 + 1],
    [x0 + w - 4, y0 + 1],
    [x0 + 1, y0 + h - 4],
    [x0 + w - 4, y0 + h - 4],
  ]) {
    buf.rect(qx, qy, 3, 3, tc.main);
    buf.set(qx, qy, tc.light);
  }
}

function drawProps(buf, b, rand) {
  const list = b.props;
  for (const side of [0, 1]) {
    let y = 6 + Math.floor(rand() * 10);
    while (y < ARENA_H - 4) {
      const type = list[Math.floor(rand() * list.length)];
      const rows = PROPS[type];
      const h = rows.length;
      const w = rows[0].length;
      const bottom = y + h;
      // keep clear of the river + bridge approaches
      if (bottom > RIVER_Y - 8 && y < RIVER_Y + RIVER_H + 6) {
        y = RIVER_Y + RIVER_H + 6;
        continue;
      }
      if (bottom > ARENA_H) break;
      const x = side === 0 ? Math.floor((TILE - w) / 2) + (w > 14 ? 1 : 0) : ARENA_W - TILE + Math.floor((TILE - w) / 2) - (w > 14 ? 1 : 0);
      // contact shadow
      buf.rect(x + 2, bottom - 2, w - 4, 2, '#1a1022', 0.25);
      buf.rows(rows, x, y);
      y += h + 4 + Math.floor(rand() * 18);
    }
  }
  // a couple of small corner props in the outer corners (top row / bottom row, beside the kings)
  const small = ['flowers', 'rock', 'bush', 'bones', 'snowrock', 'mushroom', 'glowshroom', 'gumdrop', 'vent', 'reeds'];
  const pick = small.filter((k) => list.includes(k));
  const smallType = pick.length ? pick[0] : null;
  if (smallType) {
    const rows = PROPS[smallType];
    buf.rows(rows, 20, 2);
    buf.rows(rows, ARENA_W - 20 - rows[0].length, ARENA_H - rows.length - 2);
  }
}

// ---------------------------------------------------------------------------------------------
// River animation
// ---------------------------------------------------------------------------------------------

const RIVER_FRAMES = 16;
const RIVER_FPS = 8;
const riverCache = new Map();

function riverFrames(b) {
  let frames = riverCache.get(b.id);
  if (frames) return frames;
  frames = [];
  const rand = mulberry32(hashStr('river:' + b.id));
  const H = WATER_BOTTOM - WATER_TOP;
  // elements with phases so the loop is seamless
  const els = [];
  for (let i = 0; i < 70; i++) {
    els.push({
      x: Math.floor(rand() * ARENA_W),
      y: Math.floor(rand() * H),
      len: 2 + Math.floor(rand() * 5),
      ph: rand(),
      kind: rand(),
    });
  }
  for (let f = 0; f < RIVER_FRAMES; f++) {
    const buf = new Buf(ARENA_W, H);
    paintLiquid(buf, b, f / RIVER_FRAMES, els, H);
    // cut out bridges
    for (const [x0, x1] of BRIDGES_PX) {
      for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) {
        const i = (y * ARENA_W + x) * 4;
        buf.d[i + 3] = 0;
      }
    }
    frames.push(buf.toCanvas());
  }
  riverCache.set(b.id, frames);
  return frames;
}

function paintLiquid(buf, b, u, els, H) {
  const w = b.water;
  const W = ARENA_W;
  buf.rect(0, 0, W, H, w.mid);
  // depth bands: darker under the far bank, slightly lighter centre
  buf.rect(0, 0, W, 3, w.deep);
  buf.rect(0, 3, W, 2, mix(w.deep, w.mid, 0.5));
  buf.rect(0, H - 2, W, 2, mix(w.mid, w.light, 0.35));
  const TAU = Math.PI * 2;
  const liquid = b.liquid;
  for (const e of els) {
    const t = (u + e.ph) % 1;
    if (liquid === 'water' || liquid === 'ice' || liquid === 'soda') {
      // drifting wave glints (flow to the right), fade in/out
      const life = Math.sin(t * Math.PI);
      if (life < 0.25) continue;
      const x = (e.x + Math.round(t * 18)) % W;
      const y = 5 + (e.y % (H - 7));
      const c = e.kind < 0.7 ? w.light : w.foam;
      buf.rect(x, y, e.len, 1, c, Math.min(1, life + 0.1));
      if (e.kind > 0.85) buf.rect(x + 1, y - 1, Math.max(1, e.len - 2), 1, w.foam, life * 0.8);
      if (liquid === 'soda' && e.kind > 0.6) {
        // rising fizz bubbles
        const by = H - 2 - Math.round(t * (H - 4));
        buf.set((e.x + 3) % W, by, w.foam, life);
      }
    } else if (liquid === 'lava') {
      const x = (e.x + Math.round(t * 8)) % W;
      const y = 4 + (e.y % (H - 6));
      if (e.kind < 0.45) {
        // dark crust plates drifting slowly
        buf.rect(x, y, e.len + 2, 2, w.deep, 0.9);
        buf.rect(x + 1, y - 1, e.len, 1, w.deep, 0.7);
      } else {
        // bubbles that swell and pop
        const s = Math.sin(t * TAU);
        if (s > 0.2) {
          buf.rect(x, y, 2, 2, w.light);
          if (s > 0.7) {
            buf.rect(x - 1, y, 4, 2, w.light, 0.7);
            buf.set(x, y, w.foam);
          }
        } else if (s > -0.1) buf.set(x + 1, y - 1, w.foam, 0.8);
      }
    } else if (liquid === 'goo') {
      const x = (e.x + Math.round(t * 6)) % W;
      const y = 4 + (e.y % (H - 6));
      if (e.kind < 0.5) buf.rect(x, y, e.len + 1, 1, w.light, 0.35 + 0.3 * Math.sin(t * Math.PI));
      else {
        const s = Math.sin(t * TAU);
        if (s > 0.3) {
          buf.set(x, y, w.foam);
          buf.set(x + 1, y, w.light);
          if (s > 0.8) buf.rect(x - 1, y - 1, 3, 1, w.light, 0.8);
        }
      }
    } else if (liquid === 'void') {
      // swirling streaks + twinkling stars
      const x = (e.x + Math.round(Math.sin((t + e.ph) * TAU) * 6) + W) % W;
      const y = 3 + (e.y % (H - 4));
      if (e.kind < 0.5) buf.rect(x, y, e.len + 2, 1, w.light, 0.25 + 0.25 * Math.sin(t * TAU) ** 2);
      else if (e.kind < 0.8) {
        const s = Math.sin(t * TAU);
        if (s > 0.4) buf.set(x, y, '#fbf7ef', s);
        if (s > 0.85) {
          buf.set(x - 1, y, w.foam, 0.6);
          buf.set(x + 1, y, w.foam, 0.6);
        }
      } else buf.set(x, y, w.foam, 0.5 + 0.5 * Math.sin(t * TAU));
    }
  }
  if (liquid === 'ice') {
    // drifting ice floes
    for (let i = 0; i < 9; i++) {
      const x = Math.round((i * 37 + u * 32) % W);
      const y = 6 + ((i * 7) % (H - 12));
      buf.rect(x, y, 6 + (i % 3) * 2, 3, '#f2fbff');
      buf.rect(x + 1, y + 3, 5 + (i % 3) * 2, 1, '#a6dcf6');
      buf.rect(x, y, 2, 1, '#ffffff');
    }
  }
  // foam lines along both banks
  for (let x = 0; x < W; x++) {
    const v = Math.sin(x * 0.7 + u * TAU) + Math.sin(x * 0.31 - u * TAU * 2);
    if (v > 0.9) buf.set(x, 0 + 3, w.foam, 0.5);
    if (v < -1.1) buf.set(x, H - 1, w.foam, 0.7);
  }
}

/**
 * Draw the animated river over rows 15-16 (not on the bridges), in 288x512 arena space.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} biomeId
 * @param {number} t seconds
 */
export function drawRiver(ctx, biomeId, t = 0) {
  if (!ctx) return;
  const b = BIOMES[biomeId] ?? BIOMES.meadow;
  const frames = riverFrames(b);
  const f = ((Math.floor(t * RIVER_FPS) % RIVER_FRAMES) + RIVER_FRAMES) % RIVER_FRAMES;
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(frames[f], 0, WATER_TOP);
  ctx.imageSmoothingEnabled = smooth;
}

/** Decoration prop names per biome (for tests / tools). */
export const PROP_NAMES = Object.freeze(Object.keys(PROPS));
export { PROPS as PROP_ROWS };
