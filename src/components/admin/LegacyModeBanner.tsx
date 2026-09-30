'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';

/**
 * Aviso de MODO HEREDADO del dominio (panel de admin). Componente reutilizable: basta con
 * `<LegacyModeBanner domainId={domainConfig.id} />` en el dashboard.
 *
 * - Consulta GET /api/admin/domain-key?domainId=.. ({ registered, requireSignature, legacyMode }), sin material privado.
 * - Sin clave de firma registrada (modo heredado): aviso con enlace al flujo de registro
 *   (`node scripts/gen-domain-keypair.mjs` + POST /api/manager/domain-key; ver docs).
 * - Con clave registrada y sin `requireSignature`: boton "Exigir firma" (POST { requireSignature: true }).
 * - Con `requireSignature` activo: confirmacion y opcion de desactivarlo.
 * - Si no se puede consultar el estado, no muestra nada (no bloquea el panel).
 */

export interface LegacyModeBannerProps {
    domainId?: string;
    /** Enlace al flujo/pantalla de registro de la clave de firma. */
    registerHref?: string;
    className?: string;
}

type Status = { registered: boolean; requireSignature: boolean; legacyMode: boolean };

const ENDPOINT = '/api/admin/domain-key';
export const DEFAULT_REGISTER_HREF = '/docs/api-backend#signing';

export function LegacyModeBanner({ domainId, registerHref = DEFAULT_REGISTER_HREF, className = '' }: LegacyModeBannerProps) {
    const { t } = useI18n();
    const [status, setStatus] = useState<Status | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        if (!domainId) return;
        const controller = new AbortController();
        setStatus(null);
        (async () => {
            try {
                const res = await fetch(`${ENDPOINT}?${new URLSearchParams({ domainId })}`, { cache: 'no-store', signal: controller.signal });
                if (!res.ok) return;
                const data = await res.json();
                const registered = data?.registered === true;
                setStatus({
                    registered,
                    requireSignature: data?.requireSignature === true,
                    legacyMode: typeof data?.legacyMode === 'boolean' ? data.legacyMode : !registered,
                });
            } catch {
                /* sin estado: el aviso no se muestra */
            }
        })();
        return () => controller.abort();
    }, [domainId]);

    const setRequire = useCallback(
        async (value: boolean) => {
            if (!domainId || busy) return;
            setBusy(true);
            setError(null);
            try {
                const res = await fetch(ENDPOINT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ domainId, requireSignature: value }),
                });
                if (!res.ok) {
                    setError(t('legacyMode.banner.requireFailed'));
                    return;
                }
                setStatus((prev) => (prev ? { ...prev, requireSignature: value } : prev));
                if (value) toast.success(t('legacyMode.banner.requireOn'));
            } catch {
                setError(t('legacyMode.banner.requireFailed'));
            } finally {
                setBusy(false);
            }
        },
        [domainId, busy, t],
    );

    if (!domainId || !status || dismissed) return null;

    // Clave registrada y firma exigida: todo protegido.
    if (status.requireSignature) {
        return (
            <div role="status" className={`flex flex-wrap items-center gap-3 rounded-xl border border-success/30 bg-success/10 p-4 text-sm text-foreground ${className}`}>
                <ShieldCheck className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
                <p className="min-w-0 flex-1">{t('legacyMode.banner.requireOn')}</p>
                <button
                    type="button"
                    onClick={() => void setRequire(false)}
                    disabled={busy}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                >
                    {t('legacyMode.banner.requireDisable')}
                </button>
                {error && <span role="alert" className="w-full text-xs text-destructive">{error}</span>}
            </div>
        );
    }

    // Clave registrada, aun sin exigir firma: ofrecer activarlo.
    if (status.registered) {
        return (
            <div role="status" className={`flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/40 p-4 text-sm text-foreground ${className}`}>
                <ShieldCheck className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <p className="font-medium">{t('legacyMode.banner.requireTitle')}</p>
                    <p className="text-xs text-muted-foreground">{t('legacyMode.banner.requireBody')}</p>
                </div>
                <button
                    type="button"
                    onClick={() => void setRequire(true)}
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                    {busy ? t('legacyMode.banner.requireBusy') : t('legacyMode.banner.requireButton')}
                </button>
                {error && <span role="alert" className="w-full text-xs text-destructive">{error}</span>}
            </div>
        );
    }

    // Modo heredado sin firma: aviso.
    return (
        <div role="alert" className={`flex flex-wrap items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-foreground ${className}`}>
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium">{t('legacyMode.banner.title')}</p>
                <p>{t('legacyMode.banner.body')}</p>
                <p className="text-xs text-muted-foreground">{t('legacyMode.banner.howTo')}</p>
                <a href={registerHref} className="inline-block text-xs font-medium text-primary underline underline-offset-2 hover:text-primary/80">
                    {t('legacyMode.banner.docsLink')}
                </a>
            </div>
            <button
                type="button"
                onClick={() => setDismissed(true)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
            >
                {t('legacyMode.banner.dismiss')}
            </button>
        </div>
    );
}
