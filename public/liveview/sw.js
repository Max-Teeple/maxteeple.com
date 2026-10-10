const CACHE = 'liveview-v4';
const STATIC_ASSETS = [
    '/liveview/styles.css',
    '/liveview/liveview-core.js',
    '/liveview/manifest.json',
    '/liveview/images/liveview-logo.svg'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE).then((cache) => cache.addAll(STATIC_ASSETS).catch(() => {}))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

function isHtmlRequest(request) {
    return request.mode === 'navigate' ||
        request.destination === 'document' ||
        (request.headers.get('accept') || '').includes('text/html');
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // HTML: always network-first so nav links (Explore, etc.) stay current
    if (isHtmlRequest(request)) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE).then((cache) => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(() => caches.match(request).then((cached) => cached || caches.match('/liveview/index.html')))
        );
        return;
    }

    // API: network-first with cache fallback
    if (url.pathname.startsWith('/liveview/courses') || url.pathname.startsWith('/liveview/api')) {
        event.respondWith(
            fetch(request)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(CACHE).then((c) => c.put(request, copy));
                    return res;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    // Static JS/CSS: stale-while-revalidate
    if (request.destination === 'script' || request.destination === 'style' || request.destination === 'image') {
        event.respondWith(
            caches.match(request).then((cached) => {
                const network = fetch(request).then((res) => {
                    if (res.ok) {
                        const copy = res.clone();
                        caches.open(CACHE).then((c) => c.put(request, copy));
                    }
                    return res;
                }).catch(() => cached);
                return cached || network;
            })
        );
    }
});

self.addEventListener('push', (event) => {
    let data = { title: 'LiveView Golf', body: 'Update available' };
    try {
        data = event.data ? event.data.json() : data;
    } catch (e) { /* ignore */ }
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: '/liveview/images/liveview-logo.svg',
            data: { url: data.url || '/liveview/index.html' }
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url || '/liveview/index.html';
    event.waitUntil(clients.openWindow(url));
});
