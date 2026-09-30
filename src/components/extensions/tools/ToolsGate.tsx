'use client';

import React from 'react';
import Link from 'next/link';
import { useExtensionTools } from './access';
import { useToolStrings } from './strings';

/** Envuelve una herramienta: esqueleto mientras se comprueba el acceso; aviso accesible (404) si no es admin. */
export function ToolsGate({ children }: { children: React.ReactNode }) {
    const { allowed, loading } = useExtensionTools();
    const t = useToolStrings();

    if (loading) {
        return (
            <div role="status" aria-busy="true" className="mx-auto max-w-6xl space-y-4 p-6">
                <div className="h-8 w-64 animate-pulse rounded-md bg-muted" />
                <div className="h-64 animate-pulse rounded-lg bg-muted" />
                <span className="sr-only">{t.checkingAccess}</span>
            </div>
        );
    }
    if (!allowed) {
        return (
            <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-5xl font-semibold text-muted-foreground" aria-hidden="true">404</p>
                <h1 className="text-xl font-semibold text-foreground">{t.unavailableTitle}</h1>
                <p className="text-sm text-muted-foreground">{t.unavailableBody}</p>
                <Link href="/" className="text-sm text-link underline-offset-4 hover:text-link-hover hover:underline">{t.backHome}</Link>
            </main>
        );
    }
    return <>{children}</>;
}
