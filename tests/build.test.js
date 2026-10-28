// Packaging tests: production build output (dist/), PWA manifest + icons, and the dev server.
// Runs `node scripts/build.mjs` once, then inspects dist/.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const read = (p) => fs.readFileSync(path.join(DIST, p), 'utf8');

/** Blank out <script>/<style> contents so assertions only look at the markup itself. */
const markupOnly = (html) => html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '<$1></$1>');

/** Width, height and colour type from a PNG's IHDR chunk. */
function pngInfo(file) {
  const b = fs.readFileSync(file);
  assert.deepEqual([...b.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${file} is not a PNG`);
  assert.equal(b.toString('ascii', 12, 16), 'IHDR');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25] };
}

before(() => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], { cwd: ROOT, stdio: 'pipe' });
});

test('dist contains every packaged file', () => {
  for (const f of ['index.html', 'artifact.html', 'manifest.webmanifest', 'sw.js', 'icons/icon-192.png', 'icons/icon-512.png',
    'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png']) {
    assert.ok(fs.existsSync(path.join(DIST, f)), `missing dist/${f}`);
  }
});

test('dist/index.html is a complete, self-contained document', () => {
  const html = read('index.html');
  const markup = markupOnly(html);
  assert.match(html, /^<!doctype html>/i);
  assert.match(markup, /<html\b[^>]*>[\s\S]*<head>[\s\S]*<\/head>[\s\S]*<body>[\s\S]*<\/body>[\s\S]*<\/html>/i);
  assert.match(markup, /<meta charset="utf-8">/i);
  assert.match(markup, /<meta name="viewport"[^>]*viewport-fit=cover/i);
  assert.match(markup, /<meta name="apple-mobile-web-app-capable" content="yes">/i);
  assert.match(markup, /<meta name="theme-color" content="#14121f">/i);
  assert.match(markup, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(markup, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png">/);
  assert.match(markup, /<div id="app"><\/div>/);

  // Nothing loaded from elsewhere: no external script/stylesheet, no http(s) or protocol-relative src/href.
  assert.doesNotMatch(markup, /<script\b[^>]*\bsrc\s*=/i, 'scripts must be inlined');
  assert.doesNotMatch(markup, /<link\b[^>]*rel=["']?stylesheet/i, 'styles must be inlined');
  assert.doesNotMatch(markup, /\b(?:src|href)\s*=\s*["']?(?:https?:)?\/\//i, 'no external URLs');
  assert.doesNotMatch(html, /url\(\s*["']?(?:https?:)?\/\//i, 'CSS must not load external URLs');

  // Inline <style> with fonts as data URIs, inline <script>.
  assert.match(html, /<style>[\s\S]*@font-face[\s\S]*<\/style>/);
  const fontURIs = html.match(/url\(\s*["']?data:font\/(?:ttf|otf|woff2?);base64,/g) || [];
  assert.ok(fontURIs.length >= 2, `expected >= 2 inlined fonts, found ${fontURIs.length}`);
  assert.match(html, /<script>[\s\S]+<\/script>/);
});

test('dist/index.html registers the service worker only behind guards', () => {
  const html = read('index.html');
  assert.match(html, /'serviceWorker'\s*in\s*navigator/);
  assert.match(html, /location\.protocol\.startsWith\('http'\)/);
  assert.match(html, /try\{[^]*serviceWorker\.register\('sw\.js'\)\.catch\(/);
});

test('dist/artifact.html is an HTML fragment fit for a Claude Artifact', () => {
  const html = read('artifact.html');
  const markup = markupOnly(html);
  assert.ok(html.startsWith('<title>Brickbox: Tiny Gods</title>'), 'fragment must start with <title>');
  assert.match(markup, /<meta name="claude:viewport-fit-sides" content="cover">/);
  assert.doesNotMatch(markup, /<!doctype/i);
  assert.doesNotMatch(markup, /<\/?html[\s>]/i);
  assert.doesNotMatch(markup, /<\/?head[\s>]/i);
  assert.doesNotMatch(markup, /<\/?body[\s>]/i);
  assert.match(markup, /<style><\/style>\s*<div id="app"><\/div>\s*<script><\/script>/, 'order: style, #app, script');
  assert.doesNotMatch(markup, /manifest|serviceWorker|\bsw\.js/);
  assert.doesNotMatch(html, /serviceWorker\.register/);
  assert.doesNotMatch(markup, /\b(?:src|href)\s*=\s*["']?(?:https?:)?\/\//i, 'no external URLs');
  assert.doesNotMatch(markup, /<script\b[^>]*\bsrc\s*=/i);
  assert.doesNotMatch(markup, /<link\b/i);
  assert.ok((html.match(/data:font\//g) || []).length >= 2, 'fonts inlined');
  assert.ok(Buffer.byteLength(html) < 16 * 1024 * 1024, 'must stay under the 16 MB Artifact limit');
});

test('manifest is valid and its icons exist', () => {
  for (const dir of [path.join(ROOT, 'public'), DIST]) {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.webmanifest'), 'utf8'));
    assert.equal(m.name, 'Brickbox: Tiny Gods');
    assert.equal(m.short_name, 'Brickbox');
    assert.equal(m.display, 'fullscreen');
    assert.ok(Array.isArray(m.display_override) && m.display_override.includes('standalone'));
    assert.equal(m.orientation, 'portrait');
    assert.equal(m.background_color, '#14121f');
    assert.equal(m.theme_color, '#14121f');
    assert.equal(m.start_url, '.');
    assert.equal(m.scope, '.');
    const has = (size, purpose) => m.icons.some((i) => i.sizes === size && (i.purpose || 'any').split(' ').includes(purpose));
    assert.ok(has('192x192', 'any'), '192 icon');
    assert.ok(has('512x512', 'any'), '512 icon');
    assert.ok(has('512x512', 'maskable'), 'maskable 512 icon');
    for (const icon of m.icons) {
      const file = path.join(dir, icon.src);
      assert.ok(fs.existsSync(file), `${path.relative(ROOT, file)} is missing`);
      const [w, h] = icon.sizes.split('x').map(Number);
      const info = pngInfo(file);
      assert.equal(info.width, w, `${icon.src} width`);
      assert.equal(info.height, h, `${icon.src} height`);
    }
  }
});

test('icons have the right sizes; full-bleed icons have no alpha channel', () => {
  const icons = path.join(ROOT, 'public', 'icons');
  const expect = {
    'favicon-32.png': 32,
    'icon-192.png': 192,
    'icon-512.png': 512,
    'icon-maskable-512.png': 512,
    'apple-touch-icon.png': 180,
  };
  for (const [f, size] of Object.entries(expect)) {
    const info = pngInfo(path.join(icons, f));
    assert.equal(info.width, size, f);
    assert.equal(info.height, size, f);
  }
  assert.equal(pngInfo(path.join(icons, 'apple-touch-icon.png')).colorType, 2, 'apple-touch-icon must be RGB (no alpha)');
  assert.equal(pngInfo(path.join(icons, 'icon-maskable-512.png')).colorType, 2, 'maskable icon must be opaque');
  const iosIcon = path.join(ROOT, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
  if (fs.existsSync(iosIcon)) {
    const info = pngInfo(iosIcon);
    assert.deepEqual([info.width, info.height, info.colorType], [1024, 1024, 2], 'iOS app icon: 1024x1024 RGB');
  }
});

test('service worker is version-stamped by the build', () => {
  const sw = read('sw.js');
  const m = sw.match(/const VERSION = '([^']*)';/);
  assert.ok(m, 'VERSION line present');
  assert.notEqual(m[1], 'dev', 'build must replace the dev version');
  assert.match(m[1], /^[0-9a-f]{12}$/);
  for (const entry of ["'./index.html'", "'./manifest.webmanifest'", "'./icons/icon-192.png'"]) assert.ok(sw.includes(entry), entry);
});

test('dev server serves the repo with correct MIME types and no caching', async (t) => {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve.mjs'), '--port', '0'], {
    cwd: ROOT,
    env: { ...process.env, QUIET: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  const port = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`server did not start: ${out}`)), 5000);
    child.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/http:\/\/localhost:(\d+)\//);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    child.on('exit', (code) => reject(new Error(`server exited (${code}): ${out}`)));
  });
  const base = `http://127.0.0.1:${port}`;
  const cases = [
    ['/', /^text\/html/],
    ['/src/main.js', /^text\/javascript/],
    ['/src/ui/styles.css', /^text\/css/],
    ['/assets/fonts/PressStart2P-Regular.ttf', /^font\/ttf/],
    ['/public/manifest.webmanifest', /^application\/manifest\+json/],
    ['/public/icons/icon-192.png', /^image\/png/],
  ];
  for (const [url, type] of cases) {
    const res = await fetch(base + url);
    assert.equal(res.status, 200, url);
    assert.match(res.headers.get('content-type'), type, url);
    assert.match(res.headers.get('cache-control'), /no-store/, url);
    await res.arrayBuffer();
  }
  assert.equal((await fetch(`${base}/nope.js`)).status, 404);
  assert.equal((await fetch(`${base}/%2e%2e/%2e%2e/etc/passwd`)).status === 200, false, 'no path traversal');
});
