// Troop, building and tower behaviour: targeting, movement with bridge pathing, attacks and specials.

import { dist, dist2, clamp, angleTo } from '../core/util.js';
import { RIVER_TOP, RIVER_BOTTOM, BRIDGES, inRiver, onBridge, sideOf } from './constants.js';
import {
  canTarget, statusMult, isDisabled, damage, heal, fireProjectile, railShot, coneHit, chainZap, isBuildingKind, kill,
} from './combat.js';

const SIGHT = 5.5;

/** Distance between edges of two entities. */
export const edgeDist = (a, b) => dist(a.x, a.y, b.x, b.y) - a.r - b.r;

export function findTarget(B, e, sight = SIGHT) {
  let best = null;
  let bestD = Infinity;
  const buildingsOnly = e.targets === 'buildings';
  for (const o of B.entities) {
    if (!canTarget(e, o)) continue;
    if (o.isWall && !buildingsOnly) {
      // walls are only worth attacking when they are right in the way
      if (edgeDist(e, o) > 0.6) continue;
    }
    const d = edgeDist(e, o);
    const reach = buildingsOnly ? 99 : Math.max(sight, e.range + 0.5);
    if (d > reach) continue;
    // prefer units over buildings slightly so troops defend
    const score = d + (isBuildingKind(o) && !buildingsOnly ? 0.75 : 0);
    if (score < bestD) {
      bestD = score;
      best = o;
    }
  }
  return best;
}

/** Default destination when nothing is in sight (the map decides; lane arena: the enemy tower on this lane). */
export function laneGoal(B, e) {
  if (B.unitGoal) return B.unitGoal(e);
  const enemy = 1 - e.team;
  const towers = B.towers.filter((t) => t.team === enemy && t.alive);
  if (!towers.length) {
    // siege waves: defenders hold the river line, attackers go for the king
    return { x: clamp(e.x, 2, B.W - 2), y: e.team === 0 ? RIVER_BOTTOM + 1.6 : RIVER_TOP - 1 };
  }
  const leftLane = e.x < B.W / 2;
  const princess = towers.find((t) => t.type === 'princess' && (t.side === 'left') === leftLane);
  const goal = princess || towers.find((t) => t.type === 'king') || towers[0];
  return goal;
}

/** Waypoint toward (tx, ty): the map decides (lane arena: route ground units over a bridge when needed). */
export function routeTo(B, e, tx, ty) {
  if (B.routeTo) return B.routeTo(e, tx, ty);
  return laneRoute(e, tx, ty);
}

function laneRoute(e, tx, ty) {
  if (e.flying || e.special?.jumpsRiver || e.jumping) return { x: tx, y: ty };
  const s0 = sideOf(e.y);
  const s1 = sideOf(ty);
  const bridge = onBridge(e.x);
  if (s0 === -1) {
    // in the river band: must be on a bridge; walk straight across toward the target side
    const b = bridge || nearestBridge(e.x);
    const exitY = ty < e.y ? RIVER_TOP - 0.3 : RIVER_BOTTOM + 0.3;
    return { x: b.cx, y: exitY };
  }
  if (s0 === s1 || s1 === -1 && false) return { x: tx, y: ty };
  if (s1 === -1) {
    // target stands on a bridge
    return { x: tx, y: ty };
  }
  // need to cross: choose the bridge with the shortest total trip
  let best = BRIDGES[0];
  let bestCost = Infinity;
  for (const b of BRIDGES) {
    const c = Math.abs(e.x - b.cx) + Math.abs(tx - b.cx);
    if (c < bestCost) {
      bestCost = c;
      best = b;
    }
  }
  const entryY = s0 === 0 ? RIVER_BOTTOM + 0.2 : RIVER_TOP - 0.2;
  if (Math.abs(e.x - best.cx) < 0.7 && Math.abs(e.y - entryY) < 1.2) return { x: best.cx, y: s0 === 0 ? RIVER_TOP - 0.4 : RIVER_BOTTOM + 0.4 };
  return { x: best.cx, y: entryY };
}

function nearestBridge(x) {
  return Math.abs(x - BRIDGES[0].cx) < Math.abs(x - BRIDGES[1].cx) ? BRIDGES[0] : BRIDGES[1];
}

