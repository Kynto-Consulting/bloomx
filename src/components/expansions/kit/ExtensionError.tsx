'use client';

import * as React from 'react';
import { TriangleAlert } from 'lucide-react';
import { useKitStrings } from './strings';
import { reportExtensionError } from '@/lib/expansions/client/error-log';

export interface ExtensionErrorIssue { path?: string; message: string }

/**
 * Estado de error amable: sustituye a un componente de extension que no se puede mostrar (UI invalida, excepcion
 * al renderizar). No rompe el resto de la app. Los detalles (rutas exactas) estan en un desplegable para el autor.
 */
export function ExtensionErrorState({ extensionId, issues, title }: { extensionId?: string; issues: ExtensionErrorIssue[]; title?: string }) {
    const strings = useKitStrings();
    const shown = issues.slice(0, 8);
    return (
        <div role="alert" data-extension-error="" className="rounded-lg border border-warning/50 bg-card p-3 text-sm text-card-foreground">
            <div className="flex items-start gap-2">
                <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
                <div className="min-w-0 space-y-1">
                    <p className="font-medium">{title || strings.extensionError}{extensionId ? ` (${extensionId})` : ''}</p>
                    <p className="text-muted-foreground">{strings.extensionErrorHelp}</p>
                    {shown.length > 0 && (
                        <details className="text-xs">
                            <summary className="cursor-pointer rounded-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                {strings.details} ({issues.length})
                            </summary>
                            <ul className="mt-1 list-disc space-y-0.5 pl-4">
                                {shown.map((issue, index) => (
                                    <li key={index} className="break-words">
                                        {issue.path ? <code className="rounded-sm bg-code px-1 text-code-foreground">{issue.path}</code> : null}{issue.path ? ' ' : ''}{issue.message}
                                    </li>
                                ))}
                                {issues.length > shown.length && <li>... +{issues.length - shown.length}</li>}
                            </ul>
                        </details>
                    )}
                </div>
            </div>
        </div>
    );
}

interface BoundaryProps { extensionId?: string; children: React.ReactNode }
interface BoundaryState { error: Error | null }

/** Atrapa excepciones de render de un arbol de extension: muestra ExtensionErrorState y lo registra para el autor. */
export class ExtensionErrorBoundary extends React.Component<BoundaryProps, BoundaryState> {
    state: BoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): BoundaryState {
        return { error };
    }

    componentDidCatch(error: Error) {
        reportExtensionError({ extensionId: this.props.extensionId || 'desconocida', kind: 'render', message: error?.message || 'Error al renderizar' });
    }

    render() {
        if (this.state.error) {
            return <ExtensionErrorState extensionId={this.props.extensionId} issues={[{ message: this.state.error.message }]} />;
        }
        return this.props.children;
    }
}
