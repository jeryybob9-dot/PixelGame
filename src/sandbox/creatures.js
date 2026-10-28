// God Box — creatures: spawning, movement, AI and combat (pure, no DOM).
import {
  T, SP, SPECIES, TRIBES, J, RES, RES_KEYS, TR, TICKS_PER_YEAR, TICKS_PER_DAY, ADULT_YEARS, MAX_CREATURES,
  WALK, IS_WATER, STONY, BUILDABLE, BT,
} from './constants.js';
import { rand, randInt, randRange, addEvent, fx, sfx, forEachNear, findNearest, countNear, isAnimal, markDirtyIdx } from './state.js';
import { personName, animalName } from './names.js';
import * as civ from './civ.js';
import { ignite, igniteDisc, setTile } from './elements.js';

/** Creature task ids. */
export const K = Object.freeze({
  IDLE: 0, WANDER: 1, GOTO: 2, WORK: 3, RETURN: 4, BUILD: 5, FIGHT: 6, FLEE: 7, MARCH: 8, SETTLE: 9,
  FOLLOW: 10, BEAM: 11, BREATH: 12, FLY: 13,
});
export const TASK_NAMES = [
  'Idle', 'Wandering', 'Heading to work', 'Working', 'Carrying goods home', 'Building', 'Fighting', 'Fleeing',
  'Marching to war', 'Looking for new land', 'Travelling', 'Abducting', 'Breathing fire', 'Flying',
];

// ---- spawning -----------------------------------------------------------------------------------

/**
 * Create a creature. Returns null when caps are reached.
 * @param {object} s state
 * @param {number} sp species id
 * @param {number} x
 * @param {number} y
 * @param {{tribe?:number, child?:boolean, ageYears?:number}} [o]
 */
export function spawnCreature(s, sp, x, y, o = {}) {
  if (s.creatures.length >= MAX_CREATURES) return null;
  const def = SPECIES[sp];
  if (s.counts.sp[sp] >= def.cap) return null;
  const tribe = sp === SP.VILLAGER ? o.tribe ?? 0 : -1;
  const tdef = tribe >= 0 ? TRIBES[tribe] : null;
  let tr = 0;
  if (sp === SP.VILLAGER) {
    let n = 0;
    for (const bit of [TR.BRAVE, TR.STRONG, TR.FAST, TR.WISE, TR.LUCKY, TR.CURSED]) {
      if (n < 2 && rand(s) < (bit === TR.CURSED ? 0.04 : 0.11)) {
        tr |= bit;
        n++;
      }
    }
  }
  let hp = def.hp;
  let atk = def.atk;
  let spd = def.spd;
  if (tdef) {
    hp *= tdef.hpMul;
    atk *= tdef.atkMul;
    spd *= tdef.spdMul;
  }
  if (tr & TR.STRONG) atk *= 1.35;
  if (tr & TR.FAST) spd *= 1.25;
  if (tr & TR.CURSED) hp *= 0.75;
  let lifeY = randRange(s, def.life[0], def.life[1]);
  if (tr & TR.WISE) lifeY *= 1.2;
  if (tr & TR.CURSED) lifeY *= 0.7;
  const ageY = o.child ? 0 : o.ageYears ?? (sp === SP.VILLAGER ? randRange(s, ADULT_YEARS + 1, 24) : randRange(s, 1, def.life[0] * 0.4));
  const c = {
    id: s.nextId++, sp, x, y, tx: x, ty: y, hp, mhp: hp, atk, spd,
    born: s.tick - Math.round(ageY * TICKS_PER_YEAR), life: Math.round(lifeY * TICKS_PER_YEAR),
    tribe, vil: 0, kd: 0, band: 0, job: J.NONE, task: K.IDLE, tt: randInt(s, 20), tgt: 0, tv: 0,
    carry: 0, cn: 0, wx: 0, wy: 0, wk: 0, fish: 0, hunt: 0,
    name: sp === SP.VILLAGER ? personName(s, tribe) : animalName(s, def.key),
    tr, kills: 0, sick: 0, imm: 0, bless: 0, burn: 0, hunger: 0, inf: 0,
    dir: rand(s) < 0.5 ? -1 : 1, child: o.child ? 1 : 0, cd: 0, stuck: 0, side: rand(s) < 0.5 ? -1 : 1,
    fly: def.flying ? 1 : 0, aq: def.aquatic ? 1 : 0, low: 0, held: 0, mv: 0, dead: 0,
  };
  if (c.child) {
    c.hp = c.mhp = hp * 0.5;
    c.atk = atk * 0.3;
  }
  s.creatures.push(c);
  s.byId.set(c.id, c);
  s.counts.sp[sp]++;
  s.counts.total++;
  return c;
}

/** Spawn a band of villagers that will found (or join) a village together. */
export function spawnGroup(s, tribe, x, y, n = 6) {
  const out = [];
  let band = null;
  for (let k = 0; k < n; k++) {
    let px = x + randRange(s, -2, 2);
    let py = y + randRange(s, -2, 2);
    if (!walkable(s, px, py)) {
      px = x;
      py = y;
    }
    const c = spawnCreature(s, SP.VILLAGER, px, py, { tribe });
    if (!c) break;
    if (!band) band = civ.newBand(s, c, 0, { wait: 12 });
    c.band = band.id;
    out.push(c);
  }
  if (out.length) fx(s, { k: 'p', kind: 'gold', x, y, n: 10 });
  return out;
}

function growUp(c) {
  c.child = 0;
  c.mhp *= 2;
  c.hp = Math.min(c.mhp, c.hp + c.mhp / 2);
  c.atk /= 0.3;
}

