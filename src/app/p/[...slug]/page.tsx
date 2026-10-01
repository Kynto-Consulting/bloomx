'use client';

import React, { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { JsonRenderer } from '@/components/expansions/renderer/JsonRenderer';
import { getPreparedManifest } from '@/lib/expansions/prepare-manifest';
import { evaluatePageAccess } from '@/lib/expansions/page-auth';
import { PAGE_MOUNT_POINTS } from '@/lib/expansions/route-schema';

/**
 * /p/<ruta>: paginas de extension PUBLICAS (`auth: "none"`). Sin sesion, SIN datos de usuario (el contexto del renderer solo lleva el id de la
 * extension) y con CSP estricta (next.config.js). Solo existe si el manifest declara PUBLIC_ROUTE y el admin del dominio lo aprobo
 * (settings.meta.approvedPermissions). Se construye con el kit de UI declarativo: nunca HTML arbitrario.
 */
function PublicContent({ slug }: { slug: string[] }) {
    const { extensions, isLoading } = useDomainConfig();
    const routePath = slug.join('/');
    if (isLoading) return <div className="flex justify-center p-10"><Loader2 className="animate-spin" /></div>;

    for (const ext of extensions) {
        const prepared = getPreparedManifest(ext.id, ext.template);
        if (!prepared.ok) continue;
        const mount: any = (prepared.template.mounts ?? []).find((m: any) => PAGE_MOUNT_POINTS.includes(m.point) && m.path === routePath);
        if (!mount) continue;
        const permissions: unknown[] = Array.isArray(prepared.template.permissions) ? prepared.template.permissions : [];
        const approved: unknown[] = Array.isArray(ext.settings?.meta?.approvedPermissions) ? ext.settings.meta.approvedPermissions : [];
        const access = evaluatePageAccess(mount, { signedIn: false, level: null }, { publicRoute: permissions.includes('PUBLIC_ROUTE'), where: 'public', publicApproved: approved.includes(`PUBLIC_ROUTE:PAGE ${routePath}`) });
        if (access !== 'allow' || !mount.component) return notFound();
        return (
            <div className="container py-6">
                <JsonRenderer component={mount.component} context={{ extensionId: ext.id, public: true }} />
            </div>
        );
    }
    return notFound();
}

export default async function PublicExtensionPage({ params }: { params: Promise<{ slug: string[] }> }) {
    const { slug } = await params;
    return (
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>}>
            <PublicContent slug={slug} />
        </Suspense>
    );
}
