'use client';

import * as React from 'react';
import { JsonRenderer, type JsonComponentProps } from '@/components/expansions/renderer/JsonRenderer';
import type { BackendCaller } from '@/components/expansions/renderer/actions';
import { Badge } from '@/components/expansions/kit/Feedback';
import { useManageStrings } from './strings';

const isRecord = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Backend SIMULADO: responde vacio/ok. La vista previa NUNCA llama al backend real. */
export const previewBackend: BackendCaller = async () => ({ success: true, result: {} });

/** Contexto de ejemplo (datos ficticios con dominios reservados). */
export function sampleContext(extensionId: string, overlays: Record<string, any>) {
    return {
        extensionId,
        overlays,
        email: { id: 'preview-1', from: 'ana@example.com', to: ['tu@example.com'], subject: 'Asunto de ejemplo', folder: 'inbox', date: '2026-01-01T09:00:00.000Z', isRead: false, labels: [], hasAttachments: false },
        emailContent: 'Hola, este es un texto de ejemplo para la vista previa.',
        fromContact: { email: 'ana@example.com', name: 'Ana Ejemplo', firstName: 'Ana', lastName: 'Ejemplo' },
        subject: 'Asunto de ejemplo',
        to: ['ana@example.com'],
    };
}

/** Primer componente previsualizable: un overlay (panel) si existe; si no, el primer mount con componente. */
export function pickPreviewComponent(template: any): { component: JsonComponentProps; overlays: Record<string, any> } | null {
    if (!isRecord(template)) return null;
    const mounts: any[] = Array.isArray(template.mounts) ? template.mounts.filter((m) => isRecord(m)) : [];
    const overlays: Record<string, any> = { ...(isRecord(template.overlays) ? template.overlays : {}) };
    for (const m of mounts) if (m.point === 'OVERLAY' && typeof m.id === 'string' && isRecord(m.component)) overlays[m.id] = m.component;
    const firstOverlay = Object.values(overlays).find((c) => isRecord(c) && typeof c.type === 'string');
    if (firstOverlay) return { component: firstOverlay as JsonComponentProps, overlays };
    const mount = mounts.find((m) => m.point !== 'OVERLAY' && isRecord(m.component) && typeof m.component.type === 'string');
    return mount ? { component: mount.component as JsonComponentProps, overlays } : null;
}

/** Vista previa SOLO visual: contenedor con altura maxima, `inert` y sin eventos de puntero. */
export function ExtensionPreview({ extensionId, template, initialState }: { extensionId: string; template: any; initialState?: Record<string, any> }) {
    const { s } = useManageStrings();
    const picked = React.useMemo(() => pickPreviewComponent(template), [template]);
    const context = React.useMemo(() => (picked ? sampleContext(extensionId, picked.overlays) : null), [picked, extensionId]);
    const runtime = React.useMemo(() => ({ callBackend: previewBackend }), []);
    if (!picked || !context) return <p className="text-sm text-muted-foreground">{s.previewNone}</p>;
    if (picked.component.type === '__EXTENSION_ERROR__') return <p role="status" className="text-sm text-muted-foreground">{s.previewBroken}</p>;
    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
                <Badge tone="info" label={s.preview} size="sm" />
                <span className="text-xs text-muted-foreground">{s.previewHelp}</span>
            </div>
            <div
                data-testid="extension-preview"
                {...({ inert: true } as Record<string, unknown>)}
                aria-hidden="true"
                className="pointer-events-none max-h-72 select-none overflow-hidden rounded-lg border border-border bg-background p-3"
            >
                <JsonRenderer component={picked.component} context={context} initialState={initialState} runtime={runtime} />
            </div>
        </div>
    );
}