// ---- movement -----------------------------------------------------------------------------------

export function walkable(s, x, y) {
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return false;
  return WALK[s.tile[(y | 0) * s.w + (x | 0)]] > 0;
}

export function canStand(s, c, x, y) {
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return false;
  if (c.fly) return true;
  const t = s.tile[(y | 0) * s.w + (x | 0)];
  if (c.aq) return t === T.DEEP || t === T.SHALLOW;
  if (WALK[t] <= 0) return false;
  if (t === T.LAVA || t === T.ACID) {
    const cur = s.tile[(c.y | 0) * s.w + (c.x | 0)];
    return cur === T.LAVA || cur === T.ACID;
  }
  return true;
}

const ROT = [0.8, 1.6, 2.4].map((a) => [Math.cos(a), Math.sin(a)]);

/** Step toward (tx,ty). Returns true on arrival. */
export function moveToward(s, c, tx, ty, mul = 1) {
  const dx = tx - c.x;
  const dy = ty - c.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.35) return true;
  let sp = c.spd * mul;
  if (!c.fly && !c.aq) {
    const t = s.tile[(c.y | 0) * s.w + (c.x | 0)];
    let wm = WALK[t] || 0.5;
    if (c.tribe === 3 && (t === T.HILLS || t === T.MOUNTAIN || t === T.SNOW || t === T.ORE)) wm = Math.min(1, wm * 2);
    if (c.tribe === 2 && t === T.FOREST) wm = 1;
    sp *= wm;
  }
  if (c.bless > 0) sp *= 1.3;
  if (c.sick > 0) sp *= 0.7;
  if (c.burn > 0) sp *= 1.4;
  if (sp > d) sp = d;
  const ux = dx / d;
  const uy = dy / d;
  c.dir = ux < 0 ? -1 : 1;
  c.mv = 1;
  let nx = c.x + ux * sp;
  let ny = c.y + uy * sp;
  if (canStand(s, c, nx, ny)) {
    c.x = nx;
    c.y = ny;
    if (c.stuck > 0) c.stuck--;
    return false;
  }
  for (const [cs, sn0] of ROT) {
    const sn = sn0 * c.side;
    const rx = ux * cs - uy * sn;
    const ry = ux * sn + uy * cs;
    nx = c.x + rx * sp;
    ny = c.y + ry * sp;
    if (canStand(s, c, nx, ny)) {
      c.x = nx;
      c.y = ny;
      c.stuck++;
      return false;
    }
  }
  c.side = -c.side;
  c.stuck += 3;
  return false;
}

function wanderNear(s, c, cx, cy, r) {
  for (let k = 0; k < 6; k++) {
    const x = cx + randRange(s, -r, r);
    const y = cy + randRange(s, -r, r);
    if (canStand(s, c, x, y)) {
      c.tx = x;
      c.ty = y;
      c.task = K.WANDER;
      return true;
    }
  }
  c.task = K.IDLE;
  return false;
}

function fleeFrom(s, c, e, dist = 7) {
  const dx = c.x - e.x;
  const dy = c.y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  c.tx = c.x + (dx / d) * dist + randRange(s, -2, 2);
  c.ty = c.y + (dy / d) * dist + randRange(s, -2, 2);
  c.task = K.FLEE;
  c.tt = 24;
  c.hunt = 0;
}

function fleeRandom(s, c, ticks) {
  c.tx = c.x + randRange(s, -6, 6);
  c.ty = c.y + randRange(s, -6, 6);
  c.task = K.FLEE;
  c.tt = ticks;
}

function startFight(c, e) {
  c.task = K.FIGHT;
  c.tgt = e.id;
}

// ---- combat -------------------------------------------------------------------------------------

export function weaponTier(s, c) {
  if (c.sp !== SP.VILLAGER) return 0;
  const v = c.vil ? s.villages.get(c.vil) : null;
  return v ? v.level - 1 : 0;
}

function attack(s, a, t) {
  let dmg = a.atk * (0.75 + rand(s) * 0.5);
  if (a.bless > 0) dmg *= 1.5;
  let tier = 0;
  if (a.sp === SP.VILLAGER) {
    tier = weaponTier(s, a);
    dmg *= 1 + tier * 0.35;
  }
  if (t.sp === SP.VILLAGER && weaponTier(s, t) >= 2) dmg *= 0.85;
  sfx(s, a.sp === SP.VILLAGER && tier >= 2 ? 'sword_slash' : 'melee_hit');
  fx(s, { k: 'p', kind: 'hit', x: t.x, y: t.y - 1.5, n: 2 });
  if (a.sp === SP.ZOMBIE && t.sp === SP.VILLAGER && !t.inf && rand(s) < 0.2) t.inf = 60;
  damage(s, t, dmg, a, 'battle');
}

const RETALIATES = new Set([SP.VILLAGER, SP.WOLF, SP.CRAB, SP.ZOMBIE, SP.SKELETON]);

/** Apply damage; src (creature or null) gets credit for a kill. */
export function damage(s, t, amt, src, cause = '') {
  if (t.dead || amt <= 0) return;
  if (t.tr & TR.LUCKY && rand(s) < 0.2) return;
  t.hp -= amt;
  t.hitT = s.tick;
  if (t.hp <= 0) {
    die(s, t, src, cause);
    return;
  }
  if (src && !src.dead && src !== t && t.task !== K.FIGHT && t.task !== K.BEAM && t.task !== K.BREATH) {
    if (RETALIATES.has(t.sp) && !t.child && !(src.fly && !src.low)) startFight(t, src);
    else if (!t.fly && !t.aq) fleeFrom(s, t, src);
  }
}