/** Move toward a point at the unit's speed; returns true if it moved. */
export function moveToward(B, e, tx, ty, dt, stopDist = 0.05) {
  const wp = routeTo(B, e, tx, ty);
  const routed = wp.x !== tx || wp.y !== ty;
  const d = dist(e.x, e.y, wp.x, wp.y);
  if (d <= (routed ? 0.05 : stopDist)) return false;
  const sp = e.speed * statusMult(e) * dt;
  const step = Math.min(sp, d);
  const nx = (wp.x - e.x) / d;
  const ny = (wp.y - e.y) / d;
  e.x += nx * step;
  e.y += ny * step;
  if (Math.abs(nx) > 0.2) e.facing = nx < 0 ? -1 : 1;
  e.moving = true;
  return true;
}

/** Keep units inside the map and ground units off impassable terrain (lane arena: the river except bridges). */
export function constrain(B, e) {
  e.x = clamp(e.x, e.r * 0.6, B.W - e.r * 0.6);
  e.y = clamp(e.y, e.r * 0.6, B.H - e.r * 0.6);
  if (B.constrain) {
    B.constrain(e);
    return;
  }
  if (e.flying || e.special?.jumpsRiver || e.jumping || e.kind === 'tower' || e.kind === 'building') return;
  if (inRiver(e.y) && !onBridge(e.x)) {
    const b = nearestBridge(e.x);
    // if close to a bridge column, slide onto it; otherwise push back to the nearest bank
    if (Math.abs(e.x - b.cx) < 1.9) e.x = clamp(e.x, b.x0 + 0.2, b.x1 - 0.2);
    else e.y = e.y < (RIVER_TOP + RIVER_BOTTOM) / 2 ? RIVER_TOP : RIVER_BOTTOM;
  }
}

/** Soft separation between overlapping units, plus static push-out from buildings. */
export function separate(B) {
  const list = B.entities;
  // sort-and-sweep along x so big maps with many units stay cheap
  const arr = sepBuf;
  arr.length = 0;
  let maxR = 0;
  for (const e of list) {
    if (!e.alive || e.noCollide) continue;
    arr.push(e);
    if (e.r > maxR) maxR = e.r;
  }
  arr.sort(byX);
  const n = arr.length;
  for (let i = 0; i < n; i++) {
    const a = arr[i];
    const reach = a.r + maxR;
    for (let j = i + 1; j < n; j++) {
      const b = arr[j];
      if (b.x - a.x > reach) break;
      if (a.flying !== b.flying) continue;
      const aStatic = a.kind === 'tower' || a.kind === 'building';
      const bStatic = b.kind === 'tower' || b.kind === 'building';
      if (aStatic && bStatic) continue;
      const rr = a.r + b.r;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const overlap = (rr - d) * (aStatic || bStatic ? 1 : 0.5);
      const nx = dx / d;
      const ny = dy / d;
      if (aStatic) {
        b.x += nx * overlap;
        b.y += ny * overlap;
        if (a.isWall && b.team !== a.team && b.kind === 'troop' && !b.flying) b.blockedBy = a;
      } else if (bStatic) {
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        if (b.isWall && a.team !== b.team && a.kind === 'troop' && !a.flying) a.blockedBy = b;
      } else {
        const ma = a.mass || 1;
        const mb = b.mass || 1;
        const wa = mb / (ma + mb);
        const wb = ma / (ma + mb);
        a.x -= nx * overlap * wa * 2;
        a.y -= ny * overlap * wa * 2;
        b.x += nx * overlap * wb * 2;
        b.y += ny * overlap * wb * 2;
      }
    }
  }
  for (const e of arr) if (e.alive && e.kind !== 'tower' && e.kind !== 'building') constrain(B, e);
  arr.length = 0;
}
const sepBuf = [];
const byX = (a, b) => a.x - b.x;

// ───────────────────────── troops ─────────────────────────

