// God Box — villages, buildings, kingdoms, diplomacy and war (pure, no DOM).
import {
  T, BT, BDEF, TRIBES, J, SP, TICKS_PER_DAY, TICKS_PER_YEAR, BUILDABLE, IS_WATER, H,
  HALL_HOUSING, LEVEL_REQ, LEVEL_NAMES, KINGDOM_COLORS,
} from './constants.js';
import { rand, randInt, addEvent, fx, sfx, forEachNear, countNear, markDirtyIdx, pick } from './state.js';
import { villageName, kingdomName } from './names.js';
import { spawnCreature, K, damage } from './creatures.js';
import { setTile, ignite } from './elements.js';
import { clamp } from './rng.js';

// ---- lookup helpers ----------------------------------------------------------------------------

export const villageOf = (s, c) => (c.vil ? s.villages.get(c.vil) || null : null);
export const kingdomOf = (s, c) => (c.kd ? s.kingdoms.get(c.kd) || null : null);

export function atWar(s, kdA, kdB) {
  if (!kdA || !kdB || kdA === kdB) return false;
  const a = s.kingdoms.get(kdA);
  return !!a && a.wars.includes(kdB);
}

export function villageAtTile(s, x, y) {
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return null;
  const vid = s.zone[(y | 0) * s.w + (x | 0)];
  return vid ? s.villages.get(vid) || null : null;
}

export function nearestVillage(s, x, y, r, pred) {
  let best = null;
  let bd = r * r;
  for (const v of s.villages.values()) {
    const d = (v.x - x) ** 2 + (v.y - y) ** 2;
    if (d < bd && (!pred || pred(v))) {
      bd = d;
      best = v;
    }
  }
  return best;
}

export function kingdomVillages(s, kd) {
  const out = [];
  for (const v of s.villages.values()) if (v.kd === kd) out.push(v);
  return out;
}

const kname = (s, kd) => s.kingdoms.get(kd)?.name || 'the wilds';
const kcolor = (s, kd) => s.kingdoms.get(kd)?.color || null;

// ---- buildings ---------------------------------------------------------------------------------

/** Can a w x h footprint (top-left x,y) be built for village id vid (0 = founding)? */
export function canPlace(s, x, y, w, h, vid) {
  if (x < 1 || y < 1 || x + w >= s.w - 1 || y + h >= s.h - 1) return false;
  for (let yy = y - 1; yy <= y + h; yy++) {
    for (let xx = x - 1; xx <= x + w; xx++) {
      const i = yy * s.w + xx;
      if (s.bmap[i]) return false;
      const inner = xx >= x && yy >= y && xx < x + w && yy < y + h;
      if (!inner) continue;
      if (!BUILDABLE[s.tile[i]] || s.fire[i]) return false;
      const z = s.zone[i];
      if (z && z !== vid) return false;
    }
  }
  return true;
}

export function placeBuilding(s, type, v, x, y, built = false) {
  const def = BDEF[type];
  const b = {
    id: s.nextBid++, type, vil: v.id, x, y, w: def.w, h: def.h,
    hp: def.hp, mhp: def.hp, prog: built ? 1 : 0, cd: 0,
  };
  s.buildings.set(b.id, b);
  for (let yy = y; yy < y + def.h; yy++) {
    for (let xx = x; xx < x + def.w; xx++) {
      const i = yy * s.w + xx;
      s.bmap[i] = b.id;
      if (type === BT.FARM) {
        setTile(s, i, T.FARM);
        s.aux[i] = 0;
      } else if (s.tile[i] === T.FOREST || s.tile[i] === T.ASH) setTile(s, i, T.GRASS);
      markDirtyIdx(s, i);
    }
  }
  v.blds.push(b.id);
  v.bc[type]++;
  return b;
}

