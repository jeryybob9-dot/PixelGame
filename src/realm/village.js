// Villagers: autonomous workers that mine bricks, build and repair, pray at temples, and flee from danger.

import { dist, dist2 } from '../core/util.js';
import { statusMult, isDisabled, damage, isBuildingKind, canTarget } from '../battle/combat.js';
import { moveToward, edgeDist } from '../battle/units.js';
import { CARRY, MINE_TIME } from './constants.js';

/** Give each villager of `team` a job: builders for scaffolds and repairs, one priest per temple, everyone else mines. */
export function assignJobs(R, team) {
  const vs = R.entities.filter((e) => e.alive && e.kind === 'villager' && e.team === team);
  if (!vs.length) return;
  const scaffolds = R.structures.filter((s) => s.alive && s.team === team && s.built < 1);
  const damaged = R.structures.filter((s) => s.alive && s.team === team && s.built >= 1 && s.hp < s.maxHp * 0.8 && !threatened(R, s));
  const temples = R.structuresOf(team, 'temple');
  const priestsWanted = Math.min(temples.length, Math.max(0, vs.length - 2));
  const buildWanted = Math.min(Math.ceil(vs.length * 0.6), scaffolds.length * 2 + (damaged.length ? 1 : 0));

  // keep stable assignments where possible
  const priests = vs.filter((v) => v.job === 'pray' && v.temple?.alive);
  const builders = vs.filter((v) => v.job === 'build' && (v.site?.alive && (v.site.built < 1 || v.site.hp < v.site.maxHp)));
  for (const v of vs) {
    if (!priests.includes(v) && v.job === 'pray') setJob(v, 'mine');
    if (!builders.includes(v) && v.job === 'build') setJob(v, 'mine');
  }
  while (priests.length > priestsWanted) setJob(priests.pop(), 'mine');
  while (builders.length > buildWanted) setJob(builders.pop(), 'mine');
  const free = () => vs.filter((v) => v.job !== 'pray' && v.job !== 'build' && v.job !== 'flee');
  // priests
  for (const t of temples) {
    if (priests.length >= priestsWanted) break;
    if (priests.some((p) => p.temple === t)) continue;
    const cand = nearest(free(), t);
    if (!cand) break;
    setJob(cand, 'pray');
    cand.temple = t;
    priests.push(cand);
  }
  // builders: two per scaffold, then repairs
  const sites = [...scaffolds, ...damaged];
  for (const s of sites) {
    if (builders.length >= buildWanted) break;
    const on = builders.filter((b) => b.site === s).length;
    for (let k = on; k < (s.built < 1 ? 2 : 1) && builders.length < buildWanted; k++) {
      const cand = nearest(free(), s);
      if (!cand) break;
      setJob(cand, 'build');
      cand.site = s;
      builders.push(cand);
    }
  }
  for (const v of free()) if (v.job !== 'mine') setJob(v, 'mine');
}

function threatened(R, s) {
  return s.lastHitT && R.time - s.lastHitT < 3;
}

function setJob(v, job) {
  if (v.job === job) return;
  v.job = job;
  v.state = null;
  v.site = null;
  v.temple = null;
  v.sprite = job === 'pray' ? 'priest' : 'villager';
}

