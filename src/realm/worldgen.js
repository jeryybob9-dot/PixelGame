// Procedural island for a Realm Clash match. Point-symmetric (rotated 180°) so both gods get a fair start.

import { createRng } from '../core/rng.js';
import { REALM_W, REALM_H, T, BLOCKING } from './constants.js';
import { Grid } from './grid.js';

function makeNoise(rng) {
  const N = 256;
  const perm = new Uint8Array(N * 2);
  const vals = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    perm[i] = i;
    vals[i] = rng.next();
  }
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < N; i++) perm[N + i] = perm[i];
  const v = (x, y) => vals[perm[(perm[x & 255] + y) & 511] & 255];
  const s = (t) => t * t * (3 - 2 * t);
  const value = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = s(x - xi);
    const fy = s(y - yi);
    const a = v(xi, yi);
    const b = v(xi + 1, yi);
    const c = v(xi, yi + 1);
    const d = v(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x, y, oct = 3) => {
    let amp = 1;
    let f = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += value(x * f, y * f) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  };
}

/**
 * @param {{ seed: number, biome: string }} opts
 * @returns {{ w, h, tiles: Uint8Array, keeps: {x,y}[], deposits: {x,y,amount,rich}[], nests: {x,y,kind}[], shrine: {x,y}, critters: {x,y}[], river: boolean }}
 */
