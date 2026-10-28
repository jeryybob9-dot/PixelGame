#!/usr/bin/env node
// Brickbox Royale icon generator — zero dependencies (node:zlib + a hand-rolled CRC32 PNG encoder).
//
// Renders an original 32x32 pixel-art icon (a chunky orange toy brick with studs, wearing a golden crown,
// on a deep-purple background split blue/red for the two teams) and scales it up with integer
// nearest-neighbour into every icon the web app and the iOS app need:
//
//   public/icons/favicon-32.png           32x32   rounded corners (alpha)
//   public/icons/icon-192.png            192x192  rounded corners (alpha)   manifest "any"
//   public/icons/icon-512.png            512x512  rounded corners (alpha)   manifest "any"
//   public/icons/icon-maskable-512.png   512x512  full bleed, art inside the 80% safe circle
//   public/icons/apple-touch-icon.png    180x180  full bleed, opaque RGB (no alpha)
//   ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png  1024x1024 opaque RGB
//       (+ Contents.json) — only when the Capacitor ios/ project exists.
//   ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732*.png  launch image: art on flat #14121f
//
// Run: npm run icons

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------------------------
// PNG encoder
// ---------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC32 (ISO-HDLC, as used by PNG) of one or more buffers. */
export function crc32(...bufs) {
  let c = 0xffffffff;
  for (const buf of bufs) for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeBuf, data));
  return Buffer.concat([len, typeBuf, data, crc]);
}

/**
 * Encode an RGBA pixel buffer as PNG.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba width*height*4 bytes
 * @param {{ alpha?: boolean }} [opts] alpha=false writes colour type 2 (RGB, no alpha channel at all)
 * @returns {Buffer}
 */
export function encodePNG(width, height, rgba, { alpha = true } = {}) {
  const channels = alpha ? 4 : 3;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    raw[row] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const di = row + 1 + x * channels;
      raw[di] = rgba[si];
      raw[di + 1] = rgba[si + 1];
      raw[di + 2] = rgba[si + 2];
      if (alpha) raw[di + 3] = rgba[si + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = alpha ? 6 : 2; // colour type: RGBA / RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------------------------
// The artwork (32x32 logical pixels). '.' = background shows through.
// ---------------------------------------------------------------------------------------------

const hex = (h, a = 255) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];

const PAL = {
  k: hex('#140b12'), // outline
  // brick
  H: hex('#ffc896'),
  h: hex('#ff9c5e'),
  O: hex('#e8743b'),
  o: hex('#bf5524'),
  d: hex('#8c3713'),
  p: hex('#ff8f8f'), // blush
  W: hex('#ffffff'),
  P: hex('#1d1226'), // eyes / mouth
  // crown
  y: hex('#fff3b0'),
  G: hex('#ffcf4a'),
  g: hex('#d8921e'),
  b: hex('#8f5b12'),
  // jewels (team blue, gem cyan, team red)
  u: hex('#7fb8ff'),
  U: hex('#3b7dd8'),
  C: hex('#bdf6ff'),
  c: hex('#4ae3ff'),
  r: hex('#ff8a7f'),
  R: hex('#d8453b'),
  // background sparkles and ground shadow (alpha-blended over the background)
  '*': hex('#cfc6ee', 200),
  '+': hex('#8d84b8', 170),
  s: hex('#05040a', 120),
};

// prettier-ignore
const ART = [
//  01234567890123456789012345678901
  '................................', // 0
  '.....+..........................', // 1
  '....+*+........kk...........*...', // 2
  '.....+........kyGk..............', // 3
  '..........kk..kGGk..kk..........', // 4
  '.........kyGk.kGgk.kyGk.........', // 5
  '.........kGgk.kGGk.kGgk.....+...', // 6
  '.........kGGkkkGGkkkGGk....+*+..', // 7
  '..*......kGGGGGGGGGGGGk.....+...', // 8
  '.........kGyGGGGyGGGGgk.........', // 9
  '....kkkk.kGuuGGCCGGrrgk.kkkk....', // 10
  '...khHHhkkGUUGGccGGRRgkkhHHhk...', // 11
  '...kOOOokkbggggggggggbkkOOOok...', // 12
  '..kkkkkkkkkkkkkkkkkkkkkkkkkkkk..', // 13
  '..kHhhhhhhhhhhhhhhhhhhhhhhhhok..', // 14
  '..khOOOOOOOOOOOOOOOOOOOOOOOook..', // 15
  '..khOOOOOOOOOOOOOOOOOOOOOOOook..', // 16
  '..khOOOOOPWOOOOOOOOOOPWOOOOook..', // 17
  '..khOOOOOPPOOOOOOOOOOPPOOOOook..', // 18
  '..khOOOOOPPOOOOOOOOOOPPOOOOook..', // 19
  '..khOOOppOOOOPOOOOPOOOOppOOook..', // 20
  '..khOOOOOOOOOOPPPPOOOOOOOOOook..', // 21
  '..khOOOOOOOOOOOOOOOOOOOOOOOook..', // 22
  '..khOOOOOOOOOOOOOOOOOOOOOOOook..', // 23
  '..khOOOOOOOOOOOOOOOOOOOOOOOook..', // 24
  '..kooooooooooooooooooooooooodk..', // 25
  '..kddddddddddddddddddddddddddk..', // 26
  '..kkkkkkkkkkkkkkkkkkkkkkkkkkkk..', // 27
  '...ssssssssssssssssssssssssss...', // 28
  '................................', // 29
  '..*..........................+..', // 30
  '................................', // 31
];
for (const [i, row] of ART.entries()) {
  if (row.length !== 32) throw new Error(`make-icons: ART row ${i} is ${row.length} chars, expected 32`);
  for (const ch of row) if (ch !== '.' && !PAL[ch]) throw new Error(`make-icons: unknown palette char "${ch}" in row ${i}`);
}

// ---------------------------------------------------------------------------------------------
// Background: banded radial glow #2f2950 (centre) -> #14121f (edges), with a diagonal blue/red team split.
// Defined for any integer logical coordinate so padded icons (maskable, iOS) extend it seamlessly.
// ---------------------------------------------------------------------------------------------

const BG_IN = hex('#2f2950');
const BG_OUT = hex('#14121f');
const TEAM_BLUE = hex('#3b7dd8');
const TEAM_RED = hex('#d8453b');

const mix = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));