function titleOf(c) {
  if (c.tr & TR.BRAVE) return 'Brave';
  if (c.tr & TR.STRONG) return 'Strong';
  if (c.tr & TR.WISE) return 'Wise';
  return 'Mighty';
}

/** Kill a creature. Zombie bites turn villagers into zombies instead. */
export function die(s, c, killer, cause = '') {
  if (c.dead) return;
  if (c.sp === SP.VILLAGER && killer && killer.sp === SP.ZOMBIE) {
    killer.kills++;
    zombify(s, c);
    return;
  }
  c.dead = 1;
  c.hp = 0;
  if (killer && !killer.dead) {
    killer.kills++;
    if (killer.sp === SP.WOLF) killer.hunger = 0;
    if (killer.hunt && isAnimal(c)) {
      killer.hunt = 0;
      killer.carry = RES.FOOD;
      killer.cn = c.sp === SP.SHEEP ? 5 : 2;
      killer.task = K.RETURN;
    }
    if (killer.sp === SP.VILLAGER && killer.kills === 10) {
      addEvent(s, `${killer.name} the ${titleOf(killer)} has slain 10 foes`, { x: killer.x, y: killer.y, color: '#ffcf4a', kind: 'hero' });
    }
  }
  if (cause !== 'black hole' && cause !== 'abducted') {
    const kind = c.sp === SP.SKELETON ? 'bone' : c.sp === SP.FISH ? 'splash' : c.sp === SP.UFO ? 'spark' : 'blood';
    fx(s, { k: 'p', kind, x: c.x, y: c.y - 1, n: c.sp >= SP.DRAGON ? 16 : 4 });
    if (c.sp === SP.VILLAGER && rand(s) < 0.25) sfx(s, 'unit_die');
  }
  if (c.sp === SP.DRAGON) {
    addEvent(s, `The dragon ${c.name} ${cause === 'old age' ? 'died of old age' : 'was slain'}`, { x: c.x, y: c.y, color: '#ff8a2e', kind: 'monster' });
    if (cause !== 'old age') sfx(s, 'explosion_big');
  } else if (c.sp === SP.UFO) {
    addEvent(s, cause === 'old age' ? 'The UFO flew back to the stars' : 'The UFO was shot down!', { x: c.x, y: c.y, color: '#4ae3ff', kind: 'monster' });
  } else if (c.sp === SP.VILLAGER) {
    const k = c.kd ? s.kingdoms.get(c.kd) : null;
    if (k && k.king === c.id) {
      const why = cause === 'old age' ? 'died of old age' : cause === 'battle' ? 'fell in battle' : `was killed (${cause || 'misfortune'})`;
      addEvent(s, `Ruler ${c.name} of the ${k.name} ${why}`, { x: c.x, y: c.y, color: k.color, kind: 'death' });
      k.king = 0;
    } else if (c.kills >= 10) {
      addEvent(s, `The hero ${c.name} has died`, { x: c.x, y: c.y, color: '#ffcf4a', kind: 'death' });
    }
  }
}

export function zombify(s, c) {
  const v = c.vil ? s.villages.get(c.vil) : null;
  c.sp = SP.ZOMBIE;
  c.vil = 0;
  c.kd = 0;
  c.band = 0;
  c.job = J.NONE;
  c.task = K.IDLE;
  c.carry = 0;
  c.hp = c.mhp = 40;
  c.atk = 5;
  c.spd = 0.06;
  c.sick = 0;
  c.inf = 0;
  c.child = 0;
  c.bless = 0;
  c.name = 'Zombie ' + c.name;
  c.born = s.tick;
  c.life = 30 * TICKS_PER_YEAR;
  fx(s, { k: 'p', kind: 'plague', x: c.x, y: c.y - 1, n: 6 });
  sfx(s, 'zombie_infect');
  if (v) addEvent(s, `Zombies are spreading in ${v.name}!`, { x: c.x, y: c.y, color: '#7fd35f', key: 'zomb' + v.id, cooldown: TICKS_PER_YEAR, kind: 'monster' });
}

function infect(s, c) {
  if (c.sick || c.imm || c.sp !== SP.VILLAGER) return;
  c.sick = 220 + randInt(s, 200);
  const v = c.vil ? s.villages.get(c.vil) : null;
  if (v) addEvent(s, `Plague spreads in ${v.name}`, { x: c.x, y: c.y, color: '#a6e05a', key: 'plague' + v.id, cooldown: TICKS_PER_YEAR, kind: 'plague' });
}
export { infect };

// ---- statuses (each think) -------------------------------------------------------------------

