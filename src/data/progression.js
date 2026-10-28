// King levels, trophies, rewards and Lucky Drop tiers.

import { ARENAS } from './arenas.js';

export const MAX_KING_LEVEL = 15;
/** Total XP needed to REACH level i+2 (index 0 = level 2). */
export const KING_XP = [20, 50, 100, 200, 400, 800, 1500, 3000, 5000, 8000, 12000, 16000, 22000, 30000];
export const KING_MULT = 1.07; // tower & hero HP / damage per king level

export const kingMult = (lvl) => Math.pow(KING_MULT, Math.max(1, lvl) - 1);

export function xpForNext(level) {
  if (level >= MAX_KING_LEVEL) return null;
  return KING_XP[level - 1];
}

export const TOWERS = {
  king: { hp: 2400, dmg: 46, hs: 1.0, range: 7, radius: 1.8 },
  princess: { hp: 1400, dmg: 40, hs: 0.8, range: 7.5, radius: 1.35 },
};

export const TROPHY_WIN = 30;
export const TROPHY_LOSS = 22;

/** Gold for a battle result. */
export function battleGold({ win, crowns, arena }) {
  return win ? 30 + crowns * 8 + arena * 6 : 5 + crowns * 4;
}
export const BATTLE_XP = { win: 12, loss: 4, draw: 6 };

// Lucky Drop: after a win you get a chest that can be upgraded by tapping.
export const DROP_TIERS = [
  { id: 'common', name: 'Wooden Drop', color: '#c48a52', gold: [40, 70], cards: 6, gems: 0, guaranteed: null, item: 0 },
  { id: 'rare', name: 'Silver Drop', color: '#cfd8e3', gold: [110, 160], cards: 14, gems: 0, guaranteed: 'rare', item: 0.05 },
  { id: 'epic', name: 'Golden Drop', color: '#ffcf4a', gold: [260, 340], cards: 30, gems: 5, guaranteed: 'epic', item: 0.15 },
  { id: 'legendary', name: 'Crystal Drop', color: '#3be8d0', gold: [700, 900], cards: 60, gems: 20, guaranteed: 'legendary', item: 0.4 },
  { id: 'mythic', name: 'Rainbow Drop', color: '#ff4ad2', gold: [1800, 2400], cards: 120, gems: 50, guaranteed: 'legendary', item: 1 },
];
/** Chance that a tap upgrades the drop from tier i to i+1. */
export const DROP_UPGRADE_CHANCE = [0.55, 0.32, 0.16, 0.07];
export const DROP_TAPS = 3;

/** Card rarity weights inside a drop. */
export const DROP_RARITY_WEIGHTS = { common: 70, rare: 22, epic: 6.5, legendary: 1.5 };

// Trophy road milestones (claimable once).
export const TROPHY_ROAD = (() => {
  const list = [];
  const kinds = ['gold', 'drop', 'gems', 'gold', 'cards'];
  for (let t = 100; t <= 5000; t += 100) {
    const arenaHere = ARENAS.find((a) => a.trophies === t);
    if (arenaHere) {
      list.push({ trophies: t, reward: { type: 'drop', tier: Math.min(4, 1 + Math.floor(ARENAS.indexOf(arenaHere) / 2)) }, arena: arenaHere.id });
      continue;
    }
    const k = kinds[(t / 100) % kinds.length];
    const scale = 1 + t / 1000;
    if (k === 'gold') list.push({ trophies: t, reward: { type: 'gold', amount: Math.round(100 * scale) } });
    else if (k === 'gems') list.push({ trophies: t, reward: { type: 'gems', amount: Math.round(10 * scale) } });
    else if (k === 'cards') list.push({ trophies: t, reward: { type: 'cards', count: Math.round(10 * scale) } });
    else list.push({ trophies: t, reward: { type: 'drop', tier: t >= 2500 ? 2 : t >= 1000 ? 1 : 0 } });
  }
  return list;
})();

export const FREE_GIFT_HOURS = 4;

export const SHOP_GEM_OFFERS = [
  { id: 'gold_small', name: 'Pouch of Gold', gems: 60, gold: 1000 },
  { id: 'gold_big', name: 'Chest of Gold', gems: 500, gold: 10000 },
  { id: 'drop_epic', name: 'Golden Drop', gems: 180, drop: 2 },
  { id: 'drop_legendary', name: 'Crystal Drop', gems: 650, drop: 3 },
];
