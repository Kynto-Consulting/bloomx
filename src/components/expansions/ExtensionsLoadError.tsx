'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background';

interface Props {
    /** `inline`: boton compacto para barras y paneles (mount points). `block`: aviso con titulo y explicacion (paginas). */
    variant?: 'inline' | 'block';
    onRetry: () => void;
    /** Hay un reintento en curso. */
    retrying?: boolean;
    /** Se estan mostrando los ultimos datos buenos (el fallo fue al actualizar). */
    stale?: boolean;
}

/**
 * Estado de ERROR al cargar las extensiones del dominio (red, timeout, 5xx). Sustituye a "sin extensiones": el usuario sabe que
 * algo fallo, puede pulsar Reintentar y el lector de pantalla lo anuncia. Solo tokens del tema.
 */
export function ExtensionsLoadError({ variant = 'block', onRetry, retrying, stale }: Props) {
    const { t } = useI18n();
    if (variant === 'inline') {
        return (
            <button
                type="button"
                onClick={onRetry}
                disabled={retrying}
                title={t('extensionState.loadError.inline')}
                aria-label={t('extensionState.loadError.inline')}
                data-testid="extensions-load-error"
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 text-xs font-medium text-foreground transition-colors hover:bg-destructive/20 disabled:opacity-60 ${FOCUS}`}
            >
                <AlertTriangle className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                <span>{retrying ? t('extensionState.loadError.retrying') : t('extensionState.loadError.retry')}</span>
            </button>
        );
    }
    return (
        <div role="alert" data-testid="extensions-load-error" className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-foreground">
            <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
                <div className="space-y-1">
                    <p className="font-semibold">{t('extensionState.loadError.title')}</p>
                    <p className="text-muted-foreground">{stale ? t('extensionState.loadError.bodyStale') : t('extensionState.loadError.body')}</p>
                </div>
            </div>
            <button
                type="button"
                onClick={onRetry}
                disabled={retrying}
                className={`inline-flex w-fit items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60 ${FOCUS}`}
            >
                <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
                {retrying ? t('extensionState.loadError.retrying') : t('extensionState.loadError.retry')}
            </button>
        </div>
    );
}
