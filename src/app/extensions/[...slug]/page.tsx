'use client';

import React, { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { JsonRenderer } from '@/components/expansions/renderer/JsonRenderer';
import { normalizeMount, validateManifest } from '@/lib/expansions/manifest-schema';

interface ExtensionPageProps {
    params: Promise<{ slug: string[] }>;
}

function ExtensionContent({ slug }: { slug: string[] }) {
    const { extensions, isLoading } = useDomainConfig();
    const routePath = slug.join('/');

    if (isLoading) return <div className="flex justify-center p-10"><Loader2 className="animate-spin" /></div>;

    // Find extension with PAGE mount matching path
    let match: any = null;

    // Iterate extensions to find a matching PAGE mount
    // Mount Schema: { point: 'PAGE', path: 'slug', component: ... }
    for (const ext of extensions) {
        if (!ext.template?.mounts || ext.template.status === 'disabled') continue;
        if (!validateManifest(ext.template).ok) continue;
        const pageMount = ext.template.mounts.find((m: any) =>
            m.point === 'PAGE' && m.path === routePath
        );
        if (pageMount) {
            match = { mount: normalizeMount(pageMount), extensionId: ext.id };
            break;
        }
    }

    if (!match || !match.mount.component) {
        return notFound();
    }

    return (
        <div className="container py-6">
            <JsonRenderer
                component={match.mount.component}
                context={{ extensionId: match.extensionId }}
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