function statusTick(s, c) {
  const i = (c.y | 0) * s.w + (c.x | 0);
  if (!c.fly) {
    const t = s.tile[i];
    if (c.aq) {
      if (!IS_WATER[t]) damage(s, c, 2, null, 'dry land');
    } else {
      if (t === T.LAVA) {
        damage(s, c, 10, null, 'lava');
        c.burn = 30;
      } else if (t === T.ACID) damage(s, c, 7, null, 'acid');
      else if (s.fire[i]) c.burn = Math.max(c.burn, 18);
      if (t === T.DEEP) damage(s, c, 3, null, 'drowning');
      if (IS_WATER[t]) c.burn = 0;
    }
    if (c.dead) return;
  }
  if (c.burn > 0) {
    c.burn -= 6;
    let dmg = 2.5;
    if (c.tribe === 1) dmg *= 0.5;
    if (c.sp === SP.ZOMBIE) dmg *= 2;
    if (c.sp === SP.DRAGON) dmg = 0;
    if (dmg) damage(s, c, dmg, null, 'fire');
    if (!c.fly && rand(s) < 0.25) ignite(s, i, 30);
    if (rand(s) < 0.5) fx(s, { k: 'p', kind: 'fire', x: c.x, y: c.y - 2, n: 1 });
    if (c.dead) return;
  }
  if (c.sick > 0) {
    c.sick -= 6;
    damage(s, c, c.tr & TR.WISE ? 0.25 : 0.5, null, 'plague');
    if (c.dead) return;
    if (rand(s) < 0.12) {
      const o = findNearest(s, c.x, c.y, 2.5, (o) => o !== c && o.sp === SP.VILLAGER && !o.sick && !o.imm);
      if (o) infect(s, o);
    }
    if (rand(s) < 0.15) fx(s, { k: 'p', kind: 'plague', x: c.x, y: c.y - 2, n: 1 });
    if (c.sick <= 0) {
      c.sick = 0;
      c.imm = TICKS_PER_YEAR * 2;
    }
  } else if (c.imm > 0) c.imm -= 6;
  if (c.bless > 0) {
    c.bless -= 6;
    if (c.hp < c.mhp) c.hp = Math.min(c.mhp, c.hp + 1);
  }
  if (c.inf > 0) {
    c.inf -= 6;
    if (c.inf <= 0) zombify(s, c);
  }
}

// ---- villagers ----------------------------------------------------------------------------------

function hostileTo(s, c, o) {
  if (o === c || o.dead || o.held) return false;
  switch (o.sp) {
    case SP.ZOMBIE:
    case SP.SKELETON:
      return true;
    case SP.DRAGON:
      return o.low === 1;
    case SP.WOLF:
      return o.task === K.FIGHT;
    case SP.VILLAGER:
      return civ.atWar(s, c.kd, o.kd);
    default:
      return false;
  }
}

function findTile(s, c, cx, cy, r, pred) {
  let best = -1;
  let bd = Infinity;
  for (let k = 0; k < 40; k++) {
    const a = rand(s) * 6.2832;
    const d = Math.sqrt(rand(s)) * r;
    const x = (cx + Math.cos(a) * d) | 0;
    const y = (cy + Math.sin(a) * d) | 0;
    if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
    const i = y * s.w + x;
    if (!pred(s.tile[i], i)) continue;
    const dd = (x - c.x) ** 2 + (y - c.y) ** 2;
    if (dd < bd) {
      bd = dd;
      best = i;
    }
  }
  return best;
}

function nearWater(s, i) {
  const w = s.w;
  const x = i % w;
  const y = (i / w) | 0;
  return (
    (x > 0 && IS_WATER[s.tile[i - 1]]) || (x < w - 1 && IS_WATER[s.tile[i + 1]]) ||
    (y > 0 && IS_WATER[s.tile[i - w]]) || (y < s.h - 1 && IS_WATER[s.tile[i + w]])
  );
}

function goWork(s, c, i, res, time, fish = 0) {
  c.wx = i % s.w;
  c.wy = (i / s.w) | 0;
  c.tx = c.wx + 0.5;
  c.ty = c.wy + 0.5;
  c.task = K.GOTO;
  c.wk = res;
  c.fish = fish;
  c.tt = time;
}

function startJob(s, c, v) {
  const r = v.r + 10;
  switch (c.job) {
    case J.WOOD: {
      const i = findTile(s, c, v.x, v.y, r, (t) => t === T.FOREST);
      if (i >= 0) return goWork(s, c, i, RES.WOOD, c.tribe === 2 ? 22 : 30);
      break;
    }
    case J.STONE: {
      const i = findTile(s, c, v.x, v.y, r + 4, (t) => STONY[t] === 1);
      if (i >= 0) return goWork(s, c, i, RES.STONE, c.tribe === 3 ? 26 : 40);
      break;
    }
    case J.FOOD: {
      const farm = findTile(s, c, v.x, v.y, v.r + 2, (t, i) => t === T.FARM && s.aux[i] >= 3 && s.zone[i] === v.id);
      if (farm >= 0) return goWork(s, c, farm, RES.FOOD, 18);
      const sheep = findNearest(s, c.x, c.y, 16, (o) => o.sp === SP.SHEEP && !o.child);
      if (sheep && rand(s) < 0.7) {
        c.hunt = 1;
        return startFight(c, sheep);
      }
      const shore = findTile(s, c, v.x, v.y, r, (t, i) => WALK[t] > 0 && !IS_WATER[t] && nearWater(s, i));
      if (shore >= 0) return goWork(s, c, shore, RES.FOOD, 36, 1);
      const grass = findTile(s, c, v.x, v.y, r, (t) => t === T.GRASS);
      if (grass >= 0) return goWork(s, c, grass, RES.FOOD, 30, 2);
      break;
    }
    case J.BUILD: {
      const b = s.buildings.get(v.project);
      if (b && b.prog < 1) {
        c.task = K.BUILD;
        c.tgt = b.id;
        c.tx = b.x + randRange(s, 0, b.w);
        c.ty = b.y + b.h + 0.4;
        return;
      }
      break;
    }
    case J.WAR: {
      const tv = civ.warTargetFor(s, c);
      if (tv) {
        c.tv = tv.id;
        c.task = K.MARCH;
        c.tx = tv.x + randRange(s, -3, 3);
        c.ty = tv.y + randRange(s, -3, 3);
        return;
      }
      break;
    }
    default:
      break;
  }
  c.job = J.NONE;
  wanderNear(s, c, v.x, v.y + 2, 6);
}

