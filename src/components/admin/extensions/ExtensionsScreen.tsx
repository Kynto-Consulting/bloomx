'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Info, Puzzle } from 'lucide-react';
import {
    Badge, Card, EmptyState, ErrorState, FilterBar, FilterSelect, LoadingState, PageHeader, SearchInput, StatCard, apiErrorKey, btnOutline, useConsole,
} from '@/components/admin/console';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ExtensionCredentialsModal } from '@/components/admin/ExtensionCredentialsModal';
import { useI18n } from '@/components/I18nProvider';
import { CATEGORIES } from '@/lib/admin/extensions-manifest';
import {
    DEFAULT_FILTERS, STATUS_FILTERS, countByStatus, filterRows, type ExtensionFilters, type ExtensionRow, type StatusFilter,
} from '@/lib/admin/extensions-view';
import { ExtensionCard, type DialogKind, type RowActions } from './ExtensionCard';
import { ExtensionDetail } from './ExtensionDetail';
import { OrderPanel } from './OrderPanel';
import { ExtensionIcon } from '@/components/expansions/ExtensionIcon';
import { PermissionsList } from './PermissionsList';
import { useExtensionActions } from './useExtensionActions';
import { useExtensionsData } from './useExtensionsData';

interface DialogState {
    kind: DialogKind;
    id: string;
}

