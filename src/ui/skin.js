// UI skin: paints the pixel-art textures the interface is built from (wood planks, parchment, the night brick wall
// and steel corner brackets) and hands them to the stylesheet as CSS custom properties. Everything is drawn at
// 1 texel per pixel and scaled up crisp, so the menus match the pixel-art world.

const OUTLINE = '#2b1409';

/** Small deterministic generator so the textures look the same on every launch. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  return { c, ctx, px: (x, y, col, ww = 1, hh = 1) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, ww, hh);
  } };
}

/** Horizontal planks with grain, knots, butt joints and bevelled seams. */
function planks({ seed, tones, grain, shine, seam, w = 64, plank = 12, rows = 4 }) {
  const r = rng(seed);
  const h = plank * rows;
  const { c, px } = canvas(w, h);
  for (let p = 0; p < rows; p++) {
    const y0 = p * plank;
    const base = tones[p % tones.length];
    px(0, y0, base, w, plank);
    // grain streaks
    for (let i = 0; i < 26; i++) {
      const gy = y0 + 2 + Math.floor(r() * (plank - 4));
      const gx = Math.floor(r() * w);
      const len = 3 + Math.floor(r() * 12);
      px(gx, gy, r() < 0.7 ? grain : shine, len, 1);
      if (gx + len > w) px(0, gy, r() < 0.7 ? grain : shine, gx + len - w, 1);
    }
    // a knot now and then
    if (r() < 0.6) {
      const kx = 4 + Math.floor(r() * (w - 10));
      const ky = y0 + 4 + Math.floor(r() * (plank - 8));
      px(kx, ky, seam, 3, 2);
      px(kx - 1, ky + 1, grain, 1, 1);
      px(kx + 3, ky, grain, 1, 1);
      px(kx + 1, ky - 1, shine, 1, 1);
    }
    // bevel: light top edge, dark seam at the bottom
    px(0, y0, shine, w, 1);
    px(0, y0 + plank - 1, seam, w, 1);
    px(0, y0 + plank - 2, grain, w, 1);
    // butt joint
    const jx = Math.floor(r() * (w - 4)) + 2;
    px(jx, y0 + 1, seam, 1, plank - 2);
    px(jx + 1, y0 + 1, shine, 1, plank - 2);
    // nails at the joint
    px(jx - 2, y0 + 3, seam, 1, 1);
    px(jx + 3, y0 + plank - 4, seam, 1, 1);
  }
  return c.toDataURL();
}

function parchment() {
  const r = rng(77);
  const w = 64;
  const { c, px } = canvas(w, w);
  px(0, 0, '#f3dcab', w, w);
  for (let i = 0; i < 520; i++) {
    const x = Math.floor(r() * w);
    const y = Math.floor(r() * w);
    const v = r();
    px(x, y, v < 0.55 ? '#ebcd93' : v < 0.85 ? '#f8e8c2' : '#dfbd7f');
  }
  // fibres
  for (let i = 0; i < 18; i++) {
    const x = Math.floor(r() * w);
    const y = Math.floor(r() * w);
    px(x, y, '#e2c287', 2 + Math.floor(r() * 5), 1);
  }
  return c.toDataURL();
}

/** The night brick wall behind every menu. */
function wall() {
  const r = rng(9);
  const bw = 16;
  const bh = 8;
  const { c, px } = canvas(bw * 4, bh * 4);
  const tones = ['#212a46', '#242e4d', '#1e2741', '#273253', '#202944'];
  px(0, 0, '#121829', bw * 4, bh * 4);
  for (let row = 0; row < 4; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let i = -1; i < 5; i++) {
      const x = i * bw + off;
      const y = row * bh;
      const tone = tones[Math.floor(r() * tones.length)];
      px(x + 1, y + 1, tone, bw - 1, bh - 1);
      px(x + 1, y + 1, '#2d3a5f', bw - 2, 1);
      px(x + 1, y + bh - 1, '#181f36', bw - 1, 1);
      if (r() < 0.5) px(x + 3 + Math.floor(r() * 9), y + 3 + Math.floor(r() * 3), '#1a2239', 2, 1);
    }
  }
  return c.toDataURL();
}

/** Steel corner bracket with two rivets (top-left; the others are mirrored). */
function bracket(flipX, flipY) {
  const n = 12;
  const { c, ctx } = canvas(n, n);
  ctx.translate(flipX ? n : 0, flipY ? n : 0);
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  const px = (x, y, col, w = 1, h = 1) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
  };
  // outline
  px(0, 0, OUTLINE, n, 6);
  px(0, 0, OUTLINE, 6, n);
  // plate
  px(1, 1, '#aeb9c3', n - 2, 4);
  px(1, 1, '#aeb9c3', 4, n - 2);
  px(1, 1, '#e4ebf0', n - 2, 1);
  px(1, 1, '#e4ebf0', 1, n - 2);
  px(1, 4, '#76828e', n - 2, 1);
  px(4, 4, '#76828e', 1, n - 5);
  // rivets
  for (const [x, y] of [[2, 2], [8, 2], [2, 8]]) {
    px(x, y, '#3d464f', 2, 2);
    px(x, y, '#f4f8fa', 1, 1);
  }
  return c.toDataURL();
}

/** A gold coin-like stud for plaque ends. */
function stud() {
  const { c, px } = canvas(6, 6);
  px(1, 0, OUTLINE, 4, 6);
  px(0, 1, OUTLINE, 6, 4);
  px(1, 1, '#f5a623', 4, 4);
  px(1, 1, '#ffe27a', 2, 2);
  px(3, 4, '#b8650d', 2, 1);
  return c.toDataURL();
}

let installed = false;

/** Paint the textures and expose them to CSS. Safe to call more than once. */
export function installSkin() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  try {
    const root = document.documentElement.style;
    const url = (d) => `url("${d}")`;
    root.setProperty('--tex-wood', url(planks({ seed: 3, tones: ['#b0632e', '#a95c2a', '#b66a33', '#a35626'], grain: '#8d4a21', shine: '#c97a3e', seam: '#5a2a10' })));
    root.setProperty('--tex-wood-dark', url(planks({ seed: 5, tones: ['#6d3519', '#73391c', '#683218', '#70371a'], grain: '#58290f', shine: '#8a4a24', seam: '#381808' })));
    root.setProperty('--tex-parch', url(parchment()));
    root.setProperty('--tex-wall', url(wall()));
    root.setProperty('--corner-tl', url(bracket(false, false)));
    root.setProperty('--corner-tr', url(bracket(true, false)));
    root.setProperty('--corner-bl', url(bracket(false, true)));
    root.setProperty('--corner-br', url(bracket(true, true)));
    root.setProperty('--stud', url(stud()));
  } catch {
    /* no canvas: the stylesheet falls back to flat colours */
  }
}
