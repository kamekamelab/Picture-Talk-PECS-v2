const CACHE = 'ptp-v2-shell-0.12.0-reference-book';
const ROOT = new URL('./', self.location).href;
const FILES = ['', 'index.html', 'style.css', 'app.js', 'domain.js', 'cards.js', 'book.js', 'sentence.js', 'speech.js', 'storage.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'].map(p => new URL(p, ROOT).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('ptp-v2-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(ROOT)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    if (event.request.mode === 'navigate') return cache.match(new URL('index.html', ROOT).href);
    return fetch(event.request);
  }));
});

// Check the actual saved files; an active worker alone does not prove readiness.
self.addEventListener('message', event => {
  if (event.data?.type !== 'CHECK_OFFLINE' || !event.ports?.[0]) return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      const saved = await Promise.all(FILES.map(url => cache.match(url)));
      event.ports[0].postMessage({ ready: saved.every(Boolean) });
    } catch { event.ports[0].postMessage({ ready: false }); }
  })());
});
