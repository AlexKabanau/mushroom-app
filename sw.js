// Service worker — enables PWA install prompt + basic offline fallback
//
// Strategy:
//   JS files  → network-first (always fresh after deploy, no manual version bumps)
//   Everything else → cache-first (fast loads, offline shell)
//
const CACHE = 'mushroom-v11';
const SHELL_STATIC = [
  './',
  './index.html',
  './css/styles.css',
  './manifest.json',
  './icons/icon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL_STATIC)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never cache API calls — always network
  if (url.hostname.includes('open-meteo') ||
      url.hostname.includes('openstreetmap') ||
      url.hostname.includes('nominatim') ||
      url.hostname.includes('api.github.com') ||
      url.hostname.includes('inaturalist.org')) {
    return;
  }

  // JS files: network-first with cache: 'no-cache' — bypasses HTTP cache entirely.
  // GitHub Pages sets Cache-Control: max-age=600; without no-cache even network-first
  // would serve a stale HTTP-cached response for up to 10 minutes after deploy.
  if (url.pathname.endsWith('.js')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' })
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request)) // offline fallback to cached version
    );
    return;
  }

  // Everything else: cache-first
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok && e.request.method === 'GET') {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
