// God Box — world creation and the fixed-step simulation tick (pure, no DOM).
import { T, SP, SIZES, THINK, TICKS_PER_DAY, DAYS_PER_YEAR, TICKS_PER_YEAR, IS_WATER, BUILDABLE } from './constants.js';
import { seedFromInput } from './rng.js';
import { generateTerrain } from './worldgen.js';
import { createState, buildGrid, rand, randInt } from './state.js';
import { updateCreature, spawnCreature, spawnGroup } from './creatures.js';
import { stepFire, stepLava, stepAcid, stepClouds, stepHoles, stepTerrain } from './elements.js';
import { stepCiv } from './civ.js';

/**
 * Create a new world.
 * @param {{size?:'small'|'medium'|'large', seed?:string|number, tribes?:boolean, animals?:boolean}} [opts]
 */
export function createWorld(opts = {}) {
  const sizeKey = SIZES[opts.size] ? opts.size : 'medium';
  const dims = SIZES[sizeKey];
  const seed = seedFromInput(opts.seed);
  const terrain = generateTerrain({ w: dims.w, h: dims.h, seed });
  const s = createState(terrain, sizeKey);
  if (opts.animals !== false) populateAnimals(s);
  if (opts.tribes) populateTribes(s);
  recount(s);
  return s;
}

function randomTile(s, pred, tries = 400) {
  for (let k = 0; k < tries; k++) {
    const i = randInt(s, s.n);
    if (pred(s.tile[i], i)) return i;
  }
  return -1;
}

function populateAnimals(s) {
  const scale = s.n / 38400;
  const herds = Math.round(9 * scale);
  for (let h = 0; h < herds; h++) {
    const i = randomTile(s, (t) => t === T.GRASS);
    if (i < 0) break;
    for (let k = 0; k < 4; k++) spawnCreature(s, SP.SHEEP, (i % s.w) + rand(s) * 3, ((i / s.w) | 0) + rand(s) * 3);
  }
  const packs = Math.max(1, Math.round(3 * scale));
  const sheep = s.creatures.filter((c) => c.sp === SP.SHEEP);
  for (let p = 0; p < packs && sheep.length; p++) {
    const herd = sheep[randInt(s, sheep.length)];
    for (let tries = 0; tries < 20; tries++) {
      const x = herd.x + rand(s) * 24 - 12;
      const y = herd.y + rand(s) * 24 - 12;
      if (x < 1 || y < 1 || x >= s.w - 1 || y >= s.h - 1) continue;
      const t = s.tile[(y | 0) * s.w + (x | 0)];
      if (t !== T.FOREST && t !== T.GRASS && t !== T.HILLS) continue;
      for (let k = 0; k < 2; k++) spawnCreature(s, SP.WOLF, x + rand(s), y + rand(s));
      break;
    }
  }
  for (let k = 0; k < Math.round(10 * scale); k++) {
    const i = randomTile(s, (t) => t === T.SAND);
    if (i >= 0) spawnCreature(s, SP.CRAB, (i % s.w) + 0.5, ((i / s.w) | 0) + 0.5);
  }
  for (let k = 0; k < Math.round(60 * scale); k++) {
    const i = randomTile(s, (t) => IS_WATER[t] === 1);
    if (i >= 0) spawnCreature(s, SP.FISH, (i % s.w) + 0.5, ((i / s.w) | 0) + 0.5);
  }
}

const TRIBE_LIKES = [
  (t) => t === T.GRASS,
  (t) => t === T.GRASS || t === T.SAND,
  (t) => t === T.FOREST,
  (t) => t === T.HILLS,
];

/** Drop the four tribes far apart on good land. */
export function populateTribes(s) {
  const spots = [];
  for (let tribe = 0; tribe < 4; tribe++) {
    let best = -1;
    let bestScore = -Infinity;
    for (let k = 0; k < 60; k++) {
      const i = randomTile(s, (t) => BUILDABLE[t] === 1 && t !== T.SAND);
      if (i < 0) continue;
      const x = i % s.w;
      const y = (i / s.w) | 0;
      let score = 0;
      for (let m = 0; m < 30; m++) {
        const tx = x + randInt(s, 17) - 8;
        const ty = y + randInt(s, 17) - 8;
        if (tx < 0 || ty < 0 || tx >= s.w || ty >= s.h) continue;
        const t = s.tile[ty * s.w + tx];
        if (BUILDABLE[t]) score += 1;
        if (TRIBE_LIKES[tribe](t)) score += 0.6;
        if (IS_WATER[t]) score -= 0.4;
      }
      for (const p of spots) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < 45) score -= (45 - d) * 1.5;
      }
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) continue;
    const x = (best % s.w) + 0.5;
    const y = ((best / s.w) | 0) + 0.5;
    spots.push({ x, y });
    spawnGroup(s, tribe, x, y, 6);
  }
}

/** Remove the dead, recount populations per tribe/species/village. */
export function recount(s) {
  const counts = s.counts;
  counts.tribe.fill(0);
  counts.sp.fill(0);
  for (const v of s.villages.values()) {
    v.pop = 0;
    v.adults = 0;
    v.kids = 0;
    v.jobs.fill(0);
  }
  const list = s.creatures;
  let w = 0;
  let lastV = null;
  for (let k = 0; k < list.length; k++) {
    const c = list[k];
    if (c.dead) {
      s.byId.delete(c.id);
      continue;
    }
    list[w++] = c;
    counts.sp[c.sp]++;
    if (c.sp === SP.VILLAGER) {
      counts.tribe[c.tribe]++;
      if (c.vil) {
        const v = lastV && lastV.id === c.vil ? lastV : s.villages.get(c.vil);
        if (v) {
          lastV = v;
          v.pop++;
          if (c.child) v.kids++;
          else {
            v.adults++;
            v.jobs[c.job]++;
          }
        }
      }
    }
  }
  list.length = w;
  counts.total = w;
}

/** Advance the simulation by one fixed step. */
export function tick(s) {
  s.tick++;
  buildGrid(s);
  const list = s.creatures;
  const n = list.length;
  const t = s.tick;
  for (let k = 0; k < n; k++) {
    const c = list[k];
    if (!c.dead) updateCreature(s, c, (c.id + t) % THINK === 0);
  }
  if (t % 2 === 0) stepFire(s);
  if (t % 3 === 0) stepLava(s);
  if (t % 4 === 1) stepAcid(s);
  stepClouds(s);
  stepHoles(s);
  stepTerrain(s);
  stepCiv(s);
  recount(s);
}

/** Calendar for a tick count. */
export function calendar(tickCount) {
  return {
    year: Math.floor(tickCount / TICKS_PER_YEAR) + 1,
    day: (Math.floor(tickCount / TICKS_PER_DAY) % DAYS_PER_YEAR) + 1,
  };
}
