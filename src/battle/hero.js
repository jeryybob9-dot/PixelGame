// The player-steered hero: weapon firing, forms, spells, gadgets, and its pet.

import { dist, dist2, clamp, angleTo } from '../core/util.js';
import { HEROES, HERO_BASE, FORM_MULT, FORM_SPEED, FORM_COST } from '../data/heroes.js';
import { WEAPONS, weaponLevelMult } from '../data/weapons.js';
import { GADGETS, PETS } from '../data/gadgets.js';
import { kingMult } from '../data/progression.js';
import {
  canTarget, statusMult, isDisabled, damage, heal, fireProjectile, railShot, coneHit, chainZap, applyEffects,
  addArea, enemiesIn, isBuildingKind, normAngle,
} from './combat.js';
import { edgeDist, moveToward, findTarget } from './units.js';

export function createHero(B, team, setup) {
  const def = HEROES[setup.heroId] || HEROES.ember;
  const king = B.towers.find((t) => t.team === team && t.type === 'king');
  const km = kingMult(setup.kingLevel || 1);
  const hpMult = def.passive.hpMult || 1;
  const w = WEAPONS[setup.weaponId] || WEAPONS.rifle;
  const hero = {
    id: B.nextId++,
    kind: 'hero',
    team,
    heroId: def.id,
    def,
    x: king ? king.x : 9,
    y: king ? king.y + (team === 0 ? -2.6 : 2.6) : team === 0 ? 26 : 6,
    r: HERO_BASE.radius,
    h: 1.0,
    baseHp: HERO_BASE.hp * km * hpMult,
    maxHp: HERO_BASE.hp * km * hpMult,
    hp: HERO_BASE.hp * km * hpMult,
    maxArmor: HERO_BASE.armor * km,
    armor: HERO_BASE.armor * km,
    armorRegenT: 0,
    shield: 0,
    shieldT: 0,
    speed: HERO_BASE.speed,
    mass: 5,
    alive: true,
    deployT: 0,
    status: {},
    flash: 0,
    facing: team === 0 ? 1 : -1,
    aim: team === 0 ? -Math.PI / 2 : Math.PI / 2,
    anim: 'idle',
    age: 0,
    form: 1,
    km,
    weapon: w,
    weaponLevel: setup.weaponLevel || 1,
    ammo: w.mag || Infinity,
    reloadT: 0,
    fireCd: 0,
    spin: 0,
    targets: 'both',
    lifesteal: def.passive.lifesteal || 0,
    buildingBonus: HERO_BUILDING_BONUS,
    spellCd: [0, 0],
    gadget: GADGETS[setup.gadgetId] ? setup.gadgetId : null,
    gadgetCd: 4,
    moveTo: null,
    focus: null,
    skin: setup.skin || null,
    level: 1,
    name: setup.name,
  };
  return hero;
}

// Heroes hit troops a little softer than their stats suggest but are great at sieging towers.
export const HERO_DMG_SCALE = 0.75;
export const HERO_BUILDING_BONUS = 1.6;
export const heroDamageMult = (h) => HERO_DMG_SCALE * h.km * FORM_MULT[h.form - 1] * weaponLevelMult(h.weaponLevel) * (h.dmgBoost || 1);
const heroSpeed = (h) => (HERO_BASE.speed + FORM_SPEED[h.form - 1]) * (h.def.passive.speedMult || 1) * (h.weapon.mobility || 1);
const spellMult = (h) => h.km * (1 + (h.form - 2) * 0.15);

export function formUpgradeCost(h) {
  return h.form >= 3 ? null : FORM_COST[h.form];
}