export function generateRealm({ seed, biome = 'meadow' }) {
  const rng = createRng(seed >>> 0 || 1);
  const W = REALM_W;
  const H = REALM_H;
  const noise = makeNoise(rng);
  const noise2 = makeNoise(rng);
  const ox = rng.next() * 100;
  const oy = rng.next() * 100;
  const river = rng.next() < 0.55 && biome !== 'desert';
  const riverPhase = rng.next() * 6.28;
  rng.flip = rng.next() < 0.5;
  const keeps = [
    { x: 20, y: 55 },
    { x: W - 20, y: H - 55 },
  ];
  const mirror = (x, y) => ({ x: W - 1 - x, y: H - 1 - y });

  // elevation, symmetrised
  const raw = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = (x + 0.5 - W / 2) / (W / 2);
      const ny = (y + 0.5 - H / 2) / (H / 2);
      const box = Math.pow(Math.pow(Math.abs(nx), 3.2) + Math.pow(Math.abs(ny), 3.2), 1 / 3.2);
      const n = noise(x / 9 + ox, y / 9 + oy, 4);
      raw[y * W + x] = n * 0.7 + (1 - box) * 1.05 - 0.32;
    }
  }
  const elev = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const m = mirror(x, y);
    elev[y * W + x] = (raw[y * W + x] + raw[m.y * W + m.x]) / 2;
  }
  const detail = (x, y, f, o = 0) => {
    const m = mirror(x, y);
    return (noise2(x / f + o, y / f + o, 3) + noise2(m.x / f + o, m.y / f + o, 3)) / 2;
  };

  // guaranteed spine between the keeps
  const spineX = (y) => W / 2 + Math.sin((y + 0.5 - H / 2) * 0.12) * (rng.flip ? -5 : 5) * Math.sin(((y + 0.5) / H) * Math.PI);
  for (let y = 0; y < H; y++) {
    const cx = spineX(y);
    for (let x = 0; x < W; x++) {
      const d = Math.abs(x + 0.5 - cx);
      if (d < 4.5) elev[y * W + x] = Math.max(elev[y * W + x], 0.42 - d * 0.03);
    }
  }
  const nearKeep = (x, y, r) => keeps.some((k) => Math.hypot(x + 0.5 - k.x, y + 0.5 - k.y) < r);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (nearKeep(x, y, 9)) elev[y * W + x] = Math.max(elev[y * W + x], 0.45);

  const tiles = new Uint8Array(W * H);
  const LAND = 0.2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const e = elev[i];
      let t;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) t = T.DEEP;
      else if (e < 0.06) t = T.DEEP;
      else if (e < LAND) t = T.WATER;
      else t = T.GRASS;
      tiles[i] = t;
    }
  }

  // a river across the middle with fords (the curve is odd around the centre, so it is symmetric by itself)
  if (river) {
    const f1 = 6 + Math.floor(rng.next() * 7);
    const fords = [f1, W - 1 - f1, Math.floor(W / 2) - 1, Math.floor(W / 2)];
    for (let x = 1; x < W - 1; x++) {
      const cy = (H - 1) / 2 + Math.sin((x - (W - 1) / 2) * 0.3) * 1.5;
      const ford = fords.some((f) => Math.abs(x - f) <= 0.5 || Math.abs(x - f) === 1 && (f === f1 || f === W - 1 - f1));
      for (let y = Math.round(cy - 1); y <= Math.round(cy + 1); y++) {
        const i = y * W + x;
        if (tiles[i] === T.DEEP) continue;
        tiles[i] = ford ? T.SAND : T.WATER;
      }
    }
  }

  // features on land (symmetric by sampling `detail`)
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (tiles[i] !== T.GRASS) continue;
      const e = elev[i];
      const f = detail(x, y, 5, 3);
      const g = detail(x, y, 4, 17);
      const safe = nearKeep(x, y, 7);
      const spine = Math.abs(x + 0.5 - spineX(y)) < 1.6;
      if (!safe && !spine && e > 0.74 && g > 0.56) tiles[i] = biome === 'crystal' && g > 0.62 ? T.CRYSTAL : T.MOUNTAIN;
      else if (!safe && e > 0.68 && g > 0.5) tiles[i] = T.HILL;
      else if (!safe && !spine && f > 0.58) tiles[i] = T.FOREST;
      else if (!safe && f < 0.27 && (biome === 'swamp' || g < 0.35)) tiles[i] = T.MUD;
      if (biome === 'frost' && tiles[i] === T.HILL) tiles[i] = T.SNOW;
      if (biome === 'lava' && tiles[i] === T.MUD) tiles[i] = T.ASH;
      if (biome === 'lava' && !safe && !spine && g > 0.7 && e > 0.45) tiles[i] = T.LAVA;
      if (biome === 'crystal' && !safe && !spine && g > 0.72) tiles[i] = T.CRYSTAL;
    }
  }
  // sandy shores
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (tiles[i] !== T.GRASS && tiles[i] !== T.MUD && tiles[i] !== T.FOREST) continue;
      let water = false;
      for (let dy = -1; dy <= 1 && !water; dy++) for (let dx = -1; dx <= 1; dx++) {
        const t = tiles[(y + dy) * W + x + dx];
        if (t === T.WATER || t === T.DEEP) water = true;
      }
      if (water && (biome === 'desert' || detail(x, y, 3, 31) > 0.35)) tiles[i] = T.SAND;
    }
  }
  if (biome === 'desert') for (let i = 0; i < tiles.length; i++) if (tiles[i] === T.MUD) tiles[i] = T.SAND;

  // dirt road along the spine
  for (let y = 0; y < H; y++) {
    const x = Math.floor(spineX(y));
    const i = y * W + x;
    if (!BLOCKING.has(tiles[i]) && !nearKeep(x, y, 2)) tiles[i] = T.PATH;
  }

  // keep pads are clean grass
  for (const k of keeps) {
    for (let y = Math.floor(k.y - 3); y <= Math.ceil(k.y + 3); y++) for (let x = Math.floor(k.x - 3); x <= Math.ceil(k.x + 3); x++) {
      const i = y * W + x;
      if (Math.hypot(x + 0.5 - k.x, y + 0.5 - k.y) < 3.6) tiles[i] = T.GRASS;
    }
  }

  // reachability from keep 0; drop disconnected land into water
  const grid = new Grid(W, H, tiles);
  const reach = grid.reachable(Math.floor(keeps[0].x), Math.floor(keeps[0].y));
  if (!reach[Math.floor(keeps[1].y) * W + Math.floor(keeps[1].x)]) {
    // carve a straight corridor as a last resort
    for (let y = Math.floor(keeps[1].y); y <= Math.floor(keeps[0].y); y++) {
      const x = Math.round(spineX(y));
      for (let dx = -1; dx <= 1; dx++) {
        const i = y * W + x + dx;
        if (BLOCKING.has(tiles[i])) tiles[i] = T.SAND;
      }
    }
  }
  const reach2 = new Grid(W, H, tiles).reachable(Math.floor(keeps[0].x), Math.floor(keeps[0].y));
  for (let i = 0; i < tiles.length; i++) {
    if (!reach2[i] && !BLOCKING.has(tiles[i])) tiles[i] = T.WATER;
  }

  const free = (x, y, r = 1) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = Math.floor(x) + dx;
      const yy = Math.floor(y) + dy;
      if (xx < 1 || yy < 1 || xx >= W - 1 || yy >= H - 1) return false;
      const t = tiles[yy * W + xx];
      if (BLOCKING.has(t) || t === T.FOREST || !reach2[yy * W + xx]) return false;
    }
    return true;
  };
  const used = [];
  const farFromUsed = (x, y, d) => used.every((u) => Math.hypot(u.x - x, u.y - y) >= d);
  /** Find a free spot near (x, y) in the bottom half and also add its mirror. */
  const placePair = (x, y, r, spread, minD) => {
    for (let tries = 0; tries < 220; tries++) {
      const a = rng.next() * Math.PI * 2;
      const d = tries < 3 ? 0 : rng.next() * spread;
      const px = Math.floor(x + Math.cos(a) * d) + 0.5;
      const py = Math.floor(y + Math.sin(a) * d) + 0.5;
      if (!free(px, py, r)) continue;
      const m = { x: W - px, y: H - py };
      if (!free(m.x, m.y, r)) continue;
      if (!farFromUsed(px, py, minD) || !farFromUsed(m.x, m.y, minD) || Math.hypot(px - m.x, py - m.y) < minD) continue;
      used.push({ x: px, y: py }, m);
      return [{ x: px, y: py }, m];
    }
    return [];
  };
  for (const k of keeps) used.push({ x: k.x, y: k.y });

  const shrine = { x: W / 2, y: H / 2 };
  // make sure the shrine stands on land
  for (let y = Math.floor(shrine.y - 1.5); y <= Math.floor(shrine.y + 1); y++) for (let x = Math.floor(shrine.x - 1.5); x <= Math.floor(shrine.x + 1); x++) {
    const i = y * W + x;
    if (BLOCKING.has(tiles[i]) || tiles[i] === T.FOREST) tiles[i] = T.GRASS;
  }
  used.push({ ...shrine });

  const deposits = [];
  const k0 = keeps[0];
  for (const [dx, dy] of [[-6, -2], [6, -3]]) {
    for (const p of placePair(k0.x + dx, k0.y + dy, 0, 3, 3)) deposits.push({ ...p, amount: 450, rich: false });
  }
  for (const [dx, dy] of [[-11, -14], [10, -12]]) {
    for (const p of placePair(k0.x + dx, k0.y + dy, 0, 5, 5)) deposits.push({ ...p, amount: 800, rich: true });
  }
  const nests = [];
  for (const [dx, dy, kind] of [[-12, -19, 'wolf'], [12, -21, 'bandit']]) {
    for (const p of placePair(k0.x + dx, k0.y + dy, 1, 5, 6)) nests.push({ ...p, kind });
  }
  const critters = [];
  for (let n = 0; n < 5; n++) for (const p of placePair(4 + rng.next() * (W - 8), H / 2 + 2 + rng.next() * 14, 0, 4, 3)) critters.push(p);

  return { w: W, h: H, tiles, keeps, deposits, nests, shrine, critters, river, biome, seed };
}