function nearest(list, p) {
  let best = null;
  let bd = Infinity;
  for (const v of list) {
    const d = dist2(v.x, v.y, p.x, p.y);
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  return best;
}

/** Closest enemy that is a danger to a villager. */
function danger(R, v, r) {
  let best = null;
  let bd = r * r;
  for (const o of R.entities) {
    if (!o.alive || o.team === v.team || o.untargetable || o.kind === 'critter' || o.kind === 'pickup') continue;
    if (!o.dmg || o.targets === 'none' || o.targets === 'buildings') continue;
    if (isBuildingKind(o)) continue;
    const d = dist2(o.x, o.y, v.x, v.y);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

export function updateVillager(R, v, dt) {
  v.age += dt;
  v.moving = false;
  if (isDisabled(v)) return;
  const work = R.workMult(v.team) * statusMult(v);

  // danger: flee home, fight back only when cornered
  v.scanT = (v.scanT || 0) - dt;
  if (v.scanT <= 0) {
    v.scanT = 0.35;
    v.threat = danger(R, v, 3.2);
  }
  const th = v.threat && v.threat.alive ? v.threat : null;
  if (th) {
    const d = edgeDist(v, th);
    if (d < 0.35 && canTarget(v, th)) {
      v.attackCd -= dt;
      v.facing = th.x < v.x ? -1 : 1;
      v.anim = 'mine';
      if (v.attackCd <= 0) {
        v.attackCd = v.hs;
        damage(R, th, v.dmg, { source: v });
      }
      return;
    }
    const safe = safeSpot(R, v);
    if (safe) {
      v.speedSave = v.speed;
      v.speed *= 1.25;
      moveToward(R, v, safe.x, safe.y, dt, 0.6);
      v.speed = v.speedSave;
      v.anim = v.carry ? 'carry' : 'walk';
      return;
    }
  }

  switch (v.job) {
    case 'build':
      doBuild(R, v, dt, work);
      break;
    case 'pray':
      doPray(R, v, dt);
      break;
    case 'mine':
      doMine(R, v, dt, work);
      break;
    default:
      v.anim = 'idle';
  }
}

function safeSpot(R, v) {
  const k = R.players[v.team]?.keep;
  if (!k || !k.alive) return null;
  if (dist2(v.x, v.y, k.x, k.y) < 2.6 * 2.6) return null;
  return { x: k.x, y: k.y + (v.team === 0 ? 2 : -2) };
}

function standSpot(s, v) {
  // a point on the edge of a footprint, on the side facing the villager
  const fp = s.fp;
  const cx = s.x;
  const cy = s.y;
  const hw = fp.w / 2 + 0.35;
  const hh = fp.h / 2 + 0.35;
  const a = Math.atan2(v.y - cy, v.x - cx);
  const k = Math.min(hw / Math.abs(Math.cos(a) || 1e-6), hh / Math.abs(Math.sin(a) || 1e-6));
  return { x: cx + Math.cos(a) * k, y: cy + Math.sin(a) * k };
}

function doBuild(R, v, dt, work) {
  const s = v.site;
  if (!s || !s.alive) {
    setJob(v, 'mine');
    return;
  }
  if (!v.spot || v.spotFor !== s.id) {
    v.spot = standSpot(s, v);
    v.spotFor = s.id;
  }
  if (moveToward(R, v, v.spot.x, v.spot.y, dt, 0.25)) {
    v.anim = v.carry ? 'carry' : 'walk';
    if (dist(v.x, v.y, s.x, s.y) > Math.max(s.fp.w, s.fp.h) * 0.75 + 0.6) return;
  }
  v.facing = s.x < v.x ? -1 : 1;
  v.anim = 'mine';
  v.hammerT = (v.hammerT || 0) - dt;
  if (v.hammerT <= 0) {
    v.hammerT = 0.45;
    R.spark(s.x + (v.x - s.x) * 0.4, s.y - 0.3, '#ffe9a8', 2);
    if (Math.random() < 0.35) R.sfx('mine_pick', { volume: 0.15, pitch: 1.2 + Math.random() * 0.3 });
  }
  if (s.built < 1) R.advanceBuild(s, (dt * work) / Math.max(0.5, s.buildTime));
  else {
    s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.04 * dt * work);
    if (s.hp >= s.maxHp) setJob(v, 'mine');
  }
}

function doPray(R, v, dt) {
  const t = v.temple;
  if (!t || !t.alive) {
    setJob(v, 'mine');
    return;
  }
  const spot = { x: t.x + (v.id % 2 ? 0.9 : -0.9), y: t.y + t.fp.h / 2 + 0.4 };
  if (moveToward(R, v, spot.x, spot.y, dt, 0.3)) {
    v.anim = 'walk';
    return;
  }
  v.anim = 'pray';
  v.facing = t.x < v.x ? -1 : 1;
  t.prayed = R.time;
  v.glowT = (v.glowT || 0) - dt;
  if (v.glowT <= 0) {
    v.glowT = 1.2;
    R.sparkle(t.x, t.y - 1.2, 0.8, '#ffe28a', 3);
  }
}

function pickDeposit(R, v) {
  const drops = R.dropOffs(v.team);
  let best = null;
  let bd = Infinity;
  for (const d of R.deposits) {
    if (d.amount <= 0) continue;
    // stay near home: distance to the closest drop-off counts double
    let near = Infinity;
    for (const k of drops) near = Math.min(near, dist(k.x, k.y, d.x, d.y));
    if (near > 15) continue;
    const owner = R.tileOwner(d.x, d.y);
    if (owner === 1 - v.team) continue;
    const crowd = R.entities.reduce((n, o) => n + (o.alive && o.kind === 'villager' && o.team === v.team && o.deposit === d ? 1 : 0), 0);
    const score = dist(v.x, v.y, d.x, d.y) + near * 1.5 + crowd * 2.5 + (owner === v.team ? 0 : 6);
    if (score < bd) {
      bd = score;
      best = d;
    }
  }
  return best;
}

function nearestDrop(R, v) {
  return nearest(R.dropOffs(v.team), v);
}

function doMine(R, v, dt, work) {
  if (!v.state) v.state = v.carry ? 'haul' : 'go';
  if (v.state === 'go') {
    if (!v.deposit || v.deposit.amount <= 0) v.deposit = pickDeposit(R, v);
    const d = v.deposit;
    if (!d) {
      idleNearKeep(R, v, dt);
      return;
    }
    if (!v.spot || v.spotFor !== -d.id) {
      const a = Math.random() * Math.PI * 2;
      v.spot = { x: d.x + Math.cos(a) * 0.75, y: d.y + 0.15 + Math.sin(a) * 0.55 };
      R.landSafely(v.spot);
      v.spotFor = -d.id;
    }
    if (moveToward(R, v, v.spot.x, v.spot.y, dt, 0.2)) {
      v.anim = 'walk';
      return;
    }
    v.state = 'mine';
    v.mineT = MINE_TIME;
  }
  if (v.state === 'mine') {
    const d = v.deposit;
    if (!d || d.amount <= 0) {
      v.state = 'go';
      v.deposit = null;
      return;
    }
    v.anim = 'mine';
    v.facing = d.x < v.x ? -1 : 1;
    v.mineT -= dt * work;
    v.pickT = (v.pickT || 0) - dt;
    if (v.pickT <= 0) {
      v.pickT = 0.42;
      R.spark(d.x, d.y - 0.3, '#ffcf4a', 2);
      if (Math.random() < 0.3) R.sfx('mine_pick', { volume: 0.18, pitch: 0.9 + Math.random() * 0.3 });
    }
    if (v.mineT <= 0) {
      const rich = R.ageIdx >= 1 ? 1.5 : 1;
      const take = Math.min(d.amount, Math.round(CARRY * rich));
      d.amount -= take;
      v.carry = take;
      v.state = 'haul';
      if (d.amount <= 0) {
        R.puff(d.x, d.y, '#c46a3a', 8);
        R.emit('depositEmpty', { d });
      }
    }
    return;
  }
  if (v.state === 'haul') {
    const k = nearestDrop(R, v);
    if (!k) {
      idleNearKeep(R, v, dt);
      return;
    }
    if (!v.spot || v.spotFor !== k.id) {
      v.spot = standSpot(k, v);
      v.spotFor = k.id;
    }
    if (moveToward(R, v, v.spot.x, v.spot.y, dt, 0.3) && dist(v.x, v.y, k.x, k.y) > Math.max(k.fp.w, k.fp.h) * 0.75 + 0.5) {
      v.anim = 'carry';
      return;
    }
    R.addBricks(v.team, v.carry, v.x, v.y - 0.6);
    if (v.team === 0) R.sfx('brick_collect', { volume: 0.25, pitch: 1 + Math.random() * 0.2 });
    v.carry = 0;
    v.state = 'go';
  }
}

function idleNearKeep(R, v, dt) {
  const k = R.players[v.team]?.keep;
  v.anim = 'idle';
  if (!k) return;
  if (!v.loiter || R.time > v.loiterT) {
    const a = Math.random() * Math.PI * 2;
    v.loiter = { x: k.x + Math.cos(a) * 3, y: k.y + Math.sin(a) * 2.5 };
    R.landSafely(v.loiter);
    v.loiterT = R.time + 4 + Math.random() * 4;
  }
  if (moveToward(R, v, v.loiter.x, v.loiter.y, dt, 0.3)) v.anim = 'walk';
}
