/* BloomX service worker.
 *
 * Alcance deliberadamente minimo y seguro:
 *  - Cachea SOLO el "shell" estatico: /_next/static/* (archivos con hash, inmutables), iconos y /offline.html.
 *  - NUNCA cachea /api/*, peticiones RSC/Server Actions, peticiones con Authorization ni paginas HTML
 *    (son especificas de la sesion: cachearlas podria mostrar correo de otra cuenta).
 *  - Si una navegacion falla por falta de red, responde /offline.html.
 *  - Ademas gestiona notificaciones push y el branding de las notificaciones.
 *
 * Version de cache: sale del build id con el que se registra (`/sw.js?v=<buildId>`, ver src/lib/pwa/client-version.ts);
 * cada build tiene sus caches y activate borra los de builds anteriores (prefijo bloomx-).
 */
const CACHE_VERSION = (() => {
    try {
        const v = new URLSearchParams((self.location && self.location.search) || '').get('v') || '';
        return v.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40) || 'dev';
    } catch {
        return 'dev';
    }
})();
const SHELL_CACHE = `bloomx-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `bloomx-static-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';
const PRECACHE_URLS = [OFFLINE_URL, '/icon.svg', '/icon-192.png', '/icon-512.png'];
const STATIC_PATHS = new Set(['/icon.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png']);
const MAX_RUNTIME_ENTRIES = 80;

self.__PWA_BRANDING__ = {
    name: null,
    logo: null,
};

/**
 * Decide como tratar una peticion: 'skip' (no interceptar), 'navigate' o 'static'.
 * Sin efectos secundarios: se prueba en src/lib/__tests__/service-worker.test.ts.
 */
function classifyRequest(request, url, origin) {
    if (request.method !== 'GET') return 'skip';
    if (url.origin !== origin) return 'skip';
    if (url.pathname.startsWith('/api/')) return 'skip';
    if (request.headers.get('authorization')) return 'skip';
    // Next.js: payloads RSC / prefetch / server actions dependen de la sesion.
    if (request.headers.get('rsc') || request.headers.get('next-router-state-tree') || request.headers.get('next-action')) return 'skip';
    if (url.searchParams.has('_rsc')) return 'skip';
    if (request.mode === 'navigate') return 'navigate';
    if (url.pathname.startsWith('/_next/static/')) return 'static';
    if (STATIC_PATHS.has(url.pathname)) return 'static';
    return 'skip';
}

/** Solo se guardan respuestas 200 del mismo origen sin no-store/private. */
function isCacheableResponse(response) {
    if (!response || response.status !== 200 || response.type !== 'basic' || response.redirected) return false;
    const cacheControl = (response.headers.get('cache-control') || '').toLowerCase();
    if (cacheControl.includes('no-store') || cacheControl.includes('private')) return false;
    if (response.headers.get('set-cookie')) return false;
    return true;
}

self.__SW_POLICY__ = { CACHE_VERSION, SHELL_CACHE, RUNTIME_CACHE, classifyRequest, isCacheableResponse, STATIC_PATHS, PRECACHE_URLS };

async function precache() {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(PRECACHE_URLS.map(async (url) => {
        try {
            const response = await fetch(url, { cache: 'reload', credentials: 'same-origin' });
            // Si no hay sesion el middleware redirige a /login: no guardar esa pagina como si fuera el recurso.
            if (response.ok && !response.redirected && response.type === 'basic') {
                await cache.put(url, response);
            }
        } catch {
            // Sin red al instalar: se reintenta en la siguiente actualizacion del SW.
        }
    }));
}

async function trimCache(cacheName, maxEntries) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - maxEntries; i++) {
        await cache.delete(keys[i]);
    }
}

async function cacheFirst(request) {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = (await cache.match(request)) || (await caches.match(request));
    if (cached) return cached;
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
        await cache.put(request, response.clone());
        trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES).catch(() => undefined);
    }
    return response;
}

async function navigateWithFallback(request) {
    try {
        return await fetch(request);
    } catch {
        const offline = await caches.match(OFFLINE_URL);
        return offline || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const kind = classifyRequest(request, new URL(request.url), self.location.origin);
    if (kind === 'skip') return; // el navegador la gestiona con normalidad
    event.respondWith(kind === 'navigate' ? navigateWithFallback(request) : cacheFirst(request));
});

async function loadBranding() {
    try {
        const response = await fetch('/api/config', { cache: 'no-store' });
        if (!response.ok) {
            return self.__PWA_BRANDING__;
        }

        const data = await response.json();
        const config = data?.config || {};
        self.__PWA_BRANDING__ = {
            name: config.displayName || config.name || null,
            logo: config.logo || null,
        };
    } catch {
        // Ignore branding fetch failures and keep current cache.
    }

    return self.__PWA_BRANDING__;
}

self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') {
        self.skipWaiting();
        return;
    }

    if (event.data?.type !== 'SET_BRANDING') {
        return;
    }

    self.__PWA_BRANDING__ = {
        name: event.data.payload?.name || self.__PWA_BRANDING__.name,
        logo: event.data.payload?.logo || self.__PWA_BRANDING__.logo,
    };
});

self.addEventListener('install', (event) => {
    event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        // Borrar caches de versiones anteriores de este SW.
        const names = await caches.keys();
        await Promise.all(
            names
                .filter((name) => name.startsWith('bloomx-') && name !== SHELL_CACHE && name !== RUNTIME_CACHE)
                .map((name) => caches.delete(name)),
        );
        await self.clients.claim();
        await loadBranding();
    })());
});

self.addEventListener('push', (event) => {
    if (!event.data) {
        return;
    }

    event.waitUntil((async () => {
        // El payload puede no ser JSON valido: mostrar una notificacion generica en vez de lanzar.
        let payload = {};
        try {
            payload = event.data.json() || {};
        } catch {
            try {
                payload = { body: event.data.text() };
            } catch {
                payload = {};
            }
        }
        const branding = await loadBranding();
        const fallbackName = branding.name || 'Mail';
        const fallbackLogo = branding.logo || '/icon-192.png';
        const title = payload.title || fallbackName;
        const options = {
            body: payload.body || 'You have a new notification.',
            icon: payload.icon || fallbackLogo,
            badge: payload.badge || fallbackLogo,
            tag: payload.tag || 'mail-notification',
            data: {
                url: payload.url || '/',
                brandName: fallbackName,
            },
        };

        await self.registration.showNotification(title, options);
    })());
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    // Solo URLs del propio origen (evita que un payload lleve a otro sitio).
    let destinationUrl = '/';
    try {
        const candidate = new URL(event.notification.data?.url || '/', self.location.origin);
        if (candidate.origin === self.location.origin) {
            destinationUrl = candidate.pathname + candidate.search + candidate.hash;
        }
    } catch {
        // URL invalida: ir a la raiz.
    }

    event.waitUntil((async () => {
        const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        // Preferir una ventana ya enfocada/visible de la app.
        const target = windowClients.find((c) => c.focused) || windowClients.find((c) => c.visibilityState === 'visible') || windowClients[0];
        if (target && 'focus' in target) {
            try {
                if ('navigate' in target) await target.navigate(destinationUrl);
            } catch {
                // navigate puede fallar en clientes no controlados: basta con enfocar.
            }
            return target.focus();
        }

        if (self.clients.openWindow) {
            return self.clients.openWindow(destinationUrl);
        }
    })());
});
