'use client';

import React, { useEffect, useState } from 'react';
import { notFound, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { useExtensionPrefs } from '@/hooks/useExtensionPrefs';
import { useI18n } from '@/components/I18nProvider';
import { JsonRenderer } from '@/components/expansions/renderer/JsonRenderer';
import { getPreparedManifest } from '@/lib/expansions/prepare-manifest';
import { isMandatoryExtension } from '@/lib/expansions/client/prefs';
import { ExtensionsLoadError } from '@/components/expansions/ExtensionsLoadError';
import { pageAuthOf } from '@/lib/expansions/route-schema';
import { manifestTexts } from '@/lib/expansions/manifest-schema';
import { navLabel, readNavEntries } from '@/lib/expansions/nav-schema';

/** `state` inicial declarado en el manifest (objeto JSON pequeno). */
function initialStateOf(state: unknown): Record<string, any> | undefined {
    if (!state || typeof state !== 'object' || Array.isArray(state)) return undefined;
    try { return JSON.stringify(state).length <= 50_000 ? (state as Record<string, any>) : undefined; } catch { return undefined; }
}

/**
 * Paginas con `auth: "admin"`: el servidor decide (nivel + MFA + sesion privilegiada) con /api/expansions/page-access; mientras no
 * responda 'allow' NO se monta el componente de la extension (falla cerrado). Las `none` solo existen en /p/** (aqui: 404).
 */
function AdminGate({ extensionId, path, children }: { extensionId: string; path: string; children: React.ReactNode }) {
    const router = useRouter();
    const [access, setAccess] = useState<string | null>(null);
    useEffect(() => {
        let alive = true;
        fetch(`/api/expansions/page-access?extensionId=${encodeURIComponent(extensionId)}&path=${encodeURIComponent(path)}`, { cache: 'no-store' })
            .then((r) => r.json())
            .then((d) => { if (alive) setAccess(typeof d?.access === 'string' ? d.access : 'not_found'); })
            .catch(() => { if (alive) setAccess('not_found'); });
        return () => { alive = false; };
    }, [extensionId, path]);
    useEffect(() => { if (access === 'login') router.replace('/login'); }, [access, router]);
    if (access === 'allow') return <>{children}</>;
    if (access === 'forbidden' || access === 'not_found') return notFound();
    return <PageSpinner />;
}

function PageSpinner() {
    const { t } = useI18n();
    return (
        <div className="flex justify-center p-10" role="status">
            <Loader2 className="animate-spin" aria-hidden="true" />
            <span className="sr-only">{t('extensionState.nav.pageLoading')}</span>
        </div>
    );
}

export type ExtensionPageVariant = 'app' | 'console';

/**
 * Pagina completa de una extension (mount PAGE): `/extensions/<path>` en la app y `/admin/x/<path>` dentro de la consola de administracion.
 * Resuelve la extension por el `path` del mount; respeta las preferencias del usuario (extension desactivada = 404) y el `auth` del mount
 * (session / admin con comprobacion en el servidor; none solo en /p/**). Estados: cargando, error de carga con Reintentar, no encontrada (404).
 * El titulo de la pestana sale de la entrada de navegacion (o del nombre de la extension).
 */
export function ExtensionPageView({ slug, variant = 'app' }: { slug: string[]; variant?: ExtensionPageVariant }) {
    const { extensions, isLoading, isError, extensionsLoaded, retry, isRetrying } = useDomainConfig();
    const { isEnabled } = useExtensionPrefs();
    const { locale } = useI18n();
    const routePath = slug.join('/');

    // Pagina que corresponde al path (se calcula antes de cualquier retorno: el titulo de la pestana es un efecto).
    let match: any = null;
    let title = '';
    if (!isLoading) {
        for (const ext of extensions) {
            if (!ext.template?.mounts || ext.template.status === 'disabled') continue;
            // Preparado una sola vez: migra el formato antiguo y aisla los errores de UI (estado de error amable).
            const prepared = getPreparedManifest(ext.id, ext.template);
            if (!prepared.ok) continue;
            const pageMount = (prepared.template.mounts ?? []).find((m: any) => m.point === 'PAGE' && m.path === routePath);
            if (pageMount) {
                const entry = readNavEntries(prepared.template).find((e) => e.pagePath === routePath);
                title = entry ? navLabel(entry.label, locale) : manifestTexts(prepared.template, locale).name;
                match = { mount: pageMount, auth: pageAuthOf(pageMount), extensionId: ext.id, state: prepared.template.state, mandatory: isMandatoryExtension(ext) };
                break;
            }
        }
    }
    useEffect(() => {
        if (!title || typeof document === 'undefined') return;
        const previous = document.title;
        document.title = title;
        return () => { document.title = previous; };
    }, [title]);

    if (isLoading) return <PageSpinner />;

    // No se pudo cargar la lista (red/servidor): se avisa y se ofrece Reintentar en vez de decir que la pagina no existe.
    if (isError && extensionsLoaded !== true && extensions.length === 0 && retry) {
        return <div className="container py-6"><ExtensionsLoadError onRetry={retry} retrying={isRetrying} /></div>;
    }

    // Extension desactivada por el usuario (sin desinstalar): la pagina no existe para el.
    // Una obligatoria (manifest o politica del dominio) no se puede desactivar: siempre existe para el usuario.
    if (match && !match.mandatory && !isEnabled(match.extensionId)) match = null;

    if (!match || !match.mount.component) return notFound();
    // auth: none => solo en /p/** (sin sesion ni datos de usuario); nunca dentro de la app.
    if (match.auth === 'none') return notFound();

    const page = (
        <div className={variant === 'console' ? 'mx-auto w-full max-w-7xl' : 'container py-6'}>
            <JsonRenderer
                component={match.mount.component}
                context={{ extensionId: match.extensionId }}
                initialState={initialStateOf(match.state)}
            />
        </div>
    );
    return match.auth === 'admin' ? <AdminGate extensionId={match.extensionId} path={routePath}>{page}</AdminGate> : page;
}
