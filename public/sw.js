// Service Worker fuer die PWA.
// Seiten (HTML) kommen immer frisch vom Server, da sie Benutzerdaten und CSRF-Tokens enthalten.
// Statische Dateien werden zwischengespeichert; ohne Netz erscheint eine Offline-Seite.
const VERSION = 'v2';
const CACHE = `abotracker-static-${VERSION}`;
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, '');
const OFFLINE_URL = `${BASE}/static/offline.html`;
const PRECACHE = [
  OFFLINE_URL,
  `${BASE}/static/css/style.css`,
  `${BASE}/static/js/app.js`,
  `${BASE}/static/favicon.svg`,
  `${BASE}/static/icons/icon-192.png`,
];

// Die Offline-Seite erscheint unter der aufgerufenen Adresse (z. B. /dashboard), damit
// "Erneut versuchen" diese neu laedt. Damit ihre relativen Pfade stimmen, wird <base> gesetzt.
async function offlinePage() {
  const cached = await caches.match(OFFLINE_URL);
  if (!cached) return Response.error();
  const html = (await cached.text()).replace('<head>', `<head><base href="${BASE}/static/">`);
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('abotracker-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(offlinePage));
    return;
  }

  if (url.pathname.startsWith(`${BASE}/static/`)) {
    // Zuerst vom Server (Updates greifen sofort), der Cache dient nur offline.
    // Gespeichert wird ohne ?v=..., damit alte Versionen sich ueberschreiben statt anzuhaeufen.
    const key = url.origin + url.pathname;
    event.respondWith(caches.open(CACHE).then((cache) =>
      fetch(request)
        .then((response) => {
          if (response.ok) cache.put(key, response.clone());
          return response;
        })
        .catch(() => cache.match(key).then((cached) => cached || Response.error()))
    ));
  }
});
