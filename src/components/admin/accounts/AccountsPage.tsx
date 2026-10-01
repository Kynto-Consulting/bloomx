'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import {
    Badge, DataTable, EmptyState, ErrorState, FilterBar, FilterSelect, PageHeader, Pagination, RowButton, SearchInput, apiErrorKey,
    btnGhost, buildQuery, formatDateTime, useAdminQuery, useDebounced, type Column,
} from '@/components/admin/console';
import { intParam, useUrlParams } from '@/components/admin/users/useUrlParams';
import type { AccountRow, AccountStatus, AccountsResponse } from '@/components/admin/users/types';
import { ExtensionIcon } from '@/components/expansions/ExtensionIcon';
import { AccountDrawer } from './AccountDrawer';
import { StatusBadge } from './StatusBadge';

const STATUSES: readonly AccountStatus[] = ['valid', 'expired', 'revoked'];

/** /admin/accounts: conexiones OAuth de los usuarios, con filtros en la URL y detalle lateral. */
export function AccountsPage() {
    const { t, intlLocale } = useI18n();
    const { get, update } = useUrlParams();

    const q = get('q');
    const provider = /^[A-Za-z0-9_.-]{1,50}$/.test(get('provider')) ? get('provider') : '';
    const status = (STATUSES as readonly string[]).includes(get('status')) ? (get('status') as AccountStatus) : '';
    const page = intParam(get('page'), 1);
    const pageSize = intParam(get('pageSize'), 25, 1, 100);
    const openId = get('open');

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
        if (q !== lastPushed.current) {
            lastPushed.current = q;
            setQInput(q);
        }
    }, [q]);

    const { data, error, isLoading, mutate } = useAdminQuery<AccountsResponse>(`/api/admin/accounts${buildQuery({ q, provider, status, page, pageSize })}`);
    // Registro de proveedores OAuth (integrados y de extensiones): nombre amigable e icono de marca; si falla se usa el id.
    const registry = useAdminQuery<{ providers: Array<{ id: string; displayName: string; icon?: string | null }> }>('/api/admin/oauth/providers');
    const names = React.useMemo(() => new Map((registry.data?.providers ?? []).map((p) => [p.id, p] as const)), [registry.data]);
    const providerLabel = (id: string) => names.get(id)?.displayName ?? id;
    const providerIds = React.useMemo(() => Array.from(new Set([...(registry.data?.providers ?? []).map((p) => p.id), ...(data?.providers ?? []), ...(provider ? [provider] : [])])).sort(), [registry.data, data, provider]);
    const hasFilters = !!(q || provider || status);
    const openRow = data?.accounts.find((a) => a.id === openId) ?? null;
    const dateOf = (iso: string | null) => (iso ? formatDateTime(iso, intlLocale) : t('admin.console.users.accounts.noExpiry'));
    const who = (a: AccountRow) => a.userName || a.userEmail;

    const columns: Column<AccountRow>[] = [
        {
            id: 'user',
            header: t('admin.console.users.accounts.col.user'),
            isRowHeader: true,
            cell: (a) => (
                <div className="min-w-0">
                    <RowButton onClick={() => update({ open: a.id })} label={t('admin.console.users.accounts.openAccount', { name: who(a) })}>{a.userName || a.userEmail}</RowButton>
                    {a.userName && <p className="truncate text-xs text-muted-foreground">{a.userEmail}</p>}
                </div>
            ),
        },
        { id: 'provider', header: t('admin.console.users.accounts.col.provider'), cell: (a) => (<span className="inline-flex items-center gap-2"><ExtensionIcon icon={names.get(a.provider)?.icon ?? `brand:${a.provider}`} label={providerLabel(a.provider)} size={16} />{providerLabel(a.provider)}</span>) },
        { id: 'account', header: t('admin.console.users.accounts.col.account'), hideBelow: 'lg', cell: (a) => <code className="text-xs text-muted-foreground">{a.providerAccountId}</code> },
        { id: 'status', header: t('admin.console.users.accounts.col.status'), cell: (a) => <StatusBadge status={a.status} /> },
        { id: 'expires', header: t('admin.console.users.accounts.col.expires'), hideBelow: 'md', cell: (a) => <span className="text-muted-foreground">{dateOf(a.expiresAt)}</span> },
        {
            id: 'integrations',
            header: t('admin.console.users.accounts.col.integrations'),
            hideBelow: 'md',
            cell: (a) =>
                a.integrations.length === 0 ? (
                    <span className="text-xs text-muted-foreground">{t('admin.console.common.notAvailable')}</span>
                ) : (
                    <span className="flex flex-wrap gap-1">
                        {a.integrations.map((i) => <Badge key={i}>{t(`admin.console.users.accounts.integration.${i}`)}</Badge>)}
                    </span>
                ),
        },
    ];

    return (
        <div>
            <PageHeader title={t('admin.console.users.accounts.title')} description={t('admin.console.users.accounts.description')} />
            <FilterBar label={t('admin.console.users.accounts.filtersLabel')} className="mb-3">
                <SearchInput value={qInput} onChange={setQInput} label={t('admin.console.users.accounts.searchLabel')} placeholder={t('admin.console.users.accounts.searchPlaceholder')} />
                <FilterSelect
                    label={t('admin.console.users.accounts.provider')}
                    value={provider}
                    onChange={(v) => update({ provider: v }, { resetPage: true })}
                    options={[{ value: '', label: t('admin.console.users.accounts.allProviders') }, ...providerIds.map((p) => ({ value: p, label: providerLabel(p) }))]}
                />
                <FilterSelect
                    label={t('admin.console.users.accounts.status')}
                    value={status}
                    onChange={(v) => update({ status: v }, { resetPage: true })}
                    options={[{ value: '', label: t('admin.console.common.all') }, ...STATUSES.map((s) => ({ value: s, label: t(`admin.console.users.accounts.tokenStatus.${s}`) }))]}
                />
                {hasFilters && (
                    <button type="button" className={btnGhost} onClick={() => { setQInput(''); lastPushed.current = ''; update({ q: null, provider: null, status: null }, { resetPage: true }); }}>
                        {t('admin.console.common.clearFilters')}
                    </button>
                )}
            </FilterBar>
            <p className="mb-3 text-xs text-muted-foreground">{t('admin.console.users.accounts.statusNote')}</p>

            {error && !data ? (
                <ErrorState message={t(apiErrorKey(error))} onRetry={() => void mutate()} />
            ) : (
                <>
                    <DataTable<AccountRow>
                        caption={t('admin.console.users.accounts.tableCaption')}
                        columns={columns}
                        rows={data?.accounts ?? []}
                        getRowId={(a) => a.id}
                        rowLabel={who}
                        activeRowId={openId || null}
                        loading={isLoading}
                        empty={<EmptyState title={hasFilters ? t('admin.console.common.emptyFiltered') : t('admin.console.common.emptyTitle')} />}
                        minWidth={520}
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

            {openRow && (
                <AccountDrawer key={openRow.id} account={openRow} onClose={() => update({ open: null })} onChanged={() => void mutate()} />
            )}
        </div>
    );
}
