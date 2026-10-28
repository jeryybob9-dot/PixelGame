// Every playable card. Stats are level 1; each level multiplies hp/dmg by LEVEL_MULT.
// Distances are tiles, speeds tiles/second, times seconds.
//
// targets: 'ground' (ground units + buildings), 'both' (air + ground + buildings), 'buildings' (buildings only)
// roles (used by the AI and deck hints): win, tank, dps, splash, air, swarm, support, cycle,
//   spell_small, spell_big, defense, spawner, economy, control, builder

export const RARITIES = ['common', 'rare', 'epic', 'legendary'];
export const RARITY_INFO = {
  common: { name: 'Common', color: 'var(--r-common)', hex: '#b9c3cf' },
  rare: { name: 'Rare', color: 'var(--r-rare)', hex: '#f2a33a' },
  epic: { name: 'Epic', color: 'var(--r-epic)', hex: '#b45be8' },
  legendary: { name: 'Legendary', color: 'var(--r-legendary)', hex: '#3be8d0' },
};

export const MAX_CARD_LEVEL = 10;
export const LEVEL_MULT = 1.1;
export const levelMult = (level) => Math.pow(LEVEL_MULT, Math.max(1, level) - 1);

export const SPEEDS = { slow: 0.75, medium: 1.0, fast: 1.4, veryfast: 2.0 };

