'use client';

/**
 * Vista previa viva de un nodo de UI: ThemeScope (paleta del marco) + ErrorBoundary + JsonRenderer. El backend es
 * SIEMPRE simulado (`runtime.callBackend`): nunca se llama al backend real.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { JsonRenderer, type RendererRuntime } from '@/components/expansions/renderer/JsonRenderer';
import { ExpansionUIContext } from '@/contexts/ExpansionUIContext';
import { ExtensionErrorBoundary } from '@/components/expansions/kit/ExtensionError';
import { EXAMPLE_BACKEND, EXAMPLE_CONTEXT, EXAMPLE_OVERLAYS } from '@/lib/expansions/ui-examples';
import { createBackendSimulator, createComposerFunctions } from '@/lib/expansions/playground/simulate';
import { ThemeScope } from './ThemeScope';

export interface LivePreviewProps {
    node: any;
    context: Record<string, any>;
    initialState?: Record<string, any>;
    themeId: string;
    /** Ancho maximo del marco en px (movil 375, tablet 768); null/undefined = 100 %. */
    width?: number | null;
    runtime?: RendererRuntime;
    /** Cambiar este valor reinicia la vista previa (remonta el arbol y su estado). */
    resetKey?: string | number;
    className?: string;
    label?: string;
}

function stable(value: unknown): string {
    try { return JSON.stringify(value) ?? ''; } catch { return ''; }
}

export function LivePreview({ node, context, initialState, themeId, width, runtime, resetKey, className = '', label }: LivePreviewProps) {
    // El estado inicial o el reinicio remontan el arbol (ExtensionStateProvider solo lee initialState al montar).
    const mountKey = `${resetKey ?? 0}:${stable(initialState)}`;
    return (
        <div className={`overflow-x-auto ${className}`}>
            <ThemeScope
                themeId={themeId}
                role={label ? "region" : undefined}
                aria-label={label}
                className="mx-auto rounded-lg border border-border p-4 transition-[max-width] duration-200"
                {...(width ? { 'data-viewport-width': String(width) } : {})}
            >
                <div style={width ? { maxWidth: `${width}px`, marginInline: 'auto' } : undefined}>
                    <ExtensionErrorBoundary key={mountKey} extensionId={typeof context?.extensionId === 'string' ? context.extensionId : undefined}>
                        {/* Sin proveedor de overlays de la app: los dialogos se abren DENTRO del marco y heredan su tema */}
                        <ExpansionUIContext.Provider value={undefined}>
                            <JsonRenderer key={mountKey} component={node} context={context} initialState={initialState} runtime={runtime} />
                        </ExpansionUIContext.Provider>
                    </ExtensionErrorBoundary>
                </div>
            </ThemeScope>
        </div>
    );
}

/** Ejemplo de la galeria: contexto de correo de ejemplo, overlays de ejemplo y backend simulado propio. */
export function ExamplePreview({ node, themeId, width, label, className }: { node: any; themeId: string; width?: number | null; label?: string; className?: string }) {
    const simulator = useMemo(() => createBackendSimulator(() => EXAMPLE_BACKEND), []);
    const composer = useMemo(() => createComposerFunctions(() => { /* la galeria no muestra eventos */ }), []);
    const context = useMemo(() => ({ ...EXAMPLE_CONTEXT, overlays: EXAMPLE_OVERLAYS, ...composer }), [composer]);
    const runtime = useMemo<RendererRuntime>(() => ({ callBackend: simulator.callBackend }), [simulator]);
    return <LivePreview node={node} context={context} themeId={themeId} width={width} runtime={runtime} label={label} className={className} />;
}

/**
 * Monta a sus hijos cuando entran en pantalla (las vistas "todos los temas" pintan decenas de ejemplos). Sin
 * IntersectionObserver (tests/jsdom) monta de inmediato. Una vez montado no se desmonta.
 */
export function LazyMount({ children, minHeight = 80, className }: { children: React.ReactNode; minHeight?: number; className?: string }) {
    const ref = useRef<HTMLDivElement>(null);
    // El primer render (servidor y cliente) siempre es "no visible": decidirlo en el render daria un desajuste de hidratacion.
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        if (visible) return;
        if (!ref.current || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) { setVisible(true); observer.disconnect(); }
        }, { rootMargin: '300px' });
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, [visible]);
    return <div ref={ref} className={className} style={visible ? undefined : { minHeight }}>{visible ? children : null}</div>;
}
