'use client';

import Link from 'next/link';
import { BookX } from 'lucide-react';
import { useLandingConfig } from '@/hooks/useLandingConfig';
import { landingMessage } from '@/lib/landing-messages';

/** 404 amigable cuando la empresa oculta la documentacion (landing.docs.visible = false). Sin enlaces a /docs. */
export function DocsHidden() {
    const { locale } = useLandingConfig();
    return (
        <main className="flex min-h-screen w-full flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
                <BookX className="h-7 w-7" />
            </div>
            <div className="max-w-md space-y-1">
                <p className="text-sm font-medium text-muted-foreground">404</p>
                <h1 className="text-xl font-semibold">{landingMessage(locale, 'docsHiddenTitle')}</h1>
                <p className="text-sm text-muted-foreground">{landingMessage(locale, 'docsHiddenText')}</p>
            </div>
            <Link
                href="/login"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
                {landingMessage(locale, 'docsHiddenBack')}
            </Link>
        </main>
    );
}
