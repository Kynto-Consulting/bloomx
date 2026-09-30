'use client';

import * as React from 'react';
import { Activity } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { cn } from '@/lib/utils';
import { useAdminQuery } from './api';

interface SystemResponse {
    status: 'ok' | 'degraded' | 'down';
    db: { ok: boolean; ms: number };
    backend: { ok: boolean; ms: number };
    rateLimit: 'redis' | 'memory';
    legacy: boolean;
}

const DOT: Record<SystemResponse['status'], string> = { ok: 'bg-success', degraded: 'bg-warning', down: 'bg-destructive' };

/**
 * Indicador compacto del estado del sistema (cabecera). Consulta /api/admin/system cada minuto. El estado va en TEXTO
 * ademas del color del punto. El boton abre un resumen (disclosure: aria-expanded) con base de datos, backend y limite de peticiones.
 */
export function SystemStatus() {
    const { t } = useI18n();
    const { data, error, isLoading } = useAdminQuery<SystemResponse>('/api/admin/system', { refreshInterval: 60_000 });
    const [open, setOpen] = React.useState(false);
    const ref = React.useRef<HTMLDivElement>(null);
    const panelId = React.useId();

    React.useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
    }, [open]);

    const status: SystemResponse['status'] | 'checking' = error ? 'down' : data ? data.status : 'checking';
    const label = t(`admin.console.shell.status.${status === 'checking' ? 'checking' : status}`);
    const row = (name: string, ok: boolean, ms?: number) => (
        <li className="flex items-center justify-between gap-3">
            <span>{name}</span>
            <span className={cn('font-medium', ok ? 'text-success' : 'text-destructive')}>
                {ok ? t('admin.console.shell.status.up') : t('admin.console.shell.status.failing')}
                {ok && ms !== undefined ? ` · ${t('admin.console.shell.status.latency', { ms })}` : ''}
            </span>
        </li>
    );

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-controls={panelId}
                aria-label={`${t('admin.console.shell.status.label')}: ${label}`}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', status === 'checking' ? 'animate-pulse bg-muted-foreground' : DOT[status])} />
                <Activity className="h-3.5 w-3.5 sm:hidden" aria-hidden="true" />
                <span className="hidden max-w-[11rem] truncate sm:inline" role="status">{isLoading && !data ? t('admin.console.shell.status.checking') : label}</span>
            </button>
            {open && (
                <div id={panelId} role="region" aria-label={t('admin.console.shell.status.label')} className="absolute right-0 z-40 mt-2 w-72 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg">
                    {data ? (
                        <ul className="space-y-2">
                            {row(t('admin.console.shell.status.database'), data.db.ok, data.db.ms)}
                            {row(t('admin.console.shell.status.backend'), data.backend.ok, data.backend.ms)}
                            <li className="flex items-center justify-between gap-3">
                                <span>{t('admin.console.shell.status.rateLimit')}</span>
                                <span className="font-medium">{t(data.rateLimit === 'redis' ? 'admin.console.shell.status.rateRedis' : 'admin.console.shell.status.rateMemory')}</span>
                            </li>
                        </ul>
                    ) : (
                        <p className="text-muted-foreground">{label}</p>
                    )}
                </div>
            )}
        </div>
    );
}
