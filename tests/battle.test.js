import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle, STEP } from '../src/battle/battle.js';
import { AIController } from '../src/battle/ai.js';
import { WaveDirector } from '../src/battle/waves.js';
import { ARENAS } from '../src/data/arenas.js';
import { CARDS, CARD_IDS } from '../src/data/cards.js';
import { HEROES } from '../src/data/heroes.js';
import { WEAPONS } from '../src/data/weapons.js';
import { towerLayout, deployZones, clampToZones, inZones } from '../src/battle/constants.js';

const STARTER = ['knight', 'archers', 'skeletons', 'gunners', 'giant', 'builder', 'volley', 'bricktower'];
const setup = (name, deck = STARTER, extra = {}) => ({
  name, deck, cardLevels: {}, kingLevel: 1, heroId: 'ember', weaponId: 'rifle', weaponLevel: 1, gadgetId: 'medkit', petId: 'cat', skin: null, ...extra,
});
const run = (B, seconds) => {
  for (let i = 0; i < seconds * 60 && B.phase !== 'ended'; i++) B.step(STEP);
};

test('every card has valid data', () => {
  for (const id of CARD_IDS) {
    const c = CARDS[id];
    assert.ok(c.name && c.cost > 0 && c.cost <= 10, id);
    assert.ok(['troop', 'spell', 'building'].includes(c.type), id);
    assert.ok(c[c.type === 'troop' ? 'unit' : c.type], `${id} has ${c.type} stats`);
    for (const deck of ARENAS.flatMap((a) => a.ai.decks)) for (const d of deck) assert.ok(CARDS[d], `AI deck card ${d}`);
  }
});

test('towers, heroes and pets are created for both teams', () => {
  const B = new Battle({ mode: 'duel', arena: ARENAS[0], seed: 1, players: [setup('a'), setup('b', STARTER, { isAI: true })] });
  assert.equal(B.towers.length, 6);
  assert.ok(B.players[0].hero && B.players[1].hero);
  assert.ok(B.players[0].pet);
  assert.equal(towerLayout(1)[2].y, 3);
});

test('countdown then play, and elixir regenerates', () => {
  const B = new Battle({ mode: 'duel', arena: ARENAS[0], seed: 2, players: [setup('a'), setup('b')] });
  assert.equal(B.phase, 'countdown');
  run(B, 3.5);
  assert.equal(B.phase, 'play');
  const e0 = B.players[0].elixir;
  run(B, 5.6);
  assert.ok(B.players[0].elixir > e0 + 1.5);
});

test('playing a card spends elixir, cycles the hand and spawns units', () => {
  const B = new Battle({ mode: 'duel', arena: ARENAS[0], seed: 3, players: [setup('a'), setup('b')] });
  run(B, 3.5);
  const p = B.players[0];
  const slot = p.hand.indexOf(p.hand.find((id) => CARDS[id].type === 'troop' && CARDS[id].cost <= p.elixir));
  const id = p.hand[slot];
  const before = B.entities.length;
  const res = B.playCard(0, slot, 9, 24);
  assert.ok(res.ok);
  assert.equal(p.queue[p.queue.length - 1], id);
  assert.ok(B.entities.length > before);
  assert.ok(p.elixir < 5);
});

test('cannot deploy troops on the enemy side; clamps into own zone', () => {
  const zones = deployZones(0, { left: false, right: false });
  assert.ok(!inZones(zones, 9, 5));
  const c = clampToZones(zones, 9, 5);
  assert.ok(c.y >= 17);
  const pocket = deployZones(0, { left: true, right: false });
  assert.ok(inZones(pocket, 4, 13));
  assert.ok(!inZones(pocket, 14, 13));
});

test('a lone giant crosses the river and destroys a princess tower', () => {
  const B = new Battle({ mode: 'duel', arena: ARENAS[0], seed: 4, players: [setup('a', STARTER, { heroId: null }), setup('b', STARTER, { heroId: null })] });
  B.phase = 'play';
  B.spawnUnit(0, 'giant', 4, 24, 3, { deployT: 0 });
  run(B, 60);
  const left = B.towers.find((t) => t.team === 1 && t.side === 'left');
  assert.ok(!left.alive || left.hp < left.maxHp * 0.5, `tower hp ${left.hp}`);
});

test('ground troops route over bridges, never through water', () => {
  const B = new Battle({ mode: 'duel', arena: ARENAS[0], seed: 5, players: [setup('a', STARTER, { heroId: null }), setup('b', STARTER, { heroId: null })] });
  B.phase = 'play';
  const k = B.spawnUnit(0, 'knight', 9, 22, 1, { deployT: 0 });
  for (let i = 0; i < 60 * 20; i++) {
    B.step(STEP);
    if (k.alive && k.y > 15.05 && k.y < 16.95) assert.ok((k.x >= 2 && k.x <= 5) || (k.x >= 13 && k.x <= 16), `knight in river at ${k.x},${k.y}`);
  }
});

