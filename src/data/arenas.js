// Arenas unlock by trophies. Each has a biome (art + music), new cards, and an AI opponent profile.

export const ARENAS = [
  {
    id: 'meadow', name: 'Brick Meadow', trophies: 0, biome: 'meadow', music: 'meadow',
    blurb: 'Green fields where every hero starts out.',
    ai: { name: 'Farmer Fenn', difficulty: 'easy', cardLevel: 1, kingLevel: 1, hero: 'ember',
      decks: [['knight', 'archers', 'skeletons', 'gunners', 'bomber', 'volley', 'bricktower', 'giant'], ['knight', 'bats', 'skeletons', 'gunners', 'bomber', 'spark', 'cannon', 'minigunner']] },
  },
  {
    id: 'desert', name: 'Dune Bazaar', trophies: 300, biome: 'desert', music: 'desert',
    blurb: 'Sand, sun and stampeding sheep.',
    ai: { name: 'Sultana Sandra', difficulty: 'easy', cardLevel: 2, kingLevel: 2, hero: 'terra',
      decks: [['boarrider', 'sheep', 'gunners', 'archers', 'flamer', 'quake', 'cannon', 'spark'], ['giant', 'necro', 'skeletons', 'bomber', 'meteor', 'crypt', 'knight', 'volley']] },
  },
  {
    id: 'frost', name: 'Frostbite Peak', trophies: 700, biome: 'frost', music: 'frost',
    blurb: 'Slippery ice and frozen snipers.',
    ai: { name: 'Captain Glacier', difficulty: 'normal', cardLevel: 3, kingLevel: 3, hero: 'frost',
      decks: [['icemage', 'sniper', 'giant', 'tesla', 'blizzard', 'archers', 'skeletons', 'volley'], ['mech', 'icemage', 'gunners', 'bats', 'wall', 'meteor', 'knight', 'cannon']] },
  },
  {
    id: 'swamp', name: 'Murk Swamp', trophies: 1200, biome: 'swamp', music: 'swamp',
    blurb: 'Bubbling bogs. Something is groaning out there.',
    ai: { name: 'Witch Nettle', difficulty: 'normal', cardLevel: 4, kingLevel: 4, hero: 'grim',
      decks: [['zombies', 'monk', 'acid', 'necro', 'skeletons', 'bless', 'crypt', 'archers'], ['plague', 'giant', 'monk', 'gunners', 'bats', 'spark', 'bricktower', 'flamer']] },
  },
  {
    id: 'crystal', name: 'Crystal Caverns', trophies: 1800, biome: 'crystal', music: 'crystal',
    blurb: 'Glowing gems and strange lights in the sky.',
    ai: { name: 'Professor Prism', difficulty: 'hard', cardLevel: 5, kingLevel: 5, hero: 'volt',
      decks: [['ufo', 'ninja', 'lightning', 'mine', 'titan', 'archers', 'skeletons', 'spark'], ['giant', 'sniper', 'minigunner', 'lightning', 'tesla', 'bats', 'volley', 'ninja']] },
  },
  {
    id: 'lava', name: 'Lava Forge', trophies: 2500, biome: 'lava', music: 'lava',
    blurb: 'Rivers of magma and crabs the size of houses.',
    ai: { name: 'Forgemaster Kel', difficulty: 'hard', cardLevel: 6, kingLevel: 6, hero: 'ember',
      decks: [['crab', 'phoenix', 'dragon', 'rocketeer', 'meteor', 'skeletons', 'archers', 'tesla'], ['bonedragon', 'boarrider', 'mech', 'flamer', 'spark', 'gunners', 'wall', 'lightning']] },
  },
  {
    id: 'candy', name: 'Candy Kingdom', trophies: 3300, biome: 'candy', music: 'candy',
    blurb: 'Sweet to look at. Bitter to lose in.',
    ai: { name: 'Duchess Fudge', difficulty: 'master', cardLevel: 7, kingLevel: 7, hero: 'volt',
      decks: [['blackhole', 'titan', 'phoenix', 'sheep', 'bless', 'minigunner', 'skeletons', 'archers'], ['giant', 'bonedragon', 'necro', 'blizzard', 'lightning', 'gunners', 'bats', 'cannon']] },
  },
  {
    id: 'void', name: 'Void Rift', trophies: 4200, biome: 'void', music: 'void',
    blurb: 'The edge of the world. Only legends battle here.',
    ai: { name: 'The Hollow King', difficulty: 'master', cardLevel: 8, kingLevel: 9, hero: 'grim',
      decks: [['nuke', 'mech', 'ufo', 'zombies', 'plague', 'sniper', 'skeletons', 'tesla'], ['crab', 'titan', 'phoenix', 'blackhole', 'monk', 'archers', 'bats', 'spark']] },
  },
];

export function arenaIndexForTrophies(trophies) {
  let idx = 0;
  for (let i = 0; i < ARENAS.length; i++) if (trophies >= ARENAS[i].trophies) idx = i;
  return idx;
}

export const AI_DIFFICULTY = {
  tutorial: { think: [1.8, 2.6], pushAt: 10, mistakes: 0.4, heroSpells: false, upgrades: false, towers: false, raid: 0 },
  easy: { think: [1.2, 2.0], pushAt: 9, mistakes: 0.25, heroSpells: false, upgrades: true, towers: false, raid: 0 },
  normal: { think: [0.8, 1.4], pushAt: 8, mistakes: 0.12, heroSpells: true, upgrades: true, towers: true, raid: 0.03 },
  hard: { think: [0.55, 1.0], pushAt: 7, mistakes: 0.06, heroSpells: true, upgrades: true, towers: true, raid: 0.07 },
  master: { think: [0.35, 0.7], pushAt: 7, mistakes: 0.02, heroSpells: true, upgrades: true, towers: true, raid: 0.1 },
};