/** Pantalla /admin/extensions: catalogo, instalar/desinstalar/activar, detalle con pestanas, orden y estado. */
export function ExtensionsScreen() {
    const { t } = useI18n();
    const { domain } = useConsole();
    const searchParams = useSearchParams();
    const data = useExtensionsData(domain.id);
    const actions = useExtensionActions(domain.id, data.refresh);

    const [filters, setFilters] = useState<ExtensionFilters>(DEFAULT_FILTERS);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [dialog, setDialog] = useState<DialogState | null>(null);
    const [credentialsId, setCredentialsId] = useState<string | null>(null);

    // ?open=<id> (busqueda global): abre el detalle cuando la extension ya esta cargada.
    const openParam = searchParams?.get('open') ?? null;
    const [consumedOpen, setConsumedOpen] = useState<string | null>(null);
    useEffect(() => {
        if (openParam && openParam !== consumedOpen && data.rows.some((r) => r.id === openParam)) {
            setSelectedId(openParam);
            setConsumedOpen(openParam);
        }
    }, [openParam, consumedOpen, data.rows]);

    const byId = useMemo(() => new Map(data.rows.map((r) => [r.id, r])), [data.rows]);
    const selected = selectedId ? byId.get(selectedId) ?? null : null;
    const dialogRow = dialog ? byId.get(dialog.id) ?? null : null;
    const credentialsRow = credentialsId ? byId.get(credentialsId) ?? null : null;

    const visible = useMemo(() => filterRows(data.rows, filters), [data.rows, filters]);
    const counts = useMemo(() => countByStatus(data.rows), [data.rows]);

    const rowActions: RowActions = {
        readOnly: data.readOnly,
        busyId: actions.busyId,
        onRequest: (kind, row) => setDialog({ kind, id: row.id }),
        onEnable: (row) => void actions.toggle(row, true),
    };

    const closeDialog = useCallback(() => {
        setDialog(null);
        actions.clearError();
    }, [actions]);

    const confirmDialog = async () => {
        if (!dialog || !dialogRow) return;
        const ok =
            dialog.kind === 'uninstall' ? await actions.uninstall(dialogRow)
            : dialog.kind === 'disable' ? await actions.toggle(dialogRow, false)
            : dialog.kind === 'mandatoryOn' ? await actions.setMandatory(dialogRow, true)
            : dialog.kind === 'mandatoryOff' ? await actions.setMandatory(dialogRow, false)
            : dialog.kind === 'update' ? await actions.update(dialogRow)
            : await actions.install(dialogRow);
        // Pago: install() redirige (o muestra el error en el dialogo); el resto cierra al acabar bien.
        if (ok) setDialog(null);
    };

    const reasonText = data.readOnlyReason === 'noDomain' ? t('admin.console.extensions.readOnly.noDomain') : t('admin.console.extensions.readOnly.body');
    const dialogBusy = actions.busyId !== null;

    return (
        <div className="space-y-6">
            <PageHeader title={t('admin.console.extensions.title')} description={t('admin.console.extensions.description')} />

            {/* Resultado de la ultima accion: anunciado a lectores de pantalla y visible. */}
            <div role="status" aria-live="polite" className={actions.live ? 'rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success' : 'sr-only'}>
                {actions.live}
            </div>
            {actions.error && !dialog && <ErrorState message={actions.error} />}

            {data.readOnly && !data.loading && (
                <div role="note" className="flex items-start gap-3 rounded-lg border border-info/30 bg-info/10 p-4 text-sm text-info">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <div>
                        <p className="font-medium">{t('admin.console.extensions.readOnly.title')}</p>
                        <p className="mt-1">{reasonText}</p>
                        {data.readOnlyReason === 'error' && data.installedError && <p className="mt-1">{t(apiErrorKey(data.installedError))}</p>}
                    </div>
                </div>
            )}

            <section aria-label={t('admin.console.extensions.summary.label')} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label={t('admin.console.extensions.summary.installed')} value={counts.installed} loading={data.loading} />
                <StatCard label={t('admin.console.extensions.summary.active')} value={counts.enabled} tone="success" loading={data.loading} />
                <StatCard label={t('admin.console.extensions.summary.updates')} value={counts.updates} tone={counts.updates > 0 ? 'info' : 'neutral'} loading={data.loading} />
                <StatCard label={t('admin.console.extensions.summary.errors')} value={counts.errors} tone={counts.errors > 0 ? 'danger' : 'neutral'} loading={data.loading} />
            </section>

            <Card title={t('admin.console.extensions.catalog.title')} id="catalog">
                <FilterBar label={t('admin.console.extensions.filters.label')} className="mb-4">
                    <SearchInput
                        value={filters.query}
                        onChange={(query) => setFilters((f) => ({ ...f, query }))}
                        label={t('admin.console.extensions.search.label')}
                        placeholder={t('admin.console.extensions.search.placeholder')}
                    />
                    <FilterSelect
                        label={t('admin.console.extensions.filters.category')}
                        value={filters.category}
                        onChange={(category) => setFilters((f) => ({ ...f, category: category as ExtensionFilters['category'] }))}
                        options={[{ value: 'all', label: t('admin.console.common.all') }, ...CATEGORIES.map((c) => ({ value: c, label: t(`admin.console.extensions.filters.categories.${c}`) }))]}
                    />
                    <FilterSelect
                        label={t('admin.console.extensions.filters.status')}
                        value={filters.status}
                        onChange={(status) => setFilters((f) => ({ ...f, status: status as StatusFilter }))}
                        options={STATUS_FILTERS.map((s) => ({ value: s, label: t(`admin.console.extensions.filters.statuses.${s}`) }))}
                    />
                </FilterBar>

                {data.loading ? (
                    <LoadingState />
                ) : data.catalogError ? (
                    <ErrorState message={t('admin.console.extensions.catalog.loadError')} onRetry={data.retry} />
                ) : data.configError ? (
                    <ErrorState message={t('admin.console.extensions.catalog.configError')} onRetry={data.retry} />
                ) : visible.length === 0 ? (
                    <EmptyState
                        icon={<Puzzle className="h-10 w-10" />}
                        title={data.rows.length === 0 ? t('admin.console.extensions.catalog.empty') : t('admin.console.common.emptyTitle')}
                        description={data.rows.length === 0 ? undefined : t('admin.console.extensions.catalog.emptyFiltered')}
                        action={data.rows.length > 0 ? <button type="button" className={btnOutline} onClick={() => setFilters(DEFAULT_FILTERS)}>{t('admin.console.common.clearFilters')}</button> : undefined}
                    />
                ) : (
                    <>
                        <p role="status" className="mb-3 text-xs text-muted-foreground">{t('admin.console.extensions.catalog.count', { count: visible.length })}</p>
                        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {visible.map((row) => (
                                <ExtensionCard key={row.id} row={row} actions={rowActions} onOpen={(r) => setSelectedId(r.id)} />
                            ))}
                        </ul>
                    </>
                )}
            </Card>

            {!data.readOnly && !data.loading && <OrderPanel rows={data.rows} busy={actions.busyId !== null} onReorder={(ids, name, pos) => void actions.reorder(ids, name, pos)} />}

            <ExtensionDetail
                row={selected}
                onClose={() => setSelectedId(null)}
                actions={rowActions}
                testSupport={{ supported: data.testSupported, reason: data.testReason }}
                onTest={actions.test}
                onOpenCredentials={(row) => setCredentialsId(row.id)}
            />

            <ExtensionCredentialsModal
                open={!!credentialsRow}
                onClose={() => setCredentialsId(null)}
                domainId={domain.id}
                extension={credentialsRow ? { id: credentialsRow.id, name: credentialsRow.name } : null}
            />

            <ActionDialog
                dialog={dialog}
                row={dialogRow}
                busy={dialogBusy}
                error={dialog ? actions.error : null}
                onCancel={closeDialog}
                onConfirm={() => void confirmDialog()}
            />
        </div>
    );
}