export function removeBuilding(s, b, cause = '') {
  if (!s.buildings.has(b.id)) return;
  s.buildings.delete(b.id);
  for (let yy = b.y; yy < b.y + b.h; yy++) {
    for (let xx = b.x; xx < b.x + b.w; xx++) {
      const i = yy * s.w + xx;
      if (s.bmap[i] === b.id) s.bmap[i] = 0;
      if (b.type === BT.FARM && s.tile[i] === T.FARM) setTile(s, i, T.GRASS);
    }
  }
  fx(s, { k: 'p', kind: 'debris', x: b.x + b.w / 2, y: b.y + b.h / 2, n: 6 + b.w * 2 });
  fx(s, { k: 'p', kind: 'smoke', x: b.x + b.w / 2, y: b.y + b.h / 2, n: 4 });
  const v = s.villages.get(b.vil);
  if (!v) return;
  const k = v.blds.indexOf(b.id);
  if (k >= 0) v.blds.splice(k, 1);
  v.bc[b.type] = Math.max(0, v.bc[b.type] - 1);
  if (v.project === b.id) v.project = 0;
  if (b.type === BT.HALL) destroyVillage(s, v, cause);
  else recalcHousing(s, v);
}

export function damageBuilding(s, b, amt, cause = '') {
  if (b.type === BT.HALL && cause === 'fire') amt *= 0.3;
  b.hp -= amt;
  if (b.hp <= 0) removeBuilding(s, b, cause);
}

export function recalcHousing(s, v) {
  let hs = HALL_HOUSING[v.level] || 4;
  for (const id of v.blds) {
    const b = s.buildings.get(id);
    if (b && b.prog >= 1) hs += BDEF[b.type].housing;
  }
  v.housing = hs;
}

/** Called when construction finishes. */
export function completeBuilding(s, b) {
  const v = s.villages.get(b.vil);
  b.prog = 1;
  sfx(s, 'build');
  fx(s, { k: 'p', kind: 'dust', x: b.x + b.w / 2, y: b.y + b.h, n: 8 });
  if (!v) return;
  if (v.project === b.id) v.project = 0;
  if (b.type === BT.HALL) {
    v.level = Math.min(4, v.level + 1);
    b.mhp = BDEF[BT.HALL].hp * (1 + v.level * 0.5);
    b.hp = b.mhp;
    addEvent(s, `${v.name} grew into a ${LEVEL_NAMES[v.level]}`, { x: v.x, y: v.y, color: kcolor(s, v.kd), kind: 'grow' });
    sfx(s, 'level_up');
  } else if (b.type === BT.TEMPLE) {
    addEvent(s, `${v.name} raised a temple`, { x: v.x, y: v.y, color: kcolor(s, v.kd) });
  }
  recalcHousing(s, v);
}

// ---- villages & kingdoms ----------------------------------------------------------------------

/** Find a free 5x5 hall site near (x,y). Returns centre {x,y} or null. */
export function findVillageSite(s, x, y, r) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  for (let rad = 0; rad <= r; rad++) {
    for (let k = 0; k < Math.max(1, rad * 6); k++) {
      const a = (k / Math.max(1, rad * 6)) * Math.PI * 2;
      const px = Math.round(cx + Math.cos(a) * rad);
      const py = Math.round(cy + Math.sin(a) * rad);
      if (!canPlace(s, px - 2, py - 2, 5, 5, 0)) continue;
      if (nearestVillage(s, px, py, 15)) continue;
      // Need a bit of buildable land around.
      let ok = 0;
      for (let m = 0; m < 24; m++) {
        const tx = px + randInt(s, 15) - 7;
        const ty = py + randInt(s, 15) - 7;
        if (tx < 0 || ty < 0 || tx >= s.w || ty >= s.h) continue;
        if (BUILDABLE[s.tile[ty * s.w + tx]]) ok++;
      }
      if (ok >= 13) return { x: px, y: py };
    }
  }
  return null;
}

function pickKingdomColor(s) {
  const used = new Set([...s.kingdoms.values()].map((k) => k.color));
  const free = KINGDOM_COLORS.filter((c) => !used.has(c));
  if (free.length) return pick(s, free);
  const hue = randInt(s, 360);
  return `hsl(${hue} 80% 60%)`;
}

export function createKingdom(s, tribe, v, rebel = false) {
  const k = {
    id: s.nextKid++, name: kingdomName(s, tribe, v.name, rebel), tribe, color: pickKingdomColor(s),
    capital: v.id, born: s.tick, wars: [], allies: [], op: {}, warT: {}, king: 0,
  };
  s.kingdoms.set(k.id, k);
  return k;
}