export function upgradeForm(B, h) {
  const p = B.players[h.team];
  const cost = formUpgradeCost(h);
  if (cost == null || !h.alive || p.bricks < cost) return false;
  p.bricks -= cost;
  h.form++;
  const ratio = FORM_MULT[h.form - 1] / FORM_MULT[h.form - 2];
  h.maxHp = h.baseHp * FORM_MULT[h.form - 1];
  h.hp = h.maxHp;
  h.armor = h.maxArmor = HERO_BASE.armor * h.km * FORM_MULT[h.form - 1];
  void ratio;
  B.flashRing(h.x, h.y - 0.5, 1.6, B.elementColor(h.def.element));
  B.sparkle(h.x, h.y - 0.5, 1.2, B.elementColor(h.def.element), 24);
  B.sfx('form_upgrade');
  B.stat(h.team, 'forms', 1);
  B.emit('form', { team: h.team, form: h.form });
  return true;
}

/** Nearest enemy the hero can shoot right now. */
function autoTarget(B, h, range) {
  let best = null;
  let bd = Infinity;
  for (const o of B.entities) {
    if (!canTarget(h, o)) continue;
    const d = edgeDist(h, o);
    if (d > range) continue;
    const score = d + (isBuildingKind(o) ? 2.5 : 0);
    if (score < bd) {
      bd = score;
      best = o;
    }
  }
  return best;
}

export function updateHero(B, h, dt) {
  h.age += dt;
  h.moving = false;
  if (h.flash > 0) h.flash = Math.max(0, h.flash - dt * 6);
  // armour regenerates when not hit for 4 seconds
  if (h.armorRegenT > 0) h.armorRegenT -= dt;
  else if (h.armor < h.maxArmor) h.armor = Math.min(h.maxArmor, h.armor + h.maxArmor * 0.12 * dt);
  for (let i = 0; i < 2; i++) if (h.spellCd[i] > 0) h.spellCd[i] -= dt;
  if (h.gadgetCd > 0) h.gadgetCd -= dt;
  if (h.channel) updateChannel(B, h, dt);
  if (h.dash) {
    const d = h.dash;
    d.t -= dt;
    const k = Math.min(1, dt / Math.max(0.01, d.t + dt));
    h.x += (d.x - h.x) * k;
    h.y += (d.y - h.y) * k;
    B.trail(h.x, h.y - 0.4, h.x - Math.cos(d.a) * 0.6, h.y - 0.4 - Math.sin(d.a) * 0.6, '#ffd166');
    if (d.t <= 0) {
      h.dash = null;
      h.jumping = false;
      landSafely(B, h);
    }
    return;
  }
  if (isDisabled(h)) return;

  const w = h.weapon;
  const range = w.range;
  // reload
  if (h.reloadT > 0) {
    h.reloadT -= dt;
    if (h.reloadT <= 0) h.ammo = w.mag;
  }

  // choose target: focus > auto
  let tgt = h.focus && h.focus.alive && canTarget(h, h.focus) ? h.focus : null;
  if (!tgt) h.focus = null;
  const meleeAggro = range < 2;
  if (!tgt && !h.moveTo && !h.joy) tgt = autoTarget(B, h, meleeAggro ? 3.5 : range + 0.4);
  else if (!tgt && h.joy) tgt = autoTarget(B, h, range + 0.05);
  else if (!tgt && h.moveTo) tgt = autoTarget(B, h, range);

  // movement: joystick > move order > chase the target a little
  const joy = h.joy && Math.hypot(h.joy.x, h.joy.y) > 0.12 ? h.joy : null;
  if (joy) {
    const m = Math.hypot(joy.x, joy.y);
    const sp = heroSpeed(h) * statusMult(h) * Math.min(1, m) * (B.speedAt ? B.speedAt(h.x, h.y) : 1) * dt;
    h.x += (joy.x / m) * sp;
    h.y += (joy.y / m) * sp;
    if (Math.abs(joy.x) > 0.15) h.facing = joy.x < 0 ? -1 : 1;
    h.moving = true;
    h.moveTo = null;
  } else if (h.moveTo) {
    const arrived = !moveTowardHero(B, h, h.moveTo.x, h.moveTo.y, dt);
    if (arrived) h.moveTo = null;
  } else if (tgt && edgeDist(h, tgt) > range && !h.joy) {
    moveTowardHero(B, h, tgt.x, tgt.y, dt);
  }
  h.anim = h.moving ? 'walk' : 'idle';

  // shoot
  if (tgt && edgeDist(h, tgt) <= range + 0.05) {
    h.aim = angleTo(h.x, h.y - 0.5, tgt.x, tgt.y - (tgt.flying ? 0.9 : 0.4));
    h.facing = Math.cos(h.aim) < 0 ? -1 : 1;
    fireWeapon(B, h, tgt, dt);
  } else {
    h.spin = Math.max(0, h.spin - dt * 2);
    h.beamOn = false;
    if (h.moving && h.moveTo) {
      h.aim = angleTo(h.x, h.y, h.moveTo.x, h.moveTo.y);
      h.facing = Math.cos(h.aim) < 0 ? -1 : 1;
    } else if (joy) h.aim = Math.atan2(joy.y, joy.x);
    // auto reload when idle and not full
    if (w.mag && h.ammo < w.mag && h.reloadT <= 0 && !tgt) h.reloadT = w.reload * 0.5;
  }
}

