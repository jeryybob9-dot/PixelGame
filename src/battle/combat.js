// Damage, healing, status effects, projectiles, spell areas and deaths.

import { dist, dist2, clamp, angleTo } from '../core/util.js';
import { levelMult } from '../data/cards.js';

export const isBuildingKind = (e) => e.kind === 'building' || e.kind === 'tower';

/** Can `a` currently attack `b`? */
export function canTarget(a, b) {
  if (!b.alive || b.team === a.team || b.deployT > 0 && b.kind !== 'tower') return false;
  if (b.untargetable || b.status?.invisible > 0) return false;
  if (b.kind === 'building' && b.hidden) return false;
  const t = a.targets;
  if (!t || t === 'none') return false;
  if (t === 'buildings') return isBuildingKind(b) && !b.isWall;
  if (b.flying && t !== 'both') return false;
  return true;
}

export function statusMult(e) {
  const st = e.status;
  let m = 1;
  if (st.slow?.t > 0) m *= 1 - st.slow.pct;
  if (st.rage?.t > 0) m *= 1 + st.rage.pct;
  return m;
}
export const isDisabled = (e) => e.status.stun > 0 || e.status.freeze > 0;

/**
 * Apply damage. Returns the damage actually dealt to hp+armor+shield.
 * @param {import('./battle.js').Battle} B
 */
export function damage(B, target, amount, opts = {}) {
  if (!target.alive || amount <= 0) return 0;
  if (target.status.invuln > 0) return 0;
  const src = opts.source;
  let dmg = amount;
  if (opts.crit) dmg *= opts.crit;
  if (src?.buildingBonus && isBuildingKind(target)) dmg *= src.buildingBonus;
  dmg = Math.round(dmg);
  let left = dmg;
  if (target.shield > 0) {
    const a = Math.min(target.shield, left);
    target.shield -= a;
    left -= a;
  }
  if (left > 0 && target.armor > 0) {
    const a = Math.min(target.armor, left);
    target.armor -= a;
    left -= a;
  }
  target.hp -= left;
  target.flash = 1;
  target.lastHitT = B.time;
  if (target.kind === 'hero') target.armorRegenT = 4;
  if (target.kind === 'tower' && target.type === 'king' && !target.active) activateKing(B, target);
  if (B.settings.dmgNumbers && dmg >= 1) B.floatText(target.x, target.y - target.h * 0.9, String(dmg), opts.crit ? '#ffe14a' : target.team === 0 ? '#ff9a8a' : '#ffffff', opts.crit ? 1.3 : 1);
  if (src && src.alive !== false && src.lifesteal) heal(B, src, dmg * src.lifesteal, true);
  if (opts.effects) applyEffects(B, target, opts.effects, src);
  if (target.hp <= 0) kill(B, target, src);
  return dmg;
}

export function heal(B, e, amount, quiet = false) {
  if (!e.alive || e.hp >= e.maxHp) return 0;
  let a = amount;
  if (e.status.poison?.t > 0) a *= 0.5;
  const before = e.hp;
  e.hp = Math.min(e.maxHp, e.hp + a);
  const healed = e.hp - before;
  if (!quiet && healed >= 5 && B.settings.dmgNumbers) B.floatText(e.x, e.y - e.h, '+' + Math.round(healed), '#7dff8a', 0.9);
  return healed;
}

