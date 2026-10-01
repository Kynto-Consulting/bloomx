'use client';

import { RefreshCw } from 'lucide-react';
import { Badge, ErrorState, LoadingState, apiErrorKey, btnOutline, formatDateTime } from '@/components/admin/console';
import { useI18n } from '@/components/I18nProvider';
import type { ExtensionRow } from '@/lib/admin/extensions-view';
import type { RunLogEntry } from '@/lib/expansions/settings-schema';
import { useExtensionConfig } from './useExtensionConfig';

const TONE = { ok: 'success', failed: 'danger', retry: 'warning', skipped: 'neutral' } as const;

/** Nombre de los elementos (`objects`) por id, para mostrar el destino de una entrega en lugar de su id. */
export function targetNames(row: ExtensionRow, values: Record<string, unknown> | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const field of row.template?.settingsSchema?.fields ?? []) {
        if (field.type !== 'objects' || !Array.isArray(values?.[field.key])) continue;
        const nameKey = (field.itemFields ?? []).find((s) => !s.secret && s.type === 'string')?.key;
        for (const item of values![field.key] as Array<Record<string, unknown>>) {
            if (item && typeof item.id === 'string') out[item.id] = nameKey && typeof item[nameKey] === 'string' && item[nameKey] ? String(item[nameKey]) : item.id;
        }
    }
    return out;
}

/** "Registro de ejecuciones recientes" (settingsSchema.runLog): lo que devuelve GET config, sin cuerpos ni secretos. */
export function RunLogTable({ row, domainId }: { row: ExtensionRow; domainId: string }) {
    const { t, intlLocale } = useI18n();
    const config = useExtensionConfig(domainId, row.id, row.installed);
    if (!row.template?.settingsSchema?.runLog) return null;

    const names = targetNames(row, config.data?.values);
    const entries: RunLogEntry[] = config.data?.runLog ?? [];
    const title = t('admin.console.extensions.runLog.title');

    return (
        <section aria-label={title} className="space-y-2" data-testid="run-log">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                {row.installed && (
                    <button type="button" className={btnOutline} onClick={config.retry} aria-label={t('admin.console.extensions.runLog.refresh')}>
                        <RefreshCw className="h-4 w-4" aria-hidden="true" />{t('admin.console.extensions.runLog.refresh')}
                    </button>
                )}
            </div>
            <p className="text-xs text-muted-foreground">{t('admin.console.extensions.runLog.note')}</p>
            {!row.installed ? (
                <p className="text-sm text-muted-foreground">{t('admin.console.extensions.runLog.needInstall')}</p>
            ) : config.isLoading && !config.data ? (
                <LoadingState />
            ) : config.error && !config.data ? (
                <ErrorState message={t(apiErrorKey(config.error))} onRetry={config.retry} />
            ) : entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('admin.console.extensions.runLog.empty')}</p>
            ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[640px] text-left text-sm">
                        <caption className="sr-only">{title}</caption>
                        <thead className="bg-muted/50 text-xs text-muted-foreground">
                            <tr>
                                {(['when', 'event', 'target', 'status', 'attempts', 'latency', 'code', 'message'] as const).map((c) => (
                                    <th key={c} scope="col" className="px-3 py-2">{t(`admin.console.extensions.runLog.columns.${c}`)}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                            {entries.map((e, i) => (
                                <tr key={`${e.ts}-${i}`}>
                                    <td className="whitespace-nowrap px-3 py-2">{formatDateTime(e.ts, intlLocale)}</td>
                                    <td className="px-3 py-2"><code className="text-xs">{e.event}</code></td>
                                    <td className="px-3 py-2">{e.target ? names[e.target] ?? e.target : '—'}</td>
                                    <td className="px-3 py-2"><Badge tone={TONE[e.status]}>{t(`admin.console.extensions.runLog.status.${e.status}`)}</Badge></td>
                                    <td className="px-3 py-2">{e.attempts ?? '—'}</td>
                                    <td className="whitespace-nowrap px-3 py-2">{e.latencyMs !== undefined ? `${e.latencyMs} ms` : '—'}</td>
                                    <td className="px-3 py-2">{e.code ?? '—'}</td>
                                    <td className="max-w-[240px] break-words px-3 py-2">{e.message ?? '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