export function updateTroop(B, e, dt) {
  e.age += dt;
  e.moving = false;
  if (e.deployT > 0) {
    e.deployT -= dt;
    return;
  }
  if (isDisabled(e)) return;
  const sp = e.special || {};

  if (sp.hatch) {
    e.hatchT = (e.hatchT ?? sp.hatch) - dt;
    if (e.hatchT <= 0) {
      e.alive = false;
      const u = B.spawnUnit(e.team, e.hatchCard || 'phoenix', e.x, e.y, e.level, { deployT: 0.3, noRebirth: true });
      if (u) B.puff(e.x, e.y - 0.5, '#ffb347', 14);
      B.sfx('fire_ignite');
    }
    return;
  }

  if (sp.builder) {
    updateBuilder(B, e, dt);
    return;
  }

  if (sp.heal) {
    e.healT = (e.healT || 0) - dt;
    if (e.healT <= 0) {
      e.healT = 0.5;
      let any = false;
      for (const o of B.entities) {
        if (!o.alive || o.team !== e.team || o === e || isBuildingKind(o)) continue;
        if (dist2(o.x, o.y, e.x, e.y) <= sp.heal.radius * sp.heal.radius && o.hp < o.maxHp) {
          heal(B, o, sp.heal.hps * 0.5 * e.lvlMult, true);
          any = true;
        }
      }
      if (any) B.sparkle(e.x, e.y, sp.heal.radius * 0.6, '#9dffb0', 3);
    }
  }

  if (sp.summon) {
    e.summonT = (e.summonT ?? 2) - dt;
    if (e.summonT <= 0) {
      e.summonT = sp.summon.every;
      for (let i = 0; i < sp.summon.count; i++) {
        const a = Math.random() * Math.PI * 2;
        B.spawnUnit(e.team, sp.summon.card || sp.summon.unit, e.x + Math.cos(a) * 0.8, e.y + Math.sin(a) * 0.8, e.level, { deployT: 0.4 });
      }
      B.puff(e.x, e.y - 0.6, '#b58cff', 6);
      B.sfx('magic', { volume: 0.5 });
    }
  }

  if (sp.abduct) {
    e.abductT = (e.abductT ?? sp.abduct.every * 0.6) - dt;
    if (e.abductT <= 0) {
      let victim = null;
      for (const o of B.entities) {
        if (!o.alive || o.team === e.team || o.kind !== 'troop' || o.untargetable) continue;
        if (o.hp > sp.abduct.maxHp * e.lvlMult) continue;
        if (dist2(o.x, o.y, e.x, e.y) <= 3.2 * 3.2) {
          victim = o;
          break;
        }
      }
      if (victim) {
        e.abductT = sp.abduct.every;
        B.beam(e.x, e.y - 1.2, victim.x, victim.y, '#b9ff7a', 0.6, 5);
        B.sfx('ufo');
        victim.noBounty = false;
        kill(B, victim, e);
        B.sparkle(victim.x, victim.y, 0.6, '#d8ff9a', 8);
      } else e.abductT = 0.5;
    }
  }

  // blocked by an enemy wall? smash it
  if (e.blockedBy && e.blockedBy.alive && e.targets !== 'none') {
    if (!e.target || !e.target.alive || edgeDist(e, e.target) > e.range + 0.2) e.target = e.blockedBy;
  }
  e.blockedBy = null;

  // retarget
  e.retargetT -= dt;
  const t = e.target;
  const keep = t && t.alive && canTarget(e, t) && (e.locked ? edgeDist(e, t) <= e.range + 1.2 : true);
  if (!keep || e.retargetT <= 0) {
    if (!e.locked || !keep) {
      const nt = findTarget(B, e);
      if (nt !== e.target) {
        e.target = nt;
        e.locked = false;
        e.attackCd = Math.max(e.attackCd, e.firstHit);
      }
    }
    e.retargetT = 0.3;
  }

  // ninja dash
  if (sp.dash && e.target && e.target.alive) {
    e.dashT = (e.dashT || 0) - dt;
    const d = edgeDist(e, e.target);
    if (e.dashT <= 0 && d > e.range + 0.3 && d < sp.dash && !e.target.flying) {
      const a = angleTo(e.target.x, e.target.y, e.x, e.y);
      B.trail(e.x, e.y, e.target.x + Math.cos(a) * (e.r + e.target.r), e.target.y + Math.sin(a) * (e.r + e.target.r), '#6b5bd6');
      e.x = e.target.x + Math.cos(a) * (e.r + e.target.r + 0.1);
      e.y = e.target.y + Math.sin(a) * (e.r + e.target.r + 0.1);
      e.dashT = 3;
      e.attackCd = 0.1;
      B.sfx('sword_slash', { pitch: 1.3, volume: 0.6 });
    }
  }

  const tgt = e.target;
  if (tgt && tgt.alive) {
    const d = edgeDist(e, tgt);
    if (d <= e.range) {
      e.locked = true;
      e.facing = tgt.x < e.x ? -1 : 1;
      attack(B, e, tgt, dt);
      return;
    }
    e.spin = 0;
    moveToward(B, e, tgt.x, tgt.y, dt, 0);
    e.anim = 'walk';
    return;
  }
  e.spin = 0;
  const goal = laneGoal(B, e);
  if (moveToward(B, e, goal.x, goal.y, dt, goal.r ? goal.r + e.r : 0.3)) e.anim = 'walk';
  else e.anim = 'idle';
}

