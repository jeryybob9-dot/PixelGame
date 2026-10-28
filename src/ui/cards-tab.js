// Cards tab: deck editor, collection and card details.

import { el, clear } from '../core/util.js';
import { CARDS, CARD_IDS, RARITY_INFO, cardStatLines, MAX_CARD_LEVEL } from '../data/cards.js';
import { ARENAS } from '../data/arenas.js';
import {
  getProfile, currentDeck, setDeckCard, setActiveDeck, deckAverage, isOwned, cardLevel, cardUpgradeInfo, upgradeCard, unlockedArena,
} from '../core/profile.js';
import { cardTile, cardArtURL, icon, progressBar } from './components.js';

const RARITY_ORDER = { common: 0, rare: 1, epic: 2, legendary: 3 };

export const cardsTab = {
  mount(view, app) {
    let swapping = null; // card id waiting for a deck slot

    const render = () => {
      clear(view);
      const p = getProfile();
      const deck = currentDeck();
      const slots = el('div.deck-slots', null, ...[0, 1, 2].map((i) => el(`button.deck-slot${p.activeDeck === i ? '.active' : ''}`, { type: 'button', onclick: () => {
        setActiveDeck(i);
        app.sfx('ui_click');
        render();
      } }, `Deck ${i + 1}`)));
      const head = el('div.deck-head', null, slots, el('div.deck-avg', null, icon('ui_brick', '', 2), el('span', { text: `Avg ${Math.round(deckAverage() * 10)}` })));
      const grid = el(`div.deck-grid${swapping ? '.swapping' : ''}`, null, ...deck.map((id, slot) => {
        const info = cardUpgradeInfo(id);
        const tile = cardTile(id, { level: cardLevel(id), count: p.cards[id]?.count, need: info && !info.maxed ? info.cards : null, onClick: () => {
          if (swapping) {
            setDeckCard(slot, swapping);
            app.sfx('deploy');
            swapping = null;
            render();
            return;
          }
          openCard(app, id, render, (cid) => {
            swapping = cid;
            render();
          });
        } });
        if (info?.ready && info.affordable) tile.classList.add('can-upgrade');
        return tile;
      }));
      view.append(head);
      if (swapping) {
        view.append(el('div.swap-hint', null, cardTile(swapping, { small: true }), el('span', { text: 'Tap a card in your deck to swap it out' }), el('button.btn.btn-small.btn-ghost', { type: 'button', onclick: () => {
          swapping = null;
          render();
        } }, 'Cancel')));
      }
      view.append(grid);

      // hint: deck roles
      const roles = new Set(deck.flatMap((id) => CARDS[id].roles));
      const tips = [];
      if (!deck.some((id) => CARDS[id].roles.includes('win'))) tips.push('Add a big hitter (Stone Giant, Boar Rider…) to knock down castles.');
      if (!deck.some((id) => CARDS[id].roles.includes('air') || CARDS[id].unit?.targets === 'both' || CARDS[id].building?.targets === 'both')) tips.push('Nothing hits air! Add Archers, Blaster Goblins or a Brick Tower.');
      if (!roles.has('spell_small') && !roles.has('spell_big')) tips.push('A spell helps against groups of enemies.');
      if (!roles.has('builder') && !roles.has('economy')) tips.push('Builders bring extra villagers, and villagers mine more bricks.');
      if (tips.length) view.append(el('div.deck-tips', null, ...tips.map((t) => el('p', { text: t }))));

      // collection
      const owned = CARD_IDS.filter((id) => isOwned(id) && !deck.includes(id)).sort((a, b) => RARITY_ORDER[CARDS[a].rarity] - RARITY_ORDER[CARDS[b].rarity] || CARDS[a].cost - CARDS[b].cost);
      const total = CARD_IDS.length;
      const found = CARD_IDS.filter((id) => isOwned(id)).length;
      view.append(el('h2.section-title', null, 'Collection ', el('small', { text: `${found}/${total} found` })));
      view.append(el('div.card-grid', null, ...owned.map((id) => {
        const info = cardUpgradeInfo(id);
        const tile = cardTile(id, { level: cardLevel(id), count: p.cards[id]?.count, need: info && !info.maxed ? info.cards : null, isNew: p.cards[id]?.isNew, onClick: () => {
          if (p.cards[id]?.isNew) delete p.cards[id].isNew;
          openCard(app, id, render, (cid) => {
            swapping = cid;
            render();
          });
        } });
        if (info?.ready && info.affordable) tile.classList.add('can-upgrade');
        return tile;
      })));
      const ua = unlockedArena();
      const locked = CARD_IDS.filter((id) => !isOwned(id)).sort((a, b) => CARDS[a].arena - CARDS[b].arena || RARITY_ORDER[CARDS[a].rarity] - RARITY_ORDER[CARDS[b].rarity]);
      if (locked.length) {
        view.append(el('h2.section-title', null, 'Not found yet'));
        view.append(el('div.card-grid', null, ...locked.map((id) => cardTile(id, {
          locked: true,
          lockText: CARDS[id].arena > ua ? ARENAS[CARDS[id].arena].name : 'Drops now',
          onClick: () => openCard(app, id, render, null),
        }))));
      }
    };
    render();
  },
};

