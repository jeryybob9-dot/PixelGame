// God Box — shared constants (pure data, no DOM).

/** Terrain tile ids (stored in a Uint8Array, one byte per tile). */
export const T = Object.freeze({
  DEEP: 0, SHALLOW: 1, SAND: 2, GRASS: 3, FOREST: 4, HILLS: 5, MOUNTAIN: 6, SNOW: 7,
  LAVA: 8, ASH: 9, STONE: 10, ICE: 11, FARM: 12, WASTE: 13, ACID: 14, CRACK: 15, ORE: 16,
});
export const TILE_COUNT = 17;
export const TILE_NAMES = [
  'Deep Ocean', 'Shallow Water', 'Sand', 'Grassland', 'Forest', 'Hills', 'Mountain', 'Snow',
  'Lava', 'Ash', 'Stone', 'Ice', 'Farmland', 'Wasteland', 'Acid Pool', 'Fissure', 'Ore Vein',
];

/** Biome ids (one byte per tile). */
export const B = Object.freeze({ MEADOW: 0, DESERT: 1, SWAMP: 2, FROST: 3, CANDY: 4, VOID: 5 });
export const BIOME_NAMES = ['Meadow', 'Desert', 'Swamp', 'Frost', 'Candy', 'Void'];

/** Per-tile flag bits. */
export const F = Object.freeze({ SPREAD: 1 });

/** Height thresholds (0..255) used to classify natural terrain. */
export const H = Object.freeze({ DEEP: 88, SEA: 100, SAND: 106, GRASS: 150, HILLS: 172, MOUNT: 200 });

/** Canonical heights used when a tile type is painted. */
export const CANON_H = Uint8Array.from([
  70, 94, 103, 124, 126, 160, 186, 214, // deep..snow
  130, 124, 124, 94, 122, 122, 120, 120, 186, // lava..ore
]);

const tbl = (Ctor, map) => {
  const a = new Ctor(TILE_COUNT);
  for (const [k, v] of Object.entries(map)) a[T[k]] = v;
  return a;
};

/** Walking speed multiplier per tile (0 = impassable for walkers). */
export const WALK = tbl(Float32Array, {
  SHALLOW: 0.45, SAND: 0.9, GRASS: 1, FOREST: 0.7, HILLS: 0.7, MOUNTAIN: 0.4, SNOW: 0.35,
  LAVA: 0.5, ASH: 1, STONE: 0.9, ICE: 0.8, FARM: 0.9, WASTE: 0.9, ACID: 0.5, ORE: 0.4,
});
export const IS_WATER = tbl(Uint8Array, { DEEP: 1, SHALLOW: 1 });
/** Chance per neighbour per fire step that fire spreads onto this tile. */
export const FLAMMABLE = tbl(Float32Array, { GRASS: 0.04, FOREST: 0.2, FARM: 0.12 });
/** Tiles villages may build on. */
export const BUILDABLE = tbl(Uint8Array, { SAND: 1, GRASS: 1, FOREST: 1, HILLS: 1, ASH: 1, STONE: 1, WASTE: 1 });
/** Tiles whose type follows height when land is raised/lowered. */
export const NATURAL = tbl(Uint8Array, { DEEP: 1, SHALLOW: 1, SAND: 1, GRASS: 1, FOREST: 1, HILLS: 1, MOUNTAIN: 1, SNOW: 1, ORE: 1 });
export const STONY = tbl(Uint8Array, { HILLS: 1, MOUNTAIN: 1, STONE: 1, ORE: 1 });

export const SIZES = Object.freeze({
  small: { w: 120, h: 180, label: 'Small' },
  medium: { w: 160, h: 240, label: 'Medium' },
  large: { w: 220, h: 330, label: 'Large' },
});

// Time.
export const TICKS_PER_SEC = 15;
export const TICKS_PER_DAY = 20;
export const DAYS_PER_YEAR = 24;
export const TICKS_PER_YEAR = TICKS_PER_DAY * DAYS_PER_YEAR;
export const THINK = 6; // creatures make decisions every THINK ticks (staggered by id)
export const ADULT_YEARS = 5;

export const MAX_CREATURES = 1500;

/** Species ids. */
export const SP = Object.freeze({ VILLAGER: 0, SHEEP: 1, WOLF: 2, CRAB: 3, FISH: 4, ZOMBIE: 5, SKELETON: 6, DRAGON: 7, UFO: 8 });
export const SPECIES = [
  { key: 'villager', name: 'Villager', hp: 30, atk: 4, spd: 0.11, life: [45, 75], cap: 1500 },
  { key: 'sheep', name: 'Sheep', hp: 14, atk: 0, spd: 0.07, life: [10, 16], cap: 170, animal: 1 },
  { key: 'wolf', name: 'Wolf', hp: 26, atk: 5, spd: 0.13, life: [10, 15], cap: 90, animal: 1 },
  { key: 'crab', name: 'Crab', hp: 12, atk: 2, spd: 0.06, life: [8, 14], cap: 70, animal: 1 },
  { key: 'fish', name: 'Fish', hp: 4, atk: 0, spd: 0.08, life: [4, 8], cap: 180, animal: 1, aquatic: 1 },
  { key: 'zombie', name: 'Zombie', hp: 40, atk: 5, spd: 0.06, life: [25, 35], cap: 400, monster: 1 },
  { key: 'skeleton', name: 'Skeleton', hp: 28, atk: 6, spd: 0.1, life: [40, 60], cap: 250, monster: 1 },
  { key: 'dragon', name: 'Dragon', hp: 420, atk: 9, spd: 0.17, life: [150, 250], cap: 8, monster: 1, flying: 1 },
  { key: 'ufo', name: 'UFO', hp: 160, atk: 0, spd: 0.16, life: [4, 7], cap: 5, monster: 1, flying: 1 },
];

