// God Box — elemental simulation and terrain painting (pure, no DOM).
import { T, B, F, H, CANON_H, FLAMMABLE, IS_WATER, NATURAL, SP } from './constants.js';
import { rand, randInt, markDirty, markDirtyIdx, fx, forEachNear, addEvent } from './state.js';
import { baseTileForHeight } from './worldgen.js';
import { damageBuilding } from './civ.js';
import { damage, die, spawnCreature } from './creatures.js';
import { clamp } from './rng.js';

const N4X = [1, -1, 0, 0];
const N4Y = [0, 0, 1, -1];
const N8X = [1, -1, 0, 0, 1, 1, -1, -1];
const N8Y = [0, 0, 1, -1, 1, -1, 1, -1];
const BIOME_FIRE = [1, 1.3, 0.45, 0.35, 1, 0.8];

/** Change a tile type, keeping derived data consistent. */
export function setTile(s, i, t) {
  const old = s.tile[i];
  if (old === t) return;
  s.tile[i] = t;
  if (old === T.LAVA || old === T.ACID || old === T.FARM) s.aux[i] = 0;
  if (IS_WATER[t] || t === T.CRACK || t === T.ICE) s.fire[i] = 0;
  markDirtyIdx(s, i);
  const bid = s.bmap[i];
  if (bid && (IS_WATER[t] || t === T.LAVA || t === T.ACID || t === T.CRACK)) {
    const b = s.buildings.get(bid);
    if (b) damageBuilding(s, b, t === T.LAVA ? 80 : 9999, 'terrain');
  }
}

/** Paint one tile with a terrain type (god tool). */
export function paintTile(s, i, type) {
  const cur = s.tile[i];
  if (type === T.LAVA) {
    if (IS_WATER[cur] || cur === T.ICE) {
      if (s.height[i] < H.SEA) s.height[i] = H.SEA + 1;
      setTile(s, i, T.STONE);
      return;
    }
    if (cur !== T.LAVA) {
      setTile(s, i, T.LAVA);
      s.lavas.push(i);
    }
    s.aux[i] = 40 + randInt(s, 50);
    return;
  }
  if (type === T.SNOW) {
    if (IS_WATER[cur]) {
      setTile(s, i, T.ICE);
      return;
    }
    if (s.height[i] < H.SAND) s.height[i] = H.SAND + 2;
    s.fire[i] = 0;
    setTile(s, i, T.SNOW);
    return;
  }
  s.height[i] = clamp(CANON_H[type] + randInt(s, 7) - 3, 0, 255);
  if (IS_WATER[type]) s.fire[i] = 0;
  setTile(s, i, type);
  markDirtyIdx(s, i);
}

/** Visit tiles in a disc. cb(i, x, y, falloff 0..1). */
export function forDisc(s, cx, cy, r, cb) {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(s.w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(s.h - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2) cb(y * s.w + x, x, y, 1 - Math.sqrt(d2) / (r || 1));
    }
  }
}

export function paintTerrain(s, cx, cy, r, type) {
  forDisc(s, cx, cy, r, (i) => paintTile(s, i, type));
  markDirty(s, Math.max(0, Math.floor(cx - r - 1)), Math.max(0, Math.floor(cy - r - 1)));
  markDirty(s, Math.min(s.w - 1, Math.ceil(cx + r + 1)), Math.min(s.h - 1, Math.ceil(cy + r + 1)));
}

/** Raise (delta>0) or lower land and reclassify natural terrain. */
export function shiftHeight(s, i, delta) {
  const t = s.tile[i];
  const hgt = clamp(s.height[i] + delta, 0, 255);
  s.height[i] = hgt;
  let nt = t;
  if (NATURAL[t] || t === T.ICE) {
    const base = baseTileForHeight(hgt);
    if (t === T.FOREST && (base === T.GRASS || base === T.HILLS)) nt = T.FOREST;
    else if (t === T.ORE && base === T.MOUNTAIN) nt = T.ORE;
    else if (t === T.ICE && base === T.SHALLOW) nt = T.ICE;
    else if (base === T.SHALLOW && s.biome[i] === B.FROST && hgt > H.DEEP + 3) nt = T.ICE;
    else nt = base;
  } else if (hgt < H.SEA) {
    nt = hgt < H.DEEP ? T.DEEP : T.SHALLOW;
  }
  if (nt !== t) setTile(s, i, nt);
  markDirtyIdx(s, i);
}

