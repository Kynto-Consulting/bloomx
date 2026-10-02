'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, CircleAlert, Clock, Loader2, XCircle } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { ApiError, adminFetch, btnOutline, btnPrimary, useAdminQuery } from '@/components/admin/console';
import { safePayPalUrl } from '@/lib/billing/paypal-url';
import { clearPending, isPending, markPending } from './pending-purchase';
import { NotConfiguredNotice, useMoney, ReauthGate, goExternal, invalidateExtensions, invalidateFinance, useFinError } from './shared';
import type { CaptureResponse, ConfirmResponse, InstallResult, OrderInfo } from './types';

/** Cuantas veces y cada cuanto se vuelve a preguntar por un pago que PayPal aun marca como pendiente. */
const POLL_MS = 4000;
const POLL_MAX = 8;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const PLAN_RE = /^(one_time|month|year)$/;

type View =
    | { kind: 'working' }
    | { kind: 'reauth' }
    | { kind: 'cancelled' }
    | { kind: 'invalid' }
    | { kind: 'confirm' }
    | { kind: 'foreign' }
    | { kind: 'error'; error: unknown }
    | { kind: 'order'; status: CaptureResponse['status']; extensionId: string; install: InstallResult | null }
    | { kind: 'subscription'; status: string; extensionId: string | null; install: InstallResult | null };

const clean = () => { try { window.history.replaceState(null, '', '/admin/billing'); } catch { /* sin history */ } };

/**
 * Retornos de PayPal a /admin/billing:
 *   ?order=<id>[&token=..]        captura el pago unico y muestra el resultado de la instalacion
 *   ?subscription=<id>            confirma la suscripcion
 *   &cancelled=1                  el comprador cancelo en PayPal (no se llama a nada)
 *   ?buy=<extensionId>[&plan=..]  continuacion de una compra que necesitaba step-up (la pantalla de Extensiones redirige aqui)
 * Todo pasa por los proxies firmados; los parametros se validan antes de usarse.
 */
