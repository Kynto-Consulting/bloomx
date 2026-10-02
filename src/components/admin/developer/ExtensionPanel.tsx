'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Badge, Card, DataTable, adminFetch, btnOutline, buildQuery, formatDate, useAdminQuery, type Column, type Tone } from '@/components/admin/console';
import { useStepUp } from '@/components/admin/permissions/useStepUp';
import { invalidateExtensions, useFinError } from '@/components/admin/billing/shared';
import { PricingPanel, draftToValue, priceFormFrom, toDraft, type PriceForm } from './PricingPanel';
import type { DevExtension, DevOverview, DevVersion, ExtensionStatus, Risk, VersionStatus } from './types';

const EXT_TONE: Record<ExtensionStatus, Tone> = { private: 'neutral', active: 'success', yanked: 'danger', suspended: 'danger' };
const VER_TONE: Record<VersionStatus, Tone> = { draft: 'neutral', in_review: 'info', changes_requested: 'warning', approved: 'success', published: 'success', rejected: 'danger', yanked: 'danger' };
const RISK_TONE: Record<Risk, Tone> = { low: 'success', medium: 'warning', high: 'danger' };

/** Una extension del desarrollador: estado, versiones con notas del revisor, probar en mi dominio, retirar y precio. */
export function ExtensionPanel({
    ext, overview, onNewVersion, onChanged,
}: { ext: DevExtension; overview: DevOverview; onNewVersion: (ext: DevExtension) => void; onChanged: (message: string) => Promise<void> }) {
    const { t, locale } = useI18n();
    const finError = useFinError('developer');
    const { guard, dialog } = useStepUp();
    const [busy, setBusy] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [yankOpen, setYankOpen] = React.useState(false);
    const [yankScope, setYankScope] = React.useState<'all' | string>('all');
    const [priceOpen, setPriceOpen] = React.useState(false);
    const [approvePerms, setApprovePerms] = React.useState(false);
    const [priceForm, setPriceForm] = React.useState<PriceForm>(() => priceFormFrom(ext.pricing));
    const [priceSaved, setPriceSaved] = React.useState(false);
    const uid = React.useId();
    const base = `/api/admin/developer/extensions/${encodeURIComponent(ext.id)}`;
    const pricingQ = useAdminQuery<{ pricing: DevExtension['pricing']; activeSubscribers: number }>(priceOpen ? `/api/admin/developer/pricing${buildQuery({ extensionId: ext.id })}` : null);

    const run = (name: string, job: () => Promise<string>) => {
        setError(null);
        setBusy(name);
        void guard(async () => { await onChanged(await job()); })
            .catch((e) => setError(finError(e)))
            .finally(() => { setBusy(null); setYankOpen(false); });
    };

    const testInstall = () => run('test', async () => {
        const target = ext.versions.find((v) => v.version === ext.latestVersion) ?? ext.versions[ext.versions.length - 1];
        await adminFetch(`${base}/test-install`, { body: { ...(target?.submissionId ? { submissionId: target.submissionId } : {}), ...(target?.version ? { version: target.version } : {}), ...(approvePerms ? { approvePermissions: true } : {}) } });
        void invalidateExtensions();
        return t('admin.console.developer.actions.testInstalled');
    });
    const yank = () => run('yank', async () => {
        await adminFetch(`${base}/yank`, { body: yankScope === 'all' ? {} : { version: yankScope } });
        return t('admin.console.developer.actions.yanked');
    });
    const versionAction = (v: DevVersion, action: 'submit' | 'withdraw' | 'publish') => run(`${action}-${v.version}`, async () => {
        if (!v.submissionId) throw new Error('no_submission');
        await adminFetch(`/api/admin/developer/submissions/${encodeURIComponent(v.submissionId)}/${action}`, { body: {} });
        if (action === 'publish') void invalidateExtensions();
        return action === 'submit' ? t('admin.console.developer.actions.submitted') : action === 'publish' ? t('admin.console.developer.actions.published') : t('admin.console.developer.actions.withdrawn');
    });
    const savePrice = () => {
        setPriceSaved(false);
        run('price', async () => {
            const { draft } = toDraft(priceForm);
            await adminFetch('/api/admin/developer/pricing', { body: { extensionId: ext.id, pricing: draftToValue(draft) } });
            setPriceSaved(true);
            return t('admin.console.developer.pricing.saved');
        });
    };

    const columns: Column<DevVersion>[] = [
        { id: 'v', header: t('admin.console.developer.versions.colVersion'), cell: (v) => <span className="font-medium">{v.version}</span>, isRowHeader: true },
        { id: 's', header: t('admin.console.developer.versions.colStatus'), cell: (v) => <Badge tone={VER_TONE[v.status] ?? 'neutral'}>{t(`admin.console.developer.status.version.${v.status}`)}</Badge> },
        { id: 'sub', header: t('admin.console.developer.versions.colSubmitted'), cell: (v) => formatDate(v.submittedAt, locale), hideBelow: 'sm' },
        { id: 'rev', header: t('admin.console.developer.versions.colReviewed'), cell: (v) => formatDate(v.reviewedAt, locale), hideBelow: 'md' },
        { id: 'risk', header: t('admin.console.developer.versions.colRisk'), cell: (v) => (v.analysis?.risk ? <Badge tone={RISK_TONE[v.analysis.risk] ?? 'neutral'}>{t(`admin.console.developer.validation.risk.${v.analysis.risk}`)}</Badge> : '—'), hideBelow: 'md' },
        {
            id: 'act', header: '',
            cell: (v) => (v.submissionId ? (
                <span className="flex flex-wrap gap-1">
                    {(v.status === 'draft' || v.status === 'changes_requested') && <button type="button" className="text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={busy !== null} onClick={() => versionAction(v, 'submit')}>{t('admin.console.developer.actions.submitDraft')}</button>}
                    {v.status === 'approved' && <button type="button" className="text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={busy !== null} onClick={() => versionAction(v, 'publish')}>{t('admin.console.developer.actions.publish')}</button>}
                    {v.status === 'in_review' && <button type="button" className="text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={busy !== null} onClick={() => versionAction(v, 'withdraw')}>{t('admin.console.developer.actions.withdraw')}</button>}
                </span>
            ) : null),
        },
    ];
    const notes = ext.versions.filter((v) => v.reviewNote);

    return (
        <Card
            title={<span className="break-all">{ext.name} <span className="text-sm font-normal text-muted-foreground">({ext.id})</span></span>}
            headingLevel={3}
            actions={<Badge tone={EXT_TONE[ext.status] ?? 'neutral'}>{t(`admin.console.developer.status.${ext.status}`)}</Badge>}
        >
            <div className="flex flex-wrap items-center gap-2">
                {ext.latestVersion && <span className="text-sm text-muted-foreground">{t('admin.console.developer.overview.latest')}: <strong className="text-foreground">{ext.latestVersion}</strong></span>}
                <div className="ml-auto flex flex-wrap gap-2">
                    <button type="button" className={btnOutline} onClick={() => onNewVersion(ext)}>{t('admin.console.developer.editor.title')}</button>
                    <button type="button" className={btnOutline} onClick={testInstall} disabled={busy !== null || ext.status === 'yanked' || ext.status === 'suspended'} aria-busy={busy === 'test' || undefined} title={t('admin.console.developer.actions.testInstallHint')}>{t('admin.console.developer.actions.testInstall')}</button>
                    <button type="button" className={btnOutline} onClick={() => setYankOpen(true)} disabled={busy !== null || ext.status === 'yanked'}>{t('admin.console.developer.actions.yank')}</button>
                </div>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" className="h-4 w-4 rounded border-input" checked={approvePerms} onChange={(e) => setApprovePerms(e.target.checked)} />{t('admin.console.developer.actions.approvePermissions')}</label>
            {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
            <div className="mt-4 -mx-4 sm:-mx-5">
                <DataTable caption={t('admin.console.developer.versions.caption', { name: ext.name })} columns={columns} rows={ext.versions} getRowId={(v) => v.version} empty={<p className="p-4 text-sm text-muted-foreground">{t('admin.console.developer.versions.empty')}</p>} />
            </div>
            {notes.length > 0 && (
                <div className="mt-3 space-y-2">
                    {notes.map((v) => (
                        <div key={v.version} className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                            <p className="font-medium text-foreground">{t('admin.console.developer.versions.reviewNote')} · {v.version}</p>
                            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{v.reviewNote}</p>
                        </div>
                    ))}
                </div>
            )}
            <details className="mt-4" onToggle={(e) => setPriceOpen((e.currentTarget as HTMLDetailsElement).open)}>
                <summary className="cursor-pointer text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('admin.console.developer.pricing.title')}</summary>
                <div className="mt-3">
                    <PricingPanel
                        form={priceForm}
                        onChange={(f) => { setPriceForm(f); setPriceSaved(false); }}
                        limits={overview.limits}
                        developerBps={overview.shares.developerBps}
                        paypalLinked={overview.paypal.status === 'linked'}
                        activeSubscribers={pricingQ.data?.activeSubscribers}
                        onSave={savePrice}
                        saving={busy === 'price'}
                        saved={priceSaved}
                    />
                </div>
            </details>
            <ConfirmDialog
                open={yankOpen}
                title={t('admin.console.developer.actions.yankTitle', { name: ext.name })}
                description={(
                    <div>
                        <p>{t('admin.console.developer.actions.yankBody')}</p>
                        <fieldset className="mt-3 space-y-1">
                            <legend className="sr-only">{t('admin.console.developer.actions.yank')}</legend>
                            <label className="flex items-center gap-2"><input type="radio" name={`${uid}-scope`} checked={yankScope === 'all'} onChange={() => setYankScope('all')} />{t('admin.console.developer.actions.yankAll')}</label>
                            {ext.latestVersion && (
                                <label className="flex items-center gap-2"><input type="radio" name={`${uid}-scope`} checked={yankScope === ext.latestVersion} onChange={() => setYankScope(ext.latestVersion!)} />{t('admin.console.developer.actions.yankVersion', { version: ext.latestVersion })}</label>
                            )}
                        </fieldset>
                    </div>
                )}
                confirmLabel={t('admin.console.developer.actions.yankConfirm')}
                cancelLabel={t('admin.console.developer.actions.cancel')}
                destructive
                busy={busy === 'yank'}
                onConfirm={yank}
                onCancel={() => setYankOpen(false)}
            />
            {dialog}
        </Card>
    );
}
