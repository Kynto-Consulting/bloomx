'use client';

import * as React from 'react';
import { Loader2, ShieldCheck, ShieldOff } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { MfaEnrollForm } from '@/components/MfaPanels';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ApiError, Badge, Card, Field, adminFetch, btnDangerOutline, btnOutline, btnPrimary, inputClass } from '@/components/admin/console';
import type { ProfileMfa } from '@/lib/admin/profile-types';
import { copyText, downloadText } from './helpers';

/**
 * MFA propio (admins kind "user"). Reutiliza /api/auth/mfa/{setup,confirm,recovery-codes,disable}: no duplica logica.
 * El estado llega de GET /api/admin/profile; `onChanged` lo refresca. Los codigos nuevos se muestran UNA vez.
 */
export function MfaSection({ mfa, onChanged }: { mfa: ProfileMfa; onChanged: () => void }) {
    const { t } = useI18n();
    const uid = React.useId();
    const p = (k: string) => t(`admin.console.profile.mfa.${k}`);

    const [enrolling, setEnrolling] = React.useState(false);
    const [code, setCode] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [confirm, setConfirm] = React.useState<'regen' | 'disable' | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [notice, setNotice] = React.useState<string | null>(null);
    const [newCodes, setNewCodes] = React.useState<string[] | null>(null);

    const failText = (err: unknown, invalidKey: string) => {
        if (err instanceof ApiError && err.status === 429) return p('tooMany');
        if (err instanceof ApiError && err.status === 400) return p(invalidKey);
        return p('failed');
    };

    const regenerate = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = await adminFetch<{ recoveryCodes?: string[] }>('/api/auth/mfa/recovery-codes', { method: 'POST', body: { code } });
            setNewCodes(res.recoveryCodes ?? []);
            setCode('');
            onChanged();
        } catch (err) {
            setError(failText(err, 'invalidCode'));
        } finally {
            setBusy(false);
            setConfirm(null);
        }
    };

    const disable = async () => {
        setBusy(true);
        setError(null);
        try {
            await adminFetch('/api/auth/mfa/disable', { method: 'POST', body: { password, code } });
            setPassword('');
            setCode('');
            setNewCodes(null);
            setNotice(p('disabledOk'));
            onChanged();
        } catch (err) {
            setError(failText(err, 'invalidCredentials'));
        } finally {
            setBusy(false);
            setConfirm(null);
        }
    };

    const copy = async () => {
        if (newCodes && (await copyText(newCodes.join('\n')))) setNotice(p('copied'));
    };

    return (
        <Card title={p('title')} description={p('description')} bodyClassName="space-y-5">
            {!mfa.available && <p role="alert" className="text-sm text-destructive">{p('unavailable')}</p>}

            {mfa.available && (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{p('statusLabel')}:</span>
                    {mfa.enabled
                        ? <Badge tone="success"><ShieldCheck className="h-3 w-3" aria-hidden="true" />{p('enabled')}</Badge>
                        : <Badge tone="warning"><ShieldOff className="h-3 w-3" aria-hidden="true" />{p('disabled')}</Badge>}
                    <Badge tone={mfa.required ? 'info' : 'neutral'}>{mfa.required ? p('requiredBadge') : p('optionalBadge')}</Badge>
                </div>
            )}

            {mfa.available && !mfa.enabled && !enrolling && (
                <button type="button" className={btnPrimary} onClick={() => { setEnrolling(true); setNotice(null); }}>{p('setup')}</button>
            )}
            {enrolling && (
                <div className="max-w-md space-y-3">
                    <MfaEnrollForm onDone={() => { setEnrolling(false); setNotice(p('activated')); onChanged(); }} />
                    <button type="button" className={btnOutline} onClick={() => setEnrolling(false)}>{p('cancelSetup')}</button>
                </div>
            )}

            {mfa.enabled && (
                <>
                    <p className="text-sm text-foreground">
                        {p('recoveryLeft')}: <strong>{mfa.recoveryCodesLeft}</strong>
                        {mfa.recoveryCodesLeft <= 2 && <span className="ml-2 text-warning">{p('recoveryLow')}</span>}
                    </p>

                    <div className="max-w-md space-y-3 border-t border-border/60 pt-4">
                        <h3 className="text-sm font-semibold text-foreground">{p('regenTitle')}</h3>
                        <p className="text-sm text-muted-foreground">{p('regenHelp')}</p>
                        <Field label={p('codeLabel')} htmlFor={`${uid}-code`}>
                            <input id={`${uid}-code`} className={inputClass} inputMode="numeric" autoComplete="one-time-code" maxLength={8}
                                value={code} onChange={(e) => setCode(e.target.value)} />
                        </Field>
                        <div className="flex flex-wrap gap-2">
                            <button type="button" className={btnPrimary} disabled={busy || code.trim().length < 6} onClick={() => setConfirm('regen')}>
                                {p('regenerate')}
                            </button>
                        </div>
                    </div>

                    {newCodes && (
                        <div className="max-w-md space-y-3 rounded-lg border border-warning/30 bg-warning/10 p-4" role="group" aria-label={p('newCodesTitle')}>
                            <h3 className="text-sm font-semibold text-foreground">{p('newCodesTitle')}</h3>
                            <p className="text-sm text-muted-foreground">{p('newCodesWarning')}</p>
                            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-border bg-card p-3 font-mono text-sm text-foreground" data-testid="recovery-codes">
                                {newCodes.map((c) => <li key={c}>{c}</li>)}
                            </ul>
                            <div className="flex flex-wrap gap-2">
                                <button type="button" className={btnOutline} onClick={copy}>{p('copy')}</button>
                                <button type="button" className={btnOutline} onClick={() => downloadText('bloomx-recovery-codes.txt', newCodes.join('\n') + '\n')}>{p('download')}</button>
                                <button type="button" className={btnPrimary} onClick={() => setNewCodes(null)}>{p('dismiss')}</button>
                            </div>
                        </div>
                    )}

                    <div className="max-w-md space-y-3 border-t border-border/60 pt-4">
                        <h3 className="text-sm font-semibold text-foreground">{p('disableTitle')}</h3>
                        {mfa.required ? (
                            <>
                                <p id={`${uid}-req`} className="text-sm text-muted-foreground">{p('disableRequired')}</p>
                                <button type="button" className={btnDangerOutline} disabled aria-describedby={`${uid}-req`}>{p('disable')}</button>
                            </>
                        ) : (
                            <>
                                <p className="text-sm text-muted-foreground">{p('disableHelp')}</p>
                                <Field label={p('password')} htmlFor={`${uid}-pass`}>
                                    <input id={`${uid}-pass`} type="password" autoComplete="current-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
                                </Field>
                                <button type="button" className={btnDangerOutline} disabled={busy || !password || code.trim().length < 6} onClick={() => setConfirm('disable')}>
                                    {p('disable')}
                                </button>
                            </>
                        )}
                    </div>
                </>
            )}

            <div aria-live="polite">
                {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
                {notice && !error && <p role="status" className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">{notice}</p>}
            </div>
            {busy && <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />}

            <ConfirmDialog
                open={confirm === 'regen'}
                title={p('regenConfirmTitle')}
                description={p('regenConfirmBody')}
                confirmLabel={p('regenConfirm')}
                cancelLabel={t('admin.console.common.cancel')}
                busy={busy}
                onConfirm={regenerate}
                onCancel={() => setConfirm(null)}
            />
            <ConfirmDialog
                open={confirm === 'disable'}
                title={p('disableConfirmTitle')}
                description={p('disableConfirmBody')}
                confirmLabel={p('disableConfirm')}
                cancelLabel={t('admin.console.common.cancel')}
                destructive
                busy={busy}
                onConfirm={disable}
                onCancel={() => setConfirm(null)}
            />
        </Card>
    );
}
