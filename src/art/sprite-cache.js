/**
 * Brickbox Royale — sprite rendering + caching.
 *
 * Turns the palette-char rows in sprites.js into canvases (cached per key/anim/frame/team/flash),
 * draws them anchored at the feet (bottom-centre), composes heroes (skin + form overlay + weapon),
 * renders 32x32 card art and data-URL icons for the HTML UI.
 *
 * Safe to import in Node: canvases are only created lazily when something is drawn.
 */

import { SPRITES, HEROES, HERO_HAND, heroOverlay, HERO_W, HERO_H } from './sprites.js';
import { colorOf, hexToRgb, ELEMENT_COLORS } from './palette.js';

// ---------------------------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------------------------

const FLASH_STEPS = 4; // flash buckets: 0, .25, .5, .75, 1

function newCanvas(w, h) {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  // Headless stub (Node tests): drawing becomes a no-op.
  return { width: w, height: h, getContext: () => null, toDataURL: () => '' };
}

function ctx2d(c) {
  const g = c.getContext ? c.getContext('2d') : null;
  if (g) g.imageSmoothingEnabled = false;
  return g;
}

/**
 * Paint rows of palette chars into a new canvas.
 * @param {string[]} rows
 * @param {0|1|null} team
 * @param {number} flash 0..1 blend toward white
 * @param {Record<string, number>} [alphaMap] optional per-char alpha (0..1)
 */