function attack(B, e, tgt, dt) {
  e.attackCd -= dt * statusMult(e);
  const sp = e.special || {};
  let interval = e.hs;
  if (sp.spinup) {
    e.spin = Math.min(sp.spinup, (e.spin || 0) + dt);
    interval = e.hs + (1 - e.spin / sp.spinup) * 0.45;
  }
  if (e.anim !== 'attack' || e.attackAnimT <= 0) e.anim = 'idle';
  if (e.attackAnimT > 0) e.attackAnimT -= dt;
  if (e.attackCd > 0) return;
  e.attackCd += interval;
  if (e.attackCd < 0) e.attackCd = interval;
  e.anim = 'attack';
  e.attackAnimT = Math.min(0.35, interval * 0.8);
  if (sp.stealth && e.status.invisible > 0) {
    e.status.invisible = 0;
    e.untargetable = false;
  }
  performHit(B, e, tgt);
}

/** One attack from a troop or building. */
export function performHit(B, e, tgt) {
  const sp = e.special || {};
  const dmg = e.dmg;
  const fx = e.effects;
  if (sp.kamikaze) {
    for (const o of B.entities) {
      if (!o.alive || o.team === e.team || o.flying || o.untargetable) continue;
      if (dist2(o.x, o.y, e.x, e.y) <= (e.splash + o.r * 0.5) ** 2) damage(B, o, o.kind === 'tower' ? dmg * 0.8 : dmg, { source: e });
    }
    B.explosion(e.x, e.y, e.splash, '#ffd166');
    B.sfx('sheep', { volume: 0.8, pitch: 1.1 });
    B.sfx('explosion_small', { volume: 0.6 });
    e.noBounty = true;
    kill(B, e, null);
    return;
  }
  const ox = e.x;
  const oy = e.y - e.h * 0.55;
  const buildingMult = sp.buildingMult && isBuildingKind(tgt) ? sp.buildingMult : 1;
  switch (e.proj) {
    case 'rail':
      railShot(B, e, ox, oy, angleTo(ox, oy, tgt.x, tgt.y - (tgt.flying ? 0.9 : 0.3)), e.range + 1, dmg, { hitAir: e.targets === 'both', effects: fx });
      B.sfx('shoot_sniper', { volume: 0.7 });
      break;
    case 'laser':
      B.beam(ox, oy + (e.flying ? 0.2 : 0), tgt.x, tgt.y - (tgt.flying ? 0.9 : 0.3), '#7dff6a', 0.12, 1);
      damage(B, tgt, dmg * buildingMult, { source: e, effects: fx });
      B.sfx('shoot_laser', { volume: 0.35 });
      break;
    case 'zap':
      chainZap(B, e, tgt, 1 + (sp.chain?.n || 0), dmg, sp.chain?.falloff || 0.7, fx);
      B.sfx('shoot_zap', { volume: 0.5 });
      break;
    case 'flame': {
      const a = angleTo(e.x, e.y, tgt.x, tgt.y);
      coneHit(B, e, a, e.range + 0.4, 1.0, dmg, fx, false);
      B.flame(ox, oy, a, e.range, 3);
      if (Math.random() < 0.25) B.sfx('shoot_flame', { volume: 0.35 });
      break;
    }
    case undefined:
    case null:
      // melee
      damage(B, tgt, dmg * buildingMult, { source: e, effects: fx });
      if (sp.chain) chainZap(B, e, nextNear(B, e, tgt), sp.chain.n, dmg * sp.chain.falloff, sp.chain.falloff, { stun: sp.chain.stun });
      if (sp.chain) damage(B, tgt, 0, { effects: { stun: sp.chain.stun } });
      B.spark(tgt.x, tgt.y - tgt.h * 0.5, '#ffffff', 3);
      B.sfx(e.big ? 'melee_hit' : 'sword_slash', { volume: e.big ? 0.6 : 0.3, pitch: 0.8 + Math.random() * 0.4 });
      break;
    default: {
      const lob = e.proj === 'bomb';
      fireProjectile(B, {
        team: e.team, source: e, x: ox, y: oy, target: lob ? null : tgt, tx: tgt.x, ty: tgt.y, lob,
        speed: lob ? 7 : e.proj === 'rocket' ? 7 : 11, dmg: dmg * buildingMult, splash: e.splash || 0, proj: e.proj, effects: fx,
        hitAir: e.targets === 'both', towerMult: e.towerMult,
      });
      const snd = { arrow: 'arrow', bullet: e.big ? 'shoot_minigun' : 'shoot_pistol', rocket: 'shoot_rocket', fireball: 'fire_ignite', iceshard: 'freeze', bone: 'magic', brick: 'shoot_rifle', bomb: 'shoot_rocket' }[e.proj];
      if (snd) B.sfx(snd, { volume: e.proj === 'bullet' ? 0.25 : 0.4, pitch: 0.9 + Math.random() * 0.2 });
    }
  }
}

