/* Brickbox Royale service worker — versioned, cache-first app shell with network fallback.
 *
 * The production build (scripts/build.mjs) stamps VERSION with a hash of dist/index.html, so every
 * new build installs a fresh cache and the old one is deleted on activate. Only registered by
 * dist/index.html over http(s); never in file://, Capacitor, or sandboxed iframes.
 */
const VERSION = 'dev'; // replaced at build time
const CACHE = `brickbox-shell-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Fetch each entry separately (bypassing the HTTP cache) so one missing icon can't fail the install.
      await Promise.all(
        SHELL.map(async (url) => {
          try {
            const res = await fetch(new Request(url, { cache: 'reload' }));
            if (res.ok) await cache.put(url, res);
          } catch {
            /* offline during install: the entry is fetched later on demand */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('brickbox-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let the browser handle anything cross-origin

  // Navigations to the app root (with any ?query) map to the single-file app shell.
  const scopePath = new URL(self.registration.scope).pathname;
  const isShell = req.mode === 'navigate' && (url.pathname === scopePath || url.pathname === `${scopePath}index.html`);
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = isShell
        ? (await cache.match('./index.html')) || (await cache.match('./'))
        : await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') await cache.put(isShell ? './index.html' : req, res.clone());
        return res;
      } catch {
        return Response.error();
      }
    })(),
  );
});
