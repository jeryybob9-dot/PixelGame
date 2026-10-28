// Reusable UI pieces: card tiles, currency chips, stat bars, pixel icons.

import { el } from '../core/util.js';
import { fmtNum } from '../core/util.js';
import { CARDS, RARITY_INFO, MAX_CARD_LEVEL } from '../data/cards.js';
import { cardArt, iconURL } from '../art/sprite-cache.js';

const artCache = new Map();

/** Card art as a data URL (cached). */
export function cardArtURL(cardId) {
  if (artCache.has(cardId)) return artCache.get(cardId);
  let url = '';
  try {
    url = cardArt(cardId).toDataURL();
  } catch {
    url = '';
  }
  artCache.set(cardId, url);
  return url;
}

/** Pixel icon <img> from the sprite set. */
export function icon(key, cls = '', scale = 2) {
  let src = '';
  try {
    src = iconURL(key, scale);
  } catch {
    src = '';
  }
  return el(`img.px-icon${cls ? '.' + cls : ''}`, { src, alt: '', draggable: 'false' });
}

/**
 * A card tile.
 * @param {string} cardId
 * @param {{ level?: number, count?: number, need?: number, locked?: boolean, lockText?: string, small?: boolean, onClick?: Function, selected?: boolean, isNew?: boolean, showCost?: boolean }} [o]
 */
export function cardTile(cardId, o = {}) {
  const c = CARDS[cardId];
  const r = RARITY_INFO[c.rarity];
  const tile = el(`button.card-tile.r-${c.rarity}${o.small ? '.small' : ''}${o.locked ? '.locked' : ''}${o.selected ? '.selected' : ''}`, {
    type: 'button',
    'aria-label': `${c.name}, ${r.name}, costs ${c.cost * 10} bricks`,
    dataset: { card: cardId },
    onclick: o.onClick,
  },
  el('div.card-frame', null,
    el('img.card-art', { src: cardArtURL(cardId), alt: '', draggable: 'false' }),
    o.showCost !== false ? el('div.card-cost', null, el('span', { text: String(c.cost * 10) })) : null,
    o.isNew ? el('div.card-new', { text: 'NEW' }) : null,
    o.locked ? el('div.card-lock', null, icon('ui_lock', '', 2), o.lockText ? el('small', { text: o.lockText }) : null) : null),
  o.small ? null : el('div.card-name', { text: c.name }),
  o.level != null && !o.locked ? el('div.card-level', { text: o.level >= MAX_CARD_LEVEL ? 'MAX' : `Lv ${o.level}` }) : null,
  o.need != null && !o.locked ? progressBar(o.count ?? 0, o.need, o.count >= o.need ? 'ready' : '') : null);
  return tile;
}

export function progressBar(value, max, cls = '') {
  const pct = max ? Math.min(100, (value / max) * 100) : 100;
  return el(`div.pbar${cls ? '.' + cls : ''}`, null,
    el('div.pbar-fill', { style: { width: `${pct}%` } }),
    el('span.pbar-text', { text: max ? `${fmtNum(value)}/${fmtNum(max)}` : fmtNum(value) }));
}

export function statBar(label, frac, valueText, color = 'var(--gold)') {
  return el('div.statbar', null,
    el('span.statbar-label', { text: label }),
    el('div.statbar-track', null, el('div.statbar-fill', { style: { width: `${Math.round(Math.max(0.04, Math.min(1, frac)) * 100)}%`, background: color } })),
    valueText != null ? el('span.statbar-val', { text: String(valueText) }) : null);
}

/** Currency chip like [coin 1,250]. */
export function chip(kind, amount, onClick) {
  const keys = { gold: 'ui_gold', gems: 'ui_gem', trophies: 'ui_trophy', bricks: 'ui_brick', elixir: 'ui_faith', faith: 'ui_faith', crowns: 'ui_crown', xp: 'ui_xp' };
  return el(`button.chip.chip-${kind}`, { type: 'button', onclick: onClick, 'aria-label': `${amount} ${kind}` }, icon(keys[kind] || 'ui_gold', '', 2), el('span.chip-val', { text: fmtNum(amount) }));
}

/** Price label for gold/gem prices. */
export function priceTag(price) {
  if (!price) return el('span.price', { text: 'Free' });
  if (price.owned) return el('span.price', { text: 'Owned' });
  if (price.gold) return el('span.price', null, icon('ui_gold', '', 2), String(fmtNum(price.gold)));
  if (price.gems) return el('span.price', null, icon('ui_gem', '', 2), String(fmtNum(price.gems)));
  return el('span.price', { text: '—' });
}

/** Count a number up inside an element. */
export function countUp(node, from, to, ms = 700, fmt = (v) => fmtNum(v)) {
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    node.textContent = fmt(Math.round(from + (to - from) * e));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** A canvas that redraws a sprite/hero animation (for previews). */
export function animatedCanvas(w, h, scale, drawFn) {
  const cv = el('canvas.anim-canvas', { width: w, height: h });
  cv.style.width = `${w * scale}px`;
  cv.style.height = `${h * scale}px`;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  let t = 0;
  let last = performance.now();
  let raf = 0;
  const loop = (now) => {
    if (!cv.isConnected) {
      if (t > 0) return; // detached after having run: stop
    }
    t += (now - last) / 1000;
    last = now;
    ctx.clearRect(0, 0, w, h);
    try {
      drawFn(ctx, t);
    } catch {
      /* art not ready */
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  cv.stop = () => cancelAnimationFrame(raf);
  return cv;
}
