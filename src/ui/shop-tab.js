// Shop tab: free gift, daily deals, gem offers. Everything costs in-game currency only.

import { el, clear, fmtDuration } from '../core/util.js';
import { CARDS, RARITY_INFO } from '../data/cards.js';
import { WEAPONS } from '../data/weapons.js';
import { GADGETS, PETS } from '../data/gadgets.js';
import { SHOP_GEM_OFFERS, DROP_TIERS } from '../data/progression.js';
import { getProfile, ensureShop, buyDeal, freeGiftReadyIn, claimFreeGift, addGold, addGems, commit } from '../core/profile.js';
import { cardTile, icon, priceTag } from './components.js';
import { drawSprite } from '../art/sprite-cache.js';
import { animatedCanvas } from './components.js';

export const shopTab = {
  mount(view, app) {
    const canv = [];
    let timer = 0;
    const render = () => {
      canv.forEach((c) => c.stop?.());
      canv.length = 0;
      clear(view);
      const p = getProfile();
      const shop = ensureShop();

      // free gift
      const wait = freeGiftReadyIn();
      const giftCv = animatedCanvas(26, 22, 3, (ctx, t) => drawSprite(ctx, 'chest_common', 13, 21, { anim: 'closed', t }));
      canv.push(giftCv);
      const giftTime = el('small', { text: wait > 0 ? `Next gift in ${fmtDuration(wait)}` : 'Ready!' });
      view.append(el(`section.gift${wait > 0 ? '' : '.ready'}`, null, giftCv,
        el('div.gift-main', null, el('b', { text: 'Free Gift' }), giftTime),
        el('button.btn' + (wait > 0 ? '.btn-ghost' : '.btn-gold.pulse'), { type: 'button', disabled: wait > 0, onclick: () => {
          const drop = claimFreeGift();
          if (drop) app.go('lucky', { tier: 0, drop, from: 'shop', noUpgrade: true });
        } }, wait > 0 ? 'Wait' : 'Open')));
      clearInterval(timer);
      timer = setInterval(() => {
        const w = freeGiftReadyIn();
        giftTime.textContent = w > 0 ? `Next gift in ${fmtDuration(w)}` : 'Ready!';
        if (w <= 0) {
          clearInterval(timer);
          render();
        }
      }, 1000);

      // daily deals
      view.append(el('h2.section-title', null, 'Daily Deals ', el('small', { text: 'refresh every day' })));
      const deals = el('div.deals');
      for (const d of shop.deals) {
        const bought = shop.bought.includes(d.key);
        let art;
        let label;
        if (d.cardId) {
          art = cardTile(d.cardId, { small: true });
          label = `${CARDS[d.cardId].name} x${d.qty}`;
        } else {
          const def = d.item.kind === 'weapon' ? WEAPONS[d.item.id] : d.item.kind === 'gadget' ? GADGETS[d.item.id] : PETS[d.item.id];
          const key = d.item.kind === 'gadget' ? `gadget_${d.item.id}` : d.item.id;
          const cv = animatedCanvas(22, 16, 3, (ctx, t) => drawSprite(ctx, key, 11, 15, { anim: 'idle', t, team: 0 }));
          canv.push(cv);
          art = el('div.deal-item-art', null, cv, d.discount ? el('span.discount', { text: `-${d.discount}%` }) : null);
          label = def.name;
        }
        deals.append(el(`div.deal${bought ? '.bought' : ''}`, null, art, el('div.deal-label', { text: label }),
          bought ? el('span.sold', { text: 'Sold out' }) : el('button.btn.btn-gold.btn-small', { type: 'button', disabled: p.gold < d.gold, onclick: () => {
            if (buyDeal(d.key)) {
              app.sfx('coin');
              app.toast(`Bought ${label}`, 'good');
              render();
            }
          } }, priceTag({ gold: d.gold }))));
      }
      view.append(deals);

      // gem offers
      view.append(el('h2.section-title', null, 'Treasure ', el('small', { text: 'spend gems' })));
      const offers = el('div.offers');
      for (const o of SHOP_GEM_OFFERS) {
        const tier = o.drop != null ? DROP_TIERS[o.drop] : null;
        const cv = animatedCanvas(26, 22, 2.5, (ctx, t) => (tier ? drawSprite(ctx, `chest_${tier.id}`, 13, 21, { anim: 'closed', t }) : drawSprite(ctx, 'ui_gold', 13, 16, { t })));
        canv.push(cv);
        offers.append(el('div.offer', null, cv, el('b', { text: o.name }), el('small', { text: o.gold ? `${o.gold.toLocaleString()} gold` : tier.name }),
          el('button.btn.btn-gem.btn-small', { type: 'button', disabled: p.gems < o.gems, onclick: () => {
            if (getProfile().gems < o.gems) return;
            addGems(-o.gems);
            if (o.gold) {
              addGold(o.gold);
              commit();
              app.sfx('coin');
              app.toast(`+${o.gold.toLocaleString()} gold`, 'good');
              render();
            } else {
              commit();
              app.go('lucky', { tier: o.drop, from: 'shop', noUpgrade: true });
            }
          } }, priceTag({ gems: o.gems }))));
      }
      view.append(offers);
      view.append(el('p.fineprint', { text: 'Gems come from quests, achievements, Lucky Drops and the Trophy Road. There are no real-money purchases.' }));
      void RARITY_INFO;
      void icon;
    };
    render();
    return () => {
      clearInterval(timer);
      canv.forEach((c) => c.stop?.());
    };
  },
};
