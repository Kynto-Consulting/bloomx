import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';

type DomainConfig = {
    name?: string;
    displayName?: string;
    logo?: string | null;
    theme?: {
        primaryColor?: string;
    };
};

async function getManifestConfig(): Promise<DomainConfig | null> {
    const headersList = await headers();
    const host = process.env.TOP_DOMAIN || headersList.get('x-forwarded-host') || headersList.get('host') || '';
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.bloomx.arubik.dev';

    try {
        const targetUrl = new URL(`${backendUrl}/api/config`);
        if (host) {
            targetUrl.searchParams.set('domain', host.split(':')[0]);
        }

        const response = await fetch(targetUrl.toString(), {
            headers: {
                'x-forwarded-host': host,
            },
            next: { revalidate: 60 },
        });

        if (!response.ok) {
            return null;
        }

        const data = await response.json();
        return data?.config || null;
    } catch {
        return null;
    }
}

export default async function manifest(): Promise<MetadataRoute.Manifest> {
    const config = await getManifestConfig();
    const brandName = config?.displayName || config?.name || 'Mail';
    const brandLogo = config?.logo || null;
    const themeColor = config?.theme?.primaryColor || '#2563eb';

    return {
        name: brandName,
        short_name: brandName,
        description: `${brandName} mail client.`,
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: themeColor,
        icons: brandLogo ? [
            {
                src: brandLogo,
                sizes: 'any',
                purpose: 'any',
            },
            {
                src: brandLogo,
                sizes: 'any',
                purpose: 'maskable',
            },
        ] : [
            {
                src: '/icon.svg',
                sizes: 'any',
                type: 'image/svg+xml',
                purpose: 'any',
            },
            {
                src: '/icon-maskable.svg',
                sizes: 'any',
                type: 'image/svg+xml',
                purpose: 'maskable',
            },
        ],
    };
}