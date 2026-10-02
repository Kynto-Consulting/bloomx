'use client';
import { SigningNotice } from '@/components/admin/SigningNotice';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Info } from 'lucide-react';
import {
    Badge, ErrorState, PageHeader, StatCard, apiErrorKey, useConsole,
} from '@/components/admin/console';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ExtensionCredentialsModal } from '@/components/admin/ExtensionCredentialsModal';
import { useI18n } from '@/components/I18nProvider';
import {
    countByStatus, dependencyPlanFor, dependentsToPause, type ExtensionRow,
} from '@/lib/admin/extensions-view';
import { planSuiteInstall, requiresExplicitApproval } from '@/lib/admin/marketplace/market-model';
import { type DialogKind, type RowActions } from './ExtensionCard';
import { MarketplaceCatalog } from './market/MarketplaceCatalog';
import { SuiteInstallDialog, type SuiteInstallProgress } from './market/SuiteInstallDialog';
import { useExtensionStars } from './market/useExtensionStars';
import { useMarketState } from './market/useMarketState';
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

    // Estado del marketplace en la URL (?q=&cat=&suite=&publisher=&view=...); la ficha abierta es ?ext=<id>.
    const market = useMarketState(searchParams);
    const stars = useExtensionStars();
    const selectedId = market.state.ext || null;
    const updateMarket = market.update;
    const setSelectedId = useCallback((id: string | null) => updateMarket({ ext: id ?? '' }), [updateMarket]);
    const [starLive, setStarLive] = useState('');
    const [suiteId, setSuiteId] = useState<string | null>(null);
    const [suiteApproved, setSuiteApproved] = useState(false);
    const [suiteProgress, setSuiteProgress] = useState<SuiteInstallProgress | null>(null);
    const [suiteError, setSuiteError] = useState<string | null>(null);
    const [suiteBusy, setSuiteBusy] = useState(false);
    const [dialog, setDialog] = useState<DialogState | null>(null);
    const [credentialsId, setCredentialsId] = useState<string | null>(null);
    // PUBLIC_ROUTE (rutas/paginas sin sesion): aprobacion explicita del admin del dominio, desmarcada por defecto en cada dialogo.
    const [approvePublic, setApprovePublic] = useState(false);

    // ?open=<id> (busqueda global): abre el detalle cuando la extension ya esta cargada.
    const openParam = searchParams?.get('open') ?? null;
    const [consumedOpen, setConsumedOpen] = useState<string | null>(null);
    useEffect(() => {
        if (openParam && openParam !== consumedOpen && data.rows.some((r) => r.id === openParam)) {
            setSelectedId(openParam);
            setConsumedOpen(openParam);
        }
    }, [openParam, consumedOpen, data.rows, setSelectedId]);

    const byId = useMemo(() => new Map(data.rows.map((r) => [r.id, r])), [data.rows]);
    const selected = selectedId ? byId.get(selectedId) ?? null : null;
    const dialogRow = dialog ? byId.get(dialog.id) ?? null : null;
    const credentialsRow = credentialsId ? byId.get(credentialsId) ?? null : null;

    const counts = useMemo(() => countByStatus(data.rows), [data.rows]);

    const rowActions: RowActions = {
        readOnly: data.readOnly,
        busyId: actions.busyId,
        onRequest: (kind, row) => setDialog({ kind, id: row.id }),
        // Activar una extension con dependencias por instalar/activar pasa por el dialogo (lista + confirmacion).
        onEnable: (row) => { if (dependencyPlanFor(row, data.rows).dependencies.length > 0) setDialog({ kind: 'install', id: row.id }); else void actions.toggle(row, true); },
    };

    const closeDialog = useCallback(() => {
        setDialog(null);
        setApprovePublic(false);
        actions.clearError();
    }, [actions]);

    const confirmDialog = async () => {
        if (!dialog || !dialogRow) return;
        const ok =
            dialog.kind === 'uninstall' ? await actions.uninstall(dialogRow)
            : dialog.kind === 'disable' ? await actions.toggle(dialogRow, false)
            : dialog.kind === 'mandatoryOn' ? await actions.setMandatory(dialogRow, true)
            : dialog.kind === 'mandatoryOff' ? await actions.setMandatory(dialogRow, false)
            : dialog.kind === 'update' ? await actions.update(dialogRow, { approvePublicRoutes: approvePublic })
            : await actions.install(dialogRow, { approvePublicRoutes: approvePublic });
        // Pago: install() redirige (o muestra el error en el dialogo); el resto cierra al acabar bien.
        if (ok) { setDialog(null); setApprovePublic(false); }
    };

    // Favoritas: optimista (la estrella cambia al instante y vuelve atras si el servidor la rechaza).
    const toggleStar = useCallback(async (row: Pick<ExtensionRow, 'id' | 'name'>) => {
        const next = !stars.starred.has(row.id);
        const ok = await stars.toggle(row.id, next);
        setStarLive(ok ? t(next ? 'admin.console.extensions.market.stars.added' : 'admin.console.extensions.market.stars.removed', { name: row.name }) : t('admin.console.extensions.market.stars.saveError'));
    }, [stars, t]);

    // Instalar la suite: plan puro (orden con dependencias, permisos, aprobaciones) y ejecucion en orden con las mismas acciones de siempre.
    const suiteGroup = useMemo(() => (suiteId ? data.rows.filter((r) => r.market.suite?.id === suiteId) : []), [suiteId, data.rows]);
    const suitePlan = useMemo(() => (suiteId ? planSuiteInstall(suiteGroup, data.rows) : null), [suiteId, suiteGroup, data.rows]);
    const closeSuite = () => { if (!suiteBusy) { setSuiteId(null); setSuiteProgress(null); setSuiteError(null); } };
    const confirmSuite = async () => {
        if (!suitePlan || suitePlan.steps.length === 0) return;
        setSuiteBusy(true);
        setSuiteError(null);
        const total = suitePlan.steps.length;
        let done = 0;
        for (const step of suitePlan.steps) {
            const row = byId.get(step.id);
            if (!row) continue;
            setSuiteProgress({ done, total, name: row.name });
            const approve = suiteApproved && requiresExplicitApproval(row);
            const ok = step.action === 'activate' ? await actions.toggle(row, true) : await actions.install(row, { approvePublicRoutes: approve });
            if (!ok) {
                setSuiteBusy(false);
                setSuiteProgress(null);
                setSuiteError(t('admin.console.extensions.market.suiteInstall.stopped', { name: row.name }));
                return;
            }
            done += 1;
        }
        setSuiteBusy(false);
        setSuiteProgress(null);
        setStarLive(t('admin.console.extensions.market.suiteInstall.done', { name: suiteGroup[0]?.market.suite?.name ?? '', count: done }));
        setSuiteId(null);
    };

    const reasonText = data.readOnlyReason === 'noDomain' ? t('admin.console.extensions.readOnly.noDomain') : t('admin.console.extensions.readOnly.body');
    const dialogBusy = actions.busyId !== null;

    return (
        <div className="space-y-6">
            <PageHeader title={t('admin.console.extensions.title')} description={t('admin.console.extensions.description')} />
            <SigningNotice />

            {/* Resultado de la ultima accion: anunciado a lectores de pantalla y visible. */}
            <div role="status" aria-live="polite" className={actions.live ? 'rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success' : 'sr-only'}>
                {actions.live}
            </div>
            <div role="status" aria-live="polite" className={starLive ? 'rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground' : 'sr-only'}>{starLive}</div>
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

            <MarketplaceCatalog
                rows={data.rows}
                loading={data.loading}
                catalogError={!!data.catalogError}
                configError={!data.catalogError && data.configError}
                onRetry={data.retry}
                state={market.state}
                update={market.update}
                stars={stars}
                onToggleStar={toggleStar}
                actions={rowActions}
                onOpen={(r) => setSelectedId(r.id)}
                onInstallSuite={(id) => { setSuiteId(id); setSuiteApproved(false); setSuiteError(null); setSuiteProgress(null); }}
            />

            {!data.readOnly && !data.loading && <OrderPanel rows={data.rows} busy={actions.busyId !== null} onReorder={(ids, name, pos) => void actions.reorder(ids, name, pos)} />}

            <ExtensionDetail
                row={selected}
                domainId={domain.id ?? ''}
                onClose={() => setSelectedId(null)}
                actions={rowActions}
                testSupport={{ supported: data.testSupported, reason: data.testReason }}
                onTest={actions.test}
                onOpenCredentials={(row) => setCredentialsId(row.id)}
                market={selected ? {
                    rows: data.rows,
                    starred: stars.starred.has(selected.id),
                    onToggleStar: toggleStar,
                    onOpenPublisher: (publisher) => market.update({ ext: '', section: 'publisher', publisher, suite: '', cat: 'all', q: '' }),
                    onOpenSuite: (suite) => market.update({ ext: '', section: 'suites', suite, publisher: '', cat: 'all', q: '' }),
                    onOpenRow: (r) => setSelectedId(r.id),
                } : undefined}
            />

            <ExtensionCredentialsModal
                open={!!credentialsRow}
                onClose={() => setCredentialsId(null)}
                domainId={domain.id}
                extension={credentialsRow ? { id: credentialsRow.id, name: credentialsRow.name } : null}
            />

            <SuiteInstallDialog
                open={!!suiteId && !!suitePlan}
                suiteName={suiteGroup[0]?.market.suite?.name ?? ''}
                plan={suitePlan}
                approved={suiteApproved}
                onApprove={setSuiteApproved}
                busy={suiteBusy}
                progress={suiteProgress}
                error={suiteError}
                onCancel={closeSuite}
                onConfirm={() => void confirmSuite()}
            />

            <ActionDialog
                dialog={dialog}
                row={dialogRow}
                rows={data.rows}
                approvePublic={approvePublic}
                onApprovePublic={setApprovePublic}
                busy={dialogBusy}
                error={dialog ? actions.error : null}
                onCancel={closeDialog}
                onConfirm={() => void confirmDialog()}
            />
        </div>
    );
}

