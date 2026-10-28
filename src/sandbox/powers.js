// God Box — god tools: terrain brushes, spawning and powers (pure, no DOM).
import { T, B, SP, H, IS_WATER, TICKS_PER_DAY } from './constants.js';
import { rand, randInt, randRange, fx, sfx, addEvent, forEachNear } from './state.js';
import {
  paintTerrain, raiseLand, paintBiome, forDisc, shiftHeight, setTile, ignite, igniteDisc, paintAcid,
  addCloud, addHole,
} from './elements.js';
import { spawnCreature, spawnGroup, damage, walkable, infect } from './creatures.js';
import { damageBuilding } from './civ.js';

export const BRUSH_RADII = [1.5, 3, 6];

const TERRAIN_TOOLS = {
  deep: T.DEEP, shallow: T.SHALLOW, sand: T.SAND, grass: T.GRASS, forest: T.FOREST,
  hills: T.HILLS, mountain: T.MOUNTAIN, snow: T.SNOW, lava: T.LAVA,
};
const BIOME_TOOLS = { b_meadow: B.MEADOW, b_desert: B.DESERT, b_swamp: B.SWAMP, b_frost: B.FROST, b_candy: B.CANDY, b_void: B.VOID };
const TRIBE_TOOLS = { brick: 0, ember: 1, leaf: 2, stone: 3 };
const ANIMAL_TOOLS = {
  sheep: [SP.SHEEP, 3], wolf: [SP.WOLF, 2], crab: [SP.CRAB, 3], fish: [SP.FISH, 4],
  zombie: [SP.ZOMBIE, 1], skeleton: [SP.SKELETON, 2], dragon: [SP.DRAGON, 1], ufo: [SP.UFO, 1],
};

/** Tools that paint continuously while dragging (others fire once per tap / cooldown). */
export const CONTINUOUS = new Set([...Object.keys(TERRAIN_TOOLS), 'raise', 'lower', ...Object.keys(BIOME_TOOLS), 'fire', 'acid', 'bless']);

/**
 * Apply a god tool at world position (x, y).
 * Delayed powers (meteor, bomb, nuke) are applied via their *_impact ids by the UI after the fall animation.
 * @returns {{ok:boolean, msg?:string}}
 */
