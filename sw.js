// Offline shell: cache-first for game files so installed copies play without a network.
const CACHE = 'efflorescent-v1';
const FILES = ['./', './index.html', './css/app.css', './manifest.webmanifest', './icon.svg',
  './js/core/seed.js', './js/core/util.js', './js/data/organs.js', './js/data/chassis.js', './js/data/specials.js', './js/data/techs.js',
  './js/sim/stats.js', './js/sim/mapgen.js', './js/sim/world.js', './js/sim/ai.js', './js/render/look.js', './js/render/renderer.js', './js/render/minimap.js',
  './js/core/store.js', './js/core/audio.js', './js/net/net.js', './js/ui/dom.js', './js/ui/forge.js', './js/ui/tech.js', './js/ui/codex.js', './js/ui/game.js', './js/ui/menus.js'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname === '/ws') return;
  if (u.origin === location.origin) {
    // network-first so updates land immediately, cache as fallback
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
  } else if (/fonts\.(googleapis|gstatic)/.test(u.host)) {
    e.respondWith(caches.match(e.request).then(m => m || fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); return r; })));
  }
});
