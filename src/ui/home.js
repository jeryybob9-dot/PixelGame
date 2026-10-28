// Home hub: top bar, bottom tab bar, and the Battle + Quests tabs (others live in their own files).

import { el, clear, fmtNum } from '../core/util.js';
import {
  getProfile, events, arenaIndex, xpForNextLevel, questList, claimQuest, achievementList, claimAchievement,
  pendingClaims, freeGiftReadyIn, setName, setSetting, resetProfile, ensureDailyQuests,
} from '../core/profile.js';
import { ARENAS } from '../data/arenas.js';
import { renderArenaBackground } from '../art/tiles.js';
import { renderRealmMap } from '../art/realm-tiles.js';
import { generateRealm } from '../realm/worldgen.js';
import { drawHero, drawSprite } from '../art/sprite-cache.js';
import { chip, icon, progressBar, animatedCanvas } from './components.js';
import { cardsTab } from './cards-tab.js';
import { heroTab } from './hero-tab.js';
import { shopTab } from './shop-tab.js';
import { openTrophyRoad } from './trophy-road.js';
import { maybeStartTour } from './tour.js';

const TABS = [
  { id: 'shop', label: 'Shop', icon: 'ui_gold' },
  { id: 'cards', label: 'Cards', icon: 'spell_volley' },
  { id: 'battle', label: 'Battle', icon: 'ui_sword' },
  { id: 'hero', label: 'Hero', icon: 'ui_armor' },
  { id: 'quests', label: 'Quests', icon: 'ui_crown' },
];

export const homeScreen = {
  mount(root, app, params = {}) {
    let tab = params.tab || 'battle';
    app.music('menu');
    const nameEl = el('span.tb-name');
    const lvlEl = el('span.lvl-badge.blue');
    const xpFill = el('div.xp-fill');
    const cur = el('div.tb-cur');
    const settingsBtn = el('button.icon-btn.gear', { type: 'button', 'aria-label': 'Settings', onclick: () => openSettings(app) }, el('span.gear-glyph'));
    const topbar = el('header.topbar', null,
      el('button.tb-profile', { type: 'button', onclick: () => openSettings(app) }, lvlEl, el('div.tb-who', null, nameEl, el('div.xp-bar', null, xpFill))),
      cur,
      settingsBtn);
    const panel = el('main.tab-panel');
    const tabBtns = TABS.map((t) => el('button.tab', { type: 'button', dataset: { tab: t.id }, onclick: () => setTab(t.id) }, icon(t.icon, 'tab-icon', 2), el('span', { text: t.label }), el('span.tab-badge', { hidden: true })));
    const tabbar = el('nav.tabbar', null, ...tabBtns);
    root.append(el('div.home', null, topbar, panel, tabbar));

    let cleanupTab = null;
    function setTab(id) {
      if (id !== tab) app.sfx('ui_click');
      tab = id;
      tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
      if (cleanupTab) cleanupTab();
      clear(panel);
      panel.scrollTop = 0;
      const view = el(`div.tab-view.tab-${id}`);
      panel.appendChild(view);
      const mod = { battle: battleTab, cards: cardsTab, hero: heroTab, shop: shopTab, quests: questsTab }[id];
      cleanupTab = mod.mount(view, app) || null;
    }

    function refreshTop() {
      const pr = getProfile();
      nameEl.textContent = pr.name;
      lvlEl.textContent = String(pr.kingLevel);
      const xp = xpForNextLevel();
      xpFill.style.width = `${xp.frac * 100}%`;
      clear(cur);
      cur.append(chip('gold', pr.gold, () => setTab('shop')), chip('gems', pr.gems, () => setTab('shop')));
      const pend = pendingClaims();
      const qb = tabBtns[4].querySelector('.tab-badge');
      qb.hidden = pend.quests + pend.ach === 0;
      qb.textContent = String(pend.quests + pend.ach);
      const sb = tabBtns[0].querySelector('.tab-badge');
      sb.hidden = freeGiftReadyIn() > 0;
      sb.textContent = '!';
    }
    refreshTop();
    const off = events.on('change', refreshTop);
    const tick = setInterval(refreshTop, 15000);
    setTab(tab);
    maybeStartTour(app);
    return () => {
      off();
      clearInterval(tick);
      if (cleanupTab) cleanupTab();
    };
  },
};

