// The player's saved progress and every rule that changes it (rewards, upgrades, quests, shop).

import { storage } from './storage.js';
import { Emitter } from './events.js';
import { createRng, hashSeed } from './rng.js';
import { dayKey } from './util.js';
import { CARDS, CARD_IDS, MAX_CARD_LEVEL, upgradeCost } from '../data/cards.js';
import { HEROES } from '../data/heroes.js';
import { WEAPONS, WEAPON_MAX_LEVEL, WEAPON_UPGRADE_GOLD } from '../data/weapons.js';
import { GADGETS, PETS } from '../data/gadgets.js';
import { ARENAS, arenaIndexForTrophies } from '../data/arenas.js';
import {
  KING_XP, MAX_KING_LEVEL, TROPHY_WIN, TROPHY_LOSS, battleGold, BATTLE_XP, DROP_TIERS, DROP_RARITY_WEIGHTS,
  TROPHY_ROAD, FREE_GIFT_HOURS,
} from '../data/progression.js';
import { QUEST_POOL, ACHIEVEMENTS } from '../data/quests.js';

const SAVE_KEY = 'profile';
const VERSION = 1;

export const STARTER_DECK = ['knight', 'archers', 'skeletons', 'gunners', 'giant', 'builder', 'volley', 'bricktower'];
const STARTER_EXTRA = ['bomber', 'bats', 'spark', 'cannon'];

export const events = new Emitter();

function defaultProfile() {
  const cards = {};
  for (const id of [...STARTER_DECK, ...STARTER_EXTRA]) cards[id] = { level: 1, count: 0 };
  return {
    v: VERSION,
    name: 'Brick Rookie',
    createdAt: Date.now(),
    kingLevel: 1,
    xp: 0,
    gold: 250,
    gems: 60,
    trophies: 0,
    bestTrophies: 0,
    cards,
    decks: [STARTER_DECK.slice(), STARTER_DECK.slice(), STARTER_DECK.slice()],
    activeDeck: 0,
    heroes: { ember: { owned: true, skin: null } },
    heroId: 'ember',
    weapons: { rifle: { level: 1 }, pistols: { level: 1 } },
    weaponId: 'rifle',
    gadgets: { medkit: true },
    gadgetId: 'medkit',
    pets: { cat: true },
    petId: 'cat',
    stats: {
      battles: 0, wins: 0, losses: 0, draws: 0, threeCrowns: 0, towers: 0, kills: 0, heroKills: 0, cardsPlayed: 0,
      spellsCast: 0, bricks: 0, forms: 0, elements: 0, crowns: 0, bestWave: 0, wavesCleared: 0, godboxVisits: 0,
      built: 0, destroyed: 0, realmBattles: 0, realmWins: 0, keepKills: 0, bestNights: 0, nights: 0,
    },
    quests: { day: '', list: [] },
    achievements: {},
    trophyRoad: [],
    shop: { day: '', deals: [], bought: [] },
    freeGiftAt: 0,
    settings: { music: 0.55, sfx: 0.85, muted: false, dmgNumbers: true, particles: 'high', haptics: true, leftHanded: false, graphics: '3d' },
    tutorialDone: false,
    lastArenaSeen: 0,
  };
}

/** Fill any fields missing from older saves. */
function migrate(p) {
  const d = defaultProfile();
  for (const k of Object.keys(d)) if (p[k] === undefined) p[k] = d[k];
  for (const k of Object.keys(d.stats)) if (p.stats[k] === undefined) p.stats[k] = 0;
  for (const k of Object.keys(d.settings)) if (p.settings[k] === undefined) p.settings[k] = d.settings[k];
  for (const deck of p.decks) for (let i = 0; i < 8; i++) if (!CARDS[deck[i]]) deck[i] = STARTER_DECK[i];
  p.v = VERSION;
  return p;
}

let profile = migrate(storage.load(SAVE_KEY, null) || defaultProfile());

export function getProfile() {
  return profile;
}

let saveTimer = 0;
/** Persist (debounced) and notify listeners. */
export function commit() {
  events.emit('change', profile);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => storage.save(SAVE_KEY, profile), 150);
}
export function saveNow() {
  clearTimeout(saveTimer);
  storage.save(SAVE_KEY, profile);
}

