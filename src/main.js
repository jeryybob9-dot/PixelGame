// Boot: fonts, app shell, screens.

import { el } from './core/util.js';
import { App } from './ui/app.js';
import { homeScreen } from './ui/home.js';
import { battleScreen } from './ui/battle-screen.js';
import { luckyScreen } from './ui/lucky.js';
import { skinScreen } from './ui/skin-editor.js';
import { godboxScreen } from './ui/godbox-screen.js';
import { getProfile, saveNow } from './core/profile.js';
import { drawHero, drawSprite } from './art/sprite-cache.js';
import { animatedCanvas } from './ui/components.js';

const titleScreen = {
  mount(root, app) {
    const p = getProfile();
    const scene = animatedCanvas(120, 44, 3, (ctx, t) => {
      // a little showdown: hero vs a giant, sheep bouncing between them
      drawHero(ctx, { heroId: p.heroId, form: 1 + (Math.floor(t / 2.5) % 3), skin: p.heroes[p.heroId]?.skin, x: 26, y: 40, anim: 'shoot', t, team: 0, weaponId: p.weaponId, aim: -0.1 });
      drawSprite(ctx, 'giant', 96, 40, { anim: 'walk', t, team: 1, flip: true });
      drawSprite(ctx, 'sheep', 60 + Math.sin(t * 2) * 14, 40 - Math.abs(Math.sin(t * 5)) * 8, { anim: 'walk', t, team: null, flip: Math.cos(t * 2) < 0 });
      drawSprite(ctx, 'dragon', 70 + Math.sin(t) * 30, 14 + Math.sin(t * 2) * 3, { anim: 'walk', t, team: 1, flip: Math.cos(t) < 0 });
    });
    const go = () => {
      app.sfx('fight');
      app.go('home');
    };
    root.append(el('div.title', { onclick: go },
      el('div.title-bricks'),
      el('h1.logo', null, el('span.logo-1', { text: 'BRICKBOX' }), el('span.logo-2', { text: 'ROYALE' })),
      el('div.title-scene', null, scene),
      el('p.title-tag', { text: 'Cards. Heroes. Bricks. God powers.' }),
      el('button.btn.btn-gold.btn-big.pulse', { type: 'button', onclick: (e) => {
        e.stopPropagation();
        go();
      } }, 'Tap to Play'),
      el('small.title-ver', { text: 'v1.0' })));
    return () => scene.stop?.();
  },
};

async function boot() {
  const root = document.getElementById('app');
  if (!root) return;
  root.textContent = '';
  try {
    await Promise.race([
      Promise.all([document.fonts.load('16px "Press Start 2P"'), document.fonts.load('16px "Pixelify Sans"')]),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch {
    /* fonts are optional */
  }
  const app = new App(root);
  app.register('title', titleScreen);
  app.register('home', homeScreen);
  app.register('battle', battleScreen);
  app.register('lucky', luckyScreen);
  app.register('skin', skinScreen);
  app.register('godbox', godboxScreen);
  app.go('title');
  // test/debug hook
  globalThis.__BBR = { app, profile: getProfile };
  window.addEventListener('beforeunload', () => saveNow());
}

const hot = globalThis.claude?.hot;
if (hot?.ready) hot.ready(boot);
else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
