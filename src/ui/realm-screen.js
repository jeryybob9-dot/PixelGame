// The Realm Clash screen. One goal on screen at all times: destroy the red castle, protect the blue one.
// Island view, floating joystick, one hero Power button, a card tray paid in bricks, a 3-building build bar,
// castle health bars, an arrow to the enemy castle, minimap, then results.

import { el, clear, fmtTime, clamp, dist2, haptic } from '../core/util.js';
import { createRng } from '../core/rng.js';
import { Realm, STEP } from '../realm/realm.js';
import { RealmRenderer } from '../realm/realm-render.js';
import { Realm3DRenderer, webglAvailable } from '../realm3d/render3d.js';
import { RealmAI } from '../realm/realm-ai.js';
import { HordeDirector } from '../realm/horde.js';
import { TrainingCoach } from './training.js';
import { STRUCTURES, BUILD_MENU, RUSH_AT, cardBricks } from '../realm/constants.js';
import { spellReady } from '../battle/hero.js';
import { CARDS } from '../data/cards.js';
import { ARENAS } from '../data/arenas.js';
import { HEROES } from '../data/heroes.js';
import { PETS } from '../data/gadgets.js';
import { EMOTES } from '../data/emotes.js';
import { getProfile, arenaIndex, applyBattleResult, setSetting, finishTutorial, tutorialDrop } from '../core/profile.js';
import { cardArtURL, icon, countUp } from './components.js';
import { drawHero, drawSprite } from '../art/sprite-cache.js';
import { playerSetup, enemySetup, SPELL_ICON } from './battle-screen.js';

const BUILD_ICON = { house: 'house', barracks: 'barracks', tower: 'princess_tower' };
const REASON_TEXT = {
  terrain: 'Can\'t build on that ground', occupied: 'Something is in the way', territory: 'Build on your side of the river',
  fire: 'The ground is burning', deposit: 'Keep brick piles clear', edge: 'Too close to the edge', bridge: 'Keep the bridges clear',
  bricks: 'Not enough bricks', 'not-started': 'Wait for the match to start',
};

/** A small canvas with a castle sprite in team colours. */
function castleIcon(team) {
  const c = el('canvas.r-castle-ico', { width: 40, height: 44 });
  try {
    drawSprite(c.getContext('2d'), 'keep', 20, 44, { team });
  } catch {
    /* art missing */
  }
  return c;
}

