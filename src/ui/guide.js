// Guided tutorial overlay: dims the screen except the thing to touch, shows a pointing hand and a speech bubble from
// Foreman Bo, and blocks every other touch until the step is done. Used by the training match and the menu tour.
//
// A step:
//   text      what Bo says
//   target    () => item | item[]; an item is an Element, a client rect {x, y, w, h}, or { at, pass, ring, pad }
//             (`pass` lets touches through to the game; info steps never pass)
//   next      'tap' (tap anywhere to continue) or () => boolean (polled every frame)
//   hand      { type: 'tap', at } | { type: 'drag', from, to, ghost } | { type: 'joy', at }; points are Elements,
//             rects or () => either
//   enter / exit, skipIf, delay (s before showing), minTime (s before `next` can finish the step),
//   timeout (s, then advance), onTimeout
//   overlay   false: no dim and no blocking (the player plays freely while `next` is polled)
//   bubble    'top' | 'bottom' | 'auto' | 'none'
//   inModal   keep the overlay up while a modal sheet is open (otherwise it steps aside)

import { el } from '../core/util.js';
import { drawSprite } from '../art/sprite-cache.js';
import { animatedCanvas } from './components.js';

// 14 x 18 pixel glove: o outline, w white, s shade, b cuff. The fingertip is at (4.5, 0).
const HAND_ROWS = [
  '....oo........',
  '...owwo.......',
  '...owwo.......',
  '...owwo.......',
  '...owwoooooo..',
  '...owwowwowwo.',
  '.ooowwowwowwoo',
  'owwowwwwwwwwwo',
  'owwwwwwwwwwwwo',
  'owwwwwwwwwwwwo',
  '.owwwwwwwwwwso',
  '.owwwwwwwwwsso',
  '..owwwwwwwsso.',
  '...owwwwwsso..',
  '...ooooooooo..',
  '...obbbbbbbo..',
  '...obbbbbbbo..',
  '...ooooooooo..',
];
const HAND_COLORS = { o: '#1a1426', w: '#ffffff', s: '#c9c3d9', b: '#3a7be0' };
const HAND_SCALE = 3;
const TIP = { x: 4.5 * HAND_SCALE, y: 0.5 * HAND_SCALE };

