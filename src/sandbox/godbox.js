// God Box — the sandbox god-simulation mode. Mount with mountGodBox(rootEl, { audio, storage, onExit }).
import {
  T, SP, TRIBES, SPECIES, TICKS_PER_SEC, TICKS_PER_YEAR, TILE_NAMES, BIOME_NAMES, JOB_NAMES, TRAIT_NAMES,
  LEVEL_NAMES, WEAPON_NAMES, BDEF, BT, SIZES, B, IS_WATER,
} from './constants.js';
import { createWorld, tick, calendar } from './sim.js';
import { applyTool, CONTINUOUS, BRUSH_RADII } from './powers.js';
import { serializeState, deserializeState } from './codec.js';
import { createRenderer } from './render.js';
import { createParticles } from './particles.js';
import { iconCanvas } from './icons.js';
import { iconSprite } from './sprites.js';
import { CSS } from './styles.js';
import { tileCss } from './palette.js';
import { TASK_NAMES, weaponTier } from './creatures.js';
import * as storageModule from '../core/storage.js';

const TABS = [
  {
    id: 'terrain', label: 'TERRAIN',
    tools: [
      ['deep', 'Ocean'], ['shallow', 'Shallows'], ['sand', 'Sand'], ['grass', 'Grass'], ['forest', 'Forest'], ['hills', 'Hills'],
      ['mountain', 'Mountain'], ['snow', 'Snow'], ['lava', 'Lava'], ['raise', 'Raise'], ['lower', 'Lower'],
      ['b_meadow', 'Meadow'], ['b_desert', 'Desert'], ['b_swamp', 'Swamp'], ['b_frost', 'Frost'], ['b_candy', 'Candy'], ['b_void', 'Void'],
    ],
  },
  {
    id: 'life', label: 'LIFE',
    tools: [
      ['brick', 'Brickfolk'], ['ember', 'Emberkin'], ['leaf', 'Leafkin'], ['stone', 'Stoneborn'], ['sheep', 'Sheep'], ['wolf', 'Wolf'],
      ['crab', 'Crab'], ['fish', 'Fish'], ['zombie', 'Zombie'], ['skeleton', 'Skeleton'], ['dragon', 'Dragon'], ['ufo', 'UFO'],
    ],
  },
  {
    id: 'powers', label: 'POWERS',
    tools: [
      ['meteor', 'Meteor'], ['lightning', 'Lightning'], ['fire', 'Fire'], ['rain', 'Rain'], ['quake', 'Quake'], ['plague', 'Plague'],
      ['bless', 'Blessing'], ['bomb', 'Bomb'], ['nuke', 'Atomic'], ['blackhole', 'Black Hole'], ['acid', 'Acid'],
    ],
  },
  { id: 'inspect', label: 'INSPECT', tools: [['inspect', 'Inspect'], ['borders', 'Borders'], ['names', 'Names']] },
];
const TOOL_NAMES = Object.fromEntries(TABS.flatMap((t) => t.tools));
const BIOME_OF = { b_meadow: B.MEADOW, b_desert: B.DESERT, b_swamp: B.SWAMP, b_frost: B.FROST, b_candy: B.CANDY, b_void: B.VOID };
const COOLDOWN = { lightning: 130, rain: 320, plague: 420, quake: 900, meteor: 240, bomb: 220, nuke: 1600, blackhole: 1200 };
const DELAYED = { meteor: 520, bomb: 420, nuke: 900 };
const SPEEDS = [1, 2, 5];
const SLOT_COUNT = 3;
const LOUD = new Set(['melee_hit', 'sword_slash', 'arrow', 'unit_die', 'mine_pick', 'build', 'splash', 'fire_ignite']);
const SEED_A = ['mossy', 'amber', 'sunny', 'stormy', 'misty', 'golden', 'frozen', 'wild', 'ancient', 'quiet', 'brave', 'lucky'];
const SEED_B = ['otter', 'valley', 'brick', 'comet', 'island', 'meadow', 'dragon', 'harbor', 'ember', 'grove', 'summit', 'reef'];

let styleRefs = 0;
let styleEl = null;
function injectStyle() {
  styleRefs++;
  if (styleEl) return;
  styleEl = document.createElement('style');
  styleEl.id = 'godbox-style';
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);
}
function releaseStyle() {
  styleRefs = Math.max(0, styleRefs - 1);
  if (!styleRefs && styleEl) {
    styleEl.remove();
    styleEl = null;
  }
}

/** Tiny DOM helper. */
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid);
  return e;
}
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fmt = (n) => (n >= 10000 ? Math.round(n / 1000) + 'k' : String(Math.round(n)));
const randomSeedText = () => `${SEED_A[(Math.random() * SEED_A.length) | 0]}-${SEED_B[(Math.random() * SEED_B.length) | 0]}-${(Math.random() * 90 + 10) | 0}`;

function iconEl(key, cls = '', o) {
  const cv = iconCanvas(key, o);
  cv.className = 'gb-icon ' + cls;
  return cv;
}
function spriteIcon(sp, tribe = 0, cls = 'sm') {
  const spr = iconSprite(sp, tribe);
  const cv = document.createElement('canvas');
  cv.width = 8;
  cv.height = 8;
  const c = cv.getContext('2d');
  c.drawImage(spr, Math.floor((8 - spr.width) / 2), Math.max(0, 8 - spr.height - 1));
  cv.className = 'gb-icon ' + cls;
  return cv;
}

/**
 * Mount the God Box sandbox inside rootEl.
 * @param {HTMLElement} rootEl
 * @param {{audio?:object, storage?:{load:Function, save:Function}, onExit?:Function}} [opts]
 * @returns {{destroy:()=>void}}
 */