function moveTowardHero(B, h, tx, ty, dt) {
  const saved = h.speed;
  h.speed = heroSpeed(h);
  const moved = moveToward(B, h, tx, ty, dt, 0.12);
  h.speed = saved;
  return moved;
}

function landSafely(B, h) {
  h.x = clamp(h.x, 0.5, B.W - 0.5);
  h.y = clamp(h.y, 0.5, B.H - 0.5);
  B.landSafely(h);
}

function fireWeapon(B, h, tgt, dt) {
  const w = h.weapon;
  h.fireCd -= dt * statusMult(h) * (h.def.passive.rateMult || 1);
  if (w.spinup) {
    h.spin = Math.min(w.spinup, h.spin + dt);
    if (h.spin < w.spinup * 0.5) return;
  }
  if (h.reloadT > 0) return;
  if (h.fireCd > 0) return;
  const rate = w.rate * (w.spinup ? 0.3 + 0.7 * (h.spin / w.spinup) : 1);
  h.fireCd += 1 / rate;
  if (h.fireCd < 0) h.fireCd = 1 / rate;
  if (w.mag) {
    h.ammo--;
    if (h.ammo <= 0) {
      h.reloadT = w.reload;
      B.sfx('ui_click', { pitch: 0.6, volume: 0.25 });
    }
  }
  h.anim = 'shoot';
  h.recoil = 0.12;
  const m = heroDamageMult(h);
  const effects = { ...(w.effects || {}) };
  if (h.def.passive.burn) effects.burn = h.def.passive.burn;
  if (h.def.passive.slow) effects.slow = h.def.passive.slow;
  const ox = h.x + Math.cos(h.aim) * 0.5;
  const oy = h.y - 0.5 + Math.sin(h.aim) * 0.5;
  const crit = w.crit && Math.random() < w.crit.chance ? w.crit.mult : undefined;
  const hitAir = true;
  B.sfx(w.sfx, { volume: w.rate > 6 ? 0.22 : 0.45, pitch: 0.92 + Math.random() * 0.16 });
  switch (w.mode) {
    case 'bullet':
      if (effects.pierce) {
        railShot(B, h, ox, oy, h.aim, w.range + 1, w.dmg * m, { hitAir, effects, crit, towerMult: 1, color: B.elementColor(h.def.element) });
        h.shake = 0.15;
        break;
      }
      fireProjectile(B, {
        team: h.team, source: h, x: ox, y: oy, target: tgt, speed: w.proj === 'rocket' ? 8 : 14, dmg: w.dmg * m, splash: w.splash || 0,
        proj: w.proj, effects, hitAir, crit, buildingMult: w.buildingMult, bounce: w.bounce || 0,
      });
      B.muzzle(ox, oy, h.aim);
      break;
    case 'pellets':
      for (let i = 0; i < w.pellets; i++) {
        const a = h.aim + (i / (w.pellets - 1) - 0.5) * w.spread;
        fireProjectile(B, { team: h.team, source: h, x: ox, y: oy, straight: true, dir: a, maxDist: w.range + 0.6, speed: 15, dmg: w.dmg * m, proj: 'bullet', effects, hitAir, tx: ox, ty: oy });
      }
      B.muzzle(ox, oy, h.aim, 1.6);
      break;
    case 'cone':
      coneHit(B, h, h.aim, w.range, w.arc, w.dmg * m, effects, true);
      if (w.id === 'toxicsprayer') B.spray(ox, oy, h.aim, w.range, '#9be35a');
      else B.flame(ox, oy, h.aim, w.range, 2);
      break;
    case 'beam':
      damage(B, tgt, w.dmg * m, { source: h, effects });
      B.beam(ox, oy, tgt.x, tgt.y - (tgt.flying ? 0.9 : 0.4), '#aef6ff', 0.08, 2);
      break;
    case 'melee': {
      let hit = 0;
      for (const o of B.entities) {
        if (!canTarget(h, o)) continue;
        if (edgeDist(h, o) > w.range) continue;
        const da = Math.abs(normAngle(angleTo(h.x, h.y, o.x, o.y) - h.aim));
        if (da > w.arc / 2 && dist(h.x, h.y, o.x, o.y) > 0.8) continue;
        damage(B, o, w.dmg * m, { source: h, effects });
        hit++;
      }
      B.slash(h.x, h.y - 0.5, h.aim, w.range, w.arc);
      if (hit && w.effects?.stun) B.shake(0.15);
      break;
    }
    case 'chain':
      chainZap(B, h, tgt, w.chain, w.dmg * m, w.falloff, effects, 3.2, '#d8f6ff');
      break;
    case 'lob':
      fireProjectile(B, {
        team: h.team, source: h, x: ox, y: oy, target: null, tx: tgt.x, ty: tgt.y, lob: true, speed: 8, dmg: w.dmg * m,
        splash: w.splash, proj: w.proj, effects: w.effects?.vortex ? null : effects, vortex: w.effects?.vortex, hitAir,
      });
      break;
    default:
      break;
  }
}

