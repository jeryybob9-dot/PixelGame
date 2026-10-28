// Hero weapons (the Armory). Damage is per projectile/pellet/tick at weapon level 1.
// rate = shots per second, range in tiles, mobility = movement speed multiplier while equipped.
//
// fire modes:
//   bullet   - single homing projectile
//   pellets  - several projectiles in a spread
//   cone     - short-range spray that hits everything in a cone (flamethrower / acid)
//   beam     - continuous ray on one target
//   melee    - instant hit in an arc in front of the hero
//   chain    - instant zap that jumps between targets
//   lob      - arcing projectile with area damage on landing

export const WEAPON_CATEGORIES = ['Primary', 'Backup', 'Melee', 'Special', 'Sniper', 'Heavy'];
export const WEAPON_MAX_LEVEL = 10;
export const WEAPON_LEVEL_MULT = 1.09;
export const WEAPON_UPGRADE_GOLD = [100, 200, 400, 800, 1600, 3000, 5000, 8000, 12000];

/** @type {Record<string, any>} */
export const WEAPONS = {
  rifle: {
    name: 'Block Rifle', cat: 'Primary', rarity: 'common', price: { owned: true },
    desc: 'Reliable all-rounder. Steady damage at medium range.',
    mode: 'bullet', proj: 'bullet', dmg: 26, rate: 4, range: 5, mag: 30, reload: 1.6, mobility: 1, sfx: 'shoot_rifle',
  },
  pistols: {
    name: 'Twin Pixel Pistols', cat: 'Backup', rarity: 'common', price: { owned: true },
    desc: 'Two pistols firing in turn. Light, so you run faster.',
    mode: 'bullet', proj: 'bullet', dmg: 16, rate: 7, range: 4, mag: 24, reload: 1.2, mobility: 1.1, sfx: 'shoot_pistol',
  },
  shotgun: {
    name: 'Block Buster', cat: 'Backup', rarity: 'rare', price: { gold: 600 },
    desc: 'Six pellets per blast. Devastating up close.',
    mode: 'pellets', proj: 'bullet', pellets: 6, spread: 0.5, dmg: 15, rate: 1.1, range: 3, mag: 6, reload: 2.0, mobility: 1, sfx: 'shoot_shotgun',
    effects: { knockback: 0.25 },
  },
  brickblaster: {
    name: 'Brick Blaster', cat: 'Primary', rarity: 'rare', price: { gold: 800 },
    desc: 'Launches chunky bricks that knock enemies back and splash a little.',
    mode: 'bullet', proj: 'brick', dmg: 58, rate: 1.6, range: 4.5, mag: 8, reload: 1.8, mobility: 1, splash: 0.6, sfx: 'shoot_rifle',
    effects: { knockback: 0.4 },
  },
  katana: {
    name: 'Pixel Katana', cat: 'Melee', rarity: 'epic', price: { gold: 2000 },
    desc: 'Slashes in an arc and makes enemies bleed. You move much faster.',
    mode: 'melee', dmg: 72, rate: 2.2, range: 1.3, arc: 1.6, mag: 0, mobility: 1.2, sfx: 'sword_slash',
    effects: { bleed: { dps: 10, dur: 3 } },
  },
  hammer: {
    name: 'Brick Hammer', cat: 'Melee', rarity: 'rare', price: { gold: 900 },
    desc: 'A big slow smash that hits everything around and stuns briefly.',
    mode: 'melee', dmg: 125, rate: 0.9, range: 1.4, arc: 3.2, mag: 0, mobility: 1.05, sfx: 'melee_hit',
    effects: { stun: 0.3 },
  },
  flameblaster: {
    name: 'Flame Blaster', cat: 'Special', rarity: 'rare', price: { gold: 1000 },
    desc: 'A roaring cone of fire. Burns everything in front of you.',
    mode: 'cone', dmg: 9, rate: 10, range: 3, arc: 0.9, mag: 60, reload: 2.2, mobility: 0.95, sfx: 'shoot_flame',
    effects: { burn: { dps: 16, dur: 3 } },
  },
  toxicsprayer: {
    name: 'Toxic Sprayer', cat: 'Special', rarity: 'rare', price: { gold: 1100 },
    desc: 'Sprays bubbling goo. Poisoned enemies take damage and heal less.',
    mode: 'cone', dmg: 8, rate: 6, range: 3.5, arc: 0.7, mag: 48, reload: 2.0, mobility: 1, sfx: 'poison',
    effects: { poison: { dps: 20, dur: 4 } },
  },
  frostray: {
    name: 'Frost Ray', cat: 'Special', rarity: 'epic', price: { gold: 2200 },
    desc: 'A freezing beam. Keep it on a target to slow it down to a crawl.',
    mode: 'beam', dmg: 12, rate: 8, range: 4, mag: 80, reload: 2.4, mobility: 1, sfx: 'shoot_laser',
    effects: { slow: { pct: 0.35, dur: 1.5 } },
  },
  zapper: {
    name: 'Chain Zapper', cat: 'Special', rarity: 'epic', price: { gold: 2400 },
    desc: 'Lightning arcs from target to target, up to three of them.',
    mode: 'chain', dmg: 42, rate: 1.8, range: 4.5, chain: 3, falloff: 0.8, mag: 12, reload: 1.8, mobility: 1, sfx: 'shoot_zap',
    effects: { stun: 0.15 },
  },
  leechgun: {
    name: 'Leech Rifle', cat: 'Primary', rarity: 'epic', price: { gems: 300 },
    desc: 'Every hit heals you for a third of the damage.',
    mode: 'bullet', proj: 'bullet', dmg: 30, rate: 3, range: 5, mag: 24, reload: 1.7, mobility: 1, sfx: 'shoot_laser',
    effects: { lifesteal: 0.35 },
  },
  railsniper: {
    name: 'Rail Sniper', cat: 'Sniper', rarity: 'epic', price: { gold: 3000 },
    desc: 'Huge range. The rail pierces everything in a line and can crit for 150%.',
    mode: 'bullet', proj: 'rail', dmg: 260, rate: 0.5, range: 9, mag: 5, reload: 2.5, mobility: 0.95, crit: { chance: 0.25, mult: 1.5 }, sfx: 'shoot_sniper',
    effects: { pierce: true },
  },
  minigun: {
    name: 'Mega Minigun', cat: 'Heavy', rarity: 'epic', price: { gold: 3200 },
    desc: 'Spins up for a second, then shreds everything. Heavy to carry.',
    mode: 'bullet', proj: 'bullet', dmg: 12, rate: 14, range: 4.5, mag: 150, reload: 3, spinup: 1.2, mobility: 0.8, sfx: 'shoot_minigun',
  },
  rocketlauncher: {
    name: 'Rocket Launcher', cat: 'Heavy', rarity: 'rare', price: { gold: 1500 },
    desc: 'Big area damage and +50% against buildings.',
    mode: 'bullet', proj: 'rocket', dmg: 150, rate: 0.7, range: 6, mag: 4, reload: 2.4, splash: 1.5, buildingMult: 1.5, mobility: 0.85, sfx: 'shoot_rocket',
  },
  unicorngun: {
    name: 'Rainbow Launcher', cat: 'Special', rarity: 'legendary', price: { gems: 600 },
    desc: 'Fires a sparkly rainbow that bounces between three enemies. Ridiculous and deadly.',
    mode: 'bullet', proj: 'rainbow', dmg: 48, rate: 2, range: 5, mag: 16, reload: 1.8, bounce: 3, splash: 0.6, mobility: 1.05, sfx: 'magic',
  },
  singularity: {
    name: 'Singularity Cannon', cat: 'Heavy', rarity: 'legendary', price: { gems: 750 },
    desc: 'Each shot opens a mini black hole that pulls enemies together.',
    mode: 'lob', proj: 'void', dmg: 90, rate: 0.45, range: 5.5, mag: 3, reload: 2.6, splash: 1.8, mobility: 0.85, sfx: 'black_hole',
    effects: { vortex: { dur: 1.5, pull: 2.4, dps: 40 } },
  },
  sheeplauncher: {
    name: 'Sheep Launcher', cat: 'Heavy', rarity: 'legendary', price: { gems: 700 },
    desc: 'Lobs an explosive sheep. Baa. BOOM.',
    mode: 'lob', proj: 'sheep', dmg: 210, rate: 0.6, range: 6, mag: 4, reload: 2.4, splash: 1.6, mobility: 0.9, sfx: 'sheep',
  },
};

