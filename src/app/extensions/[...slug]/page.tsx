'use client';

import React, { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { ExtensionPageView } from '@/components/expansions/ExtensionPageView';

interface ExtensionPageProps {
    params: Promise<{ slug: string[] }>;
}

/**
 * /extensions/<path>: pagina completa de una extension (mount PAGE). La logica (resolucion por path, preferencias del usuario, auth session/admin,
 * estados de carga y error) vive en ExtensionPageView, que tambien sirve las paginas de administracion dentro de la consola (/admin/x/<path>).
 */
export default async function ExtensionPage({ params }: ExtensionPageProps) {
    const { slug } = await params;

    return (
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>}>
            <ExtensionPageView slug={slug} />
        </Suspense>
    );
}
