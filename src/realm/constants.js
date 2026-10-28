// Realm Clash rules: map size, timings, Ages, buildings and relics. See docs/DESIGN.md.

export const REALM_W = 40;
export const REALM_H = 64;

/** Terrain tile ids (must match REALM_TILES in src/art/realm-tiles.js). */
export const T = { DEEP: 0, WATER: 1, SAND: 2, GRASS: 3, FOREST: 4, HILL: 5, MOUNTAIN: 6, ASH: 7, SNOW: 8, LAVA: 9, MUD: 10, CRYSTAL: 11, PATH: 12 };

/** Tiles nothing can walk on (flyers ignore terrain). */
export const BLOCKING = new Set([T.DEEP, T.WATER, T.MOUNTAIN, T.LAVA, T.CRYSTAL]);
/** Movement speed multiplier per tile. */
export const TILE_SPEED = { [T.MUD]: 0.65, [T.FOREST]: 0.85, [T.SNOW]: 0.9, [T.PATH]: 1.15, [T.SAND]: 0.95 };
/** Tiles buildings may stand on. */
export const BUILDABLE = new Set([T.SAND, T.GRASS, T.HILL, T.ASH, T.SNOW, T.MUD, T.PATH]);

export const WILD = 2; // team id for nests, monsters and critters

export const MATCH_LENGTH = 480;
export const AGES = [
  { id: 'dawn', name: 'Age of Dawn', at: 0, color: '#ffd9a0', blurb: 'Build your village' },
  { id: 'bricks', name: 'Age of Bricks', at: 90, color: '#ff9b5a', blurb: 'Deposits glitter (+50% bricks)' },
  { id: 'war', name: 'Age of War', at: 210, color: '#ff5a4d', blurb: 'Barracks train twice as fast' },
  { id: 'chaos', name: 'Age of Chaos', at: 360, color: '#c77dff', blurb: 'Faith x2. Disasters strike!' },
];
export function ageIndexAt(time) {
  let i = 0;
  for (let k = 0; k < AGES.length; k++) if (time >= AGES[k].at) i = k;
  return i;
}

// Day/night: from the Age of Bricks on, every DAY_LENGTH seconds the last NIGHT_LENGTH are night.
export const DAY_LENGTH = 80;
export const NIGHT_LENGTH = 25;

export const FAITH_MAX = 10;
export const FAITH_START = 5;
export const FAITH_BASE = 0.25; // per second
export const FAITH_PER_VILLAGER = 0.012;
export const FAITH_PER_TEMPLE = 0.08;
export const FAITH_SHRINE = 0.1;

export const BRICKS_START = 60;
export const BRICK_TRICKLE = 3; // seconds per passive brick
export const CARRY = 4;
export const MINE_TIME = 2.6;
export const VILLAGER_EVERY = 10;
export const KEEP_POP = 6;
export const HOUSE_POP = 4;
export const START_VILLAGERS = 4;
export const HERO_RESPAWN = 6;
export const HERO_KILL_BRICKS = 20;
export const NEST_BRICKS = 40;
export const SUMMON_HERO_RADIUS = 4;
export const ELEMENT_COST = 80;

export const VILLAGER = { hp: 120, dmg: 12, hs: 1.1, speed: 1.45, range: 0.5, radius: 0.3 };
export const WARRIOR = { sprite: 'knight', hp: 520, dmg: 62, hs: 1.1, speed: 1.15, range: 0.6, radius: 0.4, targets: 'ground', mass: 4, costShare: 2 };

/**
 * Buildings villagers construct. size = footprint in tiles (w x h), centred on (x, y).
 * claim = territory radius. sprite = art key drawn bottom-centre on the footprint.
 */
export const STRUCTURES = {
  keep: { name: 'Keep', cost: 0, w: 3, h: 3, hp: 4200, claim: 8, build: 0, sprite: 'keep', dmg: 70, hs: 1.0, range: 7, desc: 'Your heart. Shoots, stores bricks and births villagers. If it falls, you lose.' },
  house: { name: 'House', cost: 25, w: 2, h: 2, hp: 450, claim: 3, build: 6, sprite: 'house', desc: '+4 population cap.' },
  barracks: { name: 'Barracks', cost: 70, w: 3, h: 2, hp: 950, claim: 3, build: 12, sprite: 'barracks', desc: 'Trains Warriors (up to 5) while you have room.' },
  tower: { name: 'Watchtower', cost: 45, w: 2, h: 2, hp: 850, claim: 4, build: 9, sprite: 'princess_tower', dmg: 44, hs: 0.85, range: 6.5, desc: 'Archer tower. Tap it to give it an element.' },
  temple: { name: 'Temple', cost: 60, w: 2, h: 2, hp: 650, claim: 3, build: 10, sprite: 'temple', desc: 'A priest prays here for extra Faith.' },
  outpost: { name: 'Outpost', cost: 35, w: 1, h: 1, hp: 380, claim: 6, build: 6, sprite: 'banner', desc: 'Claims land far out and stores bricks.' },
  wall: { name: 'Wall', cost: 4, w: 1, h: 1, hp: 600, claim: 0, build: 1.5, sprite: 'wall', desc: 'Blocks everyone. Enemies must smash through.' },
};
export const BUILD_MENU = ['house', 'barracks', 'tower', 'temple', 'outpost', 'wall'];
export const BARRACKS_EVERY = 16;
export const BARRACKS_MAX = 5;

export const NEST = { hp: 1500, claim: 0, leash: 6, keep: 3, every: 9 };
export const MONSTERS = {
  wolf: { sprite: 'wolf', hp: 260, dmg: 38, hs: 0.8, speed: 1.9, range: 0.5, radius: 0.36, targets: 'ground', mass: 2, costShare: 1.4 },
  bandit: { sprite: 'bandit', hp: 380, dmg: 55, hs: 1.2, speed: 1.3, range: 0.55, radius: 0.38, targets: 'ground', mass: 3, costShare: 1.8 },
  skeleton: { sprite: 'skeleton', hp: 90, dmg: 40, hs: 1.0, speed: 1.5, range: 0.5, radius: 0.3, targets: 'ground', mass: 1, costShare: 0.6 },
};

export const RELICS = [
  { id: 'swift', name: 'Swift Hands', desc: 'Villagers work 40% faster', color: '#ffd166' },
  { id: 'holy', name: 'Holy Spark', desc: '+25% Faith regeneration', color: '#e9b8ff' },
  { id: 'rain', name: 'Brick Rain', desc: '+120 bricks', color: '#ff9b5a' },
  { id: 'might', name: "Hero's Might", desc: 'Hero deals 20% more damage', color: '#ff6a5a' },
  { id: 'walls', name: 'Thick Walls', desc: 'Buildings get 25% more HP', color: '#c9b79c' },
  { id: 'hymn', name: 'Battle Hymn', desc: 'Warriors and summons deal 15% more damage', color: '#ff8ad8' },
  { id: 'fertile', name: 'Fertile Lands', desc: '+4 population cap', color: '#7dff8a' },
  { id: 'gold', name: 'Gold Rush', desc: '+50% gold after the match', color: '#ffcf4a' },
];

export const DOMINION = { tile: 1, building: 12, pop: 4, shrine: 60 };
