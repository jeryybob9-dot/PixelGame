// Playable heroes. You steer your hero in battle; it auto-fires its equipped weapon.
// Bricks upgrade a hero through 3 forms during a battle; forms 2 and 3 unlock its spells.

export const FORM_COST = [0, 60, 140]; // bricks to reach form 1/2/3 (index = form-1)
export const FORM_MULT = [1, 1.25, 1.55]; // hp & damage multiplier per form
export const FORM_SPEED = [0, 0.1, 0.2]; // bonus tiles/sec per form
export const FORM_NAMES = ['Apprentice', 'Ninja', 'Elemental Master'];

export const HERO_BASE = { hp: 720, armor: 160, speed: 1.65, respawn: 6, radius: 0.42 };

export const ELEMENTS = {
  fire: { name: 'Fire', color: '#ff7a2e' },
  earth: { name: 'Earth', color: '#a8743a' },
  lightning: { name: 'Lightning', color: '#ffe14a' },
  ice: { name: 'Ice', color: '#8fe8ff' },
  shadow: { name: 'Shadow', color: '#a35bff' },
};

/** @type {Record<string, any>} */
export const HEROES = {
  ember: {
    name: 'Ember', element: 'fire', title: 'Spark of the Forge', unlock: { owned: true },
    passive: { text: 'Shots set targets on fire (6 dmg/s for 2s).', burn: { dps: 6, dur: 2 } },
    spells: [
      { id: 'firespin', name: 'Fire Spin', form: 2, cd: 12, text: 'Spin in a ring of flame for 1.5s, burning everything close by.' },
      { id: 'dragonbreath', name: 'Dragon Breath', form: 3, cd: 24, text: 'Breathe a 5-tile cone of dragonfire for 2s.' },
    ],
  },
  terra: {
    name: 'Terra', element: 'earth', title: 'Mountain Heart', unlock: { gold: 1500 },
    passive: { text: '+25% hitpoints.', hpMult: 1.25 },
    spells: [
      { id: 'stoneskin', name: 'Stone Skin', form: 2, cd: 14, text: 'Gain a 400 HP rock shield for 4s and shove enemies away.' },
      { id: 'earthsplitter', name: 'Earthsplitter', form: 3, cd: 22, text: 'Crack the ground in a 6-tile line: 350 damage, stun, double vs buildings.' },
    ],
  },
  volt: {
    name: 'Volt', element: 'lightning', title: 'Storm Runner', unlock: { gold: 2500, arena: 1 },
    passive: { text: '+15% move speed and fire rate.', speedMult: 1.15, rateMult: 1.15 },
    spells: [
      { id: 'chainspark', name: 'Chain Spark', form: 2, cd: 11, text: 'Lightning jumps between 5 enemies: 180 damage and a short stun.' },
      { id: 'thunderstorm', name: 'Thunderstorm', form: 3, cd: 24, text: 'Eight bolts rain down around you over 2.5s.' },
    ],
  },
  frost: {
    name: 'Frost', element: 'ice', title: 'Winter Warden', unlock: { gold: 2500, arena: 2 },
    passive: { text: 'Shots slow targets by 15%.', slow: { pct: 0.15, dur: 1 } },
    spells: [
      { id: 'frostnova', name: 'Frost Nova', form: 2, cd: 13, text: 'Freeze every enemy within 2.2 tiles for 2s.' },
      { id: 'iceage', name: 'Ice Age', form: 3, cd: 25, text: 'Slow all enemies within 5 tiles by 50% for 5s and shield nearby allies.' },
    ],
  },
  grim: {
    name: 'Grim', element: 'shadow', title: 'Bone Collector', unlock: { trophies: 1200, gems: 500 },
    passive: { text: 'Heals 10% of the damage it deals.', lifesteal: 0.1 },
    spells: [
      { id: 'bonearmy', name: 'Bone Army', form: 2, cd: 14, text: 'Raise 4 skeletons at your side.' },
      { id: 'soulharvest', name: 'Soul Harvest', form: 3, cd: 24, text: 'Drain 300 HP from every enemy within 3 tiles and heal half of it.' },
    ],
  },
};

for (const [id, h] of Object.entries(HEROES)) h.id = id;
export const HERO_IDS = Object.keys(HEROES);
