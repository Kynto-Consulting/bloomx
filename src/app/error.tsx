'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, RotateCcw, Inbox } from 'lucide-react';

// Error boundary de segmento: se muestra dentro del layout, asi que usa los tokens de tema (light/dark/...).
export default function Error({
    error,
    reset,
}: {
    error: globalThis.Error & { digest?: string };
    reset: () => void;
}) {
    const [offline, setOffline] = useState(false);

    useEffect(() => {
        // Solo el digest y el mensaje: nunca datos de correo. Next oculta el detalle en produccion.
        console.error('[app error]', error.digest || '', error.message);
        setOffline(typeof navigator !== 'undefined' && !navigator.onLine);
    }, [error]);

    return (
        <main className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-destructive" aria-hidden="true">
                <AlertTriangle className="h-7 w-7" />
            </div>
            <div className="max-w-md space-y-1">
                <h1 className="text-xl font-semibold">Something went wrong</h1>
                <p className="text-sm text-muted-foreground">
                    {offline
                        ? 'You appear to be offline. Check your connection and try again.'
                        : 'An unexpected error occurred. You can try again; if it keeps happening, reload the page.'}
                </p>
                {error.digest && (
                    <p className="text-xs text-muted-foreground">Reference: <code className="rounded bg-muted px-1 py-0.5">{error.digest}</code></p>
                )}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                    type="button"
                    onClick={() => reset()}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    Try again
                </button>
                <a
                    href="/"
                    className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <Inbox className="h-4 w-4" aria-hidden="true" />
                    Back to inbox
                </a>
            </div>
        </main>
    );
}