export function applyTool(s, id, x, y, size = 1) {
  const r = BRUSH_RADII[size] ?? 3;
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return { ok: false };
  if (id in TERRAIN_TOOLS) {
    paintTerrain(s, x, y, r, TERRAIN_TOOLS[id]);
    if (id === 'lava' && rand(s) < 0.2) sfx(s, 'fire_ignite');
    return { ok: true };
  }
  if (id === 'raise' || id === 'lower') {
    raiseLand(s, x, y, r + 0.5, id === 'raise' ? 1 : -1);
    return { ok: true };
  }
  if (id in BIOME_TOOLS) {
    paintBiome(s, x, y, r * 2 + 1, BIOME_TOOLS[id]);
    return { ok: true };
  }
  if (id in TRIBE_TOOLS) {
    if (!walkable(s, x, y) || IS_WATER[s.tile[(y | 0) * s.w + (x | 0)]]) return { ok: false, msg: 'Villagers need dry land' };
    const group = spawnGroup(s, TRIBE_TOOLS[id], x, y, 5);
    if (!group.length) return { ok: false, msg: 'The world is full!' };
    sfx(s, 'deploy');
    return { ok: true };
  }
  if (id in ANIMAL_TOOLS) {
    const [sp, n] = ANIMAL_TOOLS[id];
    const i = (y | 0) * s.w + (x | 0);
    const water = IS_WATER[s.tile[i]] === 1;
    if (sp === SP.FISH && !water) return { ok: false, msg: 'Fish need water' };
    if (sp !== SP.FISH && sp !== SP.DRAGON && sp !== SP.UFO && !walkable(s, x, y)) return { ok: false, msg: 'Needs land' };
    let made = 0;
    for (let k = 0; k < n; k++) {
      let px = x + randRange(s, -1.5, 1.5);
      let py = y + randRange(s, -1.5, 1.5);
      const pi = (py | 0) * s.w + (px | 0);
      const ok = px >= 0 && py >= 0 && px < s.w && py < s.h && (sp === SP.FISH ? IS_WATER[s.tile[pi]] : sp >= SP.DRAGON || walkable(s, px, py));
      if (!ok) {
        px = x;
        py = y;
      }
      if (spawnCreature(s, sp, px, py)) made++;
    }
    if (!made) return { ok: false, msg: 'Too many of those already!' };
    sfx(s, sp === SP.SHEEP ? 'sheep' : sp === SP.DRAGON ? 'dragon_roar' : sp === SP.UFO ? 'ufo' : sp === SP.ZOMBIE ? 'zombie_infect' : 'deploy');
    fx(s, { k: 'p', kind: sp >= SP.ZOMBIE ? 'magic' : 'gold', x, y, n: 6 });
    if (sp === SP.DRAGON) addEvent(s, 'A dragon has awoken!', { x, y, color: '#ff8a2e', kind: 'monster' });
    if (sp === SP.UFO) addEvent(s, 'A UFO appeared in the sky', { x, y, color: '#4ae3ff', kind: 'monster', key: 'ufospawn', cooldown: 60 });
    return { ok: true };
  }
  switch (id) {
    case 'fire': {
      igniteDisc(s, x, y, r, 0.7, 60);
      forEachNear(s, x, y, r, (c) => {
        if (!c.fly && !c.aq) c.burn = Math.max(c.burn, 18);
        return false;
      });
      fx(s, { k: 'p', kind: 'fire', x, y, n: 2 + Math.round(r) });
      if (rand(s) < 0.15) sfx(s, 'fire_ignite');
      return { ok: true };
    }
    case 'rain':
      addCloud(s, 'rain', x, y, r + 4, 260);
      sfx(s, 'splash');
      return { ok: true };
    case 'plague':
      addCloud(s, 'plague', x, y, r + 4, 180);
      forEachNear(s, x, y, r + 4, (c) => {
        infect(s, c);
        return false;
      });
      sfx(s, 'poison');
      return { ok: true };
    case 'bless': {
      let n = 0;
      forEachNear(s, x, y, r + 2, (c) => {
        if (c.sp >= SP.ZOMBIE) return false;
        c.hp = c.mhp;
        c.bless = 480;
        c.burn = 0;
        c.sick = 0;
        c.inf = 0;
        n++;
        return false;
      });
      forDisc(s, x, y, r, (i) => {
        if (s.tile[i] === T.ASH || s.tile[i] === T.WASTE) setTile(s, i, T.GRASS);
        if (s.tile[i] === T.FARM && s.aux[i] < 3) s.aux[i]++;
        s.fire[i] = 0;
      });
      fx(s, { k: 'p', kind: 'gold', x, y, n: 4 + n });
      if (rand(s) < 0.25) sfx(s, 'heal');
      return { ok: true };
    }
    case 'acid':
      paintAcid(s, x, y, r);
      forEachNear(s, x, y, r, (c) => {
        if (!c.fly) damage(s, c, 12, null, 'acid');
        return false;
      });
      if (rand(s) < 0.2) sfx(s, 'poison');
      return { ok: true };
    case 'lightning':
      lightning(s, x, y, size);
      return { ok: true };
    case 'quake':
      earthquake(s, x, y, 10 + size * 5);
      return { ok: true };
    case 'meteor_impact':
      explode(s, x, y, [3.5, 5, 7][size], { crater: 34, fire: 0.6, power: 1.4 });
      sfx(s, 'explosion_big');
      fx(s, { k: 'shake', a: 9 + size * 3 });
      addEvent(s, 'A meteor struck!', { x, y, color: '#ff8a2e', key: 'meteor', cooldown: 30, kind: 'power' });
      return { ok: true };
    case 'bomb_impact':
      explode(s, x, y, [2.5, 3.5, 5][size], { crater: 14, fire: 0.35, power: 1 });
      sfx(s, 'explosion_small');
      fx(s, { k: 'shake', a: 4 + size * 2 });
      return { ok: true };
    case 'nuke_impact':
      nuke(s, x, y);
      return { ok: true };
    case 'blackhole':
      addHole(s, x, y);
      sfx(s, 'black_hole');
      fx(s, { k: 'shake', a: 5 });
      addEvent(s, 'A black hole tears open the world!', { x, y, color: '#b45be8', key: 'hole', cooldown: 60, kind: 'power' });
      return { ok: true };
    default:
      return { ok: false };
  }
}