function finishWork(s, c) {
  const i = c.wy * s.w + c.wx;
  const t = s.tile[i];
  c.carry = 0;
  if (c.wk === RES.WOOD && t === T.FOREST) {
    c.carry = RES.WOOD;
    c.cn = 2;
    if (rand(s) < (c.tribe === 2 ? 0.04 : 0.14)) setTile(s, i, T.GRASS);
    if (c.tribe === 2 && rand(s) < 0.35) {
      const j = i + (randInt(s, 3) - 1) + (randInt(s, 3) - 1) * s.w;
      if (j >= 0 && j < s.n && s.tile[j] === T.GRASS && !s.bmap[j]) setTile(s, j, T.FOREST);
    }
  } else if (c.wk === RES.STONE && STONY[t]) {
    c.carry = RES.STONE;
    c.cn = 2;
    if (t === T.ORE) {
      c.carry = RES.ORE;
      c.cn = 1;
      if (rand(s) < 0.25) setTile(s, i, T.MOUNTAIN);
    } else if (t === T.MOUNTAIN && rand(s) < 0.1) {
      c.carry = RES.ORE;
      c.cn = 1;
    }
  } else if (c.wk === RES.FOOD) {
    if (t === T.FARM) {
      if (s.aux[i] >= 3) {
        s.aux[i] = 0;
        markDirtyIdx(s, i);
        c.carry = RES.FOOD;
        c.cn = 4;
        // Harvest the neighbouring ripe rows too.
        for (const j of [i - 1, i + 1, i - s.w, i + s.w]) {
          if (j >= 0 && j < s.n && s.tile[j] === T.FARM && s.aux[j] >= 3 && rand(s) < 0.6) {
            s.aux[j] = 0;
            markDirtyIdx(s, j);
            c.cn += 3;
          }
        }
      }
    } else if (c.fish === 1) {
      c.carry = RES.FOOD;
      c.cn = 3;
      fx(s, { k: 'p', kind: 'splash', x: c.x + c.dir, y: c.y, n: 2 });
    } else {
      c.carry = RES.FOOD;
      c.cn = 2;
    }
  }
  c.task = c.carry ? K.RETURN : K.IDLE;
}

function thinkNomad(s, c) {
  let band = s.bands.get(c.band);
  if (!band) {
    band = civ.newBand(s, c, c.kd);
    c.band = band.id;
  }
  if (band.vid) {
    const v = s.villages.get(band.vid);
    if (v) return civ.joinVillage(s, c, v);
    band.vid = 0;
  }
  if (!band.settle) {
    const v = civ.nearestVillage(s, c.x, c.y, 24, (v) => (c.kd ? v.kd === c.kd : v.tribe === c.tribe));
    if (v && v.pop < v.housing + 6) return civ.joinVillage(s, c, v);
  }
  let leader = s.byId.get(band.leader);
  if (!leader || leader.dead || leader.band !== band.id || leader.vil || leader.sp !== SP.VILLAGER) {
    band.leader = c.id;
    leader = c;
  }
  if (leader !== c) {
    c.task = K.FOLLOW;
    c.tx = leader.x + randRange(s, -2.5, 2.5);
    c.ty = leader.y + randRange(s, -2.5, 2.5);
    return;
  }
  if (band.settle && band.tx) {
    if (Math.hypot(c.x - band.tx, c.y - band.ty) > 3 && c.stuck < 40) {
      c.task = K.SETTLE;
      c.tx = band.tx;
      c.ty = band.ty;
      return;
    }
    band.tx = 0;
    band.t = s.tick - band.wait;
  }
  if (s.tick - band.t >= band.wait) {
    band.tries = (band.tries || 0) + 1;
    if (band.settle && band.tries > 4) band.settle = 0;
    // A lone wanderer only settles after searching for company for a few days.
    const company = countNear(s, c.x, c.y, 8, (o) => o.band === band.id && o.sp === SP.VILLAGER && !o.vil);
    const lonely = company < 2 && s.tick - (band.born ?? 0) < TICKS_PER_DAY * 4;
    const site = lonely ? null : civ.findVillageSite(s, c.x, c.y, 8);
    if (site) {
      const v = civ.foundVillage(s, c, site.x, site.y);
      if (v) {
        band.vid = v.id;
        band.t = s.tick;
        return;
      }
    }
    band.t = s.tick;
    band.wait = TICKS_PER_DAY;
    for (let k = 0; k < 8; k++) {
      const a = rand(s) * 6.2832;
      const d = randRange(s, 10, 22);
      const x = c.x + Math.cos(a) * d;
      const y = c.y + Math.sin(a) * d;
      if (x > 2 && y > 2 && x < s.w - 2 && y < s.h - 2 && BUILDABLE[s.tile[(y | 0) * s.w + (x | 0)]]) {
        c.task = K.SETTLE;
        c.tx = x;
        c.ty = y;
        c.stuck = 0;
        return;
      }
    }
  }
  if (c.task === K.IDLE) wanderNear(s, c, c.x, c.y, 4);
}

function thinkMarch(s, c) {
  const tv = s.villages.get(c.tv);
  if (!tv || !civ.atWar(s, c.kd, tv.kd)) {
    c.task = K.IDLE;
    c.job = J.NONE;
    return;
  }
  if (Math.hypot(c.x - tv.x, c.y - tv.y) < 7) {
    if (civ.siege(s, c, tv) && rand(s) < 0.15 && tv.blds.length > 1) {
      const b = s.buildings.get(tv.blds[1 + randInt(s, tv.blds.length - 1)]);
      if (b) civ.damageBuilding(s, b, 8, 'war');
    }
    c.tx = tv.x + randRange(s, -4, 4);
    c.ty = tv.y + randRange(s, -4, 4);
  }
}

