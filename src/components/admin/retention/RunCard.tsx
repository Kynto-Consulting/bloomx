'use client';

import * as React from 'react';
import { useSWRConfig } from 'swr';
import { AlertTriangle, Play, PlayCircle } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { ApiError, Badge, Card, StrongConfirmDialog, adminFetch, apiErrorKey, btnDanger, btnOutline, formatNumber } from '@/components/admin/console';
import { totalToDelete, type RetentionReportView } from './types';

const ROWS = [
    'spamEmails', 'trashEmails', 'rawPayloads', 'secureMessages', 'auditEventsPurged', 'sessionRowsPurged',
    'revocationsPurged', 'extensionNotificationsPurged', 'storageFailed',
] as const;
/** No se calculan en una simulacion. */
const NOT_SIMULATED = new Set<string>(['revocationsPurged', 'extensionNotificationsPurged']);

export function RunCard() {
    const { t, intlLocale } = useI18n();
    const { mutate } = useSWRConfig();
    const [busy, setBusy] = React.useState<'dry' | 'real' | null>(null);
    const [confirmOpen, setConfirmOpen] = React.useState(false);
    const [lastDry, setLastDry] = React.useState<RetentionReportView | null>(null);
    const [result, setResult] = React.useState<RetentionReportView | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [dialogError, setDialogError] = React.useState<string | null>(null);

    const errorText = (e: unknown): string => {
        if (e instanceof ApiError && e.status === 409) return t('admin.console.account.retention.run.errors.inProgress');
        if (e instanceof ApiError && e.status === 429) return t('admin.console.account.retention.run.errors.rateLimited');
        return t(apiErrorKey(e));
    };

    const run = async (dryRun: boolean) => {
        setBusy(dryRun ? 'dry' : 'real');
        setError(null);
        setDialogError(null);
        try {
            const report = await adminFetch<RetentionReportView>('/api/admin/retention/run', { method: 'POST', body: { dryRun } });
            setResult(report);
            if (dryRun) setLastDry(report);
            else {
                setLastDry(null);
                setConfirmOpen(false);
                void mutate('/api/admin/retention/storage');
            }
        } catch (e) {
            if (dryRun) setError(errorText(e));
            else setDialogError(errorText(e));
        } finally {
            setBusy(null);
        }
    };

    const nf = (n: number) => formatNumber(n, intlLocale);
    const estimate = lastDry ? totalToDelete(lastDry) : null;

    return (
        <Card title={t('admin.console.account.retention.run.title')} description={t('admin.console.account.retention.run.description')} id="run">
            <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                    <button type="button" className={btnOutline} onClick={() => void run(true)} disabled={busy !== null} aria-busy={busy === 'dry' || undefined}>
                        <PlayCircle className="h-4 w-4" aria-hidden="true" />
                        {t('admin.console.account.retention.run.simulate')}
                    </button>
                    <button type="button" className={btnDanger} onClick={() => { setDialogError(null); setConfirmOpen(true); }} disabled={busy !== null}>
                        <Play className="h-4 w-4" aria-hidden="true" />
                        {t('admin.console.account.retention.run.execute')}
                    </button>
                </div>
                <p className="flex items-start gap-2 text-sm text-muted-foreground">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                    <span>{t('admin.console.account.retention.run.irreversible')}</span>
                </p>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

                <div role="status" aria-live="polite">
                    {result && (
                        <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-sm font-semibold text-foreground">{t('admin.console.account.retention.run.result')}</h3>
                                <Badge tone={result.dryRun ? 'info' : 'success'}>{t(result.dryRun ? 'admin.console.account.retention.run.modeDry' : 'admin.console.account.retention.run.modeReal')}</Badge>
                            </div>
                            <div className="overflow-x-auto rounded-lg border border-border">
                                <table className="w-full min-w-[320px] text-sm">
                                    <caption className="sr-only">{t('admin.console.account.retention.run.resultCaption')}</caption>
                                    <thead className="bg-muted/60 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                        <tr>
                                            <th scope="col" className="px-3 py-2">{t('admin.console.account.retention.run.table.item')}</th>
                                            <th scope="col" className="px-3 py-2 text-right">{t(result.dryRun ? 'admin.console.account.retention.run.table.wouldDelete' : 'admin.console.account.retention.run.table.deleted')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/60">
                                        {ROWS.map((key) => {
                                            const value = result[key];
                                            if (value === undefined) return null;
                                            return (
                                                <tr key={key}>
                                                    <th scope="row" className="px-3 py-2 text-left font-normal">{t(`admin.console.account.retention.run.items.${key}`)}</th>
                                                    <td className="px-3 py-2 text-right tabular-nums">{result.dryRun && NOT_SIMULATED.has(key) ? t('admin.console.account.retention.run.notSimulated') : nf(value)}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <StrongConfirmDialog
                open={confirmOpen}
                title={t('admin.console.account.retention.run.confirm.title')}
                description={
                    <>
                        <p>{t('admin.console.account.retention.run.confirm.body')}</p>
                        <p className="mt-2 font-medium text-foreground">
                            {estimate === null
                                ? t('admin.console.account.retention.run.confirm.noSimulation')
                                : t('admin.console.account.retention.run.confirm.estimate', { count: nf(estimate) })}
                        </p>
                    </>
                }
                phrase={t('admin.console.account.retention.run.confirm.phrase')}
                confirmLabel={t('admin.console.account.retention.run.confirm.confirm')}
                cancelLabel={t('admin.console.common.cancel')}
                busy={busy === 'real'}
                error={dialogError}
                onConfirm={() => void run(false)}
                onCancel={() => setConfirmOpen(false)}
            />
        </Card>
    );
}