export function resetProfile() {
  profile = defaultProfile();
  saveNow();
  events.emit('change', profile);
}

// ───────────── currencies & xp ─────────────

export function addGold(n) {
  profile.gold = Math.max(0, profile.gold + Math.round(n));
}
export function addGems(n) {
  profile.gems = Math.max(0, profile.gems + Math.round(n));
}
/** @returns {number} king levels gained */
export function addXp(n) {
  profile.xp += Math.round(n);
  let gained = 0;
  while (profile.kingLevel < MAX_KING_LEVEL && profile.xp >= KING_XP[profile.kingLevel - 1]) {
    profile.kingLevel++;
    gained++;
  }
  if (gained) bumpStat('kingLevel', 0);
  return gained;
}
/** Progress toward the next king level: { cur, need, frac } */
export function xpForNextLevel() {
  if (profile.kingLevel >= MAX_KING_LEVEL) return { cur: profile.xp, need: profile.xp, frac: 1 };
  const prev = profile.kingLevel >= 2 ? KING_XP[profile.kingLevel - 2] : 0;
  const need = KING_XP[profile.kingLevel - 1];
  return { cur: profile.xp - prev, need: need - prev, frac: Math.max(0, Math.min(1, (profile.xp - prev) / (need - prev))) };
}
export function canAfford(price) {
  if (!price) return true;
  if (price.gold && profile.gold < price.gold) return false;
  if (price.gems && profile.gems < price.gems) return false;
  return true;
}
export function pay(price) {
  if (!canAfford(price)) return false;
  if (price.gold) addGold(-price.gold);
  if (price.gems) addGems(-price.gems);
  return true;
}

// ───────────── cards & decks ─────────────

export function arenaIndex() {
  return arenaIndexForTrophies(profile.trophies);
}
export function unlockedArena() {
  return arenaIndexForTrophies(profile.bestTrophies);
}
export function isOwned(cardId) {
  return !!profile.cards[cardId];
}
export function cardLevel(cardId) {
  return profile.cards[cardId]?.level ?? 1;
}
export function ownedCardIds() {
  return CARD_IDS.filter((id) => profile.cards[id]);
}
export function addCards(cardId, n) {
  if (!CARDS[cardId]) return;
  if (!profile.cards[cardId]) profile.cards[cardId] = { level: 1, count: n - 1, isNew: true };
  else profile.cards[cardId].count += n;
}
export function cardUpgradeInfo(cardId) {
  const c = profile.cards[cardId];
  if (!c) return null;
  const cost = upgradeCost(CARDS[cardId], c.level);
  if (!cost) return { maxed: true };
  return { ...cost, have: c.count, ready: c.count >= cost.cards, affordable: profile.gold >= cost.gold };
}
/** @returns {{ok: boolean, reason?: string, levelUps?: number}} */
export function upgradeCard(cardId) {
  const info = cardUpgradeInfo(cardId);
  if (!info || info.maxed) return { ok: false, reason: 'Already at max level.' };
  if (!info.ready) return { ok: false, reason: `Needs ${info.cards} cards.` };
  if (!info.affordable) return { ok: false, reason: `Needs ${info.gold} gold.` };
  const c = profile.cards[cardId];
  c.count -= info.cards;
  c.level = Math.min(MAX_CARD_LEVEL, c.level + 1);
  addGold(-info.gold);
  const levelUps = addXp(info.xp);
  commit();
  return { ok: true, levelUps };
}
export function currentDeck() {
  return profile.decks[profile.activeDeck];
}
export function setDeckCard(slot, cardId) {
  const deck = currentDeck();
  const existing = deck.indexOf(cardId);
  if (existing >= 0) deck[existing] = deck[slot];
  deck[slot] = cardId;
  commit();
}
export function setActiveDeck(i) {
  profile.activeDeck = i;
  commit();
}
export function deckAverage(deck = currentDeck()) {
  return deck.reduce((s, id) => s + (CARDS[id]?.cost ?? 0), 0) / deck.length;
}

// ───────────── heroes, weapons, gadgets, pets ─────────────