function handCanvas() {
  const w = HAND_ROWS[0].length;
  const h = HAND_ROWS.length;
  const c = el('canvas.gd-hand-art', { width: w, height: h });
  c.style.width = `${w * HAND_SCALE}px`;
  c.style.height = `${h * HAND_SCALE}px`;
  const ctx = c.getContext('2d');
  HAND_ROWS.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = HAND_COLORS[row[x]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return c;
}

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const SVGNS = 'http://www.w3.org/2000/svg';

export class Guide {
  /** @param {import('./app.js').App} app */
  constructor(app) {
    this.app = app;
    this.svg = document.createElementNS(SVGNS, 'svg');
    this.svg.setAttribute('class', 'gd-dim');
    this.dimPath = document.createElementNS(SVGNS, 'path');
    this.dimPath.setAttribute('fill-rule', 'evenodd');
    this.svg.appendChild(this.dimPath);
    this.blockers = el('div.gd-blockers');
    this.rings = el('div.gd-rings');
    this.handArt = handCanvas();
    this.ghost = el('img.gd-ghost', { alt: '', hidden: true });
    this.hand = el('div.gd-hand', { hidden: true }, this.ghost, this.handArt);
    this.ripple = el('div.gd-ripple', { hidden: true });
    this.joyBase = el('div.gd-joy', { hidden: true });
    this.textEl = el('p.gd-text');
    this.nextEl = el('div.gd-next', { text: 'Tap to continue ▸' });
    this.skipBtn = el('button.gd-skip', { type: 'button', hidden: true }, 'Skip tutorial');
    const portrait = animatedCanvas(20, 22, 3, (ctx, t) => drawSprite(ctx, 'builder', 10, 21, { anim: Math.floor(t / 1.6) % 3 === 2 ? 'walk' : 'idle', t, team: 0 }));
    this.portrait = portrait;
    this.bubble = el('div.gd-bubble', { hidden: true },
      el('div.gd-face', null, portrait),
      el('div.gd-body', null, el('b.gd-name', { text: 'Foreman Bo' }), this.textEl, this.nextEl),
      this.skipBtn);
    this.root = el('div.gd', { hidden: true }, this.svg, this.blockers, this.rings, this.joyBase, this.ripple, this.hand, this.bubble);
    app.root.appendChild(this.root);

    this.steps = [];
    this.i = -1;
    this.step = null;
    this.stepT = 0;
    this.shown = false;
    this.typed = 0;
    this.hintSpec = null;
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
    if (globalThis.__BBR) globalThis.__BBR.guide = this; // test hook

    const onTap = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.tap();
    };
    this.blockers.addEventListener('pointerdown', onTap);
    this.bubble.addEventListener('pointerdown', onTap);
    this.skipBtn.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    this.skipBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.onSkip?.();
    });
  }

  /** Run a list of steps. */
  run(steps, { onDone, onSkip, onStep } = {}) {
    this.steps = steps;
    this.onDone = onDone;
    this.onSkip = onSkip;
    this.onStep = onStep;
    this.skipBtn.hidden = !onSkip;
    this.i = -1;
    this.advance();
  }

  /** A soft hint (hand only, no dim, no blocking) while no step is showing. Pass null to clear it. */
  hint(spec) {
    this.hintSpec = spec;
    this.hintT = 0;
  }

  advance() {
    const prev = this.step;
    if (prev) {
      try {
        prev.exit?.();
      } catch (err) {
        console.error(err);
      }
    }
    this.step = null;
    for (;;) {
      this.i++;
      const s = this.steps[this.i];
      if (!s) {
        this.hide();
        this.onDone?.();
        return;
      }
      let skip = false;
      try {
        skip = !!s.skipIf?.();
      } catch {
        skip = false;
      }
      if (skip) continue;
      this.step = s;
      this.stepT = 0;
      this.scrolledAt = -1;
      this.shown = false;
      this.typed = 0;
      this.onStep?.(this.i, s);
      try {
        s.enter?.();
      } catch (err) {
        console.error(err);
      }
      return;
    }
  }

  tap() {
    const s = this.step;
    if (!s || !this.shown) return;
    if (this.typed < (s.text || '').length) {
      this.typed = (s.text || '').length;
      this.textEl.textContent = s.text;
      return;
    }
    if (s.next === 'tap' && this.stepT > 0.45) {
      this.app.sfx('ui_click', { volume: 0.5 });
      this.advance();
    }
  }

  hide() {
    this.root.hidden = true;
    this.hand.hidden = true;
    this.ripple.hidden = true;
    this.joyBase.hidden = true;
    this.bubble.hidden = true;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.portrait.stop?.();
    this.root.remove();
    this.step = null;
  }

  // ───────────── geometry ─────────────

  rootRect() {
    return this.app.root.getBoundingClientRect();
  }

  /** Resolve one target item into { x, y, w, h, pass, ring } in root coordinates (or null). */
  resolve(item, rr) {
    try {
      return this.resolveItem(item, rr);
    } catch {
      return null; // a target that is not on screen yet
    }
  }

  resolveItem(item, rr) {
    if (!item) return null;
    let it = typeof item === 'function' ? item() : item;
    if (!it) return null;
    let pass = false;
    let ring = true;
    let pad = 6;
    if (!(it instanceof Element) && it.at !== undefined) {
      pass = !!it.pass;
      ring = it.ring !== false;
      pad = it.pad ?? pad;
      it = typeof it.at === 'function' ? it.at() : it.at;
      if (!it) return null;
    }
    let r;
    if (it instanceof Element) {
      if (!it.isConnected || it.hidden) return null;
      const b = it.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) return null;
      r = { x: b.left, y: b.top, w: b.width, h: b.height };
    } else r = it;
    return { x: r.x - rr.left - pad, y: r.y - rr.top - pad, w: r.w + pad * 2, h: r.h + pad * 2, pass, ring };
  }

  /** A point (root coordinates) for the hand: centre of an element or rect, or an {x, y} point in client space. */
  point(p, rr) {
    let v;
    try {
      v = typeof p === 'function' ? p() : p;
    } catch {
      return null;
    }
    if (!v) return null;
    if (v instanceof Element) {
      if (!v.isConnected) return null;
      const b = v.getBoundingClientRect();
      return { x: b.left + b.width / 2 - rr.left, y: b.top + b.height / 2 - rr.top };
    }
    if (v.w != null) return { x: v.x + v.w / 2 - rr.left, y: v.y + v.h / 2 - rr.top };
    return { x: v.x - rr.left, y: v.y - rr.top };
  }

  // ───────────── frame ─────────────

  frame(now) {
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const s = this.step;
    if (!s) {
      this.drawHint(dt);
      return;
    }
    this.stepT += dt;
    let done = false;
    if (typeof s.next === 'function' && this.stepT >= (s.minTime || 0)) {
      try {
        done = !!s.next();
      } catch {
        done = false;
      }
    }
    if (!done && s.timeout && this.stepT > s.timeout) {
      try {
        s.onTimeout?.();
      } catch (err) {
        console.error(err);
      }
      done = true;
    }
    if (done) {
      this.advance();
      return;
    }
    if (this.stepT < (s.delay || 0)) {
      this.hide();
      return;
    }
    const modalUp = this.app.modals.childElementCount > 0 && !s.inModal;
    if (s.overlay === false || modalUp) {
      this.hide();
      if (s.overlay === false && !modalUp && s.text && s.bubble !== 'none') {
        // a non-blocking tip: bubble only
        this.root.hidden = false;
        this.svg.style.display = 'none';
        this.blockers.hidden = true;
        this.rings.hidden = true;
        this.showBubble(s, [], dt);
        this.drawHand(s.hand, this.rootRect(), dt);
      }
      return;
    }
    if (!this.shown) {
      this.shown = true;
      this.app.sfx('card_select', { volume: 0.35, pitch: 1.4 });
    }
    this.root.hidden = false;
    this.svg.style.display = '';
    this.blockers.hidden = false;
    this.rings.hidden = false;
    const rr = this.rootRect();
    let raw = [];
    try {
      raw = (typeof s.target === 'function' ? s.target() : s.target) || [];
    } catch {
      raw = [];
    }
    const list = Array.isArray(raw) ? raw : [raw];
    this.scrollIntoView(list, rr);
    const items = list.map((it) => this.resolve(it, rr)).filter(Boolean);
    this.drawDim(items, rr, s.dim !== false);
    this.drawBlockers(items, rr);
    this.drawRings(items);
    this.showBubble(s, items, dt);
    this.drawHand(s.hand, rr, dt);
  }

  /** Touch targets can sit below the fold, and the overlay blocks scrolling: bring them into view. */
  scrollIntoView(list, rr) {
    if (this.stepT < (this.scrolledAt ?? -1) + 0.8) return;
    for (const item of list) {
      if (!item || !item.pass) continue;
      let el = item.at;
      try {
        el = typeof el === 'function' ? el() : el;
      } catch {
        el = null;
      }
      if (!(el instanceof Element) || !el.isConnected) continue;
      const b = el.getBoundingClientRect();
      if (b.top < rr.top || b.bottom > rr.bottom) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        this.scrolledAt = this.stepT;
      }
    }
  }

  drawDim(items, rr, dim) {
    const W = rr.width;
    const H = rr.height;
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.svg.setAttribute('width', String(W));
    this.svg.setAttribute('height', String(H));
    if (!dim) {
      this.dimPath.setAttribute('d', '');
      return;
    }
    let d = `M0 0H${W}V${H}H0Z`;
    for (const r of items) {
      const rad = Math.min(12, r.w / 2, r.h / 2);
      const x = r.x;
      const y = r.y;
      d += `M${x + rad} ${y}H${x + r.w - rad}A${rad} ${rad} 0 0 1 ${x + r.w} ${y + rad}V${y + r.h - rad}A${rad} ${rad} 0 0 1 ${x + r.w - rad} ${y + r.h}H${x + rad}A${rad} ${rad} 0 0 1 ${x} ${y + r.h - rad}V${y + rad}A${rad} ${rad} 0 0 1 ${x + rad} ${y}Z`;
    }
    this.dimPath.setAttribute('d', d);
  }

  /** Cover everything except the holes that let touches through. */
  drawBlockers(items, rr) {
    const W = rr.width;
    const H = rr.height;
    const holes = items.filter((r) => r.pass).map((r) => ({ x0: Math.max(0, r.x), y0: Math.max(0, r.y), x1: Math.min(W, r.x + r.w), y1: Math.min(H, r.y + r.h) }));
    const rects = [];
    const ys = [...new Set([0, H, ...holes.flatMap((h) => [h.y0, h.y1])])].filter((y) => y >= 0 && y <= H).sort((a, b) => a - b);
    for (let i = 0; i < ys.length - 1; i++) {
      const y0 = ys[i];
      const y1 = ys[i + 1];
      if (y1 - y0 < 0.5) continue;
      const cut = holes.filter((h) => h.y0 <= y0 && h.y1 >= y1).sort((a, b) => a.x0 - b.x0);
      let x = 0;
      for (const h of cut) {
        if (h.x0 > x) rects.push([x, y0, h.x0 - x, y1 - y0]);
        x = Math.max(x, h.x1);
      }
      if (x < W) rects.push([x, y0, W - x, y1 - y0]);
    }
    const kids = this.blockers.children;
    while (kids.length < rects.length) this.blockers.appendChild(el('div.gd-block'));
    for (let i = 0; i < kids.length; i++) {
      const k = /** @type {HTMLElement} */ (kids[i]);
      const r = rects[i];
      if (!r) {
        k.style.display = 'none';
        continue;
      }
      k.style.display = '';
      k.style.transform = `translate(${r[0]}px, ${r[1]}px)`;
      k.style.width = `${r[2]}px`;
      k.style.height = `${r[3]}px`;
    }
  }

  drawRings(items) {
    const list = items.filter((r) => r.ring);
    const kids = this.rings.children;
    while (kids.length < list.length) this.rings.appendChild(el('div.gd-ring'));
    for (let i = 0; i < kids.length; i++) {
      const k = /** @type {HTMLElement} */ (kids[i]);
      const r = list[i];
      if (!r) {
        k.style.display = 'none';
        continue;
      }
      k.style.display = '';
      k.style.transform = `translate(${r.x}px, ${r.y}px)`;
      k.style.width = `${r.w}px`;
      k.style.height = `${r.h}px`;
    }
  }

  showBubble(s, items, dt) {
    if (!s.text || s.bubble === 'none') {
      this.bubble.hidden = true;
      return;
    }
    this.bubble.hidden = false;
    const n = s.text.length;
    if (this.typed < n) {
      this.typed = Math.min(n, this.typed + dt * 70);
      this.textEl.textContent = s.text.slice(0, Math.ceil(this.typed));
    } else if (this.textEl.textContent !== s.text) this.textEl.textContent = s.text;
    this.nextEl.hidden = s.next !== 'tap' || this.typed < n;
    let side = s.bubble || 'auto';
    if (side === 'auto') {
      const H = this.rootRect().height;
      const main = items[0];
      side = main && main.y + main.h / 2 > H * 0.5 ? 'top' : 'bottom';
      if (!main) side = 'bottom';
    }
    this.bubble.classList.toggle('top', side === 'top');
    this.bubble.classList.toggle('mid', side === 'mid');
  }

  drawHint(dt) {
    const h = this.hintSpec;
    if (!h) {
      if (!this.root.hidden) this.hide();
      return;
    }
    this.hintT = (this.hintT || 0) + dt;
    this.root.hidden = false;
    this.svg.style.display = 'none';
    this.blockers.hidden = true;
    this.rings.hidden = true;
    this.bubble.hidden = true;
    this.drawHand(h, this.rootRect(), dt, this.hintT);
  }

  drawHand(h, rr, dt, tOverride) {
    if (!h) {
      this.hand.hidden = true;
      this.ripple.hidden = true;
      this.joyBase.hidden = true;
      return;
    }
    const t = tOverride ?? this.stepT;
    const place = (x, y, press) => {
      this.hand.hidden = false;
      this.hand.style.transform = `translate(${x - TIP.x}px, ${y - TIP.y + (press ? 3 : 0)}px) scale(${press ? 0.92 : 1})`;
    };
    if (h.type === 'tap') {
      const p = this.point(h.at, rr);
      if (!p) {
        this.hand.hidden = true;
        this.ripple.hidden = true;
        return;
      }
      const c = t % 1.1;
      const lift = c < 0.45 ? (1 - c / 0.45) * 16 : c < 0.6 ? 0 : ((c - 0.6) / 0.5) * 16;
      this.hand.hidden = false;
      this.hand.style.opacity = '1';
      this.hand.style.transform = `translate(${p.x - TIP.x + 6}px, ${p.y - TIP.y + 4 + lift}px)`;
      this.ghost.hidden = true;
      this.ripple.hidden = false;
      this.ripple.style.transform = `translate(${p.x}px, ${p.y}px)`;
      this.joyBase.hidden = true;
      return;
    }
    if (h.type === 'drag') {
      const a = this.point(h.from, rr);
      const b = this.point(h.to, rr);
      if (!a || !b) {
        this.hand.hidden = true;
        return;
      }
      const c = t % 2.4;
      let x = a.x;
      let y = a.y;
      let press = false;
      let alpha = 1;
      if (c < 0.35) press = c > 0.15;
      else if (c < 1.55) {
        const k = ease((c - 0.35) / 1.2);
        x = a.x + (b.x - a.x) * k;
        y = a.y + (b.y - a.y) * k;
        press = true;
      } else {
        x = b.x;
        y = b.y;
        press = c < 1.75;
        alpha = c > 2.0 ? Math.max(0, 1 - (c - 2.0) / 0.4) : 1;
      }
      const src = typeof h.ghost === 'function' ? h.ghost() : h.ghost;
      this.ghost.hidden = !src || !press;
      if (src && this.ghost.getAttribute('src') !== src) this.ghost.src = src;
      place(x, y, press);
      this.hand.style.opacity = String(alpha);
      this.ripple.hidden = false;
      this.ripple.style.transform = `translate(${b.x}px, ${b.y}px)`;
      this.joyBase.hidden = true;
      return;
    }
    if (h.type === 'joy') {
      const p = this.point(h.at, rr);
      if (!p) return;
      const c = t % 2.2;
      const k = c < 0.3 ? 0 : c < 1.3 ? ease((c - 0.3) / 1.0) : c < 1.7 ? 1 : 1 - ease((c - 1.7) / 0.5);
      const ang = -Math.PI / 2 + Math.sin(t * 1.3) * 0.6;
      const r = 42 * k;
      this.joyBase.hidden = false;
      this.joyBase.style.transform = `translate(${p.x}px, ${p.y}px)`;
      place(p.x + Math.cos(ang) * r, p.y + Math.sin(ang) * r, c > 0.2 && c < 1.9);
      this.hand.style.opacity = '1';
      this.ghost.hidden = true;
      this.ripple.hidden = true;
    }
  }
}