// ───────────────────────── Battle tab ─────────────────────────

const battleTab = {
  mount(view, app) {
    const p = getProfile();
    const ai = arenaIndex();
    const arena = ARENAS[ai];
    const next = ARENAS[ai + 1];

    // realm preview: a slice of this Realm's island
    const preview = el('canvas.arena-thumb', { width: 288, height: 200 });
    try {
      const isle = realmPreview(arena.biome);
      const ctx = preview.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(isle, (isle.width - 288) / 2, isle.height - 200 - 70, 288, 200, 0, 0, 288, 200);
    } catch {
      try {
        const bg = renderArenaBackground(arena.biome, 7);
        preview.getContext('2d').drawImage(bg, 0, 160, 288, 200, 0, 0, 288, 200);
      } catch {
        /* art not ready */
      }
    }
    const heroId = p.heroId;
    const heroCv = animatedCanvas(64, 40, 3, (ctx, t) => {
      drawHero(ctx, { heroId, form: 1 + (Math.floor(t / 3) % 3), skin: p.heroes[heroId]?.skin, x: 22, y: 36, anim: 'idle', t, team: 0, weaponId: p.weaponId, aim: -0.2 });
      if (p.petId) drawSprite(ctx, p.petId, 44, 36 - (['drone', 'dragonpup'].includes(p.petId) ? 8 + Math.sin(t * 4) * 2 : 0), { anim: 'idle', t, team: 0 });
    });
    const trophyRow = el('button.arena-trophies', { type: 'button', onclick: () => openTrophyRoad(app) },
      icon('ui_trophy', '', 2), el('b', { text: fmtNum(p.trophies) }),
      next ? progressBar(p.trophies - arena.trophies, next.trophies - arena.trophies) : el('span.maxed', { text: 'Top arena!' }),
      el('span.road-link', { text: 'Trophy Road ›' }));
    const card = el('section.arena-card', null,
      el('div.arena-art', null, preview, el('div.arena-hero', null, heroCv)),
      el('div.arena-info', null,
        el('div.arena-num', { text: `Realm ${ai + 1}` }),
        el('h2.arena-name', { text: arena.name }),
        el('p.arena-blurb', { text: arena.blurb }),
        trophyRow));

    const battleBtn = el('button.btn.btn-battle', { type: 'button', onclick: () => {
      app.sfx('ui_click');
      app.go('realm', { mode: getProfile().tutorialDone ? 'clash' : 'training' });
    } }, el('span.bb-label', { text: 'REALM CLASH' }), el('small', { text: `Destroy ${arena.ai.name}'s castle!` }));

    const modes = el('div.mode-grid.three', null,
      modeTile('Horde Nights', `Best: ${p.stats.bestNights || 0} nights`, 'wolf', () => app.go('realm', { mode: 'horde' })),
      modeTile('God Box', 'Sandbox world', 'spell_meteor', () => app.go('godbox')),
      modeTile('Training', p.tutorialDone ? 'Replay the guide' : 'Start here!', 'emote_thumbs', () => app.go('realm', { mode: 'training' }), !p.tutorialDone));

    // daily quest teaser
    ensureDailyQuests();
    const qs = questList();
    const done = qs.filter((q) => q.claimed).length;
    const teaser = el('button.quest-teaser', { type: 'button', onclick: () => document.querySelector('.tab[data-tab="quests"]')?.click() },
      icon('ui_crown', '', 2), el('span', { text: `Daily quests ${done}/${qs.length}` }), el('span.tq-go', { text: '›' }));
    view.append(card, battleBtn, modes, teaser);
    return () => heroCv.stop?.();
  },
};

