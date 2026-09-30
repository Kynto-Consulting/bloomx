import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { SessionProvider } from '@/components/SessionProvider'
import { ComposeProvider } from '@/contexts/ComposeContext'
import { GlobalWindowProvider } from '@/contexts/GlobalWindowContext'
import { CacheProvider } from '@/contexts/CacheContext'
import { OfflineProvider } from '@/contexts/OfflineContext'
import { ComposeWindows } from '@/components/ComposeWindows'
import { Toaster } from '@/components/ui/sonner'
import { RealTimeListener } from '@/components/RealTimeListener'
import { PwaManager } from '@/components/PwaManager'
import { buildBootScript, buildBrandCss, buildThemeCss, getTheme, isThemePreference, THEME_COOKIE, type DomainThemeConfig } from '@/lib/themes'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

import { cache } from 'react';
import { cookies, headers } from 'next/headers';

/** Config de dominio (marca/tema). Misma peticion que generateMetadata: Next la deduplica. */
const getDomainTheme = cache(async (): Promise<DomainThemeConfig | null> => {
    try {
        const headersList = await headers();
        const host = process.env.TOP_DOMAIN || headersList.get('x-forwarded-host') || headersList.get('host') || '';
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.bloomx.arubik.dev';
        const targetUrl = new URL(`${backendUrl}/api/config`);
        if (host) targetUrl.searchParams.set('domain', host.split(':')[0]);
        const res = await fetch(targetUrl.toString(), {
            headers: { 'x-forwarded-host': host },
            next: { revalidate: 60 }
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data?.config?.theme ?? null;
    } catch {
        return null;
    }
});

export async function generateMetadata(): Promise<Metadata> {
    const headersList = await headers();
    const host = process.env.TOP_DOMAIN || headersList.get('x-forwarded-host') || headersList.get('host') || '';
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.bloomx.arubik.dev';

    try {
        const targetUrl = new URL(`${backendUrl}/api/config`);
        if (host) targetUrl.searchParams.set('domain', host.split(':')[0]);

        const res = await fetch(targetUrl.toString(), {
            headers: {
                'x-forwarded-host': host,
            },
            next: { revalidate: 60 }
        });

        if (!res.ok) {
            return {
                title: 'BloomX Mail',
                description: 'Serverless mail client',
                manifest: '/manifest.webmanifest'
            };
        }

        const data = await res.json();
        const config = data.config;

        return {
            title: config?.displayName || config?.name || 'BloomX Mail',
            description: 'Serverless mail client',
            manifest: '/manifest.webmanifest',
            icons: config?.logo ? [
                { rel: 'icon', url: config.logo },
                { rel: 'shortcut icon', url: config.logo },
                { rel: 'apple-touch-icon', url: config.logo }
            ] : undefined
        };
    } catch (e) {
        console.error("Metadata generation failed:", e);
        return {
            title: 'BloomX Mail',
            description: 'Serverless mail client',
            manifest: '/manifest.webmanifest'
        };
    }
}

import { ExpansionUIProvider } from '@/contexts/ExpansionUIContext';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ReAuthProvider } from '@/contexts/ReAuthContext';
import { ReAuthBanner } from '@/components/ReAuthBanner';

export default async function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    // Preferencia de tema persistida en cookie: permite renderizar <html data-theme> ya en el servidor.
    // Con "system" (o sin cookie) el servidor no sabe si el SO es oscuro: lo resuelve el script bloqueante.
    const cookieStore = await cookies();
    const cookiePref = cookieStore.get(THEME_COOKIE)?.value;
    const pref = isThemePreference(cookiePref) ? cookiePref : 'system';
    const concrete = pref !== 'system' ? getTheme(pref) : undefined;
    const brandCss = buildBrandCss(await getDomainTheme());

    return (
        <html
            lang="en"
            data-theme-pref={pref}
            data-theme={concrete?.id}
            data-scheme={concrete?.scheme}
            suppressHydrationWarning
        >
            <head>
                <style id="bx-themes" dangerouslySetInnerHTML={{ __html: buildThemeCss() }} />
                {brandCss ? <style id="bx-brand" dangerouslySetInnerHTML={{ __html: brandCss }} /> : null}
                <script dangerouslySetInnerHTML={{ __html: buildBootScript() }} />
            </head>
            <body className={`${inter.variable} font-sans antialiased bg-background text-foreground`}>
                <SessionProvider>
                    <ReAuthProvider
                        initialChecks={[
                            {
                                provider: 'google',
                                scopes: ['https://www.googleapis.com/auth/meetings.space.created'],
                                reason: 'Para crear salas de Google Meet abiertas sin sala de espera, necesita un permiso adicional.',
                                requestedBy: 'Google Meet',
                            },
                        ]}
                    >
                        <GlobalWindowProvider>
                            <ComposeProvider>
                                <CacheProvider>
                                    <OfflineProvider>
                                        <ExpansionUIProvider>
                                            <ThemeProvider>
                                                {children}
                                            </ThemeProvider>
                                            <PwaManager />
                                            <RealTimeListener />
                                            <ComposeWindows />
                                            <ReAuthBanner />
                                            <Toaster />
                                        </ExpansionUIProvider>
                                    </OfflineProvider>
                                </CacheProvider>
                            </ComposeProvider>
                        </GlobalWindowProvider>
                    </ReAuthProvider>
                </SessionProvider>
            </body>
        </html>
    )
}