function thinkVillager(s, c) {
  const v = c.vil ? s.villages.get(c.vil) : null;
  if (c.vil && !v) {
    c.vil = 0;
    c.job = J.NONE;
    c.task = K.IDLE;
  }
  if (c.child && s.tick - c.born >= ADULT_YEARS * TICKS_PER_YEAR) growUp(c);
  if (c.burn > 0 && c.task !== K.FLEE) return fleeRandom(s, c, 14);
  if (c.task !== K.FIGHT && c.task !== K.FLEE) {
    const range = c.job === J.WAR ? 8 : c.child ? 6 : 5;
    const e = findNearest(s, c.x, c.y, range, (o) => hostileTo(s, c, o));
    if (e) {
      if (c.child || (c.hp < c.mhp * 0.3 && !(c.tr & TR.BRAVE)) || (e.sp === SP.DRAGON && !(c.tr & TR.BRAVE))) return fleeFrom(s, c, e);
      c.hunt = 0;
      return startFight(c, e);
    }
  }
  const tk = c.task;
  if (tk === K.FIGHT || tk === K.FLEE) return;
  if (!c.vil) {
    if (tk === K.IDLE || tk === K.WANDER || tk === K.FOLLOW || tk === K.SETTLE) thinkNomad(s, c);
    return;
  }
  if (tk === K.MARCH) return thinkMarch(s, c);
  if (tk !== K.IDLE) return;
  if (c.child) return wanderNear(s, c, v.x, v.y + 2, 5);
  civ.pickJob(s, c, v);
  startJob(s, c, v);
}

// ---- animals & monsters ------------------------------------------------------------------------

function breed(s, c, chance, r, maxNear) {
  if (c.child || rand(s) >= chance) return;
  if (countNear(s, c.x, c.y, r, (o) => o.sp === c.sp) >= maxNear) return;
  spawnCreature(s, c.sp, c.x + randRange(s, -0.5, 0.5), c.y + randRange(s, -0.5, 0.5), { child: true });
}

function thinkSheep(s, c) {
  if (c.child && s.tick - c.born > TICKS_PER_YEAR) growUp(c);
  if (c.task !== K.FLEE) {
    const wolf = findNearest(s, c.x, c.y, 5, (o) => o.sp === SP.WOLF || o.sp === SP.ZOMBIE);
    if (wolf) return fleeFrom(s, c, wolf);
  }
  if (c.task === K.IDLE && rand(s) < 0.35) wanderNear(s, c, c.x, c.y, 4);
  breed(s, c, 0.005, 6, 5);
}

