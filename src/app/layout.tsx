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
import { I18nProvider } from '@/components/I18nProvider'
import { getTranslator } from '@/lib/i18n'
import { getRequestLocale } from '@/lib/i18n/server'
import { buildBootScript, buildThemeCss, getThemePolicy, getThemeScheme, resolvePreference, THEME_COOKIE } from '@/lib/themes'
import { buildBrandCss, getThemeOverride } from '@/lib/brand-theme'
import { sanitizeThemeConfig, type DomainThemeConfig } from '@/lib/theme-config'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

import { cache } from 'react';
import { cookies, headers } from 'next/headers';

/** Config de dominio (marca/tema saneada + nombre). Misma peticion que generateMetadata: Next la deduplica. */
const getDomainTheme = cache(async (): Promise<{ theme: DomainThemeConfig; name: string } | null> => {
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
        return {
            theme: sanitizeThemeConfig(data?.config?.theme),
            name: data?.config?.displayName || data?.config?.name || '',
        };
    } catch {
        return null;
    }
});

export async function generateMetadata(): Promise<Metadata> {
    const description = getTranslator(await getRequestLocale()).t('layout.description');
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
                description,
                manifest: '/manifest.webmanifest'
            };
        }

        const data = await res.json();
        const config = data.config;

        return {
            title: config?.displayName || config?.name || 'BloomX Mail',
            description,
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
            description,
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
    // Idioma: cookie de preferencia -> Accept-Language -> es. Se pasa al cliente para que el primer HTML ya salga traducido.
    const locale = await getRequestLocale();
    const tr = getTranslator(locale);
    const cookiePref = cookieStore.get(THEME_COOKIE)?.value;
    const domain = await getDomainTheme();
    const themeCfg = getThemeOverride() ?? domain?.theme ?? null; // override: solo desarrollo (ver reports/theme-contract.md)
    // Politica de la empresa (defaultMode / allowedThemes / lockBrand): el servidor resuelve el tema ya en el HTML.
    // Con "system" el servidor no sabe si el SO es oscuro: lo resuelve el script bloqueante (y el CSS de respaldo).
    const policy = getThemePolicy(themeCfg);
    const pref = resolvePreference(cookiePref, policy);
    const concreteId = pref !== 'system' ? pref : undefined;
    const brandCss = buildBrandCss(themeCfg, { name: domain?.name });

    return (
        <html
            lang={locale}
            data-theme-pref={pref}
            data-theme={concreteId}
            data-scheme={getThemeScheme(concreteId)}
            suppressHydrationWarning
        >
            <head>
                <style id="bx-themes" dangerouslySetInnerHTML={{ __html: buildThemeCss() }} />
                {brandCss ? <style id="bx-brand" dangerouslySetInnerHTML={{ __html: brandCss }} /> : null}
                <script dangerouslySetInnerHTML={{ __html: buildBootScript(policy) }} />
            </head>
            <body className={`${inter.variable} font-sans antialiased bg-background text-foreground`}>
                <I18nProvider locale={locale}>
                <SessionProvider>
                    <ReAuthProvider
                        initialChecks={[
                            {
                                provider: 'google',
                                scopes: ['https://www.googleapis.com/auth/meetings.space.created'],
                                reason: tr.t('layout.reauthMeetReason'),
                                requestedBy: 'Google Meet',
                            },
                        ]}
                    >
                        <GlobalWindowProvider>
                            <ComposeProvider>
                                <CacheProvider>
                                    <OfflineProvider>
                                        <ExpansionUIProvider>
                                            <ThemeProvider initialThemeConfig={themeCfg} brandName={domain?.name}>
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
                </I18nProvider>
            </body>
        </html>
    )
}