function rowsToCanvas(rows, team, flash = 0, alphaMap = null) {
  const h = rows.length;
  const w = h ? rows[0].length : 0;
  const c = newCanvas(Math.max(1, w), Math.max(1, h));
  const g = ctx2d(c);
  if (!g || !w || !h) return c;
  const img = g.createImageData(w, h);
  const d = img.data;
  const lut = new Map();
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      let rgb = lut.get(ch);
      if (rgb === undefined) {
        const hex = colorOf(ch, team);
        if (hex) {
          const [r, gg, b] = hexToRgb(hex);
          rgb = [r + (255 - r) * flash, gg + (255 - gg) * flash, b + (255 - b) * flash];
        } else rgb = null;
        lut.set(ch, rgb);
      }
      if (!rgb) continue;
      const i = (y * w + x) * 4;
      d[i] = rgb[0];
      d[i + 1] = rgb[1];
      d[i + 2] = rgb[2];
      d[i + 3] = alphaMap && ch in alphaMap ? Math.round(255 * alphaMap[ch]) : 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function bucket(flash) {
  if (!flash || flash <= 0) return 0;
  return Math.min(FLASH_STEPS, Math.max(1, Math.round(flash * FLASH_STEPS)));
}

/**
 * Render arbitrary palette rows to a new (uncached) canvas. Used by tiles.js for props.
 * @param {string[]} rows @param {0|1|null} [team]
 */
export function renderRows(rows, team = null) {
  return rowsToCanvas(rows, team, 0);
}

/** Create a canvas (DOM, OffscreenCanvas or a headless stub). */
export function makeCanvas(w, h) {
  return newCanvas(w, h);
}

// ---------------------------------------------------------------------------------------------
// Sprite frames
// ---------------------------------------------------------------------------------------------

const PLACEHOLDER = (() => {
  const rows = [];
  for (let y = 0; y < 8; y++) {
    let r = '';
    for (let x = 0; x < 8; x++) r += (x + y) % 2 ? 'e' : 'o';
    rows.push(r);
  }
  return { w: 8, h: 8, fps: 1, anims: { idle: [rows] } };
})();

const warned = new Set();
function spriteDef(key) {
  const s = SPRITES[key];
  if (s) return s;
  if (!warned.has(key)) {
    warned.add(key);
    if (typeof console !== 'undefined') console.warn(`[art] unknown sprite key "${key}"`);
  }
  return PLACEHOLDER;
}

/** Normalise an anim to a list of frames (each frame = rows). */
function framesOf(def, anim) {
  let a = def.anims[anim];
  if (!a) a = def.anims.idle ?? Object.values(def.anims)[0];
  if (!a || !a.length) return [[]];
  return typeof a[0] === 'string' ? [a] : a;
}

/**
 * Number of frames in an animation (falls back to idle when the anim does not exist).
 * @param {string} key @param {string} [anim]
 */
export function frameCount(key, anim = 'idle') {
  return framesOf(spriteDef(key), anim).length;
}

/** @param {string} key @param {string} anim */
export function hasAnim(key, anim) {
  return !!SPRITES[key]?.anims?.[anim];
}

/**
 * Sprite size in pixels.
 * @param {string} key
 * @returns {{w:number,h:number}}
 */
export function spriteSize(key) {
  const d = spriteDef(key);
  return { w: d.w, h: d.h };
}

const frameCache = new Map();

function teamKey(team) {
  return team === 0 || team === 1 ? team : 'n';
}

function frameCanvas(key, anim, frameIndex, team, fb) {
  const ck = `${key}|${anim}|${frameIndex}|${teamKey(team)}|${fb}`;
  let c = frameCache.get(ck);
  if (!c) {
    const frames = framesOf(spriteDef(key), anim);
    const n = frames.length;
    const rows = frames[((frameIndex % n) + n) % n];
    c = rowsToCanvas(rows, team === 0 || team === 1 ? team : null, fb / FLASH_STEPS);
    frameCache.set(ck, c);
  }
  return c;
}

/**
 * A cached canvas for one frame.
 * @param {string} key @param {string} [anim] @param {number} [frameIndex] @param {0|1|null} [team]
 * @returns {HTMLCanvasElement}
 */
export function getFrame(key, anim = 'idle', frameIndex = 0, team = null) {
  return frameCanvas(key, anim, frameIndex | 0, team, 0);
}

/** Frame index for time t (seconds). */
function frameAt(key, anim, t) {
  const def = spriteDef(key);
  const n = framesOf(def, anim).length;
  if (n <= 1) return 0;
  const f = Math.floor((t || 0) * (def.fps || 6));
  return ((f % n) + n) % n;
}

/**
 * Draw a sprite anchored at its feet (bottom-centre).
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} key
 * @param {number} x canvas px
 * @param {number} y canvas px (feet)
 * @param {{anim?:string,t?:number,team?:0|1|null,flip?:boolean,alpha?:number,flash?:number,scale?:number,frame?:number}} [o]
 *   `frame` (optional) forces a frame index instead of picking one from `t`.
 */
export function drawSprite(ctx, key, x, y, o = {}) {
  const anim = o.anim ?? 'idle';
  const fi = o.frame != null ? o.frame | 0 : frameAt(key, anim, o.t ?? 0);
  const c = frameCanvas(key, anim, fi, o.team ?? null, bucket(o.flash));
  blit(ctx, c, x, y, c.width / 2, c.height, o.scale ?? 1, !!o.flip, o.alpha ?? 1);
}

function blit(ctx, c, x, y, ax, ay, scale, flip, alpha) {
  if (!ctx || alpha <= 0) return;
  const w = c.width * scale;
  const h = c.height * scale;
  const dx = Math.round(x - ax * scale);
  const dy = Math.round(y - ay * scale);
  const needState = flip || alpha < 1;
  if (needState) {
    ctx.save();
    if (alpha < 1) ctx.globalAlpha *= alpha;
    if (flip) {
      ctx.translate(Math.round(x) * 2, 0);
      ctx.scale(-1, 1);
    }
  }
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, flip ? Math.round(x) * 2 - dx - w : dx, dy, w, h);
  ctx.imageSmoothingEnabled = smooth;
  if (needState) ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Heroes
// ---------------------------------------------------------------------------------------------

/**
 * The default 12x16 skin of a hero.
 * @param {string} heroId ember | terra | volt | frost | grim
 * @returns {string[]} 16 rows of 12 palette chars
 */
export function defaultSkin(heroId) {
  const h = HEROES[heroId] ?? HEROES.ember;
  return h.skin.slice();
}

const PAD_X = 2;
const PAD_TOP = 2;
const PAD_BOTTOM = 2;
const CW = HERO_W + PAD_X * 2;
const CH = HERO_H + PAD_TOP + PAD_BOTTOM;

function normSkin(skin) {
  if (!Array.isArray(skin) || skin.length === 0) return null;
  const out = [];
  for (let y = 0; y < HERO_H; y++) {
    const r = String(skin[y] ?? '');
    let row = '';
    for (let x = 0; x < HERO_W; x++) {
      const ch = r[x] ?? '.';
      row += colorOf(ch, 0) || ch === '.' ? ch : '.';
    }
    out.push(row);
  }
  return out;
}

function blankGrid(w, h) {
  return Array.from({ length: h }, () => new Array(w).fill('.'));
}

function put(grid, rows, ox, oy, x0 = 0, y0 = 0, x1 = HERO_W, y1 = HERO_H) {
  for (let y = y0; y < y1; y++) {
    const r = rows[y];
    for (let x = x0; x < x1; x++) {
      const ch = r[x];
      if (ch === '.') continue;
      const gx = x + ox;
      const gy = y + oy;
      if (gy >= 0 && gy < grid.length && gx >= 0 && gx < grid[0].length) grid[gy][gx] = ch;
    }
  }
}

/** Apply the form overlay to a skin (12x16 rows). `over` paints only on body pixels, `add` paints anywhere. */
function withForm(rows, heroId, form) {
  if (!form || form < 2) return rows;
  const element = HEROES[heroId]?.element ?? 'fire';
  const { over, add } = heroOverlay(form, element);
  return rows.map((r, y) => {
    let s = '';
    for (let x = 0; x < HERO_W; x++) {
      let ch = r[x];
      const v = over[y][x];
      const a = add[y][x];
      if (v !== '.' && ch !== '.' && ch !== 'o') ch = v;
      if (a !== '.') ch = a === '_' ? '.' : a;
      s += ch;
    }
    return s;
  });
}

const LEG_TOP = 12;

/** Compose hero pose into a CW x CH grid. */
function heroPose(rows, anim, frame) {
  const g = blankGrid(CW, CH);
  const ox = PAD_X;
  const oy = PAD_TOP;
  if (anim === 'walk') {
    const f = frame % 4;
    if (f === 0 || f === 2) {
      put(g, rows, ox, oy);
    } else {
      // body up 1, one leg moves with the body (raised), the other stays planted and stretches
      const raisedLeft = f === 1;
      put(g, rows, ox, oy - 1, 0, 0, HERO_W, LEG_TOP);
      const half = HERO_W / 2;
      put(g, rows, ox, oy - 1, raisedLeft ? 0 : half, LEG_TOP, raisedLeft ? half : HERO_W, HERO_H);
      put(g, rows, ox, oy, raisedLeft ? half : 0, LEG_TOP, raisedLeft ? HERO_W : half, HERO_H);
      // bridge: duplicate first leg row of the planted leg one row up
      put(g, rows, ox, oy - 1, raisedLeft ? half : 0, LEG_TOP, raisedLeft ? HERO_W : half, LEG_TOP + 1);
    }
  } else if (anim === 'shoot') {
    // recoil: upper body 1px back on frame 0
    const back = frame % 2 === 0 ? -1 : 0;
    put(g, rows, ox, oy, 0, LEG_TOP, HERO_W, HERO_H);
    put(g, rows, ox + back, oy, 0, 0, HERO_W, LEG_TOP);
  } else {
    // idle: gentle breathing (frame 1 = body up 1, legs stretch)
    if (frame % 2 === 1) {
      put(g, rows, ox, oy - 1, 0, 0, HERO_W, LEG_TOP + 1);
      put(g, rows, ox, oy, 0, LEG_TOP, HERO_W, HERO_H);
    } else put(g, rows, ox, oy);
  }
  return g;
}

const HERO_FPS = { idle: 2, walk: 8, shoot: 12 };
const HERO_FRAMES = { idle: 2, walk: 4, shoot: 2 };

/** Add aura sparkle pixels (form 3) around the silhouette. Marks them with '*' (drawn translucent). */
function addAura(g, phase) {
  const h = g.length;
  const w = g[0].length;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && g[y][x] !== '.' && g[y][x] !== '*' && g[y][x] !== '+';
  const ring = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (g[y][x] !== '.') continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) ring.push([x, y]);
    }
  }
  for (const [x, y] of ring) {
    const v = (x * 3 + y * 5 + phase) % 8;
    if (v === 0) g[y][x] = '*';
    else if (v === 4 && y < h - 5) g[y][x] = '+';
  }
}