function ActionDialog({
    dialog, row, rows, approvePublic, onApprovePublic, busy, error, onCancel, onConfirm,
}: { dialog: DialogState | null; row: ExtensionRow | null; rows: readonly ExtensionRow[]; approvePublic: boolean; onApprovePublic: (value: boolean) => void; busy: boolean; error: string | null; onCancel: () => void; onConfirm: () => void }) {
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
                        <DependencyNotes row={row} rows={rows} mode="install" />
                        <PublicRouteApproval row={row} checked={approvePublic} onChange={onApprovePublic} />
                    </div>
                );
                break;
            case 'update':
                title = t('admin.console.extensions.update.title', { name });
                confirmLabel = t('admin.console.extensions.update.confirm');
                body = (
                    <div className="space-y-3">
                        <p>{t('admin.console.extensions.update.body', { from: row.installedVersion ?? '?', to: row.version ?? '?' })}</p>
                        <PublicRouteApproval row={row} checked={approvePublic} onChange={onApprovePublic} />
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
                        <DependencyNotes row={row} rows={rows} mode="pause" />
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
                body = <div className="space-y-2"><p>{t('admin.console.extensions.disable.body')}</p><DependencyNotes row={row} rows={rows} mode="pause" /></div>;
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
            confirmDisabled={(dialog?.kind === 'install' || dialog?.kind === 'update') && needsPublicApproval(row) && !approvePublic}
            error={error}
            onCancel={onCancel}
            onConfirm={onConfirm}
        />
    );
}