function ActionDialog({
    dialog, row, busy, error, onCancel, onConfirm,
}: { dialog: DialogState | null; row: ExtensionRow | null; busy: boolean; error: string | null; onCancel: () => void; onConfirm: () => void }) {
    const { t } = useI18n();
    const open = !!dialog && !!row;
    const name = row?.name ?? '';
    let title = '';
    let confirmLabel = '';
    let body: React.ReactNode = null;
    let destructive = false;

    if (dialog && row) {
        switch (dialog.kind) {
            case 'install':
                title = t(row.isPaid ? 'admin.console.extensions.install.titlePaid' : 'admin.console.extensions.install.title', { name });
                confirmLabel = t(row.isPaid ? 'admin.console.extensions.install.confirmPaid' : 'admin.console.extensions.install.confirm');
                body = (
                    <div className="space-y-3">
                        <p className="flex items-center gap-2 font-medium text-foreground"><ExtensionIcon icon={row.icon} label={row.name} size={32} /><span className="min-w-0 break-words">{row.name}</span></p>
                        {row.isPaid && <p><Badge tone="info">{t('admin.console.extensions.install.paid', { price: row.price, currency: row.currency })}</Badge></p>}
                        <p>{(row.template?.permissions?.length ?? 0) > 0 ? t('admin.console.extensions.install.intro') : t('admin.console.extensions.install.noPermissions')}</p>
                        <div className="max-h-64 overflow-y-auto"><PermissionsList template={row.template} compact /></div>
                    </div>
                );
                break;
            case 'update':
                title = t('admin.console.extensions.update.title', { name });
                confirmLabel = t('admin.console.extensions.update.confirm');
                body = (
                    <div className="space-y-3">
                        <p>{t('admin.console.extensions.update.body', { from: row.installedVersion ?? '?', to: row.version ?? '?' })}</p>
                        <div className="max-h-64 overflow-y-auto"><PermissionsList template={row.template} compact /></div>
                    </div>
                );
                break;
            case 'uninstall':
                title = t('admin.console.extensions.uninstall.title', { name });
                confirmLabel = t('admin.console.extensions.uninstall.confirm');
                destructive = true;
                body = (
                    <div className="space-y-2">
                        <p>{t('admin.console.extensions.uninstall.intro')}</p>
                        <ul className="list-disc space-y-1 pl-5">
                            <li>{t('admin.console.extensions.uninstall.wipesCredentials')}</li>
                            <li>{t('admin.console.extensions.uninstall.wipesTokens')}</li>
                            <li>{t('admin.console.extensions.uninstall.wipesSettings')}</li>
                        </ul>
                        <p>{t('admin.console.extensions.uninstall.alternative')}</p>
                    </div>
                );
                break;
            case 'mandatoryOn':
                title = t('admin.console.extensions.mandatory.confirmOnTitle', { name });
                confirmLabel = t('admin.console.extensions.mandatory.confirmOn');
                body = (
                    <div className="space-y-2">
                        <p>{t('admin.console.extensions.mandatory.confirmOnBody')}</p>
                        <ul className="list-disc space-y-1 pl-5">
                            <li>{t('admin.console.extensions.mandatory.effectUsers')}</li>
                            <li>{t('admin.console.extensions.mandatory.effectServer')}</li>
                        </ul>
                    </div>
                );
                break;
            case 'mandatoryOff':
                title = t('admin.console.extensions.mandatory.confirmOffTitle', { name });
                confirmLabel = t('admin.console.extensions.mandatory.confirmOff');
                body = <p>{t('admin.console.extensions.mandatory.confirmOffBody')}</p>;
                break;
            case 'disable':
                title = t('admin.console.extensions.disable.title', { name });
                confirmLabel = t('admin.console.extensions.disable.confirm');
                body = <p>{t('admin.console.extensions.disable.body')}</p>;
                break;
        }
    }

    return (
        <ConfirmDialog
            open={open}
            title={title}
            description={body}
            confirmLabel={confirmLabel}
            cancelLabel={t('admin.console.common.cancel')}
            destructive={destructive}
            busy={busy}
            error={error}
            onCancel={onCancel}
            onConfirm={onConfirm}
        />
    );
}
