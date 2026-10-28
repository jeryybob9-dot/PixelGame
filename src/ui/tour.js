// After the training match: ask for a name and show the one thing the menus don't make obvious (levelling a card up
// with the copies from the first Lucky Drop). Everything else is left for the player to find.

import { el } from '../core/util.js';
import { getProfile, cardLevel, setName, finishTutorial } from '../core/profile.js';
import { Guide } from './guide.js';

const $ = (sel) => () => document.querySelector(sel);
const tabActive = (id) => () => !!document.querySelector(`.tab.active[data-tab="${id}"]`);

let active = null;

/** Start the menu tour if the player has finished training but not seen the menus yet. */
export function maybeStartTour(app) {
  const p = getProfile();
  if (active || !p.tutorialDone || p.tourDone) return;
  const guide = new Guide(app);
  active = guide;
  let named = p.name !== 'Brick Rookie';
  const end = () => {
    finishTutorial(true);
    guide.destroy();
    active = null;
  };
  guide.run([
    {
      overlay: false,
      skipIf: () => named,
      enter: () => {
        const input = el('input.text-input', { type: 'text', maxlength: '16', placeholder: 'Your name', 'aria-label': 'Your name', autocomplete: 'off' });
        const ok = () => {
          if (input.value.trim()) setName(input.value);
          named = true;
          close();
        };
        input.addEventListener('keydown', (ev) => ev.key === 'Enter' && ok());
        const body = el('div.name-pick', null,
          el('p', { text: 'Every tiny god needs a name. You can change it later in Settings.' }),
          input,
          el('button.btn.btn-gold.btn-big', { type: 'button', onclick: ok }, 'OK'));
        const close = app.modal(body, { title: 'What\'s your name?', dismissable: false });
        setTimeout(() => input.focus(), 50);
      },
      next: () => named,
    },
    // one real lesson: the drop gave extra Knights, so level the Knight up
    {
      text: 'Your reward had extra Knights. Level your Knight up: it gets stronger in every battle!',
      skipIf: () => cardLevel('knight') >= 2,
      target: () => [{ at: $('.tab[data-tab="cards"]'), pass: true }],
      hand: { type: 'tap', at: $('.tab[data-tab="cards"]') },
      next: tabActive('cards'),
      delay: 0.3,
    },
    {
      bubble: 'none',
      skipIf: () => cardLevel('knight') >= 2,
      target: () => [{ at: $('.deck-grid .card-tile[data-card="knight"]'), pass: true }],
      hand: { type: 'tap', at: $('.deck-grid .card-tile[data-card="knight"]') },
      next: () => !!document.querySelector('.card-sheet'),
    },
    {
      bubble: 'none',
      skipIf: () => cardLevel('knight') >= 2,
      inModal: true,
      target: () => [{ at: $('.card-sheet .cd-upgrade'), pass: true }],
      hand: { type: 'tap', at: $('.card-sheet .cd-upgrade') },
      next: () => cardLevel('knight') >= 2,
    },
  ], { onDone: end, onSkip: end });
}