const previewCache = new Map();
/** A rendered island for a biome (cached). */
function realmPreview(biome) {
  let c = previewCache.get(biome);
  if (!c) {
    const m = generateRealm({ seed: 11, biome });
    c = renderRealmMap(m.tiles, m.w, m.h, biome, 11);
    const ctx = c.getContext('2d');
    // a few village props on top
    try {
      const k = m.keeps[0];
      drawSprite(ctx, 'keep', k.x * 16, (k.y + 1.5) * 16, { team: 0 });
      drawSprite(ctx, 'house', (k.x - 3.5) * 16, (k.y - 0.5) * 16, { team: 0, scale: 1.5 });
      drawSprite(ctx, 'temple', (k.x + 3.8) * 16, (k.y - 0.3) * 16, { team: 0, scale: 1.35 });
      drawSprite(ctx, 'princess_tower', k.x * 16, (k.y - 4.5) * 16, { team: 0 });
      for (const d of m.deposits.slice(0, 4)) drawSprite(ctx, 'brickpile', d.x * 16, d.y * 16 + 6, {});
      drawSprite(ctx, 'villager', (k.x - 1.6) * 16, (k.y - 2.4) * 16, { team: 0, anim: 'carry' });
      drawSprite(ctx, 'villager', (k.x + 2.2) * 16, (k.y - 3) * 16, { team: 0, anim: 'walk', flip: true });
    } catch {
      /* art missing */
    }
    previewCache.set(biome, c);
  }
  return c;
}

function modeTile(title, sub, iconKey, onClick, highlight = false) {
  return el(`button.mode-tile${highlight ? '.hl' : ''}`, { type: 'button', onclick: onClick }, icon(iconKey, 'mode-icon', 2), el('b', { text: title }), el('small', { text: sub }));
}

// ───────────────────────── Quests tab ─────────────────────────

const questsTab = {
  mount(view, app) {
    const render = () => {
      clear(view);
      const qs = questList();
      view.appendChild(el('h2.section-title', { text: 'Daily Quests' }));
      view.appendChild(el('p.section-sub', { text: 'New quests every day.' }));
      for (const q of qs) {
        const done = q.progress >= q.def.goal;
        view.appendChild(el(`div.quest${q.claimed ? '.claimed' : done ? '.done' : ''}`, null,
          el('div.q-main', null, el('b', { text: q.def.text }), progressBar(q.progress, q.def.goal, done ? 'ready' : '')),
          rewardLabel(q.def.reward),
          q.claimed ? el('span.q-ok', { text: '✓' }) : el('button.btn.btn-small' + (done ? '.btn-gold' : '.btn-ghost'), { type: 'button', disabled: !done, onclick: () => {
            const r = claimQuest(q.id);
            if (r) {
              app.sfx('coin');
              app.toast(`Claimed ${rewardText(r)}`, 'good');
              render();
            }
          } }, 'Claim')));
      }
      view.appendChild(el('button.btn.btn-ghost.wide', { type: 'button', onclick: () => openTrophyRoad(app) }, icon('ui_trophy', '', 2), ' Trophy Road'));
      view.appendChild(el('h2.section-title', { text: 'Achievements' }));
      for (const a of achievementList()) {
        view.appendChild(el(`div.quest.ach${a.claimed ? '.claimed' : a.done ? '.done' : ''}`, null,
          el('div.q-main', null, el('b', { text: a.text }), progressBar(a.value, a.goal, a.done ? 'ready' : '')),
          rewardLabel(a.reward),
          a.claimed ? el('span.q-ok', { text: '✓' }) : el('button.btn.btn-small' + (a.done ? '.btn-gold' : '.btn-ghost'), { type: 'button', disabled: !a.done, onclick: () => {
            const r = claimAchievement(a.id);
            if (r) {
              app.sfx('gem');
              app.toast(`Claimed ${rewardText(r)}`, 'good');
              render();
            }
          } }, 'Claim')));
      }
    };
    render();
  },
};

export function rewardLabel(r) {
  return el('span.reward', null, r.gems ? icon('ui_gem', '', 2) : icon('ui_gold', '', 2), String(r.gems || r.gold));
}
export function rewardText(r) {
  return r.gems ? `${r.gems} gems` : `${r.gold} gold`;
}

