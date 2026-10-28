// The battle screen: canvas + HUD + touch input + results.

import { el, clear, fmtTime, clamp, dist2, haptic } from '../core/util.js';
import { createRng } from '../core/rng.js';
import { Battle, STEP } from '../battle/battle.js';
import { BattleRenderer } from '../battle/render.js';
import { AIController } from '../battle/ai.js';
import { WaveDirector } from '../battle/waves.js';
import { Tutorial } from '../battle/tutorial.js';
import { TOWER_ELEMENT_COST, ELIXIR_MAX } from '../battle/constants.js';
import { formUpgradeCost, spellReady, gadgetReady } from '../battle/hero.js';
import { CARDS } from '../data/cards.js';
import { ARENAS } from '../data/arenas.js';
import { ELEMENTS, HEROES, FORM_NAMES } from '../data/heroes.js';
import { GADGETS } from '../data/gadgets.js';
import { EMOTES } from '../data/emotes.js';
import { PETS } from '../data/gadgets.js';
import { WEAPONS } from '../data/weapons.js';
import {
  getProfile, currentDeck, cardLevel, weaponLevel, heroSkin, arenaIndex, applyBattleResult, setSetting,
} from '../core/profile.js';
import { cardArtURL, icon, countUp } from './components.js';
import { drawHero } from '../art/sprite-cache.js';

export const SPELL_ICON = {
  firespin: 'spell_meteor', dragonbreath: 'dragon', stoneskin: 'elem_earth', earthsplitter: 'spell_quake',
  chainspark: 'spell_spark', thunderstorm: 'spell_lightning', frostnova: 'spell_blizzard', iceage: 'elem_ice',
  bonearmy: 'skeleton', soulharvest: 'spell_plague',
};
const AI_WEAPONS = ['rifle', 'pistols', 'shotgun', 'brickblaster', 'zapper', 'rocketlauncher', 'railsniper', 'minigun'];
const AI_PETS = ['cat', 'cat', 'slime', 'drone', 'slime', 'dragonpup', 'minigolem', 'dragonpup'];

export function playerSetup() {
  const p = getProfile();
  const deck = currentDeck().slice();
  return {
    name: p.name,
    deck,
    cardLevels: Object.fromEntries(deck.map((id) => [id, cardLevel(id)])),
    kingLevel: p.kingLevel,
    heroId: p.heroId,
    weaponId: p.weaponId,
    weaponLevel: weaponLevel(p.weaponId),
    gadgetId: p.gadgetId,
    petId: p.petId,
    skin: heroSkin(p.heroId),
  };
}

export function enemySetup(arenaIdx, rng) {
  const p = getProfile();
  const a = ARENAS[arenaIdx];
  const deck = rng.pick(a.ai.decks);
  const myDeck = currentDeck();
  const avg = myDeck.reduce((s, id) => s + cardLevel(id), 0) / myDeck.length;
  const lvl = clamp(Math.round(avg + (arenaIdx >= 3 ? 0.5 : 0)), 1, a.ai.cardLevel);
  return {
    name: a.ai.name,
    deck,
    cardLevels: Object.fromEntries(deck.map((id) => [id, lvl])),
    kingLevel: clamp(p.kingLevel + (arenaIdx >= 4 ? 1 : 0), 1, a.ai.kingLevel + 1),
    heroId: a.ai.hero,
    weaponId: AI_WEAPONS[arenaIdx] || 'rifle',
    weaponLevel: Math.max(1, arenaIdx),
    gadgetId: arenaIdx >= 2 ? 'shield' : 'medkit',
    petId: AI_PETS[arenaIdx] || 'cat',
    skin: null,
    isAI: true,
  };
}