export function applyEffects(B, t, fx, src) {
  if (!t.alive) return;
  const st = t.status;
  const building = isBuildingKind(t);
  if (fx.burn) {
    if (!st.burn || st.burn.t < fx.burn.dur || st.burn.dps < fx.burn.dps) st.burn = { dps: Math.max(fx.burn.dps, st.burn?.dps || 0), t: fx.burn.dur, src };
  }
  if (fx.poison) st.poison = { dps: Math.max(fx.poison.dps, st.poison?.dps || 0), t: fx.poison.dur, src };
  if (fx.bleed) {
    const stacks = Math.min(5, (st.bleed?.t > 0 ? st.bleed.stacks : 0) + 1);
    st.bleed = { dps: fx.bleed.dps, t: fx.bleed.dur, stacks, src };
  }
  if (fx.slow && !building) st.slow = { pct: Math.max(fx.slow.pct, st.slow?.t > 0 ? st.slow.pct : 0), t: Math.max(fx.slow.dur, st.slow?.t || 0) };
  if (fx.slow && building) st.slow = { pct: fx.slow.pct * 0.6, t: fx.slow.dur };
  if (fx.stun) st.stun = Math.max(st.stun, fx.stun);
  if (fx.freeze) st.freeze = Math.max(st.freeze, fx.freeze);
  if ((fx.stun || fx.freeze) && t.resetOnStun) t.resetOnStun(t);
  if (fx.knockback && !building && !t.flying && (t.mass || 1) < 15 && src) {
    const a = angleTo(src.x, src.y, t.x, t.y);
    const k = fx.knockback / Math.max(1, (t.mass || 1) / 4);
    t.x = clamp(t.x + Math.cos(a) * k, 0.4, B.W - 0.4);
    t.y = clamp(t.y + Math.sin(a) * k, 0.4, B.H - 0.4);
    B.constrain?.(t);
  }
}

/** Tick damage-over-time and timers. */
export function tickStatus(B, e, dt) {
  const st = e.status;
  for (const k of ['burn', 'poison', 'bleed', 'plague']) {
    const s = st[k];
    if (s && s.t > 0) {
      s.t -= dt;
      s.acc = (s.acc || 0) + s.dps * (k === 'bleed' ? s.stacks : 1) * dt;
      if (s.acc >= 1) {
        const n = Math.floor(s.acc);
        s.acc -= n;
        if (e.kind === 'hero' && e.status.invuln > 0) continue;
        e.hp -= n;
        if (e.hp <= 0) {
          kill(B, e, s.src);
          return;
        }
      }
      if (k === 'plague' && s.t > 0) {
        s.spreadT = (s.spreadT || 0) - dt;
        if (s.spreadT <= 0) {
          s.spreadT = 1;
          for (const o of B.entities) {
            if (o === e || o.team !== e.team || !o.alive || isBuildingKind(o) || o.status.plague || o.plagueImmune) continue;
            if (dist2(o.x, o.y, e.x, e.y) <= s.spread * s.spread) {
              o.status.plague = { dps: s.dps, t: s.dur, dur: s.dur, spread: s.spread, src: s.src };
              B.puff(o.x, o.y - 0.4, '#9be35a', 4);
            }
          }
        }
        if (s.t <= 0) e.plagueImmune = true;
      }
    }
  }
  if (st.slow && st.slow.t > 0) st.slow.t -= dt;
  if (st.rage && st.rage.t > 0) st.rage.t -= dt;
  if (st.stun > 0) st.stun -= dt;
  if (st.freeze > 0) st.freeze -= dt;
  if (st.invuln > 0) st.invuln -= dt;
  if (st.invisible > 0) st.invisible -= dt;
  if (st.regen && st.regen.t > 0) {
    st.regen.t -= dt;
    heal(B, e, st.regen.hps * dt, true);
  }
  if (e.shieldT > 0) {
    e.shieldT -= dt;
    if (e.shieldT <= 0) e.shield = 0;
  }
  if (e.flash > 0) e.flash = Math.max(0, e.flash - dt * 6);
}

export function activateKing(B, king) {
  if (king.active || !king.alive) return;
  king.active = true;
  king.activateT = 1.2;
  B.emit('king', { team: king.team });
  B.sfx('king_activate');
}

