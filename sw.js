/* ============================================================
   sw.js — Selagi Coffee app service worker
   - Makes the app installable in one tap (fetch handler + manifest)
   - Caches the app shell so it opens fast and works offline
   - Never caches Firebase data / auth / push traffic (always live)
   Push notifications are handled separately by firebase-messaging-sw.js.
   Bump CACHE_VERSION when you want every phone to drop old cached files.
   ============================================================ */
const CACHE_VERSION = 'v1';
const SHELL_CACHE = 'selagi-shell-' + CACHE_VERSION;
const RUNTIME_CACHE = 'selagi-runtime-' + CACHE_VERSION;

const APP_SHELL = [
    './',
    './index.html',
    './manifest.webmanifest',
    './logo.jpg',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/maskable-192.png',
    './icons/maskable-512.png',
    './icons/apple-touch-icon.png',
    './icons/favicon-32.png',
    './icons/favicon-48.png',
    './icons/splash-logo.png'
];

/* Third-party static files that are safe to cache (versioned / immutable). */
const CACHEABLE_HOSTS = [
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdnjs.cloudflare.com',
    'images.unsplash.com'
];

/* Live services — always go straight to the network, never cached. */
const NETWORK_ONLY = [
    /firebaseio\.com/,
    /firebasedatabase\.app/,
    /googleapis\.com\/(identitytoolkit|securetoken|v1\/projects|fcm|firebase)/,
    /identitytoolkit\.googleapis\.com/,
    /securetoken\.googleapis\.com/,
    /firebaseinstallations\.googleapis\.com/,
    /fcmregistrations\.googleapis\.com/,
    /firebaselogging/,
    /google-analytics\.com/,
    /googletagmanager\.com/,
    /\/__\//
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then((cache) => Promise.all(APP_SHELL.map((url) =>
                // one missing file must not break the whole install
                cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
            )))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys
                .filter((k) => k.startsWith('selagi-') && k !== SHELL_CACHE && k !== RUNTIME_CACHE)
                .map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

/* Page can ask the waiting worker to take over immediately. */
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function offlinePage() {
    return new Response(
        '<!doctype html><html lang="ms"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>Selagi Coffee — Luar Talian</title><style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
        'background:#44420F;color:#F3EBDD;font-family:system-ui,sans-serif;text-align:center;padding:24px}img{width:160px;border-radius:50%}' +
        'h1{font-weight:600;font-size:1.3rem;margin:18px 0 6px}p{opacity:.8;font-size:.9rem;margin:0 0 20px}button{background:#F3EBDD;color:#2E4A2B;border:0;' +
        'border-radius:999px;padding:12px 22px;font-weight:700;font-size:.9rem}</style></head><body><img src="icons/icon-192.png" alt="">' +
        '<h1>Tiada sambungan internet</h1><p>Sila semak sambungan anda dan cuba lagi.</p><button onclick="location.reload()">Cuba Lagi</button></body></html>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
}

/* HTML: network first (so new versions show up), fall back to cache, then offline page. */
async function handleNavigation(request) {
    try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok) {
            const cache = await caches.open(SHELL_CACHE);
            cache.put('./index.html', fresh.clone());
        }
        return fresh;
    } catch (err) {
        const cached = (await caches.match(request, { ignoreSearch: true })) ||
                       (await caches.match('./index.html')) ||
                       (await caches.match('./'));
        return cached || offlinePage();
    }
}

/* Static files: serve from cache instantly, refresh in the background. */
async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    const network = fetch(request).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
        return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;                       // POST/PUT etc. untouched
    const url = new URL(request.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (NETWORK_ONLY.some((re) => re.test(request.url))) return; // live Firebase traffic
    if (url.pathname.endsWith('firebase-messaging-sw.js') || url.pathname.endsWith('/sw.js')) return;

    if (request.mode === 'navigate') {
        event.respondWith(handleNavigation(request));
        return;
    }

    if (url.origin === self.location.origin) {
        event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
        return;
    }

    /* Firebase JS SDK files are versioned in the URL (…/10.12.0/…), safe to cache. */
    if (CACHEABLE_HOSTS.includes(url.hostname) ||
        (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'))) {
        event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    }
    /* Anything else: let the browser handle it normally. */
});
