'use client';

import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useI18n } from '@/components/I18nProvider';
import {
    ApiError, Badge, Card, DefinitionList, DetailDrawer, ErrorState, Field, LoadingState, StrongConfirmDialog, adminFetch, apiErrorKey,
    btnDangerOutline, btnOutline, btnPrimary, formatBytes, formatDateTime, inputClass, useAdminQuery,
} from '@/components/admin/console';
import type { UserDetail } from './types';
import { parseQuotaInput } from './quota';
import { TempPasswordBox } from './TempPasswordBox';
import { PermissionLevelControl } from '@/components/admin/permissions/PermissionLevelControl';

type Pending =
    | { kind: 'disable' | 'enable' | 'mfa' | 'sessions' | 'password' | 'force' }
    | { kind: 'session'; jti: string; createdAt: string | null };

/** Detalle de un usuario: datos, estado y rol (solo lectura), MFA, sesiones, cuentas, almacenamiento y contrasena. */
export function UserDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
    const { t, intlLocale } = useI18n();
    const uid = React.useId();
    const { data, error, isLoading, mutate } = useAdminQuery<UserDetail>(`/api/admin/users/${encodeURIComponent(id)}`);
    const [pending, setPending] = React.useState<Pending | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [actionError, setActionError] = React.useState<string | null>(null);
    const [temp, setTemp] = React.useState<string | null>(null);
    const [forceRevoke, setForceRevoke] = React.useState(false);
    const [name, setName] = React.useState<string | null>(null);
    const [quotaInput, setQuotaInput] = React.useState<string | null>(null);
    const [quotaError, setQuotaError] = React.useState<string | null>(null);

    const u = data?.user;
    const title = u ? u.name || u.email : t('admin.console.users.detail.ariaTitle');
    const fmt = (iso: string | null | undefined) => formatDateTime(iso, intlLocale);

    const explain = (err: unknown): string => {
        if (err instanceof ApiError && (err.code === 'cannot_disable_self' || err.code === 'cannot_target_self')) return t('admin.console.users.error.self');
        if (err instanceof ApiError && err.code === 'admin_state_unavailable') return t('admin.console.users.error.stateUnavailable');
        return t(apiErrorKey(err));
    };

    const run = async <T,>(request: () => Promise<T>, okMessage: string): Promise<T | undefined> => {
        setBusy(true);
        setActionError(null);
        try {
            const res = await request();
            toast.success(okMessage);
            await mutate();
            onChanged();
            setPending(null);
            return res;
        } catch (err) {
            setActionError(explain(err));
            return undefined;
        } finally {
            setBusy(false);
        }
    };

    const base = `/api/admin/users/${encodeURIComponent(id)}`;
    const confirm = () => {
        if (!pending || !u) return;
        switch (pending.kind) {
            case 'disable':
                return void run(() => adminFetch(base, { method: 'PATCH', body: { disabled: true } }), t('admin.console.users.toast.disabled'));
            case 'enable':
                return void run(() => adminFetch(base, { method: 'PATCH', body: { disabled: false } }), t('admin.console.users.toast.enabled'));
            case 'mfa':
                return void run(() => adminFetch(`${base}/mfa-reset`, { method: 'POST', body: {} }), t('admin.console.users.toast.mfaReset'));
            case 'sessions':
                return void run(() => adminFetch(`${base}/sessions`, { method: 'DELETE' }), t('admin.console.users.toast.sessionsRevoked'));
            case 'session':
                return void run(() => adminFetch(`${base}/sessions/${encodeURIComponent(pending.jti)}`, { method: 'DELETE' }), t('admin.console.users.toast.sessionRevoked'));
            case 'force':
                return void run(() => adminFetch(`${base}/force-password-change`, { method: 'POST', body: { revokeSessions: forceRevoke } }), t('admin.console.users.toast.forced'));
            case 'password':
                return void run(async () => {
                    const res = await adminFetch<{ temporaryPassword: string }>(`${base}/password`, { method: 'POST', body: { mode: 'temporary' } });
                    setTemp(res.temporaryPassword);
                    return res;
                }, t('admin.console.users.toast.passwordReset'));
        }
    };
    const cancel = () => { if (!busy) { setPending(null); setActionError(null); } };
    const ask = (p: Pending) => { setActionError(null); setForceRevoke(false); setPending(p); };

    const saveName = () =>
        run(() => adminFetch(base, { method: 'PATCH', body: { name: (name ?? u?.name ?? '').trim() } }), t('admin.console.users.toast.updated')).then(() => setName(null));

    const saveQuota = () => {
        const parsed = parseQuotaInput(quotaInput ?? (data?.quota?.userMb ?? '').toString(), data?.quota?.maxMb ?? 0);
        if (!parsed.ok) { setQuotaError(t('admin.console.users.detail.quotaInvalid', { max: data?.quota?.maxMb ?? 0 })); return; }
        setQuotaError(null);
        const isReset = parsed.value === null;
        return run(
            () => adminFetch(`${base}/quota`, { method: 'PUT', body: { mailQuotaMb: parsed.value } }),
            t(isReset ? 'admin.console.users.detail.quotaResetDone' : 'admin.console.users.detail.quotaSaved'),
        ).then(() => setQuotaInput(null));
    };
    const resetQuota = () =>
        run(() => adminFetch(`${base}/quota`, { method: 'PUT', body: { mailQuotaMb: null } }), t('admin.console.users.detail.quotaResetDone'))
            .then(() => { setQuotaInput(null); setQuotaError(null); });

    const email = u?.email ?? '';
    const d = (key: string, params?: Record<string, string | number>) => t(`admin.console.users.detail.${key}`, params);

    let dialog: React.ReactNode = null;
    if (pending && u) {
        const simple: Record<string, { title: string; body: React.ReactNode; confirm: string; destructive: boolean }> = {
            disable: { title: d('disableTitle'), body: d('disableBody', { email }), confirm: d('disable'), destructive: true },
            enable: { title: d('enableTitle'), body: d('enableBody', { email }), confirm: d('enable'), destructive: false },
            sessions: { title: d('revokeAllTitle'), body: d('revokeAllBody', { email }), confirm: d('revokeAll'), destructive: true },
            session: { title: d('revokeOneTitle'), body: d('revokeOneBody', { email }), confirm: d('revokeOne'), destructive: true },
            password: { title: d('passwordResetTitle'), body: d('passwordResetBody', { email }), confirm: d('passwordResetConfirm'), destructive: true },
            force: {
                title: d('forceTitle'),
                body: (
                    <>
                        <p>{d('forceBody', { email })}</p>
                        <label className="mt-3 flex items-center gap-2 text-foreground">
                            <input type="checkbox" checked={forceRevoke} onChange={(e) => setForceRevoke(e.target.checked)} className="h-4 w-4 rounded border-input accent-primary" />
                            {d('forceRevoke')}
                        </label>
                    </>
                ),
                confirm: d('forceConfirm'),
                destructive: false,
            },
        };
        if (pending.kind === 'mfa') {
            dialog = (
                <StrongConfirmDialog
                    open
                    title={d('mfaResetTitle')}
                    description={d('mfaResetBody', { email })}
                    phrase={email}
                    confirmLabel={d('mfaResetConfirm')}
                    cancelLabel={t('admin.console.common.cancel')}
                    busy={busy}
                    error={actionError}
                    onConfirm={confirm}
                    onCancel={cancel}
                />
            );
        } else {
            const s = simple[pending.kind];
            dialog = (
                <ConfirmDialog
                    open
                    title={s.title}
                    description={s.body}
                    confirmLabel={s.confirm}
                    cancelLabel={t('admin.console.common.cancel')}
                    destructive={s.destructive}
                    busy={busy}
                    error={actionError}
                    onConfirm={confirm}
                    onCancel={cancel}
                />
            );
        }
    }

    return (
        <>
            <DetailDrawer open onClose={onClose} title={title} subtitle={u ? u.email : undefined}>
                {isLoading && !data && <LoadingState />}
                {error && !data && <ErrorState message={error.status === 404 ? t('admin.console.common.errors.notFound') : d('loadFailed')} onRetry={() => void mutate()} />}
                {data && u && (
                    <div className="space-y-4">
                        {actionError && !pending && <p role="alert" className="text-sm text-destructive">{actionError}</p>}

                        <Card title={t('admin.console.users.detail.sections.data')} headingLevel={3}>
                            <DefinitionList
                                items={[
                                    { label: d('id'), value: <code className="break-all text-xs">{u.id}</code> },
                                    { label: d('email'), value: u.email },
                                    { label: d('created'), value: fmt(u.createdAt) },
                                    { label: d('lastLogin'), value: data.state.lastLoginAt ? fmt(data.state.lastLoginAt) : t('admin.console.users.neverLoggedIn') },
                                    { label: d('lastIp'), value: data.state.lastLoginIp || t('admin.console.common.notAvailable') },
                                ]}
                            />
                            <div className="mt-4 flex flex-wrap items-end gap-2">
                                <Field label={d('nameLabel')} htmlFor={`${uid}-name`} className="min-w-0 flex-1">
                                    <input id={`${uid}-name`} className={inputClass} maxLength={200} value={name ?? u.name ?? ''} onChange={(e) => setName(e.target.value)} />
                                </Field>
                                <button type="button" className={btnOutline} disabled={busy || name === null || name === (u.name ?? '')} onClick={() => void saveName()}>
                                    {d('saveName')}
                                </button>
                            </div>
                        </Card>

                        <Card title={t('admin.console.users.detail.sections.state')} headingLevel={3}>
                            <DefinitionList
                                items={[
                                    {
                                        label: d('status'),
                                        value: data.state.disabled
                                            ? <Badge tone="danger">{t('admin.console.users.badge.disabled')}</Badge>
                                            : <Badge tone="success">{t('admin.console.users.badge.active')}</Badge>,
                                    },
                                    { label: d('role'), value: <PermissionLevelControl email={u.email} level={u.permission_level ?? (u.isAdmin ? 4 : 0)} source={u.levelSource ?? (u.isAdmin ? 'env' : 'none')} isSelf={u.isSelf} onChanged={() => { void mutate(); onChanged(); }} /> },
                                    ...(data.state.mustChangePassword ? [{ label: d('mustChange'), value: <Badge tone="warning">{t('admin.console.common.yes')}</Badge> }] : []),
                                ]}
                            />
                            <div className="mt-4 flex flex-wrap items-center gap-2">
                                {data.state.disabled ? (
                                    <button type="button" className={btnPrimary} onClick={() => ask({ kind: 'enable' })}>{d('enable')}</button>
                                ) : (
                                    <button type="button" className={btnDangerOutline} disabled={u.isSelf} onClick={() => ask({ kind: 'disable' })}>{d('disable')}</button>
                                )}
                                {u.isSelf && <span className="text-xs text-muted-foreground">{d('selfDisableHint')}</span>}
                            </div>
                        </Card>

                        <Card id="mfa" title={t('admin.console.users.detail.sections.mfa')} headingLevel={3}>
                            <DefinitionList
                                items={[
                                    {
                                        label: d('status'),
                                        value: !data.mfa.available
                                            ? <Badge>{d('mfaUnavailable')}</Badge>
                                            : data.mfa.enabled
                                                ? <Badge tone="success">{d('mfaEnabled')}</Badge>
                                                : data.mfa.pendingEnrollment
                                                    ? <Badge tone="warning">{d('mfaPending')}</Badge>
                                                    : <Badge>{d('mfaDisabled')}</Badge>,
                                    },
                                    { label: d('mfaRequired'), value: data.mfa.required ? t('admin.console.common.yes') : d('mfaOptional') },
                                    ...(data.mfa.enabled ? [{ label: d('recoveryLeft'), value: String(data.mfa.recoveryCodesLeft) }] : []),
                                ]}
                            />
                            <div className="mt-4 flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    className={btnDangerOutline}
                                    disabled={u.isSelf || (!data.mfa.enabled && !data.mfa.pendingEnrollment)}
                                    onClick={() => ask({ kind: 'mfa' })}
                                >
                                    {d('mfaReset')}
                                </button>
                                {u.isSelf && <span className="text-xs text-muted-foreground">{d('mfaSelfHint')}</span>}
                            </div>
                        </Card>

                        <Card
                            id="sessions"
                            title={`${t('admin.console.users.detail.sections.sessions')} (${data.sessions.length})`}
                            headingLevel={3}
                            actions={
                                <button type="button" className={btnDangerOutline} disabled={u.isSelf} onClick={() => ask({ kind: 'sessions' })}>
                                    {d('revokeAll')}
                                </button>
                            }
                        >
                            {data.sessions.length === 0 ? (
                                <p className="text-sm text-muted-foreground">{d('noSessions')}</p>
                            ) : (
                                <ul className="divide-y divide-border/60">
                                    {data.sessions.map((s) => (
                                        <li key={s.jti} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
                                            <div className="min-w-0">
                                                <p className="text-foreground">
                                                    {d('sessionStarted')}: {fmt(s.createdAt)}
                                                    {s.mfa && <Badge tone="info" className="ml-2">{d('sessionMfa')}</Badge>}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {d('sessionIp')}: {s.ip || t('admin.console.common.notAvailable')} · {d('sessionExpires')}: {fmt(s.expiresAt)}
                                                </p>
                                                {s.userAgent && <p className="truncate text-xs text-muted-foreground" title={s.userAgent}>{s.userAgent}</p>}
                                            </div>
                                            <button
                                                type="button"
                                                className={btnOutline}
                                                aria-label={d('revokeOneLabel', { date: fmt(s.createdAt) })}
                                                onClick={() => ask({ kind: 'session', jti: s.jti, createdAt: s.createdAt })}
                                            >
                                                {d('revokeOne')}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Card>

                        <Card title={t('admin.console.users.detail.sections.accounts')} headingLevel={3}>
                            {data.accounts.length === 0 ? (
                                <p className="text-sm text-muted-foreground">{d('noAccounts')}</p>
                            ) : (
                                <ul className="space-y-1 text-sm">
                                    {data.accounts.map((a) => (
                                        <li key={a.id} className="flex flex-wrap items-center gap-2">
                                            <span className="font-medium capitalize text-foreground">{a.provider}</span>
                                            <Badge tone={a.hasRefreshToken ? 'success' : 'warning'}>{a.hasRefreshToken ? d('accountRefresh') : d('accountNoRefresh')}</Badge>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <Link href={`/admin/accounts?q=${encodeURIComponent(u.email)}`} className="mt-3 inline-block text-sm text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                {d('manageAccounts')}
                            </Link>
                        </Card>

                        <Card title={t('admin.console.users.detail.sections.storage')} headingLevel={3}>
                            <DefinitionList
                                items={[
                                    { label: d('storageUsed'), value: formatBytes(data.storage.attachmentBytes, intlLocale) },
                                    { label: d('storageAttachments'), value: String(data.storage.attachmentCount) },
                                    { label: d('storageEmails'), value: String(data.storage.emailCount) },
                                ]}
                            />
                            {data.storage.folders.length > 0 && (
                                <div className="mt-3">
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{d('storageFolders')}</p>
                                    <ul className="mt-1 flex flex-wrap gap-2">
                                        {data.storage.folders.map((f) => (
                                            <li key={f.folder}><Badge>{f.folder}: {f.count}</Badge></li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            <p className="mt-3 text-xs text-muted-foreground">{d('storageNote')}</p>
                        </Card>

                        <Card id="quota" title={t('admin.console.users.detail.sections.quota')} headingLevel={3}>
                            {data.quota ? (
                                <>
                                    <DefinitionList
                                        items={[
                                            {
                                                label: d('quotaEffective'),
                                                value: data.quota.effectiveMb === null ? d('quotaUnlimited') : d('quotaMb', { n: data.quota.effectiveMb }),
                                            },
                                            {
                                                label: d('quotaSource'),
                                                value: (
                                                    <Badge tone={data.quota.source === 'user' ? 'info' : 'neutral'}>
                                                        {d(data.quota.source === 'user' ? 'quotaSourceUser' : data.quota.source === 'domain' ? 'quotaSourceDomain' : data.quota.source === 'env' ? 'quotaSourceEnv' : 'quotaSourceNone')}
                                                    </Badge>
                                                ),
                                            },
                                            ...(data.quota.domainMb !== null ? [{ label: d('quotaDomainValue'), value: data.quota.domainMb === 0 ? d('quotaUnlimited') : d('quotaMb', { n: data.quota.domainMb }) }] : []),
                                            {
                                                label: d('quotaUsed'),
                                                value: data.quota.effectiveMb === null || data.quota.percent === null
                                                    ? d('quotaUsedOnly', { used: formatBytes(data.quota.usedBytes, intlLocale) })
                                                    : d('quotaUsedOf', { used: formatBytes(data.quota.usedBytes, intlLocale), limit: d('quotaMb', { n: data.quota.effectiveMb }), percent: String(data.quota.percent) }),
                                            },
                                        ]}
                                    />
                                    <div className="mt-4 flex flex-wrap items-end gap-2">
                                        <Field label={d('quotaLabel')} htmlFor={`${uid}-quota`} hint={d('quotaHelp')} error={quotaError ?? undefined} className="min-w-0 flex-1">
                                            <input
                                                id={`${uid}-quota`}
                                                className={inputClass}
                                                type="text"
                                                inputMode="numeric"
                                                autoComplete="off"
                                                aria-invalid={quotaError ? true : undefined}
                                                aria-describedby={`${uid}-quota-${quotaError ? 'err' : 'hint'}`}
                                                placeholder={data.quota.domainMb !== null ? String(data.quota.domainMb) : data.quota.envMb !== null ? String(data.quota.envMb) : ''}
                                                value={quotaInput ?? (data.quota.userMb !== null ? String(data.quota.userMb) : '')}
                                                onChange={(e) => { setQuotaInput(e.target.value); setQuotaError(null); }}
                                            />
                                        </Field>
                                        <button type="button" className={btnPrimary} disabled={busy || quotaInput === null} onClick={() => void saveQuota()}>{d('quotaSave')}</button>
                                        <button type="button" className={btnOutline} disabled={busy || data.quota.source !== 'user'} onClick={() => void resetQuota()}>{d('quotaReset')}</button>
                                    </div>
                                    <p className="mt-3 text-xs text-muted-foreground">{d('quotaNote')}</p>
                                </>
                            ) : (
                                <p className="text-sm text-muted-foreground">{d('quotaUnavailable')}</p>
                            )}
                        </Card>

                        <Card id="password" title={t('admin.console.users.detail.sections.password')} headingLevel={3}>
                            <p className="text-sm text-muted-foreground">{d('passwordHelp')}</p>
                            {temp && (
                                <div className="mt-3 space-y-2" role="status">
                                    <p className="text-sm font-medium text-foreground">{d('tempTitle')}</p>
                                    <p className="text-xs text-muted-foreground">{d('tempBody')}</p>
                                    <TempPasswordBox value={temp} label={d('tempLabel')} copyLabel={d('copy')} />
                                    <button type="button" className={btnOutline} onClick={() => setTemp(null)}>{d('dismissTemp')}</button>
                                </div>
                            )}
                            <div className="mt-4 flex flex-wrap items-center gap-2">
                                <button type="button" className={btnDangerOutline} disabled={u.isSelf} onClick={() => ask({ kind: 'password' })}>{d('passwordReset')}</button>
                                <button type="button" className={btnOutline} disabled={u.isSelf} onClick={() => ask({ kind: 'force' })}>{d('force')}</button>
                            </div>
                            {u.isSelf && <p className="mt-2 text-xs text-muted-foreground">{d('you')}</p>}
                        </Card>
                    </div>
                )}
            </DetailDrawer>
            {dialog}
        </>
    );
}
