'use client';

import { useEffect, useState } from 'react';
import { HardDrive } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/I18nProvider';
import { useSession } from '@/components/SessionProvider';
import { useCache } from '@/contexts/CacheContext';
import { shouldSidebarRefresh } from '@/lib/mail-list';
import { formatStorage, parseQuotaView, quotaFillClass, quotaNoticeKey, quotaTextClass, type QuotaView } from '@/lib/mail-quota-view';

const POLL_MS = 5 * 60_000;

/**
 * Uso de almacenamiento del buzon: barra accesible (role="progressbar") con "X de Y", colores de estado por tokens
 * (exito -> aviso al 80 % -> destructivo al 95 %) y un aviso al pasar del 90 %. Sin limite configurado solo muestra el uso.
 * El uso de los cuerpos de los correos es una estimacion (ver lib/mail-quota.ts).
 */
export function QuotaMeter() {
    const { t, intlLocale } = useI18n();
    const { status } = useSession();
    const { subscribe } = useCache();
    const [quota, setQuota] = useState<QuotaView | null>(null);

    useEffect(() => {
        if (status !== 'authenticated') return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const load = async () => {
            try {
                const res = await fetch('/api/quota', { cache: 'no-store' });
                if (!res.ok) return; // 429 / 5xx: se conserva lo ultimo visto
                const view = parseQuotaView(await res.json().catch(() => null));
                if (!cancelled && view) setQuota(view);
            } catch { /* sin red: se conserva lo ultimo visto */ }
        };
        // Los avisos de cache (enviar, borrar, mover) piden recalcular; se agrupan para no saturar la ruta.
        const schedule = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => { void load(); }, 1500);
        };
        void load();
        const unsubscribe = subscribe((key) => { if (shouldSidebarRefresh(key)) schedule(); });
        const interval = setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, POLL_MS);
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
            clearInterval(interval);
            unsubscribe();
        };
    }, [status, subscribe]);

    if (!quota) return null;

    const used = formatStorage(quota.usedBytes, intlLocale);
    const limit = quota.limitBytes !== null ? formatStorage(quota.limitBytes, intlLocale) : null;
    const percent = quota.percent ?? 0;
    const shown = Math.min(100, Math.max(0, percent));
    const noticeKey = quotaNoticeKey(quota);
    const text = limit ? t('sidebar.quota.usedOf', { used, limit }) : t('sidebar.quota.usedOnly', { used });

    return (
        <div data-quota-meter data-quota-level={quota.level} className="px-4 pb-2 pt-1">
            <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span id="bx-quota-label" className="flex items-center gap-1.5 font-medium">
                    <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('sidebar.quota.label')}
                </span>
                <span className="tabular-nums" title={quota.approximate ? t('sidebar.quota.approx') : undefined}>{text}</span>
            </div>
            {limit ? (
                <div
                    role="progressbar"
                    aria-labelledby="bx-quota-label"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(shown)}
                    aria-valuetext={t('sidebar.quota.aria', { used, limit, percent: Math.round(percent) })}
                    className="h-2 w-full overflow-hidden rounded-full bg-muted"
                >
                    <div className={cn('h-full rounded-full transition-[width] duration-300', quotaFillClass(quota.level))} style={{ width: `${shown}%` }} />
                </div>
            ) : null}
            {noticeKey && (
                <p role="status" data-quota-notice className={cn('mt-1.5 text-xs font-medium', quotaTextClass(quota.level))}>
                    {t(noticeKey, { percent: Math.round(percent) })}
                </p>
            )}
        </div>
    );
}
