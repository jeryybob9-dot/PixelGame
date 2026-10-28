// Pixel skin editor: paint your hero on a 12x16 grid with the game palette.

import { el, clear } from '../core/util.js';
import { HEROES } from '../data/heroes.js';
import { PALETTE } from '../art/palette.js';
import { defaultSkin, drawHero } from '../art/sprite-cache.js';
import { getProfile, setHeroSkin } from '../core/profile.js';
import { animatedCanvas } from './components.js';

const W = 12;
const H = 16;

export const skinScreen = {
  mount(root, app, params = {}) {
    const heroId = params.heroId || getProfile().heroId;
    const hero = HEROES[heroId];
    const saved = getProfile().heroes[heroId]?.skin;
    let base;
    try {
      base = defaultSkin(heroId);
    } catch {
      base = Array.from({ length: H }, () => '.'.repeat(W));
    }
    let grid = (saved || base).map((row) => row.padEnd(W, '.').slice(0, W).split(''));
    const history = [];
    let tool = 'pen';
    let color = firstColor();
    let mirror = false;
    let dirty = false;

    function firstColor() {
      for (const row of base) for (const ch of row) if (ch !== '.') return ch;
      return Object.keys(PALETTE)[0];
    }
    const colorOf = (ch) => (ch === '.' ? 'transparent' : PALETTE[ch] || (ch === 'T' ? '#3b7dd8' : ch === 't' ? '#23468c' : ch === 'L' ? '#7fb8ff' : '#ff00ff'));
    const skinRows = () => grid.map((r) => r.join(''));

    // board
    const board = el('div.skin-board', { style: { '--w': String(W), '--h': String(H) } });
    const cells = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = el('div.skin-cell', { dataset: { x: String(x), y: String(y) } });
        cells.push(c);
        board.appendChild(c);
      }
    }
    const paintAll = () => {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const ch = grid[y][x];
        const c = cells[y * W + x];
        c.style.background = ch === '.' ? '' : colorOf(ch);
        c.classList.toggle('empty', ch === '.');
      }
    };
    paintAll();

    const pushHistory = () => {
      history.push(grid.map((r) => r.slice()));
      if (history.length > 40) history.shift();
    };
    const setPixel = (x, y, ch) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      grid[y][x] = ch;
      if (mirror) grid[y][W - 1 - x] = ch;
    };
    const fill = (x, y, ch) => {
      const target = grid[y][x];
      if (target === ch) return;
      const stack = [[x, y]];
      while (stack.length) {
        const [cx, cy] = stack.pop();
        if (cx < 0 || cy < 0 || cx >= W || cy >= H || grid[cy][cx] !== target) continue;
        grid[cy][cx] = ch;
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
    };
    const apply = (x, y, first) => {
      if (tool === 'pick') {
        if (grid[y][x] !== '.') {
          color = grid[y][x];
          tool = 'pen';
          renderTools();
        }
        return;
      }
      if (first) pushHistory();
      if (tool === 'fill') fill(x, y, color);
      else setPixel(x, y, tool === 'erase' ? '.' : color);
      dirty = true;
      paintAll();
    };
    let painting = false;
    const cellAt = (ev) => {
      const r = board.getBoundingClientRect();
      const x = Math.floor(((ev.clientX - r.left) / r.width) * W);
      const y = Math.floor(((ev.clientY - r.top) / r.height) * H);
      return x >= 0 && y >= 0 && x < W && y < H ? { x, y } : null;
    };
    board.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      board.setPointerCapture?.(ev.pointerId);
      const c = cellAt(ev);
      if (!c) return;
      painting = tool === 'pen' || tool === 'erase';
      apply(c.x, c.y, true);
    });
    board.addEventListener('pointermove', (ev) => {
      if (!painting) return;
      const c = cellAt(ev);
      if (c) apply(c.x, c.y, false);
    });
    const stop = () => (painting = false);
    board.addEventListener('pointerup', stop);
    board.addEventListener('pointercancel', stop);

    // palette & tools
    const paletteEl = el('div.skin-palette');
    const toolsEl = el('div.skin-tools');
    const keys = [...Object.keys(PALETTE), 'T', 't', 'L'];
    function renderTools() {
      clear(paletteEl);
      for (const k of keys) {
        paletteEl.appendChild(el(`button.swatch${k === color && tool !== 'erase' ? '.on' : ''}${'TtL'.includes(k) ? '.team' : ''}`, {
          type: 'button', style: { background: colorOf(k) }, 'aria-label': `Color ${k}`, title: 'TtL'.includes(k) ? 'Team color (blue for you, red for enemies)' : '',
          onclick: () => {
            color = k;
            if (tool === 'erase' || tool === 'pick') tool = 'pen';
            renderTools();
          },
        }));
      }
      clear(toolsEl);
      const tb = (id, label) => el(`button.tool${tool === id ? '.on' : ''}`, { type: 'button', onclick: () => {
        tool = id;
        renderTools();
      } }, label);
      toolsEl.append(
        tb('pen', 'Pen'), tb('erase', 'Eraser'), tb('fill', 'Fill'), tb('pick', 'Pick'),
        el(`button.tool${mirror ? '.on' : ''}`, { type: 'button', onclick: () => {
          mirror = !mirror;
          renderTools();
        } }, 'Mirror'),
        el('button.tool', { type: 'button', onclick: () => {
          const prev = history.pop();
          if (prev) {
            grid = prev;
            paintAll();
          }
        } }, 'Undo'),
        el('button.tool', { type: 'button', onclick: () => {
          pushHistory();
          grid = base.map((r) => r.split(''));
          dirty = true;
          paintAll();
        } }, 'Reset'));
    }
    renderTools();

    const preview = animatedCanvas(84, 22, 3, (ctx, t) => {
      const skin = skinRows();
      for (let f = 1; f <= 3; f++) drawHero(ctx, { heroId, form: f, skin, x: 14 + (f - 1) * 28, y: 20, anim: Math.floor(t / 1.5) % 2 ? 'walk' : 'idle', t, team: 0, weaponId: getProfile().weaponId, aim: 0 });
    });

    const save = () => {
      setHeroSkin(heroId, skinRows());
      dirty = false;
      app.sfx('form_upgrade');
      app.toast('Skin saved! Your hero wears it in battle.', 'good');
    };
    const back = async () => {
      if (dirty) {
        const yes = await app.confirm({ title: 'Save your skin?', text: 'You have unsaved changes.', yes: 'Save', no: 'Discard' });
        if (yes) save();
      }
      app.go('home', { tab: 'hero' });
    };

    root.append(el('div.skin-editor', null,
      el('header.sub-head', null, el('button.icon-btn.back', { type: 'button', 'aria-label': 'Back', onclick: back }, '‹'), el('h1', { text: `${hero.name} Skin` }), el('button.btn.btn-gold.btn-small', { type: 'button', onclick: save }, 'Save')),
      el('div.skin-preview', null, preview, el('small', { text: 'Forms 1 · 2 · 3 add their outfit on top of your skin' })),
      board, toolsEl, paletteEl));
    return () => preview.stop?.();
  },
};
