// Offline cache: app shell is cached, network-first so updates arrive quickly.
const CACHE = 'my-closet-v3';
const SHELL = ['./', 'index.html', 'css/style.css', 'js/app.js', 'js/db.js', 'js/cutout.js', 'js/edge.js', 'js/color.js', 'js/haptics.js', 'manifest.webmanifest', 'icons/icon.svg', 'css/fonts/cormorant-garamond-latin-500-normal.woff2', 'css/fonts/cormorant-garamond-latin-500-italic.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
