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

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

import { headers } from 'next/headers';

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

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="en" className="light" suppressHydrationWarning>
            <body className={`${inter.variable} font-sans antialiased bg-white text-slate-900`}>
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