export function heroUnlockState(heroId) {
  const h = HEROES[heroId];
  if (profile.heroes[heroId]?.owned) return { owned: true };
  const u = h.unlock;
  if (u.trophies && profile.bestTrophies >= u.trophies) return { owned: false, free: true, text: 'Unlocked by trophies' };
  if (u.arena != null && unlockedArena() < u.arena) return { owned: false, locked: true, text: `Reach ${ARENAS[u.arena].name}` };
  return { owned: false, price: u.gold ? { gold: u.gold } : u.gems ? { gems: u.gems } : null, text: u.trophies ? `${u.trophies} trophies or` : '' };
}
export function unlockHero(heroId) {
  const st = heroUnlockState(heroId);
  if (st.owned) return true;
  if (st.locked) return false;
  if (!st.free && !pay(st.price)) return false;
  profile.heroes[heroId] = { owned: true, skin: null };
  commit();
  return true;
}
export function setHero(heroId) {
  if (!profile.heroes[heroId]?.owned) return;
  profile.heroId = heroId;
  commit();
}
export function heroSkin(heroId) {
  return profile.heroes[heroId]?.skin ?? null;
}
export function setHeroSkin(heroId, skin) {
  if (!profile.heroes[heroId]) return;
  profile.heroes[heroId].skin = skin;
  commit();
}

export function ownsItem(kind, id) {
  if (kind === 'weapon') return !!profile.weapons[id];
  if (kind === 'gadget') return !!profile.gadgets[id];
  if (kind === 'pet') return !!profile.pets[id];
  if (kind === 'hero') return !!profile.heroes[id]?.owned;
  return false;
}
export function grantItem(kind, id) {
  if (kind === 'weapon') profile.weapons[id] = profile.weapons[id] || { level: 1 };
  if (kind === 'gadget') profile.gadgets[id] = true;
  if (kind === 'pet') profile.pets[id] = true;
  if (kind === 'hero') profile.heroes[id] = profile.heroes[id] || { owned: true, skin: null };
  if (kind === 'hero') profile.heroes[id].owned = true;
}
export function buyItem(kind, id) {
  const def = kind === 'weapon' ? WEAPONS[id] : kind === 'gadget' ? GADGETS[id] : PETS[id];
  if (!def || ownsItem(kind, id)) return false;
  if (!pay(def.price)) return false;
  grantItem(kind, id);
  commit();
  return true;
}
export function equip(kind, id) {
  if (!ownsItem(kind, id)) return;
  if (kind === 'weapon') profile.weaponId = id;
  if (kind === 'gadget') profile.gadgetId = id;
  if (kind === 'pet') profile.petId = id;
  commit();
}
export function weaponLevel(id) {
  return profile.weapons[id]?.level ?? 1;
}
export function weaponUpgradeCost(id) {
  const lvl = weaponLevel(id);
  if (lvl >= WEAPON_MAX_LEVEL) return null;
  return WEAPON_UPGRADE_GOLD[lvl - 1];
}
export function upgradeWeapon(id) {
  const cost = weaponUpgradeCost(id);
  if (cost == null || !profile.weapons[id] || profile.gold < cost) return false;
  addGold(-cost);
  profile.weapons[id].level++;
  addXp(10 + profile.weapons[id].level * 4);
  commit();
  return true;
}

// ───────────── stats, quests, achievements ─────────────

