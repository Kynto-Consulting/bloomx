'use client';

import * as React from 'react';
import { Download, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useI18n } from '@/components/I18nProvider';
import {
    Badge, DataTable, EmptyState, ErrorState, FilterBar, FilterSelect, PageHeader, Pagination, RowButton, SearchInput, adminFetch, apiErrorKey,
    btnDangerOutline, btnGhost, btnOutline, btnPrimary, buildQuery, downloadCsv, formatBytes, formatDateTime, initials, useAdminQuery, useDebounced,
    type Column,
} from '@/components/admin/console';
import { CreateUserModal } from './CreateUserModal';
import { UserDrawer } from './UserDrawer';
import { intParam, useUrlParams } from './useUrlParams';
import type { UserRow, UsersResponse } from './types';

type BulkAction = 'disable' | 'enable' | 'revokeSessions';
const SORTS = ['createdAt', 'email', 'name', 'lastLogin', 'storage'] as const;
const pick = <T extends string>(value: string, allowed: readonly T[]): T | '' => ((allowed as readonly string[]).includes(value) ? (value as T) : '');

/** /admin/users: lista con filtros en la URL, seleccion masiva, detalle en panel lateral y alta. */
export function UsersPage() {
    const { t, intlLocale } = useI18n();
    const { get, update } = useUrlParams();

    const q = get('q');
    const status = pick(get('status'), ['active', 'disabled'] as const);
    const role = pick(get('role'), ['admin', 'user'] as const);
    const mfa = pick(get('mfa'), ['yes', 'no'] as const);
    const google = pick(get('google'), ['yes', 'no'] as const);
    const sortId = pick(get('sort'), SORTS) || 'createdAt';
    const dir = get('dir') === 'asc' ? 'asc' : 'desc';
    const page = intParam(get('page'), 1);
    const pageSize = intParam(get('pageSize'), 25, 1, 100);
    const openId = get('open');
    const createOpen = get('create') === '1';

    // Buscador con debounce: el texto local se vuelca a la URL (y de ahi a la consulta) tras una pausa.
    const [qInput, setQInput] = React.useState(q);
    const debouncedQ = useDebounced(qInput, 300);
    const lastPushed = React.useRef(q);
    React.useEffect(() => {
        const next = debouncedQ.trim();
        if (next !== q) {
            lastPushed.current = next;
            update({ q: next }, { resetPage: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedQ]);
    React.useEffect(() => {
        // Cambios externos de la URL (limpiar filtros, enlaces): sincroniza el campo sin pisar lo que se esta escribiendo.
        if (q !== lastPushed.current) {
            lastPushed.current = q;
            setQInput(q);
        }
    }, [q]);

    const filterParams = { q, status, role, mfa, google, sort: sortId, dir };
    const listUrl = `/api/admin/users${buildQuery({ ...filterParams, page, pageSize })}`;
    const { data, error, isLoading, mutate } = useAdminQuery<UsersResponse>(listUrl);

    const [selected, setSelected] = React.useState<string[]>([]);
    const [bulk, setBulk] = React.useState<BulkAction | null>(null);
    const [bulkBusy, setBulkBusy] = React.useState(false);
    const [bulkError, setBulkError] = React.useState<string | null>(null);
    const [exporting, setExporting] = React.useState(false);

    const hasFilters = !!(q || status || role || mfa || google);
    const setFilter = (key: string) => (value: string) => update({ [key]: value }, { resetPage: true });

    const runBulk = async () => {
        if (!bulk) return;
        setBulkBusy(true);
        setBulkError(null);
        try {
            let ok = 0, skipped = 0, failed = 0;
            for (let i = 0; i < selected.length; i += 100) {
                const res = await adminFetch<{ summary: { ok: number; notFound: number; skippedSelf: number; failed: number } }>('/api/admin/users/bulk', {
                    method: 'POST',
                    body: { ids: selected.slice(i, i + 100), action: bulk },
                });
                ok += res.summary.ok;
                skipped += res.summary.skippedSelf + res.summary.notFound;
                failed += res.summary.failed;
            }
            toast[failed ? 'error' : 'success'](t('admin.console.users.bulk.done', { ok, skipped, failed }));
            setBulk(null);
            setSelected([]);
            void mutate();
        } catch (err) {
            setBulkError(t(apiErrorKey(err)));
        } finally {
            setBulkBusy(false);
        }
    };

    const exportCsv = async () => {
        setExporting(true);
        try {
            await downloadCsv(`/api/admin/users/export${buildQuery({ ...filterParams })}`, 'users.csv');
            toast.success(t('admin.console.users.toast.exported'));
        } catch {
            toast.error(t('admin.console.users.error.export'));
        } finally {
            setExporting(false);
        }
    };

    const dateOf = (iso: string | null) => formatDateTime(iso, intlLocale);
    const nameOf = (u: UserRow) => u.name || u.email;

    const columns: Column<UserRow>[] = [
        {
            id: 'email',
            header: t('admin.console.users.col.user'),
            sortable: true,
            isRowHeader: true,
            cell: (u) => (
                <div className="flex min-w-0 items-center gap-3">
                    <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">{initials(u.name, u.email)}</span>
                    <div className="min-w-0">
                        <RowButton onClick={() => update({ open: u.id })} label={t('admin.console.users.openUser', { name: nameOf(u) })}>{u.name || t('admin.console.users.noName')}</RowButton>
                        <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                    </div>
                </div>
            ),
        },
        { id: 'status', header: t('admin.console.users.col.status'), cell: (u) => (u.disabled ? <Badge tone="danger">{t('admin.console.users.badge.disabled')}</Badge> : <Badge tone="success">{t('admin.console.users.badge.active')}</Badge>) },
        { id: 'role', header: t('admin.console.users.col.role'), hideBelow: 'md', cell: (u) => <Badge tone={u.isAdmin ? 'info' : 'neutral'}>{u.isAdmin ? t('admin.console.users.badge.admin') : t('admin.console.users.badge.user')}</Badge> },
        { id: 'mfa', header: t('admin.console.users.col.mfa'), hideBelow: 'lg', cell: (u) => <Badge tone={u.mfaEnabled ? 'success' : 'neutral'}>{u.mfaEnabled ? t('admin.console.users.badge.mfaOn') : t('admin.console.users.badge.mfaOff')}</Badge> },
        { id: 'google', header: t('admin.console.users.col.google'), hideBelow: 'lg', cell: (u) => <Badge tone={u.googleLinked ? 'info' : 'neutral'}>{u.googleLinked ? t('admin.console.users.badge.googleOn') : t('admin.console.users.badge.googleOff')}</Badge> },
        { id: 'lastLogin', header: t('admin.console.users.col.lastLogin'), sortable: true, hideBelow: 'md', cell: (u) => <span className="text-muted-foreground">{u.lastLoginAt ? dateOf(u.lastLoginAt) : t('admin.console.users.neverLoggedIn')}</span> },
        { id: 'sessions', header: t('admin.console.users.col.sessions'), hideBelow: 'lg', className: 'tabular-nums', cell: (u) => u.sessions },
        { id: 'storage', header: t('admin.console.users.col.storage'), sortable: true, hideBelow: 'lg', className: 'tabular-nums', cell: (u) => formatBytes(u.storageBytes, intlLocale) },
        {
            id: 'quota',
            header: t('admin.console.users.col.quota'),
            hideBelow: 'lg',
            className: 'tabular-nums',
            cell: (u) => (
                <span title={u.quotaSource !== 'none' ? t(`admin.console.users.quotaCell.${u.quotaSource}`) : undefined}>
                    {u.quotaMb === null ? t('admin.console.users.quotaCell.unlimited') : t('admin.console.users.quotaCell.mb', { n: u.quotaMb })}
                    {u.quotaSource === 'user' && <span className="ml-1 text-xs text-muted-foreground">({t('admin.console.users.quotaCell.user')})</span>}
                </span>
            ),
        },
        { id: 'createdAt', header: t('admin.console.users.col.created'), sortable: true, hideBelow: 'sm', cell: (u) => <span className="text-muted-foreground">{dateOf(u.createdAt)}</span> },
    ];

    const yesNo = [
        { value: '', label: t('admin.console.common.all') },
        { value: 'yes', label: t('admin.console.users.filter.yes') },
        { value: 'no', label: t('admin.console.users.filter.no') },
    ];

    const bulkCopy: Record<BulkAction, { title: string; body: string; label: string; destructive: boolean }> = {
        disable: { title: t('admin.console.users.bulk.disableTitle'), body: t('admin.console.users.bulk.disableBody', { count: selected.length }), label: t('admin.console.users.bulk.disable'), destructive: true },
        enable: { title: t('admin.console.users.bulk.enableTitle'), body: t('admin.console.users.bulk.enableBody', { count: selected.length }), label: t('admin.console.users.bulk.enable'), destructive: false },
        revokeSessions: { title: t('admin.console.users.bulk.revokeTitle'), body: t('admin.console.users.bulk.revokeBody', { count: selected.length }), label: t('admin.console.users.bulk.revokeSessions'), destructive: true },
    };

    return (
        <div>
            <PageHeader
                title={t('admin.console.users.title')}
                description={t('admin.console.users.description')}
                actions={
                    <>
                        <button type="button" className={btnOutline} onClick={() => void exportCsv()} disabled={exporting} aria-busy={exporting || undefined}>
                            <Download className="h-4 w-4" aria-hidden="true" />
                            {exporting ? t('admin.console.common.exporting') : t('admin.console.common.export')}
                        </button>
                        <button type="button" className={btnPrimary} onClick={() => update({ create: '1' })}>
                            <UserPlus className="h-4 w-4" aria-hidden="true" />
                            {t('admin.console.users.create')}
                        </button>
                    </>
                }
            />

            <FilterBar label={t('admin.console.users.filtersLabel')} className="mb-4">
                <SearchInput value={qInput} onChange={setQInput} label={t('admin.console.users.searchLabel')} placeholder={t('admin.console.users.searchPlaceholder')} />
                <FilterSelect
                    label={t('admin.console.users.filter.status')}
                    value={status}
                    onChange={setFilter('status')}
                    options={[
                        { value: '', label: t('admin.console.common.all') },
                        { value: 'active', label: t('admin.console.users.filter.active') },
                        { value: 'disabled', label: t('admin.console.users.filter.disabled') },
                    ]}
                />
                <FilterSelect
                    label={t('admin.console.users.filter.role')}
                    value={role}
                    onChange={setFilter('role')}
                    options={[
                        { value: '', label: t('admin.console.common.all') },
                        { value: 'admin', label: t('admin.console.users.filter.admin') },
                        { value: 'user', label: t('admin.console.users.filter.user') },
                    ]}
                />
                <FilterSelect label={t('admin.console.users.filter.mfa')} value={mfa} onChange={setFilter('mfa')} options={yesNo} />
                <FilterSelect label={t('admin.console.users.filter.google')} value={google} onChange={setFilter('google')} options={yesNo} />
                {hasFilters && (
                    <button
                        type="button"
                        className={btnGhost}
                        onClick={() => { setQInput(''); lastPushed.current = ''; update({ q: null, status: null, role: null, mfa: null, google: null }, { resetPage: true }); }}
                    >
                        {t('admin.console.common.clearFilters')}
                    </button>
                )}
            </FilterBar>

            {selected.length > 0 && (
                <div role="toolbar" aria-label={t('admin.console.users.bulk.label')} className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2">
                    <span className="text-sm font-medium text-foreground" aria-live="polite">{t('admin.console.common.selectedCount', { count: selected.length })}</span>
                    <button type="button" className={btnDangerOutline} onClick={() => { setBulkError(null); setBulk('disable'); }}>{t('admin.console.users.bulk.disable')}</button>
                    <button type="button" className={btnOutline} onClick={() => { setBulkError(null); setBulk('enable'); }}>{t('admin.console.users.bulk.enable')}</button>
                    <button type="button" className={btnOutline} onClick={() => { setBulkError(null); setBulk('revokeSessions'); }}>{t('admin.console.users.bulk.revokeSessions')}</button>
                    <button type="button" className={btnGhost} onClick={() => setSelected([])}>{t('admin.console.common.clearSelection')}</button>
                </div>
            )}

            {error && !data ? (
                <ErrorState message={t(apiErrorKey(error))} onRetry={() => void mutate()} />
            ) : (
                <>
                    <DataTable<UserRow>
                        caption={t('admin.console.users.tableCaption')}
                        columns={columns}
                        rows={data?.users ?? []}
                        getRowId={(u) => u.id}
                        rowLabel={nameOf}
                        sort={{ id: sortId, dir }}
                        onSortChange={(s) => update({ sort: s.id, dir: s.dir }, { resetPage: true })}
                        selectable
                        selected={selected}
                        onSelectedChange={setSelected}
                        activeRowId={openId || null}
                        loading={isLoading}
                        empty={<EmptyState title={hasFilters ? t('admin.console.common.emptyFiltered') : t('admin.console.common.emptyTitle')} />}
                        minWidth={560}
                    />
                    <Pagination
                        className="mt-3"
                        page={data?.page.page ?? page}
                        pages={data?.page.pages ?? 1}
                        total={data?.page.total ?? 0}
                        pageSize={data?.page.pageSize ?? pageSize}
                        onPage={(p) => update({ page: p === 1 ? null : p })}
                        onPageSize={(n) => update({ pageSize: n === 25 ? null : n }, { resetPage: true })}
                    />
                </>
            )}

            <ConfirmDialog
                open={bulk !== null}
                title={bulk ? bulkCopy[bulk].title : ''}
                description={bulk ? bulkCopy[bulk].body : ''}
                confirmLabel={bulk ? bulkCopy[bulk].label : ''}
                cancelLabel={t('admin.console.common.cancel')}
                destructive={bulk ? bulkCopy[bulk].destructive : false}
                busy={bulkBusy}
                error={bulkError}
                onConfirm={() => void runBulk()}
                onCancel={() => setBulk(null)}
            />

            {openId && <UserDrawer key={openId} id={openId} onClose={() => update({ open: null })} onChanged={() => void mutate()} />}
            <CreateUserModal open={createOpen} onClose={() => update({ create: null })} onCreated={() => void mutate()} />
        </div>
    );
}
