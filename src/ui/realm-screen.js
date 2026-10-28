// The Realm Clash screen: island camera, floating joystick, hero buttons, Divine Card tray with Faith,
// build bar, war horn, minimap, Age clock and Dominion tug bar, then results.

import { el, clear, fmtTime, clamp, dist2, haptic } from '../core/util.js';
import { createRng } from '../core/rng.js';
import { Realm, STEP } from '../realm/realm.js';
import { RealmRenderer } from '../realm/realm-render.js';
import { Realm3DRenderer, webglAvailable } from '../realm3d/render3d.js';
import { RealmAI } from '../realm/realm-ai.js';
import { HordeDirector } from '../realm/horde.js';
import { RealmTutorial } from '../realm/realm-tutorial.js';
import { AGES, STRUCTURES, BUILD_MENU, FAITH_MAX, ELEMENT_COST, RELICS } from '../realm/constants.js';
import { formUpgradeCost, spellReady, gadgetReady } from '../battle/hero.js';
import { CARDS } from '../data/cards.js';
import { ARENAS } from '../data/arenas.js';
import { ELEMENTS, HEROES, FORM_NAMES } from '../data/heroes.js';
import { GADGETS, PETS } from '../data/gadgets.js';
import { EMOTES } from '../data/emotes.js';
import { getProfile, arenaIndex, applyBattleResult, setSetting } from '../core/profile.js';
import { cardArtURL, icon, countUp } from './components.js';
import { drawHero } from '../art/sprite-cache.js';
import { playerSetup, enemySetup, SPELL_ICON } from './battle-screen.js';

const BUILD_ICON = { house: 'house', barracks: 'barracks', tower: 'princess_tower', temple: 'temple', outpost: 'banner', wall: 'wall' };
const REASON_TEXT = {
  terrain: 'Can\'t build on that ground', occupied: 'Something is in the way', territory: 'Build inside your borders',
  fire: 'The ground is burning', deposit: 'Keep brick deposits clear', edge: 'Too close to the edge', 'too close': 'Leave room around your Keep',
  bricks: 'Not enough bricks', 'not-started': 'Wait for the match to start',
};