// ───────────────────────── spells ─────────────────────────

export function spellReady(h, i) {
  const s = h.def.spells[i];
  return h.alive && h.form >= s.form && h.spellCd[i] <= 0 && !isDisabled(h);
}

function aimAtNearest(B, h, range = 6) {
  const t = autoTarget(B, h, range);
  if (t) h.aim = angleTo(h.x, h.y, t.x, t.y);
  return t;
}

export function castHeroSpell(B, h, i) {
  if (!spellReady(h, i)) return false;
  const s = h.def.spells[i];
  h.spellCd[i] = s.cd;
  const m = spellMult(h);
  const col = B.elementColor(h.def.element);
  B.stat(h.team, 'spellsCast', 1);
  switch (s.id) {
    case 'firespin':
      h.channel = { id: s.id, t: 1.5, tick: 0 };
      B.sfx('fire_ignite');
      break;
    case 'dragonbreath':
      aimAtNearest(B, h);
      h.channel = { id: s.id, t: 2, tick: 0 };
      B.sfx('dragon_roar');
      break;
    case 'stoneskin':
      h.shield = 400 * m;
      h.shieldT = 4;
      for (const e of enemiesIn(B, h.team, h.x, h.y, 2, { noBuildings: true })) applyEffects(B, e, { knockback: 1.4 }, h);
      B.flashRing(h.x, h.y, 2, col);
      B.sfx('earthquake', { volume: 0.6 });
      break;
    case 'earthsplitter': {
      const t = aimAtNearest(B, h, 7);
      const a = t ? h.aim : h.team === 0 ? -Math.PI / 2 : Math.PI / 2;
      const len = 6;
      const x1 = h.x + Math.cos(a) * len;
      const y1 = h.y + Math.sin(a) * len;
      for (const e of B.entities) {
        if (!e.alive || e.team === h.team || e.flying) continue;
        const d = distToSeg(e.x, e.y, h.x, h.y, x1, y1);
        if (d > e.r + 0.6) continue;
        const dmg = 350 * m * (e.kind === 'tower' ? 0.5 : isBuildingKind(e) ? 2 : 1);
        damage(B, e, dmg, { source: h, effects: { stun: 1.2 } });
      }
      B.crack(h.x, h.y, x1, y1);
      B.shake(0.5);
      B.sfx('earthquake');
      break;
    }
    case 'chainspark': {
      const t = aimAtNearest(B, h, 5);
      if (t) chainZap(B, h, t, 5, 180 * m, 0.92, { stun: 0.4 }, 3.4, '#fff27a');
      else B.flashRing(h.x, h.y, 1, col);
      B.sfx('lightning', { volume: 0.7 });
      break;
    }
    case 'thunderstorm':
      h.channel = { id: s.id, t: 2.5, tick: 0, strikes: 8 };
      B.sfx('lightning');
      break;
    case 'frostnova':
      for (const e of enemiesIn(B, h.team, h.x, h.y, 2.2)) damage(B, e, e.kind === 'tower' ? 40 * m : 120 * m, { source: h, effects: { freeze: 2 } });
      B.flashRing(h.x, h.y, 2.2, col);
      B.sparkle(h.x, h.y, 2, '#dff8ff', 20);
      B.sfx('freeze');
      break;
    case 'iceage':
      for (const e of enemiesIn(B, h.team, h.x, h.y, 5)) damage(B, e, e.kind === 'tower' ? 60 * m : 200 * m, { source: h, effects: { slow: { pct: 0.5, dur: 5 } } });
      for (const e of B.entities) {
        if (e.alive && e.team === h.team && !isBuildingKind(e) && dist2(e.x, e.y, h.x, h.y) < 9) {
          e.shield = Math.max(e.shield || 0, 150 * m);
          e.shieldT = 5;
        }
      }
      addArea(B, { kind: 'blizzard', team: h.team, x: h.x, y: h.y, radius: 5, t: 1.4, dur: 1.4 });
      B.sfx('freeze', { pitch: 0.7 });
      break;
    case 'bonearmy':
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        B.spawnUnit(h.team, 'skeletons', h.x + Math.cos(a) * 0.9, h.y + Math.sin(a) * 0.9, Math.max(1, Math.round(h.km * 2)), { deployT: 0.3 });
      }
      B.puff(h.x, h.y, '#b58cff', 12);
      B.sfx('magic');
      break;
    case 'soulharvest': {
      let total = 0;
      for (const e of enemiesIn(B, h.team, h.x, h.y, 3)) {
        total += damage(B, e, e.kind === 'tower' ? 90 * m : 300 * m, { source: h });
        B.beam(e.x, e.y - 0.4, h.x, h.y - 0.5, '#c58cff', 0.4, 2);
      }
      heal(B, h, total * 0.5);
      B.flashRing(h.x, h.y, 3, col);
      B.sfx('magic', { pitch: 0.6 });
      break;
    }
    default:
      break;
  }
  B.emit('heroSpell', { team: h.team, id: s.id });
  return true;
}