/** Found a village with creature c as founder at hall centre (x,y). */
export function foundVillage(s, c, x, y) {
  if (!canPlace(s, x - 2, y - 2, 5, 5, 0)) return null;
  const v = {
    id: s.nextVid++, name: villageName(s, c.tribe), tribe: c.tribe, kd: 0, x, y, level: 1, r: 8,
    res: { wood: 10, stone: 4, food: 24, ore: 0 }, hall: 0, project: 0, pop: 0, adults: 0, kids: 0,
    housing: HALL_HOUSING[1], born: s.tick, capture: 0, capBy: 0, empty: 0, blds: [], bc: new Array(8).fill(0),
    jobs: new Array(6).fill(0), starving: 0, lastAttack: 0,
  };
  s.villages.set(v.id, v);
  let k = c.kd ? s.kingdoms.get(c.kd) : null;
  const newKingdom = !k;
  if (!k) k = createKingdom(s, c.tribe, v);
  v.kd = k.id;
  if (newKingdom) k.king = c.id;
  const hall = placeBuilding(s, BT.HALL, v, x - 2, y - 2, true);
  v.hall = hall.id;
  claimTerritory(s, v);
  recalcHousing(s, v);
  joinVillage(s, c, v);
  const tribe = TRIBES[c.tribe];
  if (newKingdom) addEvent(s, `${tribe.name} founded ${v.name} - the ${k.name} rises`, { x, y, color: k.color, kind: 'found' });
  else addEvent(s, `Settlers of the ${k.name} founded ${v.name}`, { x, y, color: k.color, kind: 'found' });
  sfx(s, 'build');
  fx(s, { k: 'p', kind: 'gold', x, y, n: 12 });
  return v;
}

export function joinVillage(s, c, v) {
  c.vil = v.id;
  c.kd = v.kd;
  c.job = J.NONE;
  c.task = K.IDLE;
}

export function claimTerritory(s, v) {
  const r = v.r;
  const x0 = Math.max(0, Math.floor(v.x - r));
  const x1 = Math.min(s.w - 1, Math.ceil(v.x + r));
  const y0 = Math.max(0, Math.floor(v.y - r));
  const y1 = Math.min(s.h - 1, Math.ceil(v.y + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - v.x;
      const dy = y - v.y;
      const wob = ((x * 7 + y * 13 + v.id * 5) % 5) * 0.35;
      if (dx * dx + dy * dy > (r - wob) * (r - wob)) continue;
      const i = y * s.w + x;
      if (s.zone[i] || s.tile[i] === T.DEEP) continue;
      s.zone[i] = v.id;
    }
  }
  s.bordersDirty = true;
}

export function releaseTerritory(s, v) {
  const r = v.r + 2;
  const x0 = Math.max(0, Math.floor(v.x - r));
  const x1 = Math.min(s.w - 1, Math.ceil(v.x + r));
  const y0 = Math.max(0, Math.floor(v.y - r));
  const y1 = Math.min(s.h - 1, Math.ceil(v.y + r));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (s.zone[y * s.w + x] === v.id) s.zone[y * s.w + x] = 0;
  s.bordersDirty = true;
}

function newBand(s, leader, kd, extra = {}) {
  const band = { id: s.nextBand++, leader: leader.id, t: s.tick, wait: TICKS_PER_DAY, vid: 0, kd, settle: 0, tx: 0, ty: 0, ...extra };
  s.bands.set(band.id, band);
  return band;
}
export { newBand };

export function destroyVillage(s, v, cause = '') {
  if (!s.villages.has(v.id)) return;
  s.villages.delete(v.id);
  releaseTerritory(s, v);
  for (const id of [...v.blds]) {
    const b = s.buildings.get(id);
    if (b) {
      b.vil = 0;
      removeBuilding(s, b, cause);
    }
  }
  const k = s.kingdoms.get(v.kd);
  const others = k ? kingdomVillages(s, k.id) : [];
  let band = null;
  for (const c of s.creatures) {
    if (c.dead || c.vil !== v.id) continue;
    if (!band) band = newBand(s, c, others.length ? v.kd : 0);
    c.vil = 0;
    c.job = J.NONE;
    c.task = K.IDLE;
    c.band = band.id;
    if (!others.length) c.kd = 0;
  }
  const why = cause === 'abandoned' ? 'was abandoned' : 'was destroyed';
  addEvent(s, `${v.name} ${why}`, { x: v.x, y: v.y, color: '#ff5a5a', kind: 'destroy' });
  if (k) {
    if (!others.length) kingdomFalls(s, k);
    else if (k.capital === v.id) k.capital = others[0].id;
  }
}