export function raiseLand(s, cx, cy, r, dir) {
  forDisc(s, cx, cy, r, (i, x, y, f) => shiftHeight(s, i, dir * Math.max(2, Math.round(9 * (0.35 + f)))));
  markDirty(s, Math.max(0, Math.floor(cx - r - 1)), Math.max(0, Math.floor(cy - r - 1)));
  markDirty(s, Math.min(s.w - 1, Math.ceil(cx + r + 1)), Math.min(s.h - 1, Math.ceil(cy + r + 1)));
}

/** Paint a biome "seed": changes the biome of land under the brush with a ragged edge. */
export function paintBiome(s, cx, cy, r, bio) {
  forDisc(s, cx, cy, r, (i, x, y, f) => {
    if (f < 0.25 && rand(s) < 0.5) return;
    const t = s.tile[i];
    s.biome[i] = bio;
    if (bio === B.VOID) {
      if (!IS_WATER[t] && rand(s) < 0.35) s.flags[i] |= F.SPREAD;
    } else s.flags[i] &= ~F.SPREAD;
    if (bio === B.FROST) {
      if (t === T.SHALLOW && s.height[i] > H.DEEP + 2) setTile(s, i, T.ICE);
      s.fire[i] = 0;
    } else if (t === T.ICE) setTile(s, i, T.SHALLOW);
    if (bio === B.DESERT && t === T.FOREST && rand(s) < 0.6) setTile(s, i, T.GRASS);
    if (bio === B.SWAMP && t === T.GRASS && rand(s) < 0.05) {
      s.height[i] = H.SEA - 3;
      setTile(s, i, T.SHALLOW);
    }
    if (bio === B.CANDY && t === T.GRASS && rand(s) < 0.08) setTile(s, i, T.FOREST);
    markDirtyIdx(s, i);
  });
}

// ---- fire ---------------------------------------------------------------------------------------

/** Set a tile on fire if it can burn. Returns true when burning. */
export function ignite(s, i, power = 40) {
  if (s.fire[i]) {
    if (s.fire[i] < power) s.fire[i] = power;
    return true;
  }
  const t = s.tile[i];
  if (!FLAMMABLE[t] && !s.bmap[i]) return false;
  s.fire[i] = Math.min(255, power);
  s.fires.push(i);
  return true;
}

export function igniteDisc(s, cx, cy, r, chance = 1, power = 50) {
  forDisc(s, cx, cy, r, (i) => {
    if (rand(s) < chance) ignite(s, i, power + randInt(s, 20));
  });
}

/** Advance fires (budgeted). Burning grass/forest/farms turn to ash. */
export function stepFire(s) {
  const list = s.fires;
  if (!list.length) return;
  const w = s.w;
  const h = s.h;
  let budget = Math.min(list.length, 700);
  while (budget-- > 0 && list.length) {
    if (s.fireCursor >= list.length) s.fireCursor = 0;
    const j = s.fireCursor;
    const i = list[j];
    let f = s.fire[i];
    if (!f) {
      list[j] = list[list.length - 1];
      list.pop();
      continue;
    }
    const x = i % w;
    const y = (i / w) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + N4X[d];
      const ny = y + N4Y[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (s.fire[ni]) continue;
      let p = FLAMMABLE[s.tile[ni]] * BIOME_FIRE[s.biome[ni]];
      if (s.bmap[ni] && p < 0.08) p = 0.08;
      if (p > 0 && rand(s) < p) ignite(s, ni, 25 + randInt(s, 30));
    }
    const bid = s.bmap[i];
    if (bid) {
      const b = s.buildings.get(bid);
      if (b) damageBuilding(s, b, 2.5, 'fire');
    }
    f -= 1 + randInt(s, 3);
    if (f <= 0) {
      s.fire[i] = 0;
      const t = s.tile[i];
      if (t === T.FOREST || t === T.GRASS || t === T.FARM) setTile(s, i, T.ASH);
      list[j] = list[list.length - 1];
      list.pop();
      if (rand(s) < 0.12) fx(s, { k: 'p', kind: 'smoke', x: x + 0.5, y: y + 0.5, n: 1 });
    } else {
      s.fire[i] = f;
      s.fireCursor++;
    }
  }
}