/** Lightning strike: damage, fire, electrified water. */
export function lightning(s, x, y, size = 1) {
  const r = 1.5 + size * 0.5;
  const i = (y | 0) * s.w + (x | 0);
  const water = IS_WATER[s.tile[i]] === 1;
  forEachNear(s, x, y, water ? 4 : r + 0.5, (c) => {
    damage(s, c, water && c.aq ? 99 : 45, null, 'lightning');
    if (!c.dead && !c.aq) c.burn = Math.max(c.burn, 12);
    return false;
  });
  if (!water) igniteDisc(s, x, y, r, 0.8, 70);
  forDisc(s, x, y, r, (j) => {
    const bid = s.bmap[j];
    if (bid) {
      const b = s.buildings.get(bid);
      if (b) damageBuilding(s, b, 18, 'lightning');
    }
    if (s.tile[j] === T.SAND && rand(s) < 0.3) setTile(s, j, T.STONE);
  });
  fx(s, { k: 'bolt', x, y });
  fx(s, { k: 'p', kind: 'spark', x, y, n: 10 });
  fx(s, { k: 'shake', a: 2 });
  sfx(s, 'lightning');
}

/**
 * Generic blast: crater, scorched ring, fire, building and creature damage.
 * @param {{crater?:number, fire?:number, power?:number, waste?:boolean}} o
 */
export function explode(s, x, y, r, o = {}) {
  const crater = o.crater || 0;
  forDisc(s, x, y, r * 1.35, (i, tx, ty, f0) => {
    const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y) / r;
    const t = s.tile[i];
    if (d < 0.62 && crater) {
      const depth = Math.round(crater * (1 - d / 0.62) + 6);
      shiftHeight(s, i, -depth);
      if (!IS_WATER[s.tile[i]] && s.tile[i] !== T.LAVA) setTile(s, i, d < 0.35 && crater > 20 && rand(s) < 0.3 ? T.LAVA : T.STONE);
      if (s.tile[i] === T.LAVA) s.lavas.push(i);
    } else if (d < 0.8 && crater) {
      shiftHeight(s, i, 4);
      if (!IS_WATER[s.tile[i]]) setTile(s, i, rand(s) < 0.5 ? T.ASH : T.STONE);
    } else if (d < 1) {
      if (t === T.GRASS || t === T.FOREST || t === T.FARM) setTile(s, i, o.waste ? T.WASTE : T.ASH);
      if (t === T.SNOW || t === T.ICE) setTile(s, i, t === T.ICE ? T.SHALLOW : T.HILLS);
    }
    if (o.fire && d < 1.35 && rand(s) < o.fire * (1.4 - d)) ignite(s, i, 50 + randInt(s, 40));
    const bid = s.bmap[i];
    if (bid && d < 1.2) {
      const b = s.buildings.get(bid);
      if (b) damageBuilding(s, b, 400 * (o.power || 1) * (1.2 - d), 'explosion');
    }
  });
  const power = o.power || 1;
  forEachNear(s, x, y, r * 1.5, (c) => {
    const d = Math.hypot(c.x - x, c.y - y);
    const k = 1 - d / (r * 1.5);
    damage(s, c, 90 * power * k + 5, null, 'explosion');
    if (!c.dead && d > 0.01) {
      const push = k * 2.5;
      const nx = c.x + ((c.x - x) / d) * push;
      const ny = c.y + ((c.y - y) / d) * push;
      if (nx > 0 && ny > 0 && nx < s.w && ny < s.h) {
        c.x = nx;
        c.y = ny;
      }
      if (!c.aq) c.burn = Math.max(c.burn, 12);
    }
    return false;
  });
  fx(s, { k: 'boom', x, y, r });
}

