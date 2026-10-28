import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Realm, STEP } from '../src/realm/realm.js';
import { RealmAI } from '../src/realm/realm-ai.js';
import { HordeDirector } from '../src/realm/horde.js';
import { generateRealm } from '../src/realm/worldgen.js';
import { Grid } from '../src/realm/grid.js';
import { T, BLOCKING, STRUCTURES, MATCH_LENGTH } from '../src/realm/constants.js';
import { REALM_TILES } from '../src/art/realm-tiles.js';
import { ARENAS } from '../src/data/arenas.js';
import { CARDS, CARD_IDS } from '../src/data/cards.js';

const STARTER = ['knight', 'archers', 'skeletons', 'gunners', 'giant', 'builder', 'volley', 'bricktower'];
const setup = (name, extra = {}) => ({
  name, deck: STARTER, cardLevels: {}, kingLevel: 1, heroId: 'ember', weaponId: 'rifle', weaponLevel: 1, gadgetId: 'medkit', petId: 'cat', skin: null, ...extra,
});
const make = (seed = 1, opts = {}) => new Realm({ arena: ARENAS[0], seed, players: [setup('a'), setup('b', { isAI: true })], ...opts });
const run = (R, seconds) => {
  for (let i = 0; i < seconds * 60 && R.phase !== 'ended'; i++) R.step(STEP);
};

test('terrain ids match the art renderer', () => {
  for (const [k, v] of Object.entries(T)) assert.equal(REALM_TILES[k], v, k);
});

test('islands are fair (point symmetric) and connect both keeps', () => {
  for (const biome of ['meadow', 'desert', 'frost', 'swamp', 'crystal', 'lava', 'candy', 'void']) {
    for (const seed of [1, 7, 99]) {
      const m = generateRealm({ seed, biome });
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
        const a = BLOCKING.has(m.tiles[y * m.w + x]);
        const b = BLOCKING.has(m.tiles[(m.h - 1 - y) * m.w + (m.w - 1 - x)]);
        assert.equal(a, b, `${biome}/${seed} asymmetric walkability at ${x},${y}`);
      }
      const g = new Grid(m.w, m.h, m.tiles);
      const reach = g.reachable(Math.floor(m.keeps[0].x), Math.floor(m.keeps[0].y));
      assert.ok(reach[Math.floor(m.keeps[1].y) * m.w + Math.floor(m.keeps[1].x)], `${biome}/${seed} keeps not connected`);
      for (const d of m.deposits) assert.ok(reach[Math.floor(d.y) * m.w + Math.floor(d.x)], `${biome}/${seed} deposit unreachable`);
      assert.ok(m.deposits.length >= 4 && m.nests.length >= 2);
    }
  }
});

test('A* paths avoid water and reach the goal', () => {
  const R = make(3);
  const k0 = R.players[0].keep;
  const k1 = R.players[1].keep;
  const path = R.grid.findPath(k0.x, k0.y - 3, k1.x, k1.y + 3, 0);
  assert.ok(path && path.length);
  const end = path[path.length - 1];
  assert.ok(Math.hypot(end.x - k1.x, end.y - (k1.y + 3)) < 1.5);
  for (const p of path) assert.ok(!BLOCKING.has(R.tiles[Math.floor(p.y) * R.W + Math.floor(p.x)]), 'waypoint in water');
});

test('a match starts with keeps, villagers, heroes, a shrine, nests and territory', () => {
  const R = make(5);
  for (const t of [0, 1]) {
    const p = R.players[t];
    assert.equal(p.keep.struct, 'keep');
    assert.ok(p.hero && p.hero.alive);
    assert.equal(R.entities.filter((e) => e.kind === 'villager' && e.team === t).length, 4);
    assert.equal(R.tileOwner(p.keep.x, p.keep.y + 2), t);
  }
  assert.ok(R.shrine && R.nests.length >= 2);
  assert.equal(R.clock, MATCH_LENGTH);
});

test('villagers mine bricks and build ordered buildings', () => {
  const R = make(6);
  run(R, 3.5);
  const p = R.players[0];
  const k = p.keep;
  let spot = null;
  for (let y = Math.floor(k.y) - 6; y < k.y + 6 && !spot; y++) for (let x = Math.floor(k.x) - 6; x < k.x + 6 && !spot; x++) {
    if (!R.placementProblem(0, 'house', x, y)) spot = { x, y };
  }
  assert.ok(spot, 'no house spot');
  const before = p.bricks;
  const res = R.orderBuild(0, 'house', spot.x, spot.y);
  assert.ok(res.ok, res.reason);
  assert.equal(p.bricks, before - STRUCTURES.house.cost);
  assert.equal(R.orderBuild(0, 'house', spot.x, spot.y).reason, 'occupied');
  run(R, 25);
  assert.equal(res.s.built, 1, `house built ${res.s.built}`);
  assert.equal(p.popCap, 10);
  assert.ok(p.stats.bricks > 0, 'no bricks delivered');
});

