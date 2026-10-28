// Unit tests for the God Box sandbox pure logic (no DOM): node --test tests/godbox.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { T, B, SP, H, IS_WATER, TICKS_PER_YEAR, MAX_CREATURES } from '../src/sandbox/constants.js';
import { generateTerrain, landRatio, baseTileForHeight } from '../src/sandbox/worldgen.js';
import { seedFromInput, hashString, makeRng, rnd } from '../src/sandbox/rng.js';
import { createState } from '../src/sandbox/state.js';
import { createWorld, tick, calendar } from '../src/sandbox/sim.js';
import {
  rleEncode, rleDecode, bytesToB64, b64ToBytes, packBytes, unpackBytes, encodeSave, decodeSave,
} from '../src/sandbox/codec.js';
import { ignite, stepFire, stepLava, paintTerrain, addCloud, stepClouds, raiseLand } from '../src/sandbox/elements.js';
import { applyTool } from '../src/sandbox/powers.js';
import { spawnCreature } from '../src/sandbox/creatures.js';
import { buildGrid } from '../src/sandbox/state.js';

/** Tiny flat test world: all grass at a fixed height. */
function flatWorld(w = 40, h = 40, tile = T.GRASS) {
  const n = w * h;
  const s = createState({
    w, h, seed: 1, height: new Uint8Array(n).fill(124), tile: new Uint8Array(n).fill(tile),
    biome: new Uint8Array(n), flags: new Uint8Array(n),
  });
  return s;
}

test('world generation is deterministic by seed', () => {
  const a = generateTerrain({ w: 120, h: 180, seed: 4242 });
  const b = generateTerrain({ w: 120, h: 180, seed: 4242 });
  assert.deepEqual(a.tile, b.tile);
  assert.deepEqual(a.height, b.height);
  assert.deepEqual(a.biome, b.biome);
  const c = generateTerrain({ w: 120, h: 180, seed: 4243 });
  let diff = 0;
  for (let i = 0; i < a.tile.length; i++) if (a.tile[i] !== c.tile[i]) diff++;
  assert.ok(diff > a.tile.length * 0.2, 'different seeds should give different worlds');
});

test('generated worlds have a sane mix of land, water and biomes', () => {
  for (const seed of [1, 77, 31337]) {
    const t = generateTerrain({ w: 160, h: 240, seed });
    const land = landRatio(t);
    assert.ok(land > 0.4 && land < 0.7, `land ratio ${land}`);
    const seen = new Set(t.tile);
    for (const want of [T.DEEP, T.SHALLOW, T.SAND, T.GRASS, T.FOREST, T.HILLS, T.MOUNTAIN, T.SNOW]) {
      assert.ok(seen.has(want), `tile ${want} present (seed ${seed})`);
    }
    const biomes = new Set(t.biome);
    assert.ok(biomes.has(B.MEADOW) && biomes.has(B.DESERT) && biomes.has(B.FROST));
    // The map border is ocean.
    for (let x = 0; x < t.w; x++) assert.ok(t.height[x] < H.SEA);
  }
});

test('seed input accepts numbers and text', () => {
  assert.equal(seedFromInput('12345'), 12345);
  assert.equal(seedFromInput(99), 99);
  assert.equal(seedFromInput('hello'), hashString('hello'));
  const r1 = makeRng(5);
  const r2 = makeRng(5);
  for (let i = 0; i < 10; i++) assert.equal(rnd(r1), rnd(r2));
});

test('height thresholds classify terrain in order', () => {
  assert.equal(baseTileForHeight(10), T.DEEP);
  assert.equal(baseTileForHeight(H.SEA - 1), T.SHALLOW);
  assert.equal(baseTileForHeight(H.SEA), T.SAND);
  assert.equal(baseTileForHeight(130), T.GRASS);
  assert.equal(baseTileForHeight(250), T.SNOW);
});

test('RLE and base64 round-trip', () => {
  const runs = new Uint8Array(5000);
  runs.fill(3, 0, 1000);
  runs.fill(7, 1000, 4000);
  const rle = rleEncode(runs);
  assert.ok(rle.length < 100);
  assert.deepEqual(rleDecode(rle, runs.length), runs);
  const noise = new Uint8Array(997);
  const r = makeRng(9);
  for (let i = 0; i < noise.length; i++) noise[i] = (rnd(r) * 256) | 0;
  assert.deepEqual(b64ToBytes(bytesToB64(noise)), noise);
  for (const len of [0, 1, 2, 3, 4, 5]) {
    const a = noise.slice(0, len);
    assert.deepEqual(b64ToBytes(bytesToB64(a)), a);
  }
  // packBytes chooses raw for noise and RLE for runs.
  assert.equal(packBytes(noise)[0], 'b');
  assert.equal(packBytes(runs)[0], 'r');
  assert.deepEqual(unpackBytes(packBytes(noise), noise.length), noise);
  assert.deepEqual(unpackBytes(packBytes(runs), runs.length), runs);
});

test('save/load round-trip restores the world exactly and stays small', () => {
  const s = createWorld({ size: 'small', seed: 'roundtrip', tribes: true });
  for (let i = 0; i < 700; i++) tick(s);
  applyTool(s, 'lava', 30, 60, 1);
  applyTool(s, 'fire', 60, 90, 2);
  const str = encodeSave(s);
  assert.ok(str.length < 400_000, `save is ${str.length} chars`);
  const r = decodeSave(str);
  assert.equal(r.w, s.w);
  assert.equal(r.tick, s.tick);
  assert.deepEqual(r.tile, s.tile);
  assert.deepEqual(r.height, s.height);
  assert.deepEqual(r.biome, s.biome);
  assert.deepEqual(r.zone, s.zone);
  assert.deepEqual(r.bmap, s.bmap);
  assert.equal(r.creatures.length, s.creatures.length);
  assert.equal(r.villages.size, s.villages.size);
  assert.deepEqual([...r.villages.values()].map((v) => v.name), [...s.villages.values()].map((v) => v.name));
  // Both copies continue identically (full state is saved, including RNG).
  for (let i = 0; i < 300; i++) {
    tick(s);
    tick(r);
  }
  assert.deepEqual(r.tile, s.tile);
  assert.equal(r.creatures.length, s.creatures.length);
  assert.deepEqual(r.creatures.map((c) => c.x), s.creatures.map((c) => c.x));
});