/** Remove an entity and run its death effects. */
export function kill(B, e, src) {
  if (!e.alive) return;
  e.alive = false;
  e.hp = 0;
  // wild creatures (team 2) pay their bounty to whoever killed them
  const enemy = e.team === 2 ? (src?.team ?? -1) : 1 - e.team;
  if (e.kind === 'tower') {
    B.onTowerDestroyed(e, src);
    return;
  }
  if (e.kind === 'hero') {
    B.onHeroDeath(e, src);
    return;
  }
  if (e.kind === 'pet') {
    B.puff(e.x, e.y - 0.3, '#ffffff', 6);
    return;
  }
  // troops & buildings
  B.puff(e.x, e.y - e.h * 0.4, e.isWall ? '#c46a3a' : '#e8e2d0', e.big ? 14 : 8);
  if (e.kind === 'troop' && !e.noBounty && B.players[enemy]) {
    const bricks = Math.max(1, Math.round((e.costShare || 1) * 1.6));
    B.addBricks(enemy, bricks, e.x, e.y);
    B.stat(enemy, 'kills', 1);
    if (src?.kind === 'hero') B.stat(enemy, 'heroKills', 1);
  }
  if (e.kind === 'troop' || e.kind === 'villager') B.sfx('unit_die', { volume: 0.5, pitch: 0.9 + Math.random() * 0.3 });
  else B.sfx('explosion_small', { volume: 0.6 });

  const sp = e.special || {};
  // zombie infection
  if (src?.special?.infect && src.team !== e.team && e.kind === 'troop' && !e.flying && e.sprite !== 'zombie' && src.alive) {
    const z = B.spawnUnit(src.team, 'zombies', e.x, e.y, src.level, { deployT: 0.6, hpMult: 0.6 });
    if (z) {
      B.puff(e.x, e.y - 0.4, '#7dd35a', 10);
      B.sfx('zombie_infect');
    }
  }
  if (sp.deathSpawn) {
    for (let i = 0; i < sp.deathSpawn.count; i++) {
      const a = (i / sp.deathSpawn.count) * Math.PI * 2;
      B.spawnUnit(e.team, sp.deathSpawn.unit, e.x + Math.cos(a) * 0.6, e.y + Math.sin(a) * 0.6, e.level, { deployT: 0.15 });
    }
  }
  if (sp.rebirth) {
    B.spawnUnit(e.team, 'phoenix_egg', e.x, e.y, e.level, { deployT: 0, hatchCard: e.cardId });
    B.sfx('fire_ignite');
  }
  if (e.spawn?.onDeath) {
    for (let i = 0; i < e.spawn.onDeath; i++) B.spawnUnit(e.team, e.spawn.unit, e.x + (i - 1) * 0.6, e.y + 0.5, e.level, { deployT: 0.2 });
  }
  B.onKill?.(e, src);
}

// ───────────────────────── projectiles ─────────────────────────

/**
 * @param {object} p { team, source, x, y, target?, tx, ty, speed, dmg, splash, proj, effects, lob, towerMult, buildingMult, pierce, bounce, crit, vortex, straight, dir, maxDist, hitAir }
 */
export function fireProjectile(B, p) {
  const proj = {
    alive: true,
    t: 0,
    z: 0,
    speed: p.speed ?? 9,
    splash: 0,
    ...p,
  };
  if (proj.target) {
    proj.tx = proj.target.x;
    proj.ty = proj.target.y - (proj.target.flying ? 0.9 : 0.3);
  }
  proj.sx = proj.x;
  proj.sy = proj.y;
  proj.total = Math.max(0.01, dist(proj.x, proj.y, proj.tx, proj.ty));
  B.projectiles.push(proj);
  return proj;
}