export const realmScreen = {
  mount(root, app, params = {}) {
    const mode = params.mode || 'clash'; // clash | horde | training
    const profile = getProfile();
    const arenaIdx = mode === 'training' ? 0 : mode === 'horde' ? Math.min(arenaIndex(), 3) : arenaIndex();
    const arena = ARENAS[arenaIdx];
    const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
    const rng = createRng(seed);
    const me = playerSetup();
    let enemy = null;
    if (mode === 'clash') enemy = enemySetup(arenaIdx, rng);
    else if (mode === 'training') enemy = { ...enemySetup(0, rng), name: 'Sleepy Rival', petId: null, gadgetId: null, cardLevels: {} };

    const R = new Realm({ mode, arena, seed, players: [me, enemy], audio: app.audio, settings: { dmgNumbers: profile.settings.dmgNumbers, particles: profile.settings.particles } });
    if (mode === 'clash') {
      const easyStart = (profile.stats.realmBattles || 0) < 2;
      R.ai = [new RealmAI(R, 1, easyStart ? 'easy' : arena.ai.difficulty)];
    } else if (mode === 'training') {
      const ai = new RealmAI(R, 1, 'tutorial');
      R.ai = [ai];
      R.tutorial = new RealmTutorial(R, ai);
    } else if (mode === 'horde') {
      R.horde = new HordeDirector(R);
    }
    app.music(mode === 'horde' ? 'waves' : arena.music);

    // ───────────── DOM ─────────────
    const ageName = el('div.r-age-name', { text: AGES[0].name });
    const ageClock = el('div.r-age-clock', { text: fmtTime(R.clock) });
    const ageDots = el('div.r-age-dots', null, ...AGES.map((a) => el('span', { style: { '--ac': a.color } })));
    const pauseBtn = el('button.icon-btn.r-pause', { 'aria-label': 'Pause', type: 'button' }, el('span.pause-glyph'));
    const domMe = el('b.r-dom-me', { text: '0' });
    const domEnemy = el('b.r-dom-enemy', { text: '0' });
    const domFill = el('div.r-dom-fill');
    const domBar = el('div.r-dom', { title: 'Dominion' }, domMe, el('div.r-dom-track', null, domFill, el('span.r-dom-mid')), domEnemy);
    const top = el('div.r-top', null,
      el('div.r-enemy', null, enemy ? el('span.lvl-badge.red', { text: String(enemy.kingLevel) }) : null, el('span', { text: enemy ? enemy.name : `Horde · ${arena.name}` })),
      el('div.r-age', null, ageName, ageClock, ageDots),
      pauseBtn);
    const brickChip = el('div.r-chip.bricks', null, icon('ui_brick', '', 2), el('span', { text: '0' }));
    const popChip = el('div.r-chip.pop', null, icon('ui_pop', '', 2), el('span', { text: '0/0' }));
    const relicChip = el('div.r-chip.relics', { hidden: true }, el('span.r-relic-glyph'), el('span', { text: '0' }));
    const chips = el('div.r-chips', null, brickChip, popChip, relicChip);
    const minimap = el('canvas.r-minimap', { width: R.W * 2, height: R.H * 2, 'aria-label': 'Minimap' });
    const followBtn = el('button.r-follow', { type: 'button', hidden: true }, 'Back to hero');

    const use3d = profile.settings.graphics !== '2d' && webglAvailable();
    let canvas = el('canvas.r-canvas');
    const hudCanvas = use3d ? el('canvas.r-hud') : null;
    const banner = el('div.b-banner.r-banner');
    const coach = el('div.b-coach', { hidden: true });
    const popover = el('div.b-popover', { hidden: true });
    const joyBase = el('div.r-joy', { hidden: true }, el('div.r-joy-knob'));
    const feed = el('div.r-feed');
    const nightTag = el('div.r-night', { hidden: true }, 'NIGHT');
    const mapWrap = el('div.r-map', null, canvas, hudCanvas, joyBase, banner, coach, popover, feed, nightTag, chips, minimap, followBtn);

    // hero cluster (right) and village buttons (left)
    const heroDef = HEROES[me.heroId];
    const heroCv = el('canvas.hero-port', { width: 20, height: 22 });
    const heroHp = el('div.hero-hp-fill');
    const heroRespawn = el('div.hero-respawn', { hidden: true });
    const heroBox = el('button.hero-box.r-herobox', { type: 'button', 'aria-label': 'Hero' }, heroCv, el('div.hero-hp', null, heroHp), heroRespawn);
    const formBtn = el('button.hb-btn.form-btn', { type: 'button' }, el('span.hb-top', { text: 'FORM' }), el('span.hb-cost'));
    const spellBtns = heroDef.spells.map((s, i) => el('button.hb-btn.spell-btn', { type: 'button', 'aria-label': s.name, dataset: { i: String(i) } },
      icon(SPELL_ICON[s.id] || 'spell_spark', 'hb-icon', 2), el('span.hb-cd'), el('span.hb-lock', { text: `F${s.form}` })));
    const gadgetBtn = me.gadgetId
      ? el('button.hb-btn.gadget-btn', { type: 'button', 'aria-label': GADGETS[me.gadgetId].name }, icon(`gadget_${me.gadgetId}`, 'hb-icon', 2), el('span.hb-cd'))
      : null;
    const heroCluster = el('div.r-actions', null, heroBox, formBtn, ...spellBtns, gadgetBtn);
    const buildBtn = el('button.r-vbtn.build', { type: 'button', 'aria-label': 'Build' }, icon('ui_hammer', '', 2), el('span', { text: 'BUILD' }));
    const hornBtn = el('button.r-vbtn.horn', { type: 'button', 'aria-label': 'War horn' }, icon('ui_shield', '', 2), el('span', { text: 'GUARD' }));
    const emoteBtn = el('button.r-vbtn.emote', { type: 'button', 'aria-label': 'Emotes' }, icon('emote_thumbs', '', 1));
    const village = el('div.r-village', null, buildBtn, hornBtn, enemy ? emoteBtn : null);

    // card tray
    const nextImg = el('img.next-art', { alt: '' });
    const nextBox = el('div.next-card', null, el('small', { text: 'NEXT' }), nextImg);
    const cardEls = [0, 1, 2, 3].map((i) => {
      const fill = el('div.hc-fill');
      const node = el('button.hand-card', { type: 'button', dataset: { slot: String(i) } },
        el('img.hc-art', { alt: '', draggable: 'false' }), el('div.hc-cost.faith', null, el('span')), fill);
      return { node, img: node.querySelector('img'), cost: node.querySelector('.hc-cost span'), fill, id: null };
    });
    const hand = el('div.hand', null, nextBox, ...cardEls.map((c) => c.node));
    const faithSegs = Array.from({ length: FAITH_MAX }, () => el('div.ex-seg', null, el('div.ex-fill')));
    const faithNum = el('div.ex-num', { text: '5' });
    const faithRate = el('div.r-faith-rate', { text: '' });
    const faithBar = el('div.elixir-bar.faith', null, faithNum, el('div.ex-segs', null, ...faithSegs), faithRate);
    // build tray
    const buildItems = BUILD_MENU.map((id) => {
      const def = STRUCTURES[id];
      const node = el('button.r-build-item', { type: 'button', dataset: { id } },
        icon(BUILD_ICON[id], 'r-build-icon', 1), el('span.r-build-name', { text: def.name }), el('span.r-build-cost', null, icon('ui_brick', '', 1), String(def.cost)));
      return { id, node };
    });
    const buildHint = el('div.r-build-hint', { text: 'Pick a building, then tap inside your borders.' });
    const confirmBtn = el('button.btn.btn-gold.r-confirm', { type: 'button', hidden: true }, '✓ Build');
    const cancelBtn = el('button.btn.btn-ghost.r-cancel', { type: 'button' }, 'Done');
    const buildTray = el('div.r-build', { hidden: true }, el('div.r-build-row', null, ...buildItems.map((b) => b.node)), el('div.r-build-foot', null, buildHint, confirmBtn, cancelBtn));
    const tray = el('div.r-tray', null, hand, faithBar);
    const bottom = el('div.r-bottom', null, el('div.r-controls', null, village, heroCluster), tray, buildTray);
    const screen = el('div.realm', null, top, domBar, mapWrap, bottom);
    if (!enemy) domBar.hidden = true;
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
    let zoomTiles = clamp(profile.settings.realmZoom || (use3d ? 14 : 13), 8, 26);
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
    const pointers = new Map(); // canvas pointers
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
      const p = R.players[0];
      const valid = !!pos && p.elixir >= card.cost;
      const u = card.unit;
      const b = card.building;
      return {
        cardId,
        pos: pos || { x: wx, y: wy },
        valid,
        isSpell: card.type === 'spell',
        radius: card.spell?.radius || 0,
        sprite: u ? (u.special?.builder ? 'villager' : u.sprite) : b ? b.sprite : card.spell?.kind === 'wall' ? 'wall' : null,
        count: u ? (u.special?.builder ? 2 : u.count || 1) : card.spell?.kind === 'wall' ? 5 : 1,
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
      hidePopover();
    };
    const flashFaith = () => {
      faithBar.classList.remove('shake');
      void faithBar.offsetWidth;
      faithBar.classList.add('shake');
    };
    const tryCast = (slot, wx, wy) => {
      const res = R.playCard(0, slot, wx, wy);
      if (!res.ok) {
        if (res.reason === 'elixir') flashFaith();
        else if (res.reason === 'placement') app.toast('Summon inside your borders or near your hero', 'bad', 1200);
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
        // nudge the camera when dragging near the top edge
        const l = local(ev);
        drag.edge = w.inside && l.y < 60 ? -1 : 0;
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
        // second finger: pinch (cancel joystick/pan from the first one)
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), tiles: zoomTiles };
        if (joy) endJoy();
        pan = null;
        return;
      }
      if (pointers.size > 2) return;
      const w = renderer.toWorld(l.x, l.y);
      if (selected >= 0) {
        if (tryCast(selected, w.x, w.y)) return;
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
        zoomTiles = clamp(pinch.tiles * (pinch.d / Math.max(20, d)), 8, 26);
        renderer.setZoomTiles(zoomTiles);
        return;
      }
      if (joy && joy.id === ev.pointerId) {
        let dx = l.x - joy.ox;
        let dy = l.y - joy.oy;
        const m = Math.hypot(dx, dy);
        if (m > JOY_R) {
          // drag the base along so the stick never feels stuck
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
        if (pan.moved && !(buildMode && pan.ghost)) {
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
      if (buildMode && buildSel && ev.pointerType === 'mouse' && !ui.build?.locked) placeGhost(renderer.toWorld(l.x, l.y), false);
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
      zoomTiles = clamp(zoomTiles * (ev.deltaY > 0 ? 1.1 : 0.9), 8, 26);
      renderer.setZoomTiles(zoomTiles);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

    function endJoy() {
      joy = null;
      joyBase.hidden = true;
      R.heroJoy(0, null);
    }

    function tapIsland(w) {
      // own watchtower → element picker; enemy → focus; ground → walk there
      const tower = R.structures.find((s) => s.alive && s.team === 0 && s.struct === 'tower' && s.built >= 1 && w.x >= s.fp.x0 - 0.2 && w.x <= s.fp.x0 + s.fp.w + 0.2 && w.y >= s.fp.y0 - 1.5 && w.y <= s.fp.y0 + s.fp.h + 0.2);
      if (tower) {
        showTowerPopover(tower);
        return;
      }
      hidePopover();
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
        app.toast('Your hero is respawning…', 'info', 900);
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
        hidePopover();
        if (joy) endJoy();
        ui.showTerritory = true;
      } else {
        buildSel = null;
        ui.build = null;
        confirmBtn.hidden = true;
        buildItems.forEach((b) => b.node.classList.remove('selected'));
        buildHint.textContent = 'Pick a building, then tap inside your borders.';
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
        const def = STRUCTURES[buildSel];
        buildHint.textContent = def.desc;
        // drop a ghost near the middle of the screen to start with
        const c = renderer.toWorld(renderer.layout.cssW / 2, renderer.layout.cssH * 0.45);
        placeGhost(c, false);
        app.sfx('card_select', { volume: 0.5 });
      } else buildHint.textContent = 'Pick a building, then tap inside your borders.';
    }));
    function placeGhost(w, fromTap) {
      if (!buildSel) return;
      const def = STRUCTURES[buildSel];
      const x0 = Math.round(w.x - def.w / 2);
      const y0 = Math.round(w.y - def.h / 2);
      // tapping the ghost again (or the same spot) confirms
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
      // walls are placed in runs: keep the tool selected; other buildings clear the ghost
      ui.build = null;
      confirmBtn.hidden = true;
      if (b.id === 'wall') placeGhost({ x: b.x0 + 1.5, y: b.y0 + 0.5 }, false);
    }
    confirmBtn.addEventListener('click', confirmBuild);

    hornBtn.addEventListener('click', () => {
      const p = R.players[0];
      R.setStance(0, p.stance === 'charge' ? 'guard' : 'charge');
      haptic('medium');
      app.toast(p.stance === 'charge' ? 'CHARGE! Warriors march on the enemy' : 'Warriors guard your borders', 'info', 1300);
    });

    // tower element popover
    function showTowerPopover(tower) {
      ui.selectedStructure = tower;
      clear(popover);
      const p = R.players[0];
      if (tower.element) {
        popover.append(el('div.pop-title', { text: `${ELEMENTS[tower.element].name} Watchtower` }), el('p.pop-text', { text: elementText(tower.element) }));
      } else {
        popover.append(el('div.pop-title', null, 'Give this Watchtower an element ', el('span.pop-cost', null, icon('ui_brick', '', 2), String(ELEMENT_COST))));
        const row = el('div.pop-row');
        for (const elId of ['fire', 'ice', 'lightning', 'earth']) {
          const b = el('button.elem-btn', { type: 'button', disabled: p.bricks < ELEMENT_COST, style: { '--ec': ELEMENTS[elId].color } },
            icon(`elem_${elId}`, '', 3), el('span', { text: ELEMENTS[elId].name }));
          b.addEventListener('click', () => {
            if (R.elementTower(0, tower, elId)) {
              haptic('medium');
              hidePopover();
            } else app.toast(`Needs ${ELEMENT_COST} bricks`, 'bad', 1000);
          });
          row.appendChild(b);
        }
        popover.append(row, el('p.pop-text', { text: p.bricks < ELEMENT_COST ? `You have ${p.bricks} bricks. Villagers mine more.` : 'Fire burns, Ice slows, Lightning chains, Earth adds 30% HP and stuns.' }));
      }
      popover.appendChild(el('button.pop-close', { type: 'button', onclick: hidePopover, 'aria-label': 'Close' }, '✕'));
      const pos = renderer.toCss(tower.x, tower.fp.y0);
      popover.style.left = `${clamp(pos.x - 120, 6, mapWrap.clientWidth - 246)}px`;
      popover.style.top = `${clamp(pos.y - 150, 60, mapWrap.clientHeight - 150)}px`;
      popover.hidden = false;
      app.sfx('ui_click');
    }
    function hidePopover() {
      popover.hidden = true;
      ui.selectedStructure = null;
    }
    const elementText = (e) => ({ fire: 'Arrows set enemies on fire.', ice: 'Arrows slow enemies by 30%.', lightning: 'Shots chain to more enemies.', earth: '+30% HP and shots briefly stun.' })[e];

    // hero buttons
    formBtn.addEventListener('click', () => {
      if (R.heroUpgrade(0)) haptic('medium');
      else {
        const h = R.players[0].hero;
        const cost = h ? formUpgradeCost(h) : null;
        app.toast(cost == null ? 'Your hero is at max form!' : !h?.alive ? 'Wait for your hero to respawn' : `Needs ${cost} bricks`, 'bad', 1000);
      }
    });
    spellBtns.forEach((b, i) => b.addEventListener('click', () => {
      const h = R.players[0].hero;
      if (!h?.alive) return;
      const s = h.def.spells[i];
      if (h.form < s.form) {
        app.toast(`Upgrade to form ${s.form} to unlock ${s.name}`, 'info', 1200);
        return;
      }
      if (R.heroSpell(0, i)) haptic('medium');
    }));
    gadgetBtn?.addEventListener('click', () => {
      if (R.heroGadget(0)) haptic('light');
    });
    heroBox.addEventListener('click', () => {
      cam.free = false;
      followBtn.hidden = true;
      const h = R.players[0].hero;
      if (h) app.toast(`${heroDef.name} · ${FORM_NAMES[h.form - 1]}${me.petId ? ' · ' + PETS[me.petId].name : ''}`, 'info', 1300);
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
    // minimap: tap to look somewhere
    const lookAtMinimap = (ev) => {
      const r = minimap.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * R.W;
      const y = ((ev.clientY - r.top) / r.height) * R.H;
      cam.free = true;
      cam.tx = x;
      cam.ty = y;
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
      else if (k === 'q') spellBtns[0]?.click();
      else if (k === 'e') spellBtns[1]?.click();
      else if (k === 'f') gadgetBtn?.click();
      else if (k === 'r') formBtn.click();
      else if (k === 'b') setBuildMode(!buildMode);
      else if (k === 'g' || k === 'h') hornBtn.click();
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
        el('button.btn.btn-ghost', { type: 'button', onclick: () => {
          const muted = !getProfile().settings.muted;
          setSetting('muted', muted);
          app.toast(muted ? 'Sound off' : 'Sound on');
        } }, s.muted ? 'Sound: Off' : 'Sound: On'),
        el('p.pause-help', { text: 'Left side: drag to move. Tap the island to walk or attack. Drag cards to cast. Pinch to zoom.' }),
        el('button.btn.btn-red', { type: 'button', onclick: async () => {
          close();
          R.pause(true);
          const yes = await app.confirm({ title: mode === 'horde' ? 'Abandon the island?' : 'Surrender?', text: mode === 'clash' ? 'You will lose this match and its trophies.' : '', yes: mode === 'horde' ? 'Abandon' : 'Surrender', danger: true });
          if (yes) R.finish(1, 'surrender');
          R.pause(false);
        } }, mode === 'horde' ? 'Abandon' : 'Surrender'));
      const close = app.modal(body, { title: 'Paused', onClose: () => R.pause(false) });
    };
    pauseBtn.addEventListener('click', openPause);
    app.onHidden = () => {
      if (!ended && R.phase !== 'ended') openPause();
    };

    // ───────────── events → HUD ─────────────
    let coachTimer = 0;
    const showBanner = (text, kind = '', sub = '') => {
      banner.className = `b-banner r-banner show ${kind}`;
      clear(banner);
      banner.append(el('span', { text }));
      if (sub) banner.append(el('small', { text: sub }));
      clearTimeout(showBanner.t);
      showBanner.t = setTimeout(() => (banner.className = 'b-banner r-banner'), kind === 'count' ? 700 : 2200);
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
      R.on('age', ({ idx }) => {
        ageDots.querySelectorAll('span').forEach((s, i) => s.classList.toggle('on', i <= idx));
        screen.dataset.age = AGES[idx].id;
        haptic('medium');
      }),
      R.on('night', () => {
        nightTag.hidden = false;
        if (mode !== 'horde') note('Night falls. Monster nests raid!', 'bad');
      }),
      R.on('day', () => {
        nightTag.hidden = true;
      }),
      R.on('crown', ({ team, tower }) => {
        if (tower.struct !== 'tower') return;
        note(team === 0 ? 'Enemy Watchtower destroyed!' : 'We lost a Watchtower', team === 0 ? 'good' : 'bad');
        haptic('heavy');
      }),
      R.on('built', ({ team, s }) => team === 0 && note(`${STRUCTURES[s.struct]?.name || 'Building'} finished`, 'good')),
      R.on('structureLost', ({ team, s }) => {
        if (team === 0 && s.built >= 1 && !s.isWall) note(`Our ${STRUCTURES[s.struct]?.name || 'building'} was destroyed`, 'bad');
        else if (team === 1 && s.built >= 1 && !s.isWall) note(`Destroyed an enemy ${STRUCTURES[s.struct]?.name || 'building'}`, 'good');
      }),
      R.on('nestCleared', ({ team }) => note(team === 0 ? 'Nest cleared! A Red Brick appeared' : team === 1 ? 'The rival cleared a nest' : 'A nest fell', team === 0 ? 'good' : 'info')),
      R.on('relic', ({ team, relic }) => {
        if (team === 0) {
          showBanner(relic.name.toUpperCase(), 'form', relic.desc);
          haptic('heavy');
        } else note(`Rival found a Red Brick: ${relic.name}`, 'bad');
      }),
      R.on('shrine', ({ team }) => {
        note(team === 0 ? 'The Shrine is ours! +Faith' : 'The rival took the Shrine', team === 0 ? 'good' : 'bad');
        if (team === 0) haptic('medium');
      }),
      R.on('form', ({ team, form }) => team === 0 && showBanner(`${FORM_NAMES[form - 1].toUpperCase()}!`, 'form')),
      R.on('stance', ({ team, stance }) => team === 1 && stance === 'charge' && note('The rival sounds the war horn!', 'bad')),
      R.on('disaster', ({ kind }) => note(kind === 'meteor' ? 'Meteor incoming!' : kind === 'storm' ? 'Lightning storm!' : 'Earthquake!', 'bad')),
      R.on('depositEmpty', () => R.deposits.every((d) => d.amount <= 0 || R.tileOwner(d.x, d.y) !== 0) && note('Home deposits are running dry. Build an Outpost!', 'info')),
      R.on('underAttack', ({ team, s }) => {
        if (team !== 0) return;
        renderer.ping(s.x, s.y);
        const onScreen = (() => {
          const p = renderer.toCss(s.x, s.y);
          return p.x > 0 && p.y > 0 && p.x < renderer.layout.cssW && p.y < renderer.layout.cssH;
        })();
        if (!onScreen) {
          note(`${s.struct === 'keep' ? 'Our Keep' : `A ${STRUCTURES[s.struct]?.name || 'building'}`} is under attack!`, 'bad');
          app.sfx('raid', { volume: 0.35 });
        }
      }),
      R.on('raid', () => {
        for (const n of R.nests) if (n.alive) renderer.ping(n.x, n.y);
      }),
      R.on('heroDeath', ({ team }) => note(team === 0 ? 'Your hero fell. Respawning at the Keep' : 'Rival hero defeated! +20 bricks', team === 0 ? 'bad' : 'good')),
      R.on('coach', (c) => {
        coach.hidden = !c;
        document.querySelectorAll('.coach-focus').forEach((n) => n.classList.remove('coach-focus'));
        if (!c) return;
        clear(coach);
        coach.classList.remove('fade');
        coach.append(el('div.coach-step', { text: `Tip ${c.step + 1}/${c.total}` }), el('p', { text: c.text }));
        clearTimeout(coachTimer);
        coachTimer = setTimeout(() => coach.classList.add('fade'), 9000);
        const focusMap = { cards: hand, faith: faithBar, form: formBtn, spell: spellBtns[0], build: buildBtn, horn: hornBtn, map: mapWrap, minimap };
        focusMap[c.focus]?.classList.add('coach-focus');
      }),
      R.on('end', (r) => onEnd(r)),
    ];

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
      acc += dt;
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
      let tx = cam.tx;
      let ty = cam.ty;
      if (!cam.free) {
        const anchor = h && h.alive ? h : R.players[0].keep;
        if (anchor) {
          const lead = h?.alive && h.moving ? 1.2 : 0;
          tx = anchor.x + Math.cos(h?.aim || 0) * lead * 0.5;
          ty = anchor.y - 1 + Math.sin(h?.aim || 0) * lead * 0.5;
        }
      }
      const k = Math.min(1, dt * (cam.free ? 10 : 6));
      if (!(pan && pan.moved)) {
        c.x += (tx - c.x) * k;
        c.y += (ty - c.y) * k;
      }
    }

    const hudCache = {};
    function setText(node, key, v) {
      if (hudCache[key] === v) return;
      hudCache[key] = v;
      node.textContent = v;
    }
    let portT = 0;
    function updateHud(dt) {
      const p = R.players[0];
      const e = R.players[1];
      // clock & age
      const age = AGES[R.ageIdx];
      setText(ageName, 'age', mode === 'horde' ? `Night ${Math.max(1, R.horde?.night || 0)}` : age.name);
      setText(ageClock, 'clock', mode === 'horde' ? fmtTime(R.elapsed) : fmtTime(R.clock));
      ageClock.classList.toggle('hot', mode !== 'horde' && R.clock <= 20);
      // dominion
      if (e) {
        const a = R.dominion[0];
        const b = R.dominion[1];
        setText(domMe, 'dm', String(a));
        setText(domEnemy, 'de', String(b));
        const f = a + b > 0 ? a / (a + b) : 0.5;
        if (hudCache.domf !== f) {
          hudCache.domf = f;
          domFill.style.transform = `scaleX(${f})`;
        }
      }
      setText(brickChip.lastChild, 'bricks', String(p.bricks));
      setText(popChip.lastChild, 'pop', `${p.pop}/${p.popCap}`);
      popChip.classList.toggle('full', p.pop >= p.popCap);
      if (p.relics.length) {
        relicChip.hidden = false;
        setText(relicChip.lastChild, 'relics', String(p.relics.length));
        relicChip.title = p.relics.map((id) => RELICS.find((r) => r.id === id)?.name).join(', ');
      }
      // faith
      const ex = p.elixir;
      setText(faithNum, 'ex', String(Math.floor(ex)));
      setText(faithRate, 'rate', `${p.faithRate.toFixed(2)}/s`);
      for (let i = 0; i < FAITH_MAX; i++) {
        const v = clamp(ex - i, 0, 1);
        if (hudCache['seg' + i] !== v) {
          hudCache['seg' + i] = v;
          faithSegs[i].firstChild.style.transform = `scaleX(${v})`;
          faithSegs[i].classList.toggle('full', v >= 1);
        }
      }
      faithBar.classList.toggle('x2', R.ageIdx >= 3);
      // hand
      for (let i = 0; i < 4; i++) {
        const c = cardEls[i];
        const id = p.hand[i];
        if (c.id !== id) {
          c.id = id;
          c.img.src = cardArtURL(id);
          c.cost.textContent = String(CARDS[id].cost);
          c.node.className = `hand-card r-${CARDS[id].rarity}${i === selected ? ' selected' : ''}`;
          c.node.setAttribute('aria-label', `${CARDS[id].name}, ${CARDS[id].cost} Faith`);
          c.node.classList.add('cycled');
          setTimeout(() => c.node.classList.remove('cycled'), 250);
        }
        const cost = CARDS[id].cost;
        const ready = ex >= cost;
        c.node.classList.toggle('poor', !ready);
        const frac = ready ? 0 : 1 - ex / cost;
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
      // build tray affordability
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
      // stance
      const charge = p.stance === 'charge';
      if (hudCache.stance !== p.stance) {
        hudCache.stance = p.stance;
        hornBtn.classList.toggle('on', charge);
        clear(hornBtn);
        hornBtn.append(icon(charge ? 'ui_horn' : 'ui_shield', '', 2), el('span', { text: charge ? 'CHARGE' : 'GUARD' }));
        hornBtn.append(el('i.r-wcount', { text: String(p.warriors) }));
      }
      setText(hornBtn.lastChild, 'warriors', String(p.warriors));
      // hero
      const h = p.hero;
      const alive = h && h.alive;
      heroHp.style.transform = `scaleX(${alive ? clamp(h.hp / h.maxHp, 0, 1) : 0})`;
      heroRespawn.hidden = !!alive;
      if (!alive) setText(heroRespawn, 'resp', String(Math.max(1, Math.ceil(p.heroRespawnT))));
      const cost = h ? formUpgradeCost(h) : null;
      setText(formBtn.lastChild, 'formcost', cost == null ? 'MAX' : `${cost}`);
      formBtn.classList.toggle('ready', !!alive && cost != null && p.bricks >= cost);
      formBtn.classList.toggle('maxed', cost == null);
      formBtn.firstChild.textContent = h ? `FORM ${h.form}` : 'FORM';
      spellBtns.forEach((b, i) => {
        const s = heroDef.spells[i];
        const locked = !h || h.form < s.form;
        b.classList.toggle('locked', locked);
        const cd = h ? Math.max(0, h.spellCd[i]) : 0;
        b.classList.toggle('ready', !!alive && !locked && spellReady(h, i));
        setText(b.querySelector('.hb-cd'), 'scd' + i, !locked && cd > 0 ? String(Math.ceil(cd)) : '');
      });
      if (gadgetBtn) {
        const cd = h ? Math.max(0, h.gadgetCd) : 0;
        gadgetBtn.classList.toggle('ready', !!alive && gadgetReady(h));
        setText(gadgetBtn.querySelector('.hb-cd'), 'gcd', cd > 0 ? String(Math.ceil(cd)) : '');
      }
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
      if (ui.selectedStructure && !ui.selectedStructure.alive) hidePopover();
    }

    // ───────────── results ─────────────
    function onEnd(r) {
      ended = true;
      clearCardSel();
      if (buildMode) setBuildMode(false);
      if (joy) endJoy();
      hidePopover();
      coach.hidden = true;
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
          towers: stats.towers, bricks: stats.bricks, forms: stats.forms, elements: stats.elements,
          built: stats.built, relics: stats.relics.length, nests: stats.nests, realmBattles: mode === 'clash' ? 1 : 0,
        },
        mode: mode === 'clash' ? 'realm' : mode === 'horde' ? 'horde' : 'tutorial',
        wave: mode === 'horde' ? R.horde?.night || 0 : 0,
        goldBonus: petBonus + stats.goldBonus,
      });
      app.sfx(mode === 'horde' ? 'defeat' : draw ? 'draw' : win ? 'victory' : 'defeat');
      setTimeout(() => showResults(r, outcome, res, stats), 1800);
    }

    function showResults(r, outcome, res, stats) {
      const nights = R.horde?.night || 0;
      const title = mode === 'horde' ? `${nights} NIGHT${nights === 1 ? '' : 'S'}` : mode === 'training' ? 'TRAINING COMPLETE' : outcome === 'win' ? 'VICTORY!' : outcome === 'draw' ? 'DRAW' : 'DEFEAT';
      const why = mode === 'horde' ? 'Your Keep fell to the horde.'
        : r.reason === 'keep' ? (outcome === 'win' ? 'You toppled the rival Keep!' : 'Your Keep was destroyed.')
          : r.reason === 'surrender' ? 'You surrendered.'
            : `Dominion ${r.dominion[0]} vs ${r.dominion[1]} when the Age of Chaos ended.`;
      const crownRow = mode === 'horde' ? null : el('div.res-crowns', null, ...[0, 1, 2].map((i) => el(`span.crown.big${i < R.players[0].crowns ? '.on' : ''}`, { style: { animationDelay: `${0.25 + i * 0.25}s` } })));
      const goldVal = el('span', { text: '0' });
      const rows = el('div.res-rows', null,
        mode === 'clash' ? el('div.res-row', null, icon('ui_trophy', '', 2), el('span', { text: 'Trophies' }), el('b', { class: res.trophyDelta >= 0 ? 'good' : 'bad', text: `${res.trophyDelta >= 0 ? '+' : ''}${res.trophyDelta}` })) : null,
        mode === 'horde' ? el('div.res-row', null, icon('ui_trophy', '', 2), el('span', { text: 'Best' }), el('b', { text: `${getProfile().stats.bestNights || nights} nights` })) : null,
        el('div.res-row', null, icon('ui_gold', '', 2), el('span', { text: 'Gold' }), el('b', null, '+', goldVal)),
        el('div.res-row', null, icon('ui_xp', '', 2), el('span', { text: 'Experience' }), el('b', { text: `+${res.xp}` })),
        el('div.res-row.dim', null, icon('ui_hammer', '', 2), el('span', { text: 'Buildings finished' }), el('b', { text: String(stats.built) })),
        el('div.res-row.dim', null, icon('ui_sword', '', 2), el('span', { text: 'Enemies defeated' }), el('b', { text: String(stats.kills) })),
        el('div.res-row.dim', null, icon('ui_brick', '', 2), el('span', { text: 'Bricks gathered' }), el('b', { text: String(stats.bricks) })),
        stats.relics.length ? el('div.res-row.dim', null, el('span.r-relic-glyph'), el('span', { text: 'Red Bricks' }), el('b', { text: String(stats.relics.length) })) : null,
        res.levelUps ? el('div.res-banner', { text: `KING LEVEL ${res.kingLevel}!` }) : null,
        res.newArena != null ? el('div.res-banner.arena', { text: `NEW REALM: ${ARENAS[res.newArena].name}` }) : null);
      const actions = el('div.res-actions');
      const wonDrop = outcome === 'win' || mode === 'training' || (mode === 'horde' && nights >= 3);
      if (wonDrop) {
        const tier = mode === 'horde' ? (nights >= 10 ? 2 : nights >= 6 ? 1 : 0) : r.reason === 'keep' ? 1 : 0;
        actions.appendChild(el('button.btn.btn-gold.btn-big.pulse', { type: 'button', onclick: () => app.go('lucky', { tier, from: 'battle' }) }, 'Open Lucky Drop'));
        actions.appendChild(el('button.btn.btn-ghost', { type: 'button', onclick: () => app.go('home') }, 'Skip'));
      } else {
        actions.appendChild(el('button.btn.btn-gold.btn-big', { type: 'button', onclick: () => app.go('home') }, 'Continue'));
        if (mode !== 'training') actions.appendChild(el('button.btn.btn-ghost', { type: 'button', onclick: () => app.go('realm', { mode }) }, mode === 'horde' ? 'Try again' : 'Play again'));
      }
      const panel = el(`div.results.${outcome}`, null, el('h1.res-title', { text: title }), el('p.res-why', { text: why }), crownRow, rows, actions);
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
      clearTimeout(coachTimer);
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