export const battleScreen = {
  mount(root, app, params = {}) {
    const mode = params.mode || 'duel';
    const profile = getProfile();
    const arenaIdx = mode === 'tutorial' ? 0 : mode === 'waves' ? Math.min(arenaIndex(), 2) : arenaIndex();
    const arena = ARENAS[arenaIdx];
    const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
    const rng = createRng(seed);
    const me = playerSetup();
    let enemy;
    if (mode === 'waves') enemy = { name: 'Monster Horde', deck: [], cardLevels: {}, kingLevel: 1, heroId: null };
    else if (mode === 'tutorial') enemy = { ...enemySetup(0, rng), name: 'Training Dummy', deck: ['knight', 'archers', 'skeletons', 'gunners', 'bomber', 'volley', 'bricktower', 'giant'], kingLevel: 1, cardLevels: {}, petId: null, gadgetId: null };
    else enemy = enemySetup(arenaIdx, rng);

    const B = new Battle({ mode, arena, seed, players: [me, enemy], audio: app.audio, settings: { dmgNumbers: profile.settings.dmgNumbers, particles: profile.settings.particles } });
    if (mode === 'duel') {
      const easyStart = profile.stats.battles < 3;
      B.ai = [new AIController(B, 1, easyStart ? 'easy' : arena.ai.difficulty)];
    } else if (mode === 'tutorial') {
      const ai = new AIController(B, 1, 'tutorial');
      B.ai = [ai];
      B.tutorial = new Tutorial(B, ai);
      // the dummy towers are softer so the lesson ends in good time
      for (const t of B.towers) if (t.team === 1) {
        t.maxHp *= 0.6;
        t.hp = t.maxHp;
        t.dmg *= 0.5;
      }
    } else if (mode === 'waves') {
      B.waves = new WaveDirector(B);
    }
    app.music(mode === 'waves' ? 'waves' : arena.music);

    // ───────────── DOM ─────────────
    const timerEl = el('div.b-timer', { text: '3:00' });
    const timerSub = el('div.b-timer-sub', { text: mode === 'waves' ? 'SURVIVE' : 'TIME LEFT' });
    const crownsEnemy = el('div.b-crowns.red');
    const crownsMe = el('div.b-crowns.blue');
    const pauseBtn = el('button.icon-btn.b-pause', { 'aria-label': 'Pause', type: 'button' }, el('span.pause-glyph'));
    const top = el('div.b-top', null,
      el('div.b-side.enemy', null,
        el('div.b-name', null, el('span.lvl-badge.red', { text: String(enemy.kingLevel) }), el('span', { text: enemy.name })),
        mode === 'waves' ? null : crownsEnemy),
      el('div.b-clock', null, timerEl, timerSub),
      el('div.b-side.me', null, mode === 'waves' ? null : crownsMe, pauseBtn));

    const canvas = el('canvas.b-canvas');
    const banner = el('div.b-banner');
    const coach = el('div.b-coach', { hidden: true });
    const popover = el('div.b-popover', { hidden: true });
    const arenaWrap = el('div.b-arena', null, canvas, banner, coach, popover);

    // hero bar
    const heroCv = el('canvas.hero-port', { width: 20, height: 22 });
    const heroHp = el('div.hero-hp-fill');
    const heroRespawn = el('div.hero-respawn', { hidden: true });
    const heroBox = el('button.hero-box', { type: 'button', 'aria-label': 'Hero' }, heroCv, el('div.hero-hp', null, heroHp), heroRespawn);
    const formBtn = el('button.hb-btn.form-btn', { type: 'button' }, el('span.hb-top', { text: 'FORM' }), el('span.hb-cost'));
    const heroDef = HEROES[me.heroId];
    const spellBtns = heroDef.spells.map((s, i) => el('button.hb-btn.spell-btn', { type: 'button', 'aria-label': s.name, dataset: { i: String(i) } },
      icon(SPELL_ICON[s.id] || 'spell_spark', 'hb-icon', 2), el('span.hb-cd'), el('span.hb-lock', { text: `F${s.form}` })));
    const gadgetBtn = me.gadgetId
      ? el('button.hb-btn.gadget-btn', { type: 'button', 'aria-label': GADGETS[me.gadgetId].name }, icon(`gadget_${me.gadgetId}`, 'hb-icon', 2), el('span.hb-cd'))
      : null;
    const emoteBtn = el('button.hb-btn.emote-btn', { type: 'button', 'aria-label': 'Emotes' }, icon('emote_thumbs', 'hb-icon', 1));
    const brickChip = el('div.brick-chip', null, icon('ui_brick', '', 2), el('span', { text: '0' }));
    const heroBar = el('div.hero-bar', null, heroBox, brickChip, formBtn, ...spellBtns, gadgetBtn, emoteBtn);

    // hand
    const nextImg = el('img.next-art', { alt: '' });
    const nextBox = el('div.next-card', null, el('small', { text: 'NEXT' }), nextImg);
    const cardEls = [0, 1, 2, 3].map((i) => {
      const fill = el('div.hc-fill');
      const node = el('button.hand-card', { type: 'button', dataset: { slot: String(i) } },
        el('img.hc-art', { alt: '', draggable: 'false' }), el('div.hc-cost', null, el('span')), fill);
      return { node, img: node.querySelector('img'), cost: node.querySelector('.hc-cost span'), fill, id: null };
    });
    const hand = el('div.hand', null, nextBox, ...cardEls.map((c) => c.node));
    const elixirSegs = Array.from({ length: ELIXIR_MAX }, () => el('div.ex-seg', null, el('div.ex-fill')));
    const elixirNum = el('div.ex-num', { text: '5' });
    const elixirBar = el('div.elixir-bar', null, elixirNum, el('div.ex-segs', null, ...elixirSegs));
    const bottom = el('div.b-bottom', null, heroBar, hand, elixirBar);
    const screen = el('div.battle', null, top, arenaWrap, bottom);
    root.appendChild(screen);

    const renderer = new BattleRenderer(B, canvas);
    if (globalThis.__BBR) globalThis.__BBR.battle = B;
    const fit = () => {
      const r = arenaWrap.getBoundingClientRect();
      renderer.resize(Math.max(100, r.width), Math.max(100, r.height));
    };
    const ro = new ResizeObserver(fit);
    ro.observe(arenaWrap);
    fit();

    // ───────────── state for input ─────────────
    const ui = { ghost: null, selectedTower: null };
    let selected = -1;
    let drag = null;
    let ended = false;

    const pointerToWorld = (ev) => {
      const r = canvas.getBoundingClientRect();
      return { ...renderer.toWorld(ev.clientX - r.left, ev.clientY - r.top), inside: ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom };
    };

    const ghostFor = (cardId, wx, wy) => {
      const card = CARDS[cardId];
      const pos = B.previewPlacement(0, cardId, wx, wy);
      const p = B.players[0];
      const valid = !!pos && p.elixir >= card.cost;
      const u = card.unit;
      const b = card.building;
      return {
        cardId,
        pos: pos || { x: wx, y: wy },
        valid,
        isSpell: card.type === 'spell',
        ownSide: !!card.spell?.ownSideOnly,
        radius: card.spell?.radius || (card.spell?.kind === 'wall' ? 0 : 0),
        sprite: u ? u.sprite : b ? b.sprite : card.spell?.kind === 'wall' ? 'wall' : null,
        count: u ? u.count || 1 : card.spell?.kind === 'wall' ? 5 : 1,
        range: b?.range || 0,
      };
    };

    const selectCard = (i) => {
      selected = selected === i ? -1 : i;
      cardEls.forEach((c, k) => c.node.classList.toggle('selected', k === selected));
      if (selected >= 0) app.sfx('card_select', { volume: 0.6 });
      hidePopover();
    };

    const tryDeploy = (slot, wx, wy) => {
      const res = B.playCard(0, slot, wx, wy);
      if (!res.ok) {
        if (res.reason === 'elixir') flashElixir();
        else if (res.reason === 'placement') app.toast("Can't deploy there", 'bad', 900);
        app.sfx('ui_error', { volume: 0.5 });
        return false;
      }
      haptic('light');
      selected = -1;
      cardEls.forEach((c) => c.node.classList.remove('selected'));
      return true;
    };

    const flashElixir = () => {
      elixirBar.classList.remove('shake');
      void elixirBar.offsetWidth;
      elixirBar.classList.add('shake');
    };

    // card drag & tap
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
          selected = slot;
          cardEls.forEach((cc, k) => cc.node.classList.toggle('selected', k === slot));
          c.node.classList.add('dragging');
        }
        if (!drag.moved) return;
        const w = pointerToWorld(ev);
        drag.over = w.inside;
        // lift the ghost a little above the finger so it stays visible
        ui.ghost = w.inside ? ghostFor(B.players[0].hand[slot], w.x, w.y - 0.8) : null;
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
        if (d.over && g) tryDeploy(slot, g.pos.x, g.pos.y);
        else {
          selected = -1;
          cardEls.forEach((cc) => cc.node.classList.remove('selected'));
        }
      };
      c.node.addEventListener('pointerup', end);
      c.node.addEventListener('pointercancel', (ev) => {
        if (drag && drag.id === ev.pointerId) {
          drag = null;
          ui.ghost = null;
          c.node.classList.remove('dragging');
        }
      });
    });

    // tapping the arena
    canvas.addEventListener('pointermove', (ev) => {
      if (selected >= 0 && ev.pointerType === 'mouse' && !drag) {
        const w = pointerToWorld(ev);
        ui.ghost = ghostFor(B.players[0].hand[selected], w.x, w.y);
      }
    });
    canvas.addEventListener('pointerleave', () => {
      if (!drag) ui.ghost = null;
    });
    canvas.addEventListener('pointerdown', (ev) => {
      if (ended || B.phase === 'countdown') return;
      ev.preventDefault();
      const w = pointerToWorld(ev);
      if (selected >= 0) {
        if (tryDeploy(selected, w.x, w.y)) ui.ghost = null;
        return;
      }
      // own princess tower → element picker
      const tower = B.towers.find((t) => t.alive && t.team === 0 && t.type === 'princess' && dist2(t.x, t.y, w.x, w.y) <= (t.r + 0.4) ** 2);
      if (tower) {
        showTowerPopover(tower);
        return;
      }
      hidePopover();
      // enemy under the finger → focus
      let target = null;
      let bd = Infinity;
      for (const e of B.entities) {
        if (!e.alive || e.team === 0 || e.untargetable) continue;
        const ey = e.flying ? e.y - 0.9 : e.y - (e.h || 1) * 0.4;
        const d = dist2(e.x, ey, w.x, w.y);
        const rr = (e.r + 0.5) ** 2;
        if (d < rr && d < bd) {
          bd = d;
          target = e;
        }
      }
      const hero = B.players[0].hero;
      if (!hero || !hero.alive) {
        app.toast('Your hero is respawning…', 'info', 900);
        return;
      }
      if (target) B.heroFocus(0, target);
      else B.heroMove(0, w.x, w.y);
      app.sfx('ui_click', { volume: 0.3, pitch: 1.3 });
    });

    // tower element popover
    function showTowerPopover(tower) {
      ui.selectedTower = tower;
      clear(popover);
      const p = B.players[0];
      if (tower.element) {
        popover.append(el('div.pop-title', { text: `${ELEMENTS[tower.element].name} tower` }), el('p.pop-text', { text: elementText(tower.element) }));
      } else {
        popover.append(el('div.pop-title', null, 'Give this tower an element ', el('span.pop-cost', null, icon('ui_brick', '', 2), String(TOWER_ELEMENT_COST))));
        const row = el('div.pop-row');
        for (const elId of ['fire', 'ice', 'lightning', 'earth']) {
          const b = el('button.elem-btn', { type: 'button', disabled: p.bricks < TOWER_ELEMENT_COST, style: { '--ec': ELEMENTS[elId].color } },
            icon(`elem_${elId}`, '', 3), el('span', { text: ELEMENTS[elId].name }));
          b.addEventListener('click', () => {
            if (B.elementTower(0, tower, elId)) {
              haptic('medium');
              hidePopover();
            } else app.toast(`Needs ${TOWER_ELEMENT_COST} bricks`, 'bad', 1000);
          });
          row.appendChild(b);
        }
        popover.append(row, el('p.pop-text', { text: p.bricks < TOWER_ELEMENT_COST ? `You have ${p.bricks} bricks. Builders and defeated enemies give more.` : 'Fire burns, Ice slows, Lightning chains, Earth adds 30% HP and stuns.' }));
      }
      popover.appendChild(el('button.pop-close', { type: 'button', onclick: hidePopover, 'aria-label': 'Close' }, '✕'));
      const pos = renderer.toCss(tower.x, tower.y);
      popover.style.left = `${clamp(pos.x - 120 + canvas.offsetLeft, 6, arenaWrap.clientWidth - 246)}px`;
      popover.style.top = `${clamp(pos.y - 170 + canvas.offsetTop, 6, arenaWrap.clientHeight - 150)}px`;
      popover.hidden = false;
      app.sfx('ui_click');
    }
    function hidePopover() {
      popover.hidden = true;
      ui.selectedTower = null;
    }
    const elementText = (e) => ({ fire: 'Shots set enemies on fire.', ice: 'Shots slow enemies by 30%.', lightning: 'Shots chain to two more enemies.', earth: '+30% HP and shots briefly stun.' })[e];

    // hero bar actions
    formBtn.addEventListener('click', () => {
      if (B.heroUpgrade(0)) haptic('medium');
      else {
        const h = B.players[0].hero;
        const cost = h ? formUpgradeCost(h) : null;
        app.toast(cost == null ? 'Your hero is at max form!' : !h?.alive ? 'Wait for your hero to respawn' : `Needs ${cost} bricks`, 'bad', 1000);
      }
    });
    spellBtns.forEach((b, i) => b.addEventListener('click', () => {
      const h = B.players[0].hero;
      if (!h?.alive) return;
      const s = h.def.spells[i];
      if (h.form < s.form) {
        app.toast(`Upgrade to form ${s.form} to unlock ${s.name}`, 'info', 1200);
        return;
      }
      if (B.heroSpell(0, i)) haptic('medium');
    }));
    gadgetBtn?.addEventListener('click', () => {
      if (B.heroGadget(0)) haptic('light');
    });
    heroBox.addEventListener('click', () => {
      const h = B.players[0].hero;
      if (!h) return;
      const w = WEAPONS[me.weaponId];
      app.toast(`${heroDef.name} · ${FORM_NAMES[h.form - 1]} · ${w.name}${me.petId ? ' · ' + PETS[me.petId].name : ''}`, 'info', 1800);
    });
    emoteBtn.addEventListener('click', () => {
      const row = el('div.emote-row', null, ...EMOTES.map((em) => el('button.emote-pick', { type: 'button', 'aria-label': em.name, onclick: () => {
        B.emote(0, em.id);
        close();
      } }, icon(`emote_${em.id}`, '', 2))));
      const close = app.modal(row, { title: 'Emote', className: 'emote-sheet' });
    });

    // keyboard shortcuts for desktop
    const onKey = (ev) => {
      if (ended) return;
      if (ev.key >= '1' && ev.key <= '4') selectCard(Number(ev.key) - 1);
      else if (ev.key === 'q' || ev.key === 'Q') spellBtns[0]?.click();
      else if (ev.key === 'e' || ev.key === 'E') spellBtns[1]?.click();
      else if (ev.key === 'r' || ev.key === 'R') gadgetBtn?.click();
      else if (ev.key === 'f' || ev.key === 'F') formBtn.click();
      else if (ev.key === 'Escape') {
        if (selected >= 0) selectCard(selected);
        else openPause();
      }
    };
    window.addEventListener('keydown', onKey);

    // pause
    const openPause = () => {
      if (ended) return;
      B.pause(true);
      const s = getProfile().settings;
      const body = el('div.pause', null,
        el('button.btn.btn-gold.btn-big', { type: 'button', onclick: () => close() }, 'Resume'),
        el('button.btn.btn-ghost', { type: 'button', onclick: () => {
          const muted = !getProfile().settings.muted;
          setSetting('muted', muted);
          app.toast(muted ? 'Sound off' : 'Sound on');
        } }, s.muted ? 'Sound: Off' : 'Sound: On'),
        el('button.btn.btn-red', { type: 'button', onclick: async () => {
          close();
          B.pause(true);
          const yes = await app.confirm({ title: mode === 'waves' ? 'End the siege?' : 'Surrender?', text: mode === 'duel' ? 'You will lose this battle and its trophies.' : '', yes: mode === 'waves' ? 'End it' : 'Surrender', danger: true });
          if (yes) {
            if (mode === 'waves') B.finish(1, 'surrender');
            else B.finish(1, 'surrender');
          }
          B.pause(false);
        } }, mode === 'waves' ? 'End Siege' : 'Surrender'));
      const close = app.modal(body, { title: 'Paused', onClose: () => B.pause(false) });
    };
    pauseBtn.addEventListener('click', openPause);
    app.onHidden = () => {
      if (!ended && B.phase !== 'ended') openPause();
    };

    // ───────────── battle events → HUD ─────────────
    let coachTimer = 0;
    const showBanner = (text, kind = '') => {
      banner.className = `b-banner show ${kind}`;
      banner.textContent = text;
      clearTimeout(showBanner.t);
      showBanner.t = setTimeout(() => (banner.className = 'b-banner'), kind === 'count' ? 700 : 1600);
    };
    const offs = [
      B.on('countdown', (n) => showBanner(String(n), 'count')),
      B.on('banner', ({ text, kind }) => showBanner(text, kind)),
      B.on('crown', ({ team }) => {
        if (mode !== 'waves') showBanner(team === 0 ? '+1 CROWN!' : 'TOWER LOST', team === 0 ? 'good' : 'bad');
        haptic('heavy');
      }),
      B.on('form', ({ team, form }) => team === 0 && showBanner(`${FORM_NAMES[form - 1].toUpperCase()}!`, 'form')),
      B.on('coach', (c) => {
        coach.hidden = !c;
        document.querySelectorAll('.coach-focus').forEach((n) => n.classList.remove('coach-focus'));
        if (!c) return;
        clear(coach);
        coach.classList.remove('fade');
        coach.append(el('div.coach-step', { text: `Tip ${c.step + 1}/${c.total}` }), el('p', { text: c.text }));
        clearTimeout(coachTimer);
        coachTimer = setTimeout(() => coach.classList.add('fade'), 8000);
        const focusMap = { cards: hand, elixir: elixirBar, form: formBtn, spell: spellBtns[0], arena: arenaWrap, tower: arenaWrap };
        focusMap[c.focus]?.classList.add('coach-focus');
      }),
      B.on('end', (r) => onEnd(r)),
    ];

    // ───────────── loop ─────────────
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      let dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (B.paused) dt = 0;
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 6) {
        B.step(STEP);
        acc -= STEP;
        n++;
      }
      if (n === 6) acc = 0;
      renderer.draw(ui, dt);
      updateHud(dt);
    };
    raf = requestAnimationFrame(frame);

    const hudCache = {};
    function setText(node, key, v) {
      if (hudCache[key] === v) return;
      hudCache[key] = v;
      node.textContent = v;
    }
    let portT = 0;
    function updateHud(dt) {
      const p = B.players[0];
      const e = B.players[1];
      // timer
      if (mode === 'waves') {
        setText(timerEl, 'timer', `WAVE ${B.waves.wave || 1}`);
        setText(timerSub, 'tsub', fmtTime(B.clock));
      } else if (mode === 'tutorial') {
        setText(timerEl, 'timer', 'TRAINING');
        setText(timerSub, 'tsub', fmtTime(B.clock));
      } else {
        setText(timerEl, 'timer', fmtTime(B.clock));
        setText(timerSub, 'tsub', B.overtime ? 'OVERTIME' : B.elixirMult > 1 ? '2x ELIXIR' : 'TIME LEFT');
        timerEl.classList.toggle('hot', B.overtime || B.clock <= 10);
      }
      if (mode !== 'waves') {
        const k = `${p.crowns}-${e.crowns}`;
        if (hudCache.crowns !== k) {
          hudCache.crowns = k;
          clear(crownsMe);
          clear(crownsEnemy);
          for (let i = 0; i < 3; i++) {
            crownsMe.appendChild(el(`span.crown${i < p.crowns ? '.on' : ''}`));
            crownsEnemy.appendChild(el(`span.crown${i < e.crowns ? '.on' : ''}`));
          }
        }
      }
      // elixir
      const ex = p.elixir;
      setText(elixirNum, 'ex', String(Math.floor(ex)));
      for (let i = 0; i < ELIXIR_MAX; i++) {
        const f = clamp(ex - i, 0, 1);
        const v = f >= 1 ? 1 : f;
        if (hudCache['seg' + i] !== v) {
          hudCache['seg' + i] = v;
          elixirSegs[i].firstChild.style.transform = `scaleX(${v})`;
          elixirSegs[i].classList.toggle('full', v >= 1);
        }
      }
      elixirBar.classList.toggle('x2', B.elixirMult > 1);
      // hand
      for (let i = 0; i < 4; i++) {
        const c = cardEls[i];
        const id = p.hand[i];
        if (c.id !== id) {
          c.id = id;
          c.img.src = cardArtURL(id);
          c.cost.textContent = String(CARDS[id].cost);
          c.node.className = `hand-card r-${CARDS[id].rarity}${i === selected ? ' selected' : ''}`;
          c.node.setAttribute('aria-label', `${CARDS[id].name}, ${CARDS[id].cost} elixir`);
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
      // bricks & hero
      setText(brickChip.lastChild, 'bricks', String(p.bricks));
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
      if (ui.selectedTower && !ui.selectedTower.alive) hidePopover();
    }

    // ───────────── results ─────────────
    function onEnd(r) {
      ended = true;
      ui.ghost = null;
      hidePopover();
      coach.hidden = true;
      const win = r.winner === 0;
      const draw = r.winner === -1;
      const outcome = draw ? 'draw' : win ? 'win' : 'loss';
      const stats = B.summary(0);
      const goldBonus = me.petId && PETS[me.petId].special?.goldBonus ? PETS[me.petId].special.goldBonus : 0;
      const res = applyBattleResult({ outcome, crowns: stats.crowns, enemyCrowns: B.players[1].crowns, stats: {
        cardsPlayed: stats.cardsPlayed, spellsCast: stats.spellsCast, kills: stats.kills, heroKills: stats.heroKills,
        towers: stats.towers, bricks: stats.bricks, forms: stats.forms, elements: stats.elements,
      }, mode, wave: mode === 'waves' ? B.waves.wave : 0, goldBonus });
      app.sfx(mode === 'waves' ? 'defeat' : draw ? 'draw' : win ? 'victory' : 'defeat');
      setTimeout(() => showResults(r, outcome, res), mode === 'waves' ? 1200 : 1800);
    }

    function showResults(r, outcome, res) {
      const title = mode === 'waves' ? `WAVE ${B.waves.wave}` : mode === 'tutorial' ? 'TRAINING COMPLETE' : outcome === 'win' ? 'VICTORY!' : outcome === 'draw' ? 'DRAW' : 'DEFEAT';
      const crownRow = mode === 'waves' ? null : el('div.res-crowns', null, ...[0, 1, 2].map((i) => el(`span.crown.big${i < B.players[0].crowns ? '.on' : ''}`, { style: { animationDelay: `${0.25 + i * 0.25}s` } })));
      const goldVal = el('span', { text: '0' });
      const rows = el('div.res-rows', null,
        mode === 'duel' ? el('div.res-row', null, icon('ui_trophy', '', 2), el('span', { text: 'Trophies' }), el('b', { class: res.trophyDelta >= 0 ? 'good' : 'bad', text: `${res.trophyDelta >= 0 ? '+' : ''}${res.trophyDelta}` })) : null,
        mode === 'waves' ? el('div.res-row', null, icon('ui_trophy', '', 2), el('span', { text: 'Best wave' }), el('b', { text: String(getProfile().stats.bestWave) })) : null,
        el('div.res-row', null, icon('ui_gold', '', 2), el('span', { text: 'Gold' }), el('b', null, '+', goldVal)),
        el('div.res-row', null, icon('ui_xp', '', 2), el('span', { text: 'Experience' }), el('b', { text: `+${res.xp}` })),
        el('div.res-row.dim', null, icon('ui_sword', '', 2), el('span', { text: 'Troops defeated' }), el('b', { text: String(B.players[0].stats.kills) })),
        el('div.res-row.dim', null, icon('ui_brick', '', 2), el('span', { text: 'Bricks collected' }), el('b', { text: String(B.players[0].stats.bricks) })),
        res.levelUps ? el('div.res-banner', { text: `KING LEVEL ${res.kingLevel}!` }) : null,
        res.newArena != null ? el('div.res-banner.arena', { text: `NEW ARENA: ${ARENAS[res.newArena].name}` }) : null);
      const actions = el('div.res-actions');
      const wonDrop = outcome === 'win' || mode === 'tutorial' || (mode === 'waves' && B.waves.wave >= 5);
      if (wonDrop) {
        const tier = mode === 'waves' ? (B.waves.wave >= 20 ? 2 : B.waves.wave >= 10 ? 1 : 0) : 0;
        actions.appendChild(el('button.btn.btn-gold.btn-big.pulse', { type: 'button', onclick: () => app.go('lucky', { tier, from: 'battle' }) }, 'Open Lucky Drop'));
        actions.appendChild(el('button.btn.btn-ghost', { type: 'button', onclick: () => app.go('home') }, 'Skip'));
      } else {
        actions.appendChild(el('button.btn.btn-gold.btn-big', { type: 'button', onclick: () => app.go('home') }, 'Continue'));
        if (mode !== 'tutorial') actions.appendChild(el('button.btn.btn-ghost', { type: 'button', onclick: () => app.go('battle', { mode }) }, mode === 'waves' ? 'Try again' : 'Battle again'));
      }
      const panel = el(`div.results.${outcome}`, null, el('h1.res-title', { text: title }), crownRow, rows, actions);
      screen.appendChild(el('div.results-wrap', null, panel));
      countUp(goldVal, 0, res.gold, 900);
      if (outcome === 'win') app.sfx('coin', { volume: 0.6 });
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      offs.forEach((f) => f());
      clearTimeout(coachTimer);
      app.onHidden = null;
      B.silent = true;
      try {
        app.audio.setIntensity?.(0);
      } catch {
        /* ignore */
      }
    };
  },
};