/** @type {Record<string, any>} */
export const CARDS = {
  // ───────────────────────────── COMMON ─────────────────────────────
  knight: {
    name: 'Brick Knight', type: 'troop', rarity: 'common', cost: 3, arena: 0, roles: ['tank', 'dps'],
    desc: 'A sturdy blocky swordsman. Soaks up hits and chops anything on the ground.',
    unit: { sprite: 'knight', hp: 690, dmg: 80, hs: 1.2, speed: SPEEDS.medium, range: 0.8, targets: 'ground', radius: 0.45, mass: 4 },
  },
  archers: {
    name: 'Pixel Archers', type: 'troop', rarity: 'common', cost: 3, arena: 0, roles: ['air', 'support'],
    desc: 'Two sharp-eyed archers that shoot air and ground from a safe distance.',
    unit: { sprite: 'archer', count: 2, hp: 125, dmg: 44, hs: 0.9, speed: SPEEDS.medium, range: 5, targets: 'both', radius: 0.35, proj: 'arrow' },
  },
  skeletons: {
    name: 'Skelebones', type: 'troop', rarity: 'common', cost: 1, arena: 0, roles: ['cycle', 'swarm'],
    desc: 'Three rattly skeletons. Cheap, quick and great for distracting big brutes.',
    unit: { sprite: 'skeleton', count: 3, hp: 35, dmg: 35, hs: 1.0, speed: SPEEDS.fast, range: 0.5, targets: 'ground', radius: 0.3, mass: 1 },
  },
  gunners: {
    name: 'Blaster Goblins', type: 'troop', rarity: 'common', cost: 2, arena: 0, roles: ['swarm', 'air', 'dps'],
    desc: 'Three goblins with toy pistols that fire real pixels. Fast and fragile.',
    unit: { sprite: 'gunner', count: 3, hp: 80, dmg: 26, hs: 0.7, speed: SPEEDS.fast, range: 4, targets: 'both', radius: 0.3, proj: 'bullet', mass: 1 },
  },
  bomber: {
    name: 'Bomb Bot', type: 'troop', rarity: 'common', cost: 2, arena: 0, roles: ['splash'],
    desc: 'Lobs fizzing bombs that splash crowds of ground troops.',
    unit: { sprite: 'bomber', hp: 150, dmg: 110, hs: 1.8, speed: SPEEDS.medium, range: 4.5, targets: 'groundonly', radius: 0.4, splash: 1.5, proj: 'bomb' },
  },
  bats: {
    name: 'Bat Swarm', type: 'troop', rarity: 'common', cost: 2, arena: 0, roles: ['swarm', 'air', 'cycle'],
    desc: 'Five squeaky bats. They fly over the river and nibble anything.',
    unit: { sprite: 'bat', count: 5, flying: true, hp: 35, dmg: 35, hs: 1.0, speed: SPEEDS.veryfast, range: 0.5, targets: 'both', radius: 0.28, mass: 0.5 },
  },
  builder: {
    name: 'Builders', type: 'troop', rarity: 'common', cost: 2, arena: 0, roles: ['builder', 'economy'],
    desc: 'Two hard-hat builders join your tribe as villagers who mine, build and pray. In Arena Duel they mine brick piles for your King.',
    unit: { sprite: 'builder', count: 2, hp: 160, dmg: 25, hs: 1.0, speed: 1.2, range: 0.6, targets: 'ground', radius: 0.35, special: { builder: { carry: 12, mineTime: 1.6 } } },
  },
  sheep: {
    name: 'Boom Sheep', type: 'troop', rarity: 'common', cost: 2, arena: 1, roles: ['swarm', 'cycle', 'win'],
    desc: 'Three woolly sheep stuffed with fireworks. They charge and go BAA-BOOM on contact.',
    unit: { sprite: 'sheep', count: 3, hp: 90, dmg: 95, hs: 0.2, speed: SPEEDS.veryfast, range: 0.4, targets: 'ground', radius: 0.35, splash: 1.2, special: { kamikaze: true } },
  },
  volley: {
    name: 'Pixel Volley', type: 'spell', rarity: 'common', cost: 3, arena: 0, roles: ['spell_small'],
    desc: 'A rain of arrows over a wide area. Shreds swarms.',
    spell: { kind: 'volley', radius: 2.5, dmg: 130, towerMult: 0.35, delay: 0.6 },
  },
  spark: {
    name: 'Spark', type: 'spell', rarity: 'common', cost: 2, arena: 0, roles: ['spell_small', 'control'],
    desc: 'A crackling jolt that stuns everything in a small circle for a moment.',
    spell: { kind: 'spark', radius: 2.0, dmg: 90, towerMult: 0.35, stun: 0.5 },
  },
  wall: {
    name: 'Brick Wall', type: 'spell', rarity: 'common', cost: 2, arena: 1, roles: ['defense', 'control'],
    desc: 'Snap together a 5-brick wall on your side. Ground troops must smash through it.',
    spell: { kind: 'wall', width: 5, hp: 700, lifetime: 20, ownSideOnly: true },
  },
  bricktower: {
    name: 'Brick Tower', type: 'building', rarity: 'common', cost: 3, arena: 0, roles: ['defense', 'air'],
    desc: 'A little turret built from bricks. Shoots air and ground until it crumbles.',
    building: { sprite: 'bricktower', hp: 900, dmg: 85, hs: 0.8, range: 6, targets: 'both', lifetime: 30, radius: 0.6, proj: 'brick' },
  },
  cannon: {
    name: 'Brick Cannon', type: 'building', rarity: 'common', cost: 3, arena: 0, roles: ['defense'],
    desc: 'A heavy cannon that pulls building-chasers away from your towers.',
    building: { sprite: 'cannon', hp: 750, dmg: 130, hs: 1.0, range: 5.5, targets: 'groundonly', lifetime: 30, radius: 0.6, proj: 'bomb' },
  },

  // ───────────────────────────── RARE ─────────────────────────────
  giant: {
    name: 'Stone Giant', type: 'troop', rarity: 'rare', cost: 5, arena: 0, roles: ['tank', 'win'],
    desc: 'A lumbering boulder of a fellow who only cares about smashing buildings.',
    unit: { sprite: 'giant', hp: 2400, dmg: 140, hs: 1.5, speed: SPEEDS.slow, range: 1.0, targets: 'buildings', radius: 0.75, mass: 18 },
  },
  minigunner: {
    name: 'Minigunner', type: 'troop', rarity: 'rare', cost: 4, arena: 0, roles: ['dps', 'air'],
    desc: 'Spins up a pixel minigun. Slow to start, then a storm of bullets.',
    unit: { sprite: 'minigunner', hp: 520, dmg: 16, hs: 0.12, speed: SPEEDS.medium, range: 4.5, targets: 'both', radius: 0.45, proj: 'bullet', special: { spinup: 1.0 } },
  },
  meteor: {
    name: 'Meteor', type: 'spell', rarity: 'rare', cost: 4, arena: 0, roles: ['spell_big'],
    desc: 'Call down a flaming rock. Huge damage and it leaves the ground burning.',
    spell: { kind: 'meteor', radius: 2.5, dmg: 480, towerMult: 0.3, delay: 1.0, burnGround: { dps: 30, dur: 6 } },
  },
  boarrider: {
    name: 'Boar Rider', type: 'troop', rarity: 'rare', cost: 4, arena: 1, roles: ['win'],
    desc: 'Charges straight for buildings and hops right over the river.',
    unit: { sprite: 'boarrider', hp: 850, dmg: 160, hs: 1.6, speed: SPEEDS.veryfast, range: 0.8, targets: 'buildings', radius: 0.5, mass: 6, special: { jumpsRiver: true } },
  },
  flamer: {
    name: 'Flame Trooper', type: 'troop', rarity: 'rare', cost: 4, arena: 1, roles: ['splash', 'dps'],
    desc: 'Sprays a cone of fire that sets ground troops ablaze.',
    unit: { sprite: 'flamer', hp: 620, dmg: 22, hs: 0.25, speed: SPEEDS.medium, range: 2.5, targets: 'groundonly', radius: 0.45, proj: 'flame', splash: 0.9, effects: { burn: { dps: 20, dur: 3 } } },
  },
  quake: {
    name: 'Earthquake', type: 'spell', rarity: 'rare', cost: 3, arena: 1, roles: ['spell_small', 'control'],
    desc: 'The ground shakes for 3 seconds. Brutal against buildings, slows troops.',
    spell: { kind: 'quake', radius: 3.5, duration: 3, dps: 70, buildingDps: 210, slow: 0.3 },
  },
  crypt: {
    name: 'Bone Crypt', type: 'building', rarity: 'rare', cost: 3, arena: 1, roles: ['spawner', 'defense'],
    desc: 'A spooky crypt that keeps spitting out skeletons. Releases a few more when destroyed.',
    building: { sprite: 'crypt', hp: 520, lifetime: 30, radius: 0.7, spawn: { card: 'skeletons', unit: 'skeleton', every: 3.2, count: 1, onDeath: 3 } },
  },
  icemage: {
    name: 'Ice Mage', type: 'troop', rarity: 'rare', cost: 3, arena: 2, roles: ['support', 'control', 'air'],
    desc: 'Frosty bolts chill enemies, slowing their steps and their swings.',
    unit: { sprite: 'icemage', hp: 380, dmg: 60, hs: 1.4, speed: SPEEDS.medium, range: 5, targets: 'both', radius: 0.4, proj: 'iceshard', splash: 1.0, effects: { slow: { pct: 0.35, dur: 1.5 } } },
  },
  sniper: {
    name: 'Rail Sniper', type: 'troop', rarity: 'rare', cost: 4, arena: 2, roles: ['dps', 'air'],
    desc: 'Huge range, huge damage, slow reload. The rail shot pierces everything in a line.',
    unit: { sprite: 'sniper', hp: 320, dmg: 320, hs: 3.0, speed: SPEEDS.medium, range: 9, targets: 'both', radius: 0.4, proj: 'rail', special: { pierce: true } },
  },
  tesla: {
    name: 'Tesla Coil', type: 'building', rarity: 'rare', cost: 4, arena: 2, roles: ['defense', 'air'],
    desc: 'Hides underground until enemies come close, then zaps up to three targets.',
    building: { sprite: 'tesla', hp: 650, dmg: 90, hs: 1.1, range: 5.5, targets: 'both', lifetime: 35, radius: 0.55, proj: 'zap', special: { hidden: true, chain: { n: 2, falloff: 0.7 } } },
  },
  monk: {
    name: 'Healer Monk', type: 'troop', rarity: 'rare', cost: 4, arena: 3, roles: ['support'],
    desc: 'A calm monk who heals every friend around him while bonking foes with a staff.',
    unit: { sprite: 'monk', hp: 600, dmg: 50, hs: 1.2, speed: SPEEDS.medium, range: 0.8, targets: 'ground', radius: 0.4, special: { heal: { radius: 3, hps: 50 } } },
  },
  bless: {
    name: 'Blessing', type: 'spell', rarity: 'rare', cost: 3, arena: 3, roles: ['spell_small', 'support'],
    desc: 'A golden glow heals your units and fills them with rage for 5 seconds.',
    spell: { kind: 'bless', radius: 3, heal: 320, rage: { pct: 0.35, dur: 5 } },
  },
  mine: {
    name: 'Brick Well', type: 'building', rarity: 'rare', cost: 6, arena: 4, roles: ['economy'],
    desc: 'Pumps out bricks over time. Protect it and it pays for itself.',
    building: { sprite: 'mine', hp: 800, lifetime: 70, radius: 0.7, special: { elixirEvery: 8.5, bricksEvery: 5, bricks: 6 } },
  },

  // ───────────────────────────── EPIC ─────────────────────────────
  dragon: {
    name: 'Fire Dragon', type: 'troop', rarity: 'epic', cost: 4, arena: 0, roles: ['splash', 'air'],
    desc: 'A young dragon breathing splashy fireballs from the sky.',
    unit: { sprite: 'dragon', flying: true, hp: 950, dmg: 120, hs: 1.6, speed: SPEEDS.fast, range: 3.5, targets: 'both', radius: 0.6, proj: 'fireball', splash: 1.2, effects: { burn: { dps: 15, dur: 2 } }, mass: 6 },
  },
  necro: {
    name: 'Necromancer', type: 'troop', rarity: 'epic', cost: 5, arena: 1, roles: ['spawner', 'support', 'air'],
    desc: 'Hurls bone bolts and raises two skeletons every few seconds.',
    unit: { sprite: 'necro', hp: 650, dmg: 85, hs: 1.5, speed: SPEEDS.medium, range: 5, targets: 'both', radius: 0.45, proj: 'bone', special: { summon: { unit: 'skeleton', card: 'skeletons', every: 6, count: 2 } } },
  },
  rocketeer: {
    name: 'Rocket Trooper', type: 'troop', rarity: 'epic', cost: 5, arena: 1, roles: ['splash', 'dps'],
    desc: 'Fires big slow rockets. Extra damage against buildings.',
    unit: { sprite: 'rocketeer', hp: 520, dmg: 230, hs: 2.4, speed: SPEEDS.medium, range: 6, targets: 'groundonly', radius: 0.45, proj: 'rocket', splash: 1.5, special: { buildingMult: 1.5 } },
  },
  blizzard: {
    name: 'Blizzard', type: 'spell', rarity: 'epic', cost: 4, arena: 2, roles: ['spell_small', 'control'],
    desc: 'A sudden snowstorm freezes everything in the area for 4 seconds.',
    spell: { kind: 'blizzard', radius: 3.0, dmg: 100, towerMult: 0.3, freeze: 4 },
  },
  zombies: {
    name: 'Zombie Horde', type: 'troop', rarity: 'epic', cost: 5, arena: 3, roles: ['swarm', 'dps'],
    desc: 'Four shambling zombies. Enemy troops they defeat get back up as zombies on your side!',
    unit: { sprite: 'zombie', count: 4, hp: 230, dmg: 60, hs: 1.2, speed: SPEEDS.slow, range: 0.6, targets: 'ground', radius: 0.38, special: { infect: true } },
  },
  acid: {
    name: 'Acid Rain', type: 'spell', rarity: 'epic', cost: 4, arena: 3, roles: ['spell_small'],
    desc: 'A sour green cloud rains acid for 8 seconds. Slow but it melts everything.',
    spell: { kind: 'acid', radius: 3.5, duration: 8, dps: 40, towerMult: 0.3, slow: 0.15 },
  },
  ninja: {
    name: 'Shadow Ninja', type: 'troop', rarity: 'epic', cost: 3, arena: 4, roles: ['dps'],
    desc: 'Invisible until he strikes, then dashes from foe to foe.',
    unit: { sprite: 'ninja', hp: 520, dmg: 150, hs: 1.0, speed: SPEEDS.fast, range: 0.8, targets: 'ground', radius: 0.4, special: { stealth: true, dash: 4 } },
  },
  ufo: {
    name: 'UFO Saucer', type: 'troop', rarity: 'epic', cost: 5, arena: 4, roles: ['dps', 'control'],
    desc: 'Lasers ground targets from above and beams up small enemies every 7 seconds.',
    unit: { sprite: 'ufo', flying: true, hp: 850, dmg: 75, hs: 0.6, speed: SPEEDS.medium, range: 3, targets: 'groundonly', radius: 0.6, proj: 'laser', special: { abduct: { every: 7, maxHp: 300 } }, mass: 5 },
  },
  lightning: {
    name: 'Lightning', type: 'spell', rarity: 'epic', cost: 6, arena: 4, roles: ['spell_big'],
    desc: 'Three bolts strike the toughest enemies in the area.',
    spell: { kind: 'lightning', radius: 3.5, strikes: 3, dmg: 720, towerMult: 0.3, stun: 0.5 },
  },
  crab: {
    name: 'Giant Crab', type: 'troop', rarity: 'epic', cost: 6, arena: 5, roles: ['tank', 'dps'],
    desc: 'A colossal crab whose pinch knocks troops flying. Three babies scuttle out when it falls.',
    unit: { sprite: 'crab', hp: 2800, dmg: 210, hs: 1.7, speed: SPEEDS.slow, range: 1.0, targets: 'ground', radius: 0.85, mass: 20, effects: { knockback: 1.2 }, special: { deathSpawn: { unit: 'babycrab', count: 3 } } },
  },

  // ───────────────────────────── LEGENDARY ─────────────────────────────
  mech: {
    name: 'Brick Mech', type: 'troop', rarity: 'legendary', cost: 6, arena: 2, roles: ['tank', 'splash', 'air'],
    desc: 'A walking fortress of bricks firing rocket volleys at anything in range.',
    unit: { sprite: 'mech', hp: 2600, dmg: 160, hs: 1.6, speed: SPEEDS.slow, range: 5, targets: 'both', radius: 0.8, proj: 'rocket', splash: 1.3, mass: 20 },
  },
  plague: {
    name: 'Plague', type: 'spell', rarity: 'legendary', cost: 4, arena: 3, roles: ['spell_small'],
    desc: 'A sickly cloud infects enemies. The sickness spreads from troop to troop.',
    spell: { kind: 'plague', radius: 2.5, dps: 45, duration: 6, spread: 1.4, towerMult: 0.3 },
  },
  titan: {
    name: 'Thunder Titan', type: 'troop', rarity: 'legendary', cost: 5, arena: 4, roles: ['tank', 'dps', 'splash'],
    desc: 'Every punch chains lightning to three nearby foes and stuns them.',
    unit: { sprite: 'titan', hp: 1900, dmg: 150, hs: 1.4, speed: SPEEDS.medium, range: 1.2, targets: 'ground', radius: 0.75, mass: 16, special: { chain: { n: 3, falloff: 0.6, stun: 0.3 } } },
  },
  phoenix: {
    name: 'Phoenix', type: 'troop', rarity: 'legendary', cost: 4, arena: 5, roles: ['air', 'splash'],
    desc: 'A blazing bird. When it falls it becomes an egg, and the egg hatches a new Phoenix.',
    unit: { sprite: 'phoenix', flying: true, hp: 760, dmg: 110, hs: 1.2, speed: SPEEDS.fast, range: 2.5, targets: 'both', radius: 0.55, proj: 'fireball', splash: 0.8, effects: { burn: { dps: 20, dur: 2 } }, special: { rebirth: true } },
  },
  bonedragon: {
    name: 'Bone Dragon', type: 'troop', rarity: 'legendary', cost: 6, arena: 5, roles: ['air', 'splash', 'tank'],
    desc: 'An ancient skeletal dragon. Bursts into a swarm of bats when destroyed.',
    unit: { sprite: 'bonedragon', flying: true, hp: 1600, dmg: 190, hs: 2.0, speed: SPEEDS.medium, range: 3.5, targets: 'both', radius: 0.75, proj: 'bone', splash: 1.3, mass: 12, special: { deathSpawn: { unit: 'bat', count: 5 } } },
  },
  blackhole: {
    name: 'Black Hole', type: 'spell', rarity: 'legendary', cost: 5, arena: 6, roles: ['spell_big', 'control'],
    desc: 'Opens a swirling void that drags everything in, then collapses with a crunch.',
    spell: { kind: 'blackhole', radius: 4, duration: 2.5, pull: 3.2, dmg: 320, towerMult: 0.3 },
  },
  nuke: {
    name: 'Tiny Nuke', type: 'spell', rarity: 'legendary', cost: 7, arena: 7, roles: ['spell_big'],
    desc: 'Wipes out EVERY troop in a huge radius, yours too! Leaves wasteland nobody can deploy on.',
    spell: { kind: 'nuke', radius: 5, dmg: 1100, towerMult: 0.3, delay: 1.6, friendlyFire: true, wasteland: 6 },
  },
};