export function bumpStat(name, n = 1) {
  if (name === 'kingLevel' || name === 'bestTrophies' || name === 'cardsOwned') {
    // derived stats only re-check achievements
  } else {
    profile.stats[name] = (profile.stats[name] || 0) + n;
    ensureDailyQuests();
    for (const q of profile.quests.list) {
      const def = QUEST_POOL.find((d) => d.id === q.id);
      if (def && def.stat === name && !q.claimed) q.progress = Math.min(def.goal, q.progress + n);
    }
  }
}
export function statValue(stat) {
  if (stat === 'kingLevel') return profile.kingLevel;
  if (stat === 'bestTrophies') return profile.bestTrophies;
  if (stat === 'cardsOwned') return ownedCardIds().length;
  return profile.stats[stat] || 0;
}
export function ensureDailyQuests() {
  const today = dayKey();
  // quests from an older version of the game are rerolled
  if (profile.quests.day === today && profile.quests.list.length && profile.quests.list.every((q) => QUEST_POOL.some((d) => d.id === q.id))) return;
  const rng = createRng(hashSeed(today + profile.createdAt));
  const picks = rng.shuffle(QUEST_POOL).slice(0, 3);
  profile.quests = { day: today, list: picks.map((q) => ({ id: q.id, progress: 0, claimed: false })) };
}
export function questList() {
  ensureDailyQuests();
  return profile.quests.list.map((q) => ({ ...q, def: QUEST_POOL.find((d) => d.id === q.id) }));
}
export function claimQuest(id) {
  const q = profile.quests.list.find((x) => x.id === id);
  const def = QUEST_POOL.find((d) => d.id === id);
  if (!q || !def || q.claimed || q.progress < def.goal) return null;
  q.claimed = true;
  applySimpleReward(def.reward);
  commit();
  return def.reward;
}
export function achievementList() {
  return ACHIEVEMENTS.map((a) => {
    const value = statValue(a.stat);
    return { ...a, value: Math.min(value, a.goal), done: value >= a.goal, claimed: !!profile.achievements[a.id] };
  });
}
export function claimAchievement(id) {
  const a = achievementList().find((x) => x.id === id);
  if (!a || !a.done || a.claimed) return null;
  profile.achievements[id] = true;
  applySimpleReward(a.reward);
  commit();
  return a.reward;
}
export function pendingClaims() {
  const quests = questList().filter((q) => !q.claimed && q.progress >= q.def.goal).length;
  const ach = achievementList().filter((a) => a.done && !a.claimed).length;
  const road = TROPHY_ROAD.filter((r) => profile.bestTrophies >= r.trophies && !profile.trophyRoad.includes(r.trophies)).length;
  return { quests, ach, road, total: quests + ach + road };
}
function applySimpleReward(r) {
  if (r.gold) addGold(r.gold);
  if (r.gems) addGems(r.gems);
}

// ───────────── battle results ─────────────

/**
 * Apply a finished battle to the profile.
 * @param {{ outcome: 'win'|'loss'|'draw', crowns: number, enemyCrowns: number, stats: Record<string, number>, mode: string, wave?: number, goldBonus?: number }} r
 */
export function applyBattleResult(r) {
  const before = { trophies: profile.trophies, arena: arenaIndex(), kingLevel: profile.kingLevel };
  const s = r.stats || {};
  for (const [k, v] of Object.entries(s)) if (v) bumpStat(k, v);
  let trophyDelta = 0;
  let gold = 0;
  let xp = 0;
  if (r.mode === 'duel' || r.mode === 'realm') {
    profile.stats.battles++;
    const arena = arenaIndex();
    if (r.outcome === 'win') {
      trophyDelta = TROPHY_WIN + Math.max(0, r.crowns - 1) * 2;
      bumpStat('wins', 1);
      if (r.mode === 'realm') bumpStat('realmWins', 1);
      if (r.crowns >= 3) bumpStat('threeCrowns', 1);
      if (r.mode === 'realm' && r.crowns >= 3) bumpStat('keepKills', 1);
    } else if (r.outcome === 'loss') {
      const floor = ARENAS[arena].trophies;
      trophyDelta = -Math.min(TROPHY_LOSS, Math.max(0, profile.trophies - floor));
      profile.stats.losses++;
    } else {
      profile.stats.draws++;
    }
    bumpStat('crowns', r.crowns);
    gold = battleGold({ win: r.outcome === 'win', crowns: r.crowns, arena });
    xp = BATTLE_XP[r.outcome];
  } else if (r.mode === 'waves') {
    const w = r.wave || 0;
    gold = 15 * w + Math.floor(w / 5) * 40;
    xp = 3 + w;
    bumpStat('wavesCleared', Math.max(0, w - 1));
    if (w > profile.stats.bestWave) profile.stats.bestWave = w;
  } else if (r.mode === 'horde') {
    const n = r.wave || 0;
    gold = 25 * n + Math.floor(n / 5) * 60;
    xp = 4 + n * 2;
    bumpStat('nights', n);
    if (n > (profile.stats.bestNights || 0)) profile.stats.bestNights = n;
  } else if (r.mode === 'tutorial') {
    gold = 150;
    xp = 10;
    profile.tutorialDone = true;
  }
  gold = Math.round(gold * (1 + (r.goldBonus || 0)));
  profile.trophies = Math.max(0, profile.trophies + trophyDelta);
  profile.bestTrophies = Math.max(profile.bestTrophies, profile.trophies);
  addGold(gold);
  const levelUps = addXp(xp);
  const after = { trophies: profile.trophies, arena: arenaIndex() };
  commit();
  return { trophyDelta, gold, xp, levelUps, newArena: after.arena > before.arena ? after.arena : null, kingLevel: profile.kingLevel };
}

