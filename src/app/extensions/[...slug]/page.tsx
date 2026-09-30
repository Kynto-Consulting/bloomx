'use client';

import React, { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { JsonRenderer } from '@/components/expansions/renderer/JsonRenderer';
import { useExtensionPrefs } from '@/hooks/useExtensionPrefs';
import { getPreparedManifest } from '@/lib/expansions/prepare-manifest';
import { isMandatoryExtension } from '@/lib/expansions/client/prefs';
import { ExtensionsLoadError } from '@/components/expansions/ExtensionsLoadError';

interface ExtensionPageProps {
    params: Promise<{ slug: string[] }>;
}

/** `state` inicial declarado en el manifest (objeto JSON pequeno). */
function initialStateOf(state: unknown): Record<string, any> | undefined {
    if (!state || typeof state !== 'object' || Array.isArray(state)) return undefined;
    try { return JSON.stringify(state).length <= 50_000 ? (state as Record<string, any>) : undefined; } catch { return undefined; }
}

function ExtensionContent({ slug }: { slug: string[] }) {
    const { extensions, isLoading, isError, extensionsLoaded, retry, isRetrying } = useDomainConfig();
    const { isEnabled } = useExtensionPrefs();
    const routePath = slug.join('/');

    if (isLoading) return <div className="flex justify-center p-10"><Loader2 className="animate-spin" /></div>;

    // No se pudo cargar la lista (red/servidor): se avisa y se ofrece Reintentar en vez de decir que la pagina no existe.
    if (isError && extensionsLoaded !== true && extensions.length === 0 && retry) {
        return <div className="container py-6"><ExtensionsLoadError onRetry={retry} retrying={isRetrying} /></div>;
    }

    // Find extension with PAGE mount matching path
    let match: any = null;

    // Iterate extensions to find a matching PAGE mount
    // Mount Schema: { point: 'PAGE', path: 'slug', component: ... }
    for (const ext of extensions) {
        if (!ext.template?.mounts || ext.template.status === 'disabled') continue;
        // Preparado una sola vez: migra el formato antiguo y aisla los errores de UI (estado de error amable).
        const prepared = getPreparedManifest(ext.id, ext.template);
        if (!prepared.ok) continue;
        const pageMount = (prepared.template.mounts ?? []).find((m: any) =>
            m.point === 'PAGE' && m.path === routePath
        );
        if (pageMount) {
            match = { mount: pageMount, extensionId: ext.id, state: prepared.template.state, mandatory: isMandatoryExtension(ext) };
            break;
        }
    }

    // Extension desactivada por el usuario (sin desinstalar): la pagina no existe para el.
    // Una obligatoria (manifest o politica del dominio) no se puede desactivar: siempre existe para el usuario.
    if (match && !match.mandatory && !isEnabled(match.extensionId)) match = null;

    if (!match || !match.mount.component) {
        return notFound();
    }

    return (
        <div className="container py-6">
            <JsonRenderer
                component={match.mount.component}
                context={{ extensionId: match.extensionId }}
                initialState={initialStateOf(match.state)}
            />
        </div>
    );
}

export default async function ExtensionPage({ params }: ExtensionPageProps) {
    const { slug } = await params;

    return (
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>}>
            <ExtensionContent slug={slug} />
        </Suspense>
    );
}
