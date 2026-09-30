'use client';

import { useId, useState } from 'react';
import { ChevronDown, ChevronUp, ShieldCheck, ShieldX, UserX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/I18nProvider';
import { mailBus } from '@/components/mail/mail-bus';
import { domainOf } from '@/lib/spam/text';
import { senderAddressOf } from './external-display';
import { blockSender, OPEN_SPAM_SETTINGS } from './spam-api';
import type { ExplainState } from './useSpamExplain';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const BTN = `inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60 ${FOCUS}`;

export interface SpamWhyBannerProps {
    emailId: string;
    from: string;
    folder?: string | null;
    explain: ExplainState;
    /** Accion existente del lector "No es spam" (mueve a la bandeja; el servidor aprende al mover). */
    onNotSpam?: (() => void) | null;
    className?: string;
}

export const SPOOF_SIGNAL = 'imp.allow_spoof';
const fmtPoints = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n * 10) / 10)}`;

/** ¿Hay que mostrar el "Por que"? Carpeta spam o decision warned/spam con veredicto guardado. */
export function shouldShowWhy(folder: string | null | undefined, explain: ExplainState): boolean {
    if (explain.status !== 'ready' || !explain.data.scored) return false;
    const d = explain.data.decision;
    return folder === 'spam' || d === 'warned' || d === 'spam';
}

/**
 * Banner "Por que" del lector: motivos (es/en segun la app) con sus puntos, puntuacion y umbral, "No es spam" y bloquear remitente/dominio.
 * Colapsable (aria-expanded). Sin veredicto (scored:false, error o cargando) no muestra nada.
 */
export function SpamWhyBanner({ emailId, from, folder, explain, onNotSpam, className }: SpamWhyBannerProps) {
    const { t, locale } = useI18n();
    const uid = useId();
    const [open, setOpen] = useState(folder === 'spam');
    const [busy, setBusy] = useState<null | 'sender' | 'domain'>(null);
    const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
    if (!shouldShowWhy(folder, explain) || explain.status !== 'ready') return null;

    const d = explain.data;
    const lang = locale === 'en' ? 'en' : 'es';
    const address = senderAddressOf(from);
    const domain = domainOf(address);
    const signals = [...(d.signals ?? [])].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
    const spoof = signals.some((s) => s.id === SPOOF_SIGNAL);
    const decisionLabel = d.decision === 'spam' || folder === 'spam' ? t('spamUser.why.decisionSpam') : d.decision === 'warned' ? t('spamUser.why.decisionWarned') : t('spamUser.why.decisionDelivered');
    const Icon = d.decision === 'delivered' && folder !== 'spam' ? ShieldCheck : ShieldX;
    const listId = `${uid}-list`;
    const titleId = `${uid}-title`;

    const block = async (target: 'sender' | 'domain') => {
        setBusy(target);
        setNotice(null);
        const r = await blockSender(emailId, target);
        setBusy(null);
        if (!r.ok) { setNotice({ kind: 'error', text: t('spamUser.why.blockFailed') }); return; }
        setNotice({ kind: 'ok', text: t('spamUser.why.blockedOk', { value: String(r.data?.value || (target === 'sender' ? address : domain)) }) });
        // El servidor movio el correo a spam: la lista abierta lo quita al instante.
        if (folder !== 'spam') mailBus.emit({ type: 'remove', ids: [emailId] });
    };

    return (
        <section
            role="region"
            aria-labelledby={titleId}
            data-spam-why
            data-decision={d.decision}
            className={cn('mb-3 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-sm text-foreground', className)}
        >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Icon className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                <p id={titleId} className="font-semibold">{t('spamUser.why.title')}: <span data-why-decision>{decisionLabel}</span></p>
                <span data-why-score className="text-xs text-muted-foreground">{t('spamUser.why.score', { score: d.score ?? '—', threshold: d.threshold ?? '—' })}</span>
                <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={listId}
                    onClick={() => setOpen((v) => !v)}
                    className={cn('ml-auto inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-link hover:text-link-hover hover:underline', FOCUS)}
                >
                    {open ? t('spamUser.why.hide') : t('spamUser.why.show')}
                    {open ? <ChevronUp className="h-3 w-3" aria-hidden="true" /> : <ChevronDown className="h-3 w-3" aria-hidden="true" />}
                </button>
            </div>

            <div id={listId} hidden={!open} className="mt-2 space-y-2">
                {spoof && (
                    <p role="note" data-why-spoof className="flex items-start gap-2 rounded-md border border-destructive/60 bg-background px-2 py-1.5 text-xs font-semibold">
                        <UserX className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                        <span>{t('spamUser.why.spoof')}</span>
                    </p>
                )}
                {d.allowed && <p className="text-xs text-muted-foreground">{t('spamUser.why.allowed')}</p>}
                {signals.length > 0 ? (
                    <ul aria-label={t('spamUser.why.reasons')} className="space-y-1 text-xs">
                        {signals.map((s, i) => (
                            <li key={`${s.id}-${i}`} data-signal={s.id} className="flex items-start gap-2">
                                <span className="w-16 shrink-0 font-mono font-semibold tabular-nums" aria-label={t('spamUser.why.points', { n: fmtPoints(s.weight) })}>{fmtPoints(s.weight)}</span>
                                <span className="min-w-0 break-words">{(lang === 'en' ? s.en : s.es) || s.id}</span>
                            </li>
                        ))}
                    </ul>
                ) : <p className="text-xs text-muted-foreground">{t('spamUser.why.noReasons')}</p>}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
                {onNotSpam && folder === 'spam' && <button type="button" data-why-notspam onClick={onNotSpam} className={BTN}>{t('spamUser.why.notSpam')}</button>}
                {address && <button type="button" data-why-block="sender" disabled={busy !== null} onClick={() => void block('sender')} className={BTN}>{t('spamUser.why.blockSender')}</button>}
                {domain && <button type="button" data-why-block="domain" disabled={busy !== null} onClick={() => void block('domain')} className={BTN}>{t('spamUser.why.blockDomain')}</button>}
                <button type="button" onClick={OPEN_SPAM_SETTINGS} className={cn('rounded text-xs font-medium text-link underline-offset-2 hover:text-link-hover hover:underline', FOCUS)}>{t('spamUser.why.manageLists')}</button>
            </div>
            {notice && <p role={notice.kind === 'error' ? 'alert' : 'status'} data-why-notice className={cn('mt-2 text-xs', notice.kind === 'error' ? 'text-destructive' : 'text-foreground')}>{notice.text}</p>}
        </section>
    );
}