// ───────────── lucky drops ─────────────

const ITEM_POOL = () => [
  ...Object.keys(WEAPONS).map((id) => ({ kind: 'weapon', id })),
  ...Object.keys(GADGETS).map((id) => ({ kind: 'gadget', id })),
  ...Object.keys(PETS).map((id) => ({ kind: 'pet', id })),
  ...Object.keys(HEROES).map((id) => ({ kind: 'hero', id })),
].filter((it) => !ownsItem(it.kind, it.id));

/** Cards that can drop at the player's current unlocked arena. */
export function droppableCards(arenaIdx = unlockedArena()) {
  return CARD_IDS.filter((id) => CARDS[id].arena <= arenaIdx);
}

/**
 * Roll the contents of a Lucky Drop tier.
 * @returns {{ tier: number, gold: number, gems: number, cards: {id: string, n: number}[], item: null|{kind: string, id: string} }}
 */
export function rollDrop(tier, seed = Date.now()) {
  const rng = createRng(seed >>> 0);
  const t = DROP_TIERS[tier];
  const pool = droppableCards();
  const byRarity = { common: [], rare: [], epic: [], legendary: [] };
  for (const id of pool) byRarity[CARDS[id].rarity].push(id);
  const rarityOrder = ['common', 'rare', 'epic', 'legendary'];
  const pickRarity = () => {
    let total = 0;
    for (const r of rarityOrder) if (byRarity[r].length) total += DROP_RARITY_WEIGHTS[r];
    let x = rng.next() * total;
    for (const r of rarityOrder) {
      if (!byRarity[r].length) continue;
      x -= DROP_RARITY_WEIGHTS[r];
      if (x <= 0) return r;
    }
    return 'common';
  };
  const counts = new Map();
  const stacks = Math.min(pool.length, 2 + tier * 2);
  let remaining = t.cards;
  // guaranteed rarity
  if (t.guaranteed) {
    const want = byRarity[t.guaranteed].length ? t.guaranteed : 'rare';
    const list = byRarity[want].length ? byRarity[want] : pool;
    const id = rng.pick(list);
    const n = want === 'legendary' ? 1 : want === 'epic' ? Math.max(1, Math.round(t.cards / 15)) : Math.max(1, Math.round(t.cards / 6));
    counts.set(id, n);
    remaining -= n;
  }
  for (let i = 0; i < stacks && remaining > 0; i++) {
    const r = pickRarity();
    const id = rng.pick(byRarity[r]);
    const share = i === stacks - 1 ? remaining : Math.max(1, Math.round((remaining / (stacks - i)) * rng.range(0.6, 1.4)));
    const n = r === 'legendary' ? 1 : r === 'epic' ? Math.max(1, Math.round(share / 6)) : r === 'rare' ? Math.max(1, Math.round(share / 2.5)) : share;
    counts.set(id, (counts.get(id) || 0) + n);
    remaining -= share;
  }
  const items = ITEM_POOL();
  const item = items.length && rng.chance(t.item) ? rng.pick(items) : null;
  return {
    tier,
    gold: rng.int(t.gold[0], t.gold[1]),
    gems: t.gems ? rng.int(Math.round(t.gems * 0.8), Math.round(t.gems * 1.2)) : 0,
    cards: [...counts.entries()].map(([id, n]) => ({ id, n })).sort((a, b) => rarityRank(a.id) - rarityRank(b.id)),
    item,
  };
}
const rarityRank = (id) => ['common', 'rare', 'epic', 'legendary'].indexOf(CARDS[id].rarity);

