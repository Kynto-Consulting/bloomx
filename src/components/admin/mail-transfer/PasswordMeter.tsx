'use client';

import * as React from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { checkPassword } from '@/lib/mail-transfer/password-policy';
import { cn } from '@/lib/utils';

/**
 * Medidor de fortaleza + lista de requisitos de la politica (12+ caracteres, no comun, <= 72 bytes).
 * No depende solo del color: texto (Debil / Aceptable / Fuerte), iconos y barra con role="meter".
 */
export function PasswordMeter({ password, email, id }: { password: string; email?: string; id: string }) {
    const { t } = useI18n();
    const r = checkPassword(password, email);
    const label = !password ? '' : r.score === 3 ? t('admin.console.transfer.missing.meterStrong') : r.score === 2 || r.score === 1 ? t('admin.console.transfer.missing.meterOk') : t('admin.console.transfer.missing.meterWeak');
    const tone = r.score === 3 ? 'bg-success' : r.score >= 1 ? 'bg-warning' : 'bg-destructive';
    const rules: Array<[boolean, string]> = [
        [!r.issues.includes('length'), 'admin.console.transfer.missing.policyLength'],
        [!r.issues.includes('common') && !r.issues.includes('repeated'), 'admin.console.transfer.missing.policyCommon'],
        [!r.issues.includes('bytes'), 'admin.console.transfer.missing.policyBytes'],
    ];
    return (
        <div id={id} className="mt-2 space-y-2">
            <div className="flex items-center gap-3">
                <div
                    role="meter"
                    aria-label={t('admin.console.transfer.missing.meterLabel')}
                    aria-valuemin={0}
                    aria-valuemax={3}
                    aria-valuenow={password ? r.score : 0}
                    aria-valuetext={label || undefined}
                    className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
                >
                    <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${password ? Math.max(8, (r.score / 3) * 100) : 0}%` }} />
                </div>
                <span aria-live="polite" className="min-w-[5.5rem] text-xs font-medium text-muted-foreground">{label}</span>
            </div>
            <ul className="space-y-0.5 text-xs text-muted-foreground">
                {rules.map(([ok, key]) => (
                    <li key={key} className="flex items-center gap-1.5">
                        {ok && password ? <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" /> : <Circle className="h-3.5 w-3.5" aria-hidden="true" />}
                        <span>{t(key)}</span>
                        <span className="sr-only">{ok && password ? ' (ok)' : ''}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