function kingdomFalls(s, k) {
  s.kingdoms.delete(k.id);
  for (const o of s.kingdoms.values()) {
    o.wars = o.wars.filter((id) => id !== k.id);
    o.allies = o.allies.filter((id) => id !== k.id);
    delete o.op[k.id];
  }
  for (const c of s.creatures) if (c.kd === k.id && !c.vil) c.kd = 0;
  for (const b of s.bands.values()) if (b.kd === k.id) b.kd = 0;
  addEvent(s, `The ${k.name} has fallen`, { color: k.color, kind: 'fall' });
}

export function captureVillage(s, v, kd) {
  const old = s.kingdoms.get(v.kd);
  const nk = s.kingdoms.get(kd);
  if (!nk) return;
  v.kd = kd;
  v.capture = 0;
  for (const c of s.creatures) if (!c.dead && c.vil === v.id) c.kd = kd;
  s.bordersDirty = true;
  addEvent(s, `The ${nk.name} captured ${v.name}!`, { x: v.x, y: v.y, color: nk.color, kind: 'capture' });
  sfx(s, 'tower_destroy');
  fx(s, { k: 'p', kind: 'gold', x: v.x, y: v.y, n: 16 });
  if (old) {
    const left = kingdomVillages(s, old.id);
    if (!left.length) kingdomFalls(s, old);
    else if (old.capital === v.id) old.capital = left[0].id;
  }
}

/** Warriors at an undefended enemy hall slowly capture it. */
export function siege(s, c, tv) {
  const defenders = countNear(s, tv.x, tv.y, Math.min(tv.r, 9), (o) => o.sp === SP.VILLAGER && o.kd === tv.kd && !o.child);
  tv.lastAttack = s.tick;
  if (defenders > 0) return false;
  tv.capture += 2;
  tv.capBy = c.kd;
  if (c.tribe === 1 && rand(s) < 0.04) {
    const x = (tv.x + randInt(s, 11) - 5) | 0;
    const y = (tv.y + randInt(s, 11) - 5) | 0;
    if (x >= 0 && y >= 0 && x < s.w && y < s.h) ignite(s, y * s.w + x, 40);
  }
  if (tv.capture >= 60) captureVillage(s, tv, c.kd);
  return true;
}