export function updateProjectiles(B, dt) {
  for (const p of B.projectiles) {
    if (!p.alive) continue;
    p.t += dt;
    if (p.straight) {
      const step = p.speed * dt;
      p.x += Math.cos(p.dir) * step;
      p.y += Math.sin(p.dir) * step;
      p.travel = (p.travel || 0) + step;
      for (const e of B.entities) {
        if (!e.alive || e.team === p.team || e.untargetable || (e.flying && !p.hitAir) || (p.hit && p.hit.has(e))) continue;
        const rr = e.r + 0.15;
        if (dist2(e.x, e.y - (e.flying ? 0.9 : 0), p.x, p.y) <= rr * rr) {
          projectileHit(B, p, e);
          if (!p.pierce) {
            p.alive = false;
            break;
          }
          (p.hit ||= new Set()).add(e);
        }
      }
      if (p.travel >= p.maxDist || p.x < -1 || p.x > B.W + 1 || p.y < -1 || p.y > B.H + 1) p.alive = false;
      continue;
    }
    if (p.target && p.target.alive && !p.lob) {
      p.tx = p.target.x;
      p.ty = p.target.y - (p.target.flying ? 0.9 : 0.3);
    }
    const d = dist(p.x, p.y, p.tx, p.ty);
    const step = p.speed * dt;
    if (p.lob) {
      p.prog = Math.min(1, (p.prog || 0) + step / p.total);
      p.x = p.sx + (p.tx - p.sx) * p.prog;
      p.y = p.sy + (p.ty - p.sy) * p.prog;
      p.z = Math.sin(p.prog * Math.PI) * Math.min(3, p.total * 0.4);
      if (p.prog >= 1) {
        p.alive = false;
        projectileHit(B, p, null);
      }
      continue;
    }
    if (d <= step + 0.1) {
      p.alive = false;
      projectileHit(B, p, p.target && p.target.alive ? p.target : null);
    } else {
      p.x += ((p.tx - p.x) / d) * step;
      p.y += ((p.ty - p.y) / d) * step;
    }
  }
  B.projectiles = B.projectiles.filter((p) => p.alive);
}

function damageFor(p, e) {
  let d = p.dmg;
  if (isBuildingKind(e)) {
    if (e.kind === 'tower' && p.towerMult) d *= p.towerMult;
    if (p.buildingMult) d *= p.buildingMult;
  }
  return d;
}

function projectileHit(B, p, target) {
  const src = p.source;
  const x = target ? target.x : p.tx;
  const y = target ? target.y : p.ty;
  if (p.splash > 0) {
    for (const e of B.entities) {
      if (!e.alive || e.team === p.team || e.untargetable) continue;
      if (e.flying && !p.hitAir) continue;
      if (dist2(e.x, e.y, x, y) <= (p.splash + e.r * 0.5) ** 2) damage(B, e, damageFor(p, e), { source: src, effects: p.effects, crit: p.crit });
    }
    B.explosion(x, y, p.splash, p.proj === 'void' ? '#a35bff' : p.proj === 'iceshard' ? '#9fe8ff' : '#ffb347');
    if (p.proj === 'sheep') B.sfx('sheep', { volume: 0.7 });
    B.sfx(p.splash >= 1.4 ? 'explosion_big' : 'explosion_small', { volume: 0.55 });
    if (p.vortex) addArea(B, { kind: 'vortex', team: p.team, x, y, radius: p.splash, t: p.vortex.dur, dur: p.vortex.dur, pull: p.vortex.pull, dps: p.vortex.dps, source: src });
  } else if (target) {
    damage(B, target, damageFor(p, target), { source: src, effects: p.effects, crit: p.crit });
    if (p.proj === 'arrow' || p.proj === 'bullet') B.spark(target.x, target.y - target.h * 0.5, '#fff6c8', 2);
  }
  if (p.bounce > 0 && target) {
    let best = null;
    let bd = 3.5 * 3.5;
    for (const e of B.entities) {
      if (!e.alive || e === target || e.team === p.team || e.untargetable || (p.hit && p.hit.has(e))) continue;
      if (e.flying && !p.hitAir) continue;
      const d2 = dist2(e.x, e.y, target.x, target.y);
      if (d2 < bd) {
        bd = d2;
        best = e;
      }
    }
    if (best) {
      const hit = p.hit || new Set();
      hit.add(target);
      fireProjectile(B, { ...p, x: target.x, y: target.y - 0.4, target: best, bounce: p.bounce - 1, hit, lob: false, splash: p.splash });
    }
  }
}

