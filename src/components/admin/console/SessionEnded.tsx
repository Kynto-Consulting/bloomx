'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { SESSION_ENDED_EVENT, type SessionEndedDetail } from './api';
import { btnOutline, btnPrimary } from './ui';

/**
 * Sesion de administracion terminada (reemplazada por otra, caducada por inactividad / tope de 12 h, o cuenta bloqueada): mensaje claro y
 * redireccion al acceso (sin quedar colgada). Escucha el evento que lanza `adminFetch` ante un 401/403 con ese codigo.
 */
export function useSessionEnded(): SessionEndedDetail | null {
    const [ended, setEnded] = React.useState<SessionEndedDetail | null>(null);
    React.useEffect(() => {
        const on = (e: Event) => setEnded((e as CustomEvent<SessionEndedDetail>).detail);
        window.addEventListener(SESSION_ENDED_EVENT, on);
        return () => window.removeEventListener(SESSION_ENDED_EVENT, on);
    }, []);
    return ended;
}

export const LOGIN_HREF = '/login?callbackUrl=%2Fadmin';

export function sessionEndedMessage(t: (k: string, p?: Record<string, string | number>) => string, d: Pick<SessionEndedDetail, 'code' | 'reason' | 'at' | 'byIp' | 'byDevice'>, locale: string): string {
    if (d.code === 'ACCOUNT_LOCKED') return t('admin.console.perms.ended.locked');
    if (d.code === 'EXPIRED') return t(d.reason === 'expired_absolute' ? 'admin.console.perms.ended.expired_absolute' : 'admin.console.perms.ended.expired_idle');
    if (d.byDevice || d.byIp) {
        let time = d.at ?? '';
        try { if (d.at) time = new Date(d.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }); } catch { /* ISO */ }
        return t('admin.console.perms.ended.superseded', { device: d.byDevice ?? '?', ip: d.byIp ?? '?', time });
    }
    return t('admin.console.perms.ended.supersededNoInfo');
}

export function SessionEndedOverlay({ detail }: { detail: SessionEndedDetail }) {
    const { t, intlLocale } = useI18n();
    React.useEffect(() => {
        const id = window.setTimeout(() => window.location.replace(LOGIN_HREF), 9000);
        return () => window.clearTimeout(id);
    }, []);
    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-overlay p-6">
            <div role="alertdialog" aria-modal="true" aria-labelledby="session-ended-title" aria-describedby="session-ended-body" className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg">
                <h2 id="session-ended-title" className="text-lg font-semibold text-foreground">{t('admin.console.perms.ended.title')}</h2>
                <p id="session-ended-body" className="mt-2 text-sm text-foreground">{sessionEndedMessage(t, detail, intlLocale)}</p>
                {detail.code === 'SUPERSEDED' && <p className="mt-2 text-sm font-medium text-warning">{t('admin.console.perms.ended.notYou')}</p>}
                <p className="mt-2 text-xs text-muted-foreground" role="status">{t('admin.console.perms.ended.redirecting')}</p>
                <div className="mt-5 flex flex-wrap gap-2">
                    <a href={LOGIN_HREF} className={btnPrimary} autoFocus>{t('admin.console.perms.ended.signIn')}</a>
                    {detail.code === 'SUPERSEDED' && <a href="/security" className={btnOutline}>{t('admin.console.perms.ended.security')}</a>}
                </div>
            </div>
        </div>
    );
}
