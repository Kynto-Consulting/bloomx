self.__PWA_BRANDING__ = {
    name: null,
    logo: null,
};

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
    if (event.data?.type !== 'SET_BRANDING') {
        return;
    }

    self.__PWA_BRANDING__ = {
        name: event.data.payload?.name || self.__PWA_BRANDING__.name,
        logo: event.data.payload?.logo || self.__PWA_BRANDING__.logo,
    };
});

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        await self.clients.claim();
        await loadBranding();
    })());
});

self.addEventListener('push', (event) => {
    if (!event.data) {
        return;
    }

    event.waitUntil((async () => {
        const payload = event.data.json();
        const branding = await loadBranding();
        const fallbackName = branding.name || 'Mail';
        const fallbackLogo = branding.logo || '/icon.svg';
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

    const destinationUrl = event.notification.data?.url || '/';
    event.waitUntil((async () => {
        const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windowClients) {
            if ('focus' in client) {
                client.navigate(destinationUrl);
                return client.focus();
            }
        }

        if (self.clients.openWindow) {
            return self.clients.openWindow(destinationUrl);
        }
    })());
});