const heroCache = new Map();
let skinIds = new WeakMap();
let skinSeq = 0;

function skinKey(skin) {
  if (!skin) return 'd';
  if (typeof skin === 'object') {
    let id = skinIds.get(skin);
    if (!id) {
      id = 's' + ++skinSeq + ':' + skin.join('');
      skinIds.set(skin, id);
    }
    return id;
  }
  return 'd';
}

function heroCanvas(heroId, form, skin, anim, frame, team, fb, auraPhase) {
  const ck = `${heroId}|${form}|${skinKey(skin)}|${anim}|${frame}|${teamKey(team)}|${fb}|${auraPhase}`;
  let c = heroCache.get(ck);
  if (c) return c;
  const base = normSkin(skin) ?? defaultSkin(heroId);
  const rows = withForm(base, heroId, form);
  const g = heroPose(rows, anim, frame);
  if (form >= 3) addAura(g, auraPhase);
  const el = ELEMENT_COLORS[HEROES[heroId]?.element ?? 'fire'];
  const flat = g.map((r) => r.join(''));
  c = rowsToCanvasHero(flat, team, fb / FLASH_STEPS, el);
  if (heroCache.size > 600) heroCache.clear();
  heroCache.set(ck, c);
  return c;
}

function rowsToCanvasHero(rows, team, flash, el) {
  // '*' and '+' are aura pixels (element light / main, translucent)
  const h = rows.length;
  const w = rows[0].length;
  const c = newCanvas(w, h);
  const g = ctx2d(c);
  if (!g) return c;
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      let hex;
      let a = 255;
      if (ch === '*') {
        hex = el.light;
        a = 220;
      } else if (ch === '+') {
        hex = el.main;
        a = 140;
      } else hex = colorOf(ch, team);
      if (!hex) continue;
      const [r, gg, b] = hexToRgb(hex);
      const i = (y * w + x) * 4;
      d[i] = r + (255 - r) * flash;
      d[i + 1] = gg + (255 - gg) * flash;
      d[i + 2] = b + (255 - b) * flash;
      d[i + 3] = a;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Draw a hero (skin + form overlay + held weapon) anchored at the feet.
 * Facing: when a weapon is held the hero faces the aim direction (flipped when aiming left);
 * without a weapon `flip` decides.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{heroId:string, form?:number, skin?:string[]|null, x:number, y:number, anim?:'idle'|'walk'|'shoot',
 *   t?:number, team?:0|1|null, flip?:boolean, flash?:number, weaponId?:string|null, aim?:number, scale?:number, alpha?:number}} o
 */
