'use client';

import { useMemo } from 'react';
import { ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/I18nProvider';
import { classifyForDisplay, subjectWithTag, type DisplayVerdict, type ExternalPolicy } from './external-display';
import { useExternalPolicy } from './useExternalPolicy';

export interface RowExternalInfo {
    policy: ExternalPolicy | null;
    verdict: DisplayVerdict | null;
    /** Mostrar la insignia: politica activa y remitente externo no confiable (o con suplantacion). */
    show: boolean;
    /** Asunto para mostrar en la lista (con etiqueta si la politica la pide). Nunca es el asunto guardado. */
    subject: string;
    /** Texto corto para lectores de pantalla ("Externo") o ''. */
    srLabel: string;
}

/**
 * Datos de externo de UNA fila de la lista. `skip` (carpetas de salida) desactiva todo. Sin politica cargada no hay nada que mostrar
 * y el asunto se devuelve tal cual.
 */
export function useRowExternal(from: string, subject: string, opts?: { skip?: boolean; myEmail?: string | null }): RowExternalInfo {
    const { t, locale } = useI18n();
    const policy = useExternalPolicy();
    const skip = opts?.skip === true;
    const myEmail = opts?.myEmail ?? null;
    return useMemo(() => {
        if (skip || !policy || !policy.enabled) return { policy, verdict: null, show: false, subject, srLabel: '' };
        const verdict = classifyForDisplay(policy, from, myEmail);
        const show = verdict.warn;
        return {
            policy,
            verdict,
            show,
            subject: show ? subjectWithTag(subject, policy, locale === 'en' ? 'en' : 'es', verdict) : subject,
            srLabel: show ? t('spamUser.external.badge') : '',
        };
    }, [skip, policy, from, subject, myEmail, locale, t]);
}

/** Insignia compacta "Externo" para la fila. Solo si la politica esta activa y hay que avisar; sin datos no muestra nada. */
export function ExternalBadge({ show, style, className }: { show: boolean; style?: 'info' | 'warning'; className?: string }) {
    const { t } = useI18n();
    if (!show) return null;
    const warning = style === 'warning';
    return (
        <span
            data-external-badge
            data-style={warning ? 'warning' : 'info'}
            title={t('spamUser.external.badgeTip')}
            className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold leading-none text-foreground',
                warning ? 'border-warning/60 bg-warning/15' : 'border-info/60 bg-info/15',
                className,
            )}
        >
            <ShieldAlert className={cn('h-3 w-3', warning ? 'text-warning' : 'text-info')} aria-hidden="true" />
            <span>{t('spamUser.external.badge')}</span>
            <span className="sr-only">. {t('spamUser.external.badgeTip')}</span>
        </span>
    );
}