test('hero form upgrade costs bricks and unlocks a spell', () => {
  const B = new Battle({ mode: 'duel', arena: ARENAS[0], seed: 6, players: [setup('a'), setup('b')] });
  run(B, 3.5);
  const p = B.players[0];
  p.bricks = 60;
  assert.ok(B.heroUpgrade(0));
  assert.equal(p.hero.form, 2);
  assert.equal(p.bricks, 0);
  assert.ok(!B.heroUpgrade(0));
  assert.ok(B.heroSpell(0, 0));
  assert.ok(p.hero.spellCd[0] > 0);
});

test('every hero spell and gadget can be cast without errors', () => {
  for (const heroId of Object.keys(HEROES)) {
    for (const gadgetId of ['medkit', 'jetpack', 'frostgrenade', 'turret', 'shield', 'blackhole']) {
      const B = new Battle({ mode: 'duel', arena: ARENAS[0], seed: 7, players: [setup('a', STARTER, { heroId, gadgetId }), setup('b')] });
      run(B, 3.5);
      B.spawnUnit(1, 'knight', 9, 20, 1, { deployT: 0 });
      B.players[0].bricks = 500;
      B.heroUpgrade(0);
      B.heroUpgrade(0);
      assert.ok(B.heroSpell(0, 0), `${heroId} spell 1`);
      assert.ok(B.heroSpell(0, 1), `${heroId} spell 2`);
      run(B, 4.2); // gadgets start on a short cooldown
      assert.ok(B.heroGadget(0), `${gadgetId}`);
      run(B, 4);
    }
  }
});

test('every weapon fires and deals damage', () => {
  for (const weaponId of Object.keys(WEAPONS)) {
    const B = new Battle({ mode: 'duel', arena: ARENAS[0], seed: 8, players: [setup('a', STARTER, { weaponId, petId: null }), setup('b', STARTER, { heroId: null })] });
    run(B, 3.5);
    const h = B.players[0].hero;
    const dummy = B.spawnUnit(1, 'giant', h.x, h.y - Math.min(2, WEAPONS[weaponId].range - 0.2) - 0.9, 5, { deployT: 0 });
    dummy.speed = 0;
    run(B, 3);
    assert.ok(dummy.hp < dummy.maxHp, `${weaponId} did no damage`);
  }
});

test('every spell card resolves', () => {
  for (const id of CARD_IDS.filter((c) => CARDS[c].type === 'spell')) {
    const B = new Battle({ mode: 'duel', arena: ARENAS[0], seed: 9, players: [setup('a'), setup('b')] });
    run(B, 3.5);
    const u = B.spawnUnit(1, 'knight', 9, 10, 1, { deployT: 0 });
    B.players[0].elixir = 10;
    B.players[0].hand[0] = id;
    const res = B.playCard(0, 0, id === 'wall' ? 9 : 9, id === 'wall' ? 22 : 10);
    assert.ok(res.ok, `${id}: ${res.reason}`);
    run(B, 4);
    if (!['wall', 'bless'].includes(id)) assert.ok(!u.alive || u.hp < u.maxHp, `${id} did nothing`);
  }
});

test('every troop and building card can be deployed and simulated', () => {
  for (const id of CARD_IDS.filter((c) => CARDS[c].type !== 'spell')) {
    const B = new Battle({ mode: 'duel', arena: ARENAS[0], seed: 10, players: [setup('a'), setup('b')] });
    run(B, 3.5);
    B.players[0].elixir = 10;
    B.players[0].hand[0] = id;
    assert.ok(B.playCard(0, 0, 9, 22).ok, id);
    B.players[1].elixir = 10;
    B.players[1].hand[0] = 'knight';
    B.playCard(1, 0, 9, 10);
    run(B, 15);
  }
});

test('AI vs AI duel always finishes with a result', () => {
  for (let i = 0; i < 4; i++) {
    const a = ARENAS[i * 2];
    const B = new Battle({ mode: 'duel', arena: a, seed: 100 + i, players: [setup('a', a.ai.decks[0], { isAI: true }), setup('b', a.ai.decks[1], { isAI: true })] });
    B.ai = [new AIController(B, 0, 'hard'), new AIController(B, 1, a.ai.difficulty)];
    run(B, 300);
    assert.equal(B.phase, 'ended');
    assert.ok([-1, 0, 1].includes(B.result.winner));
  }
});

test('siege waves escalate and end when the king falls', () => {
  const B = new Battle({ mode: 'waves', arena: ARENAS[0], seed: 11, players: [setup('a'), { name: 'm', deck: [], cardLevels: {}, kingLevel: 1 }] });
  B.waves = new WaveDirector(B);
  run(B, 900);
  assert.equal(B.phase, 'ended');
  assert.ok(B.waves.wave >= 3, `reached wave ${B.waves.wave}`);
});