// ---- lava ---------------------------------------------------------------------------------------

/** Lava flows a little downhill, ignites things, and turns to stone when it meets water. */
export function stepLava(s) {
  const list = s.lavas;
  if (!list.length) return;
  const w = s.w;
  const h = s.h;
  let budget = Math.min(list.length, 400);
  while (budget-- > 0 && list.length) {
    if (s.lavaCursor >= list.length) s.lavaCursor = 0;
    const j = s.lavaCursor;
    const i = list[j];
    if (s.tile[i] !== T.LAVA) {
      list[j] = list[list.length - 1];
      list.pop();
      continue;
    }
    const x = i % w;
    const y = (i / w) | 0;
    let cooled = false;
    let best = -1;
    let bh = 999;
    for (let d = 0; d < 4; d++) {
      const nx = x + N4X[d];
      const ny = y + N4Y[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      const nt = s.tile[ni];
      if (IS_WATER[nt] || nt === T.ICE) {
        setTile(s, i, T.STONE);
        if (nt !== T.DEEP && rand(s) < 0.5) {
          if (s.height[ni] < H.SEA) s.height[ni] = H.SEA;
          setTile(s, ni, T.STONE);
        }
        fx(s, { k: 'p', kind: 'steam', x: nx + 0.5, y: ny + 0.5, n: 3 });
        if (rand(s) < 0.05) fx(s, { k: 's', name: 'splash' });
        cooled = true;
        break;
      }
      if (FLAMMABLE[nt] && !s.fire[ni] && rand(s) < 0.25) ignite(s, ni, 40);
      if (nt !== T.LAVA && nt !== T.CRACK && s.height[ni] < bh) {
        bh = s.height[ni];
        best = ni;
      }
    }
    if (cooled) {
      list[j] = list[list.length - 1];
      list.pop();
      continue;
    }
    const a = s.aux[i];
    if (a > 6 && best >= 0 && bh <= s.height[i] + 1 && rand(s) < 0.5) {
      setTile(s, best, T.LAVA);
      s.aux[best] = Math.max(0, a - 7 - randInt(s, 10));
      list.push(best);
      s.aux[i] = a - 3;
    } else if (a > 0) s.aux[i] = a - 1;
    else if (rand(s) < 0.006) {
      setTile(s, i, T.STONE);
      list[j] = list[list.length - 1];
      list.pop();
      continue;
    }
    s.lavaCursor++;
  }
}

// ---- acid ---------------------------------------------------------------------------------------

export function paintAcid(s, cx, cy, r) {
  forDisc(s, cx, cy, r, (i, x, y, f) => {
    if (f < 0.2 && rand(s) < 0.5) return;
    const t = s.tile[i];
    if (IS_WATER[t] || t === T.CRACK) return;
    if (t !== T.ACID) {
      setTile(s, i, T.ACID);
      s.acids.push(i);
    }
    s.aux[i] = 120 + randInt(s, 80);
    const bid = s.bmap[i];
    if (bid) {
      const b = s.buildings.get(bid);
      if (b) damageBuilding(s, b, 9999, 'acid');
    }
  });
}

export function stepAcid(s) {
  const list = s.acids;
  if (!list.length) return;
  let budget = Math.min(list.length, 400);
  while (budget-- > 0 && list.length) {
    if (s.acidCursor >= list.length) s.acidCursor = 0;
    const j = s.acidCursor;
    const i = list[j];
    if (s.tile[i] !== T.ACID) {
      list[j] = list[list.length - 1];
      list.pop();
      continue;
    }
    const a = s.aux[i];
    if (a <= 4) {
      setTile(s, i, T.WASTE);
      list[j] = list[list.length - 1];
      list.pop();
      continue;
    }
    s.aux[i] = a - 4;
    if (rand(s) < 0.04) fx(s, { k: 'p', kind: 'acid', x: (i % s.w) + 0.5, y: ((i / s.w) | 0) + 0.5, n: 1 });
    s.acidCursor++;
  }
}

// ---- slow terrain processes ------------------------------------------------------------------

function hasNeighbour(s, i, a, b = -1) {
  const w = s.w;
  const x = i % w;
  const y = (i / w) | 0;
  for (let d = 0; d < 4; d++) {
    const nx = x + N4X[d];
    const ny = y + N4Y[d];
    if (nx < 0 || ny < 0 || nx >= w || ny >= s.h) continue;
    const t = s.tile[ny * w + nx];
    if (t === a || t === b) return true;
  }
  return false;
}
function countNeighbours(s, i, a) {
  const w = s.w;
  const x = i % w;
  const y = (i / w) | 0;
  let n = 0;
  for (let d = 0; d < 8; d++) {
    const nx = x + N8X[d];
    const ny = y + N8Y[d];
    if (nx < 0 || ny < 0 || nx >= w || ny >= s.h) continue;
    if (s.tile[ny * w + nx] === a) n++;
  }
  return n;
}

/** Random-tile updates: regrowth, freezing/melting, corruption spread, farms growing. */
export function stepTerrain(s) {
  const samples = Math.max(60, (s.n / 160) | 0);
  const w = s.w;
  for (let k = 0; k < samples; k++) {
    const i = randInt(s, s.n);
    const t = s.tile[i];
    const b = s.biome[i];
    switch (t) {
      case T.ASH:
        if (rand(s) < 0.1 && hasNeighbour(s, i, T.GRASS, T.FOREST)) setTile(s, i, T.GRASS);
        break;
      case T.GRASS:
        if (b !== B.DESERT && !s.bmap[i] && rand(s) < 0.02 && countNeighbours(s, i, T.FOREST) >= 2) setTile(s, i, T.FOREST);
        break;
      case T.WASTE:
        if (rand(s) < 0.03) setTile(s, i, T.ASH);
        break;
      case T.CRACK:
        if (rand(s) < 0.02) setTile(s, i, T.STONE);
        break;
      case T.STONE:
        if (rand(s) < 0.004 && hasNeighbour(s, i, T.GRASS)) setTile(s, i, T.GRASS);
        break;
      case T.SHALLOW:
        if (b === B.FROST && s.height[i] > H.DEEP + 3 && rand(s) < 0.05) setTile(s, i, T.ICE);
        break;
      case T.ICE:
        if (b !== B.FROST && rand(s) < 0.05) setTile(s, i, T.SHALLOW);
        break;
      case T.FARM:
        if (s.aux[i] < 3 && rand(s) < 0.5) {
          s.aux[i]++;
          markDirtyIdx(s, i);
        }
        break;
      default:
        break;
    }
    if (s.flags[i] & F.SPREAD) {
      const x = i % w;
      const y = (i / w) | 0;
      const d = randInt(s, 8);
      const nx = x + N8X[d];
      const ny = y + N8Y[d];
      if (nx >= 0 && ny >= 0 && nx < w && ny < s.h) {
        const ni = ny * w + nx;
        if (!IS_WATER[s.tile[ni]] && s.biome[ni] !== B.VOID) {
          s.biome[ni] = B.VOID;
          s.flags[ni] |= F.SPREAD;
          markDirtyIdx(s, ni);
        }
      }
      if (rand(s) < 0.4) s.flags[i] &= ~F.SPREAD;
    }
    if (b === B.VOID && !IS_WATER[t] && rand(s) < 0.0015 && s.counts.sp[SP.SKELETON] < 20) {
      const c = spawnCreature(s, SP.SKELETON, (i % w) + 0.5, ((i / w) | 0) + 0.5);
      if (c) addEvent(s, 'Skeletons crawl out of the Void', { x: c.x, y: c.y, key: 'voidskel', cooldown: 2400, color: '#b9c3cf' });
    }
  }
}

// ---- clouds and black holes ------------------------------------------------------------------

/** kind: 'rain' | 'plague' | 'fallout' */
export function addCloud(s, kind, x, y, r, ttl) {
  if (s.clouds.length >= 24) s.clouds.shift();
  s.clouds.push({ kind, x, y, r, ttl, max: ttl, vx: (rand(s) - 0.5) * 0.04, vy: (rand(s) - 0.5) * 0.03, seed: randInt(s, 1e6) });
}

export function stepClouds(s) {
  const list = s.clouds;
  for (let k = list.length - 1; k >= 0; k--) {
    const c = list[k];
    c.x += c.vx;
    c.y += c.vy;
    c.ttl--;
    if (c.ttl <= 0 || c.x < -20 || c.y < -20 || c.x > s.w + 20 || c.y > s.h + 20) {
      list.splice(k, 1);
      continue;
    }
    const r = c.r;
    const samples = Math.max(6, Math.ceil(r * r * 0.12));
    for (let m = 0; m < samples; m++) {
      const a = rand(s) * Math.PI * 2;
      const d = Math.sqrt(rand(s)) * r;
      const x = (c.x + Math.cos(a) * d) | 0;
      const y = (c.y + Math.sin(a) * d) | 0;
      if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
      const i = y * s.w + x;
      const t = s.tile[i];
      if (c.kind === 'rain') {
        if (s.fire[i]) s.fire[i] = 0;
        if (t === T.ASH && rand(s) < 0.3) setTile(s, i, T.GRASS);
        else if (t === T.LAVA && rand(s) < 0.1) setTile(s, i, T.STONE);
        else if (t === T.WASTE && rand(s) < 0.15) setTile(s, i, T.ASH);
        else if (t === T.GRASS && s.biome[i] !== B.DESERT && !s.bmap[i] && rand(s) < 0.012) setTile(s, i, T.FOREST);
        else if (t === T.ACID) s.aux[i] = Math.max(0, s.aux[i] - 30);
        else if (t === T.FARM && s.aux[i] < 3) s.aux[i]++;
      } else if (c.kind === 'fallout') {
        if ((t === T.GRASS || t === T.FOREST || t === T.FARM) && rand(s) < 0.08) setTile(s, i, T.WASTE);
      }
    }
    if (s.tick % 6 === 0) {
      forEachNear(s, c.x, c.y, r, (cr) => {
        if (c.kind === 'rain') cr.burn = 0;
        else if (c.kind === 'plague') {
          if (cr.sp === SP.VILLAGER && !cr.sick && !cr.imm && rand(s) < 0.5) cr.sick = 260 + randInt(s, 200);
        } else if (c.kind === 'fallout' && !cr.fly && s.tick % 12 === 0) damage(s, cr, 2, null, 'fallout');
        return false;
      });
    }
  }
}

export function addHole(s, x, y) {
  if (s.holes.length >= 3) s.holes.shift();
  s.holes.push({ x, y, ttl: 160, max: 160, r: 22 });
}

export function stepHoles(s) {
  const list = s.holes;
  for (let k = list.length - 1; k >= 0; k--) {
    const hole = list[k];
    hole.ttl--;
    const age = hole.max - hole.ttl;
    const eat = 1.5 + 5 * Math.min(1, age / 100);
    forEachNear(s, hole.x, hole.y, hole.r, (c) => {
      const dx = hole.x - c.x;
      const dy = hole.y - c.y;
      const d = Math.hypot(dx, dy) || 0.01;
      if (d < 1.2) {
        fx(s, { k: 'p', kind: 'magic', x: c.x, y: c.y, n: 3 });
        die(s, c, null, 'black hole');
        return false;
      }
      const pull = Math.min(d, 0.05 + 1.2 / (d + 2));
      c.x += (dx / d) * pull;
      c.y += (dy / d) * pull;
      c.mv = 1;
      return false;
    });
    for (let m = 0; m < 7; m++) {
      const a = rand(s) * Math.PI * 2;
      const d = Math.sqrt(rand(s)) * eat;
      const x = (hole.x + Math.cos(a) * d) | 0;
      const y = (hole.y + Math.sin(a) * d) | 0;
      if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
      const i = y * s.w + x;
      if (s.tile[i] !== T.DEEP) {
        fx(s, { k: 'suck', x: x + 0.5, y: y + 0.5, hx: hole.x, hy: hole.y, t: s.tile[i], b: s.biome[i] });
        s.height[i] = 40 + randInt(s, 20);
        setTile(s, i, T.DEEP);
      }
      const bid = s.bmap[i];
      if (bid) {
        const b = s.buildings.get(bid);
        if (b) damageBuilding(s, b, 40, 'void');
      }
    }
    if (hole.ttl <= 0) {
      fx(s, { k: 'ring', x: hole.x, y: hole.y, r: 10, color: '#b45be8' });
      list.splice(k, 1);
    }
  }
}