export function drawHero(ctx, o) {
  if (!ctx) return;
  const heroId = HEROES[o.heroId] ? o.heroId : 'ember';
  const form = Math.max(1, Math.min(3, o.form ?? 1));
  const anim = HERO_FRAMES[o.anim] ? o.anim : 'idle';
  const t = o.t ?? 0;
  const n = HERO_FRAMES[anim];
  const frame = ((Math.floor(t * HERO_FPS[anim]) % n) + n) % n;
  const team = o.team === undefined ? 0 : o.team;
  const scale = o.scale ?? 1;
  const aim = o.aim ?? 0;
  const weapon = o.weaponId && SPRITES[o.weaponId] ? o.weaponId : null;
  const left = weapon ? Math.cos(aim) < 0 : !!o.flip;
  const fb = bucket(o.flash);
  const auraPhase = form >= 3 ? Math.floor(t * 8) % 8 : 0;
  const c = heroCanvas(heroId, form, o.skin ?? null, anim, frame, team, fb, auraPhase);
  const alpha = o.alpha ?? 1;
  const x = o.x;
  const y = o.y;
  // a weapon aimed up/away is held behind the body
  const behind = weapon && Math.sin(aim) < -0.4;
  if (weapon && behind) drawWeapon(ctx, weapon, x, y, aim, left, anim, frame, team, fb, scale, alpha);
  // canvas anchor: skin bottom-centre
  blit(ctx, c, x, y, CW / 2, PAD_TOP + HERO_H, scale, left, alpha);
  if (weapon && !behind) drawWeapon(ctx, weapon, x, y, aim, left, anim, frame, team, fb, scale, alpha);
}

