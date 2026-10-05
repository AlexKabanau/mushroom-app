// Minimal service worker — enables PWA install prompt and basic offline UI shell
const CACHE = 'mushroom-v1';
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/auth.js',
  './js/config.js',
  './js/gist.js',
  './js/osm.js',
  './js/scoring.js',
  './js/storage.js',
  './js/weather.js',
  './manifest.json',
  './icons/icon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Never cache API calls — always network
  if (url.hostname.includes('open-meteo') || url.hostname.includes('openstreetmap') ||
      url.hostname.includes('nominatim') || url.hostname.includes('api.github.com')) {
    return;
  }
  // Shell: cache-first
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
