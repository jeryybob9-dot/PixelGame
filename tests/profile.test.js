import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  _internal, getProfile, upgradeCard, addCards, addGold, applyBattleResult, rollDrop, applyDrop, questList, claimQuest,
  setDeckCard, currentDeck, buyItem, equip, upgradeWeapon, trophyRoadState, claimTrophyRoad, ensureShop, buyDeal, xpForNextLevel,
} from '../src/core/profile.js';
import { CARDS } from '../src/data/cards.js';

const fresh = () => _internal.setProfile(_internal.defaultProfile());

test('a new profile has a valid starter deck and currencies', () => {
  fresh();
  const p = getProfile();
  assert.equal(currentDeck().length, 8);
  for (const id of currentDeck()) assert.ok(p.cards[id], id);
  assert.ok(p.gold > 0 && p.gems > 0);
  assert.equal(xpForNextLevel().frac, 0);
});

test('upgrading a card needs copies and gold', () => {
  fresh();
  assert.equal(upgradeCard('knight').ok, false);
  addCards('knight', 2);
  addGold(100);
  const r = upgradeCard('knight');
  assert.ok(r.ok);
  assert.equal(getProfile().cards.knight.level, 2);
});

test('winning gives trophies, gold and xp; losing never drops below the arena floor', () => {
  fresh();
  const w = applyBattleResult({ outcome: 'win', crowns: 3, enemyCrowns: 0, stats: {}, mode: 'duel' });
  assert.ok(w.trophyDelta >= 30 && w.gold > 0 && w.xp > 0);
  const l = applyBattleResult({ outcome: 'loss', crowns: 0, enemyCrowns: 1, stats: {}, mode: 'duel' });
  assert.ok(getProfile().trophies >= 0);
  assert.ok(l.trophyDelta <= 0);
});

test('lucky drops roll cards that are unlocked and apply them', () => {
  fresh();
  for (let tier = 0; tier < 5; tier++) {
    const d = rollDrop(tier, 1234 + tier);
    assert.ok(d.gold > 0);
    assert.ok(d.cards.length > 0);
    for (const c of d.cards) assert.ok(CARDS[c.id] && c.n > 0);
    applyDrop(d);
  }
  assert.ok(Object.keys(getProfile().cards).length > 11);
});

test('daily quests progress from stats and can be claimed', () => {
  fresh();
  const qs = questList();
  assert.equal(qs.length, 3);
  const q = qs[0];
  const before = getProfile().gold + getProfile().gems;
  getProfile().quests.list[0].progress = q.def.goal;
  assert.ok(claimQuest(q.id));
  assert.ok(getProfile().gold + getProfile().gems > before);
  assert.equal(claimQuest(q.id), null);
});

test('deck swap keeps 8 unique cards', () => {
  fresh();
  addCards('bomber', 1);
  setDeckCard(0, 'bomber');
  setDeckCard(1, 'bomber');
  const d = currentDeck();
  assert.equal(new Set(d).size, 8);
});

test('armory purchases, equips and upgrades', () => {
  fresh();
  addGold(5000);
  assert.ok(buyItem('weapon', 'shotgun'));
  equip('weapon', 'shotgun');
  assert.equal(getProfile().weaponId, 'shotgun');
  assert.ok(upgradeWeapon('shotgun'));
  assert.equal(getProfile().weapons.shotgun.level, 2);
});

test('trophy road and shop', () => {
  fresh();
  getProfile().bestTrophies = 350;
  const reachable = trophyRoadState().filter((m) => m.reached);
  assert.ok(reachable.length >= 3);
  assert.ok(claimTrophyRoad(reachable[0].trophies));
  const shop = ensureShop();
  assert.ok(shop.deals.length >= 4);
  addGold(100000);
  assert.ok(buyDeal(shop.deals[0].key));
  assert.ok(!buyDeal(shop.deals[0].key));
});