/** The four original villager tribes. */
export const TRIBES = [
  {
    id: 0, key: 'brick', name: 'Brickfolk', color: '#8fa6c8', dark: '#4f5f7c', light: '#c8d6ec',
    skin: '#f0c8a0', hair: '#3b3b4f', roof: '#b5523a', roofDark: '#7e3426', wall: '#e6d8bc', wallDark: '#a8967a',
    aggression: 1.0, build: 1.35, hpMul: 1.0, atkMul: 1.0, spdMul: 1.0, blurb: 'Patient builders of tidy brick towns.',
  },
  {
    id: 1, key: 'ember', name: 'Emberkin', color: '#f0782f', dark: '#a8441a', light: '#ffb070',
    skin: '#d89a6a', hair: '#7a1f10', roof: '#5a2420', roofDark: '#3a1612', wall: '#d8a860', wallDark: '#9a6a34',
    aggression: 1.9, build: 1.0, hpMul: 1.0, atkMul: 1.25, spdMul: 1.05, fireRes: 0.5, blurb: 'Hot-headed raiders who love a fight.',
  },
  {
    id: 2, key: 'leaf', name: 'Leafkin', color: '#5fc24a', dark: '#2f7a2a', light: '#a8e88a',
    skin: '#e8d0a0', hair: '#3a5a1a', roof: '#c9a04a', roofDark: '#8f6e2a', wall: '#7a5030', wallDark: '#4e321c',
    aggression: 0.55, build: 1.0, hpMul: 0.95, atkMul: 0.95, spdMul: 1.15, blurb: 'Gentle forest folk who plant as they chop.',
  },
  {
    id: 3, key: 'stone', name: 'Stoneborn', color: '#b07c50', dark: '#6a4a2e', light: '#d8b088',
    skin: '#c8a888', hair: '#4a3a2a', roof: '#5e5a62', roofDark: '#3e3a42', wall: '#a8a49c', wallDark: '#6e6a64',
    aggression: 1.15, build: 1.1, hpMul: 1.3, atkMul: 1.1, spdMul: 0.9, blurb: 'Stubborn miners at home in the mountains.',
  },
];

/** Villager jobs. */
export const J = Object.freeze({ NONE: 0, WOOD: 1, STONE: 2, FOOD: 3, BUILD: 4, WAR: 5 });
export const JOB_NAMES = ['Wanderer', 'Woodcutter', 'Miner', 'Farmer', 'Builder', 'Warrior'];

/** Carried resources. */
export const RES = Object.freeze({ NONE: 0, WOOD: 1, STONE: 2, FOOD: 3, ORE: 4 });
export const RES_KEYS = ['', 'wood', 'stone', 'food', 'ore'];

/** Trait bits. */
export const TR = Object.freeze({ BRAVE: 1, STRONG: 2, FAST: 4, WISE: 8, LUCKY: 16, CURSED: 32 });
export const TRAIT_NAMES = [
  [TR.BRAVE, 'Brave'], [TR.STRONG, 'Strong'], [TR.FAST, 'Fast'], [TR.WISE, 'Wise'], [TR.LUCKY, 'Lucky'], [TR.CURSED, 'Cursed'],
];

/** Building types. Footprint w x h tiles; sprites may be taller than the footprint. */
export const BT = Object.freeze({ HALL: 0, HUT: 1, HOUSE: 2, FARM: 3, TOWER: 4, GRANARY: 5, MINE: 6, TEMPLE: 7 });
export const BDEF = [
  { name: 'Hall', w: 5, h: 5, hp: 260, housing: 0, cost: {}, minLevel: 1 },
  { name: 'Hut', w: 3, h: 3, hp: 60, housing: 3, cost: { wood: 6 }, minLevel: 1 },
  { name: 'House', w: 4, h: 4, hp: 110, housing: 6, cost: { wood: 8, stone: 6 }, minLevel: 3 },
  { name: 'Farm', w: 3, h: 3, hp: 30, housing: 0, cost: { wood: 3 }, minLevel: 1 },
  { name: 'Watchtower', w: 3, h: 3, hp: 160, housing: 0, cost: { wood: 4, stone: 10 }, minLevel: 2 },
  { name: 'Granary', w: 3, h: 3, hp: 90, housing: 0, cost: { wood: 10 }, minLevel: 2 },
  { name: 'Mine', w: 3, h: 3, hp: 120, housing: 0, cost: { wood: 6, stone: 4 }, minLevel: 2 },
  { name: 'Temple', w: 3, h: 3, hp: 150, housing: 0, cost: { stone: 20, ore: 4 }, minLevel: 3 },
];
export const HALL_HOUSING = [0, 4, 6, 10, 14];
export const LEVEL_NAMES = ['', 'Camp', 'Village', 'Town', 'City'];
export const WEAPON_NAMES = ['Wooden Club', 'Spear', 'Iron Sword', 'Runeblade'];
/** Requirements and costs to grow a village to level n (index = target level). */
export const LEVEL_REQ = [
  null, null,
  { pop: 7, wood: 15, stone: 5, ore: 0 },
  { pop: 15, wood: 25, stone: 25, ore: 3 },
  { pop: 28, wood: 30, stone: 50, ore: 10 },
];

export const KINGDOM_COLORS = [
  '#e8433b', '#3b7dd8', '#f2c230', '#5fd35f', '#b45be8', '#ff8a2e', '#3be8d0', '#ff4ad2',
  '#f4efe6', '#8c5a2e', '#7fb8ff', '#c0ff4a', '#ff6f91', '#2e9c6a', '#9a7fff', '#e8e83b',
];
