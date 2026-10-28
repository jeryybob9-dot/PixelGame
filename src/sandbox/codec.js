// God Box — compact save format: RLE + base64 typed arrays, JSON for the rest (pure, no DOM).
import { T, SPECIES, TICKS_PER_YEAR } from './constants.js';
import { generateHeight } from './worldgen.js';
import { createState } from './state.js';
import { recount } from './sim.js';

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const REV = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHA.length; i++) REV[ALPHA.charCodeAt(i)] = i;

/** @param {Uint8Array} u8 */
export function bytesToB64(u8) {
  let out = '';
  const n = u8.length;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
    out += ALPHA[v >> 18] + ALPHA[(v >> 12) & 63] + ALPHA[(v >> 6) & 63] + ALPHA[v & 63];
  }
  if (i < n) {
    const v = (u8[i] << 16) | ((i + 1 < n ? u8[i + 1] : 0) << 8);
    out += ALPHA[v >> 18] + ALPHA[(v >> 12) & 63] + (i + 1 < n ? ALPHA[(v >> 6) & 63] : '=') + '=';
  }
  return out;
}

/** @param {string} str */
export function b64ToBytes(str) {
  const clean = str.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = REV[clean.charCodeAt(i)];
    if (v < 0) throw new Error('bad base64');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 255;
    }
  }
  return out.subarray(0, o);
}

/** Run-length encode as (count 1..255, value) byte pairs. */
export function rleEncode(u8) {
  const out = new Uint8Array(u8.length * 2 + 2);
  let o = 0;
  let i = 0;
  while (i < u8.length) {
    const v = u8[i];
    let run = 1;
    while (i + run < u8.length && u8[i + run] === v && run < 255) run++;
    out[o++] = run;
    out[o++] = v;
    i += run;
  }
  return out.slice(0, o);
}

export function rleDecode(bytes, n) {
  const out = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const run = bytes[i];
    if (o + run > n) throw new Error('rle overflow');
    out.fill(bytes[i + 1], o, o + run);
    o += run;
  }
  if (o !== n) throw new Error('rle length mismatch');
  return out;
}

/** Pack bytes as 'r'+base64(RLE) or 'b'+base64(raw), whichever is smaller. */
export function packBytes(u8) {
  const r = rleEncode(u8);
  return r.length < u8.length ? 'r' + bytesToB64(r) : 'b' + bytesToB64(u8);
}

export function unpackBytes(str, n) {
  const body = b64ToBytes(str.slice(1));
  if (str[0] === 'r') return rleDecode(body, n);
  if (body.length !== n) throw new Error('raw length mismatch');
  return new Uint8Array(body);
}

function packU16(u16) {
  const lo = new Uint8Array(u16.length);
  const hi = new Uint8Array(u16.length);
  for (let i = 0; i < u16.length; i++) {
    lo[i] = u16[i] & 255;
    hi[i] = u16[i] >> 8;
  }
  return [packBytes(lo), packBytes(hi)];
}
function unpackU16(pair, n) {
  const lo = unpackBytes(pair[0], n);
  const hi = unpackBytes(pair[1], n);
  const out = new Uint16Array(n);
  for (let i = 0; i < n; i++) out[i] = lo[i] | (hi[i] << 8);
  return out;
}

const CKEYS = [
  'id', 'sp', 'x', 'y', 'tx', 'ty', 'hp', 'mhp', 'atk', 'spd', 'born', 'life', 'tribe', 'vil', 'kd', 'band', 'job', 'task',
  'tt', 'tgt', 'tv', 'carry', 'cn', 'wx', 'wy', 'wk', 'fish', 'hunt', 'name', 'tr', 'kills', 'sick', 'imm', 'bless', 'burn',
  'hunger', 'inf', 'dir', 'child', 'cd', 'stuck', 'side', 'low', 'held',
];
const BKEYS = ['id', 'type', 'vil', 'x', 'y', 'w', 'h', 'hp', 'mhp', 'prog', 'cd'];

export const SAVE_FORMAT = 'godbox';
export const SAVE_VERSION = 1;

/**
 * Serialize a world to a JSON-safe object (typed arrays compressed).
 * @param {object} s state
 */
