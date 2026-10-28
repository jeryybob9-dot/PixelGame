#!/usr/bin/env node
// Brickbox Royale production build (esbuild JS API).
//
// Inputs:  index.html (meta tags, <title>, body markup), src/main.js, src/ui/styles.css, public/*, assets/fonts/*
// Outputs: dist/index.html            single self-contained page (inline CSS + JS + base64 fonts) + PWA bits
//          dist/artifact.html         the same game as an HTML fragment for a Claude Artifact (no doctype/html/head/body)
//          dist/manifest.webmanifest, dist/sw.js (version-stamped), dist/icons/*, dist/licenses/*
//
// CSS: src/ui/styles.css is bundled (its @import "./other.css" rules are inlined) and every url() to a font or
// image becomes a base64 data: URI. CSS imported from JS (`import './x.css'`) is also collected and inlined.
// JS:  src/main.js is bundled to one IIFE (target es2020 + safari15). Avoid top-level await and import.meta.
//
// Any esbuild error, missing input, or failed self-check exits with code 1.

import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const DEV_HTML = 'index.html';
const JS_ENTRY = 'src/main.js';
const CSS_ENTRY = 'src/ui/styles.css';
const PUBLIC = 'public';
const FONT_DIR = 'assets/fonts';
const ARTIFACT_LIMIT = 16 * 1024 * 1024; // Claude Artifact page limit

const JS_TARGET = ['es2020', 'safari15'];
const CSS_TARGET = ['safari15', 'chrome100', 'firefox100'];

/** Everything a stylesheet or module might reference gets inlined as a data: URI. */
const ASSET_LOADERS = {
  '.ttf': 'dataurl',
  '.otf': 'dataurl',
  '.woff': 'dataurl',
  '.woff2': 'dataurl',
  '.png': 'dataurl',
  '.jpg': 'dataurl',
  '.jpeg': 'dataurl',
  '.gif': 'dataurl',
  '.webp': 'dataurl',
  '.svg': 'dataurl',
  '.wav': 'dataurl',
  '.mp3': 'dataurl',
  '.ogg': 'dataurl',
  '.m4a': 'dataurl',
  '.txt': 'text',
};

const FONT_CREDITS =
  'Fonts: "Press Start 2P" (c) 2012 The Press Start 2P Project Authors; "Pixelify Sans" (c) 2021 The Pixelify Sans ' +
  'Project Authors. Both licensed under the SIL Open Font License 1.1 (see licenses/ in the build or assets/fonts/ in the source).';

// Registered only over http(s) and only where allowed: never in file://, Capacitor (capacitor://) or iframes
// that forbid it (register() throws or rejects there; both are swallowed).
const SW_REGISTER =
  "if('serviceWorker'in navigator&&location.protocol.startsWith('http'))try{addEventListener('load',function(){" +
  "try{navigator.serviceWorker.register('sw.js').catch(function(){})}catch(e){}})}catch(e){}";

const DEFAULT_META = [
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">',
  '<meta name="theme-color" content="#14121f">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
  '<meta name="apple-mobile-web-app-title" content="Brickbox">',
];

// ---------------------------------------------------------------------------------------------------------------

class BuildError extends Error {}
const fail = (msg) => {
  throw new BuildError(msg);
};
const rel = (p) => path.relative(ROOT, p) || '.';
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);

function requireFile(p) {
  const abs = path.join(ROOT, p);
  if (!fs.existsSync(abs)) fail(`missing input: ${p}`);
  return abs;
}