// Units that appear only as summons / transformations (not playable cards).
export const EXTRA_UNITS = {
  babycrab: { sprite: 'babycrab', hp: 140, dmg: 45, hs: 1.0, speed: SPEEDS.fast, range: 0.6, targets: 'ground', radius: 0.32, costShare: 0.6 },
  phoenix_egg: { sprite: 'phoenix_egg', hp: 220, dmg: 0, hs: 99, speed: 0, range: 0, targets: 'none', radius: 0.35, special: { hatch: 3 }, costShare: 1 },
  turret: { sprite: 'turret', hp: 300, dmg: 20, hs: 0.25, range: 5, targets: 'both', radius: 0.35, proj: 'bullet' },
};

for (const [id, c] of Object.entries(CARDS)) c.id = id;

export const CARD_IDS = Object.keys(CARDS);

/** Unit stats for a card id or an extra unit id. */
export function unitDef(id) {
  return CARDS[id]?.unit ?? EXTRA_UNITS[id] ?? null;
}

/** Number of copies needed to upgrade FROM level L (index L-1) by rarity. */
export const UPGRADE_CARDS = {
  common: [2, 4, 10, 20, 50, 100, 200, 400, 800],
  rare: [1, 2, 5, 10, 25, 50, 100, 200, 400],
  epic: [1, 1, 2, 4, 8, 15, 30, 60, 120],
  legendary: [1, 1, 1, 2, 3, 5, 8, 12, 20],
};
export const UPGRADE_GOLD = [5, 20, 50, 150, 400, 1000, 2000, 4000, 8000];
export const UPGRADE_GOLD_RARITY = { common: 1, rare: 1.5, epic: 2.5, legendary: 4 };
export const UPGRADE_XP = [4, 5, 6, 10, 25, 50, 100, 200, 400];