function nextNear(B, e, first) {
  let best = null;
  let bd = 2.6 * 2.6;
  for (const o of B.entities) {
    if (!o.alive || o === first || o.team === e.team || o.untargetable || isBuildingKind(o)) continue;
    const d = dist2(o.x, o.y, first.x, first.y);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

// ───────────────────────── builders ─────────────────────────

function updateBuilder(B, e, dt) {
  const job = e.special.builder;
  // defend themselves when hit recently
  if (e.lastHitT && B.time - e.lastHitT < 1.5) {
    const threat = findTarget(B, e, 1.6);
    if (threat) {
      if (edgeDist(e, threat) <= e.range) {
        e.facing = threat.x < e.x ? -1 : 1;
        attack(B, e, threat, dt);
      } else {
        moveToward(B, e, threat.x, threat.y, dt, 0);
        e.anim = 'walk';
      }
      return;
    }
  }
  if (!e.carry) e.carry = 0;
  if (!e.state) e.state = 'toPile';
  if (e.state === 'toPile') {
    const piles = B.piles.filter((p) => p.team === e.team);
    if (!piles.length) {
      e.anim = 'idle';
      return;
    }
    if (!e.pile) e.pile = piles.reduce((a, b) => (dist2(a.x, a.y, e.x, e.y) < dist2(b.x, b.y, e.x, e.y) ? a : b));
    if (!moveToward(B, e, e.pile.x, e.pile.y + 0.4, dt, 0.5)) {
      e.state = 'mine';
      e.mineT = job.mineTime;
    } else e.anim = 'walk';
  } else if (e.state === 'mine') {
    e.anim = 'mine';
    e.facing = e.pile.x < e.x ? -1 : 1;
    e.mineT -= dt * statusMult(e);
    e.pickT = (e.pickT || 0) - dt;
    if (e.pickT <= 0) {
      e.pickT = 0.4;
      B.spark(e.pile.x, e.pile.y - 0.3, '#ffcf4a', 2);
      if (Math.random() < 0.5) B.sfx('mine_pick', { volume: 0.25, pitch: 0.9 + Math.random() * 0.3 });
    }
    if (e.mineT <= 0) {
      e.carry = job.carry;
      e.state = 'toBank';
    }
  } else if (e.state === 'toBank') {
    const king = B.towers.find((t) => t.team === e.team && t.type === 'king');
    if (!king || !king.alive) {
      B.addBricks(e.team, e.carry, e.x, e.y);
      e.carry = 0;
      e.state = 'toPile';
      return;
    }
    const by = king.y + (e.team === 0 ? -king.r - 0.3 : king.r + 0.3);
    if (!moveToward(B, e, king.x + (e.x < king.x ? -0.8 : 0.8), by, dt, 0.5)) {
      B.addBricks(e.team, e.carry, e.x, e.y - 0.5);
      B.sfx('brick_collect', { volume: 0.5 });
      e.carry = 0;
      e.state = 'toPile';
    } else e.anim = 'walk';
  }
}

// ───────────────────────── buildings & towers ─────────────────────────

export function updateBuilding(B, e, dt) {
  e.age += dt;
  if (e.deployT > 0) {
    e.deployT -= dt;
    return;
  }
  if (e.lifetime) {
    e.hp -= (e.maxHp / e.lifetime) * dt;
    if (e.hp <= 0) {
      kill(B, e, null);
      return;
    }
  }
  const sp = e.special || {};
  if (sp.elixirEvery) {
    e.elixT = (e.elixT ?? sp.elixirEvery) - dt;
    if (e.elixT <= 0) {
      e.elixT = sp.elixirEvery;
      B.addElixir(e.team, 1, e.x, e.y - 1);
    }
    e.brickT = (e.brickT ?? sp.bricksEvery) - dt;
    if (e.brickT <= 0) {
      e.brickT = sp.bricksEvery;
      B.addBricks(e.team, sp.bricks, e.x, e.y - 0.6);
    }
  }
  if (e.spawn) {
    e.spawnT = (e.spawnT ?? 1) - dt;
    if (e.spawnT <= 0) {
      e.spawnT = e.spawn.every;
      const dy = e.team === 0 ? -1 : 1;
      B.spawnUnit(e.team, e.spawn.card || e.spawn.unit, e.x + (Math.random() - 0.5) * 0.6, e.y + dy * 0.9, e.level, { deployT: 0.3 });
    }
  }
  if (!e.dmg || isDisabled(e)) {
    e.anim = sp.hidden ? (e.hidden ? 'hidden' : 'idle') : 'idle';
    return;
  }
  if (sp.hidden) {
    const near = findTarget(B, { ...e, targets: e.targets }, e.range);
    const wasHidden = e.hidden;
    e.hidden = !near || edgeDist(e, near) > e.range;
    if (wasHidden && !e.hidden) {
      e.attackCd = 0.5;
      B.sfx('build', { pitch: 1.4, volume: 0.4 });
    }
    if (e.hidden) {
      e.anim = 'hidden';
      e.target = null;
      return;
    }
  }
  towerLikeAttack(B, e, dt);
}

export function updateTower(B, e, dt) {
  if (e.type === 'king') {
    if (!e.active) {
      e.anim = 'idle';
      return;
    }
    if (e.activateT > 0) {
      e.activateT -= dt;
      return;
    }
  }
  if (isDisabled(e)) return;
  towerLikeAttack(B, e, dt);
}

function towerLikeAttack(B, e, dt) {
  const t = e.target;
  e.scanT = (e.scanT || 0) - dt;
  if ((!t || !t.alive || !canTarget(e, t) || edgeDist(e, t) > e.range) && (t || e.scanT <= 0)) {
    e.scanT = 0.15;
    e.target = null;
    let best = null;
    let bd = Infinity;
    for (const o of B.entities) {
      if (!canTarget(e, o)) continue;
      const d = edgeDist(e, o);
      if (d <= e.range && d < bd) {
        bd = d;
        best = o;
      }
    }
    if (best && best !== e.target) e.attackCd = Math.max(e.attackCd, 0.3);
    e.target = best;
  }
  e.attackCd -= dt * statusMult(e);
  if (!e.target) {
    e.anim = 'idle';
    return;
  }
  e.aim = angleTo(e.x, e.y, e.target.x, e.target.y);
  if (e.attackCd > 0) return;
  e.attackCd = e.hs;
  e.anim = 'attack';
  e.attackAnimT = 0.25;
  if (e.kind === 'tower') {
    const el = e.element;
    const effects = el === 'fire' ? { burn: { dps: 22, dur: 2 } } : el === 'ice' ? { slow: { pct: 0.3, dur: 1.5 } } : el === 'earth' ? { stun: 0.2 } : null;
    if (el === 'lightning') {
      chainZap(B, e, e.target, 3, e.dmg, 0.75, null, 3, '#fff27a');
      B.sfx('shoot_zap', { volume: 0.35 });
      return;
    }
    fireProjectile(B, {
      team: e.team, source: e, x: e.x, y: e.y - e.h * 0.8, target: e.target, speed: 12, dmg: e.dmg,
      proj: e.type === 'king' ? 'brick' : 'arrow', effects, hitAir: true, elem: el,
    });
    B.sfx(e.type === 'king' ? 'shoot_rifle' : 'arrow', { volume: 0.3, pitch: e.type === 'king' ? 0.7 : 1 });
    return;
  }
  performHit(B, e, e.target);
}