test('decodeSave rejects garbage', () => {
  assert.throws(() => decodeSave('{"format":"nope"}'));
  assert.throws(() => decodeSave('not json'));
});

test('fire spreads through forest, burns to ash, and never burns water', () => {
  const s = flatWorld(30, 30, T.FOREST);
  for (let x = 0; x < 30; x++) s.tile[15 * 30 + x] = T.SHALLOW; // a river across the middle
  ignite(s, 5 * 30 + 5, 60);
  for (let i = 0; i < 2000 && s.fires.length; i++) {
    s.tick++;
    stepFire(s);
  }
  let ash = 0;
  for (let y = 0; y < 15; y++) for (let x = 0; x < 30; x++) if (s.tile[y * 30 + x] === T.ASH) ash++;
  assert.ok(ash > 300, `forest north of the river burned (${ash} ash)`);
  for (let x = 0; x < 30; x++) assert.equal(s.tile[15 * 30 + x], T.SHALLOW);
  let southAsh = 0;
  for (let y = 16; y < 30; y++) for (let x = 0; x < 30; x++) if (s.tile[y * 30 + x] === T.ASH) southAsh++;
  assert.equal(southAsh, 0, 'fire does not jump the river');
  assert.equal(ignite(s, 15 * 30 + 3, 50), false, 'water cannot ignite');
});

test('rain puts out fires and regrows ash', () => {
  const s = flatWorld(30, 30, T.FOREST);
  for (let i = 0; i < s.n; i++) if (i % 3 === 0) s.tile[i] = T.ASH;
  for (let i = 0; i < s.n; i++) ignite(s, i, 200);
  addCloud(s, 'rain', 15, 15, 20, 400);
  for (let i = 0; i < 300; i++) {
    s.tick++;
    buildGrid(s);
    stepClouds(s);
  }
  let burning = 0;
  let grass = 0;
  for (let i = 0; i < s.n; i++) {
    if (s.fire[i]) burning++;
    if (s.tile[i] === T.GRASS) grass++;
  }
  assert.ok(burning < s.n * 0.05, `rain extinguished most fires (${burning} left)`);
  assert.ok(grass > 50, 'ash regrew into grass');
});

test('lava cools into stone when it touches water', () => {
  const s = flatWorld(20, 20, T.GRASS);
  for (let y = 0; y < 20; y++) s.tile[y * 20 + 10] = T.SHALLOW;
  paintTerrain(s, 9.5, 10.5, 0.6, T.LAVA);
  assert.equal(s.tile[10 * 20 + 9], T.LAVA);
  for (let i = 0; i < 50; i++) stepLava(s);
  assert.equal(s.tile[10 * 20 + 9], T.STONE, 'lava next to water became stone');
});

test('raising land turns shallow water into sand and lowering makes it water again', () => {
  const s = flatWorld(10, 10, T.SHALLOW);
  s.height.fill(96);
  raiseLand(s, 5, 5, 1.5, 1);
  assert.equal(s.tile[5 * 10 + 5], T.SAND);
  raiseLand(s, 5, 5, 1.5, -1);
  raiseLand(s, 5, 5, 1.5, -1);
  assert.ok(IS_WATER[s.tile[5 * 10 + 5]]);
});

test('a spawned tribe founds a village and grows', () => {
  const s = createWorld({ size: 'small', seed: 'village-test', tribes: true, animals: false });
  for (let i = 0; i < TICKS_PER_YEAR * 6; i++) tick(s);
  assert.ok(s.villages.size >= 3, `villages founded (${s.villages.size})`);
  assert.ok(s.kingdoms.size >= 1);
  const pop = s.counts.tribe.reduce((a, b) => a + b, 0);
  assert.ok(pop > 40, `population grew (${pop})`);
  let built = 0;
  for (const b of s.buildings.values()) if (b.prog >= 1) built++;
  assert.ok(built > s.villages.size * 2, 'villages built huts and farms');
});

test('bomb kills creatures in its radius and leaves distant ones alone', () => {
  const s = flatWorld(60, 60, T.GRASS);
  const near = spawnCreature(s, SP.SHEEP, 30, 30);
  const far = spawnCreature(s, SP.SHEEP, 5, 5);
  buildGrid(s);
  applyTool(s, 'bomb_impact', 30, 30, 1);
  assert.equal(near.dead, 1);
  assert.equal(far.dead, 0);
  assert.notEqual(s.tile[30 * 60 + 30], T.GRASS, 'crater changed the ground');
});

test('creature cap is respected', () => {
  const s = flatWorld(80, 80, T.GRASS);
  let made = 0;
  for (let i = 0; i < MAX_CREATURES + 200; i++) if (spawnCreature(s, SP.VILLAGER, 40, 40, { tribe: i % 4 })) made++;
  assert.equal(made, MAX_CREATURES);
});

test('calendar math', () => {
  assert.deepEqual(calendar(0), { year: 1, day: 1 });
  assert.equal(calendar(TICKS_PER_YEAR).year, 2);
});
