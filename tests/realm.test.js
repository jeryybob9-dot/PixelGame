import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Realm, STEP } from '../src/realm/realm.js';
import { RealmAI } from '../src/realm/realm-ai.js';
import { HordeDirector } from '../src/realm/horde.js';
import { generateRealm } from '../src/realm/worldgen.js';
import { Grid } from '../src/realm/grid.js';
import { T, BLOCKING, STRUCTURES, MATCH_LENGTH, RUSH_AT, BRICKS_START, START_VILLAGERS, HOUSE_VILLAGERS, HOUSE_ELIXIR, BARRACKS_SQUAD, ELIXIR_START, ELIXIR_MAX, ELIXIR_SECONDS } from '../src/realm/constants.js';
import { damage } from '../src/battle/combat.js';
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
      assert.ok(m.deposits.length >= 4);
      assert.equal(m.bridges.length, 3, `${biome}/${seed} bridges`);
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

test('a match starts with castles, villagers, heroes and the river splitting the island', () => {
  const R = make(5);
  for (const t of [0, 1]) {
    const p = R.players[t];
    assert.equal(p.keep.struct, 'keep');
    assert.ok(p.hero && p.hero.alive);
    assert.equal(p.bricks, BRICKS_START);
    assert.equal(R.entities.filter((e) => e.kind === 'villager' && e.team === t).length, START_VILLAGERS);
    assert.equal(R.tileOwner(p.keep.x, p.keep.y + 2), t);
  }
  // your half is the half below the river; nothing else to capture
  assert.equal(R.tileOwner(R.W / 2, R.H - 1.5), 0);
  assert.equal(R.tileOwner(R.W / 2, 1.5), 1);
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
  assert.equal(p.popCap, START_VILLAGERS + HOUSE_VILLAGERS);
  assert.ok(p.stats.bricks > 0, 'no bricks delivered');
});

/** Find a legal spot for a building near the team's castle. */
const spotFor = (R, team, id) => {
  const k = R.players[team].keep;
  for (let y = Math.floor(k.y) - 9; y < k.y + 4; y++) for (let x = Math.floor(k.x) - 8; x < k.x + 8; x++) if (!R.placementProblem(team, id, x, y)) return { x, y };
  return null;
};

test('a House adds villagers and speeds up elixir', () => {
  const R = make(41);
  R.silent = true;
  run(R, 3.5);
  const p = R.players[0];
  const at = spotFor(R, 0, 'house');
  R.placeStructure(0, 'house', at.x, at.y, { instant: true });
  run(R, 0.2);
  assert.ok(Math.abs(p.elixirRate - (1 + HOUSE_ELIXIR) / ELIXIR_SECONDS) < 1e-9);
});

test('each building has a limit', () => {
  const R = make(44);
  R.silent = true;
  run(R, 3.5);
  const p = R.players[0];
  p.bricks = 5000;
  let built = 0;
  for (let i = 0; i < 6; i++) {
    const at = spotFor(R, 0, 'tower');
    if (at && R.orderBuild(0, 'tower', at.x, at.y).ok) built++;
  }
  assert.equal(built, STRUCTURES.tower.max);
  const at = spotFor(R, 0, 'tower');
  assert.equal(R.orderBuild(0, 'tower', at.x, at.y).reason, 'limit');
});

test('a Tower beats a lone Knight', () => {
  const R = make(42);
  R.silent = true;
  run(R, 3.5);
  const at = spotFor(R, 0, 'tower');
  const t = R.placeStructure(0, 'tower', at.x, at.y, { instant: true });
  // move both heroes out of the way
  for (const p of R.players) if (p.hero) p.hero.alive = false;
  const k = R.spawnUnit(1, 'knight', t.x, t.y - 7, 1, { deployT: 0.1 });
  run(R, 30);
  assert.equal(k.alive, false, 'knight survived');
  assert.ok(t.alive, 'tower fell');
});