function updateChannel(B, h, dt) {
  const c = h.channel;
  c.t -= dt;
  c.tick -= dt;
  const m = spellMult(h);
  if (c.tick <= 0) {
    if (c.id === 'firespin') {
      c.tick = 0.25;
      for (const e of enemiesIn(B, h.team, h.x, h.y, 1.6)) damage(B, e, (e.kind === 'tower' ? 25 : 60) * m, { source: h, effects: { burn: { dps: 15, dur: 2 } } });
      B.ringFire(h.x, h.y, 1.6);
    } else if (c.id === 'dragonbreath') {
      c.tick = 0.2;
      const t = autoTarget(B, h, 5.5);
      if (t) h.aim = angleTo(h.x, h.y, t.x, t.y);
      coneHit(B, h, h.aim, 5, 0.9, 45 * m, { burn: { dps: 20, dur: 2 } }, true);
      B.flame(h.x + Math.cos(h.aim) * 0.4, h.y - 0.5 + Math.sin(h.aim) * 0.4, h.aim, 5, 6);
    } else if (c.id === 'thunderstorm') {
      c.tick = 2.5 / 8;
      const foes = enemiesIn(B, h.team, h.x, h.y, 3.5);
      const t = foes.length ? foes[Math.floor(Math.random() * foes.length)] : null;
      const x = t ? t.x : h.x + (Math.random() - 0.5) * 5;
      const y = t ? t.y : h.y + (Math.random() - 0.5) * 5;
      B.bolt(x + 0.3, y - 6, x, y - 0.3, '#fff7a8', 3);
      for (const e of enemiesIn(B, h.team, x, y, 0.9)) damage(B, e, (e.kind === 'tower' ? 50 : 160) * m, { source: h, effects: { stun: 0.2 } });
      B.sfx('lightning', { volume: 0.5, pitch: 0.9 + Math.random() * 0.3 });
    }
  }
  if (c.t <= 0) h.channel = null;
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ───────────────────────── gadgets ─────────────────────────

export function gadgetReady(h) {
  return h.alive && h.gadget && h.gadgetCd <= 0 && !isDisabled(h);
}

export function useGadget(B, h) {
  if (!gadgetReady(h)) return false;
  const g = GADGETS[h.gadget];
  h.gadgetCd = g.cd;
  const km = h.km;
  switch (h.gadget) {
    case 'medkit':
      h.status.regen = { hps: (h.maxHp * 0.45) / 2, t: 2 };
      B.sparkle(h.x, h.y - 0.5, 0.8, '#9dffb0', 12);
      B.sfx('heal');
      break;
    case 'jetpack': {
      const a = h.moveTo ? angleTo(h.x, h.y, h.moveTo.x, h.moveTo.y) : h.aim;
      const tx = clamp(h.x + Math.cos(a) * 3.5, 0.6, B.W - 0.6);
      const ty = clamp(h.y + Math.sin(a) * 3.5, 0.6, B.H - 0.6);
      h.dash = { x: tx, y: ty, t: 0.28, a };
      h.jumping = true;
      h.status.invuln = 0.6;
      if (h.moveTo && dist(tx, ty, h.moveTo.x, h.moveTo.y) < 0.6) h.moveTo = null;
      B.puff(h.x, h.y, '#ffd166', 8);
      B.sfx('shoot_rocket', { pitch: 1.4 });
      break;
    }
    case 'frostgrenade': {
      const t = autoTarget(B, h, 5) || { x: h.x + Math.cos(h.aim) * 2.5, y: h.y + Math.sin(h.aim) * 2.5 };
      fireProjectile(B, { team: h.team, source: h, x: h.x, y: h.y - 0.6, tx: t.x, ty: t.y, lob: true, speed: 9, dmg: 60 * km, splash: 1.8, proj: 'iceshard', effects: { freeze: 2.5 }, hitAir: true });
      B.sfx('freeze', { pitch: 1.2 });
      break;
    }
    case 'turret': {
      const tx = clamp(h.x + (h.team === 0 ? 0.6 : -0.6), 0.6, B.W - 0.6);
      B.spawnBuilding(h.team, 'turret', tx, h.y, 1, { lifetime: 14, hp: 300 * km, dmg: 20 * km, deployT: 0.4 });
      B.sfx('build');
      break;
    }
    case 'shield':
      h.shield = 350 * km;
      h.shieldT = 6;
      B.flashRing(h.x, h.y - 0.5, 1, '#7fd7ff');
      B.sfx('magic', { pitch: 1.3 });
      break;
    case 'blackhole': {
      const t = autoTarget(B, h, 5) || { x: h.x + Math.cos(h.aim) * 2.5, y: h.y + Math.sin(h.aim) * 2.5 };
      addArea(B, { kind: 'vortex', team: h.team, x: t.x, y: t.y, radius: 2.2, t: 2.5, dur: 2.5, pull: 2.6, dps: 0, onEnd: () => {
        for (const e of enemiesIn(B, h.team, t.x, t.y, 1.6)) damage(B, e, e.kind === 'tower' ? 60 * km : 200 * km, { source: h });
        B.explosion(t.x, t.y, 1.6, '#a35bff');
      } });
      B.sfx('black_hole');
      break;
    }
    default:
      break;
  }
  B.emit('gadget', { team: h.team, id: h.gadget });
  return true;
}

// ───────────────────────── pets ─────────────────────────

export function createPet(B, hero, petId) {
  const def = PETS[petId];
  if (!def) return null;
  const km = hero.km;
  return {
    id: B.nextId++,
    kind: 'pet',
    petId,
    def,
    sprite: petId,
    team: hero.team,
    owner: hero,
    x: hero.x + 0.8,
    y: hero.y + 0.4,
    r: 0.3,
    h: def.flying ? 0.6 : 0.5,
    hp: def.hp * km,
    maxHp: def.hp * km,
    dmg: def.dmg * km,
    hs: def.hs,
    range: def.range,
    speed: def.speed,
    targets: def.targets,
    flying: !!def.flying,
    proj: def.proj,
    effects: def.effects,
    special: def.special,
    mass: 1,
    alive: true,
    deployT: 0,
    status: {},
    flash: 0,
    facing: 1,
    anim: 'idle',
    age: 0,
    attackCd: 0,
    level: 1,
  };
}

export function updatePet(B, p, dt) {
  p.age += dt;
  p.moving = false;
  const owner = p.owner;
  if (!owner.alive) {
    p.alive = false;
    return;
  }
  if (p.special?.brickEvery) {
    p.brickT = (p.brickT ?? p.special.brickEvery) - dt;
    if (p.brickT <= 0) {
      p.brickT = p.special.brickEvery;
      B.addBricks(p.team, 1, p.x, p.y - 0.4, true);
    }
  }
  if (isDisabled(p)) return;
  // target something near the owner
  let tgt = p.target && p.target.alive && canTarget(p, p.target) && dist(p.target.x, p.target.y, owner.x, owner.y) < 4.5 ? p.target : null;
  if (!tgt && p.targets !== 'none') {
    const t = findTarget(B, p, 3.5);
    tgt = t && dist(t.x, t.y, owner.x, owner.y) < 4.5 ? t : null;
    p.target = tgt;
  }
  if (tgt) {
    if (edgeDist(p, tgt) > p.range) {
      moveToward(B, p, tgt.x, tgt.y, dt, 0);
      p.anim = 'walk';
      return;
    }
    p.facing = tgt.x < p.x ? -1 : 1;
    p.attackCd -= dt * statusMult(p);
    p.anim = 'idle';
    if (p.attackCd <= 0) {
      p.attackCd = p.hs;
      p.anim = 'attack';
      if (p.proj) {
        if (p.proj === 'laser') {
          damage(B, tgt, p.dmg, { source: p, effects: p.effects });
          B.beam(p.x, p.y - 0.8, tgt.x, tgt.y - (tgt.flying ? 0.9 : 0.3), '#ff6a8a', 0.08, 1);
          B.sfx('shoot_laser', { volume: 0.2, pitch: 1.5 });
        } else {
          fireProjectile(B, { team: p.team, source: p, x: p.x, y: p.y - 0.6, target: tgt, speed: 10, dmg: p.dmg, proj: p.proj, effects: p.effects, hitAir: true });
        }
      } else {
        damage(B, tgt, p.dmg, { source: p, effects: p.effects });
        B.spark(tgt.x, tgt.y - 0.4, '#ffffff', 2);
      }
    }
    return;
  }
  // follow the owner
  const side = owner.facing >= 0 ? -1 : 1;
  const fx = owner.x + side * 0.9;
  const fy = owner.y + 0.35;
  if (dist(p.x, p.y, fx, fy) > 0.4) {
    const saved = p.speed;
    if (dist(p.x, p.y, fx, fy) > 3) p.speed *= 1.6;
    moveToward(B, p, fx, fy, dt, 0.3);
    p.speed = saved;
    p.anim = 'walk';
  } else p.anim = 'idle';
  if (dist(p.x, p.y, owner.x, owner.y) > 7) {
    p.x = owner.x + side * 0.9;
    p.y = owner.y + 0.3;
  }
}