export function mountGodBox(rootEl, { audio, storage, onExit } = {}) {
  const store = storage && typeof storage.load === 'function' && typeof storage.save === 'function' ? storage : storageModule;
  injectStyle();
  const timers = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  };
  const cleanups = [];
  const listen = (target, type, fn, opt) => {
    target.addEventListener(type, fn, opt);
    cleanups.push(() => target.removeEventListener(type, fn, opt));
  };

  // ---- audio -----------------------------------------------------------------------------------
  const lastSfx = new Map();
  let sfxThisFrame = 0;
  function playSfx(name, volume = 1) {
    const now = performance.now();
    const gap = LOUD.has(name) ? 220 : 70;
    if (now - (lastSfx.get(name) || 0) < gap || sfxThisFrame > 4) return;
    lastSfx.set(name, now);
    sfxThisFrame++;
    try {
      audio?.sfx?.(name, { volume: LOUD.has(name) ? 0.45 * volume : volume });
    } catch {
      /* audio is optional */
    }
  }
  try {
    audio?.music?.('godbox');
  } catch {
    /* ignore */
  }
  let unlocked = false;
  function unlockAudio() {
    if (unlocked) return;
    unlocked = true;
    try {
      audio?.unlock?.();
      audio?.music?.('godbox');
    } catch {
      /* ignore */
    }
  }

  // ---- state -------------------------------------------------------------------------------------
  let seedText = randomSeedText();
  let worldSize = 'medium';
  let withTribes = true;
  let state = createWorld({ size: worldSize, seed: seedText, tribes: withTribes });
  let speedIdx = 0;
  let paused = false;
  let acc = 0;
  let tab = 'life';
  let tool = 'inspect';
  let brush = 1;
  let showBorders = true;
  let showNames = true;
  let selected = null;
  let following = false;
  let modalOpen = false;
  let lastUse = 0;
  let shakeAmp = 0;
  let shakeX = 0;
  let shakeY = 0;
  let flash = 0;
  let lastEventId = 0;
  let destroyed = false;
  const reduceMotion = (() => {
    try {
      return matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  })();
  const effects = { projectiles: [], rings: [], mushrooms: [], bolts: [], arrows: [] };
  const particles = createParticles(2600);
  const cam = { x: 0, y: 0, z: 2 };
  let zMin = 0.5;
  const zMax = 40;

  // ---- DOM -----------------------------------------------------------------------------------------
  const root = h('div', { class: 'gb', role: 'application', 'aria-label': 'God Box sandbox' });
  const canvas = h('canvas', { class: 'gb-world', 'aria-label': 'World map' });
  root.append(canvas);

  const yearEl = h('div', { class: 'gb-year', text: 'YEAR 1' });
  const aliveEl = h('div', { class: 'gb-alive', text: '' });
  const speedBtns = [];
  const pauseBtn = h('button', { class: 'gb-btn', 'aria-label': 'Pause', onclick: () => setPaused(!paused) }, iconEl('pause', 'md'));
  const speedWrap = h('div', { class: 'gb-speed' }, pauseBtn);
  SPEEDS.forEach((sp, i) => {
    const b = h('button', { class: 'gb-btn', 'aria-label': `Speed ${sp}x`, text: `${sp}x`, onclick: () => setSpeed(i) });
    speedBtns.push(b);
    speedWrap.append(b);
  });
  const menuBtn = h('button', { class: 'gb-btn', 'aria-label': 'Menu', onclick: () => openMenu() }, iconEl('menu', 'md'));
  const popEls = [];
  const popRow = h('div', { class: 'gb-pops' });
  for (let t = 0; t < 4; t++) {
    const num = h('span', { text: '0' });
    popEls.push(num);
    popRow.append(h('span', { class: 'gb-pop', title: TRIBES[t].name, style: `color:${TRIBES[t].light}` }, spriteIcon(SP.VILLAGER, t), num));
  }
  const animalNum = h('span', { text: '0' });
  const monsterNum = h('span', { text: '0' });
  popRow.append(h('span', { class: 'gb-pop', title: 'Animals' }, spriteIcon(SP.SHEEP), animalNum));
  popRow.append(h('span', { class: 'gb-pop', title: 'Monsters', style: 'color:#9fe35f' }, spriteIcon(SP.ZOMBIE), monsterNum));
  const topBar = h('div', { class: 'gb-top' },
    h('div', { class: 'gb-row' }, menuBtn, h('div', { class: 'gb-date' }, yearEl, aliveEl), speedWrap),
    popRow);
  root.append(topBar);

  const tickerText = h('span', { text: 'Welcome, god. Pick a tool below and tap the world.' });
  const tickerDot = h('i', { class: 'gb-dot' });
  const tickerPill = h('div', { class: 'gb-ticker-pill' }, tickerDot, tickerText);
  const ticker = h('button', { class: 'gb-ticker', 'aria-label': 'World events', onclick: () => toggleLog() }, tickerPill);
  root.append(ticker);

  const brushBtn = h('button', { class: 'gb-btn gb-brush', 'aria-label': 'Brush size', onclick: () => cycleBrush() });
  const toolsRow = h('div', { class: 'gb-tools', role: 'toolbar' });
  const tabBtns = {};
  const tabsRow = h('div', { class: 'gb-tabs', role: 'tablist' });
  for (const t of TABS) {
    const b = h('button', { class: 'gb-btn gb-tab', role: 'tab', text: t.label, onclick: () => setTab(t.id) });
    tabBtns[t.id] = b;
    tabsRow.append(b);
  }
  const bottomBar = h('div', { class: 'gb-bottom' }, h('div', { class: 'gb-tools-wrap' }, brushBtn, toolsRow), tabsRow);
  root.append(bottomBar);

  const info = h('div', { class: 'gb-panel gb-info gb-hidden', role: 'dialog', 'aria-label': 'Inspector' });
  const logPanel = h('div', { class: 'gb-panel gb-log gb-hidden', role: 'dialog', 'aria-label': 'Event log' });
  const toastEl = h('div', { class: 'gb-toast', role: 'status', 'aria-live': 'polite' });
  const modal = h('div', { class: 'gb-modal gb-hidden' });
  root.append(info, logPanel, toastEl, modal);
  rootEl.append(root);

  // ---- toolbar -----------------------------------------------------------------------------------
  const toolBtns = {};
  function renderTools() {
    toolsRow.textContent = '';
    for (const k in toolBtns) delete toolBtns[k];
    const def = TABS.find((t) => t.id === tab);
    for (const [id, label] of def.tools) {
      const b = h('button', { class: 'gb-btn gb-tool', 'aria-label': label, onclick: () => pickTool(id) },
        iconEl(id, '', { biome: BIOME_OF[id] }), h('span', { text: label }));
      toolBtns[id] = b;
      toolsRow.append(b);
    }
    refreshToolStates();
    toolsRow.scrollLeft = 0;
  }
  function refreshToolStates() {
    for (const [id, b] of Object.entries(toolBtns)) {
      let on = id === tool;
      if (id === 'borders') on = showBorders;
      if (id === 'names') on = showNames;
      b.classList.toggle('on', on);
      if (id === 'borders' || id === 'names') {
        b.classList.add('toggle');
        b.classList.toggle('toggle-off', !on);
      }
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    for (const [id, b] of Object.entries(tabBtns)) {
      b.classList.toggle('on', id === tab);
      b.setAttribute('aria-selected', id === tab ? 'true' : 'false');
    }
    brushBtn.innerHTML = `${['S', 'M', 'L'][brush]}<small>brush</small>`;
  }
  function setTab(id) {
    if (tab === id) return;
    tab = id;
    playSfx('ui_click');
    renderTools();
  }
  function pickTool(id) {
    playSfx('ui_click');
    if (id === 'borders') {
      showBorders = !showBorders;
      toast(showBorders ? 'Kingdom borders shown' : 'Kingdom borders hidden');
    } else if (id === 'names') {
      showNames = !showNames;
      toast(showNames ? 'Village names shown' : 'Village names hidden');
    } else if (tool === id && id !== 'inspect') {
      tool = 'inspect';
      toast('Inspect / move');
    } else {
      tool = id;
      toast(id === 'inspect' ? 'Tap anything to inspect it. Drag to move.' : `${TOOL_NAMES[id]}: tap or drag on the world`);
    }
    refreshToolStates();
  }
  function cycleBrush() {
    brush = (brush + 1) % 3;
    playSfx('ui_click');
    refreshToolStates();
  }

  // ---- time --------------------------------------------------------------------------------------
  function setSpeed(i) {
    speedIdx = i;
    paused = false;
    playSfx('ui_click');
    refreshTime();
  }
  function setPaused(p) {
    paused = p;
    playSfx('ui_click');
    refreshTime();
  }
  function refreshTime() {
    pauseBtn.classList.toggle('on', paused);
    pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
    speedBtns.forEach((b, i) => {
      b.classList.toggle('on', !paused && i === speedIdx);
      b.setAttribute('aria-pressed', !paused && i === speedIdx ? 'true' : 'false');
    });
  }

  // ---- toast -----------------------------------------------------------------------------------------
  let toastTimer = 0;
  function toast(msg, ms = 1800) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    timers.delete(toastTimer);
    toastTimer = later(() => toastEl.classList.remove('show'), ms);
  }

  // ---- camera ----------------------------------------------------------------------------------------
  const viewW = () => canvas.clientWidth || root.clientWidth || 1;
  const viewH = () => canvas.clientHeight || root.clientHeight || 1;
  function fitCamera() {
    const w = viewW();
    const hh = viewH();
    const top = topBar.offsetHeight;
    const bottom = bottomBar.offsetHeight;
    const availH = Math.max(100, hh - top - bottom);
    const z = Math.min(w / state.w, availH / state.h);
    cam.z = z;
    zMin = z * 0.6;
    cam.x = state.w / 2 - w / 2 / z;
    cam.y = state.h / 2 - (top + availH / 2) / z;
  }
  function clampCam() {
    // Centre the world on an axis where it fits; otherwise allow a little overscroll past the bars.
    const vw = viewW() / cam.z;
    const vh = viewH() / cam.z;
    const top = topBar.offsetHeight / cam.z;
    const bottom = bottomBar.offsetHeight / cam.z;
    const usableH = vh - top - bottom;
    if (state.w <= vw) cam.x = (state.w - vw) / 2;
    else cam.x = clamp(cam.x, -vw * 0.25, state.w - vw * 0.75);
    if (state.h <= usableH) cam.y = state.h / 2 - (top + usableH / 2);
    else cam.y = clamp(cam.y, -top - vh * 0.2, state.h - vh + bottom + vh * 0.2);
  }
  function zoomAt(sx, sy, factor) {
    const wx = cam.x + sx / cam.z;
    const wy = cam.y + sy / cam.z;
    cam.z = clamp(cam.z * factor, zMin, zMax);
    cam.x = wx - sx / cam.z;
    cam.y = wy - sy / cam.z;
    clampCam();
  }
  function centerOn(x, y, zoomTo) {
    if (zoomTo) cam.z = clamp(Math.max(cam.z, zoomTo), zMin, zMax);
    const top = topBar.offsetHeight;
    const bottom = bottomBar.offsetHeight;
    cam.x = x - viewW() / 2 / cam.z;
    cam.y = y - (top + (viewH() - top - bottom) / 2) / cam.z;
    clampCam();
  }
  const toWorld = (sx, sy) => ({ x: cam.x + sx / cam.z, y: cam.y + sy / cam.z });

  // ---- input ---------------------------------------------------------------------------------------
  const pointers = new Map();
  let mode = '';
  let pinch = null;
  let stroke = null;
  let hover = null;
  let downInfo = null;

  function localPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function startPinch() {
    const [a, b] = [...pointers.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: cam.z, w0: toWorld(mid.x, mid.y) };
  }
  function onDown(e) {
    unlockAudio();
    if (modalOpen) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const p = localPos(e);
    pointers.set(e.pointerId, p);
    closeLog();
    if (pointers.size >= 2) {
      mode = 'pinch';
      stroke = null;
      startPinch();
      return;
    }
    downInfo = { x: p.x, y: p.y, t: performance.now(), moved: false };
    const wantsPan = e.button === 1 || e.button === 2 || tool === 'inspect' || e.shiftKey;
    if (wantsPan) {
      mode = 'pan';
      return;
    }
    mode = 'paint';
    const w = toWorld(p.x, p.y);
    stroke = { x: w.x, y: w.y };
    hover = w;
    useTool(w.x, w.y, true);
  }
  function onMove(e) {
    const p = localPos(e);
    if (e.pointerType === 'mouse' && !pointers.size) {
      hover = tool !== 'inspect' ? toWorld(p.x, p.y) : null;
      return;
    }
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    pointers.set(e.pointerId, p);
    if (downInfo && Math.hypot(p.x - downInfo.x, p.y - downInfo.y) > 8) downInfo.moved = true;
    if (mode === 'pinch' && pointers.size >= 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      cam.z = clamp((pinch.z0 * d) / pinch.d0, zMin, zMax);
      cam.x = pinch.w0.x - mid.x / cam.z;
      cam.y = pinch.w0.y - mid.y / cam.z;
      clampCam();
      following = false;
    } else if (mode === 'pan') {
      cam.x -= (p.x - prev.x) / cam.z;
      cam.y -= (p.y - prev.y) / cam.z;
      clampCam();
      if (downInfo?.moved) following = false;
    } else if (mode === 'paint' && stroke) {
      const w = toWorld(p.x, p.y);
      hover = w;
      if (CONTINUOUS.has(tool)) {
        const step = Math.max(0.7, BRUSH_RADII[brush] * 0.6);
        const dx = w.x - stroke.x;
        const dy = w.y - stroke.y;
        const dist = Math.hypot(dx, dy);
        const n = Math.min(10, Math.floor(dist / step));
        for (let k = 1; k <= n; k++) useTool(stroke.x + (dx * k) / n, stroke.y + (dy * k) / n, false);
        if (n) {
          stroke.x = w.x;
          stroke.y = w.y;
        }
      } else useTool(w.x, w.y, false);
    }
  }
  function onUp(e) {
    const had = pointers.delete(e.pointerId);
    if (!had) return;
    if (mode === 'pan' && downInfo && !downInfo.moved && performance.now() - downInfo.t < 450 && tool === 'inspect') {
      const p = localPos(e);
      const w = toWorld(p.x, p.y);
      inspectAt(w.x, w.y);
    }
    if (pointers.size === 0) {
      mode = '';
      stroke = null;
      pinch = null;
      downInfo = null;
      if (e.pointerType !== 'mouse') hover = null;
    } else if (pointers.size === 1) {
      mode = 'pan';
      pinch = null;
      if (downInfo) downInfo.moved = true;
    }
  }
  function onWheel(e) {
    e.preventDefault();
    const p = localPos(e);
    zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0016));
    following = false;
  }
  function onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (modalOpen) {
      if (e.key === 'Escape') closeModal();
      return;
    }
    const pan = 40 / cam.z;
    switch (e.key) {
      case ' ':
        setPaused(!paused);
        break;
      case '1':
      case '2':
      case '3':
        setSpeed(Number(e.key) - 1);
        break;
      case 'ArrowLeft':
      case 'a':
        cam.x -= pan;
        break;
      case 'ArrowRight':
      case 'd':
        cam.x += pan;
        break;
      case 'ArrowUp':
      case 'w':
        cam.y -= pan;
        break;
      case 'ArrowDown':
      case 's':
        cam.y += pan;
        break;
      case '+':
      case '=':
        zoomAt(viewW() / 2, viewH() / 2, 1.25);
        break;
      case '-':
        zoomAt(viewW() / 2, viewH() / 2, 0.8);
        break;
      case 'Escape':
        closeInfo();
        closeLog();
        break;
      default:
        return;
    }
    clampCam();
    e.preventDefault();
  }
  listen(canvas, 'pointerdown', onDown);
  listen(canvas, 'pointermove', onMove);
  listen(canvas, 'pointerup', onUp);
  listen(canvas, 'pointercancel', onUp);
  listen(canvas, 'pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !pointers.size) hover = null;
  });
  listen(canvas, 'wheel', onWheel, { passive: false });
  listen(canvas, 'contextmenu', (e) => e.preventDefault());
  listen(root, 'gesturestart', (e) => e.preventDefault(), { passive: false });
  listen(root, 'pointerdown', unlockAudio);
  listen(window, 'keydown', onKey);

  // ---- tools ---------------------------------------------------------------------------------------
  function useTool(x, y, first) {
    if (tool === 'inspect' || !state) return;
    const now = performance.now();
    if (!CONTINUOUS.has(tool)) {
      const cd = COOLDOWN[tool] ?? 150;
      if (!first && now - lastUse < cd) return;
      if (first && now - lastUse < 60) return;
    }
    lastUse = now;
    if (DELAYED[tool]) {
      if (x < 0 || y < 0 || x >= state.w || y >= state.h) return;
      effects.projectiles.push({ kind: tool, x, y, t0: now, dur: DELAYED[tool], size: brush });
      playSfx(tool === 'meteor' ? 'meteor' : 'ui_click');
      return;
    }
    const res = applyTool(state, tool, x, y, brush);
    if (!res.ok && res.msg && first) toast(res.msg);
  }

  // ---- inspector ------------------------------------------------------------------------------------
  function inspectAt(x, y) {
    let best = null;
    let bd = Math.max(1.6, 16 / cam.z) ** 2;
    for (const c of state.creatures) {
      if (c.dead) continue;
      const cx = c._rx ?? c.x;
      let cy = (c._ry ?? c.y) - 1.5;
      if (c.fly) cy -= 6;
      const d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    if (best) return select({ type: 'creature', id: best.id });
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= state.w || ty >= state.h) return closeInfo();
    const i = ty * state.w + tx;
    const bid = state.bmap[i];
    const b = bid ? state.buildings.get(bid) : null;
    if (b && state.villages.has(b.vil)) return select({ type: 'village', id: b.vil });
    const vid = state.zone[i];
    if (vid && state.villages.has(vid)) return select({ type: 'village', id: vid });
    select({ type: 'tile', x: tx, y: ty });
  }
  function select(sel) {
    selected = sel;
    following = false;
    playSfx('ui_click');
    renderInfo();
  }
  const infoParts = { key: null };
  function closeInfo() {
    infoParts.key = null;
    selected = null;
    following = false;
    info.classList.add('gb-hidden');
    ticker.classList.remove('gb-hidden');
  }
  const kname = (id) => state.kingdoms.get(id)?.name || '';
  const sw = (col) => `<span class="gb-sw" style="background:${esc(col)}"></span>`;
  function infoButton(label, fn, cls = '') {
    return h('button', { class: `gb-btn ${cls}`, onclick: fn, text: label });
  }
  function renderInfo() {
    if (!selected) return;
    let head = '';
    let body = '';
    const actions = [];
    let icon = null;
    const sel = selected;
    if (sel.type === 'creature') {
      const c = state.byId.get(sel.id);
      if (!c) {
        head = '<div class="gb-info-title">Gone</div><div class="gb-info-sub">This creature is no longer with us.</div>';
      } else {
        const def = SPECIES[c.sp];
        const v = c.vil ? state.villages.get(c.vil) : null;
        const kd = c.kd ? state.kingdoms.get(c.kd) : null;
        const age = Math.floor((state.tick - c.born) / TICKS_PER_YEAR);
        const title = c.sp === SP.VILLAGER ? c.name : c.name ? `${c.name} the ${def.name}` : def.name;
        let sub = def.name;
        if (c.sp === SP.VILLAGER) {
          sub = `${TRIBES[c.tribe].name} · ${v ? v.name : 'Nomad'}`;
          if (kd) sub += `<br>${sw(kd.color)}${esc(kd.name)}`;
        }
        head = `<div class="gb-info-title">${esc(title)}</div><div class="gb-info-sub">${c.sp === SP.VILLAGER ? sub : esc(sub)}</div>`;
        const hpPct = clamp((c.hp / c.mhp) * 100, 0, 100);
        const rows = [
          `<div><b>Age</b>${age} yrs</div>`,
          `<div><b>Kills</b>${c.kills}</div>`,
          `<div class="wide"><b>HP</b>${Math.ceil(c.hp)} / ${Math.round(c.mhp)}<div class="gb-hp"><i style="width:${hpPct}%;background:${hpPct < 35 ? 'var(--bad,#ff5a5a)' : 'var(--good,#5fd35f)'}"></i></div></div>`,
        ];
        if (c.sp === SP.VILLAGER) {
          rows.push(`<div><b>Job</b>${c.child ? 'Child' : JOB_NAMES[c.job]}</div>`);
          rows.push(`<div><b>Weapon</b>${c.child ? 'None' : WEAPON_NAMES[weaponTier(state, c)]}</div>`);
          rows.push(`<div><b>Attack</b>${Math.round(c.atk * 10) / 10}</div>`);
          rows.push(`<div><b>Doing</b>${TASK_NAMES[c.task] || ''}</div>`);
        } else {
          rows.push(`<div><b>Attack</b>${Math.round(c.atk * 10) / 10}</div>`);
          rows.push(`<div><b>Doing</b>${TASK_NAMES[c.task] || ''}</div>`);
          if (c.sp === SP.WOLF) rows.push(`<div><b>Hunger</b>${Math.min(100, Math.round(c.hunger / 5))}%</div>`);
        }
        body = `<div class="gb-stats">${rows.join('')}</div>`;
        const tags = [];
        for (const [bit, name] of TRAIT_NAMES) if (c.tr & bit) tags.push(`<span class="gb-tag ${name === 'Cursed' ? 'bad' : 'good'}">${name}</span>`);
        if (kd && kd.king === c.id) tags.unshift('<span class="gb-tag gold">Ruler</span>');
        if (c.kills >= 10) tags.push('<span class="gb-tag gold">Hero</span>');
        if (c.sick) tags.push('<span class="gb-tag bad">Plague</span>');
        if (c.inf) tags.push('<span class="gb-tag bad">Infected</span>');
        if (c.burn > 0) tags.push('<span class="gb-tag bad">Burning</span>');
        if (c.bless > 0) tags.push('<span class="gb-tag gold">Blessed</span>');
        if (c.held) tags.push('<span class="gb-tag bad">Being abducted</span>');
        if (tags.length) body += `<div class="gb-tags">${tags.join('')}</div>`;
        icon = spriteIcon(c.sp, Math.max(0, c.tribe), 'md');
        actions.push(infoButton(following ? 'Following' : 'Follow', () => {
          following = !following;
          playSfx('ui_click');
          renderInfo();
        }, following ? 'on' : ''));
        if (v) actions.push(infoButton('Village', () => select({ type: 'village', id: v.id })));
        if (kd) actions.push(infoButton('Kingdom', () => select({ type: 'kingdom', id: kd.id })));
      }
    } else if (sel.type === 'village') {
      const v = state.villages.get(sel.id);
      if (!v) head = '<div class="gb-info-title">Ruins</div><div class="gb-info-sub">Nothing remains of this village.</div>';
      else {
        const kd = state.kingdoms.get(v.kd);
        head = `<div class="gb-info-title">${esc(v.name)}</div><div class="gb-info-sub">${LEVEL_NAMES[v.level]} of the ${TRIBES[v.tribe].name}<br>${kd ? sw(kd.color) + esc(kd.name) : ''}</div>`;
        const counts = {};
        for (const id of v.blds) {
          const b = state.buildings.get(id);
          if (b && b.type !== BT.HALL) counts[BDEF[b.type].name] = (counts[BDEF[b.type].name] || 0) + 1;
        }
        const bl = Object.entries(counts).map(([n, k]) => `${k} ${n}${k > 1 ? 's' : ''}`).join(', ') || 'Just a camp';
        const wars = kd ? kd.wars.map(kname).filter(Boolean) : [];
        body = `<div class="gb-stats">
          <div><b>People</b>${v.pop} / ${v.housing}</div><div><b>Children</b>${v.kids}</div>
          <div><b>Wood</b>${fmt(v.res.wood)}</div><div><b>Stone</b>${fmt(v.res.stone)}</div>
          <div><b>Food</b>${fmt(v.res.food)}</div><div><b>Ore</b>${fmt(v.res.ore)}</div>
          <div><b>Founded</b>Year ${calendar(v.born).year}</div><div><b>Weapons</b>${WEAPON_NAMES[v.level - 1]}</div>
          <div class="wide"><b>Buildings</b>${esc(bl)}</div>
          ${wars.length ? `<div class="wide"><b>At war with</b>${esc(wars.join(', '))}</div>` : ''}
          ${v.capture > 0 ? `<div class="wide"><b>Under siege</b>${Math.round((v.capture / 60) * 100)}% captured</div>` : ''}
        </div>`;
        icon = iconEl('brick', 'md');
        actions.push(infoButton('Go there', () => centerOn(v.x, v.y, 4)));
        if (kd) actions.push(infoButton('Kingdom', () => select({ type: 'kingdom', id: kd.id })));
      }
    } else if (sel.type === 'kingdom') {
      const kd = state.kingdoms.get(sel.id);
      if (!kd) head = '<div class="gb-info-title">Fallen</div><div class="gb-info-sub">This kingdom is no more.</div>';
      else {
        const vills = [...state.villages.values()].filter((v) => v.kd === kd.id);
        const pop = vills.reduce((n, v) => n + v.pop, 0);
        const king = state.byId.get(kd.king);
        const cap = state.villages.get(kd.capital);
        head = `<div class="gb-info-title">${sw(kd.color)}${esc(kd.name)}</div><div class="gb-info-sub">${TRIBES[kd.tribe].name} · founded year ${calendar(kd.born).year}</div>`;
        const wars = kd.wars.map(kname).filter(Boolean);
        const allies = kd.allies.map(kname).filter(Boolean);
        const rel = Object.entries(kd.op)
          .filter(([id]) => state.kingdoms.has(Number(id)))
          .sort((a, b) => a[1] - b[1])
          .slice(0, 3)
          .map(([id, op]) => `${esc(kname(Number(id)))} (${op > 20 ? 'friendly' : op < -20 ? 'hostile' : 'wary'})`);
        body = `<div class="gb-stats">
          <div><b>Villages</b>${vills.length}</div><div><b>People</b>${pop}</div>
          <div class="wide"><b>Ruler</b>${king && !king.dead ? esc(king.name) : 'None'}</div>
          <div class="wide"><b>Capital</b>${cap ? esc(cap.name) : '-'}</div>
          <div class="wide"><b>Wars</b>${wars.length ? esc(wars.join(', ')) : 'At peace'}</div>
          <div class="wide"><b>Allies</b>${allies.length ? esc(allies.join(', ')) : 'None'}</div>
          ${rel.length ? `<div class="wide"><b>Relations</b>${rel.join(', ')}</div>` : ''}
        </div>`;
        icon = iconEl('borders', 'md');
        if (cap) actions.push(infoButton('Capital', () => select({ type: 'village', id: cap.id })));
        if (king && !king.dead) actions.push(infoButton('Ruler', () => select({ type: 'creature', id: king.id })));
      }
    } else if (sel.type === 'tile') {
      const i = sel.y * state.w + sel.x;
      const t = state.tile[i];
      const bio = state.biome[i];
      head = `<div class="gb-info-title"><span class="gb-sw" style="background:${tileCss(t, bio)}"></span>${TILE_NAMES[t]}</div><div class="gb-info-sub">${BIOME_NAMES[bio]} biome${IS_WATER[t] ? '' : ` · height ${state.height[i]}`}</div>`;
      const extra = [];
      if (state.fire[i]) extra.push('<span class="gb-tag bad">On fire</span>');
      if (t === T.FARM) extra.push(`<span class="gb-tag good">Crops ${['sown', 'sprouting', 'growing', 'ripe'][state.aux[i]] || ''}</span>`);
      if (t === T.ORE) extra.push('<span class="gb-tag gold">Ore</span>');
      body = extra.length ? `<div class="gb-tags">${extra.join('')}</div>` : '';
    }
    // Update in place so buttons survive the periodic refresh (taps are never lost mid-render).
    const selKey = `${sel.type}:${sel.id ?? sel.x + ',' + sel.y}`;
    const actKey = actions.map((b) => b.textContent + b.className).join('|');
    if (infoParts.key !== selKey) {
      info.textContent = '';
      const headEl = h('div', { class: 'gb-info-head' });
      infoParts.icon = h('span', { style: 'display:contents' });
      infoParts.txt = h('div', { style: 'flex:1;min-width:0' });
      headEl.append(infoParts.icon, infoParts.txt, h('button', { class: 'gb-btn ghost', 'aria-label': 'Close', onclick: () => closeInfo() }, iconEl('close', 'md')));
      infoParts.body = h('div');
      infoParts.actions = h('div', { class: 'gb-actions' });
      info.append(headEl, infoParts.body, infoParts.actions);
      infoParts.key = selKey;
      infoParts.head = infoParts.bodyHtml = infoParts.actKey = null;
      if (icon) infoParts.icon.append(icon);
    }
    if (infoParts.head !== head) infoParts.txt.innerHTML = infoParts.head = head;
    if (infoParts.bodyHtml !== body) infoParts.body.innerHTML = infoParts.bodyHtml = body;
    if (infoParts.actKey !== actKey) {
      infoParts.actKey = actKey;
      infoParts.actions.textContent = '';
      infoParts.actions.append(...actions);
      infoParts.actions.classList.toggle('gb-hidden', !actions.length);
    }
    info.classList.remove('gb-hidden');
    ticker.classList.add('gb-hidden');
  }

  // ---- event log --------------------------------------------------------------------------------------
  function toggleLog() {
    playSfx('ui_click');
    if (!logPanel.classList.contains('gb-hidden')) return closeLog();
    renderLog();
    logPanel.classList.remove('gb-hidden');
  }
  function closeLog() {
    logPanel.classList.add('gb-hidden');
  }
  function renderLog() {
    logPanel.textContent = '';
    logPanel.append(h('div', { class: 'gb-log-head' }, h('span', { text: 'WORLD CHRONICLE' }),
      h('button', { class: 'gb-btn ghost', 'aria-label': 'Close', onclick: () => closeLog() }, iconEl('close', 'md'))));
    const evs = state.events.slice().reverse();
    if (!evs.length) logPanel.append(h('div', { class: 'gb-empty', text: 'Nothing has happened yet. Spawn a tribe!' }));
    for (const ev of evs) {
      const dot = h('i', { class: 'gb-dot', style: ev.color ? `background:${ev.color}` : '' });
      const b = h('button', {
        class: 'gb-btn gb-log-item',
        onclick: () => {
          if (ev.x !== undefined) centerOn(ev.x, ev.y, 4);
          closeLog();
        },
      }, dot, h('em', { text: `Y${calendar(ev.t).year}` }), h('span', { text: ev.text }));
      logPanel.append(b);
    }
  }

  // ---- menu, save/load -----------------------------------------------------------------------------
  const slotKey = (n) => `godbox:slot${n}`;
  function readSlot(n) {
    try {
      const d = store.load(slotKey(n), null);
      return d && d.format === 'godbox' ? d : null;
    } catch {
      return null;
    }
  }
  function openModal(content) {
    modal.textContent = '';
    modal.append(h('div', { class: 'gb-dialog', role: 'dialog', 'aria-modal': 'true' }, content));
    modal.classList.remove('gb-hidden');
    modalOpen = true;
    pointers.clear();
    mode = '';
  }
  function closeModal() {
    modal.classList.add('gb-hidden');
    modal.textContent = '';
    modalOpen = false;
  }
  function confirmBox(text, yesLabel, onYes, danger = false) {
    openModal([
      h('h2', { text: 'Are you sure?' }),
      h('p', { text }),
      h('div', { class: 'gb-row2' },
        h('button', { class: 'gb-btn', text: 'Cancel', onclick: () => openMenu() }),
        h('button', {
          class: `gb-btn ${danger ? 'danger' : 'gold'}`,
          text: yesLabel,
          onclick: () => {
            playSfx('ui_click');
            onYes();
          },
        })),
    ]);
  }
  function openMenu() {
    unlockAudio();
    playSfx('ui_click');
    closeLog();
    const sizeBtns = {};
    const sizes = h('div', { class: 'gb-chips' });
    for (const [key, def] of Object.entries(SIZES)) {
      const b = h('button', {
        class: `gb-btn ${key === worldSize ? 'on' : ''}`,
        text: def.label,
        onclick: () => {
          worldSize = key;
          for (const [k2, b2] of Object.entries(sizeBtns)) b2.classList.toggle('on', k2 === key);
          playSfx('ui_click');
        },
      });
      sizeBtns[key] = b;
      sizes.append(b);
    }
    const seedInput = h('input', { class: 'gb-input', type: 'text', value: seedText, 'aria-label': 'World seed', maxlength: '32', autocomplete: 'off', spellcheck: 'false' });
    const dice = h('button', {
      class: 'gb-btn', 'aria-label': 'Random seed',
      onclick: () => {
        seedInput.value = randomSeedText();
        playSfx('ui_click');
      },
    }, iconEl('dice', 'md'));
    const tribesBtn = h('button', {
      class: `gb-btn ${withTribes ? 'on' : ''}`,
      text: withTribes ? 'Start with 4 tribes: ON' : 'Start with 4 tribes: OFF',
      onclick: () => {
        withTribes = !withTribes;
        tribesBtn.classList.toggle('on', withTribes);
        tribesBtn.textContent = withTribes ? 'Start with 4 tribes: ON' : 'Start with 4 tribes: OFF';
        playSfx('ui_click');
      },
    });
    const create = h('button', {
      class: 'gb-btn gold',
      text: 'Create World',
      onclick: () => {
        const seed = seedInput.value.trim() || randomSeedText();
        confirmBox('The current world will be replaced by a new one.', 'Create', () => newWorld(seed));
      },
    });
    const slots = h('div', { class: 'gb-stack' });
    for (let n = 1; n <= SLOT_COUNT; n++) {
      const d = readSlot(n);
      const sum = d?.summary;
      const when = d?.savedAt ? new Date(d.savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      const infoEl = h('div', { class: 'gb-slot-info' }, h('b', { text: `SLOT ${n}` }),
        d ? `Year ${sum?.year ?? '?'} · ${sum?.pop ?? 0} people · ${SIZES[sum?.sizeKey]?.label || ''}${when ? ' · ' + when : ''}` : 'Empty');
      const saveB = h('button', {
        class: 'gb-btn primary', text: 'Save',
        onclick: () => (d ? confirmBox(`Overwrite slot ${n}?`, 'Overwrite', () => saveSlot(n)) : saveSlot(n)),
      });
      const loadB = h('button', {
        class: 'gb-btn', text: 'Load', disabled: !d,
        onclick: () => confirmBox(`Load slot ${n}? The current world will be replaced.`, 'Load', () => loadSlot(n)),
      });
      slots.append(h('div', { class: 'gb-slot' }, infoEl, saveB, loadB));
    }
    openModal([
      h('h2', { text: 'GOD BOX' }),
      h('h3', { text: 'NEW WORLD' }),
      sizes,
      h('div', { class: 'gb-field' }, seedInput, dice),
      h('div', { class: 'gb-stack', style: 'margin-top:8px' }, tribesBtn, create),
      h('h3', { text: 'SAVE / LOAD' }),
      slots,
      h('div', { class: 'gb-row2' },
        h('button', { class: 'gb-btn', text: 'Resume', onclick: () => closeModal() }),
        h('button', {
          class: 'gb-btn danger', text: 'Exit',
          onclick: () => confirmBox('Leave the God Box? Unsaved changes to this world will be lost.', 'Exit', () => {
            closeModal();
            try {
              onExit?.();
            } catch (err) {
              console.error(err);
            }
          }, true),
        })),
    ]);
  }
  function showLoading(text) {
    const el = h('div', { class: 'gb-loading', text });
    root.append(el);
    return el;
  }
  function adoptState(s, msg) {
    state = s;
    renderer.setState(state);
    particles.clear();
    for (const k in effects) effects[k].length = 0;
    selected = null;
    following = false;
    info.classList.add('gb-hidden');
    ticker.classList.remove('gb-hidden');
    lastEventId = state.events.length ? state.events[state.events.length - 1].id : 0;
    acc = 0;
    fitCamera();
    refreshHud(true);
    if (msg) toast(msg);
  }
  function newWorld(seed) {
    closeModal();
    seedText = seed;
    const loading = showLoading('GENERATING WORLD...');
    later(() => {
      try {
        adoptState(createWorld({ size: worldSize, seed, tribes: withTribes }), `New world "${seed}"`);
        tickerText.textContent = withTribes ? 'Four tribes have arrived in a new world.' : 'A fresh, empty world awaits.';
        playSfx('magic');
      } catch (err) {
        console.error(err);
        toast('Could not create the world');
      }
      loading.remove();
    }, 40);
  }
  function saveSlot(n) {
    try {
      const data = serializeState(state);
      data.seedText = seedText;
      const ok = store.save(slotKey(n), data);
      toast(ok === false ? `Saved to slot ${n} (this session only)` : `Saved to slot ${n}`);
      playSfx('coin');
    } catch (err) {
      console.error(err);
      toast('Save failed');
      playSfx('ui_error');
    }
    openMenu();
  }
  function loadSlot(n) {
    const d = readSlot(n);
    if (!d) {
      toast('That slot is empty');
      return openMenu();
    }
    closeModal();
    const loading = showLoading('LOADING...');
    later(() => {
      try {
        const s = deserializeState(d);
        seedText = d.seedText || String(s.seed);
        worldSize = s.sizeKey;
        adoptState(s, `Loaded slot ${n}`);
        playSfx('magic');
      } catch (err) {
        console.error(err);
        toast('That save could not be read');
        playSfx('ui_error');
      }
      loading.remove();
    }, 40);
  }

  // ---- HUD refresh -----------------------------------------------------------------------------------
  let hudAt = 0;
  function refreshHud(force = false) {
    const cal = calendar(state.tick);
    yearEl.textContent = `YEAR ${cal.year}`;
    const c = state.counts;
    let animals = 0;
    let monsters = 0;
    for (let sp = SP.SHEEP; sp <= SP.FISH; sp++) animals += c.sp[sp];
    for (let sp = SP.ZOMBIE; sp <= SP.UFO; sp++) monsters += c.sp[sp];
    for (let t = 0; t < 4; t++) popEls[t].textContent = fmt(c.tribe[t]);
    animalNum.textContent = fmt(animals);
    monsterNum.textContent = fmt(monsters);
    aliveEl.textContent = `Day ${cal.day} · ${state.villages.size} ${state.villages.size === 1 ? 'village' : 'villages'}`;
    const last = state.events[state.events.length - 1];
    if (last && (last.id !== lastEventId || force)) {
      lastEventId = last.id;
      tickerText.textContent = last.text;
      tickerDot.style.background = last.color || '';
      if (!force) {
        tickerPill.classList.add('bump');
        later(() => tickerPill.classList.remove('bump'), 220);
        if (!logPanel.classList.contains('gb-hidden')) renderLog();
      }
    }
    if (selected) renderInfo();
  }

  function layoutPanels() {
    const top = topBar.offsetHeight;
    const bottom = bottomBar.offsetHeight;
    info.style.bottom = `${bottom + 8}px`;
    ticker.style.bottom = `${bottom + 4}px`;
    logPanel.style.top = `${top + 6}px`;
    toastEl.style.top = `${top + 10}px`;
  }

  // ---- effects queue -----------------------------------------------------------------------------
  function drainFx(now) {
    const q = state.fx;
    for (let i = 0; i < q.length; i++) {
      const e = q[i];
      switch (e.k) {
        case 's':
          playSfx(e.name);
          break;
        case 'p':
          particles.emit(e.kind, e.x, e.y, e.n, { spread: e.spread });
          break;
        case 'shake':
          shakeAmp = Math.max(shakeAmp, e.a * (reduceMotion ? 0.25 : 1));
          break;
        case 'flash':
          flash = reduceMotion ? 0.4 : 1;
          break;
        case 'bolt': {
          const pts = [];
          let x = e.x + (Math.random() - 0.5) * 10;
          const top = e.y - 50;
          for (let k = 0; k <= 10; k++) {
            const t = k / 10;
            const tx = x + (e.x - x) * t;
            pts.push(k === 10 ? e.x : tx + (Math.random() - 0.5) * 3.5, top + (e.y - top) * t);
          }
          effects.bolts.push({ pts, t0: now });
          flash = Math.max(flash, reduceMotion ? 0.1 : 0.3);
          break;
        }
        case 'arrow':
          if (effects.arrows.length < 80) effects.arrows.push({ ...e, t0: now });
          break;
        case 'ring':
          effects.rings.push({ x: e.x, y: e.y, r: e.r, color: e.color || '#ffffff', t0: now, dur: 700 });
          break;
        case 'boom': {
          const r = e.r;
          particles.emit('fire', e.x, e.y, Math.round(r * 10), { spread: r * 0.5, power: 2 });
          particles.emit('smoke', e.x, e.y, Math.round(r * 6), { spread: r * 0.6, power: 1.5 });
          particles.emit('spark', e.x, e.y, Math.round(r * 6), { spread: r * 0.3 });
          particles.emit('debris', e.x, e.y, Math.round(r * 5), { spread: r * 0.4, power: 1.4 });
          effects.rings.push({ x: e.x, y: e.y, r: r * 2.2, color: '#fff3a0', t0: now, dur: 500 });
          break;
        }
        case 'mushroom':
          effects.mushrooms.push({ x: e.x, y: e.y, r: e.r, t0: now });
          particles.emit('fire', e.x, e.y, 120, { spread: e.r * 0.7, power: 3 });
          particles.emit('smoke', e.x, e.y, 90, { spread: e.r, power: 2, lifeMul: 2 });
          particles.emit('ash', e.x, e.y, 80, { spread: e.r * 1.6 });
          effects.rings.push({ x: e.x, y: e.y, r: e.r * 3, color: '#ffffff', t0: now, dur: 900 });
          break;
        case 'suck':
          particles.emit('debris', e.x, e.y, 1, { color: tileCss(e.t, e.b), tx: e.hx, ty: e.hy, lifeMul: 3 });
          break;
        default:
          break;
      }
    }
    q.length = 0;
  }

  function updateEffects(now) {
    for (let i = effects.projectiles.length - 1; i >= 0; i--) {
      const p = effects.projectiles[i];
      const t = (now - p.t0) / p.dur;
      if (t >= 1) {
        effects.projectiles.splice(i, 1);
        applyTool(state, p.kind + '_impact', p.x, p.y, p.size);
        continue;
      }
      if (p.kind === 'meteor') {
        const sx = p.x + 26 * (1 - t);
        const sy = p.y - 48 * (1 - t);
        particles.emit('fire', sx, sy, 2, { spread: 0.8 });
        particles.emit('smoke', sx + 1, sy - 2, 1, { spread: 0.6 });
      }
    }
    const keep = (arr, ms) => {
      for (let i = arr.length - 1; i >= 0; i--) if (now - arr[i].t0 > (arr[i].dur || ms)) arr.splice(i, 1);
    };
    keep(effects.rings, 900);
    keep(effects.mushrooms, 3200);
    keep(effects.bolts, 260);
    keep(effects.arrows, 220);
  }

  // ---- main loop ---------------------------------------------------------------------------------
  const renderer = createRenderer(canvas);
  renderer.setState(state);
  let raf = 0;
  let last = performance.now();
  function snapshot() {
    for (const c of state.creatures) {
      c.px = c.x;
      c.py = c.y;
    }
  }
  function frame(now) {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    sfxThisFrame = 0;
    // Adaptive quality: if frames stay slow, render the world at a lower pixel ratio.
    if (dt > 0.024 && dt < 0.1) slowFrames++;
    else if (slowFrames > 0) slowFrames -= 0.5;
    if (slowFrames > 120) {
      slowFrames = 0;
      const eff = Math.min(window.devicePixelRatio || 1, maxRatio);
      if (eff > 1.5) {
        maxRatio = eff > 2 ? 2 : 1.5;
        resize();
      }
    }
    try {
      updateEffects(now);
      if (!paused && !modalOpen) {
        acc += dt * SPEEDS[speedIdx] * TICKS_PER_SEC;
        let steps = Math.floor(acc);
        if (steps > 8) {
          steps = 8;
          acc = 8;
        }
        for (let i = 0; i < steps; i++) {
          if (i === steps - 1) snapshot();
          tick(state);
        }
        acc -= steps;
      }
      drainFx(now);
      particles.update(dt);
      if (following && selected?.type === 'creature') {
        const c = state.byId.get(selected.id);
        if (c) {
          const top = topBar.offsetHeight;
          const bottom = bottomBar.offsetHeight;
          const tx = (c._rx ?? c.x) - viewW() / 2 / cam.z;
          const ty = (c._ry ?? c.y) - (top + (viewH() - top - bottom) / 2) / cam.z;
          cam.x += (tx - cam.x) * 0.15;
          cam.y += (ty - cam.y) * 0.15;
        } else following = false;
      }
      shakeAmp *= Math.pow(0.02, dt);
      if (shakeAmp < 0.2) shakeAmp = 0;
      shakeX = shakeAmp ? (Math.random() - 0.5) * shakeAmp : 0;
      shakeY = shakeAmp ? (Math.random() - 0.5) * shakeAmp : 0;
      flash = Math.max(0, flash - dt * 1.4);
      const showBrush = hover && tool !== 'inspect' && !modalOpen;
      renderer.draw(cam, {
        now,
        alpha: paused || modalOpen ? 1 : clamp(acc, 0, 1),
        shakeX,
        shakeY,
        flash,
        showBorders,
        showNames,
        selected,
        brush: showBrush ? { x: hover.x, y: hover.y, r: BRUSH_RADII[brush] * (tool.startsWith('b_') ? 2 : 1) } : null,
        particles,
        effects,
      });
      if (now - hudAt > 250) {
        hudAt = now;
        refreshHud();
      }
    } catch (err) {
      console.error('[godbox]', err);
    }
  }

  // ---- sizing --------------------------------------------------------------------------------------
  let maxRatio = 3;
  let slowFrames = 0;
  function resize() {
    const w = root.clientWidth;
    const hh = root.clientHeight;
    renderer.resize(w, hh, Math.min(window.devicePixelRatio || 1, maxRatio));
    layoutPanels();
    clampCam();
  }
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => resize());
    ro.observe(root);
  } else listen(window, 'resize', resize);

  renderTools();
  refreshTime();
  resize();
  fitCamera();
  clampCam();
  refreshHud(true);
  tickerText.textContent = 'Four tribes have arrived. Pick a tool below and tap the world!';
  later(() => toast('Tap a tool, then the world. Two fingers (or Inspect) to pan, pinch to zoom.', 3800), 400);
  raf = requestAnimationFrame(frame);

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(raf);
      for (const id of timers) clearTimeout(id);
      timers.clear();
      clearTimeout(toastTimer);
      for (const off of cleanups) off();
      cleanups.length = 0;
      ro?.disconnect();
      root.remove();
      releaseStyle();
    },
    /** Debug/test hooks (not part of the contract). */
    get state() {
      return state;
    },
    get camera() {
      return { ...cam };
    },
    worldToScreen(x, y) {
      return { x: (x - cam.x) * cam.z, y: (y - cam.y) * cam.z };
    },
  };
}

export default mountGodBox;
