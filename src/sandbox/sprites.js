// God Box — tiny procedural pixel sprites for creatures and buildings (needs a DOM canvas).
import { SP, TRIBES, BT } from './constants.js';

const cache = new Map();

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Render string rows with a palette into a canvas. `.` is transparent. */
export function paint(rows, pal, flip = false, silhouette = null) {
  const h = rows.length;
  const w = rows[0].length;
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d');
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const col = silhouette || pal[ch];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(flip ? w - 1 - x : x, y, 1, 1);
    }
  }
  return cv;
}

// ---- creature art (facing right) --------------------------------------------------------------

const ART = {
  adult: [
    ['.h.', '.s.', 'sTs', '.T.', 't.t'],
    ['.h.', '.s.', 'sTs', '.T.', '.t.'],
  ],
  child: [
    ['.h.', 'sTs', '.T.', 't.t'],
    ['.h.', 'sTs', '.T.', '.t.'],
  ],
  king: [
    ['GGG', '.s.', 'sTs', '.T.', 't.t'],
    ['GGG', '.s.', 'sTs', '.T.', '.t.'],
  ],
  warrior: [
    ['.m.', '.s.', 'mTm', '.T.', 't.t'],
    ['.m.', '.s.', 'mTm', '.T.', '.t.'],
  ],
  sheep: [
    ['.WW..', 'wwwwk', 'wwwW.', '.k.k.'],
    ['.WW..', 'wwwwk', 'wwwW.', 'k...k'],
  ],
  lamb: [
    ['.ww.', 'wwwk', '.k.k'],
    ['.ww.', 'wwwk', 'k..k'],
  ],
  wolf: [
    ['g...G', '.gggG', '.ggg.', '.d.d.'],
    ['.g..G', 'ggggG', '.ggg.', 'd...d'],
  ],
  crab: [
    ['r...r', 'RReRR', '.R.R.'],
    ['.r.r.', 'RReRR', 'R...R'],
  ],
  fish: [
    ['.oo', 'oo.'],
    ['oo.', '.oo'],
  ],
  zombie: [
    ['.u.', '.z.', 'uzz', '.u.', 'u.u'],
    ['.u.', '.z.', 'uzz', '.u.', '.u.'],
  ],
  skeleton: [
    ['.b.', '.k.', 'bbb', '.b.', 'b.b'],
    ['.b.', '.k.', 'bbb', '.b.', '.b.'],
  ],
  dragon: [
    [
      '...w...w..',
      '...ww.ww..',
      '....www..D',
      'd..DDDDDDe',
      '.dDDyyyDD.',
      '....D..D..',
      '..........',
    ],
    [
      '..........',
      '..........',
      '.........D',
      'd..DDDDDDe',
      '.dDDyyyDD.',
      '...wwD.D..',
      '....ww....',
    ],
  ],
  ufo: [
    ['..ccc..', '.mmmmm.', 'MmmmmmM', '.l.l.l.'],
    ['..ccc..', '.mmmmm.', 'MmmmmmM', 'l.l.l.l'],
  ],
};

const BASE_PAL = {
  G: '#ffcf4a', m: '#b9c3cf', g: '#d8d8d8',
  w: '#f4f1ea', W: '#d8d2c8', k: '#3a3238',
  e: '#2a1a14', r: '#ff7a5a', R: '#c8402c', o: '#f2a33a',
  u: '#4a5a7a', z: '#7fbf5f', b: '#ece8dc',
  D: '#c43a2a', d: '#7a1f18', y: '#ffcf4a',
  c: '#7fe8ff', M: '#6a7488', l: '#ffef6a',
};
const WOLF_PAL = { ...BASE_PAL, g: '#8a8a96', G: '#6a6a76', d: '#4a4a54' };
const SKEL_PAL = { ...BASE_PAL, k: '#6a6458' };
const FISH_PAL = { ...BASE_PAL, o: '#cfe6f5' };
const DRAGON_PAL = { ...BASE_PAL, w: '#f08a3a' };
const UFO_PAL = { ...BASE_PAL, m: '#a8b4c8' };

function tribePal(tribe, elder) {
  const t = TRIBES[tribe] || TRIBES[0];
  return { ...BASE_PAL, h: elder ? '#d8d8d8' : t.hair, s: t.skin, T: t.color, t: t.dark };
}

/**
 * Cached creature sprite.
 * @param {object} c creature
 * @param {number} frame 0|1
 * @param {{king?:boolean, flash?:boolean, elder?:boolean}} [o]
 */