/** Instant ray that hits every enemy along a line (rail shots). */
export function railShot(B, src, x0, y0, ang, len, dmg, opts = {}) {
  const x1 = x0 + Math.cos(ang) * len;
  const y1 = y0 + Math.sin(ang) * len;
  for (const e of B.entities) {
    if (!e.alive || e.team === src.team || e.untargetable) continue;
    if (e.flying && !opts.hitAir) continue;
    const d = pointSegDist(e.x, e.y - (e.flying ? 0.9 : 0.3), x0, y0, x1, y1);
    if (d <= e.r + 0.2) {
      let dd = dmg;
      if (e.kind === 'tower' && opts.towerMult) dd *= opts.towerMult;
      damage(B, e, dd, { source: src, effects: opts.effects, crit: opts.crit });
    }
  }
  B.beam(x0, y0, x1, y1, opts.color || '#9ff6ff', 0.25, 2);
}

export function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Damage every enemy inside a cone. */
export function coneHit(B, src, ang, range, arc, dmg, effects, hitAir = false) {
  let n = 0;
  for (const e of B.entities) {
    if (!e.alive || e.team === src.team || e.untargetable) continue;
    if (e.flying && !hitAir) continue;
    const d = dist(src.x, src.y, e.x, e.y);
    if (d > range + e.r) continue;
    let da = Math.abs(normAngle(angleTo(src.x, src.y, e.x, e.y) - ang));
    if (d < 0.6) da = 0;
    if (da <= arc / 2) {
      damage(B, e, e.kind === 'tower' ? dmg * 0.6 : dmg, { source: src, effects });
      n++;
    }
  }
  return n;
}

export function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Lightning that hops between enemies. */
export function chainZap(B, src, first, n, dmg, falloff, effects, jump = 3, color = '#bff3ff') {
  let cur = first;
  let from = { x: src.x, y: src.y - (src.h || 1) * 0.6 };
  const hit = new Set();
  let d = dmg;
  for (let i = 0; i < n && cur; i++) {
    hit.add(cur);
    B.bolt(from.x, from.y, cur.x, cur.y - (cur.flying ? 0.9 : cur.h * 0.5), color);
    damage(B, cur, cur.kind === 'tower' ? d * 0.5 : d, { source: src, effects });
    from = { x: cur.x, y: cur.y - (cur.flying ? 0.9 : 0.4) };
    d *= falloff;
    let best = null;
    let bd = jump * jump;
    for (const e of B.entities) {
      if (!e.alive || hit.has(e) || e.team === src.team || e.untargetable) continue;
      const dd = dist2(e.x, e.y, cur.x, cur.y);
      if (dd < bd) {
        bd = dd;
        best = e;
      }
    }
    cur = best;
  }
}

// ───────────────────────── areas (spells & lingering effects) ─────────────────────────

export function addArea(B, a) {
  a.alive = true;
  a.age = 0;
  a.tick = 0;
  B.areas.push(a);
  return a;
}

function enemiesIn(B, team, x, y, r, opts = {}) {
  const out = [];
  for (const e of B.entities) {
    if (!e.alive || (!opts.both && e.team === team)) continue;
    if (opts.noBuildings && isBuildingKind(e)) continue;
    if (opts.groundOnly && e.flying) continue;
    if (dist2(e.x, e.y, x, y) <= (r + e.r * 0.5) ** 2) out.push(e);
  }
  return out;
}
export { enemiesIn };

