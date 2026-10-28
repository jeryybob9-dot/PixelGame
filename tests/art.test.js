// Art contract tests: sprite data shape, palette usage, required keys, hero skins, card art mapping.
import test from 'node:test';
import assert from 'node:assert/strict';

import { SPRITES, SPRITE_PROBLEMS, REQUIRED_KEYS, HEROES, HERO_W, HERO_H, heroOverlay, REALM_SPRITE_KEYS } from '../src/art/sprites.js';
import { PALETTE, TEAM_COLORS, RARITY_COLORS, ELEMENT_COLORS, colorOf } from '../src/art/palette.js';
import {
  CARD_ART_MAP, cardArtKey, defaultSkin, frameCount, spriteSize, getFrame, drawSprite, drawHero, cardArt, iconURL,
} from '../src/art/sprite-cache.js';
import { BIOMES, renderArenaBackground, drawRiver } from '../src/art/tiles.js';
import {
  REALM_TILES, renderRealmMap, renderRealmTile, drawRealmWater, drawTerritory, realmTileColor, REALM_BIOMES,
} from '../src/art/realm-tiles.js';

const VALID = new Set(['.', 'T', 't', 'L', ...Object.keys(PALETTE)]);

function framesOf(anim) {
  return typeof anim[0] === 'string' ? [anim] : anim;
}

test('no authoring problems were recorded while building sprites', () => {
  assert.deepEqual(SPRITE_PROBLEMS, []);
});