export function ReturnHandler() {
    const { t } = useI18n();
    const finError = useFinError('billing');
    const params = useSearchParams();
    const order = params?.get('order') ?? null;
    const subscription = params?.get('subscription') ?? null;
    const token = params?.get('token') ?? null;
    const cancelled = params?.get('cancelled') === '1';
    const buy = params?.get('buy') ?? null;
    const plan = params?.get('plan') ?? null;
    const relevant = !!(order || subscription || buy);

    const [view, setView] = React.useState<View | null>(relevant ? { kind: 'working' } : null);
    const started = React.useRef<string | null>(null);
    // Los parametros se guardan al llegar: despues se limpia la URL (clean) y useSearchParams ya no los devolveria.
    const keep = React.useRef({ order, token, subscription, buy, plan });
    const polls = React.useRef(0);
    const pollTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const fail = React.useCallback((error: unknown) => {
        if (error instanceof ApiError && error.code === 'reauth_required') setView({ kind: 'reauth' });
        else setView({ kind: 'error', error });
    }, []);

    const poll = React.useCallback((orderId: string) => {
        if (polls.current >= POLL_MAX) return;
        polls.current += 1;
        pollTimer.current = setTimeout(async () => {
            try {
                const info = await adminFetch<OrderInfo>(`/api/admin/billing/orders/${encodeURIComponent(orderId)}`);
                if (info.status === 'PENDING' || info.status === 'CREATED') { poll(orderId); return; }
                const installStatus = info.installStatus as InstallResult['status'] | null;
                setView({ kind: 'order', status: info.status as CaptureResponse['status'], extensionId: info.extensionId, install: installStatus ? { status: installStatus } : null });
                if (info.status === 'CAPTURED') { void invalidateExtensions(); void invalidateFinance('billing'); }
            } catch { /* se sigue mostrando "pendiente"; el boton permite repetir la comprobacion */ }
        }, POLL_MS);
    }, []);

    const run = React.useCallback(async () => {
        const { order, token, subscription, buy, plan } = keep.current;
        setView({ kind: 'working' });
        try {
            if (order) {
                if (!ID_RE.test(order) || (token && !ID_RE.test(token))) { setView({ kind: 'invalid' }); return; }
                if (!isPending('order', order)) { setView({ kind: 'foreign' }); clean(); return; }
                const r = await adminFetch<CaptureResponse>('/api/admin/billing/orders/capture', { body: { orderId: order, ...(token ? { token } : {}) } });
                setView({ kind: 'order', status: r.status, extensionId: r.order?.extensionId ?? '', install: r.install ?? null });
                clean();
                if (r.status === 'PENDING' || r.status === 'CREATED') { polls.current = 0; poll(order); } else clearPending('order', order);
                if (r.status === 'CAPTURED') { void invalidateExtensions(); void invalidateFinance('billing'); }
            } else if (subscription) {
                if (!ID_RE.test(subscription)) { setView({ kind: 'invalid' }); return; }
                if (!isPending('subscription', subscription)) { setView({ kind: 'foreign' }); clean(); return; }
                const r = await adminFetch<ConfirmResponse>('/api/admin/billing/subscriptions/confirm', { body: { subscriptionId: subscription } });
                setView({ kind: 'subscription', status: String(r.status ?? ''), extensionId: typeof r.subscription?.extensionId === 'string' ? r.subscription.extensionId : null, install: r.install ?? null });
                clean();
                if (r.status === 'ACTIVE' || r.status === 'TRIAL') clearPending('subscription', subscription);
                if (r.install?.status === 'installed' || r.status === 'ACTIVE' || r.status === 'TRIAL') { void invalidateExtensions(); void invalidateFinance('billing'); }
            } else if (buy) {
                if (!ID_RE.test(buy) || (plan && !PLAN_RE.test(plan))) { setView({ kind: 'invalid' }); return; }
                const r = await adminFetch<{ approveUrl?: unknown; id?: unknown; kind?: unknown }>('/api/admin/billing/orders', { body: { extensionId: buy, ...(plan ? { plan } : {}) } });
                markPending(r.kind === 'subscription' ? 'subscription' : 'order', r.id);
                const url = safePayPalUrl(r.approveUrl);
                if (!url) throw new ApiError(502, 'paypal_unavailable');
                goExternal(url);
            }
        } catch (e) {
            fail(e);
        }
    }, [poll, fail]);

    React.useEffect(() => {
        if (!relevant) return;
        const key = `${order}|${subscription}|${buy}|${cancelled}`;
        if (started.current === key) return;
        started.current = key;
        keep.current = { order, token, subscription, buy, plan };
        if (cancelled) { setView({ kind: 'cancelled' }); clean(); return; }
        // Compra por enlace (?buy=): nunca crea la orden sola; exige un clic en la pantalla de confirmacion.
        if (buy && !order && !subscription) {
            if (!ID_RE.test(buy) || (plan && !PLAN_RE.test(plan))) setView({ kind: 'invalid' });
            else setView({ kind: 'confirm' });
            return;
        }
        void run();
    }, [relevant, order, token, subscription, buy, plan, cancelled, run]);

    React.useEffect(() => () => { if (pollTimer.current) clearTimeout(pollTimer.current); }, []);

    if (!view) return null;

    if (view.kind === 'reauth') return <ReauthGate ns="billing" onVerified={() => void run()} />;

    const box = 'rounded-xl border p-4 text-sm';
    const extLink = (id: string | null | undefined) => (
        <div className="mt-3 flex flex-wrap gap-2">
            {id ? <Link href={`/admin/extensions?open=${encodeURIComponent(id)}`} className={btnPrimary}>{t('admin.console.billing.returns.goExtension')}</Link> : null}
            <Link href="/admin/extensions" className={btnOutline}>{t('admin.console.billing.returns.goExtensions')}</Link>
        </div>
    );
    const installText = (inst: InstallResult | null) => {
        if (!inst) return null;
        const msg = inst.status === 'installed' ? t('admin.console.billing.returns.installed')
            : inst.status === 'pending_approval' ? t('admin.console.billing.returns.pendingApproval')
                : inst.status === 'failed' ? t('admin.console.billing.returns.installFailed', { code: inst.code ?? t('admin.console.billing.returns.code.unknown') })
                    : t('admin.console.billing.returns.installSkipped');
        const Icon = inst.status === 'installed' ? CheckCircle2 : inst.status === 'failed' ? XCircle : CircleAlert;
        return <p className="mt-2 flex items-start gap-2"><Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{msg}</span></p>;
    };

    return (
        <section aria-labelledby="bx-return-title" aria-live="polite" className="mb-6">
            <h2 id="bx-return-title" className="sr-only">{t('admin.console.billing.returns.title')}</h2>
            {view.kind === 'working' && (
                <div role="status" className={`${box} flex items-center gap-2 border-border bg-card text-foreground`}>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{keep.current.buy && !keep.current.order && !keep.current.subscription ? t('admin.console.billing.returns.buying') : t('admin.console.billing.returns.verifying')}
                </div>
            )}
            {view.kind === 'confirm' && <BuyConfirm extensionId={keep.current.buy ?? ''} plan={keep.current.plan} onConfirm={() => void run()} onCancel={() => { setView({ kind: 'cancelled' }); clean(); }} />}
            {view.kind === 'foreign' && <div role="alert" className={`${box} border-warning/40 bg-warning/10 text-foreground`}>{t('admin.console.billing.returns.foreign')}</div>}
            {view.kind === 'cancelled' && <div className={`${box} border-border bg-muted text-foreground`}>{t('admin.console.billing.returns.cancelled')}</div>}
            {view.kind === 'invalid' && <div role="alert" className={`${box} border-destructive/30 bg-destructive/10 text-destructive`}>{t('admin.console.billing.returns.invalid')}</div>}
            {view.kind === 'error' && (
                view.error instanceof ApiError && view.error.code === 'payments_not_configured'
                    ? <NotConfiguredNotice />
                    : (
                        <div role="alert" className={`${box} border-destructive/30 bg-destructive/10 text-destructive`}>
                            <p>{finError(view.error)}</p>
                            {view.error instanceof ApiError && view.error.code === 'already_owned' && keep.current.buy ? extLink(keep.current.buy) : null}
                            <button type="button" className={`${btnOutline} mt-3`} onClick={() => void run()}>{t('admin.console.billing.returns.recheck')}</button>
                        </div>
                    )
            )}
            {view.kind === 'order' && (
                <div className={`${box} ${view.status === 'CAPTURED' ? 'border-success/30 bg-success/10' : view.status === 'PENDING' || view.status === 'CREATED' ? 'border-warning/40 bg-warning/10' : 'border-destructive/30 bg-destructive/10'} text-foreground`}>
                    <p className="flex items-start gap-2 font-medium">
                        {view.status === 'CAPTURED' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                            : view.status === 'PENDING' || view.status === 'CREATED' ? <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                                : <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                        <span>
                            {view.status === 'CAPTURED' ? t('admin.console.billing.returns.paid')
                                : view.status === 'PENDING' || view.status === 'CREATED' ? t('admin.console.billing.returns.pending')
                                    : view.status === 'REFUNDED' ? t('admin.console.billing.returns.refunded')
                                        : view.status === 'DISPUTED' ? t('admin.console.billing.returns.disputed')
                                            : t('admin.console.billing.returns.failed')}
                        </span>
                    </p>
                    {view.status === 'CAPTURED' && installText(view.install)}
                    {(view.status === 'PENDING' || view.status === 'CREATED') && keep.current.order && (
                        <button type="button" className={`${btnOutline} mt-3`} onClick={() => { polls.current = 0; void run(); }}>{t('admin.console.billing.returns.recheck')}</button>
                    )}
                    {view.status === 'CAPTURED' && view.extensionId ? extLink(view.extensionId) : null}
                </div>
            )}
            {view.kind === 'subscription' && (
                <div className={`${box} ${view.status === 'ACTIVE' || view.status === 'TRIAL' ? 'border-success/30 bg-success/10' : 'border-warning/40 bg-warning/10'} text-foreground`}>
                    <p className="flex items-start gap-2 font-medium">
                        {view.status === 'ACTIVE' || view.status === 'TRIAL' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                        <span>{view.status === 'ACTIVE' || view.status === 'TRIAL' ? t('admin.console.billing.returns.subscriptionActive') : t('admin.console.billing.returns.subscriptionPending')}</span>
                    </p>
                    {installText(view.install)}
                    {view.status !== 'ACTIVE' && view.status !== 'TRIAL' && <button type="button" className={`${btnOutline} mt-3`} onClick={() => void run()}>{t('admin.console.billing.returns.recheck')}</button>}
                    {extLink(view.extensionId)}
                </div>
            )}
        </section>
    );
}

function BuyConfirm({ extensionId, plan, onConfirm, onCancel }: { extensionId: string; plan: string | null; onConfirm: () => void; onCancel: () => void }) {
    const { t } = useI18n();
    const money = useMoney();
    const q = useAdminQuery<{ extensions: { id: string; name: string; price: string; currency: string; template: { permissions?: string[] } | null }[] }>('/api/admin/extensions/catalog');
    const ext = q.data?.extensions?.find((e) => e.id === extensionId);
    const cents = ext ? Math.round(Number(ext.price) * 100) : NaN;
    const planLabel = plan === 'month' ? t('admin.console.billing.returns.plan.month') : plan === 'year' ? t('admin.console.billing.returns.plan.year') : t('admin.console.billing.returns.plan.one_time');
    const perms = ext?.template?.permissions ?? [];
    return (
        <div role="alertdialog" aria-labelledby="bx-buy-title" className="rounded-xl border border-border bg-card p-4 text-sm text-foreground">
            <h3 id="bx-buy-title" className="font-medium">{t('admin.console.billing.returns.confirmTitle')}</h3>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">{t('admin.console.billing.returns.confirmExtension')}</dt><dd>{ext?.name ?? extensionId}</dd>
                <dt className="text-muted-foreground">{t('admin.console.billing.returns.confirmPlan')}</dt><dd>{planLabel}</dd>
                {Number.isFinite(cents) && <><dt className="text-muted-foreground">{t('admin.console.billing.returns.confirmPrice')}</dt><dd>{money(cents, ext?.currency || 'USD')}</dd></>}
                {perms.length > 0 && <><dt className="text-muted-foreground">{t('admin.console.billing.returns.confirmPermissions')}</dt><dd>{perms.join(', ')}</dd></>}
            </dl>
            <p className="mt-2 text-muted-foreground">{t('admin.console.billing.returns.confirmHint')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={btnPrimary} onClick={onConfirm}>{t('admin.console.billing.returns.confirmGo')}</button>
                <button type="button" className={btnOutline} onClick={onCancel}>{t('admin.console.billing.returns.confirmCancel')}</button>
            </div>
        </div>
    );
}