/** Cast a spell card at (x, y). */
export function castSpell(B, team, card, x, y, level) {
  const s = card.spell;
  const m = levelMult(level);
  const towerDmg = (e, d) => (e.kind === 'tower' ? d * (s.towerMult ?? 0.35) : d);
  switch (s.kind) {
    case 'volley':
      addArea(B, { kind: 'volley', team, x, y, radius: s.radius, t: s.delay, dur: s.delay, onEnd: () => {
        for (const e of enemiesIn(B, team, x, y, s.radius)) damage(B, e, towerDmg(e, s.dmg * m), { source: null });
        B.sfx('arrow', { volume: 0.9 });
        B.dust(x, y, s.radius);
      } });
      break;
    case 'spark':
      for (const e of enemiesIn(B, team, x, y, s.radius)) damage(B, e, towerDmg(e, s.dmg * m), { effects: { stun: s.stun } });
      B.flashRing(x, y, s.radius, '#9ff6ff');
      for (let i = 0; i < 5; i++) B.bolt(x + (Math.random() - 0.5) * s.radius * 1.4, y - 3, x + (Math.random() - 0.5) * s.radius * 1.4, y + (Math.random() - 0.5) * s.radius, '#d8fbff');
      B.sfx('shoot_zap');
      break;
    case 'wall': {
      const n = s.width;
      for (let i = 0; i < n; i++) {
        const wx = clamp(x + (i - (n - 1) / 2), 0.6, B.W - 0.6);
        B.spawnBuilding(team, 'wall', wx, y, level, { hp: s.hp * m, lifetime: s.lifetime, isWall: true, deployT: 0.25 + i * 0.06 });
      }
      B.sfx('build');
      break;
    }
    case 'meteor':
      addArea(B, { kind: 'meteor', team, x, y, radius: s.radius, t: s.delay, dur: s.delay, onEnd: () => {
        for (const e of enemiesIn(B, team, x, y, s.radius)) damage(B, e, towerDmg(e, s.dmg * m), { effects: { burn: { dps: 20 * m, dur: 2 } } });
        B.igniteGround(x, y, s.radius * 0.85, s.burnGround.dur, s.burnGround.dps * m, team);
        B.explosion(x, y, s.radius, '#ff7a2e');
        B.decal(x, y, s.radius);
        B.shake(0.5);
        B.sfx('meteor');
      } });
      B.sfx('fire_ignite', { volume: 0.5 });
      break;
    case 'quake':
      addArea(B, { kind: 'quake', team, x, y, radius: s.radius, t: s.duration, dur: s.duration, every: 0.25, onTick: (dt) => {
        for (const e of enemiesIn(B, team, x, y, s.radius, { groundOnly: true })) {
          const dps = isBuildingKind(e) ? s.buildingDps * (e.kind === 'tower' ? 0.35 : 1) : s.dps;
          damage(B, e, dps * m * dt, {});
          if (!isBuildingKind(e)) applyEffects(B, e, { slow: { pct: s.slow, dur: 0.4 } });
        }
        B.shake(0.12);
      } });
      B.sfx('earthquake');
      break;
    case 'bless':
      for (const e of B.entities) {
        if (!e.alive || e.team !== team || e.kind === 'tower') continue;
        if (dist2(e.x, e.y, x, y) > s.radius * s.radius) continue;
        heal(B, e, s.heal * m);
        if (!isBuildingKind(e)) e.status.rage = { pct: s.rage.pct, t: s.rage.dur };
      }
      B.flashRing(x, y, s.radius, '#ffe68a');
      B.sparkle(x, y, s.radius, '#ffe68a', 18);
      B.sfx('heal');
      break;
    case 'lightning': {
      const targets = enemiesIn(B, team, x, y, s.radius).sort((a, b) => b.hp - a.hp).slice(0, s.strikes);
      targets.forEach((e, i) => {
        addArea(B, { kind: 'delay', team, x: e.x, y: e.y, t: 0.18 * i + 0.05, dur: 0.2, onEnd: () => {
          if (!e.alive) return;
          B.bolt(e.x + 0.4, e.y - 6, e.x, e.y - 0.4, '#fffbe0', 3);
          damage(B, e, towerDmg(e, s.dmg * m), { effects: { stun: s.stun } });
          B.flashRing(e.x, e.y, 0.9, '#fff7a8');
          B.shake(0.2);
          B.sfx('lightning');
        } });
      });
      if (!targets.length) {
        B.bolt(x, y - 6, x, y, '#fffbe0', 3);
        B.sfx('lightning');
      }
      break;
    }
    case 'acid':
      addArea(B, { kind: 'acid', team, x, y, radius: s.radius, t: s.duration, dur: s.duration, every: 0.25, onTick: (dt) => {
        for (const e of enemiesIn(B, team, x, y, s.radius)) {
          damage(B, e, towerDmg(e, s.dps * m * dt), {});
          if (!isBuildingKind(e)) applyEffects(B, e, { slow: { pct: s.slow, dur: 0.4 }, poison: { dps: 0.01, dur: 0.5 } });
        }
      } });
      B.sfx('poison');
      break;
    case 'blizzard':
      for (const e of enemiesIn(B, team, x, y, s.radius)) damage(B, e, towerDmg(e, s.dmg * m), { effects: { freeze: s.freeze } });
      addArea(B, { kind: 'blizzard', team, x, y, radius: s.radius, t: 1.2, dur: 1.2 });
      B.sfx('freeze');
      break;
    case 'plague':
      for (const e of enemiesIn(B, team, x, y, s.radius)) {
        if (e.kind === 'tower') {
          damage(B, e, s.dps * s.duration * m * s.towerMult, {});
          continue;
        }
        if (isBuildingKind(e)) continue;
        e.status.plague = { dps: s.dps * m, t: s.duration, dur: s.duration, spread: s.spread, src: null };
      }
      addArea(B, { kind: 'plague', team, x, y, radius: s.radius, t: 1.5, dur: 1.5 });
      B.sfx('poison', { pitch: 0.7 });
      break;
    case 'blackhole':
      addArea(B, { kind: 'vortex', team, x, y, radius: s.radius, t: s.duration, dur: s.duration, pull: s.pull, dps: 0, big: true, onEnd: () => {
        for (const e of enemiesIn(B, team, x, y, s.radius * 0.7)) damage(B, e, towerDmg(e, s.dmg * m), {});
        B.explosion(x, y, s.radius * 0.6, '#a35bff');
        B.shake(0.35);
        B.sfx('explosion_big');
      } });
      B.sfx('black_hole');
      break;
    case 'nuke':
      addArea(B, { kind: 'nuke', team, x, y, radius: s.radius, t: s.delay, dur: s.delay, onEnd: () => {
        for (const e of B.entities) {
          if (!e.alive || dist2(e.x, e.y, x, y) > (s.radius + e.r * 0.5) ** 2) continue;
          if (isBuildingKind(e) && e.team === team) continue;
          damage(B, e, e.kind === 'tower' ? s.dmg * m * s.towerMult : s.dmg * m, {});
        }
        B.igniteGround(x, y, s.radius * 0.6, 4, 25 * m, -1);
        B.wasteland(x, y, s.radius * 0.8, s.wasteland);
        B.explosion(x, y, s.radius, '#fff2a8');
        B.decal(x, y, s.radius);
        B.whiteFlash = 1;
        B.shake(1.2);
        B.sfx('nuke');
      } });
      B.sfx('countdown', { pitch: 0.6 });
      break;
    default:
      break;
  }
}