/** Card detail sheet. */
export function openCard(app, id, onChange, onUse) {
  const c = CARDS[id];
  const r = RARITY_INFO[c.rarity];
  const owned = isOwned(id);
  const p = getProfile();
  const body = el('div.card-detail');
  const draw = () => {
    clear(body);
    const level = owned ? cardLevel(id) : 1;
    const info = owned ? cardUpgradeInfo(id) : null;
    const now = cardStatLines(c, level);
    const nxt = level < MAX_CARD_LEVEL ? cardStatLines(c, level + 1) : null;
    body.append(
      el('div.cd-top', null,
        el('div.cd-art', { class: `r-${c.rarity}` }, el('img', { src: cardArtURL(id), alt: '' }), el('div.card-cost', null, el('span', { text: String(c.cost * 10) }))),
        el('div.cd-meta', null,
          el('div.cd-rarity', { style: { color: r.color }, text: `${r.name} ${c.type === 'troop' ? 'Troop' : c.type === 'spell' ? 'God Power' : 'Building'}` }),
          el('div.cd-level', { text: owned ? `Level ${level}${level >= MAX_CARD_LEVEL ? ' (max)' : ''}` : `Unlocks in ${ARENAS[c.arena].name}` }),
          owned && info && !info.maxed ? progressBar(p.cards[id].count, info.cards, info.ready ? 'ready' : '') : null)),
      el('p.cd-desc', { text: c.desc }),
      el('div.cd-stats', null, ...now.map(([k, v], i) => {
        const nv = nxt?.[i]?.[1];
        const up = nxt && typeof v === 'number' && typeof nv === 'number' && nv > v ? el('span.up', { text: `+${nv - v}` }) : null;
        return el('div.cd-stat', null, el('span', { text: k }), el('b', null, String(v), up));
      })));
    const actions = el('div.cd-actions');
    if (owned && onUse && !currentDeck().includes(id)) actions.append(el('button.btn.btn-blue', { type: 'button', onclick: () => {
      close();
      onUse(id);
    } }, 'Use'));
    if (owned && info && !info.maxed) {
      const btn = el(`button.btn.cd-upgrade${info.ready && info.affordable ? '.btn-gold' : '.btn-ghost'}`, { type: 'button', onclick: () => {
        const res = upgradeCard(id);
        if (!res.ok) {
          app.toast(res.reason, 'bad');
          app.sfx('ui_error');
          return;
        }
        app.sfx('level_up');
        app.toast(`${c.name} upgraded to level ${cardLevel(id)}!`, 'good');
        if (res.levelUps) app.toast(`King level ${getProfile().kingLevel}!`, 'good', 2800);
        draw();
        onChange?.();
      } }, 'Upgrade ', el('span.price', null, icon('ui_gold', '', 2), String(info.gold)));
      actions.append(btn);
    }
    body.append(actions);
  };
  draw();
  const close = app.modal(body, { title: c.name, className: `card-sheet r-${c.rarity}` });
}
