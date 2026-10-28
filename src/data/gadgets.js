// Gadgets (one equipped, button in battle) and pets (follow the hero).

/** @type {Record<string, any>} */
export const GADGETS = {
  medkit: { name: 'Medkit', cd: 22, price: { owned: true }, desc: 'Heal 45% of your HP over 2 seconds.' },
  jetpack: { name: 'Jetpack', cd: 9, price: { gold: 700 }, desc: 'Blast 3.5 tiles toward your move target, untouchable for a moment. Flies over the river.' },
  frostgrenade: { name: 'Frost Grenade', cd: 18, price: { gold: 900 }, desc: 'Freeze enemies in a small area near you for 2.5s.' },
  turret: { name: 'Auto Turret', cd: 26, price: { gold: 1200 }, desc: 'Drop a turret that shoots for 14 seconds.' },
  shield: { name: 'Energy Shield', cd: 20, price: { gold: 1000 }, desc: 'A bubble that absorbs 350 damage for 6 seconds.' },
  blackhole: { name: 'Void Grenade', cd: 30, price: { gems: 250 }, desc: 'Pull nearby enemies together for 2.5s, then crush them.' },
};
for (const [id, g] of Object.entries(GADGETS)) g.id = id;

/** @type {Record<string, any>} */
export const PETS = {
  cat: { name: 'Pixel Cat', price: { owned: true }, desc: 'Quick claws. Scratches whatever your hero is fighting.', hp: 220, dmg: 22, hs: 0.5, range: 0.6, speed: 2.2, targets: 'ground' },
  slime: { name: 'Gloop Slime', price: { gold: 800 }, desc: 'A sturdy blob that slows what it bounces on.', hp: 520, dmg: 16, hs: 0.8, range: 0.6, speed: 1.8, targets: 'ground', effects: { slow: { pct: 0.3, dur: 1 } } },
  drone: { name: 'Robo Drone', price: { gold: 1200 }, desc: 'Hovers and fires a little laser at air and ground.', hp: 180, dmg: 14, hs: 0.33, range: 4, speed: 2.4, targets: 'both', flying: true, proj: 'laser' },
  dragonpup: { name: 'Dragon Pup', price: { gems: 300 }, desc: 'A baby dragon that breathes burning fireballs.', hp: 260, dmg: 34, hs: 0.9, range: 3, speed: 2.2, targets: 'both', flying: true, proj: 'fireball', effects: { burn: { dps: 10, dur: 2 } } },
  luckysheep: { name: 'Lucky Sheep', price: { gold: 1500 }, desc: 'Does not fight. Finds 1 extra brick every 2s and +15% gold after wins.', hp: 260, dmg: 0, hs: 99, range: 0, speed: 2.0, targets: 'none', special: { brickEvery: 2, goldBonus: 0.15 } },
  minigolem: { name: 'Mini Golem', price: { gems: 400 }, desc: 'A pocket golem with lots of HP and heavy punches.', hp: 700, dmg: 45, hs: 1.0, range: 0.7, speed: 1.6, targets: 'ground' },
};
for (const [id, p] of Object.entries(PETS)) p.id = id;
