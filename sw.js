const cacheName = 'marshrut-shell-v6';
const shell = [
  './', './index.html', './styles.css', './app.mjs', './activity.mjs', './maps.mjs',
  './icons.svg', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  './vendor/leaflet.js', './vendor/leaflet.css',
];

self.addEventListener('install', event => {
  const requests = shell.map(path => new Request(new URL(path, self.location.href), {cache: 'reload'}));
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(requests)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('marshrut-shell-') && key !== cacheName).map(key => caches.delete(key)),
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(caches.open(cacheName).then(cache => cache.match('./index.html')).then(response => response || fetch(event.request)));
    return;
  }
  if (shell.some(path => new URL(path, self.location.href).pathname === url.pathname)) {
    event.respondWith(caches.open(cacheName).then(cache => cache.match(event.request)).then(response => response || fetch(event.request)));
  }
});