export function upgradeCost(card, level) {
  if (level >= MAX_CARD_LEVEL) return null;
  const i = level - 1;
  return {
    cards: UPGRADE_CARDS[card.rarity][i],
    gold: Math.round(UPGRADE_GOLD[i] * UPGRADE_GOLD_RARITY[card.rarity]),
    xp: UPGRADE_XP[i],
  };
}

/** Rough stat lines shown in card detail screens. */
export function cardStatLines(card, level = 1) {
  const m = levelMult(level);
  const lines = [];
  const u = card.unit;
  const b = card.building;
  const s = card.spell;
  const tgt = { ground: 'Ground', groundonly: 'Ground', both: 'Air & Ground', buildings: 'Buildings', none: '—' };
  const speedName = (v) => (v >= 2 ? 'Very Fast' : v >= 1.3 ? 'Fast' : v >= 0.95 ? 'Medium' : 'Slow');
  if (u) {
    lines.push(['Hitpoints', Math.round(u.hp * m)]);
    if (u.dmg) lines.push([u.splash ? 'Area Damage' : 'Damage', Math.round(u.dmg * m)]);
    if (u.dmg) lines.push(['Hit Speed', `${u.hs}s`]);
    if (u.dmg && u.hs) lines.push(['DPS', Math.round((u.dmg * m) / u.hs)]);
    lines.push(['Speed', speedName(u.speed)]);
    lines.push(['Range', u.range < 1.3 ? 'Melee' : u.range]);
    lines.push(['Targets', tgt[u.targets] ?? u.targets]);
    if (u.count > 1) lines.push(['Count', `x${u.count}`]);
    if (u.flying) lines.push(['Moves', 'Flying']);
  }
  if (b) {
    lines.push(['Hitpoints', Math.round(b.hp * m)]);
    if (b.dmg) lines.push(['Damage', Math.round(b.dmg * m)]);
    if (b.dmg) lines.push(['Hit Speed', `${b.hs}s`]);
    if (b.range) lines.push(['Range', b.range]);
    if (b.targets) lines.push(['Targets', tgt[b.targets] ?? b.targets]);
    lines.push(['Lifetime', `${b.lifetime}s`]);
    if (b.spawn) lines.push(['Spawns', `1 every ${b.spawn.every}s`]);
    if (b.special?.elixirEvery) lines.push(['Bricks', `+10 every ${b.special.elixirEvery}s`]);
  }
  if (s) {
    if (s.dmg) lines.push(['Damage', Math.round(s.dmg * m)]);
    if (s.dps) lines.push(['Damage/sec', Math.round(s.dps * m)]);
    if (s.towerMult && (s.dmg || s.dps)) lines.push(['Tower Damage', Math.round((s.dmg || s.dps) * m * s.towerMult)]);
    if (s.radius) lines.push(['Radius', s.radius]);
    if (s.duration) lines.push(['Duration', `${s.duration}s`]);
    if (s.freeze) lines.push(['Freeze', `${s.freeze}s`]);
    if (s.stun) lines.push(['Stun', `${s.stun}s`]);
    if (s.heal) lines.push(['Heal', Math.round(s.heal * m)]);
    if (s.hp) lines.push(['Wall HP', Math.round(s.hp * m)]);
  }
  return lines;
}
