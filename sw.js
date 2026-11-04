const CACHE_NAME = 'suscripciones-v4';
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.png',
  './cartoon.png',
  './logos/bitwarden.png',
  './logos/chatgpt.png',
  './logos/disney+.png',
  './logos/elpais.png',
  './logos/gemini.png',
  './logos/hbomax.png',
  './logos/infuse.png',
  './logos/iptv.png',
  './logos/netflix.png',
  './logos/nordvpn.png',
  './logos/parcel.png',
  './logos/photoshop.png',
  './logos/retouch.png',
  './logos/telegram.png',
  './logos/tinymediamanager.png',
  './logos/youtube.png',
  'https://unpkg.com/pocketbase/dist/pocketbase.umd.js',
  'https://unpkg.com/lucide@latest',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Usar individual fetch catch para no abortar si un recurso opcional falla
      for (const url of urlsToCache) {
        try {
          await cache.add(url);
        } catch (e) {
          console.warn('SW: No se pudo cachear:', url, e);
        }
      }
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Ignorar llamadas a la API de PocketBase o peticiones no GET
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
