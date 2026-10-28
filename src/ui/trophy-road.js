// Trophy Road: milestone rewards and arena unlocks.

import { el, clear, fmtNum } from '../core/util.js';
import { ARENAS } from '../data/arenas.js';
import { DROP_TIERS } from '../data/progression.js';
import { getProfile, trophyRoadState, claimTrophyRoad } from '../core/profile.js';
import { icon } from './components.js';

export function openTrophyRoad(app) {
  const body = el('div.road');
  const render = () => {
    clear(body);
    const p = getProfile();
    body.append(el('div.road-now', null, icon('ui_trophy', '', 3), el('b', { text: fmtNum(p.trophies) }), el('small', { text: `best ${fmtNum(p.bestTrophies)}` })));
    let firstUnclaimed = null;
    for (const m of trophyRoadState()) {
      const arena = m.arena ? ARENAS.find((a) => a.id === m.arena) : null;
      const r = m.reward;
      const label = r.type === 'gold' ? `${r.amount} gold` : r.type === 'gems' ? `${r.amount} gems` : r.type === 'cards' ? `${r.count} cards` : DROP_TIERS[r.tier].name;
      const ic = r.type === 'gold' ? 'ui_gold' : r.type === 'gems' ? 'ui_gem' : r.type === 'cards' ? 'spell_volley' : `chest_${DROP_TIERS[r.tier].id}`;
      const row = el(`div.road-step${m.reached ? '.reached' : ''}${m.claimed ? '.claimed' : ''}${arena ? '.arena' : ''}`, null,
        el('div.rs-t', null, icon('ui_trophy', '', 2), el('span', { text: fmtNum(m.trophies) })),
        el('div.rs-main', null, arena ? el('b', { text: `Arena: ${arena.name}` }) : null, el('span.rs-reward', null, icon(ic, '', 2), label)),
        m.claimed ? el('span.q-ok', { text: '✓' }) : el('button.btn.btn-small' + (m.reached ? '.btn-gold' : '.btn-ghost'), { type: 'button', disabled: !m.reached, onclick: () => {
          const rr = claimTrophyRoad(m.trophies);
          if (!rr) return;
          app.sfx('coin');
          if (rr.type === 'drop') {
            app.go('lucky', { tier: rr.tier, from: 'road', noUpgrade: true });
            return;
          }
          app.toast(`Claimed ${label}`, 'good');
          render();
        } }, m.reached ? 'Claim' : 'Locked'));
      if (!firstUnclaimed && !m.claimed) firstUnclaimed = row;
      body.append(row);
    }
    requestAnimationFrame(() => firstUnclaimed?.scrollIntoView({ block: 'center' }));
  };
  render();
  app.modal(body, { title: 'Trophy Road', className: 'road-sheet' });
}
