// God Box — name generators for villagers, villages and kingdoms (pure).
import { rand, pick } from './state.js';

const PLACE = [
  { pre: ['Brick', 'Mor', 'Gran', 'Tull', 'Hed', 'Cobb', 'Mason', 'Ald', 'Wick', 'Bram', 'Kettle', 'Lint'], suf: ['holm', 'stead', 'ford', 'wick', 'bury', 'ton', 'gate', 'well', 'court'] },
  { pre: ['Ash', 'Cinder', 'Flare', 'Scorch', 'Ember', 'Kiln', 'Pyre', 'Smol', 'Brand', 'Char', 'Soot', 'Blaze'], suf: ['burn', 'forge', 'hold', 'crag', 'pit', 'spire', 'reach', 'maw', 'fang'] },
  { pre: ['Fern', 'Moss', 'Willow', 'Bryn', 'Thistle', 'Alder', 'Hazel', 'Sorrel', 'Lark', 'Elm', 'Clover', 'Rush'], suf: ['glade', 'vale', 'hollow', 'grove', 'dell', 'brook', 'mere', 'wood', 'leaf'] },
  { pre: ['Grim', 'Flint', 'Deep', 'Bould', 'Granit', 'Ore', 'Slate', 'Crag', 'Dun', 'Karn', 'Cobal', 'Basalt'], suf: ['delve', 'rock', 'hall', 'mount', 'deep', 'vault', 'heim', 'barrow', 'peak'] },
];

const PERSON = [
  { a: ['Bo', 'Ri', 'Ta', 'Mo', 'Ke', 'Lu', 'Da', 'Ni', 'Pe', 'Ga', 'Wil', 'Ed'], b: ['rin', 'do', 'mak', 'sel', 'ton', 'ra', 'bel', 'dric', 'ny', 'ma'] },
  { a: ['Ka', 'Zu', 'Rax', 'Vo', 'Sha', 'Igg', 'Tor', 'Fe', 'Kra', 'Ye', 'Dra', 'Ush'], b: ['rok', 'za', 'gar', 'nix', 'ka', 'th', 'ra', 'gul', 'mi', 'zek'] },
  { a: ['Li', 'Fe', 'Syl', 'Ae', 'Wy', 'Ny', 'Ro', 'Ela', 'Ivy', 'Tam', 'Lo', 'Fa'], b: ['ra', 'wen', 'lis', 'ny', 'thel', 'na', 'ri', 'vyn', 'mo', 'lia'] },
  { a: ['Dur', 'Gro', 'Bal', 'Thor', 'Kil', 'Har', 'Bru', 'Gun', 'Ost', 'Dag', 'Rag', 'Mur'], b: ['in', 'ak', 'gar', 'dun', 'nok', 'rim', 'li', 'mund', 'ra', 'bek'] },
];

const KINGDOM = [
  ['Kingdom of {V}', '{V} Union', 'Crown of {V}', 'Brick Realm of {V}'],
  ['{V} Dominion', 'Empire of {V}', 'Burning {V}', 'Warband of {V}'],
  ['Circle of {V}', 'Grove of {V}', '{V} Accord', 'Green {V}'],
  ['Clan {V}', 'Halls of {V}', '{V} Holds', 'Stone Throne of {V}'],
];

/** @param {object} s state @param {number} tribe */
export function villageName(s, tribe) {
  const P = PLACE[tribe] || PLACE[0];
  for (let i = 0; i < 8; i++) {
    const pre = pick(s, P.pre);
    const suf = pick(s, P.suf);
    if (pre.toLowerCase() === suf) continue;
    const name = pre + suf;
    let taken = false;
    for (const v of s.villages.values()) if (v.name === name) taken = true;
    if (!taken) return name;
  }
  return pick(s, P.pre) + pick(s, P.suf) + ' ' + (2 + ((rand(s) * 8) | 0));
}

export function personName(s, tribe) {
  const P = PERSON[tribe] || PERSON[0];
  let n = pick(s, P.a) + pick(s, P.b);
  if (rand(s) < 0.25) n += pick(s, P.b);
  return n;
}

export function kingdomName(s, tribe, villageName, rebel = false) {
  if (rebel) return pick(s, ['Free {V}', '{V} Rebellion', 'Liberated {V}']).replace('{V}', villageName);
  return pick(s, KINGDOM[tribe] || KINGDOM[0]).replace('{V}', villageName);
}

const ANIMAL = {
  sheep: ['Woolly', 'Puff', 'Clover', 'Bleat', 'Cotton', 'Nibbles'],
  wolf: ['Fang', 'Howl', 'Grey', 'Shadow', 'Snarl', 'Moon'],
  crab: ['Pinch', 'Snip', 'Clack', 'Sidle', 'Shell'],
  fish: ['Bubbles', 'Fin', 'Splash', 'Scale', 'Glim'],
  dragon: ['Vexmora', 'Ashgrin', 'Kaltherax', 'Ymbrys', 'Scorvane', 'Duskmaw'],
  ufo: ['Visitor', 'Probe', 'Saucer', 'Watcher'],
};
export function animalName(s, key) {
  const list = ANIMAL[key];
  return list ? pick(s, list) : '';
}
