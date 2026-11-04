// Service worker de Mis Suscripciones
//  - Código de la app (HTML/JS/CSS/manifest): primero la red, así los cambios se ven a la primera.
//    Si no hay conexión (o tarda más de 4 s) se usa la copia guardada.
//  - Imágenes y librerías: primero la caché (cambian poco).
//  - Logos subidos a PocketBase: se guardan en una caché aparte para verlos sin conexión.
//  - Datos de la API de PocketBase: nunca se guardan aquí (la app ya tiene su propia copia offline).
const VERSION = 'v5';
const CACHE_NAME = `suscripciones-${VERSION}`;
const PB_LOGO_CACHE = 'suscripciones-logos-pb';
const NETWORK_TIMEOUT_MS = 4000;

const PRECACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './vendor/pocketbase-0.28.1.umd.js',
  './vendor/lucide-1.59.0.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './cartoon.webp',
  './logos/bitwarden.png',
  './logos/chatgpt.png',
  './logos/claude.png',
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
  './logos/youtube.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // De uno en uno para que un fallo puntual no aborte la instalación
      for (const url of PRECACHE) {
        try {
          await cache.add(new Request(url, { cache: 'reload' }));
        } catch (e) {
          console.warn('SW: no se pudo guardar', url, e);
        }
      }
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names
          .filter(n => n !== CACHE_NAME && n !== PB_LOGO_CACHE)
          .map(n => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

function isCacheable(response, allowOpaque = false) {
  return response && (response.ok || (allowOpaque && response.type === 'opaque'));
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS))
    ]);
    if (isCacheable(response)) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true })
      || (request.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request, cacheName, allowOpaque = false) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheable(response, allowOpaque)) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request).then(response => {
    if (isCacheable(response, true)) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Logos subidos a PocketBase
  if (url.pathname.startsWith('/api/files/')) {
    event.respondWith(cacheFirst(request, PB_LOGO_CACHE));
    return;
  }

  // Resto de la API de PocketBase: siempre a la red
  if (url.pathname.startsWith('/api/')) return;

  if (url.origin === self.location.origin) {
    const isAppCode = request.mode === 'navigate'
      || url.pathname.endsWith('/')
      || /\.(html|js|css|json)$/.test(url.pathname);
    // Las librerías de vendor/ llevan la versión en el nombre: nunca cambian
    if (isAppCode && !url.pathname.includes('/vendor/')) {
      event.respondWith(networkFirst(request));
    } else {
      event.respondWith(cacheFirst(request, CACHE_NAME));
    }
    return;
  }

  // Tipografía de Google Fonts
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request));
  }
});