/** Meta tags, title, lang and body markup from the dev index.html, so both entry points stay in sync. */
function readDevShell() {
  const html = fs.readFileSync(requireFile(DEV_HTML), 'utf8');
  const metaKey = (tag) => {
    if (/\bcharset\s*=/i.test(tag)) return 'charset';
    const m = tag.match(/\b(?:name|property|http-equiv)\s*=\s*["']([^"']+)["']/i);
    return m ? m[1].toLowerCase() : tag;
  };
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const have = new Set(metas.map(metaKey));
  for (const d of DEFAULT_META) if (!have.has(metaKey(d))) metas.push(d);
  // charset must come first
  metas.sort((a, b) => (metaKey(b) === 'charset') - (metaKey(a) === 'charset'));

  const title = (html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? 'Brickbox Royale').trim();
  const lang = html.match(/<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i)?.[1] ?? 'en';
  let body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? '';
  body = body
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .trim();
  if (!body) body = '<div id="app"></div>';
  if (!/\bid\s*=\s*["']app["']/.test(body)) console.warn(`  ! ${DEV_HTML} body has no #app element`);
  return { metas, title, lang, body };
}

async function bundleJS() {
  requireFile(JS_ENTRY);
  const result = await esbuild.build({
    absWorkingDir: ROOT,
    entryPoints: [JS_ENTRY],
    bundle: true,
    format: 'iife',
    target: JS_TARGET,
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    banner: { js: '"use strict";' }, // keep ES-module strictness after IIFE conversion
    loader: ASSET_LOADERS,
    outdir: 'dist/.bundle', // not written (write: false); needed if JS imports CSS (second output file)
    write: false,
    metafile: true,
    logLevel: 'warning',
  });
  const js = result.outputFiles.filter((f) => f.path.endsWith('.js')).map((f) => f.text).join('\n');
  const css = result.outputFiles.filter((f) => f.path.endsWith('.css')).map((f) => f.text).join('\n');
  const importsCssEntry = Object.keys(result.metafile.inputs).some((p) => path.normalize(p) === path.normalize(CSS_ENTRY));
  return { js, css, importsCssEntry, inputs: Object.keys(result.metafile.inputs).length };
}

async function bundleCSS() {
  requireFile(CSS_ENTRY);
  const result = await esbuild.build({
    absWorkingDir: ROOT,
    entryPoints: [CSS_ENTRY],
    bundle: true,
    minify: true,
    target: CSS_TARGET,
    loader: ASSET_LOADERS,
    outdir: 'dist/.bundle',
    write: false,
    logLevel: 'warning',
  });
  return result.outputFiles.filter((f) => f.path.endsWith('.css')).map((f) => f.text).join('\n');
}

/** Make text safe to place inside <script>/<style> raw-text elements. */
const inlineJS = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const inlineCSS = (s) => s.replace(/<\/(style)/gi, '<\\/$1');

/** Remove <script>/<style> contents so the remaining markup can be checked for external references. */
const stripRawText = (html) => html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '<$1></$1>');

function checkSelfContained(name, html, css) {
  const shell = stripRawText(html);
  const ext = shell.match(/\b(?:src|href|srcset|poster|action)\s*=\s*["']?\s*(?:https?:)?\/\/[^"'\s>]*/gi);
  if (ext) fail(`${name} references external URLs: ${ext.join(', ')}`);
  const cssExt = css.match(/(?:url\(\s*["']?\s*(?:https?:)?\/\/|@import\s+["'](?:https?:)?\/\/)[^)"';]*/gi);
  if (cssExt) fail(`${name} CSS references external URLs: ${cssExt.join(', ')}`);
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return [];
  fs.mkdirSync(to, { recursive: true });
  const out = [];
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const a = path.join(from, ent.name);
    const b = path.join(to, ent.name);
    if (ent.isDirectory()) out.push(...copyDir(a, b));
    else {
      fs.copyFileSync(a, b);
      out.push(b);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------

async function main() {
  const t0 = performance.now();
  const shell = readDevShell();

  const bundled = await bundleJS();
  const cssParts = [];
  if (!bundled.importsCssEntry) cssParts.push(await bundleCSS());
  if (bundled.css) cssParts.push(bundled.css);
  const css = cssParts.join('\n').trim();
  const js = bundled.js.trim();
  if (!js) fail(`${JS_ENTRY} produced an empty bundle`);
  if (!/@font-face/.test(css) || !/url\(\s*["']?data:font\//.test(css)) {
    console.warn('  ! CSS has no inlined @font-face data URIs (fonts will fall back to system fonts)');
  }

  const style = `<style>${inlineCSS(css)}</style>`;
  const script = `<script>${inlineJS(js)}</script>`;

  const indexHtml = [
    '<!doctype html>',
    `<html lang="${shell.lang}">`,
    '<head>',
    ...shell.metas,
    `<title>${shell.title}</title>`,
    `<!-- ${FONT_CREDITS} -->`,
    '<link rel="manifest" href="manifest.webmanifest">',
    '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">',
    '<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">',
    '<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">',
    style,
    '</head>',
    '<body>',
    shell.body,
    script,
    `<script>${SW_REGISTER}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');

  // Claude Artifact fragment: the host wraps it in its own document skeleton.
  const artifactHtml = [
    `<title>${shell.title}</title>`,
    '<meta name="claude:viewport-fit-sides" content="cover">',
    style,
    shell.body,
    script,
    `<!-- ${FONT_CREDITS} -->`,
    '',
  ].join('\n');

  // Self-checks before anything is written.
  checkSelfContained('dist/index.html', indexHtml, css);
  checkSelfContained('dist/artifact.html', artifactHtml, css);
  if (/<!doctype|<\/?html[\s>]|<\/?head[\s>]|<\/?body[\s>]/i.test(stripRawText(artifactHtml))) {
    fail('dist/artifact.html must not contain doctype/html/head/body tags');
  }
  if (/manifest|serviceWorker/.test(stripRawText(artifactHtml))) fail('dist/artifact.html must not reference manifest/SW');
  const artifactBytes = Buffer.byteLength(artifactHtml);
  if (artifactBytes >= ARTIFACT_LIMIT) fail(`dist/artifact.html is ${kb(artifactBytes)} (limit ${kb(ARTIFACT_LIMIT)})`);

  const manifestPath = requireFile(path.join(PUBLIC, 'manifest.webmanifest'));
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    fail(`public/manifest.webmanifest is not valid JSON: ${e.message}`);
  }
  for (const icon of manifest.icons || []) requireFile(path.join(PUBLIC, icon.src));

  const swSrc = fs.readFileSync(requireFile(path.join(PUBLIC, 'sw.js')), 'utf8');
  const version = crypto.createHash('sha256').update(indexHtml).digest('hex').slice(0, 12);
  const sw = swSrc.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`);
  if (sw === swSrc) fail("public/sw.js: could not find the `const VERSION = '...';` line to stamp");

  // Write.
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  const written = [];
  const write = (name, data) => {
    const p = path.join(DIST, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
    written.push(p);
  };
  write('index.html', indexHtml);
  write('artifact.html', artifactHtml);
  write('manifest.webmanifest', JSON.stringify(manifest, null, 2) + '\n');
  write('sw.js', sw);
  written.push(...copyDir(path.join(ROOT, PUBLIC, 'icons'), path.join(DIST, 'icons')));
  for (const f of fs.existsSync(path.join(ROOT, FONT_DIR)) ? fs.readdirSync(path.join(ROOT, FONT_DIR)) : []) {
    if (/^OFL.*\.txt$/i.test(f)) write(path.join('licenses', f), fs.readFileSync(path.join(ROOT, FONT_DIR, f)));
  }

  // Report.
  console.log(`\n  Brickbox Royale build  (${bundled.inputs} modules, ${Math.round(performance.now() - t0)} ms)\n`);
  console.log(`  ${'js bundle'.padEnd(34)} ${kb(Buffer.byteLength(js)).padStart(10)}`);
  console.log(`  ${'css bundle (incl. fonts)'.padEnd(34)} ${kb(Buffer.byteLength(css)).padStart(10)}`);
  for (const p of written) {
    const buf = fs.readFileSync(p);
    const gz = /\.(html|js|webmanifest|txt)$/.test(p) ? `  (gzip ${kb(zlib.gzipSync(buf).length)})` : '';
    console.log(`  ${rel(p).padEnd(34)} ${kb(buf.length).padStart(10)}${gz}`);
  }
  console.log(`\n  artifact.html: ${((artifactBytes / ARTIFACT_LIMIT) * 100).toFixed(1)}% of the 16 MB Artifact limit\n`);
}

main().catch((err) => {
  if (err instanceof BuildError) console.error(`\n  x build failed: ${err.message}\n`);
  else if (err?.errors?.length) console.error(`\n  x build failed: ${err.errors.length} esbuild error(s) (see above)\n`);
  else console.error('\n  x build failed:', err, '\n');
  process.exit(1);
});
