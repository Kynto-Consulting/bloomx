'use client';

import * as React from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { Card, ErrorState, LoadingState, StatCard, apiErrorKey, btnOutline, formatBytes, formatDateTime, formatNumber, useAdminQuery } from '@/components/admin/console';
import { totalToDelete, type StorageResponse } from './types';

const WOULD_ROWS = ['spamEmails', 'trashEmails', 'rawPayloads', 'secureMessages', 'auditEventsPurged', 'sessionRowsPurged'] as const;

export function StorageCard() {
    const { t, intlLocale } = useI18n();
    const { data, error, isLoading, isValidating, mutate } = useAdminQuery<StorageResponse>('/api/admin/retention/storage');
    const n = (v: number | null | undefined) => formatNumber(v ?? null, intlLocale);
    const na = t('admin.console.account.retention.storage.unavailable');

    return (
        <Card
            title={t('admin.console.account.retention.storage.title')}
            description={t('admin.console.account.retention.storage.description')}
            id="storage"
            actions={
                <button type="button" className={btnOutline} onClick={() => void mutate()} disabled={isValidating}>
                    <RefreshCw className={isValidating ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden="true" />
                    {t('admin.console.account.retention.storage.refresh')}
                </button>
            }
        >
            {error && !data ? (
                <ErrorState message={t(apiErrorKey(error))} onRetry={() => void mutate()} />
            ) : isLoading || !data ? (
                <LoadingState />
            ) : (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <StatCard label={t('admin.console.account.retention.storage.attachmentsBytes')} value={data.attachments ? formatBytes(data.attachments.bytes, intlLocale) : na} />
                        <StatCard label={t('admin.console.account.retention.storage.attachmentsCount')} value={data.attachments ? n(data.attachments.count) : na} />
                        <StatCard label={t('admin.console.account.retention.storage.auditEvents')} value={data.tables.auditEvents === null ? na : n(data.tables.auditEvents)}
                            hint={data.tables.oldestAuditAt ? t('admin.console.account.retention.storage.oldest', { date: formatDateTime(data.tables.oldestAuditAt, intlLocale) }) : undefined} />
                        <StatCard label={t('admin.console.account.retention.storage.sessions')} value={data.tables.userSessions === null ? na : n(data.tables.userSessions)}
                            hint={data.tables.revokedSessions === null ? undefined : t('admin.console.account.retention.storage.revoked', { count: n(data.tables.revokedSessions) })} />
                    </div>

                    <div className="grid gap-6 lg:grid-cols-2">
                        <section aria-labelledby="ret-folders">
                            <h3 id="ret-folders" className="mb-2 text-sm font-semibold text-foreground">{t('admin.console.account.retention.storage.byFolder')}</h3>
                            {!data.emailsByFolder ? <p className="text-sm text-muted-foreground">{na}</p> : data.emailsByFolder.length === 0 ? (
                                <p className="text-sm text-muted-foreground">{t('admin.console.account.retention.storage.noEmails')}</p>
                            ) : (
                                <div className="overflow-x-auto rounded-lg border border-border">
                                    <table className="w-full min-w-[240px] text-sm">
                                        <caption className="sr-only">{t('admin.console.account.retention.storage.byFolder')}</caption>
                                        <thead className="bg-muted/60 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                            <tr><th scope="col" className="px-3 py-2">{t('admin.console.account.retention.storage.folder')}</th><th scope="col" className="px-3 py-2 text-right">{t('admin.console.account.retention.storage.emails')}</th></tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/60">
                                            {data.emailsByFolder.map((f) => (
                                                <tr key={f.folder}><th scope="row" className="px-3 py-2 text-left font-normal">{f.folder}</th><td className="px-3 py-2 text-right tabular-nums">{n(f.count)}</td></tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </section>

                        <section aria-labelledby="ret-top">
                            <h3 id="ret-top" className="mb-2 text-sm font-semibold text-foreground">{t('admin.console.account.retention.storage.topUsers')}</h3>
                            {!data.topUsers ? <p className="text-sm text-muted-foreground">{na}</p> : data.topUsers.length === 0 ? (
                                <p className="text-sm text-muted-foreground">{t('admin.console.account.retention.storage.noAttachments')}</p>
                            ) : (
                                <div className="overflow-x-auto rounded-lg border border-border">
                                    <table className="w-full min-w-[320px] text-sm">
                                        <caption className="sr-only">{t('admin.console.account.retention.storage.topUsers')}</caption>
                                        <thead className="bg-muted/60 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                            <tr>
                                                <th scope="col" className="px-3 py-2">{t('admin.console.account.retention.storage.user')}</th>
                                                <th scope="col" className="px-3 py-2 text-right">{t('admin.console.account.retention.storage.attachmentsCount')}</th>
                                                <th scope="col" className="px-3 py-2 text-right">{t('admin.console.account.retention.storage.size')}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/60">
                                            {data.topUsers.map((u) => (
                                                <tr key={u.userId}>
                                                    <th scope="row" className="max-w-[14rem] truncate px-3 py-2 text-left font-normal">
                                                        <Link href={`/admin/users?open=${encodeURIComponent(u.userId)}`} className="text-primary underline underline-offset-2">{u.email}</Link>
                                                    </th>
                                                    <td className="px-3 py-2 text-right tabular-nums">{n(u.attachments)}</td>
                                                    <td className="px-3 py-2 text-right tabular-nums">{formatBytes(u.bytes, intlLocale)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            <p className="mt-2 text-xs text-muted-foreground">{t('admin.console.account.retention.storage.topNote')}</p>
                        </section>
                    </div>

                    <section aria-labelledby="ret-would">
                        <h3 id="ret-would" className="mb-1 text-sm font-semibold text-foreground">{t('admin.console.account.retention.storage.wouldTitle')}</h3>
                        <p className="mb-2 text-xs text-muted-foreground">{t('admin.console.account.retention.storage.wouldHint')}</p>
                        {!data.wouldDelete ? <p className="text-sm text-muted-foreground">{na}</p> : (
                            <>
                                <p className="mb-2 text-sm font-medium text-foreground">{t('admin.console.account.retention.storage.wouldTotal', { count: n(totalToDelete(data.wouldDelete)) })}</p>
                                <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                                    {WOULD_ROWS.map((k) => (
                                        <li key={k} className="flex justify-between gap-3 border-b border-border/40 py-1">
                                            <span className="text-muted-foreground">{t(`admin.console.account.retention.run.items.${k}`)}</span>
                                            <span className="tabular-nums text-foreground">{n(data.wouldDelete![k] ?? 0)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                    </section>
                </div>
            )}
        </Card>
    );
}
