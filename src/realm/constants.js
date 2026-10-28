// Realm Clash rules: map size, timings, bricks, buildings and unit tuning. See docs/DESIGN.md.
//
// The whole game in one line: destroy the enemy castle before they destroy yours. Villagers mine bricks; bricks pay
// for troops, spells and buildings.

export const REALM_W = 30;
export const REALM_H = 46;

/** Terrain tile ids (must match REALM_TILES in src/art/realm-tiles.js). */
export const T = { DEEP: 0, WATER: 1, SAND: 2, GRASS: 3, FOREST: 4, HILL: 5, MOUNTAIN: 6, ASH: 7, SNOW: 8, LAVA: 9, MUD: 10, CRYSTAL: 11, PATH: 12 };

/** Tiles nothing can walk on (flyers ignore terrain). */
export const BLOCKING = new Set([T.DEEP, T.WATER, T.MOUNTAIN, T.LAVA, T.CRYSTAL]);
/** Movement speed multiplier per tile. */
export const TILE_SPEED = { [T.MUD]: 0.75, [T.FOREST]: 0.9, [T.PATH]: 1.15 };
/** Tiles buildings may stand on. */
export const BUILDABLE = new Set([T.SAND, T.GRASS, T.HILL, T.ASH, T.SNOW, T.MUD, T.PATH]);

export const WILD = 2; // team id for wild animals and Horde monsters

// ── the match ──
export const MATCH_LENGTH = 300; // 5 minutes
export const RUSH_AT = 60; // seconds left when Brick Rush (double income) starts
export const COUNTDOWN = 3.2;

// ── bricks: the only resource ──
export const BRICKS_START = 120;
export const BRICK_INCOME = 1.2; // passive bricks per second (x2 in the Rush)
export const CARD_BRICKS = 10; // a card costs card.cost * CARD_BRICKS bricks
export const CARRY = 3; // bricks a villager carries home per trip
export const MINE_TIME = 3;
export const START_VILLAGERS = 4;
export const HOUSE_VILLAGERS = 2;
export const VILLAGER_RESPAWN = 12; // seconds until a lost villager is replaced
export const HERO_RESPAWN = 5;
export const HERO_KILL_BRICKS = 40;
export const SUMMON_HERO_RADIUS = 4;
export const HOME_HEAL = 0.08; // a hero near its own castle heals this share of max HP per second

/** Brick cost of a card in Realm Clash. */
export const cardBricks = (card) => (card?.cost || 0) * CARD_BRICKS;

// ── troops: fewer, sturdier units so armies matter ──
export const TROOP_HP = 2.2; // realm HP multiplier for summoned troops
export const TROOP_DMG = 1.5;
export const TROOP_SPEED = 1.25;
/** Every card's units share at least this much HP per point of card cost (no flimsy level-1 swarms). */
export const HP_PER_COST = 450;
/** Swarm cards bring fewer but tougher units: copies on the field for a card's printed count. */
export const troopCount = (n) => (n <= 2 ? n : n <= 4 ? 2 : 3);
export const SPELL_VS_TROOPS = 0.7; // spells hit troops and heroes softer
export const SPELL_VS_BUILDINGS = 0.6;
export const HERO_VS_TROOPS = 0.75;
export const TROOP_VS_BUILDINGS = 1.6; // troops wreck buildings, so a push that lands really hurts

// ── the hero levels up by fighting ──
export const HERO_XP = [0, 12, 32]; // XP needed for level 1, 2, 3
export const HERO_XP_PER_SEC = 0.06; // a trickle so a careful player levels too

export const VILLAGER = { hp: 160, dmg: 14, hs: 1.1, speed: 1.5, range: 0.5, radius: 0.3 };
export const SOLDIER = { sprite: 'knight', hp: 620, dmg: 70, hs: 1.1, speed: 1.2, range: 0.6, radius: 0.4, targets: 'ground', mass: 4, costShare: 3 };

/**
 * Buildings. footprint = w x h tiles, built by villagers. The castle is placed at the start.
 */
export const STRUCTURES = {
  keep: { name: 'Castle', cost: 0, w: 3, h: 3, hp: 9000, claim: 8, build: 0, sprite: 'keep', dmg: 85, hs: 1.0, range: 7.5, splash: 0.8, desc: 'Your castle. If it falls, you lose.' },
  house: { name: 'House', cost: 50, w: 2, h: 2, hp: 600, claim: 3, build: 5, sprite: 'house', desc: '+2 villagers to mine more bricks.' },
  tower: { name: 'Tower', cost: 70, w: 2, h: 2, hp: 1500, claim: 4, build: 6, sprite: 'princess_tower', dmg: 56, hs: 0.85, range: 6.5, desc: 'Shoots any enemy that comes close.' },
  barracks: { name: 'Barracks', cost: 110, w: 3, h: 2, hp: 1200, claim: 3, build: 7, sprite: 'barracks', desc: 'Sends a Soldier to attack every 14s.' },
};
export const BUILD_MENU = ['house', 'tower', 'barracks'];
export const BARRACKS_EVERY = 14;
export const BARRACKS_MAX = 3; // soldiers alive per barracks

/** Horde Nights monsters. */
export const MONSTERS = {
  wolf: { sprite: 'wolf', hp: 300, dmg: 40, hs: 0.8, speed: 1.9, range: 0.5, radius: 0.36, targets: 'ground', mass: 2, costShare: 1.4 },
  bandit: { sprite: 'bandit', hp: 460, dmg: 58, hs: 1.2, speed: 1.3, range: 0.55, radius: 0.38, targets: 'ground', mass: 3, costShare: 1.8 },
  skeleton: { sprite: 'skeleton', hp: 160, dmg: 40, hs: 1.0, speed: 1.5, range: 0.5, radius: 0.3, targets: 'ground', mass: 1, costShare: 0.8 },
};
