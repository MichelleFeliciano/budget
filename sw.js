// Service worker: makes the app work offline.
// Strategy is cache-first, for this app's own files only (APP_SHELL below). On install, every
// shell file is stored in a versioned cache. A request for a shell file is answered from that
// cache when possible (so the app opens instantly with no network); otherwise it goes to the
// network and a successful response is added to the cache for next time.
// Everything else passes straight through untouched: other paths on this web address (the app
// can share its origin with Second Memory), non-GET requests, and other origins such as the
// sync server. The cache is named budget-vN and only caches starting with budget- are ever
// deleted, so another app's caches are never touched. Old budget- caches are deleted on activate.
//
// IMPORTANT: bump this string (and APP_VERSION in app.js, to the same number) on every deploy
// that touches any app-shell file (index.html, style.css, app.js, manifest.json, any icon).
// The browser only detects a Service Worker update when sw.js's bytes change —
// if this string is left unchanged, sw.js is byte-identical after a deploy, the
// browser never notices, and users silently stay on old code forever.
const CACHE_NAME = 'budget-v3';

// Files pre-cached at install time: everything needed to run with no network.
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Install: fill the new cache with the whole app shell, then activate right away.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // cache: 'reload' bypasses the browser's HTTP cache so a fresh install can never mix old and new files.
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

// Activate: delete caches left over from earlier versions, then take control of open tabs.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('budget-') && key !== CACHE_NAME).map((key) => caches.delete(key)) // only this app's old caches (the site address is shared)
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: cache first, network as fallback (see the header comment).
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Only this app's own files (APP_SHELL) are served from, and saved to, this app's cache. Anything
  // else (for example the test pages while developing) always comes fresh from the network.
  const path = new URL(request.url).pathname;
  const isShellFile = APP_SHELL.some((entry) => new URL(entry, self.location).pathname === path);
  if (!isShellFile) return;

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => cache.match(request, { ignoreSearch: true })).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone)).catch(() => {});
        }
        return response;
      });
    })
  );
});