export function applyDrop(drop) {
  addGold(drop.gold);
  addGems(drop.gems);
  const newCards = [];
  for (const { id, n } of drop.cards) {
    if (!profile.cards[id]) newCards.push(id);
    addCards(id, n);
  }
  if (drop.item) grantItem(drop.item.kind, drop.item.id);
  commit();
  return { newCards };
}

// ───────────── trophy road ─────────────

export function trophyRoadState() {
  return TROPHY_ROAD.map((m) => ({ ...m, reached: profile.bestTrophies >= m.trophies, claimed: profile.trophyRoad.includes(m.trophies) }));
}
/** Claim a trophy-road milestone. Drops are returned for the caller to open. */
export function claimTrophyRoad(trophies) {
  const m = TROPHY_ROAD.find((x) => x.trophies === trophies);
  if (!m || profile.bestTrophies < trophies || profile.trophyRoad.includes(trophies)) return null;
  profile.trophyRoad.push(trophies);
  const r = m.reward;
  if (r.type === 'gold') addGold(r.amount);
  if (r.type === 'gems') addGems(r.amount);
  if (r.type === 'cards') {
    const pool = droppableCards();
    const rng = createRng(trophies * 7919 + profile.createdAt);
    for (let i = 0; i < 3; i++) addCards(rng.pick(pool), Math.ceil(r.count / 3));
  }
  commit();
  return r;
}

// ───────────── shop ─────────────

export function ensureShop() {
  const today = dayKey();
  if (profile.shop.day === today && profile.shop.deals.length) return profile.shop;
  const rng = createRng(hashSeed('shop' + today + profile.createdAt));
  const pool = droppableCards();
  const picks = rng.shuffle(pool).slice(0, 4);
  const priceFor = (id) => ({ common: 10, rare: 60, epic: 400, legendary: 2000 })[CARDS[id].rarity];
  const qtyFor = (id) => ({ common: 20, rare: 6, epic: 2, legendary: 1 })[CARDS[id].rarity];
  const deals = picks.map((id, i) => ({ key: `card:${id}`, cardId: id, qty: qtyFor(id), gold: priceFor(id) * qtyFor(id), slot: i }));
  const items = ITEM_POOL().filter((it) => it.kind !== 'hero');
  if (items.length) {
    const it = rng.pick(items);
    const def = it.kind === 'weapon' ? WEAPONS[it.id] : it.kind === 'gadget' ? GADGETS[it.id] : PETS[it.id];
    const base = def.price.gold || (def.price.gems ? def.price.gems * 12 : 800);
    deals.push({ key: `item:${it.kind}:${it.id}`, item: it, gold: Math.round((base * 0.75) / 10) * 10, slot: deals.length, discount: 25 });
  }
  profile.shop = { day: today, deals, bought: [] };
  return profile.shop;
}
export function buyDeal(key) {
  const shop = ensureShop();
  const d = shop.deals.find((x) => x.key === key);
  if (!d || shop.bought.includes(key) || profile.gold < d.gold) return false;
  addGold(-d.gold);
  if (d.cardId) addCards(d.cardId, d.qty);
  if (d.item) grantItem(d.item.kind, d.item.id);
  shop.bought.push(key);
  commit();
  return true;
}
export function freeGiftReadyIn() {
  return Math.max(0, profile.freeGiftAt + FREE_GIFT_HOURS * 3600e3 - Date.now());
}
export function claimFreeGift() {
  if (freeGiftReadyIn() > 0) return null;
  profile.freeGiftAt = Date.now();
  commit();
  return rollDrop(0, Date.now());
}

export function setSetting(k, v) {
  profile.settings[k] = v;
  commit();
}
export function setName(name) {
  const clean = String(name).replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16);
  if (clean) profile.name = clean;
  commit();
}

// expose for debugging / tests
export const _internal = { defaultProfile, migrate, setProfile: (p) => (profile = migrate(p)) };
