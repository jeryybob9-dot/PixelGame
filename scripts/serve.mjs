#!/usr/bin/env node
// Zero-dependency static dev server for Brickbox: Tiny Gods.
//
//   npm run dev                      -> serves the repo root on http://localhost:5173
//   npm run dev -- --host            -> also listen on the LAN (open the printed URL on an iPhone on the same Wi-Fi)
//   npm run dev -- --port 8080       -> different port (or PORT=8080)
//   node scripts/serve.mjs dist      -> preview the production build (run `npm run build` first)
//
// Everything is served with `Cache-Control: no-store` so edits show up on a plain reload.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wasm': 'application/wasm',
};

function parseArgs(argv) {
  const opts = { port: Number(process.env.PORT) || 5173, host: process.env.HOST || '127.0.0.1', root: REPO_ROOT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') opts.port = Number(argv[++i]);
    else if (a.startsWith('--port=')) opts.port = Number(a.slice(7));
    else if (a === '--host') {
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) { opts.host = next; i++; } else opts.host = '0.0.0.0';
    } else if (a.startsWith('--host=')) opts.host = a.slice(7);
    else if (!a.startsWith('-')) opts.root = path.resolve(REPO_ROOT, a);
  }
  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) {
    console.error(`serve: invalid port "${opts.port}"`);
    process.exit(1);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const ROOT = opts.root;

if (!fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) {
  console.error(`serve: root directory not found: ${ROOT}`);
  process.exit(1);
}

const NO_CACHE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...NO_CACHE });
  res.end(body);
}

/** Resolve a URL path to a file inside ROOT, or null if it escapes ROOT. */
function resolvePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const full = path.resolve(ROOT, '.' + path.posix.normalize('/' + decoded));
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}

const server = http.createServer((req, res) => {
  const started = Date.now();
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return send(res, 405, 'Method Not Allowed');
  }

  const urlPath = (req.url || '/').split('?')[0].split('#')[0];
  let file = resolvePath(urlPath);
  if (!file) return send(res, 403, 'Forbidden');

  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      if (!urlPath.endsWith('/')) {
        res.writeHead(301, { Location: urlPath + '/', ...NO_CACHE });
        return res.end();
      }
      file = path.join(file, 'index.html');
    }
    fs.stat(file, (err2, st2) => {
      if (err2 || !st2.isFile()) {
        log(method, urlPath, 404, started);
        return send(res, 404, `404 Not Found: ${urlPath}`);
      }
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': st2.size,
        'X-Content-Type-Options': 'nosniff',
        ...NO_CACHE,
      });
      log(method, urlPath, 200, started);
      if (method === 'HEAD') return res.end();
      const stream = fs.createReadStream(file);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    });
  });
});

function log(method, url, status, started) {
  if (process.env.QUIET) return;
  const ms = Date.now() - started;
  const color = status >= 400 ? '\x1b[31m' : '\x1b[2m';
  console.log(`${color}${method} ${status} ${url} ${ms}ms\x1b[0m`);
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`serve: port ${opts.port} is already in use (try --port 5174)`);
  else console.error('serve:', e.message);
  process.exit(1);
});

server.listen(opts.port, opts.host, () => {
  const port = server.address().port; // differs from opts.port when started with --port 0
  const rel = path.relative(REPO_ROOT, ROOT) || '.';
  console.log(`\n  Brickbox: Tiny Gods dev server  (serving ./${rel})\n`);
  console.log(`  Local:   http://localhost:${port}/`);
  if (opts.host === '0.0.0.0' || opts.host === '::') {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const ni of list || []) {
        if (ni.family === 'IPv4' && !ni.internal) console.log(`  Network: http://${ni.address}:${port}/`);
      }
    }
  } else {
    console.log('  Network: use --host to expose on your LAN (e.g. to test on an iPhone)');
  }
  console.log('');
});