// ───────────────────────── Settings ─────────────────────────

export function openSettings(app) {
  const p = getProfile();
  const s = p.settings;
  const nameInput = el('input.text-input', { id: 'player-name', type: 'text', value: p.name, maxlength: '16', 'aria-label': 'Player name', autocomplete: 'off' });
  const slider = (id, label, key) => {
    const input = el('input.range', { id, type: 'range', min: '0', max: '1', step: '0.05', value: String(s[key]) });
    input.addEventListener('input', () => setSetting(key, Number(input.value)));
    return el('label.set-row', { for: id }, el('span', { text: label }), input);
  };
  const toggle = (id, label, key, on = true, off = false) => {
    const btn = el('button.toggle', { id, type: 'button', 'aria-pressed': String(s[key] === on) }, el('span.knob'));
    btn.addEventListener('click', () => {
      const v = getProfile().settings[key] === on ? off : on;
      setSetting(key, v);
      btn.setAttribute('aria-pressed', String(v === on));
      app.sfx('ui_click');
    });
    return el('div.set-row', null, el('span', { text: label }), btn);
  };
  const body = el('div.settings', null,
    el('label.set-row.col', { for: 'player-name' }, el('span', { text: 'Name' }), el('div.row.gap', null, nameInput, el('button.btn.btn-small.btn-gold', { type: 'button', onclick: () => {
      setName(nameInput.value);
      app.toast('Name saved', 'good');
    } }, 'Save'))),
    slider('set-music', 'Music', 'music'),
    slider('set-sfx', 'Sound effects', 'sfx'),
    toggle('set-mute', 'Mute everything', 'muted'),
    toggle('set-dmg', 'Damage numbers', 'dmgNumbers'),
    toggle('set-fx', 'Extra particles', 'particles', 'high', 'low'),
    toggle('set-3d', '3D island (off = classic 2D)', 'graphics', '3d', '2d'),
    el('button.btn.btn-ghost.wide', { type: 'button', onclick: () => openHowTo(app) }, 'How to play'),
    el('button.btn.btn-red.wide', { type: 'button', onclick: async () => {
      const yes = await app.confirm({ title: 'Reset all progress?', text: 'Cards, trophies, gold and heroes will be lost. This cannot be undone.', yes: 'Reset', danger: true });
      if (yes) {
        resetProfile();
        app.go('home');
        app.toast('Progress reset');
      }
    } }, 'Reset progress'),
    el('p.credits', { text: 'Brickbox: Tiny Gods · original pixel game. Fonts: Press Start 2P & Pixelify Sans (SIL Open Font License).' }));
  app.modal(body, { title: 'Settings' });
}

export function openHowTo(app) {
  const items = [
    ['Goal', 'Knock down the RED castle across the river. Keep your BLUE castle standing. If the 5 minutes run out, the castle with more health wins.'],
    ['Move', 'Drag on the left side of the island to walk your hero. It attacks enemies in range by itself; tap an enemy to focus it. POWER fires your hero\'s special attack. Your hero levels up by fighting, heals beside your castle, and its gadget fires by itself when it is hurt.'],
    ['Bricks', 'Bricks pay for everything. Your villagers mine them, and a few more trickle in every second. The last minute is the Brick Rush: double bricks!'],
    ['Troops', 'Drag a card onto your side of the river (or next to your hero). Troops march to the red castle on their own. They are tough, so a group of three or four is a real push.'],
    ['Build', 'Tap BUILD and place a House (+2 villagers), a Tower (shoots enemies) or a Barracks (sends Soldiers to attack) on your side of the river.'],
    ['Progress', 'Wins give trophies, gold and a Lucky Drop. Tap the drop to try to upgrade it before opening. Unlock new Realms, upgrade cards, weapons and heroes between matches.'],
  ];
  const body = el('div.howto', null, ...items.map(([h, t]) => el('div.howto-item', null, el('h3', { text: h }), el('p', { text: t }))));
  app.modal(body, { title: 'How to play' });
}
