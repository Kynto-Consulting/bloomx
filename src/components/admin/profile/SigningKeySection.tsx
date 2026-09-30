'use client';

import * as React from 'react';
import { AlertTriangle, KeyRound, Loader2 } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
    Badge, Card, DefinitionList, ErrorState, Field, LoadingState, adminFetch, btnOutline, btnPrimary, useAdminQuery,
} from '@/components/admin/console';
import { looksLikePrivateKey } from '@/lib/admin/profile-keys';
import type { DomainKeyStatus } from '@/lib/admin/profile-types';
import { copyText, errorCode, errorText } from './helpers';

const COMMAND = 'node scripts/gen-domain-keypair.mjs';

/**
 * Clave de firma Ed25519 del dominio. Solo se pega la clave PUBLICA (la privada se rechaza en el cliente y en el servidor).
 * "Exigir firma" es un estado DERIVADO: con clave registrada el backend exige peticiones firmadas.
 * kind "user": sin cookie de manager no se puede registrar/rotar (la API responde 409): se explica en pantalla.
 */
export function SigningKeySection({ kind, domainId, instanceSigning }: { kind: 'user' | 'manager'; domainId?: string; instanceSigning: boolean }) {
    const { t } = useI18n();
    const uid = React.useId();
    const p = (k: string, params?: Record<string, string | number>) => t(`admin.console.profile.signingKey.${k}`, params);
    const canManage = kind === 'manager' && !!domainId;
    const url = canManage ? `/api/admin/domain-key?${new URLSearchParams({ domainId: domainId! })}` : null;
    const { data, error, isLoading, mutate } = useAdminQuery<DomainKeyStatus>(url);

    const [key, setKey] = React.useState('');
    const [fieldError, setFieldError] = React.useState<string | null>(null);
    const [confirmOpen, setConfirmOpen] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [serverError, setServerError] = React.useState<string | null>(null);
    const [success, setSuccess] = React.useState<string | null>(null);
    const [copied, setCopied] = React.useState(false);

    const registered = data?.registered === true;

    const onSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setSuccess(null);
        setServerError(null);
        const value = key.trim();
        if (!value) return setFieldError(p('keyRequired'));
        if (looksLikePrivateKey(value)) {
            setKey(''); // no se conserva en memoria de la pantalla
            return setFieldError(p('privateRejected'));
        }
        setFieldError(null);
        setConfirmOpen(true);
    };

    const submit = async () => {
        setBusy(true);
        try {
            const res = await adminFetch<DomainKeyStatus>('/api/admin/domain-key', {
                method: 'POST',
                body: { domainId, signingPublicKey: key.trim() },
            });
            setKey('');
            setSuccess(res.fingerprint ? p('successRegistered', { fingerprint: res.fingerprint }) : p('successNoFingerprint'));
            await mutate();
        } catch (err) {
            if (errorCode(err) === 'private_key_rejected') setKey('');
            setServerError(errorText(t, err, 'signingKey'));
        } finally {
            setBusy(false);
            setConfirmOpen(false);
        }
    };

    const copyCommand = async () => {
        if (await copyText(COMMAND)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <Card title={p('title')} description={p('description')} bodyClassName="space-y-5">
            {kind === 'user' && <p role="note" className="rounded-lg border border-info/30 bg-info/10 p-3 text-sm text-info">{p('managerOnly')}</p>}
            {kind === 'manager' && !domainId && <p role="alert" className="text-sm text-destructive">{p('noDomain')}</p>}
            {canManage && isLoading && !data && <LoadingState />}
            {canManage && error && !data && <ErrorState message={`${p('loadFailed')} ${errorText(t, error, 'signingKey')}`} onRetry={() => void mutate()} />}

            <DefinitionList
                items={[
                    ...(canManage && data ? [
                        { label: p('registered'), value: <Badge tone={registered ? 'success' : 'warning'}><KeyRound className="h-3 w-3" aria-hidden="true" />{registered ? p('registered') : p('notRegistered')}</Badge> },
                        { label: p('fingerprint'), value: data.fingerprint ? <code className="break-all font-mono text-xs">{data.fingerprint}</code> : p('noFingerprint') },
                        { label: p('requireSignature'), value: <Badge tone={registered ? 'success' : 'neutral'}>{registered ? p('requireOn') : p('requireOff')}</Badge> },
                    ] : []),
                    { label: p('instanceSigning'), value: <Badge tone={instanceSigning ? 'success' : 'warning'}>{instanceSigning ? p('instanceSigningOn') : p('instanceSigningOff')}</Badge> },
                ]}
            />
            {canManage && data && <p className="text-xs text-muted-foreground">{p('requireExplain')}</p>}

            {registered && !instanceSigning && (
                <div role="alert" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <div><p className="font-medium">{p('mismatchTitle')}</p><p>{p('mismatchBody')}</p></div>
                </div>
            )}

            <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-4">
                <h3 className="text-sm font-semibold text-foreground">{p('guideTitle')}</h3>
                <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                    <li>
                        {p('guideStep1')}
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                            <code className="break-all rounded bg-background px-2 py-1 font-mono text-xs text-foreground">{COMMAND}</code>
                            <button type="button" className={btnOutline} onClick={copyCommand}>{copied ? p('commandCopied') : p('copyCommand')}</button>
                        </div>
                    </li>
                    <li>{p('guideStep2')}</li>
                    <li>{p('guideStep3')}</li>
                    <li>{p('guideStep4')}</li>
                </ol>
                <p className="text-xs text-warning">{p('riskBody')}</p>
            </div>

            {canManage && (
                <form onSubmit={onSubmit} noValidate className="max-w-2xl space-y-3">
                    <h3 className="text-sm font-semibold text-foreground">{p('formTitle')}</h3>
                    <Field label={p('keyLabel')} htmlFor={`${uid}-key`} hint={p('keyHint')} error={fieldError}>
                        <textarea
                            id={`${uid}-key`}
                            rows={4}
                            value={key}
                            onChange={(e) => setKey(e.target.value)}
                            placeholder={p('keyPlaceholder')}
                            spellCheck={false}
                            autoComplete="off"
                            aria-invalid={!!fieldError}
                            aria-describedby={fieldError ? `${uid}-key-err` : `${uid}-key-hint`}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
                        />
                    </Field>
                    <button type="submit" className={btnPrimary} disabled={busy}>
                        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                        {busy ? p('working') : registered ? p('rotate') : p('register')}
                    </button>
                </form>
            )}

            <div aria-live="polite">
                {serverError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{serverError}</p>}
                {success && !serverError && <p role="status" className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">{success}</p>}
            </div>

            <ConfirmDialog
                open={confirmOpen}
                title={registered ? p('confirmRotateTitle') : p('confirmRegisterTitle')}
                description={registered ? p('confirmRotateBody') : p('confirmRegisterBody')}
                confirmLabel={registered ? p('confirmRotate') : p('confirmRegister')}
                cancelLabel={t('admin.console.common.cancel')}
                destructive={registered}
                busy={busy}
                onConfirm={submit}
                onCancel={() => setConfirmOpen(false)}
            />
        </Card>
    );
}
