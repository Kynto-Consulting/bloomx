'use client';

import { useEffect, useId, useState } from 'react';
import { Info, ShieldAlert, UserX, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/I18nProvider';
import { domainOf } from '@/lib/spam/text';
import { noticeText, readDismissed, senderAddressOf, writeDismissed, type DisplayVerdict, type ExternalPolicy } from './external-display';
import { refreshExternalPolicy } from './useExternalPolicy';
import { OPEN_SPAM_SETTINGS, trustExternal } from './spam-api';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const BTN = `inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60 ${FOCUS}`;

type Phase = 'idle' | 'choosing' | 'saving' | 'error';

export interface ExternalSenderBannerProps {
    messageId: string;
    from: string;
    policy: ExternalPolicy | null;
    verdict: DisplayVerdict;
    className?: string;
}

/**
 * Aviso de remitente externo en el lector, POR MENSAJE. Estilo info|warning por tokens, texto plano de la organizacion por idioma,
 * refuerzo ante suplantacion de companero (sin opcion de confiar: no se silencia con la whitelist), aviso de primera vez,
 * cierre recordado por id de mensaje y boton "Confio en este remitente" (direccion o dominio).
 */
export function ExternalSenderBanner({ messageId, from, policy, verdict, className }: ExternalSenderBannerProps) {
    const { t, locale } = useI18n();
    const uid = useId();
    const [dismissed, setDismissed] = useState(false);
    const [phase, setPhase] = useState<Phase>('idle');
    const [scope, setScope] = useState<'email' | 'domain'>('email');
    const [trustedValue, setTrustedValue] = useState<string | null>(null);

    useEffect(() => { setDismissed(readDismissed(messageId)); setPhase('idle'); setTrustedValue(null); }, [messageId]);

    const address = senderAddressOf(from);
    const domain = domainOf(address);

    // Tras confiar: confirmacion accesible aunque la politica ya no pida aviso (el banner desaparece, el mensaje no).
    if (trustedValue) {
        return <p role="status" data-external-trusted className="mb-3 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-xs text-foreground">{t('spamUser.external.trustedOk', { value: trustedValue })}</p>;
    }
    if (!policy || !policy.enabled || !verdict.warn || dismissed) return null;

    const spoof = verdict.colleagueSpoof;
    const variant = spoof ? 'spoof' : policy.style;
    const Icon = spoof ? UserX : policy.style === 'warning' ? ShieldAlert : Info;
    const lang = locale === 'en' ? 'en' : 'es';
    const text = noticeText(policy, lang);
    const title = spoof ? t('spamUser.external.spoofTitle') : t('spamUser.external.title');
    const titleId = `${uid}-title`;
    const canTrust = !spoof && !verdict.trusted && !!address;

    const dismiss = () => { writeDismissed(messageId); setDismissed(true); };
    const confirmTrust = async () => {
        const value = scope === 'domain' ? domain : address;
        if (!value) return;
        setPhase('saving');
        const r = await trustExternal({ matchType: scope, value });
        if (!r.ok) { setPhase('error'); return; }
        setTrustedValue(value);
        await refreshExternalPolicy();
    };

    return (
        <section
            role="region"
            aria-labelledby={titleId}
            data-external-banner
            data-variant={variant}
            className={cn(
                'mb-3 rounded-lg border px-3 py-2.5 text-sm text-foreground',
                variant === 'spoof' ? 'border-destructive/60 bg-destructive/10' : variant === 'warning' ? 'border-warning/60 bg-warning/10' : 'border-info/60 bg-info/10',
                className,
            )}
        >
            <div className="flex items-start gap-2">
                <Icon aria-hidden="true" className={cn('mt-0.5 h-4 w-4 shrink-0', variant === 'spoof' ? 'text-destructive' : variant === 'warning' ? 'text-warning' : 'text-info')} />
                <div className="min-w-0 flex-1 space-y-1">
                    <p id={titleId} className="font-semibold">{title}</p>
                    {spoof && <p data-spoof-text>{t('spamUser.external.spoofText', { address })}</p>}
                    {text && <p data-notice-text className="whitespace-pre-line break-words text-xs text-muted-foreground">{text}</p>}
                    {verdict.firstTime && <p data-first-time className="text-xs font-medium">{t('spamUser.external.firstTime')}</p>}
                </div>
                <button type="button" onClick={dismiss} aria-label={t('spamUser.external.dismiss')} title={t('spamUser.external.dismiss')} className={cn('-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-muted', FOCUS)}>
                    <X className="h-4 w-4" aria-hidden="true" />
                </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
                {canTrust && phase === 'idle' && (
                    <button type="button" data-trust-open onClick={() => setPhase('choosing')} className={BTN}>{t('spamUser.external.trust')}</button>
                )}
                <button type="button" onClick={OPEN_SPAM_SETTINGS} className={cn('rounded text-xs font-medium text-link underline-offset-2 hover:text-link-hover hover:underline', FOCUS)}>{t('spamUser.external.manageLists')}</button>
            </div>

            {canTrust && phase !== 'idle' && (
                <fieldset data-trust-form className="mt-2 space-y-2 pl-6" disabled={phase === 'saving'}>
                    <legend className="text-xs font-medium">{t('spamUser.external.trustChoice')}</legend>
                    {([['email', t('spamUser.external.trustAddress', { address })], ['domain', t('spamUser.external.trustDomain', { domain })]] as const).map(([value, label]) => (
                        <label key={value} className="flex items-center gap-2 text-xs">
                            <input type="radio" name={`${uid}-scope`} value={value} checked={scope === value} onChange={() => setScope(value)} className={FOCUS} />
                            <span className="break-all">{label}</span>
                        </label>
                    ))}
                    <div className="flex flex-wrap gap-2">
                        <button type="button" data-trust-confirm onClick={() => void confirmTrust()} className={cn(BTN, 'border-primary bg-primary text-primary-foreground hover:bg-primary/90')}>
                            {phase === 'saving' ? t('spamUser.external.trusting') : t('spamUser.external.trustConfirm')}
                        </button>
                        <button type="button" data-trust-cancel onClick={() => setPhase('idle')} className={BTN}>{t('spamUser.external.trustCancel')}</button>
                    </div>
                    {phase === 'error' && <p role="alert" className="text-xs text-destructive">{t('spamUser.external.trustFailed')}</p>}
                </fieldset>
            )}
        </section>
    );
}
