'use client';

import * as React from 'react';
import Link from 'next/link';
import { mutate as mutateSWR, type SWRResponse } from 'swr';
import { AlertTriangle, Info, Lock } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { ApiError, ErrorState, LoadingState, adminFetch, btnPrimary, buildQuery, useAdminQuery, useConsole } from '@/components/admin/console';
import { ReauthDialog } from '@/components/admin/mail-transfer/ReauthDialog';
import { formatCents } from '@/lib/billing/money';

export type FinNs = 'billing' | 'developer';

/** Formatea centavos con el idioma activo. Nunca floats. */
export function useMoney() {
    const { locale } = useI18n();
    return React.useCallback((cents: unknown, currency = 'USD') => formatCents(cents, currency, locale), [locale]);
}

/** Texto del error de la API de pagos/portal: codigo propio del namespace o el generico. */
export function useFinError(ns: FinNs) {
    const { t } = useI18n();
    return React.useCallback(
        (error: unknown): string => {
            const code = error instanceof ApiError ? error.code : undefined;
            const base = `admin.console.${ns}.errors.`;
            if (code && /^[a-z_]{3,40}$/.test(code)) {
                const key = base + code;
                const text = t(key);
                if (text !== key) return text;
            }
            if (error instanceof ApiError && error.status === 0) return t('admin.console.common.errors.network');
            if (error instanceof ApiError && error.status === 429) return t('admin.console.common.errors.tooMany');
            return t(base + 'generic');
        },
        [ns, t],
    );
}

/** Tras comprar/instalar: refresca lo que muestra la pantalla de Extensiones (catalogo, instaladas y configuracion publica del dominio). */
export function invalidateExtensions(): Promise<unknown> {
    return mutateSWR((key) => typeof key === 'string' && (key.startsWith('/api/admin/extensions/') || key.startsWith('/api/config')));
}

/** Invalida todas las lecturas de facturacion/portal (tras verificar identidad o cambiar datos). */
export function invalidateFinance(ns: FinNs = 'billing'): Promise<unknown> {
    return mutateSWR((key) => typeof key === 'string' && key.startsWith(`/api/admin/${ns}/`));
}

/** Navegacion completa hacia un destino externo ya validado (PayPal). */
export function goExternal(url: string) {
    window.location.assign(url);
}

export function ReauthGate({ ns, onVerified }: { ns: FinNs; onVerified: () => void }) {
    const { t } = useI18n();
    const { me } = useConsole();
    const [open, setOpen] = React.useState(false);
    return (
        <div role="region" aria-label={t(`admin.console.${ns}.gate.title`)} className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-5 text-card-foreground">
            <div className="flex items-center gap-2 font-medium text-foreground"><Lock className="h-4 w-4" aria-hidden="true" />{t(`admin.console.${ns}.gate.title`)}</div>
            <p className="text-sm text-muted-foreground">{t(`admin.console.${ns}.gate.body`)}</p>
            <button type="button" className={btnPrimary} onClick={() => setOpen(true)}>{t(`admin.console.${ns}.gate.verify`)}</button>
            <ReauthDialog
                open={open}
                base="/api/admin/mail-transfer"
                mfaEnrolled
                canUsePassword={me?.kind === 'manager'}
                isAdmin
                onVerified={() => { setOpen(false); onVerified(); }}
                onClose={() => setOpen(false)}
            />
        </div>
    );
}

export function NotSignedNotice({ ns }: { ns: FinNs }) {
    const { t } = useI18n();
    return (
        <div role="alert" className="flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning/10 p-5 text-sm text-foreground">
            <div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" aria-hidden="true" />{t(`admin.console.${ns}.notSigned.title`)}</div>
            <p className="text-muted-foreground">{t(`admin.console.${ns}.notSigned.body`)}</p>
            <Link href="/admin/profile#signing-key" className="w-fit font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t(`admin.console.${ns}.notSigned.link`)}
            </Link>
        </div>
    );
}

