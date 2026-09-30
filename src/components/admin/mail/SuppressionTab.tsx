'use client';

import * as React from 'react';
import {
    Badge, Card, DataTable, ErrorState, FilterBar, FilterSelect, Pagination, SearchInput, ApiError, adminFetch, apiErrorKey,
    btnDangerOutline, buildQuery, formatDateTime, useDebounced, type Column, type Tone,
} from '@/components/admin/console';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAdminQuery } from '@/components/admin/console';
import { useI18n } from '@/components/I18nProvider';
import type { SuppressionPage, SuppressionRow } from './types';

const BULK_MAX = 100;
const REASON_TONE: Record<SuppressionRow['reason'], Tone> = { unsubscribe: 'neutral', bounce: 'warning', complaint: 'danger' };

interface Pending {
    ids: string[];
    recipient?: string;
}

export function SuppressionTab() {
    const { t, intlLocale } = useI18n();
    const [q, setQ] = React.useState('');
    const [reason, setReason] = React.useState('');
    const [page, setPage] = React.useState(1);
    const [pageSize, setPageSize] = React.useState(25);
    const [selected, setSelected] = React.useState<string[]>([]);
    const [pending, setPending] = React.useState<Pending | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [dialogError, setDialogError] = React.useState<string | null>(null);
    const [notice, setNotice] = React.useState('');

    const dq = useDebounced(q.trim(), 300);
    const url = `/api/admin/mail/suppressions${buildQuery({ q: dq, reason, page, pageSize })}`;
    const { data, error, isLoading, isValidating, mutate } = useAdminQuery<SuppressionPage>(url);

    // Al cambiar los filtros se vuelve a la primera pagina y se limpia la seleccion.
    const resetView = () => {
        setPage(1);
        setSelected([]);
    };

    const reasonLabel = (r: SuppressionRow['reason']) => t(`admin.console.mail.suppression.reasons.${r}`);

    const columns: Column<SuppressionRow>[] = [
        { id: 'recipient', header: t('admin.console.mail.suppression.recipient'), isRowHeader: true, cell: (r) => <span className="break-all font-medium">{r.recipient}</span> },
        { id: 'reason', header: t('admin.console.mail.suppression.reason'), cell: (r) => <Badge tone={REASON_TONE[r.reason]}>{reasonLabel(r.reason)}</Badge> },
        { id: 'sender', header: t('admin.console.mail.suppression.sender'), hideBelow: 'md', cell: (r) => (r.senderEmail ? <span className="break-all">{r.senderEmail}</span> : <span className="text-muted-foreground">{t('admin.console.mail.suppression.senderUnknown')}</span>) },
        { id: 'date', header: t('admin.console.mail.suppression.date'), hideBelow: 'sm', cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.createdAt, intlLocale)}</span> },
        {
            id: 'actions',
            header: t('admin.console.common.actions'),
            className: 'text-right',
            cell: (r) => (
                <button
                    type="button"
                    className={`${btnDangerOutline} h-8`}
                    aria-label={t('admin.console.mail.suppression.removeRow', { recipient: r.recipient })}
                    onClick={() => { setDialogError(null); setPending({ ids: [r.id], recipient: r.recipient }); }}
                >
                    {t('admin.console.mail.suppression.remove')}
                </button>
            ),
        },
    ];

    const confirm = async () => {
        if (!pending) return;
        setBusy(true);
        setDialogError(null);
        try {
            const single = pending.ids.length === 1 && pending.recipient !== undefined;
            const res = single
                ? await adminFetch<{ removed: number }>(`/api/admin/mail/suppressions/${encodeURIComponent(pending.ids[0])}`, { method: 'DELETE' })
                : await adminFetch<{ removed: number }>('/api/admin/mail/suppressions/bulk-delete', { method: 'POST', body: { ids: pending.ids } });
            setNotice(res.removed === 1 ? t('admin.console.mail.suppression.removedOne') : t('admin.console.mail.suppression.removedMany', { count: res.removed }));
            setSelected((s) => s.filter((id) => !pending.ids.includes(id)));
            setPending(null);
            await mutate();
        } catch (e) {
            setDialogError(t(apiErrorKey(e instanceof ApiError ? e : new ApiError(-1))));
        } finally {
            setBusy(false);
        }
    };

    const tooMany = selected.length > BULK_MAX;
    const filtered = !!(dq || reason);

    return (
        <Card id="suppression" title={t('admin.console.mail.suppression.title')} description={t('admin.console.mail.suppression.description')}>
            <div className="space-y-4">
                <FilterBar label={t('admin.console.common.filters')}>
                    <SearchInput
                        value={q}
                        onChange={(v) => { setQ(v); resetView(); }}
                        label={t('admin.console.mail.suppression.search')}
                        placeholder={t('admin.console.mail.suppression.search')}
                    />
                    <FilterSelect
                        label={t('admin.console.mail.suppression.reasonLabel')}
                        value={reason}
                        onChange={(v) => { setReason(v); resetView(); }}
                        options={[
                            { value: '', label: t('admin.console.common.all') },
                            { value: 'unsubscribe', label: reasonLabel('unsubscribe') },
                            { value: 'bounce', label: reasonLabel('bounce') },
                            { value: 'complaint', label: reasonLabel('complaint') },
                        ]}
                    />
                </FilterBar>

                <div className="flex min-h-9 flex-wrap items-center gap-3" aria-live="polite">
                    {selected.length > 0 && (
                        <>
                            <span className="text-sm text-muted-foreground">{t('admin.console.common.selectedCount', { count: selected.length })}</span>
                            <button
                                type="button"
                                className={btnDangerOutline}
                                disabled={tooMany}
                                onClick={() => { setDialogError(null); setPending({ ids: selected }); }}
                            >
                                {t('admin.console.mail.suppression.removeSelected', { count: selected.length })}
                            </button>
                            <button type="button" className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => setSelected([])}>
                                {t('admin.console.common.clearSelection')}
                            </button>
                            {tooMany && <span role="alert" className="text-sm text-destructive">{t('admin.console.mail.suppression.selectionLimit', { max: BULK_MAX })}</span>}
                        </>
                    )}
                </div>
                <p role="status" className="text-sm text-success empty:hidden">{notice}</p>

                {error && !data ? (
                    <ErrorState message={t(apiErrorKey(error))} onRetry={() => void mutate()} />
                ) : (
                    <>
                        <DataTable
                            caption={t('admin.console.mail.suppression.caption')}
                            columns={columns}
                            rows={data?.items ?? []}
                            getRowId={(r) => r.id}
                            selectable
                            selected={selected}
                            onSelectedChange={setSelected}
                            rowLabel={(r) => t('admin.console.mail.suppression.rowLabel', { recipient: r.recipient })}
                            loading={isLoading || (isValidating && !data)}
                            minWidth={420}
                            empty={
                                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                                    {filtered ? t('admin.console.mail.suppression.emptyFiltered') : t('admin.console.mail.suppression.empty')}
                                </p>
                            }
                        />
                        {data && data.total > 0 && (
                            <Pagination
                                page={data.page}
                                pages={data.pages}
                                total={data.total}
                                pageSize={data.pageSize}
                                onPage={(p) => setPage(p)}
                                onPageSize={(n) => { setPageSize(n); setPage(1); }}
                            />
                        )}
                    </>
                )}
            </div>

            <ConfirmDialog
                open={pending !== null}
                title={t('admin.console.mail.suppression.confirmTitle')}
                description={
                    pending?.recipient !== undefined
                        ? t('admin.console.mail.suppression.confirmOne', { recipient: pending.recipient })
                        : t('admin.console.mail.suppression.confirmMany', { count: pending?.ids.length ?? 0 })
                }
                confirmLabel={t('admin.console.mail.suppression.confirmAction')}
                cancelLabel={t('admin.console.common.cancel')}
                destructive
                busy={busy}
                error={dialogError}
                onConfirm={() => void confirm()}
                onCancel={() => { if (!busy) setPending(null); }}
            />
        </Card>
    );
}
