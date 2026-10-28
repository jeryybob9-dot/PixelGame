// Hero tab: heroes, armory (weapons), gadgets and pets.

import { el, clear, fmtNum } from '../core/util.js';
import { HEROES, HERO_IDS, ELEMENTS } from '../data/heroes.js';
import { WEAPONS, WEAPON_IDS, WEAPON_CATEGORIES, weaponBars, weaponTags, WEAPON_MAX_LEVEL } from '../data/weapons.js';
import { GADGETS, PETS } from '../data/gadgets.js';
import { RARITY_INFO } from '../data/cards.js';
import {
  getProfile, heroUnlockState, unlockHero, setHero, ownsItem, buyItem, equip, weaponLevel, weaponUpgradeCost, upgradeWeapon, canAfford,
} from '../core/profile.js';
import { drawHero, drawSprite } from '../art/sprite-cache.js';
import { icon, statBar, priceTag, animatedCanvas } from './components.js';

const SUBTABS = [
  { id: 'heroes', label: 'Heroes' },
  { id: 'armory', label: 'Armory' },
  { id: 'gadgets', label: 'Gadgets' },
  { id: 'pets', label: 'Pets' },
];

export const heroTab = {
  mount(view, app) {
    let sub = 'heroes';
    let selHero = getProfile().heroId;
    const canvases = [];
    const stopAll = () => {
      canvases.forEach((c) => c.stop?.());
      canvases.length = 0;
    };
    const anim = (...a) => {
      const c = animatedCanvas(...a);
      canvases.push(c);
      return c;
    };

    const render = () => {
      stopAll();
      clear(view);
      view.append(el('div.subtabs', null, ...SUBTABS.map((s) => el(`button.subtab${s.id === sub ? '.active' : ''}`, { type: 'button', onclick: () => {
        sub = s.id;
        app.sfx('ui_click');
        render();
      } }, s.label))));
      if (sub === 'heroes') renderHeroes();
      if (sub === 'armory') renderArmory();
      if (sub === 'gadgets') renderGadgets();
      if (sub === 'pets') renderPets();
    };

    function renderHeroes() {
      const p = getProfile();
      const h = HEROES[selHero];
      const el2 = ELEMENTS[h.element];
      const stage = anim(108, 34, 3, (ctx, t) => {
        for (let f = 1; f <= 3; f++) drawHero(ctx, { heroId: selHero, form: f, skin: p.heroes[selHero]?.skin, x: 18 + (f - 1) * 36, y: 30, anim: Math.floor(t / 2) % 2 ? 'walk' : 'idle', t: t + f, team: 0, weaponId: p.weaponId, aim: 0 });
      });
      const st = heroUnlockState(selHero);
      const owned = st.owned;
      const actions = el('div.hero-actions');
      if (owned) {
        actions.append(
          p.heroId === selHero ? el('button.btn.btn-ghost', { type: 'button', disabled: true }, 'Selected') : el('button.btn.btn-gold', { type: 'button', onclick: () => {
            setHero(selHero);
            app.sfx('form_upgrade');
            render();
          } }, 'Select'),
          el('button.btn.btn-blue', { type: 'button', onclick: () => app.go('skin', { heroId: selHero }) }, 'Edit skin'));
      } else if (st.locked) {
        actions.append(el('div.locked-note', null, icon('ui_lock', '', 2), el('span', { text: st.text })));
      } else {
        actions.append(el('button.btn.btn-gold', { type: 'button', disabled: !st.free && !canAfford(st.price), onclick: () => {
          if (unlockHero(selHero)) {
            app.sfx('rarity_up');
            app.toast(`${h.name} joined your team!`, 'good');
            render();
          } else app.toast('Not enough currency', 'bad');
        } }, st.free ? 'Unlock' : 'Unlock ', st.free ? null : priceTag(st.price)));
        if (st.text) actions.append(el('small.dim', { text: st.text }));
      }
      view.append(
        el('section.hero-show', { style: { '--ec': el2.color } },
          el('div.hero-stage', null, stage, el('div.form-labels', null, ...['Level 1', 'Level 2', 'Level 3'].map((n) => el('span', { text: n })))),
          el('div.hero-title', null, el('h2', { text: h.name }), el('span.elem-tag', null, icon(h.element === 'shadow' ? 'skeleton' : `elem_${h.element}`, '', 2), el2.name)),
          el('p.hero-sub', { text: h.title }),
          el('div.hero-passive', null, el('b', { text: 'Passive: ' }), h.passive.text),
          el('p.hero-levels', { text: 'Your hero levels up by fighting during a match. Level 2 is tougher; level 3 upgrades POWER.' }),
          ...h.spells.map((s, i) => el('div.hero-spell', null, el('span.spell-form', { text: i === 0 ? 'POWER' : 'LV 3 POWER' }), el('div', null, el('b', { text: s.name }), el('small', { text: ` · ${s.cd}s cooldown` }), el('p', { text: s.text })))),
          actions),
        el('div.hero-pick', null, ...HERO_IDS.map((id) => {
          const hh = HEROES[id];
          const cv = anim(16, 20, 2.5, (ctx, t) => drawHero(ctx, { heroId: id, form: 1, skin: p.heroes[id]?.skin, x: 8, y: 19, anim: 'idle', t, team: 0, weaponId: null }));
          const stt = heroUnlockState(id);
          return el(`button.hero-chip${id === selHero ? '.active' : ''}${stt.owned ? '' : '.locked'}`, { type: 'button', style: { '--ec': ELEMENTS[hh.element].color }, onclick: () => {
            selHero = id;
            app.sfx('ui_click');
            render();
          } }, cv, el('span', { text: hh.name }), p.heroId === id ? el('i.chip-dot') : null);
        })));
    }

    function renderArmory() {
      const p = getProfile();
      for (const cat of WEAPON_CATEGORIES) {
        const ids = WEAPON_IDS.filter((id) => WEAPONS[id].cat === cat);
        if (!ids.length) continue;
        view.append(el('h2.section-title', { text: cat }));
        for (const id of ids) {
          const w = WEAPONS[id];
          const owned = ownsItem('weapon', id);
          const lvl = weaponLevel(id);
          const bars = weaponBars(w, lvl);
          const cv = anim(20, 12, 3, (ctx) => drawSprite(ctx, id, 10, 10, {}));
          const up = owned ? weaponUpgradeCost(id) : null;
          const rc = RARITY_INFO[w.rarity];
          const actions = el('div.w-actions');
          if (!owned) {
            actions.append(el('button.btn.btn-gold.btn-small', { type: 'button', disabled: !canAfford(w.price), onclick: () => {
              if (buyItem('weapon', id)) {
                app.sfx('coin');
                app.toast(`${w.name} added to your armory`, 'good');
                render();
              }
            } }, 'Buy ', priceTag(w.price)));
          } else {
            actions.append(p.weaponId === id ? el('span.equipped', { text: 'Equipped' }) : el('button.btn.btn-blue.btn-small', { type: 'button', onclick: () => {
              equip('weapon', id);
              app.sfx('ui_click');
              render();
            } }, 'Equip'));
            if (up != null) actions.append(el('button.btn.btn-ghost.btn-small', { type: 'button', disabled: p.gold < up, onclick: () => {
              if (upgradeWeapon(id)) {
                app.sfx('level_up');
                render();
              }
            } }, `Lv ${lvl + 1} `, priceTag({ gold: up })));
          }
          view.append(el(`div.weapon${owned ? '' : '.unowned'}${p.weaponId === id ? '.equipped-row' : ''}`, { style: { '--rc': rc.color } },
            el('div.w-head', null, el('div.w-art', null, cv), el('div.w-name', null, el('b', { text: w.name }), el('small', { text: `${rc.name} · ${owned ? (lvl >= WEAPON_MAX_LEVEL ? 'MAX' : `Lv ${lvl}`) : 'Locked'}` })), actions),
            el('p.w-desc', { text: w.desc }),
            el('div.w-bars', null,
              statBar('Damage', bars.damage, fmtNum(Math.round(w.dmg * (w.pellets || 1) * Math.pow(1.09, lvl - 1)))),
              statBar('Fire rate', bars.fireRate, `${w.rate}/s`, 'var(--gem)'),
              statBar('Range', bars.range, w.range, 'var(--good)'),
              statBar('Mobility', bars.mobility, `${Math.round(w.mobility * 100)}%`, 'var(--elixir)')),
            el('div.w-tags', null, ...weaponTags(w).map((t) => el('span.tag', { text: t })))));
        }
      }
    }

    function renderGadgets() {
      const p = getProfile();
      view.append(el('p.section-sub', { text: 'One gadget rides along with your hero. Tap its button in battle.' }));
      for (const [id, g] of Object.entries(GADGETS)) {
        const owned = ownsItem('gadget', id);
        view.append(el(`div.item-row${p.gadgetId === id ? '.equipped-row' : ''}`, null,
          el('div.ir-icon', null, icon(`gadget_${id}`, '', 3)),
          el('div.ir-main', null, el('b', { text: g.name }), el('small', { text: `${g.cd}s cooldown` }), el('p', { text: g.desc })),
          itemAction(app, 'gadget', id, owned, p.gadgetId === id, g.price, render)));
      }
    }

    function renderPets() {
      const p = getProfile();
      view.append(el('p.section-sub', { text: 'Pets follow your hero into battle and fight beside it.' }));
      for (const [id, pet] of Object.entries(PETS)) {
        const owned = ownsItem('pet', id);
        const cv = anim(16, 14, 3, (ctx, t) => drawSprite(ctx, id, 8, 13 - (pet.flying ? 2 + Math.sin(t * 4) : 0), { anim: Math.floor(t) % 3 === 2 ? 'walk' : 'idle', t, team: 0 }));
        view.append(el(`div.item-row${p.petId === id ? '.equipped-row' : ''}`, null,
          el('div.ir-icon', null, cv),
          el('div.ir-main', null, el('b', { text: pet.name }), el('small', { text: pet.dmg ? `${pet.hp} HP · ${pet.dmg} dmg${pet.flying ? ' · flying' : ''}` : `${pet.hp} HP · helper` }), el('p', { text: pet.desc })),
          itemAction(app, 'pet', id, owned, p.petId === id, pet.price, render)));
      }
    }

    render();
    return stopAll;
  },
};

function itemAction(app, kind, id, owned, equipped, price, rerender) {
  if (equipped) return el('span.equipped', { text: 'Equipped' });
  if (owned) return el('button.btn.btn-blue.btn-small', { type: 'button', onclick: () => {
    equip(kind, id);
    app.sfx('ui_click');
    rerender();
  } }, 'Equip');
  return el('button.btn.btn-gold.btn-small', { type: 'button', disabled: !canAfford(price), onclick: () => {
    if (buyItem(kind, id)) {
      app.sfx('coin');
      rerender();
    }
  } }, priceTag(price));
}