export const realmScreen = {
  mount(root, app, params = {}) {
    const mode = params.mode || 'clash'; // clash | horde | training
    const profile = getProfile();
    const firstTraining = mode === 'training' && !profile.tourDone;
    const arenaIdx = mode === 'training' ? 0 : mode === 'horde' ? Math.min(arenaIndex(), 3) : arenaIndex();
    const arena = ARENAS[arenaIdx];
    const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
    const rng = createRng(seed);
    const me = playerSetup();
    let enemy = null;
    if (mode === 'clash') enemy = enemySetup(arenaIdx, rng);
    else if (mode === 'training') enemy = { ...enemySetup(0, rng), name: 'Sleepy Rival', petId: null, gadgetId: null, cardLevels: {} };

    let trainingAI = null;
    const R = new Realm({ mode, arena, seed, players: [me, enemy], audio: app.audio, settings: { dmgNumbers: profile.settings.dmgNumbers, particles: profile.settings.particles } });
    if (mode === 'clash') {
      const easyStart = (profile.stats.realmBattles || 0) < 2;
      R.ai = [new RealmAI(R, 1, easyStart ? 'easy' : arena.ai.difficulty)];
    } else if (mode === 'training') {
      trainingAI = new RealmAI(R, 1, 'tutorial');
      R.ai = [trainingAI];
    } else if (mode === 'horde') {
      R.horde = new HordeDirector(R);
    }
    app.music(mode === 'horde' ? 'waves' : arena.music);

    // ───────────── DOM: top ─────────────
    const clockEl = el('div.r-clock-time', { text: fmtTime(R.clock) });
    const clockSub = el('div.r-clock-sub', { text: mode === 'horde' ? 'NIGHT 0' : mode === 'training' ? 'TRAINING' : 'TIME LEFT' });
    const pauseBtn = el('button.icon-btn.r-pause', { 'aria-label': 'Pause', type: 'button' }, el('span.pause-glyph'));
    const clockBox = el('div.r-clock', null, clockEl, clockSub);
    const top = el('div.r-top', null,
      el('div.r-enemy', null, enemy ? el('span.lvl-badge.red', { text: String(enemy.kingLevel) }) : null, el('span', { text: enemy ? enemy.name : `Horde · ${arena.name}` })),
      clockBox,
      pauseBtn);
    const castleBar = (team, label) => {
      const fill = el('div.r-cb-fill');
      const pct = el('b.r-cb-pct', { text: '100%' });
      const node = el(`div.r-cb.${team === 0 ? 'blue' : 'red'}`, null, castleIcon(team), el('div.r-cb-body', null, el('span.r-cb-label', { text: label }), el('div.r-cb-track', null, fill)), pct);
      return { node, fill, pct };
    };
    const myCastle = castleBar(0, 'YOUR CASTLE');
    const theirCastle = castleBar(1, mode === 'horde' ? '' : 'ENEMY CASTLE');
    const castles = el('div.r-castles', null, myCastle.node, mode === 'horde' ? null : theirCastle.node);

    // ───────────── DOM: island ─────────────
    const villagerChip = el('div.r-chip.pop', null, icon('ui_pop', '', 2), el('span', { text: '4' }));
    const chips = el('div.r-chips', null, villagerChip);
    const minimap = el('canvas.r-minimap', { width: R.W * 2, height: R.H * 2, 'aria-label': 'Minimap' });
    const followBtn = el('button.r-follow', { type: 'button', hidden: true }, 'Back to hero');
    const use3d = profile.settings.graphics !== '2d' && webglAvailable();
    let canvas = el('canvas.r-canvas');
    const hudCanvas = use3d ? el('canvas.r-hud') : null;
    const banner = el('div.b-banner.r-banner');
    const joyBase = el('div.r-joy', { hidden: true }, el('div.r-joy-knob'));
    const feed = el('div.r-feed');
    const goalArrow = el('div.r-goal', { hidden: true }, el('div.r-goal-arrow'), castleIcon(1), el('span', { text: 'ENEMY' }));
    const mapWrap = el('div.r-map', null, canvas, hudCanvas, joyBase, goalArrow, banner, feed, chips, minimap, followBtn);

    // ───────────── DOM: bottom ─────────────
    const heroDef = HEROES[me.heroId];
    const heroCv = el('canvas.hero-port', { width: 20, height: 22 });
    const heroHp = el('div.hero-hp-fill');
    const heroRespawn = el('div.hero-respawn', { hidden: true });
    const heroLvl = el('span.r-hero-lvl', { text: 'LV1' });
    const heroBox = el('button.hero-box.r-herobox', { type: 'button', 'aria-label': 'Hero' }, heroCv, el('div.hero-hp', null, heroHp), heroRespawn, heroLvl);
    const powerIcon = el('span.r-power-icon');
    const powerBtn = el('button.r-power', { type: 'button', 'aria-label': 'Hero power' }, powerIcon, el('span.r-power-label', { text: 'POWER' }), el('span.hb-cd'));
    const buildBtn = el('button.r-vbtn.build', { type: 'button', 'aria-label': 'Build' }, icon('ui_hammer', '', 2), el('span', { text: 'BUILD' }));
    const emoteBtn = el('button.r-vbtn.emote', { type: 'button', 'aria-label': 'Emotes' }, icon('emote_thumbs', '', 1));
    const controls = el('div.r-controls', null, buildBtn, el('div.r-spacer'), enemy ? emoteBtn : null, heroBox, powerBtn);

    const nextImg = el('img.next-art', { alt: '' });
    const nextBox = el('div.next-card', null, el('small', { text: 'NEXT' }), nextImg);
    const cardEls = [0, 1, 2, 3].map((i) => {
      const fill = el('div.hc-fill');
      const node = el('button.hand-card', { type: 'button', dataset: { slot: String(i) } },
        el('img.hc-art', { alt: '', draggable: 'false' }), el('div.hc-cost.bricks', null, el('span')), fill);
      return { node, img: node.querySelector('img'), cost: node.querySelector('.hc-cost span'), fill, id: null };
    });
    const hand = el('div.hand', null, nextBox, ...cardEls.map((c) => c.node));
    const brickNum = el('b.r-bricks-num', { text: '0' });
    const brickRate = el('span.r-bricks-rate', { text: '' });
    const brickBar = el('div.r-bricks', null, icon('ui_brick', '', 3), brickNum, el('span.r-bricks-label', { text: 'BRICKS' }), brickRate);
    const buildItems = BUILD_MENU.map((id) => {
      const def = STRUCTURES[id];
      const node = el('button.r-build-item', { type: 'button', dataset: { id } },
        icon(BUILD_ICON[id], 'r-build-icon', 1), el('span.r-build-name', { text: def.name }), el('span.r-build-desc', { text: def.desc }),
        el('span.r-build-cost', null, icon('ui_brick', '', 1), String(def.cost)));
      return { id, node };
    });
    const buildHint = el('div.r-build-hint', { text: 'Pick a building, then tap your side of the river.' });
    const confirmBtn = el('button.btn.btn-gold.r-confirm', { type: 'button', hidden: true }, '✓ Build');
    const cancelBtn = el('button.btn.btn-ghost.r-cancel', { type: 'button' }, 'Done');
    const buildTray = el('div.r-build', { hidden: true }, el('div.r-build-row', null, ...buildItems.map((b) => b.node)), el('div.r-build-foot', null, buildHint, confirmBtn, cancelBtn));
    const tray = el('div.r-tray', null, hand);
    const bottom = el('div.r-bottom', null, controls, brickBar, tray, buildTray);
    const screen = el('div.realm', null, top, castles, mapWrap, bottom);
    root.appendChild(screen);

    let renderer;
    try {
      renderer = use3d ? new Realm3DRenderer(R, canvas, hudCanvas) : new RealmRenderer(R, canvas);
    } catch (err) {
      console.warn('3D view unavailable, using 2D', err);
      hudCanvas?.remove();
      // a canvas that already handed out a WebGL context cannot give a 2D one
      const fresh = el('canvas.r-canvas');
      canvas.replaceWith(fresh);
      canvas = fresh;
      renderer = new RealmRenderer(R, canvas);
    }
    if (globalThis.__BBR) {
      globalThis.__BBR.realm = R;
      globalThis.__BBR.realmRenderer = renderer;
    }
    let zoomTiles = clamp(profile.settings.realmZoom || 14, 8, 24);
    const fit = () => {
      const r = mapWrap.getBoundingClientRect();
      renderer.resize(Math.max(100, r.width), Math.max(100, r.height));
      renderer.setZoomTiles(zoomTiles);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(mapWrap);
    fit();

    // ───────────── input state ─────────────
    const ui = { ghost: null, build: null, summonZone: null, selectedStructure: null };
    const cam = { free: false, tx: renderer.cam.x, ty: renderer.cam.y };
    let selected = -1;
    let drag = null;
    let ended = false;
    let buildMode = false;
    let buildSel = null;
    const pointers = new Map();
    let joy = null;
    let pinch = null;
    let pan = null;

    const local = (ev) => {
      const r = canvas.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top, w: r.width, h: r.height, inside: ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom };
    };
    const toWorld = (ev) => {
      const l = local(ev);
      return { ...renderer.toWorld(l.x, l.y), inside: l.inside };
    };

    const ghostFor = (cardId, wx, wy) => {
      const card = CARDS[cardId];
      const pos = R.previewPlacement(0, cardId, wx, wy);
      const valid = !!pos && R.players[0].bricks >= cardBricks(card);
      const u = card.unit;
      const b = card.building;
      return {
        cardId,
        pos: pos || { x: wx, y: wy },
        valid,
        isSpell: card.type === 'spell',
        radius: card.spell?.radius || 0,
        sprite: u ? (u.special?.builder ? 'villager' : u.sprite) : b ? b.sprite : card.spell?.kind === 'wall' ? 'wall' : null,
        count: u ? (u.special?.builder ? 2 : Math.min(3, u.count || 1)) : card.spell?.kind === 'wall' ? 5 : 1,
        range: b?.range || 0,
      };
    };
    const zoneFor = (cardId) => {
      const card = CARDS[cardId];
      if (!card || card.type === 'spell') return null;
      return { building: card.type === 'building', flying: !!card.unit?.flying };
    };

    const clearCardSel = () => {
      selected = -1;
      cardEls.forEach((c) => c.node.classList.remove('selected'));
      ui.ghost = null;
      ui.summonZone = null;
    };
    const selectCard = (i) => {
      if (buildMode) setBuildMode(false);
      selected = selected === i ? -1 : i;
      cardEls.forEach((c, k) => c.node.classList.toggle('selected', k === selected));
      ui.summonZone = selected >= 0 ? zoneFor(R.players[0].hand[selected]) : null;
      if (selected >= 0) app.sfx('card_select', { volume: 0.6 });
    };
    const flashBricks = () => {
      brickBar.classList.remove('shake');
      void brickBar.offsetWidth;
      brickBar.classList.add('shake');
    };
    const tryCast = (slot, wx, wy) => {
      const res = R.playCard(0, slot, wx, wy);
      if (!res.ok) {
        if (res.reason === 'bricks') {
          flashBricks();
          app.toast('Not enough bricks yet', 'bad', 900);
        } else if (res.reason === 'placement') app.toast('Drop troops on your side of the river (or next to your hero)', 'bad', 1500);
        app.sfx('ui_error', { volume: 0.5 });
        return false;
      }
      haptic('light');
      clearCardSel();
      return true;
    };

    // cards: drag onto the island, or tap then tap the island
    cardEls.forEach((c, slot) => {
      c.node.addEventListener('pointerdown', (ev) => {
        if (ended) return;
        ev.preventDefault();
        c.node.setPointerCapture?.(ev.pointerId);
        drag = { slot, id: ev.pointerId, sx: ev.clientX, sy: ev.clientY, moved: false, over: false };
      });
      c.node.addEventListener('pointermove', (ev) => {
        if (!drag || drag.id !== ev.pointerId) return;
        if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > 10) {
          drag.moved = true;
          if (buildMode) setBuildMode(false);
          selected = slot;
          cardEls.forEach((cc, k) => cc.node.classList.toggle('selected', k === slot));
          c.node.classList.add('dragging');
          ui.summonZone = zoneFor(R.players[0].hand[slot]);
        }
        if (!drag.moved) return;
        const w = toWorld(ev);
        drag.over = w.inside;
        ui.ghost = w.inside ? ghostFor(R.players[0].hand[slot], w.x, w.y - 0.8) : null;
        const l = local(ev);
        drag.edge = w.inside && l.y < 50 ? -1 : 0;
      });
      const end = (ev) => {
        if (!drag || drag.id !== ev.pointerId) return;
        c.node.classList.remove('dragging');
        const d = drag;
        drag = null;
        if (!d.moved) {
          selectCard(slot);
          return;
        }
        const g = ui.ghost;
        ui.ghost = null;
        if (d.over && g) tryCast(slot, g.pos.x, g.pos.y);
        clearCardSel();
      };
      c.node.addEventListener('pointerup', end);
      c.node.addEventListener('pointercancel', (ev) => {
        if (drag && drag.id === ev.pointerId) {
          drag = null;
          c.node.classList.remove('dragging');
          clearCardSel();
        }
      });
    });

    // ───────────── island pointer handling ─────────────
    const JOY_R = 46;
    canvas.addEventListener('pointerdown', (ev) => {
      if (ended) return;
      ev.preventDefault();
      canvas.setPointerCapture?.(ev.pointerId);
      const l = local(ev);
      pointers.set(ev.pointerId, { x: l.x, y: l.y, sx: l.x, sy: l.y, t: performance.now() });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), tiles: zoomTiles };
        if (joy) endJoy();
        pan = null;
        return;
      }
      if (pointers.size > 2) return;
      const w = renderer.toWorld(l.x, l.y);
      if (selected >= 0) {
        tryCast(selected, w.x, w.y);
        return;
      }
      if (buildMode) {
        pan = { id: ev.pointerId, x: l.x, y: l.y, moved: false, cx: renderer.cam.x, cy: renderer.cam.y };
        return;
      }
      // left side: floating joystick
      if (l.x < l.w * 0.55 && R.phase !== 'ended') {
        joy = { id: ev.pointerId, ox: l.x, oy: l.y };
        joyBase.hidden = false;
        joyBase.style.left = `${l.x}px`;
        joyBase.style.top = `${l.y}px`;
        joyBase.firstChild.style.transform = 'translate(-50%, -50%)';
        R.heroJoy(0, 0, 0);
        cam.free = false;
        followBtn.hidden = true;
        return;
      }
      pan = { id: ev.pointerId, x: l.x, y: l.y, moved: false, cx: renderer.cam.x, cy: renderer.cam.y, tap: true };
    });
    canvas.addEventListener('pointermove', (ev) => {
      const l = local(ev);
      const p = pointers.get(ev.pointerId);
      if (p) {
        p.x = l.x;
        p.y = l.y;
      }
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        zoomTiles = clamp(pinch.tiles * (pinch.d / Math.max(20, d)), 8, 24);
        renderer.setZoomTiles(zoomTiles);
        return;
      }
      if (joy && joy.id === ev.pointerId) {
        let dx = l.x - joy.ox;
        let dy = l.y - joy.oy;
        const m = Math.hypot(dx, dy);
        if (m > JOY_R) {
          joy.ox += (dx / m) * (m - JOY_R);
          joy.oy += (dy / m) * (m - JOY_R);
          joyBase.style.left = `${joy.ox}px`;
          joyBase.style.top = `${joy.oy}px`;
          dx = l.x - joy.ox;
          dy = l.y - joy.oy;
        }
        joyBase.firstChild.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        R.heroJoy(0, dx / JOY_R, dy / JOY_R);
        return;
      }
      if (pan && pan.id === ev.pointerId) {
        const dx = l.x - pan.x;
        const dy = l.y - pan.y;
        if (!pan.moved && Math.hypot(dx, dy) > 9) pan.moved = true;
        if (pan.moved) {
          cam.free = true;
          followBtn.hidden = false;
          const d = renderer.panDelta(dx, dy);
          renderer.cam.x = pan.cx + d.x;
          renderer.cam.y = pan.cy + d.y;
          cam.tx = renderer.cam.x;
          cam.ty = renderer.cam.y;
        }
      }
      if (selected >= 0 && ev.pointerType === 'mouse' && !drag) {
        const w = renderer.toWorld(l.x, l.y);
        ui.ghost = ghostFor(R.players[0].hand[selected], w.x, w.y);
      }
      if (buildMode && buildSel && ev.pointerType === 'mouse') placeGhost(renderer.toWorld(l.x, l.y), false);
    });
    const upCanvas = (ev) => {
      const p = pointers.get(ev.pointerId);
      pointers.delete(ev.pointerId);
      if (pinch) {
        if (pointers.size < 2) {
          pinch = null;
          try {
            setSetting('realmZoom', Math.round(zoomTiles));
          } catch {
            /* optional */
          }
        }
        return;
      }
      if (joy && joy.id === ev.pointerId) {
        endJoy();
        return;
      }
      if (pan && pan.id === ev.pointerId) {
        const wasPan = pan;
        pan = null;
        if (wasPan.moved || ev.type === 'pointercancel') return;
        const w = renderer.toWorld(p ? p.x : 0, p ? p.y : 0);
        if (buildMode) {
          if (buildSel) placeGhost(w, true);
          return;
        }
        tapIsland(w);
      }
    };
    canvas.addEventListener('pointerup', upCanvas);
    canvas.addEventListener('pointercancel', upCanvas);
    canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      zoomTiles = clamp(zoomTiles * (ev.deltaY > 0 ? 1.1 : 0.9), 8, 24);
      renderer.setZoomTiles(zoomTiles);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

    function endJoy() {
      joy = null;
      joyBase.hidden = true;
      R.heroJoy(0, null);
    }

    /** Tap an enemy to attack it, or the ground to walk there. */
    function tapIsland(w) {
      let target = null;
      let bd = Infinity;
      for (const e of R.entities) {
        if (!e.alive || e.team === 0 || e.untargetable || e.kind === 'critter' || e.kind === 'pickup') continue;
        const ey = e.struct ? e.y : e.flying ? e.y - 0.9 : e.y - (e.h || 1) * 0.4;
        const d = dist2(e.x, ey, w.x, w.y);
        const rr = (e.r + 0.6) ** 2;
        if (d < rr && d < bd) {
          bd = d;
          target = e;
        }
      }
      const hero = R.players[0].hero;
      if (!hero || !hero.alive) {
        app.toast('Your hero is getting back up…', 'info', 900);
        return;
      }
      if (target) R.heroFocus(0, target);
      else R.heroMove(0, w.x, w.y);
      cam.free = false;
      followBtn.hidden = true;
      app.sfx('ui_click', { volume: 0.3, pitch: 1.3 });
    }

    // ───────────── building ─────────────
    function setBuildMode(on) {
      buildMode = on;
      buildTray.hidden = !on;
      tray.hidden = on;
      buildBtn.classList.toggle('on', on);
      if (on) {
        clearCardSel();
        if (joy) endJoy();
        ui.summonZone = { building: true };
      } else {
        buildSel = null;
        ui.build = null;
        ui.summonZone = null;
        confirmBtn.hidden = true;
        buildItems.forEach((b) => b.node.classList.remove('selected'));
        buildHint.textContent = 'Pick a building, then tap your side of the river.';
      }
      app.sfx(on ? 'ui_click' : 'ui_back', { volume: 0.5 });
    }
    buildBtn.addEventListener('click', () => setBuildMode(!buildMode));
    cancelBtn.addEventListener('click', () => setBuildMode(false));
    buildItems.forEach((b) => b.node.addEventListener('click', () => {
      buildSel = buildSel === b.id ? null : b.id;
      buildItems.forEach((o) => o.node.classList.toggle('selected', o.id === buildSel));
      ui.build = null;
      confirmBtn.hidden = true;
      if (buildSel) {
        buildHint.textContent = 'Tap your side of the river to place it.';
        const c = renderer.toWorld(renderer.layout.cssW / 2, renderer.layout.cssH * 0.5);
        placeGhost(c, false);
        app.sfx('card_select', { volume: 0.5 });
      } else buildHint.textContent = 'Pick a building, then tap your side of the river.';
    }));
    function placeGhost(w, fromTap) {
      if (!buildSel) return;
      const def = STRUCTURES[buildSel];
      const x0 = Math.round(w.x - def.w / 2);
      const y0 = Math.round(w.y - def.h / 2);
      if (fromTap && ui.build && ui.build.x0 === x0 && ui.build.y0 === y0 && ui.build.valid) {
        confirmBuild();
        return;
      }
      const prob = R.placementProblem(0, buildSel, x0, y0);
      const afford = R.players[0].bricks >= def.cost;
      ui.build = { id: buildSel, x0, y0, valid: !prob && afford, prob: prob || (afford ? null : 'bricks') };
      confirmBtn.hidden = false;
      confirmBtn.disabled = !ui.build.valid;
      confirmBtn.textContent = ui.build.valid ? `✓ ${def.name}` : REASON_TEXT[ui.build.prob] || 'Can\'t build here';
    }
    function confirmBuild() {
      const b = ui.build;
      if (!b) return;
      const res = R.orderBuild(0, b.id, b.x0, b.y0);
      if (!res.ok) {
        app.toast(REASON_TEXT[res.reason] || 'Can\'t build there', 'bad', 1000);
        app.sfx('ui_error', { volume: 0.5 });
        return;
      }
      haptic('medium');
      setBuildMode(false);
    }
    confirmBtn.addEventListener('click', confirmBuild);

    // hero
    powerBtn.addEventListener('click', () => {
      const h = R.players[0].hero;
      if (!h?.alive) return;
      if (R.heroPower(0)) haptic('medium');
      else app.toast('Power is charging…', 'info', 800);
    });
    heroBox.addEventListener('click', () => {
      cam.free = false;
      followBtn.hidden = true;
      const h = R.players[0].hero;
      if (h) app.toast(`${heroDef.name} · level ${h.form}${me.petId ? ' · ' + PETS[me.petId].name : ''}. Walk home to heal.`, 'info', 1600);
    });
    followBtn.addEventListener('click', () => {
      cam.free = false;
      followBtn.hidden = true;
    });
    emoteBtn.addEventListener('click', () => {
      const row = el('div.emote-row', null, ...EMOTES.map((em) => el('button.emote-pick', { type: 'button', 'aria-label': em.name, onclick: () => {
        R.emote(0, em.id);
        close();
      } }, icon(`emote_${em.id}`, '', 2))));
      const close = app.modal(row, { title: 'Emote', className: 'emote-sheet' });
    });
    // the arrow to the enemy castle doubles as a button: tap it to look there
    goalArrow.addEventListener('click', () => {
      const k = R.players[1]?.keep;
      if (!k) return;
      cam.free = true;
      cam.tx = k.x;
      cam.ty = k.y + 3;
      followBtn.hidden = false;
    });
    const lookAtMinimap = (ev) => {
      const r = minimap.getBoundingClientRect();
      cam.free = true;
      cam.tx = ((ev.clientX - r.left) / r.width) * R.W;
      cam.ty = ((ev.clientY - r.top) / r.height) * R.H;
      followBtn.hidden = false;
    };
    minimap.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      minimap.setPointerCapture?.(ev.pointerId);
      lookAtMinimap(ev);
      minimap.onpointermove = (e2) => lookAtMinimap(e2);
    });
    minimap.addEventListener('pointerup', () => {
      minimap.onpointermove = null;
    });

    // keyboard (desktop)
    const keys = new Set();
    const onKey = (ev) => {
      if (ended) return;
      const k = ev.key.toLowerCase();
      if (ev.type === 'keyup') {
        keys.delete(k);
        return;
      }
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        keys.add(k);
        ev.preventDefault();
        return;
      }
      if (ev.repeat) return;
      if (k >= '1' && k <= '4') selectCard(Number(k) - 1);
      else if (k === 'q' || k === 'e' || k === 'f') powerBtn.click();
      else if (k === 'b') setBuildMode(!buildMode);
      else if (k === ' ') {
        cam.free = false;
        followBtn.hidden = true;
      } else if (k === 'escape') {
        if (selected >= 0) clearCardSel();
        else if (buildMode) setBuildMode(false);
        else openPause();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    let keyJoy = false;
    function keyboardJoy() {
      let x = 0;
      let y = 0;
      if (keys.has('a') || keys.has('arrowleft')) x -= 1;
      if (keys.has('d') || keys.has('arrowright')) x += 1;
      if (keys.has('w') || keys.has('arrowup')) y -= 1;
      if (keys.has('s') || keys.has('arrowdown')) y += 1;
      if (x || y) {
        const m = Math.hypot(x, y);
        R.heroJoy(0, x / m, y / m);
        keyJoy = true;
        cam.free = false;
        followBtn.hidden = true;
      } else if (keyJoy && !joy) {
        keyJoy = false;
        R.heroJoy(0, null);
      }
    }

    // pause
    const openPause = () => {
      if (ended) return;
      R.pause(true);
      const s = getProfile().settings;
      const body = el('div.pause', null,
        el('button.btn.btn-gold.btn-big', { type: 'button', onclick: () => close() }, 'Resume'),
        el('div.pause-rules', null,
          el('p', null, el('b', { text: 'Goal: ' }), mode === 'horde' ? 'Keep your castle standing as long as you can.' : 'Destroy the red castle. If time runs out, the castle with more health wins.'),
          el('p', null, el('b', { text: 'Move: ' }), 'drag on the left of the island. Tap an enemy to attack it.'),
          el('p', null, el('b', { text: 'Troops: ' }), 'drag a card onto your side of the river. They march on the enemy castle.'),
          el('p', null, el('b', { text: 'Bricks: ' }), 'your villagers mine them. Houses give more villagers.')),
        el('button.btn.btn-ghost', { type: 'button', onclick: () => {
          const muted = !getProfile().settings.muted;
          setSetting('muted', muted);
          app.toast(muted ? 'Sound off' : 'Sound on');
        } }, s.muted ? 'Sound: Off' : 'Sound: On'),
        el('button.btn.btn-red', { type: 'button', onclick: async () => {
          close();
          R.pause(true);
          const yes = await app.confirm({ title: mode === 'horde' ? 'Give up?' : 'Surrender?', text: mode === 'clash' ? 'You will lose this match and its trophies.' : '', yes: mode === 'horde' ? 'Give up' : 'Surrender', danger: true });
          if (yes) R.finish(1, 'surrender');
          R.pause(false);
        } }, mode === 'horde' ? 'Give up' : 'Surrender'));
      const close = app.modal(body, { title: 'Paused', onClose: () => R.pause(false) });
    };
    pauseBtn.addEventListener('click', openPause);
    app.onHidden = () => {
      if (!ended && R.phase !== 'ended') openPause();
    };

    // ───────────── events → HUD ─────────────
    const showBanner = (text, kind = '', sub = '') => {
      banner.className = `b-banner r-banner show ${kind}`;
      clear(banner);
      banner.append(el('span', { text }));
      if (sub) banner.append(el('small', { text: sub }));
      clearTimeout(showBanner.t);
      showBanner.t = setTimeout(() => (banner.className = 'b-banner r-banner'), kind === 'count' ? 700 : 2400);
    };
    const note = (text, kind = 'info') => {
      const n = el(`div.r-note.${kind}`, { text });
      feed.prepend(n);
      while (feed.children.length > 3) feed.lastChild.remove();
      setTimeout(() => n.classList.add('out'), 2600);
      setTimeout(() => n.remove(), 3200);
    };
    const offs = [
      R.on('countdown', (n) => showBanner(String(n), 'count')),
      R.on('banner', ({ text, kind, sub }) => showBanner(text, kind, sub)),
      R.on('built', ({ team, s }) => team === 0 && note(`${STRUCTURES[s.struct]?.name || 'Building'} finished${s.struct === 'house' ? ': +2 villagers' : ''}`, 'good')),
      R.on('structureLost', ({ team, s }) => {
        if (s.built < 1 || s.struct === 'keep') return;
        if (team === 0) note(`Our ${STRUCTURES[s.struct]?.name || 'building'} was destroyed`, 'bad');
        else if (team === 1) {
          note(`Destroyed an enemy ${STRUCTURES[s.struct]?.name || 'building'}!`, 'good');
          haptic('heavy');
        }
      }),
      R.on('heroLevel', ({ team, level }) => {
        if (team !== 0) return;
        showBanner(`HERO LEVEL ${level}!`, 'form', level >= 3 ? 'Power upgraded!' : 'Tougher and stronger');
        haptic('heavy');
      }),
      R.on('underAttack', ({ team, s }) => {
        if (team !== 0) return;
        renderer.ping(s.x, s.y);
        const p = renderer.toCss(s.x, s.y);
        const onScreen = p.x > 0 && p.y > 0 && p.x < renderer.layout.cssW && p.y < renderer.layout.cssH;
        if (!onScreen) {
          note(s.struct === 'keep' ? 'Your castle is under attack!' : `Your ${STRUCTURES[s.struct]?.name || 'building'} is under attack!`, 'bad');
          app.sfx('raid', { volume: 0.35 });
        }
      }),
      R.on('heroDeath', ({ team }) => note(team === 0 ? 'Your hero fell. Back in 5 seconds' : 'Enemy hero defeated! +40 bricks', team === 0 ? 'bad' : 'good')),
      R.on('end', (r) => onEnd(r)),
    ];

    // ───────────── training coach ─────────────
    let camTrack = null;
    const api = {
      els: {
        hand, cards: cardEls.map((c) => c.node), nextBox, brickBar, buildBtn, confirmBtn, powerBtn, heroBox, castles, clock: clockBox, pauseBtn,
        minimap, goalArrow, villagerChip, buildItem: (id) => buildItems.find((b) => b.id === id)?.node,
      },
      mapRect: () => {
        const r = canvas.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      },
      /** The on-screen box around a patch of ground (client px), kept inside the island view. */
      worldBox: (x0, y0, x1, y1) => {
        const r = canvas.getBoundingClientRect();
        const pts = [renderer.toCss(x0, y0), renderer.toCss(x1, y0), renderer.toCss(x0, y1), renderer.toCss(x1, y1)];
        const minX = clamp(Math.min(...pts.map((p) => p.x)), 0, r.width);
        const maxX = clamp(Math.max(...pts.map((p) => p.x)), 0, r.width);
        const minY = clamp(Math.min(...pts.map((p) => p.y)), 0, r.height);
        const maxY = clamp(Math.max(...pts.map((p) => p.y)), 0, r.height);
        if (maxX - minX < 4 || maxY - minY < 4) return null;
        return { x: r.left + minX, y: r.top + minY, w: maxX - minX, h: maxY - minY };
      },
      look: (x, y) => {
        camTrack = null;
        cam.free = true;
        cam.tx = x;
        cam.ty = y;
      },
      track: (e) => {
        camTrack = e || null;
      },
      follow: () => {
        camTrack = null;
        cam.free = false;
        followBtn.hidden = true;
      },
      buildMode: () => buildMode,
      buildSel: () => buildSel,
      buildGhost: () => ui.build,
      /** A free spot for a House near the castle, on the river side. Returns the footprint centre. */
      houseSpot: () => {
        const k = R.players[0].keep;
        let best = null;
        let bd = Infinity;
        for (let y0 = Math.floor(k.y) - 8; y0 <= Math.floor(k.y) + 3; y0++) {
          for (let x0 = Math.floor(k.x) - 7; x0 <= Math.floor(k.x) + 6; x0++) {
            if (R.placementProblem(0, 'house', x0, y0)) continue;
            const d = Math.hypot(x0 + 1 - (k.x - 3.5), y0 + 1 - (k.y - 3.5));
            if (d < bd) {
              bd = d;
              best = { x: x0 + 1, y: y0 + 1 };
            }
          }
        }
        return best || { x: k.x - 3, y: k.y - 3 };
      },
    };
    const coach = mode === 'training' ? new TrainingCoach({
      app, R, api, ai: trainingAI,
      onSkip: async () => {
        R.pause(true);
        const yes = await app.confirm({ title: 'Skip the tutorial?', text: 'You can replay it any time from Training.', yes: 'Skip', no: 'Keep learning' });
        if (yes) {
          finishTutorial(true);
          app.go('home');
        } else R.pause(false);
      },
    }) : null;

    // ───────────── loop ─────────────
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let miniT = 0;
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      let dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (R.paused) dt = 0;
      keyboardJoy();
      coach?.update(dt);
      acc += coach?.frozen && R.phase === 'play' ? 0 : dt;
      let n = 0;
      while (acc >= STEP && n < 5) {
        R.step(STEP);
        acc -= STEP;
        n++;
      }
      if (n === 5) acc = 0;
      updateCamera(dt);
      renderer.draw(ui, dt);
      miniT -= dt;
      if (miniT <= 0) {
        miniT = 0.25;
        try {
          renderer.drawMinimap(minimap.getContext('2d'), 2);
        } catch {
          /* optional */
        }
      }
      updateHud(dt);
    };
    raf = requestAnimationFrame(frame);

    function updateCamera(dt) {
      const h = R.players[0].hero;
      const c = renderer.cam;
      if (drag?.edge) {
        cam.free = true;
        followBtn.hidden = false;
        cam.tx = c.x;
        cam.ty = c.y - dt * 8;
      }
      if (camTrack) {
        if (camTrack.alive) {
          cam.free = true;
          cam.tx = camTrack.x;
          cam.ty = camTrack.y - 1;
        } else camTrack = null;
      }
      let tx = cam.tx;
      let ty = cam.ty;
      if (!cam.free) {
        const anchor = h && h.alive ? h : R.players[0].keep;
        if (anchor) {
          tx = anchor.x;
          ty = anchor.y - 1;
        }
      }
      const k = Math.min(1, dt * (cam.free ? 10 : 6));
      if (!(pan && pan.moved)) {
        c.x += (tx - c.x) * k;
        c.y += (ty - c.y) * k;
      }
    }

    /** The arrow at the screen edge that always points at the enemy castle when it is off screen. */
    function updateGoalArrow() {
      const k = R.players[1]?.keep;
      if (!k || !k.alive || ended) {
        goalArrow.hidden = true;
        return;
      }
      const W = renderer.layout.cssW;
      const H = renderer.layout.cssH;
      const p = renderer.toCss(k.x, k.y);
      const on = p.x > 30 && p.y > 30 && p.x < W - 30 && p.y < H - 30 && (p.z == null || p.z < 1);
      goalArrow.hidden = on;
      if (on) return;
      const cx = W / 2;
      const cy = H / 2;
      let dx = p.x - cx;
      let dy = p.y - cy;
      if (p.z != null && p.z >= 1) {
        dx = -dx;
        dy = -dy;
      }
      const ang = Math.atan2(dy, dx);
      const m = 38;
      const sx = Math.abs(dx) > 1e-3 ? (W / 2 - m) / Math.abs(dx) : Infinity;
      const sy = Math.abs(dy) > 1e-3 ? (H / 2 - m) / Math.abs(dy) : Infinity;
      const s = Math.min(sx, sy);
      goalArrow.style.left = `${cx + dx * s}px`;
      goalArrow.style.top = `${cy + dy * s}px`;
      goalArrow.firstChild.style.transform = `rotate(${ang}rad)`;
    }

    const hudCache = {};
    function setText(node, key, v) {
      if (hudCache[key] === v) return;
      hudCache[key] = v;
      node.textContent = v;
    }
    const setCastle = (bar, team, key) => {
      const f = R.castleHealth(team);
      if (hudCache[key] === f) return;
      hudCache[key] = f;
      bar.fill.style.transform = `scaleX(${f})`;
      bar.pct.textContent = `${Math.ceil(f * 100)}%`;
      bar.node.classList.toggle('low', f < 0.3);
    };
    let portT = 0;
    function updateHud(dt) {
      const p = R.players[0];
      // clock
      if (mode === 'horde') {
        setText(clockEl, 'clock', fmtTime(R.elapsed));
        setText(clockSub, 'csub', R.night ? `NIGHT ${R.horde?.night || 1}` : `DAY ${(R.horde?.night || 0) + 1}`);
      } else {
        setText(clockEl, 'clock', fmtTime(R.clock));
        setText(clockSub, 'csub', R.rush ? 'BRICK RUSH x2' : 'TIME LEFT');
        clockEl.classList.toggle('hot', R.clock <= RUSH_AT);
      }
      setCastle(myCastle, 0, 'c0');
      if (R.players[1]) setCastle(theirCastle, 1, 'c1');
      updateGoalArrow();
      setText(villagerChip.lastChild, 'vill', `${p.villagers}`);
      // bricks
      setText(brickNum, 'bricks', String(p.bricks));
      setText(brickRate, 'rate', R.rush ? 'x2 RUSH' : '');
      brickBar.classList.toggle('rush', R.rush);
      // hand
      for (let i = 0; i < 4; i++) {
        const c = cardEls[i];
        const id = p.hand[i];
        const cost = cardBricks(CARDS[id]);
        if (c.id !== id) {
          c.id = id;
          c.img.src = cardArtURL(id);
          c.cost.textContent = String(cost);
          c.node.className = `hand-card r-${CARDS[id].rarity}${i === selected ? ' selected' : ''}`;
          c.node.setAttribute('aria-label', `${CARDS[id].name}, ${cost} bricks`);
          c.node.classList.add('cycled');
          setTimeout(() => c.node.classList.remove('cycled'), 250);
        }
        const ready = p.bricks >= cost;
        c.node.classList.toggle('poor', !ready);
        const frac = ready ? 0 : 1 - p.bricks / cost;
        if (hudCache['fill' + i] !== frac) {
          hudCache['fill' + i] = frac;
          c.fill.style.transform = `scaleY(${frac})`;
        }
      }
      const nextId = p.queue[0];
      if (hudCache.next !== nextId) {
        hudCache.next = nextId;
        nextImg.src = cardArtURL(nextId);
      }
      if (buildMode) {
        for (const b of buildItems) b.node.classList.toggle('poor', p.bricks < STRUCTURES[b.id].cost);
        if (ui.build) {
          const prob = R.placementProblem(0, ui.build.id, ui.build.x0, ui.build.y0);
          const afford = p.bricks >= STRUCTURES[ui.build.id].cost;
          const valid = !prob && afford;
          if (valid !== ui.build.valid) {
            ui.build.valid = valid;
            confirmBtn.disabled = !valid;
            confirmBtn.textContent = valid ? `✓ ${STRUCTURES[ui.build.id].name}` : REASON_TEXT[prob || 'bricks'] || 'Can\'t build here';
          }
        }
      }
      // hero
      const h = p.hero;
      const alive = h && h.alive;
      heroHp.style.transform = `scaleX(${alive ? clamp(h.hp / h.maxHp, 0, 1) : 0})`;
      heroRespawn.hidden = !!alive;
      if (!alive) setText(heroRespawn, 'resp', String(Math.max(1, Math.ceil(p.heroRespawnT))));
      setText(heroLvl, 'lvl', `LV${h ? h.form : 1}`);
      heroBox.classList.toggle('healing', !!h?.healing);
      const si = h && h.form >= 3 ? 1 : 0;
      const spell = heroDef.spells[si];
      if (hudCache.powerIcon !== spell.id) {
        hudCache.powerIcon = spell.id;
        clear(powerIcon);
        powerIcon.appendChild(icon(SPELL_ICON[spell.id] || 'spell_spark', 'hb-icon', 3));
        powerBtn.setAttribute('aria-label', `Hero power: ${spell.name}`);
      }
      const ready = !!alive && (spellReady(h, 0) || spellReady(h, 1));
      powerBtn.classList.toggle('ready', ready);
      const cd = h ? Math.max(0, h.spellCd[si]) : 0;
      setText(powerBtn.lastChild, 'pcd', !ready && cd > 0 ? String(Math.ceil(cd)) : '');
      portT += dt;
      if (h) {
        const ctx = heroCv.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, 20, 22);
        try {
          drawHero(ctx, { heroId: h.heroId, form: h.form, skin: h.skin, x: 10, y: 20, anim: 'idle', t: portT, team: 0, weaponId: h.weapon.id, aim: 0 });
        } catch {
          /* art missing */
        }
      }
    }

    // ───────────── results ─────────────
    function onEnd(r) {
      ended = true;
      clearCardSel();
      if (buildMode) setBuildMode(false);
      if (joy) endJoy();
      goalArrow.hidden = true;
      const win = r.winner === 0;
      const draw = r.winner === -1;
      const outcome = mode === 'horde' ? 'loss' : draw ? 'draw' : win ? 'win' : 'loss';
      const stats = R.summary(0);
      const petBonus = me.petId && PETS[me.petId].special?.goldBonus ? PETS[me.petId].special.goldBonus : 0;
      const res = applyBattleResult({
        outcome,
        crowns: stats.crowns,
        enemyCrowns: R.players[1]?.crowns || 0,
        stats: {
          cardsPlayed: stats.cardsPlayed, spellsCast: stats.spellsCast, kills: stats.kills, heroKills: stats.heroKills,
          towers: stats.towers, bricks: stats.bricks, built: stats.built, destroyed: stats.destroyed, forms: stats.forms, realmBattles: mode === 'clash' ? 1 : 0,
        },
        mode: mode === 'clash' ? 'realm' : mode === 'horde' ? 'horde' : 'tutorial',
        wave: mode === 'horde' ? R.horde?.night || 0 : 0,
        goldBonus: petBonus,
      });
      app.sfx(mode === 'horde' ? 'defeat' : draw ? 'draw' : win ? 'victory' : 'defeat');
      setTimeout(() => showResults(r, outcome, res, stats), 1800);
    }

    function showResults(r, outcome, res, stats) {
      const nights = R.horde?.night || 0;
      const title = mode === 'horde' ? `${nights} NIGHT${nights === 1 ? '' : 'S'}` : mode === 'training' ? 'TRAINING COMPLETE' : outcome === 'win' ? 'VICTORY!' : outcome === 'draw' ? 'DRAW' : 'DEFEAT';
      const pct = (f) => `${Math.ceil(f * 100)}%`;
      const why = mode === 'horde' ? 'Your castle fell to the horde.'
        : r.reason === 'keep' ? (outcome === 'win' ? 'You destroyed the red castle!' : 'Your castle was destroyed.')
          : r.reason === 'surrender' ? 'You surrendered.'
            : outcome === 'draw' ? 'Time\'s up: both castles had the same health.'
              : `Time's up: your castle ${pct(r.health[0])} vs theirs ${pct(r.health[1])}.`;
      const crownRow = mode === 'horde' ? null : el('div.res-crowns', null, ...[0, 1, 2].map((i) => el(`span.crown.big${i < R.players[0].crowns ? '.on' : ''}`, { style: { animationDelay: `${0.25 + i * 0.25}s` } })));
      const goldVal = el('span', { text: '0' });
      const rows = el('div.res-rows', null,
        mode === 'clash' ? el('div.res-row', null, icon('ui_trophy', '', 2), el('span', { text: 'Trophies' }), el('b', { class: res.trophyDelta >= 0 ? 'good' : 'bad', text: `${res.trophyDelta >= 0 ? '+' : ''}${res.trophyDelta}` })) : null,
        mode === 'horde' ? el('div.res-row', null, icon('ui_trophy', '', 2), el('span', { text: 'Best' }), el('b', { text: `${getProfile().stats.bestNights || nights} nights` })) : null,
        el('div.res-row', null, icon('ui_gold', '', 2), el('span', { text: 'Gold' }), el('b', null, '+', goldVal)),
        el('div.res-row', null, icon('ui_xp', '', 2), el('span', { text: 'Experience' }), el('b', { text: `+${res.xp}` })),
        el('div.res-row.dim', null, icon('ui_sword', '', 2), el('span', { text: 'Enemies defeated' }), el('b', { text: String(stats.kills) })),
        el('div.res-row.dim', null, icon('ui_brick', '', 2), el('span', { text: 'Bricks gathered' }), el('b', { text: String(stats.bricks) })),
        res.levelUps ? el('div.res-banner', { text: `KING LEVEL ${res.kingLevel}!` }) : null,
        res.newArena != null ? el('div.res-banner.arena', { text: `NEW REALM: ${ARENAS[res.newArena].name}` }) : null);
      const actions = el('div.res-actions');
      const wonDrop = outcome === 'win' || mode === 'training' || (mode === 'horde' && nights >= 3);
      if (mode === 'training' && firstTraining) {
        // the first reward is fixed so the menu tour can show a card upgrade
        actions.appendChild(el('button.btn.btn-gold.btn-big.pulse', { type: 'button', onclick: () => app.go('lucky', { tier: 0, drop: tutorialDrop(), tutorial: true, from: 'tutorial' }) }, 'Open Lucky Drop'));
      } else if (wonDrop) {
        const tier = mode === 'horde' ? (nights >= 10 ? 2 : nights >= 6 ? 1 : 0) : r.reason === 'keep' ? 1 : 0;
        actions.appendChild(el('button.btn.btn-gold.btn-big.pulse', { type: 'button', onclick: () => app.go('lucky', { tier, from: 'battle' }) }, 'Open Lucky Drop'));
        actions.appendChild(el('button.btn.btn-ghost', { type: 'button', onclick: () => app.go('home') }, 'Skip'));
      } else {
        actions.appendChild(el('button.btn.btn-gold.btn-big', { type: 'button', onclick: () => app.go('home') }, 'Continue'));
        if (mode !== 'training') actions.appendChild(el('button.btn.btn-ghost', { type: 'button', onclick: () => app.go('realm', { mode }) }, mode === 'horde' ? 'Try again' : 'Play again'));
      }
      const panel = el(`div.results.${outcome}`, null, el('div.ribbon', null, el('h1.res-title', { text: title })), crownRow, el('p.res-why', { text: why }), rows, actions);
      screen.appendChild(el('div.results-wrap', null, panel));
      countUp(goldVal, 0, res.gold, 900);
      if (outcome === 'win') app.sfx('coin', { volume: 0.6 });
    }

    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose?.();
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      offs.forEach((f) => f());
      coach?.destroy();
      app.onHidden = null;
      R.silent = true;
      try {
        app.audio.setIntensity?.(0);
      } catch {
        /* ignore */
      }
    };
  },
};