function background(lx, ly) {
  const dx = lx + 0.5 - 16;
  const dy = ly + 0.5 - 15; // glow slightly above centre, behind the crown/brick
  const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 22);
  const band = Math.min(4, Math.floor(d * 5)); // 5 flat bands = pixel-art feel
  let c = mix(BG_IN, BG_OUT, band / 4);
  // Diagonal split: blue team bottom-left, red team top-right. Tint fades with distance from centre.
  const blue = lx - ly < 0 || (lx - ly === 0 && (lx & 1) === 0); // dithered seam
  const tint = 0.24 - band * 0.03;
  c = mix(c, blue ? TEAM_BLUE : TEAM_RED, tint);
  return [c[0], c[1], c[2], 255];
}

/** Is logical pixel (lx, ly) cut away by the stepped rounded corner (radius 3)? */
function cornerCut(lx, ly) {
  const cut = [3, 2, 1]; // pixels removed on rows 0, 1, 2 (and mirrored)
  const ry = ly < 3 ? ly : 31 - ly < 3 ? 31 - ly : -1;
  if (ry < 0) return false;
  const n = cut[ry];
  return lx < n || lx > 31 - n;
}

/**
 * Render the icon.
 * @param {number} size output width/height in px
 * @param {{ scale: number, pad?: number, rounded?: boolean, solid?: number[] }} opts
 *   scale = output px per logical px (integer); pad = output px of background padding around the 32x32 art;
 *   solid = flat RGBA background instead of the banded glow (used for the iOS launch screen).
 */