/** Dependencias: al instalar, lo que se instalara/activara tambien; al desactivar/desinstalar, lo que quedara pausado (nunca borrado). */
function DependencyNotes({ row, rows, mode }: { row: ExtensionRow; rows: readonly ExtensionRow[]; mode: 'install' | 'pause' }) {
    const { t } = useI18n();
    const nameOf = (id: string) => rows.find((r) => r.id === id)?.name ?? id;
    if (mode === 'install') {
        const deps = dependencyPlanFor(row, rows).dependencies;
        if (deps.length === 0) return null;
        return (
            <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="font-medium text-foreground">{t('admin.console.extensions.dependencies.installIntro')}</p>
                <ul className="mt-1 list-disc pl-5">{deps.map((d) => <li key={d.id}>{nameOf(d.id)} <span className="text-muted-foreground">({d.range})</span></li>)}</ul>
            </div>
        );
    }
    const paused = dependentsToPause(row, rows);
    if (paused.length === 0) return null;
    return <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-warning">{t('admin.console.extensions.dependencies.willPause', { names: paused.map(nameOf).join(', ') })}</p>;
}

/** Permisos que exigen aprobacion explicita: rutas publicas, cuentas compartidas de proveedor (OAUTH_SHARED) y OAUTH_ACCOUNT de grupos de riesgo alto. */
const needsPublicApproval = (row: ExtensionRow | null) => !!row && requiresExplicitApproval(row);

/** PUBLIC_ROUTE: casilla de aprobacion EXPLICITA (riesgo alto); sin marcarla no se puede confirmar. */
function PublicRouteApproval({ row, checked, onChange }: { row: ExtensionRow; checked: boolean; onChange: (value: boolean) => void }) {
    const { t } = useI18n();
    if (!needsPublicApproval(row)) return null;
    return (
        <label className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-destructive">
            <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(e.target.checked)} />
            <span>{t('admin.console.extensions.dependencies.approvePublic')}</span>
        </label>
    );
}
