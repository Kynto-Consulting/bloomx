'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ApiError, Badge, Card, DefinitionList, Field, adminFetch, btnDangerOutline, btnPrimary, formatDateTime, inputClass, useAdminQuery, useConsole } from '@/components/admin/console';
import { useStepUp } from './useStepUp';

interface Status {
    active: { kind: 'web' | 'cli'; ip: string | null; device: string; since: string | null; lastSeenAt: string | null; refShort: string; expiresIdleAt: string | null; expiresAbsoluteAt: string | null } | null;
    locked: { at: string | null; replacements: number } | null;
    policy: { idleMinutes: number; lockThreshold: number; lockWindowMinutes: number; absoluteHours: number };
    limits: { idleMinutes: { min: number; max: number }; lockThreshold: { min: number; max: number }; lockWindowMinutes: { min: number; max: number } };
}

/**
 * La sesion privilegiada UNICA de la cuenta (consola web o CLI): donde y desde cuando, cuando caduca, boton para cerrarla y, para el
 * superadmin, la politica de la instancia (inactividad, umbral y ventana del bloqueo por pelea de sesiones; step-up con MFA).
 */
export function PrivilegedSessionCard() {
    const { t, intlLocale } = useI18n();
    const { me } = useConsole();
    const uid = React.useId();
    const { data, mutate } = useAdminQuery<Status>('/api/admin/privileged-session');
    const { guard, dialog } = useStepUp();
    const [confirmClose, setConfirmClose] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
    const [draft, setDraft] = React.useState<{ idle: string; threshold: string; window: string } | null>(null);
    const p = (k: string, v?: Record<string, string | number>) => t(`admin.console.perms.session.${k}`, v);
    const fmt = (iso: string | null | undefined) => formatDateTime(iso, intlLocale);
    if (!data) return null;
    const a = data.active;
    const policy = draft ?? { idle: String(data.policy.idleMinutes), threshold: String(data.policy.lockThreshold), window: String(data.policy.lockWindowMinutes) };

    const close = async () => {
        setConfirmClose(false);
        setBusy(true);
        try {
            await adminFetch('/api/admin/privileged-session', { method: 'DELETE' });
            setMsg({ ok: true, text: p('closed') });
            void mutate();
        } catch { setMsg({ ok: false, text: t('admin.console.perms.errors.generic') }); } finally { setBusy(false); }
    };

    const savePolicy = () => guard(async () => {
        try {
            await adminFetch('/api/admin/privileged-session', { method: 'PUT', body: { idleMinutes: Number(policy.idle), lockThreshold: Number(policy.threshold), lockWindowMinutes: Number(policy.window) } });
            setMsg({ ok: true, text: p('policy.saved') });
            setDraft(null);
            void mutate();
        } catch (e) {
            if (e instanceof ApiError && e.code === 'reauth_required') throw e;
            setMsg({ ok: false, text: t('admin.console.perms.errors.generic') });
        }
    });

    return (
        <Card title={p('title')} description={p('description')} headingLevel={2}>
            <div className="space-y-4">
                {data.locked && (
                    <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                        <p className="font-medium">{p('lockedTitle')}</p>
                        <p>{p('lockedBody', { count: data.locked.replacements })}</p>
                    </div>
                )}
                {a ? (
                    <DefinitionList items={[
                        { label: p('kind'), value: <Badge tone="info">{a.kind === 'cli' ? p('kindCli') : p('kindWeb')}</Badge> },
                        { label: p('device'), value: a.device },
                        { label: p('ip'), value: a.ip ?? '-' },
                        { label: p('since'), value: fmt(a.since) },
                        { label: p('lastActivity'), value: fmt(a.lastSeenAt) },
                        { label: p('idleExpires'), value: fmt(a.expiresIdleAt) },
                        { label: p('absoluteExpires'), value: fmt(a.expiresAbsoluteAt) },
                    ]} />
                ) : <p className="text-sm text-muted-foreground">{p('none')}</p>}
                {a && (
                    <div>
                        <button type="button" className={btnDangerOutline} disabled={busy} onClick={() => setConfirmClose(true)}>{busy ? p('closing') : p('close')}</button>
                    </div>
                )}
                {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-sm text-success' : 'text-sm text-destructive'}>{msg.text}</p>}

                {(me?.permission_level ?? 0) >= 4 && (
                    <div className="border-t border-border/60 pt-4">
                        <h3 className="text-sm font-semibold text-foreground">{p('policy.title')}</h3>
                        <div className="mt-2 grid gap-3 sm:grid-cols-3">
                            <Field label={p('policy.idle')} htmlFor={`${uid}-i`}><input id={`${uid}-i`} type="number" min={data.limits.idleMinutes.min} max={data.limits.idleMinutes.max} className={inputClass} value={policy.idle} onChange={(e) => setDraft({ ...policy, idle: e.target.value })} /></Field>
                            <Field label={p('policy.threshold')} htmlFor={`${uid}-t`}><input id={`${uid}-t`} type="number" min={data.limits.lockThreshold.min} max={data.limits.lockThreshold.max} className={inputClass} value={policy.threshold} onChange={(e) => setDraft({ ...policy, threshold: e.target.value })} /></Field>
                            <Field label={p('policy.window')} htmlFor={`${uid}-w`}><input id={`${uid}-w`} type="number" min={data.limits.lockWindowMinutes.min} max={data.limits.lockWindowMinutes.max} className={inputClass} value={policy.window} onChange={(e) => setDraft({ ...policy, window: e.target.value })} /></Field>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">{p('policy.absolute', { hours: data.policy.absoluteHours })}</p>
                        <button type="button" className={`${btnPrimary} mt-3`} disabled={!draft} onClick={() => void savePolicy()}>{p('policy.save')}</button>
                    </div>
                )}
            </div>
            <ConfirmDialog open={confirmClose} title={p('close')} description={p('closeConfirm')} confirmLabel={p('close')} cancelLabel={t('admin.console.common.cancel')} destructive onCancel={() => setConfirmClose(false)} onConfirm={() => void close()} />
            {dialog}
        </Card>
    );
}