export function nuke(s, x, y) {
  const r = Math.round(13 * Math.sqrt(s.n / 38400));
  explode(s, x, y, r, { crater: 40, fire: 0.25, power: 3, waste: true });
  forDisc(s, x, y, r * 2, (i, tx, ty) => {
    const d = Math.hypot(tx - x, ty - y) / r;
    if (d < 1.35) return;
    const t = s.tile[i];
    if ((t === T.GRASS || t === T.FOREST || t === T.FARM) && rand(s) < (2 - d) * 0.7) setTile(s, i, T.WASTE);
    if (t === T.ICE || t === T.SNOW) setTile(s, i, t === T.ICE ? T.SHALLOW : T.HILLS);
  });
  forEachNear(s, x, y, r * 2, (c) => {
    damage(s, c, 40, null, 'radiation');
    return false;
  });
  for (let k = 0; k < 4; k++) addCloud(s, 'fallout', x + randRange(s, -r, r), y + randRange(s, -r, r), r * 0.8, 420);
  fx(s, { k: 'flash', a: 1 });
  fx(s, { k: 'shake', a: 22 });
  fx(s, { k: 'mushroom', x, y, r });
  sfx(s, 'nuke');
  addEvent(s, 'An atomic bomb was dropped!', { x, y, color: '#e8e83b', kind: 'power' });
}

export function earthquake(s, x, y, r) {
  const lines = 3 + randInt(s, 4);
  for (let l = 0; l < lines; l++) {
    let px = x + randRange(s, -2, 2);
    let py = y + randRange(s, -2, 2);
    let a = rand(s) * Math.PI * 2;
    const len = r * 0.6 + rand(s) * r * 0.6;
    for (let step = 0; step < len; step++) {
      px += Math.cos(a);
      py += Math.sin(a);
      a += (rand(s) - 0.5) * 0.9;
      if (px < 0 || py < 0 || px >= s.w || py >= s.h) break;
      const i = (py | 0) * s.w + (px | 0);
      const t = s.tile[i];
      if (!IS_WATER[t] && t !== T.LAVA) {
        setTile(s, i, T.CRACK);
        if (rand(s) < 0.3) {
          const j = i + (rand(s) < 0.5 ? 1 : s.w);
          if (j < s.n && !IS_WATER[s.tile[j]]) setTile(s, j, T.CRACK);
        }
      }
    }
  }
  forDisc(s, x, y, r, (i, tx, ty, f) => {
    const t = s.tile[i];
    if ((t === T.MOUNTAIN || t === T.HILLS || t === T.SNOW) && rand(s) < 0.2 * f + 0.05) shiftHeight(s, i, -16);
    else if (t === T.FOREST && rand(s) < 0.12) setTile(s, i, T.GRASS);
    const bid = s.bmap[i];
    if (bid && rand(s) < 0.25) {
      const b = s.buildings.get(bid);
      if (b) damageBuilding(s, b, 25 + rand(s) * 60 * f, 'earthquake');
    }
  });
  forEachNear(s, x, y, r, (c) => {
    if (!c.fly && !c.aq) damage(s, c, 4 + rand(s) * 6, null, 'earthquake');
    return false;
  });
  fx(s, { k: 'shake', a: 14, dur: 1.6 });
  fx(s, { k: 'p', kind: 'dust', x, y, n: 30, spread: r });
  sfx(s, 'earthquake');
  addEvent(s, 'The earth shakes!', { x, y, color: '#e8743b', key: 'quake', cooldown: 30, kind: 'power' });
}

export { H, TICKS_PER_DAY };
