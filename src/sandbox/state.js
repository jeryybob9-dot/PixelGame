// God Box — world state container and shared helpers (pure, no DOM).
import { rnd } from './rng.js';
import { SP } from './constants.js';

/**
 * Wrap generated terrain into a full simulation state.
 * @param {{w:number,h:number,seed:number,height:Uint8Array,tile:Uint8Array,biome:Uint8Array,flags:Uint8Array}} terrain
 * @param {string} [sizeKey]
 */
export function createState(terrain, sizeKey = 'medium') {
  const { w, h } = terrain;
  const n = w * h;
  const gw = Math.ceil(w / GRID);
  const gh = Math.ceil(h / GRID);
  return {
    v: 1,
    w, h, n, seed: terrain.seed >>> 0, sizeKey,
    height: terrain.height,
    tile: terrain.tile,
    biome: terrain.biome,
    flags: terrain.flags,
    fire: new Uint8Array(n),
    aux: new Uint8Array(n),
    bmap: new Int32Array(n),
    zone: new Uint16Array(n),
    rs: (terrain.seed ^ 0x9e3779b9) >>> 0,
    tick: 0,
    nextId: 1, nextVid: 1, nextBid: 1, nextKid: 1, nextBand: 1,
    creatures: [],
    byId: new Map(),
    villages: new Map(),
    kingdoms: new Map(),
    buildings: new Map(),
    bands: new Map(),
    fires: [], lavas: [], acids: [],
    clouds: [], holes: [],
    fireCursor: 0, lavaCursor: 0, acidCursor: 0,
    events: [], evSeq: 0, evKeys: new Map(),
    fx: [],
    dirty: { x0: 0, y0: 0, x1: w - 1, y1: h - 1, any: true },
    bordersDirty: true,
    counts: { tribe: [0, 0, 0, 0], sp: new Int32Array(9), total: 0 },
    gw, gh,
    gHead: new Int32Array(gw * gh).fill(-1),
    gNext: new Int32Array(64),
  };
}

export const GRID = 8;

/** Random float [0,1) from the state's own RNG. */
export const rand = (s) => rnd(s);
/** Random int [0,n). */
export const randInt = (s, n) => (rnd(s) * n) | 0;
export const randRange = (s, a, b) => a + rnd(s) * (b - a);
export const pick = (s, arr) => arr[(rnd(s) * arr.length) | 0];

export function inBounds(s, x, y) {
  return x >= 0 && y >= 0 && x < s.w && y < s.h;
}
export function idxAt(s, x, y) {
  return (y | 0) * s.w + (x | 0);
}

/** Mark a terrain pixel as needing a repaint. */
export function markDirty(s, x, y) {
  const d = s.dirty;
  if (!d.any) {
    d.x0 = d.x1 = x;
    d.y0 = d.y1 = y;
    d.any = true;
    return;
  }
  if (x < d.x0) d.x0 = x;
  if (x > d.x1) d.x1 = x;
  if (y < d.y0) d.y0 = y;
  if (y > d.y1) d.y1 = y;
}
export function markDirtyIdx(s, i) {
  markDirty(s, i % s.w, (i / s.w) | 0);
}
export function markAllDirty(s) {
  s.dirty = { x0: 0, y0: 0, x1: s.w - 1, y1: s.h - 1, any: true };
  s.bordersDirty = true;
}

/**
 * Push a world event for the log ticker. `key` + `cooldown` (ticks) suppress repeats.
 * @param {object} s state
 * @param {string} text
 * @param {{x?:number,y?:number,color?:string,key?:string,cooldown?:number,kind?:string}} [o]
 */
export function addEvent(s, text, o = {}) {
  if (o.key) {
    const last = s.evKeys.get(o.key);
    if (last !== undefined && s.tick - last < (o.cooldown ?? 240)) return false;
    s.evKeys.set(o.key, s.tick);
    if (s.evKeys.size > 400) s.evKeys.clear();
  }
  s.events.push({ id: ++s.evSeq, t: s.tick, text, x: o.x, y: o.y, color: o.color || null, kind: o.kind || '' });
  if (s.events.length > 80) s.events.splice(0, s.events.length - 80);
  return true;
}

/** Queue a visual/audio effect for the renderer (dropped when nobody drains the queue). */
export function fx(s, e) {
  if (s.fx.length < 600) s.fx.push(e);
}
export const sfx = (s, name) => fx(s, { k: 's', name });

// ---- spatial grid over creatures -------------------------------------------------------------

/** Rebuild the bucket grid (linked lists in typed arrays). */
export function buildGrid(s) {
  const list = s.creatures;
  if (s.gNext.length < list.length) s.gNext = new Int32Array(Math.max(list.length * 2, 64));
  const head = s.gHead;
  head.fill(-1);
  const next = s.gNext;
  const gw = s.gw;
  for (let k = 0; k < list.length; k++) {
    const c = list[k];
    if (c.dead) continue;
    let cx = (c.x / GRID) | 0;
    let cy = (c.y / GRID) | 0;
    if (cx < 0) cx = 0;
    else if (cx >= gw) cx = gw - 1;
    if (cy < 0) cy = 0;
    else if (cy >= s.gh) cy = s.gh - 1;
    const cell = cy * gw + cx;
    next[k] = head[cell];
    head[cell] = k;
  }
  s.gridLen = list.length;
}

/**
 * Visit creatures within radius r of (x,y). Return true from cb to stop early.
 * Only creatures present at the last grid rebuild are visited.
 */
export function forEachNear(s, x, y, r, cb) {
  const list = s.creatures;
  const gw = s.gw;
  const x0 = Math.max(0, ((x - r) / GRID) | 0);
  const y0 = Math.max(0, ((y - r) / GRID) | 0);
  const x1 = Math.min(gw - 1, ((x + r) / GRID) | 0);
  const y1 = Math.min(s.gh - 1, ((y + r) / GRID) | 0);
  const r2 = r * r;
  const head = s.gHead;
  const next = s.gNext;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      for (let k = head[cy * gw + cx]; k !== -1; k = next[k]) {
        const c = list[k];
        if (!c || c.dead) continue;
        const dx = c.x - x;
        const dy = c.y - y;
        if (dx * dx + dy * dy <= r2 && cb(c)) return;
      }
    }
  }
}

/** Nearest creature within r matching pred, or null. */
export function findNearest(s, x, y, r, pred) {
  let best = null;
  let bd = Infinity;
  forEachNear(s, x, y, r, (c) => {
    if (!pred(c)) return false;
    const d = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = c;
    }
    return false;
  });
  return best;
}

export function countNear(s, x, y, r, pred) {
  let n = 0;
  forEachNear(s, x, y, r, (c) => {
    if (pred(c)) n++;
    return false;
  });
  return n;
}

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export const isAnimal = (c) => c.sp >= SP.SHEEP && c.sp <= SP.FISH;
export const isMonster = (c) => c.sp >= SP.ZOMBIE;