const AIM_STEP = Math.PI / 16;

function drawWeapon(ctx, weapon, x, y, aim, left, anim, frame, team, fb, scale, alpha) {
  // hand position (relative to the feet anchor)
  const bob = (anim === 'walk' && frame % 2 === 1) || (anim === 'idle' && frame === 1) ? -1 : 0;
  const recoil = anim === 'shoot' && frame === 0 ? -1 : 0;
  let hx = HERO_HAND.x - HERO_W / 2 + 0.5 + recoil;
  const hy = HERO_HAND.y - HERO_H + 0.5 + bob;
  if (left) hx = -hx;
  const wdef = SPRITES[weapon];
  const grip = wdef.grip ?? [2, Math.floor(wdef.h / 2)];
  const wc = frameCanvas(weapon, 'idle', 0, team, fb);
  // snap to 32 directions so rotated pixels stay stable while aiming
  const a = Math.round(aim / AIM_STEP) * AIM_STEP;
  ctx.save();
  if (alpha < 1) ctx.globalAlpha *= alpha;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(x) + hx * scale, Math.round(y) + hy * scale);
  ctx.rotate(a);
  if (left) ctx.scale(1, -1);
  const kick = anim === 'shoot' && frame === 0 ? -1.5 : 0;
  ctx.drawImage(wc, (-grip[0] + kick) * scale, -grip[1] * scale, wc.width * scale, wc.height * scale);
  ctx.restore();
}

/** Hero frame count / fps (for UI previews). */
export const HERO_ANIMS = Object.freeze({ fps: HERO_FPS, frames: HERO_FRAMES });

// ---------------------------------------------------------------------------------------------
// Card art
// ---------------------------------------------------------------------------------------------

const SPELL_CARDS = ['volley', 'spark', 'wall', 'meteor', 'quake', 'bless', 'lightning', 'acid', 'blizzard', 'plague', 'blackhole', 'nuke'];
const MULTI_CARDS = {
  archers: ['archer', 2],
  skeletons: ['skeleton', 3],
  gunners: ['gunner', 3],
  bats: ['bat', 3],
  zombies: ['zombie', 3],
  sheep: ['sheep', 3],
  builder: ['builder', 2],
};
const SINGLE_CARDS = [
  'knight', 'bomber', 'giant', 'boarrider', 'minigunner', 'monk', 'icemage', 'flamer', 'sniper', 'dragon', 'necro',
  'crab', 'ufo', 'rocketeer', 'ninja', 'mech', 'bonedragon', 'titan', 'phoenix', 'bricktower', 'tesla', 'crypt', 'mine', 'cannon',
];

/** Card id -> { key, count } (sprite key and number of figures). */
export const CARD_ART_MAP = Object.freeze(
  Object.fromEntries([
    ...SINGLE_CARDS.map((id) => [id, Object.freeze({ key: id, count: 1 })]),
    ...Object.entries(MULTI_CARDS).map(([id, [key, count]]) => [id, Object.freeze({ key, count })]),
    ...SPELL_CARDS.map((id) => [id, Object.freeze({ key: 'spell_' + id, count: 1 })]),
  ]),
);

/**
 * Resolve the art for a card id (also handles unknown ids that equal a sprite key or spell_<id>).
 * @param {string} cardId
 * @returns {{key:string,count:number}|null}
 */
export function cardArtKey(cardId) {
  if (CARD_ART_MAP[cardId]) return CARD_ART_MAP[cardId];
  if (SPRITES[cardId]) return { key: cardId, count: 1 };
  if (SPRITES['spell_' + cardId]) return { key: 'spell_' + cardId, count: 1 };
  return null;
}

const cardCache = new Map();

/** Bounding box [x0, y0, x1, y1] of the non-transparent pixels of a frame. */
function contentBox(rows) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) {
      if (r[x] === '.') continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  });
  return x1 < 0 ? [0, 0, 0, 0] : [x0, y0, x1, y1];
}

/** Frame used for a still portrait of a sprite. */
function portraitAnim(key) {
  const a = SPRITES[key]?.anims ?? {};
  if (key === 'tesla') return 'idle';
  return a.idle ? 'idle' : Object.keys(a)[0];
}

