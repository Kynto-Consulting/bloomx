'use client';

import * as React from 'react';
import Link from 'next/link';
import { BookOpen } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { Badge, Card, DefinitionList, EmptyState, PageHeader, adminFetch, btnOutline, btnPrimary, formatDateTime, useAdminQuery } from '@/components/admin/console';
import { useStepUp } from '@/components/admin/permissions/useStepUp';
import { NotSignedNotice, QueryBoundary, invalidateFinance, useFinError } from '@/components/admin/billing/shared';
import { Editor, type EditorSeed } from './Editor';
import { ExtensionPanel } from './ExtensionPanel';
import { emptyPriceForm, priceFormFrom, type PriceForm } from './PricingPanel';
import type { DevExtension, DevOverview } from './types';

/** /admin/developer — portal de desarrolladores: terminos, editor con validacion en vivo, precio, revision y versiones. */
export function DeveloperScreen() {
    const { t } = useI18n();
    const q = useAdminQuery<DevOverview>('/api/admin/developer/overview');
    const [notice, setNotice] = React.useState('');
    const [seed, setSeed] = React.useState<EditorSeed | null>(null);
    const [priceForm, setPriceForm] = React.useState<PriceForm>(emptyPriceForm);
    const editorRef = React.useRef<HTMLDivElement>(null);

    const refresh = React.useCallback(async (message?: string) => {
        if (message) setNotice(message);
        await q.mutate();
        void invalidateFinance('developer');
    }, [q]);

    const newVersion = (ext: DevExtension) => {
        setSeed({ extensionId: ext.id, price: priceFormFrom(ext.pricing) });
        setPriceForm(priceFormFrom(ext.pricing));
        editorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    };

    return (
        <div className="mx-auto max-w-7xl">
            <PageHeader
                title={t('admin.console.developer.title')}
                description={t('admin.console.developer.subtitle')}
                actions={(
                    <nav aria-label={t('admin.console.developer.docs.title')} className="flex flex-wrap gap-2">
                        <a href="/docs/developer-guide" className={btnOutline}><BookOpen className="h-4 w-4" aria-hidden="true" />{t('admin.console.developer.docs.guide')}</a>
                        <a href="/docs/billing-guide" className={btnOutline}><BookOpen className="h-4 w-4" aria-hidden="true" />{t('admin.console.developer.docs.billing')}</a>
                    </nav>
                )}
            />
            <div role="status" aria-live="polite" className={notice ? 'mb-4 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success' : 'sr-only'}>{notice}</div>
            {q.error?.code === 'signature_required' ? <NotSignedNotice ns="developer" /> : (
                <QueryBoundary q={q} ns="developer">
                    {(o) => (
                        <div className="space-y-6">
                            {o.thirdPartyEnabled === false && (
                                <div role="status" data-testid="bx-dev-disabled" className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-foreground">
                                    <p className="font-semibold">{t('admin.console.developer.disabled.title')}</p>
                                    <p className="mt-1 text-muted-foreground">{t('admin.console.developer.disabled.body')}</p>
                                </div>
                            )}
                            <OverviewCard overview={o} />
                            {o.thirdPartyEnabled !== false && <TermsCard overview={o} onAccepted={() => refresh(t('admin.console.developer.terms.saved'))} />}
                            <section aria-labelledby="bx-dev-exts" className="space-y-4">
                                <h2 id="bx-dev-exts" className="text-lg font-semibold text-foreground">{t('admin.console.developer.overview.extensionsTitle')}</h2>
                                {o.extensions.length === 0
                                    ? <Card><EmptyState title={t('admin.console.developer.overview.extensionsEmpty')} /></Card>
                                    : o.extensions.map((e) => <ExtensionPanel key={e.id} ext={e} overview={o} onNewVersion={newVersion} onChanged={(m) => refresh(m)} />)}
                            </section>
                            {o.thirdPartyEnabled !== false && (
                                <div ref={editorRef} className="scroll-mt-4">
                                    <Editor overview={o} seed={seed} priceForm={priceForm} onPriceForm={setPriceForm} onDone={(m) => void refresh(m)} />
                                </div>
                            )}
                        </div>
                    )}
                </QueryBoundary>
            )}
        </div>
    );
}

function OverviewCard({ overview }: { overview: DevOverview }) {
    const { t } = useI18n();
    const linked = overview.paypal.status === 'linked';
    return (
        <Card>
            <DefinitionList
                items={[
                    { label: t('admin.console.developer.overview.slug'), value: <code className="rounded bg-muted px-1 py-0.5 text-xs">{overview.slug}</code> },
                    { label: t('admin.console.developer.overview.idPrefix'), value: <code className="rounded bg-muted px-1 py-0.5 text-xs">{overview.idPrefix}</code> },
                    {
                        label: 'PayPal',
                        value: linked
                            ? <span>{t('admin.console.developer.overview.paypalLinked', { email: overview.paypal.emailMasked ?? '—' })}</span>
                            : (
                                <span className="flex flex-wrap items-center gap-2">
                                    <Badge tone="warning">{t('admin.console.billing.account.status.none')}</Badge>
                                    <span className="text-muted-foreground">{t('admin.console.developer.overview.paypalNone')}</span>
                                    <Link href="/admin/billing?tab=account" className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('admin.console.developer.overview.paypalLink')}</Link>
                                </span>
                            ),
                    },
                ]}
            />
        </Card>
    );
}

function TermsCard({ overview, onAccepted }: { overview: DevOverview; onAccepted: () => Promise<void> }) {
    const { t, locale } = useI18n();
    const finError = useFinError('developer');
    const { guard, dialog } = useStepUp();
    const [checked, setChecked] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const uid = React.useId();
    const { requiredVersion, acceptedVersion, acceptedAt } = overview.terms;
    const ok = acceptedVersion === requiredVersion;

    const accept = () => {
        setError(null);
        setBusy(true);
        void guard(async () => { await adminFetch('/api/admin/developer/terms', { body: { version: requiredVersion } }); await onAccepted(); })
            .catch((e) => setError(finError(e)))
            .finally(() => setBusy(false));
    };

    return (
        <Card title={t('admin.console.developer.terms.title')}>
            {ok ? (
                <p role="status" className="text-sm text-muted-foreground">{t('admin.console.developer.terms.accepted', { version: acceptedVersion ?? '', date: formatDateTime(acceptedAt, locale) })}</p>
            ) : (
                <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">{t('admin.console.developer.terms.body', { version: requiredVersion })}</p>
                    {acceptedVersion && <p className="text-sm text-warning">{t('admin.console.developer.terms.outdated', { accepted: acceptedVersion, required: requiredVersion })}</p>}
                    <label htmlFor={`${uid}-ok`} className="flex items-start gap-2 text-sm text-foreground">
                        <input id={`${uid}-ok`} type="checkbox" className="mt-0.5 h-4 w-4 rounded border-input" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                        <span>{t('admin.console.developer.terms.check', { version: requiredVersion })}</span>
                    </label>
                    <button type="button" className={btnPrimary} onClick={accept} disabled={!checked || busy} aria-busy={busy || undefined}>{t('admin.console.developer.terms.accept')}</button>
                    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                </div>
            )}
            {dialog}
        </Card>
    );
}