function thinkWolf(s, c) {
  if (c.child && s.tick - c.born > TICKS_PER_YEAR) growUp(c);
  c.hunger += 6;
  if (c.hunger > 520) damage(s, c, 1.5, null, 'starvation');
  if (c.task === K.FIGHT || c.dead) return;
  if (c.hunger > 80) {
    const prey = findNearest(
      s, c.x, c.y, c.hunger > 200 ? 26 : 14,
      (o) => o.sp === SP.SHEEP || o.sp === SP.CRAB || (c.hunger > 280 && o.sp === SP.VILLAGER && !o.vil),
    );
    if (prey) return startFight(c, prey);
    if (c.hunger > 150 && c.task === K.IDLE) {
      let best = null;
      let bd = Infinity;
      for (const o of s.creatures) {
        if (o.sp !== SP.SHEEP || o.dead) continue;
        const d = (o.x - c.x) ** 2 + (o.y - c.y) ** 2;
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      if (best) {
        const d = Math.sqrt(bd) || 1;
        const step = Math.min(d, 12);
        if (wanderNear(s, c, c.x + ((best.x - c.x) / d) * step, c.y + ((best.y - c.y) / d) * step, 2)) return;
      }
    }
  }
  if (c.task === K.IDLE) {
    const mate = findNearest(s, c.x, c.y, 14, (o) => o.sp === SP.WOLF && o !== c);
    if (mate && rand(s) < 0.5) wanderNear(s, c, mate.x, mate.y, 3);
    else wanderNear(s, c, c.x, c.y, 7);
  }
  if (c.hunger < 120 && s.counts.sp[SP.WOLF] < Math.max(6, s.counts.sp[SP.SHEEP] / 4)) breed(s, c, 0.05, 8, 5);
}

function thinkCrab(s, c) {
  if (c.child && s.tick - c.born > TICKS_PER_YEAR) growUp(c);
  if (c.task === K.FIGHT) return;
  if (c.task === K.IDLE && rand(s) < 0.4) {
    let ok = false;
    for (let k = 0; k < 6 && !ok; k++) {
      const x = c.x + randRange(s, -4, 4);
      const y = c.y + randRange(s, -4, 4);
      if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
      const t = s.tile[(y | 0) * s.w + (x | 0)];
      if (t === T.SAND || (t === T.SHALLOW && rand(s) < 0.3) || k === 5) {
        if (canStand(s, c, x, y)) {
          c.tx = x;
          c.ty = y;
          c.task = K.WANDER;
          ok = true;
        }
      }
    }
  }
  breed(s, c, 0.004, 6, 6);
}

function thinkFish(s, c) {
  if (c.child && s.tick - c.born > TICKS_PER_YEAR / 2) growUp(c);
  if (c.task === K.IDLE) wanderNear(s, c, c.x, c.y, 5);
  breed(s, c, 0.006, 5, 8);
}

function thinkUndead(s, c) {
  if (c.task === K.FIGHT) return;
  const zombie = c.sp === SP.ZOMBIE;
  const prey = findNearest(s, c.x, c.y, zombie ? 10 : 12, (o) => o.sp === SP.VILLAGER || (zombie && o.sp === SP.SHEEP));
  if (prey) return startFight(c, prey);
  if (c.task === K.IDLE) wanderNear(s, c, c.x, c.y, 6);
}

function thinkDragon(s, c) {
  if (c.task === K.BREATH || c.task === K.FLY) {
    if (c.task === K.FLY && rand(s) < 0.01) c.task = K.IDLE;
    else return;
  }
  if (c.task !== K.IDLE) return;
  if (rand(s) < 0.35) {
    const opts = [];
    for (const v of s.villages.values()) if (Math.hypot(v.x - c.x, v.y - c.y) < 70) opts.push(v);
    if (opts.length) {
      const v = opts[randInt(s, opts.length)];
      c.task = K.FLY;
      c.tv = v.id;
      c.tx = v.x + randRange(s, -5, 5);
      c.ty = v.y + randRange(s, -5, 5);
      return;
    }
    const prey = findNearest(s, c.x, c.y, 40, (o) => !o.fly && !o.aq && o.sp !== SP.DRAGON);
    if (prey) {
      c.task = K.FLY;
      c.tv = 0;
      c.tx = prey.x;
      c.ty = prey.y;
      return;
    }
  }
  const x = Math.max(2, Math.min(s.w - 2, c.x + randRange(s, -30, 30)));
  const y = Math.max(2, Math.min(s.h - 2, c.y + randRange(s, -30, 30)));
  c.task = K.WANDER;
  c.tx = x;
  c.ty = y;
}

function dragonBreath(s, c) {
  c.tt--;
  moveToward(s, c, c.x + c.dir, c.y, 0.25);
  if (c.tt % 3 === 0) {
    const px = c.x + c.dir * 2.5;
    const py = c.y + 2;
    igniteDisc(s, px, py, 2.2, 0.3, 60);
    fx(s, { k: 'p', kind: 'fire', x: px, y: py - 1, n: 5 });
    forEachNear(s, px, py, 2.6, (o) => {
      if (o !== c && !o.fly) {
        damage(s, o, 5, c, 'dragon fire');
        o.burn = Math.max(o.burn, 18);
      }
      return false;
    });
    for (let k = 0; k < 3; k++) {
      const x = (px + randRange(s, -2, 2)) | 0;
      const y = (py + randRange(s, -2, 2)) | 0;
      if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
      const bid = s.bmap[y * s.w + x];
      if (bid) {
        const b = s.buildings.get(bid);
        if (b) civ.damageBuilding(s, b, 5, 'dragon');
      }
    }
  }
  if (c.tt <= 0) {
    c.low = 0;
    // Fly off and rest before the next attack.
    c.task = K.WANDER;
    c.tx = Math.max(2, Math.min(s.w - 2, c.x + randRange(s, -40, 40)));
    c.ty = Math.max(2, Math.min(s.h - 2, c.y + randRange(s, -40, 40)));
  }
}

function thinkUfo(s, c) {
  if (c.task === K.BEAM || (c.task === K.FLY && c.tgt)) return;
  if (rand(s) < 0.45) {
    const t = findNearest(s, c.x, c.y, 34, (o) => (o.sp === SP.VILLAGER || o.sp === SP.SHEEP || o.sp === SP.WOLF || o.sp === SP.CRAB) && !o.held);
    if (t) {
      c.task = K.FLY;
      c.tgt = t.id;
      return;
    }
  }
  if (c.task === K.IDLE) {
    c.task = K.WANDER;
    c.tx = Math.max(2, Math.min(s.w - 2, c.x + randRange(s, -20, 20)));
    c.ty = Math.max(2, Math.min(s.h - 2, c.y + randRange(s, -20, 20)));
  }
}

// ---- per-tick task execution ------------------------------------------------------------------

function fightAct(s, c) {
  const t = s.byId.get(c.tgt);
  if (!t || t.dead || t.held || (t.fly && !t.low && !c.fly)) {
    c.task = K.IDLE;
    c.tgt = 0;
    c.hunt = 0;
    return;
  }
  const dx = t.x - c.x;
  const dy = t.y - c.y;
  const d = Math.hypot(dx, dy);
  if (d > 1.15) {
    if (d > 18) {
      c.task = K.IDLE;
      c.hunt = 0;
      return;
    }
    moveToward(s, c, t.x, t.y, 1.1);
    return;
  }
  c.dir = dx < 0 ? -1 : 1;
  if (c.cd > 0) return;
  c.cd = c.sp === SP.VILLAGER ? 10 : 12;
  attack(s, c, t);
}

function act(s, c) {
  if (c.stuck > 60) {
    c.stuck = 0;
    c.task = K.IDLE;
    c.hunt = 0;
    const band = c.band && !c.vil ? s.bands.get(c.band) : null;
    if (band && band.leader === c.id) band.tx = 0;
    return;
  }
  switch (c.task) {
    case K.IDLE:
      return;
    case K.WANDER:
      if (moveToward(s, c, c.tx, c.ty, 0.6)) c.task = K.IDLE;
      break;
    case K.FOLLOW:
      if (moveToward(s, c, c.tx, c.ty, 0.9)) c.task = K.IDLE;
      break;
    case K.SETTLE:
      if (moveToward(s, c, c.tx, c.ty)) c.task = K.IDLE;
      break;
    case K.GOTO:
      if (moveToward(s, c, c.tx, c.ty)) c.task = K.WORK;
      break;
    case K.WORK:
      if (--c.tt <= 0) finishWork(s, c);
      else if (c.tt % 9 === 0) {
        fx(s, { k: 'p', kind: c.wk === RES.STONE ? 'chip' : c.wk === RES.WOOD ? 'wood' : 'leaf', x: c.x + c.dir * 0.8, y: c.y - 1, n: 1 });
        if (c.wk === RES.STONE && rand(s) < 0.1) sfx(s, 'mine_pick');
      }
      return;
    case K.RETURN: {
      const v = c.vil ? s.villages.get(c.vil) : null;
      if (!v) {
        c.task = K.IDLE;
        c.carry = 0;
        return;
      }
      if (moveToward(s, c, v.x, v.y + 2.8)) {
        v.res[RES_KEYS[c.carry]] += c.cn;
        c.carry = 0;
        c.cn = 0;
        c.task = K.IDLE;
      }
      break;
    }
    case K.BUILD: {
      const b = s.buildings.get(c.tgt);
      if (!b || b.prog >= 1) {
        c.task = K.IDLE;
        return;
      }
      if (!moveToward(s, c, c.tx, c.ty)) break;
      c.dir = b.x + b.w / 2 < c.x ? -1 : 1;
      const v = s.villages.get(b.vil);
      let rate = 0.0035 * TRIBES[c.tribe].build * (c.tr & TR.WISE ? 1.25 : 1);
      if (b.type === BT.HALL) rate /= 1.5 + (v ? v.level : 1);
      b.prog += rate;
      if (s.tick % 14 === 0) fx(s, { k: 'p', kind: 'dust', x: b.x + rand(s) * b.w, y: b.y + b.h - rand(s) * 2, n: 1 });
      if (b.prog >= 1) {
        civ.completeBuilding(s, b);
        c.task = K.IDLE;
      }
      return;
    }
    case K.FIGHT:
      fightAct(s, c);
      return;
    case K.FLEE:
      moveToward(s, c, c.tx, c.ty, 1.15);
      if (--c.tt <= 0) c.task = K.IDLE;
      break;
    case K.MARCH:
      if (moveToward(s, c, c.tx, c.ty)) {
        c.tx += randRange(s, -1, 1);
        c.ty += randRange(s, -1, 1);
      }
      break;
    case K.FLY: {
      if (c.sp === SP.UFO && c.tgt) {
        const t = s.byId.get(c.tgt);
        if (!t || t.dead || t.held) {
          c.task = K.IDLE;
          c.tgt = 0;
          return;
        }
        if (moveToward(s, c, t.x, t.y)) {
          c.task = K.BEAM;
          c.tt = 45;
          t.held = c.id;
          sfx(s, 'ufo');
        }
        return;
      }
      if (moveToward(s, c, c.tx, c.ty)) {
        if (c.sp === SP.DRAGON) {
          c.task = K.BREATH;
          c.tt = 36;
          c.low = 1;
          sfx(s, 'dragon_roar');
          const v = s.villages.get(c.tv);
          if (v) addEvent(s, `A dragon is attacking ${v.name}!`, { x: v.x, y: v.y, color: '#ff8a2e', key: 'drg' + v.id, cooldown: TICKS_PER_YEAR, kind: 'monster' });
        } else c.task = K.IDLE;
      }
      return;
    }
    case K.BREATH:
      dragonBreath(s, c);
      return;
    case K.BEAM: {
      const t = s.byId.get(c.tgt);
      if (!t || t.dead) {
        c.task = K.IDLE;
        c.tgt = 0;
        return;
      }
      t.held = c.id;
      if (--c.tt <= 0) {
        fx(s, { k: 'p', kind: 'magic', x: t.x, y: t.y - 4, n: 8 });
        if (t.sp === SP.VILLAGER) addEvent(s, `The UFO abducted ${t.name}!`, { x: t.x, y: t.y, color: '#4ae3ff', key: 'ufo', cooldown: TICKS_PER_DAY * 6, kind: 'monster' });
        die(s, t, null, 'abducted');
        c.kills++;
        c.task = K.IDLE;
        c.tgt = 0;
      }
      return;
    }
    default:
      c.task = K.IDLE;
      return;
  }
}

/** Per-tick update; `think` is true on this creature's staggered decision tick. */
export function updateCreature(s, c, think) {
  if (c.cd > 0) c.cd--;
  c.mv = 0;
  if (c.held) {
    const u = s.byId.get(c.held);
    if (u && !u.dead && u.task === K.BEAM && u.tgt === c.id) return;
    c.held = 0;
  }
  if (think) {
    if (s.tick - c.born > c.life) {
      die(s, c, null, 'old age');
      return;
    }
    statusTick(s, c);
    if (c.dead) return;
    switch (c.sp) {
      case SP.VILLAGER:
        thinkVillager(s, c);
        break;
      case SP.SHEEP:
        thinkSheep(s, c);
        break;
      case SP.WOLF:
        thinkWolf(s, c);
        break;
      case SP.CRAB:
        thinkCrab(s, c);
        break;
      case SP.FISH:
        thinkFish(s, c);
        break;
      case SP.ZOMBIE:
      case SP.SKELETON:
        thinkUndead(s, c);
        break;
      case SP.DRAGON:
        thinkDragon(s, c);
        break;
      case SP.UFO:
        thinkUfo(s, c);
        break;
      default:
        break;
    }
    if (c.dead) return;
  }
  act(s, c);
}

export { J, RES, TICKS_PER_DAY };