/**
 * 32x32 card art canvas (transparent background, blue team colours).
 * @param {string} cardId
 * @returns {HTMLCanvasElement}
 */
export function cardArt(cardId) {
  let c = cardCache.get(cardId);
  if (c) return c;
  c = newCanvas(32, 32);
  cardCache.set(cardId, c);
  const g = ctx2d(c);
  if (!g) return c;
  const m = cardArtKey(cardId);
  if (!m) {
    drawSprite(g, 'ui_lock', 16, 26, { scale: 2 });
    return c;
  }
  const { key, count } = m;
  const anim = portraitAnim(key);
  const fly = !!SPRITES[key]?.fly;
  if (count <= 1) {
    // fit the visible content (not the padded sprite box), allowing a 1px crop of the outline
    const [bx0, by0, bx1, by1] = contentBox(framesOf(spriteDef(key), anim)[0]);
    const bw = bx1 - bx0 + 1;
    const bh = by1 - by0 + 1;
    const s = bw * 2 <= 36 && bh * 2 <= 36 ? 2 : 1;
    const def = spriteDef(key);
    // centre the content box in the 32x32 card
    const ox = Math.round(16 - ((bx0 + bx1 + 1) / 2) * s);
    const oy = Math.round(16 - ((by0 + by1 + 1) / 2) * s) + (s === 2 ? 0 : 1);
    const src = frameCanvas(key, anim, 0, 0, 0);
    g.drawImage(src, ox, oy, def.w * s, def.h * s);
  } else {
    const spots =
      count === 3
        ? [
            [9, 17],
            [23, 17],
            [16, 31],
          ]
        : [
            [10, 24],
            [22, 31],
          ];
    for (const [x, y] of spots) {
      drawSprite(g, key, x, Math.min(32, y - (fly ? 2 : 0)), { anim, team: 0, flip: x > 16 && count === 3 });
    }
  }
  return c;
}

// ---------------------------------------------------------------------------------------------
// Icons for the HTML UI
// ---------------------------------------------------------------------------------------------

const urlCache = new Map();

/**
 * data: URL for a sprite (any SPRITES key), `card_<cardId>` (card art) or `hero_<heroId>` (portrait).
 * Returns '' when no canvas is available (Node).
 * @param {string} key @param {number} [scale]
 */
export function iconURL(key, scale = 2) {
  const ck = key + '@' + scale;
  const hit = urlCache.get(ck);
  if (hit !== undefined) return hit;
  let src;
  if (key.startsWith('card_')) src = cardArt(key.slice(5));
  else if (key.startsWith('hero_') && HEROES[key.slice(5)]) {
    src = newCanvas(CW, CH);
    const g = ctx2d(src);
    if (g) drawHero(g, { heroId: key.slice(5), x: CW / 2, y: PAD_TOP + HERO_H, team: 0 });
  } else src = getFrame(key, portraitAnim(key), 0, 0);
  const out = newCanvas(src.width * scale, src.height * scale);
  const g = ctx2d(out);
  let url = '';
  if (g) {
    g.drawImage(src, 0, 0, out.width, out.height);
    try {
      url = out.toDataURL ? out.toDataURL('image/png') : '';
    } catch {
      url = '';
    }
  }
  urlCache.set(ck, url);
  return url;
}

/** Drop every cached canvas (e.g. after a big skin-editor session). */
export function clearSpriteCache() {
  frameCache.clear();
  heroCache.clear();
  cardCache.clear();
  urlCache.clear();
  skinIds = new WeakMap();
}

/**
 * Soft elliptical ground shadow under a unit (helper for renderers).
 * @param {CanvasRenderingContext2D} ctx @param {number} x @param {number} y feet @param {number} w width px
 */
export function drawShadow(ctx, x, y, w, alpha = 0.35) {
  if (!ctx) return;
  const hw = Math.max(2, Math.round(w / 2));
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = '#1a1022';
  const yy = Math.round(y) - 1;
  ctx.fillRect(Math.round(x) - hw + 1, yy, hw * 2 - 2, 2);
  ctx.fillRect(Math.round(x) - hw + 2, yy + 2, hw * 2 - 4, 1);
  ctx.fillRect(Math.round(x) - hw + 2, yy - 1, hw * 2 - 4, 1);
  ctx.restore();
}
