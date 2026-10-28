// Lucky Drop: tap the chest to try to upgrade its tier, then open it and reveal the loot.

import { el, clear, haptic } from '../core/util.js';
import { DROP_TIERS, DROP_UPGRADE_CHANCE, DROP_TAPS } from '../data/progression.js';
import { CARDS, RARITY_INFO } from '../data/cards.js';
import { WEAPONS } from '../data/weapons.js';
import { GADGETS, PETS } from '../data/gadgets.js';
import { HEROES } from '../data/heroes.js';
import { rollDrop, applyDrop, getProfile } from '../core/profile.js';
import { drawSprite } from '../art/sprite-cache.js';
import { cardTile, icon, countUp, animatedCanvas } from './components.js';
import { guideFirstDrop } from './tour.js';

export const luckyScreen = {
  mount(root, app, params = {}) {
    let tier = params.tier || 0;
    let taps = params.tutorial ? DROP_TAPS : params.noUpgrade || params.drop ? 0 : DROP_TAPS;
    let phase = taps > 0 ? 'upgrade' : 'ready';
    let shake = 0;
    let flash = 0;
    let opened = false;
    app.music(null);

    const title = el('h1.lucky-title');
    const sub = el('p.lucky-sub');
    const tapsEl = el('div.lucky-taps');
    const chestCv = animatedCanvas(40, 34, 6, (ctx, t) => {
      const dx = shake > 0 ? Math.sin(t * 80) * shake * 2 : 0;
      if (shake > 0) shake = Math.max(0, shake - 0.03);
      // glow
      const tierDef = DROP_TIERS[tier];
      ctx.fillStyle = hexWithAlpha(tierDef.color, 0.18 + 0.1 * Math.sin(t * 3));
      ctx.beginPath();
      ctx.arc(20, 18, 16, 0, Math.PI * 2);
      ctx.fill();
      drawSprite(ctx, `chest_${tierDef.id}`, 20 + dx, 30, { anim: opened ? 'open' : 'closed', t, flash });
      if (flash > 0) flash = Math.max(0, flash - 0.05);
      // sparkles for high tiers
      if (tier >= 2) {
        for (let i = 0; i < tier * 2; i++) {
          const a = t * 1.5 + i * 1.3;
          ctx.fillStyle = i % 2 ? '#ffffff' : tierDef.color;
          ctx.fillRect(Math.round(20 + Math.cos(a) * 17), Math.round(16 + Math.sin(a * 1.3) * 12), 1, 1);
        }
      }
    });
    const chestBtn = el('button.lucky-chest', { type: 'button', 'aria-label': 'Lucky Drop' }, chestCv);
    const loot = el('div.lucky-loot');
    const actions = el('div.lucky-actions');
    root.append(el('div.lucky', null, title, sub, tapsEl, chestBtn, loot, actions));

    const drop = params.drop || null;
    let rolled = drop;

    const refresh = () => {
      const t = DROP_TIERS[tier];
      title.textContent = t.name;
      title.style.color = t.color;
      if (phase === 'upgrade') {
        sub.textContent = tier >= DROP_TIERS.length - 1 ? 'Maximum tier!' : `Tap the drop to try to upgrade it! (${Math.round(DROP_UPGRADE_CHANCE[tier] * 100)}% chance)`;
        clear(tapsEl);
        for (let i = 0; i < DROP_TAPS; i++) tapsEl.appendChild(el(`span.tap-pip${i < taps ? '.on' : ''}`));
      } else if (phase === 'ready') {
        sub.textContent = 'Tap to open!';
        clear(tapsEl);
      }
    };
    refresh();

    chestBtn.addEventListener('click', () => {
      if (phase === 'upgrade') {
        if (taps <= 0) return;
        taps--;
        shake = 1;
        app.sfx('card_select', { pitch: 0.8 + tier * 0.1 });
        haptic('light');
        const canUp = tier < DROP_TIERS.length - 1;
        // the very first tap of the tutorial drop always upgrades it
        const lucky = params.tutorial && taps === DROP_TAPS - 1;
        if (canUp && (lucky || Math.random() < DROP_UPGRADE_CHANCE[tier])) {
          tier++;
          flash = 1;
          shake = 1.5;
          app.sfx('rarity_up');
          haptic('heavy');
          chestBtn.classList.remove('boom');
          void chestBtn.offsetWidth;
          chestBtn.classList.add('boom');
        }
        if (taps <= 0 || tier >= DROP_TIERS.length - 1) {
          setTimeout(() => {
            phase = 'ready';
            refresh();
          }, 450);
        }
        refresh();
      } else if (phase === 'ready') {
        phase = 'open';
        open();
      }
    });

    function open() {
      opened = true;
      flash = 1;
      app.sfx('chest_open');
      haptic('heavy');
      sub.textContent = '';
      rolled = rolled ? { ...rolled, tier } : rollDrop(tier, Date.now());
      const before = getProfile().cards;
      const fresh = new Set(rolled.cards.filter((c) => !before[c.id]).map((c) => c.id));
      const { newCards } = applyDrop(rolled);
      void newCards;
      const items = [];
      items.push(el('div.loot-item.gold', null, icon('ui_gold', '', 3), el('b', { text: '0' })));
      if (rolled.gems) items.push(el('div.loot-item.gems', null, icon('ui_gem', '', 3), el('b', { text: `${rolled.gems}` })));
      for (const c of rolled.cards) {
        const card = CARDS[c.id];
        items.push(el(`div.loot-item.card.r-${card.rarity}`, null, cardTile(c.id, { small: true, isNew: fresh.has(c.id) }), el('b', { text: `x${c.n}` }), el('small', { text: RARITY_INFO[card.rarity].name })));
      }
      if (rolled.item) {
        const it = rolled.item;
        const def = it.kind === 'weapon' ? WEAPONS[it.id] : it.kind === 'gadget' ? GADGETS[it.id] : it.kind === 'pet' ? PETS[it.id] : HEROES[it.id];
        const key = it.kind === 'gadget' ? `gadget_${it.id}` : it.kind === 'hero' ? null : it.id;
        items.push(el('div.loot-item.special', null, key ? icon(key, '', 3) : el('span.hero-new', { text: '★' }), el('b', { text: def.name }), el('small', { text: `New ${it.kind}!` })));
      }
      clear(loot);
      items.forEach((n, i) => {
        n.style.animationDelay = `${0.25 + i * 0.28}s`;
        loot.appendChild(n);
        setTimeout(() => app.sfx(n.classList.contains('special') ? 'rarity_up' : 'card_reveal', { pitch: 0.9 + i * 0.05 }), 250 + i * 280);
      });
      countUp(items[0].querySelector('b'), 0, rolled.gold, 900);
      setTimeout(() => {
        clear(actions);
        const next = params.from === 'shop' ? { tab: 'shop' } : params.from === 'road' ? { tab: 'quests' } : { tab: 'battle' };
        actions.append(el('button.btn.btn-gold.btn-big', { type: 'button', onclick: () => app.go('home', next) }, 'Collect'));
      }, 400 + items.length * 280);
    }

    const stopGuide = params.tutorial ? guideFirstDrop(app, () => phase) : null;
    return () => {
      chestCv.stop?.();
      stopGuide?.();
    };
  },
};

function hexWithAlpha(hex, a) {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}