export function serializeState(s) {
  const gen = generateHeight(s.w, s.h, s.seed);
  const diff = new Uint8Array(s.n);
  for (let i = 0; i < s.n; i++) diff[i] = s.height[i] ^ gen[i];
  return {
    format: SAVE_FORMAT, v: SAVE_VERSION,
    w: s.w, h: s.h, seed: s.seed, sizeKey: s.sizeKey, tick: s.tick, rs: s.rs,
    ids: [s.nextId, s.nextVid, s.nextBid, s.nextKid, s.nextBand],
    savedAt: Date.now(),
    summary: summarize(s),
    height: packBytes(diff),
    tile: packBytes(s.tile),
    biome: packBytes(s.biome),
    flags: packBytes(s.flags),
    fire: packBytes(s.fire),
    aux: packBytes(s.aux),
    zone: packU16(s.zone),
    lists: [s.fires, s.lavas, s.acids],
    cursors: [s.fireCursor, s.lavaCursor, s.acidCursor],
    creatures: s.creatures.filter((c) => !c.dead).map((c) => CKEYS.map((k) => c[k])),
    buildings: [...s.buildings.values()].map((b) => BKEYS.map((k) => b[k])),
    villages: [...s.villages.values()],
    kingdoms: [...s.kingdoms.values()],
    bands: [...s.bands.values()],
    clouds: s.clouds,
    holes: s.holes,
    events: s.events.slice(-40),
    evSeq: s.evSeq,
  };
}

/** Small summary shown on save slots. */
export function summarize(s) {
  let pop = 0;
  for (const n of s.counts.tribe) pop += n;
  return {
    year: Math.floor(s.tick / TICKS_PER_YEAR) + 1,
    pop,
    villages: s.villages.size,
    kingdoms: s.kingdoms.size,
    creatures: s.creatures.length,
    sizeKey: s.sizeKey,
  };
}

/**
 * Rebuild a live state from serializeState output. Throws on malformed data.
 * @param {object} d
 */
export function deserializeState(d) {
  if (!d || d.format !== SAVE_FORMAT) throw new Error('not a God Box save');
  const { w, h } = d;
  const n = w * h;
  if (!(w > 0 && h > 0 && n <= 400 * 400)) throw new Error('bad size');
  const gen = generateHeight(w, h, d.seed >>> 0);
  const diff = unpackBytes(d.height, n);
  const height = new Uint8Array(n);
  for (let i = 0; i < n; i++) height[i] = gen[i] ^ diff[i];
  const terrain = {
    w, h, seed: d.seed >>> 0, height,
    tile: unpackBytes(d.tile, n), biome: unpackBytes(d.biome, n), flags: unpackBytes(d.flags, n),
  };
  const s = createState(terrain, d.sizeKey || 'medium');
  s.fire = unpackBytes(d.fire, n);
  s.aux = unpackBytes(d.aux, n);
  s.zone = unpackU16(d.zone, n);
  s.tick = d.tick | 0;
  s.rs = d.rs >>> 0;
  [s.nextId, s.nextVid, s.nextBid, s.nextKid, s.nextBand] = d.ids;
  [s.fires, s.lavas, s.acids] = (d.lists || [[], [], []]).map((a) => a.slice());
  [s.fireCursor, s.lavaCursor, s.acidCursor] = d.cursors || [0, 0, 0];
  if (!d.lists) {
    for (let i = 0; i < n; i++) {
      if (s.fire[i]) s.fires.push(i);
      if (s.tile[i] === T.LAVA) s.lavas.push(i);
      if (s.tile[i] === T.ACID) s.acids.push(i);
    }
  }
  for (const row of d.creatures || []) {
    const c = {};
    CKEYS.forEach((k, j) => (c[k] = row[j]));
    const def = SPECIES[c.sp];
    if (!def) continue;
    c.fly = def.flying ? 1 : 0;
    c.aq = def.aquatic ? 1 : 0;
    c.mv = 0;
    c.dead = 0;
    s.creatures.push(c);
    s.byId.set(c.id, c);
  }
  for (const row of d.buildings || []) {
    const b = {};
    BKEYS.forEach((k, j) => (b[k] = row[j]));
    s.buildings.set(b.id, b);
    for (let yy = b.y; yy < b.y + b.h; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) s.bmap[yy * w + xx] = b.id;
  }
  for (const v of d.villages || []) s.villages.set(v.id, v);
  for (const k of d.kingdoms || []) s.kingdoms.set(k.id, k);
  for (const b of d.bands || []) s.bands.set(b.id, b);
  s.clouds = d.clouds || [];
  s.holes = d.holes || [];
  s.events = d.events || [];
  s.evSeq = d.evSeq || s.events.length;
  recount(s);
  return s;
}

/** Serialize to a compact JSON string (what goes into storage). */
export function encodeSave(s) {
  return JSON.stringify(serializeState(s));
}
export function decodeSave(str) {
  return deserializeState(typeof str === 'string' ? JSON.parse(str) : str);
}