test('buildings must be inside your own territory', () => {
  const R = make(8);
  run(R, 3.5);
  const ek = R.players[1].keep;
  assert.equal(R.placementProblem(0, 'house', Math.floor(ek.x) + 3, Math.floor(ek.y) + 2), 'territory');
});

test('summons go inside territory or next to the hero; spells anywhere', () => {
  const R = make(9);
  run(R, 3.5);
  const ek = R.players[1].keep;
  assert.equal(R.previewPlacement(0, 'knight', ek.x, ek.y + 4), null);
  assert.ok(R.previewPlacement(0, 'volley', ek.x, ek.y + 4));
  const h = R.players[0].hero;
  assert.ok(R.previewPlacement(0, 'knight', h.x + 1, h.y));
});

test('every card can be cast in the realm', () => {
  for (const id of CARD_IDS) {
    const R = make(10);
    run(R, 3.5);
    const p = R.players[0];
    p.elixir = 10;
    p.hand[0] = id;
    const k = p.keep;
    const res = R.playCard(0, 0, k.x, k.y - 3.5);
    assert.ok(res.ok, `${id}: ${res.reason}`);
    run(R, 6);
    if (CARDS[id].unit?.special?.builder) assert.ok(R.entities.filter((e) => e.kind === 'villager' && e.team === 0).length >= 6);
  }
});

test('hero joystick moves the hero and never walks on water', () => {
  const R = make(11);
  run(R, 3.5);
  const h = R.players[0].hero;
  const x0 = h.x;
  R.heroJoy(0, -1, 0);
  for (let i = 0; i < 60 * 25; i++) {
    R.step(STEP);
    assert.ok(!R.blockedAt(Math.floor(h.x), Math.floor(h.y)), `hero in water at ${h.x},${h.y}`);
  }
  assert.ok(h.x < x0 - 3);
});

test('ages advance, nights fall and raids launch', () => {
  const R = make(12);
  const seen = { age: 0, night: 0, raid: 0 };
  R.on('age', () => seen.age++);
  R.on('night', () => seen.night++);
  R.on('raid', () => seen.raid++);
  R.silent = true;
  run(R, 240);
  assert.ok(seen.age >= 3, `ages ${seen.age}`);
  assert.ok(seen.night >= 1);
  assert.ok(seen.raid >= 1);
});

test('red bricks grant perks when the hero walks over them', () => {
  const R = make(13);
  run(R, 3.5);
  const h = R.players[0].hero;
  R.spawnPickup('relic', h.x + 0.3, h.y);
  run(R, 0.2);
  assert.equal(R.players[0].relics.length, 1);
});

test('fire burns forest into ash', () => {
  const R = make(14);
  let i = R.tiles.findIndex((t) => t === T.FOREST);
  assert.ok(i >= 0);
  R.igniteGround((i % R.W) + 0.5, Math.floor(i / R.W) + 0.5, 1.5, 6, 10, -1);
  run(R, 12);
  assert.ok(R.tiles.some((t) => t === T.ASH));
});

test('AI vs AI realm match finishes with a winner and crowns', () => {
  for (const [ai, seed] of [[0, 21], [3, 22]]) {
    const a = ARENAS[ai];
    const R = new Realm({ arena: a, seed, players: [setup('a', { deck: a.ai.decks[0], isAI: true }), setup('b', { deck: a.ai.decks[1], isAI: true, heroId: 'terra' })] });
    R.silent = true;
    R.ai = [new RealmAI(R, 0, 'hard'), new RealmAI(R, 1, 'hard')];
    run(R, MATCH_LENGTH + 10);
    assert.equal(R.phase, 'ended');
    assert.ok([-1, 0, 1].includes(R.result.winner));
    assert.ok(R.structures.filter((s) => s.team === 0 || s.team === 1).length > 2, 'the AIs built nothing');
  }
});

test('horde nights escalate and end when the keep falls', () => {
  const R = new Realm({ mode: 'horde', arena: ARENAS[0], seed: 31, players: [setup('a', { heroId: null }), null] });
  R.horde = new HordeDirector(R);
  R.silent = true;
  // a cracked keep so the test ends in good time
  const sizes = [];
  R.on('night', () => sizes.push(R.horde.spawnQ.length));
  R.players[0].keep.hp = R.players[0].keep.maxHp = 3000;
  run(R, 2400);
  assert.equal(R.phase, 'ended');
  assert.ok(R.horde.night >= 1, `night ${R.horde.night}`);
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] >= sizes[i - 1], 'hordes grow');
});