/** Advance lingering areas each frame. */
export function updateAreas(B, dt) {
  for (const a of B.areas) {
    if (!a.alive) continue;
    a.age += dt;
    a.t -= dt;
    if (a.onTick) {
      a.tick -= dt;
      if (a.tick <= 0) {
        const step = a.every || dt;
        a.onTick(step);
        a.tick += step;
      }
    }
    if (a.kind === 'vortex') {
      for (const e of B.entities) {
        if (!e.alive || e.team === a.team || isBuildingKind(e)) continue;
        const d = dist(e.x, e.y, a.x, a.y);
        if (d > a.radius || d < 0.15) continue;
        const pull = a.pull * (1 - d / (a.radius + 0.5)) * dt / Math.max(1, (e.mass || 1) / 6);
        e.x += ((a.x - e.x) / d) * pull;
        e.y += ((a.y - e.y) / d) * pull;
        if (a.dps) damage(B, e, a.dps * dt, {});
      }
    }
    if (a.follow) {
      if (!a.follow.alive) a.t = 0;
      else {
        a.x = a.follow.x;
        a.y = a.follow.y;
      }
    }
    if (a.t <= 0) {
      a.alive = false;
      a.onEnd?.();
    }
  }
  B.areas = B.areas.filter((a) => a.alive);
}
