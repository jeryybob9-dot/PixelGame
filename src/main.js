// Boot: fonts, app shell, screens.

import { el } from './core/util.js';
import { App } from './ui/app.js';
import { homeScreen } from './ui/home.js';
import { battleScreen } from './ui/battle-screen.js';
import { realmScreen } from './ui/realm-screen.js';
import { luckyScreen } from './ui/lucky.js';
import { skinScreen } from './ui/skin-editor.js';
import { godboxScreen } from './ui/godbox-screen.js';
import { getProfile, saveNow } from './core/profile.js';
import { drawHero, drawSprite } from './art/sprite-cache.js';
import { animatedCanvas } from './ui/components.js';
import { installSkin } from './ui/skin.js';

const titleScreen = {
  mount(root, app) {
    const p = getProfile();
    const scene = animatedCanvas(120, 50, 3, (ctx, t) => {
      // a tiny village: keep, a villager hauling bricks, the hero facing a wolf, and a god-power meteor
      drawSprite(ctx, 'keep', 20, 46, { team: 0, t });
      drawSprite(ctx, 'house', 48, 46, { team: 0, t });
      const vx = 40 + ((t * 8) % 30);
      drawSprite(ctx, 'villager', vx, 47, { anim: 'carry', t, team: 0 });
      drawHero(ctx, { heroId: p.heroId, form: 1 + (Math.floor(t / 2.5) % 3), skin: p.heroes[p.heroId]?.skin, x: 78, y: 47, anim: 'shoot', t, team: 0, weaponId: p.weaponId, aim: 0 });
      drawSprite(ctx, 'wolf', 104 + Math.sin(t * 3) * 3, 47, { anim: 'walk', t, team: null, flip: true });
      const m = (t * 0.7) % 1;
      drawSprite(ctx, 'fireball', 70 + m * 40, -6 + m * 48, { t, scale: 1 });
      drawSprite(ctx, 'temple', 104, 22, { team: null, t, scale: 0.8 });
    });
    // a brand-new player goes straight into the guided training match
    const go = () => {
      app.sfx('fight');
      if (getProfile().tutorialDone) app.go('home');
      else app.go('realm', { mode: 'training' });
    };
    root.append(el('div.title', { onclick: go },
      el('div.title-bricks'),
      el('div.title-sign', null,
        el('h1.logo', null, el('span.logo-1', { text: 'BRICKBOX' }), el('span.logo-2', { text: 'TINY GODS' })),
        el('div.title-scene', null, scene)),
      el('p.title-tag', { text: 'Knock down the red castle!' }),
      el('button.btn.btn-gold.btn-big.pulse', { type: 'button', onclick: (e) => {
        e.stopPropagation();
        go();
      } }, 'Tap to Play'),
      el('small.title-ver', { text: 'v2.0' })));
    return () => scene.stop?.();
  },
};

async function boot() {
  const root = document.getElementById('app');
  if (!root) return;
  root.textContent = '';
  installSkin();
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
  app.register('realm', realmScreen);
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