function render(size, { scale, pad = 0, rounded = false, solid = null }) {
  if (!Number.isInteger(scale) || pad * 2 + 32 * scale !== size) {
    throw new Error(`make-icons: size ${size} != 32*${scale} + 2*${pad}`);
  }
  const out = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    const ly = Math.floor((py - pad) / scale);
    for (let px = 0; px < size; px++) {
      const lx = Math.floor((px - pad) / scale);
      const i = (py * size + px) * 4;
      if (rounded && cornerCut(lx, ly)) continue; // transparent
      let c = solid || background(lx, ly);
      const inArt = lx >= 0 && lx < 32 && ly >= 0 && ly < 32;
      const ch = inArt ? ART[ly][lx] : '.';
      if (ch !== '.') {
        const f = PAL[ch];
        const a = f[3] / 255;
        c = [0, 1, 2].map((k) => Math.round(f[k] * a + c[k] * (1 - a))).concat(255);
      }
      out[i] = c[0];
      out[i + 1] = c[1];
      out[i + 2] = c[2];
      out[i + 3] = c[3];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------------------------

const ICONS_DIR = path.join(ROOT, 'public', 'icons');

const TARGETS = [
  { file: path.join(ICONS_DIR, 'favicon-32.png'), size: 32, scale: 1, rounded: true },
  { file: path.join(ICONS_DIR, 'icon-192.png'), size: 192, scale: 6, rounded: true },
  { file: path.join(ICONS_DIR, 'icon-512.png'), size: 512, scale: 16, rounded: true },
  // Maskable: art 320px centred -> every opaque art pixel stays inside the 80% (r = 204.8px) safe circle.
  { file: path.join(ICONS_DIR, 'icon-maskable-512.png'), size: 512, scale: 10, pad: 96, alpha: false },
  { file: path.join(ICONS_DIR, 'apple-touch-icon.png'), size: 180, scale: 5, pad: 10, alpha: false },
];

const IOS_ICONSET = path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset');
const IOS_ICON_NAME = 'AppIcon-512@2x.png';
if (fs.existsSync(path.join(ROOT, 'ios', 'App', 'App'))) {
  // App Store icons must be 1024x1024 with no alpha channel; iOS applies its own rounded mask.
  TARGETS.push({ file: path.join(IOS_ICONSET, IOS_ICON_NAME), size: 1024, scale: 30, pad: 32, alpha: false });
}

// iOS launch screen (LaunchScreen.storyboard shows it aspect-fill on a #14121f view). The art is 768px in the
// middle of 2732px so it stays inside the visible centre column of a portrait phone (~46% of the width).
const IOS_SPLASHSET = path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets', 'Splash.imageset');
if (fs.existsSync(IOS_SPLASHSET)) {
  let names = ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'];
  try {
    const listed = JSON.parse(fs.readFileSync(path.join(IOS_SPLASHSET, 'Contents.json'), 'utf8'))
      .images.map((im) => im.filename)
      .filter(Boolean);
    if (listed.length) names = listed;
  } catch {
    /* keep the Capacitor template names */
  }
  for (const name of names) {
    TARGETS.push({ file: path.join(IOS_SPLASHSET, name), size: 2732, scale: 24, pad: 982, alpha: false, solid: hex('#14121f') });
  }
}

fs.mkdirSync(ICONS_DIR, { recursive: true });
for (const t of TARGETS) {
  const rgba = render(t.size, { scale: t.scale, pad: t.pad ?? 0, rounded: !!t.rounded, solid: t.solid });
  const png = encodePNG(t.size, t.size, rgba, { alpha: t.alpha !== false });
  fs.mkdirSync(path.dirname(t.file), { recursive: true });
  fs.writeFileSync(t.file, png);
  console.log(`  ${path.relative(ROOT, t.file).padEnd(64)} ${String(t.size).padStart(4)}px  ${(png.length / 1024).toFixed(1)} KB`);
}

if (fs.existsSync(IOS_ICONSET)) {
  // Single-size universal app icon (Xcode 14+ generates every other size from the 1024 image).
  const contents = {
    images: [{ filename: IOS_ICON_NAME, idiom: 'universal', platform: 'ios', size: '1024x1024' }],
    info: { author: 'xcode', version: 1 },
  };
  fs.writeFileSync(path.join(IOS_ICONSET, 'Contents.json'), JSON.stringify(contents, null, 2) + '\n');
  // Remove stale icons from the Capacitor template so the asset catalog only holds ours.
  for (const f of fs.readdirSync(IOS_ICONSET)) {
    if (f.endsWith('.png') && f !== IOS_ICON_NAME) fs.rmSync(path.join(IOS_ICONSET, f));
  }
  console.log(`  ${path.relative(ROOT, path.join(IOS_ICONSET, 'Contents.json'))}`);
}
