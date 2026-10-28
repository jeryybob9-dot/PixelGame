// After the training match: Foreman Bo opens the first Lucky Drop with the player, then walks them through the menus
// one tap at a time (upgrade a card, the hero, the shop's free gift, quests) and ends on the REALM CLASH button.

import { el } from '../core/util.js';
import { getProfile, cardLevel, freeGiftReadyIn, setName, finishTutorial } from '../core/profile.js';
import { Guide } from './guide.js';

const $ = (sel) => () => document.querySelector(sel);
const tabActive = (id) => () => !!document.querySelector(`.tab.active[data-tab="${id}"]`);
const tapTab = (id, text) => ({
  text,
  target: () => [{ at: $(`.tab[data-tab="${id}"]`), pass: true }],
  hand: { type: 'tap', at: $(`.tab[data-tab="${id}"]`) },
  next: tabActive(id),
  skipIf: tabActive(id),
});

/** Guide the first Lucky Drop. `state()` returns the drop screen's phase: 'upgrade' | 'ready' | 'open'. */
export function guideFirstDrop(app, state) {
  const guide = new Guide(app);
  guide.run([
    {
      text: 'Your first reward: a LUCKY DROP! Tap it up to 3 times. Each tap might upgrade it!',
      target: () => [{ at: $('.lucky-chest'), pass: true }],
      hand: { type: 'tap', at: $('.lucky-chest') },
      next: () => state() !== 'upgrade',
      delay: 0.4,
    },
    {
      text: 'Lucky! Now tap it to open.',
      target: () => [{ at: $('.lucky-chest'), pass: true }],
      hand: { type: 'tap', at: $('.lucky-chest') },
      next: () => state() === 'open',
      delay: 0.3,
    },
    { overlay: false, next: () => !!document.querySelector('.lucky-actions .btn') },
    {
      text: 'Gold, gems and cards! Tap COLLECT.',
      target: () => [{ at: $('.lucky-actions .btn'), pass: true }, $('.lucky-loot')],
      hand: { type: 'tap', at: $('.lucky-actions .btn') },
      next: () => false,
    },
  ]);
  return () => guide.destroy();
}

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
    { text: 'Welcome home! This is your base. Let me show you around.', next: 'tap', bubble: 'mid', delay: 0.3 },
    { text: 'This is your REALM. Each Realm has its own island, rival and cards.', target: $('.arena-card'), next: 'tap' },
    { text: 'Win battles to earn TROPHIES. More trophies unlock new Realms with new cards!', target: $('.arena-trophies'), next: 'tap' },

    // cards
    tapTab('cards', 'Let\'s make your troops stronger. Tap CARDS.'),
    {
      text: 'You got extra Knights from that drop, so your Knight can level up. Tap it!',
      skipIf: () => cardLevel('knight') >= 2,
      target: () => [{ at: $('.deck-grid .card-tile[data-card="knight"]'), pass: true }],
      hand: { type: 'tap', at: $('.deck-grid .card-tile[data-card="knight"]') },
      next: () => !!document.querySelector('.card-sheet'),
    },
    {
      text: 'Tap UPGRADE. Upgraded cards have more health and damage in battle.',
      skipIf: () => cardLevel('knight') >= 2,
      inModal: true,
      bubble: 'top',
      target: () => [{ at: $('.card-sheet .cd-upgrade'), pass: true }],
      hand: { type: 'tap', at: $('.card-sheet .cd-upgrade') },
      next: () => cardLevel('knight') >= 2,
    },
    {
      text: 'Level 2! Upgrading also gives you King XP. Close this card.',
      skipIf: () => !document.querySelector('.card-sheet'),
      inModal: true,
      bubble: 'bottom',
      target: () => [{ at: $('.card-sheet .modal-x'), pass: true }],
      hand: { type: 'tap', at: $('.card-sheet .modal-x') },
      next: () => !document.querySelector('.card-sheet'),
    },
    { text: 'This is your DECK: the 8 cards you take into battle. Tap any card to see it, swap it or upgrade it.', target: $('.deck-grid'), next: 'tap' },
    { text: 'New cards you find go in your COLLECTION down here.', target: $('.tab-cards .section-title'), next: 'tap' },

    // hero
    tapTab('hero', 'Now tap HERO.'),
    { text: 'Choose your hero, weapon, gadget and pet here. Unlock more with gold and gems!', target: $('.tab-hero .subtabs'), next: 'tap', delay: 0.2 },

    // shop
    tapTab('shop', 'Let\'s visit the SHOP. Tap it!'),
    {
      text: 'There\'s a FREE GIFT here every 4 hours. Open it!',
      skipIf: () => freeGiftReadyIn() > 0,
      target: () => [{ at: $('.gift .btn'), pass: true }],
      hand: { type: 'tap', at: $('.gift .btn') },
      next: () => app.current === 'lucky',
      delay: 0.2,
    },
    {
      text: 'Tap to open your gift!',
      skipIf: () => app.current !== 'lucky',
      target: () => [{ at: $('.lucky-chest'), pass: true }],
      hand: { type: 'tap', at: $('.lucky-chest') },
      next: () => !!document.querySelector('.lucky-actions .btn'),
      delay: 0.4,
    },
    {
      text: 'Collect it!',
      skipIf: () => app.current !== 'lucky',
      target: () => [{ at: $('.lucky-actions .btn'), pass: true }],
      hand: { type: 'tap', at: $('.lucky-actions .btn') },
      next: () => app.current === 'home',
    },
    { text: 'The shop also has DAILY DEALS for gold, and treasure for gems. Nothing costs real money.', target: $('.tab-shop .deals'), next: 'tap', delay: 0.3 },

    // quests
    tapTab('quests', 'Tap QUESTS.'),
    { text: 'Finish DAILY QUESTS for gold and gems, then tap CLAIM. The Trophy Road has prizes too!', target: () => document.querySelectorAll('.tab-quests .quest')[0] ? [...document.querySelectorAll('.tab-quests .quest')].slice(0, 3) : null, next: 'tap', delay: 0.2 },

    // battle
    tapTab('battle', 'Back to BATTLE!'),
    { text: 'More ways to play: survive HORDE NIGHTS, mess around in the GOD BOX, or replay TRAINING.', target: $('.mode-grid'), next: 'tap', delay: 0.2 },
    {
      text: 'You\'re ready! Tap REALM CLASH to fight your first real rival. Good luck!',
      target: () => [{ at: $('.btn-battle'), pass: true }],
      hand: { type: 'tap', at: $('.btn-battle') },
      next: () => app.current === 'realm',
    },
  ], { onDone: end, onSkip: end });
}