test('a Barracks sends its Soldiers out together as a squad', () => {
  const R = make(43);
  R.silent = true;
  run(R, 3.5);
  const at = spotFor(R, 0, 'barracks');
  const b = R.placeStructure(0, 'barracks', at.x, at.y, { instant: true });
  let squads = 0;
  R.on('squad', ({ team }) => team === 0 && squads++);
  const soldiers = () => R.entities.filter((e) => e.alive && e.role === 'soldier' && e.team === 0);
  run(R, 6);
  assert.ok(soldiers().length >= 1 && soldiers().every((u) => u.hold), 'soldiers wait while the squad forms');
  run(R, 14);
  assert.ok(squads >= 1, 'no squad was sent');
  assert.ok(soldiers().filter((u) => !u.hold).length >= Math.min(BARRACKS_SQUAD, soldiers().length) - 1);
  void b;
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
    p.elixir = ELIXIR_MAX;
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

test('cards cost elixir, which refills over time; bricks are left for buildings', () => {
  const R = make(12);
  assert.equal(R.players[0].elixir, ELIXIR_START);
  run(R, 3.5);
  const p = R.players[0];
  p.hand[0] = 'knight';
  const bricks = p.bricks;
  p.elixir = CARDS.knight.cost - 0.5;
  assert.equal(R.playCard(0, 0, p.keep.x, p.keep.y - 3.5).reason, 'elixir');
  run(R, ELIXIR_SECONDS * 0.6);
  assert.ok(R.playCard(0, 0, p.keep.x, p.keep.y - 3.5).ok);
  assert.ok(p.elixir < 1);
  assert.ok(p.bricks >= bricks, 'cards must not cost bricks');
  p.elixir = 0;
  run(R, 60);
  assert.equal(p.elixir, ELIXIR_MAX);
});

test('troops are sturdy: a spell no longer wipes out a fresh squad', () => {
  for (const [troop, spell] of [['archers', 'meteor'], ['skeletons', 'volley'], ['gunners', 'spark'], ['knight', 'lightning']]) {
    const R = make(13);
    R.silent = true;
    run(R, 3.5);
    const [me, them] = R.players;
    me.elixir = them.elixir = ELIXIR_MAX;
    me.hand[0] = troop;
    them.hand[0] = spell;
    const x = me.keep.x + 4;
    const y = me.keep.y - 5;
    assert.ok(R.playCard(0, 0, x, y).ok);
    run(R, 1.2);
    const squad = R.entities.filter((e) => e.alive && e.team === 0 && e.kind === 'troop');
    assert.ok(squad.length >= 1);
    const c = squad.reduce((a, e) => ({ x: a.x + e.x / squad.length, y: a.y + e.y / squad.length }), { x: 0, y: 0 });
    assert.ok(R.playCard(1, 0, c.x, c.y).ok, `${spell} cast`);
    run(R, 2.5);
    const left = R.entities.filter((e) => e.alive && e.team === 0 && e.kind === 'troop');
    assert.ok(left.length >= 1, `${spell} wiped out ${troop}`);
  }
});

test('the last minute is Double Elixir', () => {
  const R = make(15);
  run(R, 3.5);
  assert.equal(R.rush, false);
  R.clock = RUSH_AT + 0.2;
  run(R, 0.5);
  assert.equal(R.rush, true);
  assert.ok(Math.abs(R.players[0].elixirRate - 2 / ELIXIR_SECONDS) < 1e-9);
});

test('at time-up the castle with more health wins', () => {
  const R = make(16);
  R.silent = true;
  run(R, 3.5);
  const k = R.players[1].keep;
  k.hp = k.maxHp * 0.4;
  R.clock = 0.2;
  run(R, 0.5);
  assert.equal(R.phase, 'ended');
  assert.equal(R.result.winner, 0);
  assert.equal(R.result.reason, 'time');
  assert.equal(R.result.crowns[0], 2);
});

test('destroying the enemy castle wins at once with three crowns', () => {
  const R = make(17);
  R.silent = true;
  run(R, 3.5);
  const k = R.players[1].keep;
  damage(R, k, k.hp + 10, { source: R.players[0].hero });
  assert.equal(R.phase, 'ended');
  assert.equal(R.result.winner, 0);
  assert.equal(R.result.reason, 'keep');
  assert.equal(R.result.crowns[0], 3);
});

test('heroes level up by fighting and the Power button casts', () => {
  const R = make(18);
  run(R, 3.5);
  const h = R.players[0].hero;
  assert.equal(h.form, 1);
  let levels = 0;
  R.on('heroLevel', ({ team }) => team === 0 && levels++);
  R.heroXp(0, 15);
  assert.equal(h.form, 2);
  assert.ok(levels >= 1);
  assert.ok(R.heroPower(0));
  assert.equal(R.heroPower(0), false, 'power is on cooldown');
});

test('the gadget fires by itself when the hero is hurt', () => {
  const R = make(19);
  run(R, 3.5);
  const h = R.players[0].hero;
  h.gadgetCd = 0;
  run(R, 0.1);
  assert.equal(h.gadgetCd, 0, 'used while healthy');
  h.hp = h.maxHp * 0.3;
  h.lastHitT = R.time;
  run(R, 0.1);
  assert.ok(h.gadgetCd > 0, 'medkit not used');
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

test('the 3D view module loads and reports no WebGL without a browser', async () => {
  const m = await import('../src/realm3d/render3d.js');
  assert.equal(typeof m.Realm3DRenderer, 'function');
  assert.equal(m.webglAvailable(), false);
});