for (const [id, w] of Object.entries(WEAPONS)) w.id = id;
export const WEAPON_IDS = Object.keys(WEAPONS);
export const weaponLevelMult = (lvl) => Math.pow(WEAPON_LEVEL_MULT, Math.max(1, lvl) - 1);

/** Normalised 0..1 bars for the armory screen. */
export function weaponBars(w, lvl = 1) {
  const pellets = w.pellets || 1;
  const dps = w.dmg * weaponLevelMult(lvl) * w.rate * pellets;
  return {
    damage: Math.min(1, (w.dmg * pellets * weaponLevelMult(lvl)) / 300),
    fireRate: Math.min(1, w.rate / 14),
    dps: Math.min(1, dps / 260),
    range: Math.min(1, w.range / 9),
    mobility: Math.min(1, (w.mobility - 0.6) / 0.7),
  };
}

export const EFFECT_TAGS = {
  burn: 'Burning', poison: 'Poison', bleed: 'Bleeding', slow: 'Slowdown', stun: 'Stun', knockback: 'Knockback',
  lifesteal: 'Lifesteal', pierce: 'Piercing', vortex: 'Black Hole',
};

export function weaponTags(w) {
  const tags = [];
  if (w.splash) tags.push('Area Damage');
  if (w.pellets) tags.push('Spread');
  if (w.mode === 'chain') tags.push('Chain');
  if (w.bounce) tags.push('Ricochet');
  if (w.crit) tags.push('Critical');
  if (w.spinup) tags.push('Spin-up');
  if (w.buildingMult) tags.push('Anti-Building');
  for (const k of Object.keys(w.effects || {})) if (EFFECT_TAGS[k]) tags.push(EFFECT_TAGS[k]);
  return tags;
}