test('palette keys are single chars with #rrggbb colours and do not collide with reserved chars', () => {
  for (const [k, v] of Object.entries(PALETTE)) {
    assert.equal(k.length, 1, k);
    assert.ok(!'.TtL'.includes(k), `palette must not redefine reserved char ${k}`);
    assert.match(v, /^#[0-9a-f]{6}$/i, k);
  }
  assert.ok(Object.keys(PALETTE).length >= 28 && Object.keys(PALETTE).length <= 40);
  for (const t of [0, 1, 'null']) for (const s of ['main', 'dark', 'light']) assert.match(TEAM_COLORS[t][s], /^#[0-9a-f]{6}$/i);
  assert.equal(TEAM_COLORS[0].main, '#3b7dd8');
  assert.equal(TEAM_COLORS[1].main, '#d8453b');
  for (const r of ['common', 'rare', 'epic', 'legendary', 'mythic']) assert.ok(RARITY_COLORS[r]);
  for (const e of ['fire', 'ice', 'lightning', 'earth', 'shadow']) {
    assert.ok(ELEMENT_COLORS[e].main && ELEMENT_COLORS[e].dark && ELEMENT_COLORS[e].light);
    for (const c of Object.values(ELEMENT_COLORS[e].chars)) assert.ok(PALETTE[c], `${e} char ${c}`);
  }
  assert.equal(colorOf('.', 0), null);
  assert.equal(colorOf('T', 0), TEAM_COLORS[0].main);
  assert.equal(colorOf('T', 1), TEAM_COLORS[1].main);
  assert.equal(colorOf('T', null), TEAM_COLORS.null.main);
});

test('every sprite has frames of exactly w x h using only known palette chars', () => {
  for (const [key, s] of Object.entries(SPRITES)) {
    assert.ok(Number.isInteger(s.w) && s.w > 0, `${key}.w`);
    assert.ok(Number.isInteger(s.h) && s.h > 0, `${key}.h`);
    assert.ok(s.fps > 0, `${key}.fps`);
    assert.ok(s.anims && Object.keys(s.anims).length > 0, `${key}.anims`);
    for (const [anim, frames] of Object.entries(s.anims)) {
      const list = framesOf(frames);
      assert.ok(list.length > 0, `${key}.${anim} has frames`);
      list.forEach((rows, i) => {
        assert.equal(rows.length, s.h, `${key}.${anim}[${i}] height`);
        rows.forEach((r, y) => {
          assert.equal(typeof r, 'string', `${key}.${anim}[${i}] row ${y} type`);
          assert.equal(r.length, s.w, `${key}.${anim}[${i}] row ${y} width`);
          for (const ch of r) assert.ok(VALID.has(ch), `${key}.${anim}[${i}] row ${y} unknown char "${ch}"`);
        });
        assert.ok(rows.some((r) => /[^.]/.test(r)), `${key}.${anim}[${i}] is not empty`);
      });
    }
  }
});

test('every key required by the art contract exists', () => {
  const missing = REQUIRED_KEYS.filter((k) => !SPRITES[k]);
  assert.deepEqual(missing, []);
});

test('required animations exist', () => {
  const troops = [
    'knight', 'archer', 'skeleton', 'gunner', 'bomber', 'builder', 'sheep', 'giant', 'boarrider', 'minigunner', 'monk',
    'icemage', 'flamer', 'sniper', 'necro', 'crab', 'babycrab', 'rocketeer', 'ninja', 'zombie', 'mech', 'titan',
  ];
  for (const k of troops) {
    for (const a of ['idle', 'walk', 'attack']) assert.ok(SPRITES[k].anims[a], `${k}.${a}`);
    assert.ok(frameCount(k, 'walk') >= 2 && frameCount(k, 'walk') <= 4, `${k} walk 2-4 frames`);
    assert.ok(frameCount(k, 'attack') >= 2 && frameCount(k, 'attack') <= 3, `${k} attack 2-3 frames`);
  }
  for (const k of ['bat', 'dragon', 'ufo', 'bonedragon', 'phoenix', 'dragonpup', 'drone']) {
    assert.ok(SPRITES[k].fly, `${k} is a flyer`);
    assert.ok(frameCount(k, 'idle') >= 2, `${k} flaps`);
  }
  assert.ok(SPRITES.builder.anims.mine);
  for (const a of ['hidden', 'idle', 'attack']) assert.ok(SPRITES.tesla.anims[a], `tesla.${a}`);
  for (const a of ['idle', 'angry', 'cheer']) assert.ok(SPRITES.king.anims[a], `king.${a}`);
  for (const k of ['common', 'rare', 'epic', 'legendary', 'mythic']) {
    assert.ok(SPRITES['chest_' + k].anims.closed && SPRITES['chest_' + k].anims.open, `chest_${k}`);
  }
  assert.ok(frameCount('brickpile', 'idle') >= 2, 'brickpile sparkles');
  for (const k of ['bricktower', 'cannon', 'tesla']) assert.ok(SPRITES[k].anims.attack, `${k} shoots`);
});

test('contract sizes are respected for key sprites', () => {
  const sizes = {
    king_tower: [48, 48], princess_tower: [32, 40], tower_ruin: [32, 24], king: [12, 12], elem_fire: [8, 8],
    brickpile: [16, 16], scorch: [16, 16], chest_common: [24, 20], spell_nuke: [16, 16], gadget_shield: [16, 16],
    emote_gg: [24, 24], ui_gold: [10, 10], arrow: [7, 3], bullet: [3, 2], wall: [16, 16], tesla: [14, 20],
  };
  for (const [k, [w, h]] of Object.entries(sizes)) assert.deepEqual(spriteSize(k), { w, h }, k);
  for (const [k, s] of Object.entries(SPRITES)) {
    if (s.kind === 'weapon') {
      assert.ok(s.w >= 8 && s.w <= 14, `${k} weapon width 8-14`);
      assert.ok(Array.isArray(s.grip) && s.grip.length === 2, `${k} grip`);
    }
  }
});

test('hero skins are 12x16 and form overlays are aligned', () => {
  for (const id of ['ember', 'terra', 'volt', 'frost', 'grim']) {
    assert.ok(HEROES[id], id);
    const skin = defaultSkin(id);
    assert.equal(skin.length, HERO_H);
    for (const r of skin) {
      assert.equal(r.length, HERO_W);
      for (const ch of r) assert.ok(VALID.has(ch), `${id} skin char ${ch}`);
    }
    // defaultSkin returns a copy
    skin[0] = 'x';
    assert.notEqual(defaultSkin(id)[0], 'x');
  }
  for (const form of [2, 3]) {
    for (const el of ['fire', 'ice', 'lightning', 'earth', 'shadow']) {
      const { over, add } = heroOverlay(form, el);
      for (const layer of [over, add]) {
        assert.equal(layer.length, HERO_H);
        for (const r of layer) {
          assert.equal(r.length, HERO_W);
          for (const ch of r) assert.ok(ch === '_' || VALID.has(ch), `overlay char ${ch}`);
        }
      }
    }
  }
});

test('every card id has art', () => {
  const cards = [
    'knight', 'archers', 'skeletons', 'gunners', 'bats', 'zombies', 'bomber', 'builder', 'sheep', 'giant', 'boarrider',
    'minigunner', 'monk', 'icemage', 'flamer', 'sniper', 'dragon', 'necro', 'crab', 'ufo', 'rocketeer', 'ninja', 'mech',
    'bonedragon', 'titan', 'phoenix', 'bricktower', 'tesla', 'crypt', 'mine', 'cannon',
    'volley', 'spark', 'wall', 'meteor', 'quake', 'bless', 'lightning', 'acid', 'blizzard', 'plague', 'blackhole', 'nuke',
  ];
  for (const id of cards) {
    const m = cardArtKey(id);
    assert.ok(m, `card ${id} has art`);
    assert.ok(SPRITES[m.key], `card ${id} -> sprite ${m.key}`);
  }
  for (const [id, m] of Object.entries(CARD_ART_MAP)) assert.ok(SPRITES[m.key], `${id} -> ${m.key}`);
  assert.equal(cardArtKey('archers').key, 'archer');
  assert.equal(cardArtKey('archers').count, 2);
  assert.equal(cardArtKey('meteor').key, 'spell_meteor');
  assert.equal(cardArtKey('wall').key, 'spell_wall');
});

test('card ids from src/data/cards.js (when present) all have art', async () => {
  let mod;
  try {
    mod = await import('../src/data/cards.js');
  } catch {
    return; // data module not written yet
  }
  const raw = mod.CARDS ?? mod.cards ?? mod.default;
  if (!raw) return;
  const ids = Array.isArray(raw) ? raw.map((c) => c.id ?? c) : Object.keys(raw);
  for (const id of ids) if (typeof id === 'string') assert.ok(cardArtKey(id), `card ${id} has art`);
});

test('biomes are complete', () => {
  const ids = ['meadow', 'desert', 'frost', 'swamp', 'crystal', 'lava', 'candy', 'void'];
  assert.deepEqual(Object.keys(BIOMES).sort(), ids.slice().sort());
  for (const id of ids) {
    const b = BIOMES[id];
    assert.ok(b.name && b.ground.length === 2 && b.water.deep && b.water.light && b.props.length > 0, id);
  }
});

test('rendering APIs are safe to call in Node (no DOM)', () => {
  assert.doesNotThrow(() => getFrame('knight', 'walk', 1, 0));
  assert.doesNotThrow(() => getFrame('no_such_sprite'));
  assert.doesNotThrow(() => drawSprite(null, 'knight', 10, 10, { t: 1 }));
  assert.doesNotThrow(() => drawHero(null, { heroId: 'ember', form: 3, x: 0, y: 0, weaponId: 'rifle', aim: 2 }));
  assert.doesNotThrow(() => cardArt('archers'));
  assert.equal(typeof iconURL('ui_gold'), 'string');
  assert.doesNotThrow(() => renderArenaBackground('lava', 3));
  assert.doesNotThrow(() => drawRiver(null, 'lava', 1));
  assert.equal(frameCount('knight', 'missing_anim'), frameCount('knight', 'idle'));
});

// ---------------------------------------------------------------------------------------------
// Tiny Gods realm: village sprites + terrain renderer
// ---------------------------------------------------------------------------------------------

test('realm sprites exist with contract sizes and animations', () => {
  const sizes = {
    keep: [40, 44], house: [20, 20], temple: [22, 26], barracks: [24, 22], banner: [10, 16], scaffold: [20, 20], nest: [24, 16],
    villager: [10, 12], priest: [10, 12], wolf: [14, 10], bandit: [12, 14], faith_orb: [6, 6], brick_orb: [6, 6], heart_orb: [6, 6],
    ui_faith: [10, 10], ui_pop: [10, 10], ui_hammer: [10, 10], ui_horn: [10, 10], ui_shield: [10, 10],
  };
  assert.deepEqual(Object.keys(sizes).sort(), REALM_SPRITE_KEYS.slice().sort());
  for (const [k, [w, h]] of Object.entries(sizes)) {
    assert.ok(SPRITES[k], `${k} exists`);
    assert.deepEqual(spriteSize(k), { w, h }, k);
  }
  const anims = {
    keep: ['idle', 'attack'], house: ['idle'], temple: ['idle'], barracks: ['idle', 'train'], banner: ['idle'], scaffold: ['idle'],
    nest: ['idle'], villager: ['idle', 'walk', 'mine', 'carry'], priest: ['idle', 'pray'], wolf: ['idle', 'walk', 'attack'],
    bandit: ['idle', 'walk', 'attack'], faith_orb: ['idle'],
  };
  for (const [k, list] of Object.entries(anims)) for (const a of list) assert.ok(SPRITES[k].anims[a], `${k}.${a}`);
  assert.equal(frameCount('scaffold', 'idle'), 3, 'scaffold has 3 build-progress frames');
  assert.equal(frameCount('faith_orb', 'idle'), 3, 'faith orb pulses in 3 frames');
  for (const k of ['house', 'temple', 'banner', 'nest', 'brick_orb']) assert.ok(frameCount(k, 'idle') >= 2, `${k} idle is animated`);
  for (const k of ['villager', 'wolf', 'bandit']) assert.ok(frameCount(k, 'walk') >= 2, `${k} walks`);
  // neutral creatures never use team colours
  for (const k of ['nest', 'wolf', 'bandit']) {
    for (const frames of Object.values(SPRITES[k].anims)) {
      for (const f of framesOf(frames)) for (const r of f) assert.ok(!/[TtL]/.test(r), `${k} must not use team chars`);
    }
  }
  // village buildings and tribe units are team coloured
  for (const k of ['keep', 'house', 'temple', 'barracks', 'banner', 'villager', 'priest']) {
    assert.ok(framesOf(SPRITES[k].anims.idle).some((f) => f.some((r) => /[TtL]/.test(r))), `${k} uses team chars`);
  }
});

test('realm terrain API: tile ids, colours, Node-safe rendering and view-clipped overlays', () => {
  assert.deepEqual(REALM_TILES, {
    DEEP: 0, WATER: 1, SAND: 2, GRASS: 3, FOREST: 4, HILL: 5, MOUNTAIN: 6, ASH: 7, SNOW: 8, LAVA: 9, MUD: 10, CRYSTAL: 11, PATH: 12,
  });
  assert.deepEqual(REALM_BIOMES.slice().sort(), ['candy', 'crystal', 'desert', 'frost', 'lava', 'meadow', 'swamp', 'void']);
  for (const b of REALM_BIOMES) for (const t of Object.values(REALM_TILES)) assert.match(realmTileColor(t, b), /^#[0-9a-f]{6}$/i, `${b}/${t}`);
  const w = 12;
  const h = 10;
  const tiles = new Uint8Array(w * h).fill(REALM_TILES.GRASS);
  for (let i = 0; i < w; i++) tiles[i] = REALM_TILES.WATER;
  tiles[5 * w + 5] = REALM_TILES.FOREST;
  tiles[6 * w + 6] = REALM_TILES.LAVA;
  const c = renderRealmMap(tiles, w, h, 'meadow', 3);
  assert.equal(c.width, w * 16);
  assert.equal(c.height, h * 16);
  assert.doesNotThrow(() => renderRealmTile(null, tiles, w, h, 5, 5, 'meadow', 3));
  assert.doesNotThrow(() => drawRealmWater(null, tiles, w, h, 'meadow', 1, { x0: 0, y0: 0, x1: w, y1: h }));
  // mock context: overlays only touch tiles inside the view rect
  const rects = [];
  const ctx = {
    globalAlpha: 1, fillStyle: '', save() {}, restore() {}, beginPath() {}, fill() {},
    rect(x, y, rw, rh) { rects.push([x, y, rw, rh]); },
  };
  const view = { x0: 0, y0: 0, x1: 4, y1: 3 };
  for (let k = 0; k < 10; k++) drawRealmWater(ctx, tiles, w, h, 'meadow', k * 0.37, view);
  assert.ok(rects.length > 0, 'water glints drawn');
  for (const [x, y] of rects) assert.ok(x >= 0 && x < 5 * 16 && y >= 0 && y < 4 * 16, `glint ${x},${y} inside view`);
  rects.length = 0;
  const owner = new Int8Array(w * h).fill(-1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) owner[y * w + x] = x < 4 ? 0 : x > 7 ? 1 : -1;
  drawTerritory(ctx, owner, w, h, { x0: 2, y0: 2, x1: 9, y1: 5 });
  assert.ok(rects.length > 0, 'territory drawn');
  for (const [x, y] of rects) assert.ok(x >= 2 * 16 && x < 10 * 16 && y >= 2 * 16 && y < 6 * 16, `territory ${x},${y} inside view`);
});
