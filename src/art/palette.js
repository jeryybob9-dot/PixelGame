/**
 * Brickbox Royale — master pixel palette.
 *
 * Every sprite row in src/art/sprites.js is a string of single-character palette keys.
 *   '.'  transparent
 *   'T'  team main   't' team dark   'L' team light   (blue for team 0, red for team 1, grey for null)
 * Everything else maps to a fixed colour in PALETTE.
 *
 * Lighting convention for all art: light from the top-left; outlines use 'o' (deep plum, never pure black).
 */

/** Fixed colours. Ramps are listed light -> dark in the comments. */
export const PALETTE = Object.freeze({
  // outline + neutrals (w > g > G > d > k > o)
  o: '#2a1b33', // outline: deep plum
  k: '#3f2f55', // near-black cloth / deep shadow
  d: '#5d5a7c', // dark stone / iron
  G: '#8f8eab', // stone / steel
  g: '#c8c9dc', // light steel
  w: '#fbf7ef', // white
  // skin (s > S)
  s: '#ffd2a6',
  S: '#e0956a',
  // wood / leather / hair (b > B > n)
  b: '#d49b5a',
  B: '#94603a',
  n: '#5c3a2a',
  // reds (r > R)
  r: '#ee4a3d',
  R: '#a32e3b',
  // brick / orange (a > A)
  a: '#f0873c',
  A: '#b5532f',
  // gold / yellow (h > y > Y)
  h: '#fff5bf',
  y: '#ffd84d',
  Y: '#d8901f',
  // greens (v > V > m)
  v: '#8de05e',
  V: '#43a047',
  m: '#24603f',
  // ice / water blues (i > c > C > x)
  i: '#e2f8ff',
  c: '#66dcff',
  C: '#2f86d6',
  x: '#283a80',
  // purples / pinks (q > e > p > P)
  q: '#ff86cf',
  e: '#e04adf',
  p: '#a65ef0',
  P: '#62309a',
  // bone (u > U)
  u: '#f0e6c8',
  U: '#b9a888',
  // teal crystal
  j: '#3be8d0',
});

/** Team colour sets used for the reserved chars T / t / L. Key `null` (string 'null') = neutral. */
export const TEAM_COLORS = Object.freeze({
  0: Object.freeze({ main: '#3b7dd8', dark: '#23468c', light: '#7fb8ff' }),
  1: Object.freeze({ main: '#d8453b', dark: '#8c2a23', light: '#ff8a7f' }),
  null: Object.freeze({ main: '#8f8eab', dark: '#5d5a7c', light: '#c8c9dc' }),
});

/** Card / item rarity colours (match the CSS theme). */
export const RARITY_COLORS = Object.freeze({
  common: '#b9c3cf',
  rare: '#f2a33a',
  epic: '#b45be8',
  legendary: '#3be8d0',
  mythic: '#ff4ad2',
});

/**
 * Element colours. `chars` are the palette keys used when an element colour is painted into a
 * sprite grid (hero form overlays, tower gems).
 */
export const ELEMENT_COLORS = Object.freeze({
  fire: Object.freeze({ main: '#f0873c', dark: '#a32e3b', light: '#ffd84d', chars: { main: 'a', dark: 'R', light: 'y' } }),
  ice: Object.freeze({ main: '#66dcff', dark: '#2f86d6', light: '#e2f8ff', chars: { main: 'c', dark: 'C', light: 'i' } }),
  lightning: Object.freeze({ main: '#ffd84d', dark: '#d8901f', light: '#fff5bf', chars: { main: 'y', dark: 'Y', light: 'h' } }),
  earth: Object.freeze({ main: '#43a047', dark: '#5c3a2a', light: '#8de05e', chars: { main: 'V', dark: 'n', light: 'v' } }),
  shadow: Object.freeze({ main: '#a65ef0', dark: '#62309a', light: '#ff86cf', chars: { main: 'p', dark: 'P', light: 'q' } }),
});

/** Chars a sprite row may contain. */
export const SPRITE_CHARS = Object.freeze(['.', 'T', 't', 'L', ...Object.keys(PALETTE)]);

/** Outline colour key. */
export const OUTLINE = 'o';

const rgbCache = new Map();

/**
 * Parse '#rrggbb' to [r, g, b].
 * @param {string} hex
 * @returns {[number, number, number]}
 */
export function hexToRgb(hex) {
  let v = rgbCache.get(hex);
  if (!v) {
    const n = parseInt(hex.slice(1), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, v);
  }
  return v;
}

/**
 * [r, g, b] (0..255) to '#rrggbb'.
 * @param {number} r @param {number} g @param {number} b
 */
export function rgbToHex(r, g, b) {
  const c = (x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

/**
 * Linear blend of two hex colours.
 * @param {string} a @param {string} b @param {number} t 0 = a, 1 = b
 */
export function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

/**
 * Lighten (amt > 0, toward white) or darken (amt < 0, toward the outline plum) a colour.
 * @param {string} hex @param {number} amt -1..1
 */
export function shade(hex, amt) {
  return amt >= 0 ? mix(hex, '#ffffff', amt) : mix(hex, '#1a1022', -amt);
}

/**
 * Team colour set for a team id (0, 1 or null/undefined = neutral).
 * @param {0|1|null|undefined} team
 */
export function teamColors(team) {
  return TEAM_COLORS[team === 0 || team === 1 ? team : 'null'];
}

/**
 * Resolve a palette char to a hex colour, or null for transparent / unknown chars.
 * @param {string} ch
 * @param {0|1|null} [team]
 * @returns {string|null}
 */
export function colorOf(ch, team = null) {
  if (ch === '.' || ch === ' ' || ch === '_') return null;
  if (ch === 'T') return teamColors(team).main;
  if (ch === 't') return teamColors(team).dark;
  if (ch === 'L') return teamColors(team).light;
  return PALETTE[ch] ?? null;
}

/** Palette chars offered by the skin editor (everything but team chars), in a pleasant order. */
export const SKIN_EDITOR_CHARS = Object.freeze([
  '.', 'o', 'k', 'd', 'G', 'g', 'w', 's', 'S', 'b', 'B', 'n', 'r', 'R', 'a', 'A', 'y', 'Y', 'h',
  'v', 'V', 'm', 'i', 'c', 'C', 'x', 'q', 'e', 'p', 'P', 'u', 'U', 'j', 'T', 't', 'L',
]);