/** Nearest village of a kingdom at war with creature c's kingdom. */
export function warTargetFor(s, c) {
  const k = s.kingdoms.get(c.kd);
  if (!k || !k.wars.length) return null;
  let best = null;
  let bd = Infinity;
  for (const v of s.villages.values()) {
    if (!k.wars.includes(v.kd)) continue;
    const d = (v.x - c.x) ** 2 + (v.y - c.y) ** 2;
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  return bd < 120 * 120 ? best : null;
}

// ---- jobs ---------------------------------------------------------------------------------------

/** Assign the job the village most needs. */
export function pickJob(s, c, v) {
  const jobs = v.jobs;
  if (c.job) jobs[c.job] = Math.max(0, jobs[c.job] - 1);
  const adults = Math.max(1, v.adults);
  const want = [0, 0, 0, 0, 0, 0];
  const k = s.kingdoms.get(v.kd);
  const isKing = k && k.king === c.id;
  if (k && k.wars.length && !isKing && warTargetFor(s, c)) {
    want[J.WAR] = Math.ceil(adults * Math.min(0.5, 0.25 * TRIBES[v.tribe].aggression));
  }
  if (v.project) want[J.BUILD] = Math.min(4, 1 + ((adults / 6) | 0));
  const foodLow = v.res.food < v.pop * 3 + 6;
  want[J.FOOD] = Math.max(1, Math.round(adults * (foodLow ? 0.45 : 0.22)));
  const rest = Math.max(0, adults - want[J.WAR] - want[J.BUILD] - want[J.FOOD]);
  const woodLow = v.res.wood < 12;
  const stoneShare = woodLow ? 0.2 : c.tribe === 3 ? 0.5 : v.level >= 2 ? 0.45 : 0.3;
  want[J.STONE] = Math.round(rest * stoneShare);
  want[J.WOOD] = rest - want[J.STONE];
  let best = J.WOOD;
  let bestGap = -Infinity;
  for (const j of [J.WAR, J.BUILD, J.FOOD, J.WOOD, J.STONE]) {
    if (j === J.WAR && isKing) continue;
    const gap = want[j] - jobs[j];
    if (gap > bestGap) {
      bestGap = gap;
      best = j;
    }
  }
  if (bestGap <= 0 && want[J.WAR] === 0) best = foodLow ? J.FOOD : rand(s) < 0.5 ? J.WOOD : J.STONE;
  c.job = best;
  jobs[best]++;
  return best;
}

// ---- planning -----------------------------------------------------------------------------------

function affordable(v, cost) {
  for (const key in cost) if ((v.res[key] || 0) < cost[key]) return false;
  return true;
}
function pay(v, cost) {
  for (const key in cost) v.res[key] -= cost[key];
}

function findSite(s, v, type) {
  const def = BDEF[type];
  let best = null;
  let bd = Infinity;
  for (let k = 0; k < 40; k++) {
    const a = rand(s) * Math.PI * 2;
    const d = 3.5 + rand(s) * Math.max(1, v.r - 2.5);
    const x = Math.round(v.x + Math.cos(a) * d - def.w / 2);
    const y = Math.round(v.y + Math.sin(a) * d - def.h / 2);
    if (!canPlace(s, x, y, def.w, def.h, v.id)) continue;
    let score = d;
    if (type === BT.FARM) {
      let grass = 0;
      for (let yy = y; yy < y + def.h; yy++) for (let xx = x; xx < x + def.w; xx++) if (s.tile[yy * s.w + xx] === T.GRASS) grass++;
      if (grass < 5) continue;
      score -= grass * 0.3;
    }
    if (type === BT.MINE) {
      let stony = 0;
      for (let m = 0; m < 12; m++) {
        const tx = x + randInt(s, 9) - 3;
        const ty = y + randInt(s, 9) - 3;
        if (tx >= 0 && ty >= 0 && tx < s.w && ty < s.h) {
          const t = s.tile[ty * s.w + tx];
          if (t === T.HILLS || t === T.MOUNTAIN || t === T.ORE) stony++;
        }
      }
      if (stony < 2) continue;
      score -= stony;
    }
    if (score < bd) {
      bd = score;
      best = { x, y };
    }
  }
  return best;
}

function startProject(s, v, type) {
  const site = findSite(s, v, type);
  if (!site) return false;
  pay(v, BDEF[type].cost);
  const b = placeBuilding(s, type, v, site.x, site.y, false);
  v.project = b.id;
  return true;
}

/** Decide what the village builds next (one project at a time). */
export function planBuilding(s, v) {
  if (v.project) {
    const p = s.buildings.get(v.project);
    if (p && p.prog < 1) return;
    v.project = 0;
  }
  const bc = v.bc;
  const req = LEVEL_REQ[v.level + 1];
  if (req && v.pop >= req.pop && v.res.wood >= req.wood && v.res.stone >= req.stone && v.res.ore >= req.ore) {
    const hall = s.buildings.get(v.hall);
    if (hall) {
      v.res.wood -= req.wood;
      v.res.stone -= req.stone;
      v.res.ore -= req.ore;
      hall.prog = 0;
      v.project = hall.id;
      return;
    }
  }
  const atWarNow = (s.kingdoms.get(v.kd)?.wars.length || 0) > 0;
  const options = [];
  if (v.pop >= v.housing - 1) options.push(v.level >= 3 ? BT.HOUSE : BT.HUT);
  if (bc[BT.FARM] < 1 + ((v.pop / 6) | 0) && v.res.food < v.pop * 4 + 10) options.push(BT.FARM);
  if (v.level >= 2 && bc[BT.TOWER] < v.level - 1 + (atWarNow ? 1 : 0)) options.push(BT.TOWER);
  if (v.level >= 2 && !bc[BT.GRANARY]) options.push(BT.GRANARY);
  if (!bc[BT.MINE] && ((v.tribe === 3 && v.level >= 2) || v.level >= 3)) options.push(BT.MINE);
  if (v.level >= 3 && !bc[BT.TEMPLE]) options.push(BT.TEMPLE);
  if (v.housing < v.pop + 5) options.push(v.level >= 3 ? BT.HOUSE : BT.HUT);
  for (const type of options) {
    if (v.level < BDEF[type].minLevel) continue;
    if (!affordable(v, BDEF[type].cost)) continue;
    if (startProject(s, v, type)) return;
  }
}

function sendSettlers(s, v) {
  const group = [];
  forEachNear(s, v.x, v.y, v.r + 4, (c) => {
    if (c.sp === SP.VILLAGER && c.vil === v.id && !c.child && c.job !== J.WAR && group.length < 4) group.push(c);
    return group.length >= 4;
  });
  if (group.length < 3) return;
  let tx = 0;
  let ty = 0;
  let ok = false;
  for (let k = 0; k < 10 && !ok; k++) {
    const a = rand(s) * Math.PI * 2;
    const d = 24 + rand(s) * 18;
    tx = Math.round(v.x + Math.cos(a) * d);
    ty = Math.round(v.y + Math.sin(a) * d);
    if (tx < 4 || ty < 4 || tx >= s.w - 4 || ty >= s.h - 4) continue;
    const i = ty * s.w + tx;
    ok = BUILDABLE[s.tile[i]] && !s.zone[i];
  }
  if (!ok) return;
  const band = newBand(s, group[0], v.kd, { settle: 1, tx, ty, from: v.id, wait: 0 });
  for (const c of group) {
    c.vil = 0;
    c.job = J.NONE;
    c.task = K.IDLE;
    c.band = band.id;
  }
  addEvent(s, `Settlers set out from ${v.name}`, { x: v.x, y: v.y, color: kcolor(s, v.kd), key: 'settle' + v.id, cooldown: TICKS_PER_YEAR });
  v.res.food -= 6;
}

function dailyVillage(s, v) {
  if (v.pop === 0) {
    v.empty++;
    if (v.empty >= 3) {
      destroyVillage(s, v, 'abandoned');
      return;
    }
  } else v.empty = 0;
  const cap = 40 + v.level * 15 + v.bc[BT.GRANARY] * 60;
  v.res.food -= v.pop * 0.06;
  // Farms ripen a stage per day.
  for (const id of v.blds) {
    const b = s.buildings.get(id);
    if (!b || b.type !== BT.FARM || b.prog < 1) continue;
    for (let yy = b.y; yy < b.y + b.h; yy++) {
      for (let xx = b.x; xx < b.x + b.w; xx++) {
        const i = yy * s.w + xx;
        if (s.tile[i] === T.FARM && s.aux[i] < 3) {
          s.aux[i]++;
          markDirtyIdx(s, i);
        }
      }
    }
  }
  if (v.res.food < 0) {
    v.res.food = 0;
    v.starving++;
    if (v.starving > 2) {
      forEachNear(s, v.x, v.y, v.r, (c) => {
        if (c.vil === v.id && rand(s) < 0.2) damage(s, c, 3, null, 'starvation');
        return false;
      });
    }
  } else v.starving = 0;
  for (const key of ['food', 'wood', 'stone']) if (v.res[key] > cap) v.res[key] = cap;
  if (v.pop < v.housing && v.adults >= 2 && v.res.food >= 6 && rand(s) < 0.5) {
    const c = spawnCreature(s, SP.VILLAGER, v.x + rand(s) * 2 - 1, v.y + 2.5, { tribe: v.tribe, child: true });
    if (c) {
      c.vil = v.id;
      c.kd = v.kd;
      v.res.food -= 2;
    }
  }
  planBuilding(s, v);
  const nr = 6 + v.level * 3 + Math.min(8, (v.blds.length * 0.5) | 0);
  if (nr > v.r) {
    v.r = nr;
    claimTerritory(s, v);
  }
  if (v.level >= 2 && v.pop >= v.housing - 1 && v.adults >= 8 && v.res.food > 12 && rand(s) < 0.08) sendSettlers(s, v);
  if (v.capture > 0 && s.tick - v.lastAttack > TICKS_PER_DAY) v.capture = Math.max(0, v.capture - 6);
  if (v.bc[BT.TEMPLE]) {
    forEachNear(s, v.x, v.y, v.r, (c) => {
      if (c.vil === v.id) c.hp = Math.min(c.mhp, c.hp + 4);
      return false;
    });
  }
  // Mines trickle stone (and sometimes ore).
  if (v.bc[BT.MINE]) {
    v.res.stone += 1;
    if (rand(s) < 0.3) v.res.ore += 1;
  }
}

function towerVolleys(s) {
  for (const b of s.buildings.values()) {
    if (b.type !== BT.TOWER || b.prog < 1) continue;
    if (b.cd > 0) {
      b.cd--;
      continue;
    }
    const v = s.villages.get(b.vil);
    if (!v) continue;
    const cx = b.x + 1.5;
    const cy = b.y + 1;
    let target = null;
    let bd = 81;
    forEachNear(s, cx, cy, 9, (c) => {
      const hostile = c.sp >= SP.ZOMBIE || (c.sp === SP.WOLF && c.hunger > 60) || (c.sp === SP.VILLAGER && atWar(s, v.kd, c.kd));
      if (!hostile) return false;
      const d = (c.x - cx) ** 2 + (c.y - cy) ** 2;
      if (d < bd) {
        bd = d;
        target = c;
      }
      return false;
    });
    if (target) {
      b.cd = 1;
      fx(s, { k: 'arrow', x0: cx, y0: cy - 4, x1: target.x, y1: target.y - 1 });
      sfx(s, 'arrow');
      damage(s, target, 5 + v.level * 3, null, 'arrows');
    }
  }
}

function dailyKingdom(s, k) {
  const vills = kingdomVillages(s, k.id);
  if (!vills.length) {
    kingdomFalls(s, k);
    return;
  }
  if (!s.villages.has(k.capital)) k.capital = vills[0].id;
  const king = s.byId.get(k.king);
  if (!king || king.dead || king.kd !== k.id || king.sp !== SP.VILLAGER) {
    let best = null;
    for (const c of s.creatures) {
      if (c.dead || c.kd !== k.id || c.child || c.sp !== SP.VILLAGER) continue;
      if (!best || c.born < best.born || c.vil === k.capital) best = c;
    }
    if (best) {
      const hadKing = !!k.king;
      k.king = best.id;
      if (hadKing) addEvent(s, `${best.name} was crowned ruler of the ${k.name}`, { x: best.x, y: best.y, color: k.color, kind: 'crown' });
    } else k.king = 0;
  }
}

export function declareWar(s, a, b) {
  if (a.wars.includes(b.id)) return;
  a.wars.push(b.id);
  b.wars.push(a.id);
  a.warT[b.id] = s.tick;
  b.warT[a.id] = s.tick;
  a.allies = a.allies.filter((id) => id !== b.id);
  b.allies = b.allies.filter((id) => id !== a.id);
  addEvent(s, `The ${a.name} declared war on the ${b.name}!`, { color: a.color, kind: 'war' });
  sfx(s, 'fight');
  for (const id of b.allies) {
    const ally = s.kingdoms.get(id);
    if (ally && !ally.wars.includes(a.id) && !ally.allies.includes(a.id)) {
      ally.wars.push(a.id);
      a.wars.push(ally.id);
      ally.warT[a.id] = s.tick;
      a.warT[ally.id] = s.tick;
      addEvent(s, `The ${ally.name} joins the war to defend its ally`, { color: ally.color, kind: 'war' });
    }
  }
}

export function makePeace(s, a, b) {
  a.wars = a.wars.filter((id) => id !== b.id);
  b.wars = b.wars.filter((id) => id !== a.id);
  a.op[b.id] = 5;
  b.op[a.id] = 5;
  addEvent(s, `The ${a.name} and the ${b.name} made peace`, { color: '#5fd35f', kind: 'peace' });
}

function diplomacy(s) {
  const ks = [...s.kingdoms.values()];
  if (ks.length < 2) return;
  const byK = new Map();
  for (const v of s.villages.values()) {
    if (!byK.has(v.kd)) byK.set(v.kd, []);
    byK.get(v.kd).push(v);
  }
  const popOf = (k) => (byK.get(k.id) || []).reduce((n, v) => n + v.adults, 0);
  for (let i = 0; i < ks.length; i++) {
    for (let j = i + 1; j < ks.length; j++) {
      const a = ks[i];
      const b = ks[j];
      const va = byK.get(a.id) || [];
      const vb = byK.get(b.id) || [];
      let d = Infinity;
      for (const x of va) for (const y of vb) d = Math.min(d, Math.hypot(x.x - y.x, x.y - y.y));
      const war = a.wars.includes(b.id);
      let op = a.op[b.id] || 0;
      if (d > 75 && !war) {
        op *= 0.9;
      } else {
        const ag = TRIBES[a.tribe].aggression + TRIBES[b.tribe].aggression - 2;
        let delta = (a.tribe === b.tribe ? 0.5 : -0.6) - ag * 0.9;
        if (d < 40) delta -= 1.2;
        if (a.allies.includes(b.id)) delta += 1;
        delta += (rand(s) - 0.5) * 2;
        op = clamp(op + delta, -100, 100);
      }
      a.op[b.id] = op;
      b.op[a.id] = op;
      if (!war) {
        const allied = a.allies.includes(b.id);
        const mature = s.tick - a.born > TICKS_PER_YEAR * 2 && s.tick - b.born > TICKS_PER_YEAR * 2;
        if (op < -30 && !allied && d < 75 && mature && rand(s) < 0.3 && Math.max(popOf(a), popOf(b)) >= 10) {
          const aggA = TRIBES[a.tribe].aggression;
          const aggB = TRIBES[b.tribe].aggression;
          if (aggA >= aggB) declareWar(s, a, b);
          else declareWar(s, b, a);
        } else if (op > 40 && !allied && rand(s) < 0.15) {
          a.allies.push(b.id);
          b.allies.push(a.id);
          addEvent(s, `The ${a.name} and the ${b.name} formed an alliance`, { color: '#4ae3ff', kind: 'ally' });
        } else if (allied && op < 0) {
          a.allies = a.allies.filter((id) => id !== b.id);
          b.allies = b.allies.filter((id) => id !== a.id);
        }
      } else {
        const dur = s.tick - (a.warT[b.id] || 0);
        const weak = Math.min(popOf(a), popOf(b)) < 3;
        if ((dur > 2 * TICKS_PER_YEAR && rand(s) < 0.08) || (weak && dur > TICKS_PER_YEAR / 2 && rand(s) < 0.2)) makePeace(s, a, b);
      }
    }
  }
}

function rebellions(s) {
  for (const k of [...s.kingdoms.values()]) {
    const vills = kingdomVillages(s, k.id);
    if (vills.length < 3) continue;
    const cap = s.villages.get(k.capital);
    for (const v of vills) {
      if (v.id === k.capital) continue;
      let p = 0.03;
      if (v.tribe !== k.tribe) p += 0.12;
      if (cap && Math.hypot(cap.x - v.x, cap.y - v.y) > 60) p += 0.05;
      if (rand(s) >= p) continue;
      const nk = createKingdom(s, v.tribe, v, true);
      v.kd = nk.id;
      for (const c of s.creatures) if (!c.dead && c.vil === v.id) c.kd = nk.id;
      s.bordersDirty = true;
      addEvent(s, `${v.name} rebelled against the ${k.name}!`, { x: v.x, y: v.y, color: nk.color, kind: 'rebel' });
      declareWar(s, k, nk);
      return;
    }
  }
}

/** Per-tick civilisation update (staggered daily work). */
export function stepCiv(s) {
  const t = s.tick;
  for (const v of [...s.villages.values()]) {
    if ((v.id * 7 + t) % TICKS_PER_DAY === 0) dailyVillage(s, v);
  }
  if (t % 12 === 5) towerVolleys(s);
  if (t % TICKS_PER_DAY === 11) for (const k of [...s.kingdoms.values()]) dailyKingdom(s, k);
  if (t % (TICKS_PER_DAY * 2) === 13) diplomacy(s);
  if (t % TICKS_PER_YEAR === 101) rebellions(s);
  if (t % (TICKS_PER_DAY * 3) === 17) {
    for (const [id, band] of s.bands) {
      const L = s.byId.get(band.leader);
      if (!L || L.dead || L.band !== id || (band.vid && t - band.t > TICKS_PER_DAY * 4)) s.bands.delete(id);
    }
  }
}

export { LEVEL_NAMES, H, IS_WATER };