export function NotConfiguredNotice() {
    const { t } = useI18n();
    return (
        <div role="status" className="flex flex-col gap-1 rounded-xl border border-info/30 bg-info/10 p-5 text-sm text-foreground">
            <div className="flex items-center gap-2 font-medium"><Info className="h-4 w-4" aria-hidden="true" />{t('admin.console.billing.notConfigured.title')}</div>
            <p className="text-muted-foreground">{t('admin.console.billing.notConfigured.body')}</p>
        </div>
    );
}

/** Estados comunes de una consulta financiera: cargando, step-up, modo legado, pagos no habilitados, error. */
export function QueryBoundary<T>({ q, ns, children }: { q: SWRResponse<T, ApiError>; ns: FinNs; children: (data: T) => React.ReactNode }) {
    const { t } = useI18n();
    const finError = useFinError(ns);
    const err = q.error;
    if (err?.code === 'reauth_required') return <ReauthGate ns={ns} onVerified={() => { void invalidateFinance(ns); }} />;
    if (err?.code === 'signature_required') return <NotSignedNotice ns={ns} />;
    if (err?.code === 'payments_not_configured') return <NotConfiguredNotice />;
    if (err?.code === 'payments_unavailable') {
        return <ErrorState message={`${t('admin.console.billing.unavailable.title')}. ${t('admin.console.billing.unavailable.body')}`} onRetry={() => void q.mutate()} />;
    }
    if (err && !q.data) return <ErrorState message={finError(err)} onRetry={() => void q.mutate()} />;
    if (!q.data) return <LoadingState />;
    return <>{children(q.data)}</>;
}

/** Lista paginada por cursor (primera pagina por SWR; "Cargar mas" acumula). */
export function usePaged<T>(path: string, extra: Record<string, string | undefined> = {}) {
    const key = `${path}${buildQuery({ limit: 25, ...extra })}`;
    const first = useAdminQuery<{ items: T[]; nextCursor?: string | null }>(key);
    const [more, setMore] = React.useState<{ items: T[]; next: string | null | undefined }>({ items: [], next: undefined });
    const [loadingMore, setLoadingMore] = React.useState(false);
    const [moreError, setMoreError] = React.useState<unknown>(null);
    React.useEffect(() => { setMore({ items: [], next: undefined }); }, [first.data]);
    const next = more.next !== undefined ? more.next : first.data?.nextCursor ?? null;
    const loadMore = React.useCallback(async () => {
        if (!next) return;
        setLoadingMore(true);
        setMoreError(null);
        try {
            const page = await adminFetch<{ items: T[]; nextCursor?: string | null }>(`${path}${buildQuery({ limit: 25, ...extra, cursor: next })}`);
            setMore((m) => ({ items: [...m.items, ...(page.items ?? [])], next: page.nextCursor ?? null }));
        } catch (e) {
            setMoreError(e);
        } finally {
            setLoadingMore(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [next, path, JSON.stringify(extra)]);
    return { query: first, items: [...(first.data?.items ?? []), ...more.items], hasMore: !!next, loadMore, loadingMore, moreError };
}

/** Descarga un CSV (con step-up): en error conserva el codigo de la API (p. ej. reauth_required). */
export async function downloadFinanceCsv(url: string, fallbackName: string): Promise<void> {
    let res: Response;
    try {
        res = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
    } catch {
        throw new ApiError(0, 'network');
    }
    if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new ApiError(res.status, typeof data?.code === 'string' ? data.code : undefined);
    }
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    try {
        const a = document.createElement('a');
        a.href = href;
        a.download = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || fallbackName;
        document.body.appendChild(a);
        a.click();
        a.remove();
    } finally {
        setTimeout(() => URL.revokeObjectURL(href), 1000);
    }
}

/** YYYY-MM-DD en hora local (sin zonas horarias raras en el selector de fechas). */
export function isoDay(d: Date): string {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
}

export function defaultRange(now = new Date()): { from: string; to: string } {
    const from = new Date(now);
    from.setDate(from.getDate() - 29);
    return { from: isoDay(from), to: isoDay(now) };
}

export const rangeValid = (r: { from: string; to: string }) => /^\d{4}-\d{2}-\d{2}$/.test(r.from) && /^\d{4}-\d{2}-\d{2}$/.test(r.to) && r.from <= r.to;