export function creatureSprite(c, frame, o = {}) {
  const flip = c.dir < 0;
  let art;
  let pal;
  let key;
  switch (c.sp) {
    case SP.VILLAGER: {
      const role = c.child ? 'child' : o.king ? 'king' : c.job === 5 ? 'warrior' : 'adult';
      art = ART[role];
      pal = tribePal(c.tribe, o.elder && role === 'adult');
      key = `v${c.tribe}${role}${o.elder ? 'e' : ''}`;
      break;
    }
    case SP.SHEEP:
      art = c.child ? ART.lamb : ART.sheep;
      pal = BASE_PAL;
      key = c.child ? 'lamb' : 'sheep';
      break;
    case SP.WOLF:
      art = ART.wolf;
      pal = WOLF_PAL;
      key = 'wolf';
      break;
    case SP.CRAB:
      art = ART.crab;
      pal = BASE_PAL;
      key = 'crab';
      break;
    case SP.FISH:
      art = ART.fish;
      pal = FISH_PAL;
      key = 'fish';
      break;
    case SP.ZOMBIE:
      art = ART.zombie;
      pal = BASE_PAL;
      key = 'zombie';
      break;
    case SP.SKELETON:
      art = ART.skeleton;
      pal = SKEL_PAL;
      key = 'skel';
      break;
    case SP.DRAGON:
      art = ART.dragon;
      pal = DRAGON_PAL;
      key = 'dragon';
      break;
    default:
      art = ART.ufo;
      pal = UFO_PAL;
      key = 'ufo';
  }
  const f = frame % art.length;
  const full = `${key}|${f}|${flip ? 1 : 0}|${o.flash ? 1 : 0}`;
  let cv = cache.get(full);
  if (!cv) {
    cv = paint(art[f], pal, flip, o.flash ? '#ffffff' : null);
    cache.set(full, cv);
  }
  return cv;
}

/** Sprite for a species in a given tribe (for UI icons). */
export function iconSprite(sp, tribe = 0) {
  return creatureSprite({ sp, tribe, dir: 1, child: 0, job: 0 }, 0);
}

// ---- buildings --------------------------------------------------------------------------------

const BART = {
  camp: [
    ['...kK', '.R.k.', 'RrRk.', 'RDR..', '.LfL.'],
    ['...kK', '.R.kK', 'RrRk.', 'RDR..', '.LFL.'],
  ],
  hall: ['..K..', '.RRR.', 'RRRRR', 'rrrrr', 'WbWbW', 'WWDWW'],
  town: ['..K..', '..R..', '.RRR.', 'RRRRR', 'SbSbS', 'SSSSS', 'SSDSS'],
  city: ['K...K', 'S.K.S', 'SsSsS', 'SSSSS', 'SbSbS', 'SSSSS', 'SGDGS', 'SSDSS'],
  hut: ['.R.', 'RRR', 'WDW'],
  house: ['.RR.', 'RRRR', 'rrrr', 'WbWW', 'WWDW'],
  farm: ['...', '.f.', '.k.'],
  tower: ['S.S', 'SSS', 'sbs', 'SSS', 'SKS', 'SDS'],
  granary: ['.r.', 'rRr', 'LLL', 'LDL'],
  mine: ['.s.', 'sSs', 'SDS'],
  temple: ['.G.', '.W.', 'WWW', 'GWG', 'WDW'],
};

function buildingPal(tribe, kcolor) {
  const t = TRIBES[tribe] || TRIBES[0];
  return {
    R: t.roof, r: t.roofDark, W: t.wall, w: t.wallDark, D: '#2e2018', K: kcolor || '#ffffff', k: '#5a4a3a',
    f: '#ffd24a', F: '#ff8a2e', L: '#7a5030', S: tribe === 3 ? '#8f877e' : '#a8a49c', s: '#6a6660', G: '#ffcf4a', b: '#ffe9a0',
  };
}

/**
 * Cached building sprite. Returns {cv, w, h} with h possibly taller than the footprint.
 * @param {object} b building
 * @param {number} level owning village level (for halls)
 * @param {number} tribe
 * @param {string} kcolor kingdom colour
 * @param {number} frame animation frame
 */
export function buildingSprite(b, level, tribe, kcolor, frame) {
  let art;
  switch (b.type) {
    case BT.HALL:
      art = level <= 1 ? BART.camp[frame % 2] : level === 2 ? BART.hall : level === 3 ? BART.town : BART.city;
      break;
    case BT.HUT:
      art = BART.hut;
      break;
    case BT.HOUSE:
      art = BART.house;
      break;
    case BT.FARM:
      art = BART.farm;
      break;
    case BT.TOWER:
      art = BART.tower;
      break;
    case BT.GRANARY:
      art = BART.granary;
      break;
    case BT.MINE:
      art = BART.mine;
      break;
    default:
      art = BART.temple;
  }
  const key = `b${b.type}|${b.type === BT.HALL ? level : 0}|${tribe}|${kcolor}|${b.type === BT.HALL && level <= 1 ? frame % 2 : 0}`;
  let cv = cache.get(key);
  if (!cv) {
    cv = paint(art, buildingPal(tribe, kcolor));
    cache.set(key, cv);
  }
  return cv;
}

// ---- clouds ---------------------------------------------------------------------------------------

const CLOUD_ART = [
  '....XXXX........',
  '..XXxxxxXX.XXX..',
  '.XxxxxxxxxXxxxX.',
  'XxxxxxxxxxxxxxxX',
  'XxxxxxxxxxxxxxxX',
  '.XssssssssssssX.',
  '..XXXXXXXXXXXX..',
];

export function cloudSprite(kind) {
  const key = 'cloud|' + kind;
  let cv = cache.get(key);
  if (!cv) {
    const pal =
      kind === 'plague' ? { X: '#5f8a3a', x: '#9fd35f', s: '#6fa040' }
        : kind === 'fallout' ? { X: '#4a4438', x: '#7a7260', s: '#5a5446' }
          : { X: '#9aa6b8', x: '#e8eef6', s: '#b8c4d4' };
    cv = paint(CLOUD_ART, pal);
    cache.set(key, cv);
  }
  return cv;
}

export function clearSpriteCache() {
  cache.clear();
}
