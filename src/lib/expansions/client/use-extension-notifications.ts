'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { safeToastUrl } from '@/lib/expansions/host-services/notify-url';

export const NOTIFICATIONS_POLL_MS = 30_000;
const SEEN_CAP = 200;

export interface ExtensionNotificationDto {
    id: string;
    level?: string;
    title?: string | null;
    message: string;
    url?: string | null;
}

type ToastFn = (message: string, opts?: { description?: string; action?: { label: string; onClick: () => void } }) => unknown;

/** Muestra una notificacion con el toast de la app (sonner). La url solo se usa si pasa safeToastUrl. */
export function showExtensionToast(
    n: ExtensionNotificationDto,
    opts: { openLabel: string; navigate: (url: string) => void; toasts?: Record<string, ToastFn> },
) {
    const fns: Record<string, ToastFn> = opts.toasts ?? { info: toast.info, success: toast.success, warning: toast.warning, error: toast.error };
    const fn = fns[n.level ?? 'info'] ?? fns.info;
    const url = safeToastUrl(n.url);
    const headline = n.title ? n.title : n.message;
    fn(headline, {
        description: n.title ? n.message : undefined,
        action: url ? { label: opts.openLabel, onClick: () => opts.navigate(url) } : undefined,
    });
}

export function navigateTo(url: string) {
    if (url.startsWith('/')) window.location.assign(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Sondea /api/expansions/notifications cada 30 s (en pausa si la pestana esta oculta; al volver a verse consulta al
 * instante) y muestra cada notificacion como toast. `enabled=false` (sin sesion) no hace nada; un 401 detiene el sondeo.
 */
export function useExtensionNotifications(opts: { enabled: boolean; openLabel: string }) {
    const labelRef = useRef(opts.openLabel);
    labelRef.current = opts.openLabel;

    useEffect(() => {
        if (!opts.enabled) return;
        let disposed = false;
        let inFlight = false;
        let stopped = false;
        const seen = new Set<string>();

        const poll = async () => {
            if (disposed || stopped || inFlight || document.hidden) return;
            inFlight = true;
            try {
                const res = await fetch('/api/expansions/notifications', { cache: 'no-store', credentials: 'same-origin' });
                if (res.status === 401) { stopped = true; return; }
                if (!res.ok) return;
                const data = await res.json();
                const list: ExtensionNotificationDto[] = Array.isArray(data?.notifications) ? data.notifications : [];
                for (const n of list) {
                    if (!n || typeof n.id !== 'string' || typeof n.message !== 'string' || seen.has(n.id)) continue;
                    seen.add(n.id);
                    if (seen.size > SEEN_CAP) seen.delete(seen.values().next().value as string);
                    showExtensionToast(n, { openLabel: labelRef.current, navigate: navigateTo });
                }
            } catch {
                /* red caida: se reintenta en el siguiente ciclo */
            } finally {
                inFlight = false;
            }
        };

        const onVisible = () => { if (!document.hidden) void poll(); };
        void poll();
        const timer = setInterval(() => void poll(), NOTIFICATIONS_POLL_MS);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            disposed = true;
            clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [opts.enabled]);
}
