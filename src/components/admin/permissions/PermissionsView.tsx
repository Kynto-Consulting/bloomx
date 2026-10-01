'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import {
    ApiError, Badge, Card, EmptyState, ErrorState, Field, LoadingState, PageHeader, adminFetch, btnOutline, btnPrimary, formatDateTime, inputClass, selectClass, useAdminQuery, useConsole,
} from '@/components/admin/console';
import { PrivilegedSessionCard } from './PrivilegedSessionCard';
import { useStepUp } from './useStepUp';

interface Account {
    email: string; name: string | null; userId: string | null; level: number; levelName: string; source: 'env' | 'console'; grantedBy: string | null; grantedAt: string | null; note: string | null; mfaEnabled: boolean | null; locked: boolean;
}
interface PermissionsData {
    levels: { permission_level: number; name: string; es: string; en: string }[];
    accounts: Account[];
    me: { email: string | null; permission_level: number; levelSource: string };
    locked: boolean;
    limits: { maxPrivilegedAccounts: number };
}
interface HistoryData { history: { id: string; email: string; previousLevel: number; newLevel: number; changedBy: string | null; changedByLevel: number | null; changedAt: string | null; ip: string | null; source: string | null; note: string | null }[] }

const TH = 'whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground';
const TD = 'px-3 py-2 align-top text-sm text-foreground';

/** Mensaje claro de un error de la API de permisos (codigos estables de permissions-core). */
export function permsErrorText(t: (k: string, p?: Record<string, string | number>) => string, e: unknown): string {
    const code = e instanceof ApiError ? e.code : undefined;
    const known = ['permissions_locked', 'invalid_level', 'cannot_target_self', 'fixed_by_env', 'cannot_modify_peer_or_higher', 'level_not_assignable', 'account_required', 'mfa_required_for_level', 'privileged_limit', 'confirm_super_required', 'no_change', 'insufficient_level', 'reauth_required', 'user_not_found'];
    return t(`admin.console.perms.errors.${code && known.includes(code) ? code : 'generic'}`);
}

/** Vista "Permisos": escala 0-4, cuentas con acceso, asignar nivel (step-up MFA), historial y la sesion privilegiada unica. */
export function PermissionsView() {
    const { t, locale, intlLocale } = useI18n();
    const { me } = useConsole();
    const uid = React.useId();
    const q = useAdminQuery<PermissionsData>('/api/admin/permissions');
    const h = useAdminQuery<HistoryData>('/api/admin/permissions/history?limit=30');
    const { guard, dialog } = useStepUp();
    const [email, setEmail] = React.useState('');
    const [level, setLevel] = React.useState('');
    const [note, setNote] = React.useState('');
    const [confirmSuper, setConfirmSuper] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
    const p = (k: string, v?: Record<string, string | number>) => t(`admin.console.perms.${k}`, v);
    const fmt = (iso: string | null | undefined) => formatDateTime(iso, intlLocale);

    if (q.isLoading && !q.data) return <><PageHeader title={p('title')} /><LoadingState /></>;
    if (q.error && !q.data) return <><PageHeader title={p('title')} /><ErrorState message={permsErrorText(t, q.error)} onRetry={() => void q.mutate()} /></>;
    if (!q.data) return null;
    const d = q.data;
    const myLevel = d.me.permission_level ?? me?.permission_level ?? 0;
    const assignable = d.levels.filter((l) => (myLevel >= 4 ? true : l.permission_level < myLevel));
    const env = (s: string) => (s === 'env' ? p('accounts.sourceEnv') : p('accounts.sourceConsole'));

    const apply = (e: React.FormEvent) => {
        e.preventDefault();
        if (busy || !email || level === '') return;
        void guard(async () => {
            setBusy(true);
            setMsg(null);
            try {
                const r = await adminFetch<{ email: string; from: number; to: number }>('/api/admin/permissions', { method: 'POST', body: { email, permission_level: Number(level), note: note || undefined, confirmSuper: confirmSuper || undefined } });
                setMsg({ ok: true, text: p('set.applied', { email: r.email, from: r.from, to: r.to }) });
                setEmail(''); setLevel(''); setNote(''); setConfirmSuper(false);
                void q.mutate(); void h.mutate();
            } catch (err) {
                if (err instanceof ApiError && err.code === 'reauth_required') throw err;
                setMsg({ ok: false, text: permsErrorText(t, err) });
            } finally { setBusy(false); }
        });
    };

    const unlock = (account: Account) => guard(async () => {
        try {
            await adminFetch('/api/admin/permissions/unlock', { method: 'POST', body: { email: account.email } });
            setMsg({ ok: true, text: p('accounts.unlocked') });
            void q.mutate();
        } catch (err) {
            if (err instanceof ApiError && err.code === 'reauth_required') throw err;
            setMsg({ ok: false, text: permsErrorText(t, err) });
        }
    });

    return (
        <div className="space-y-6">
            <PageHeader title={p('title')} description={p('description')} />

            {d.locked && (
                <div role="status" className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-foreground">
                    <p className="font-medium">{p('locked.title')}</p>
                    <p className="mt-1 text-muted-foreground">{p('locked.body')}</p>
                </div>
            )}

            <PrivilegedSessionCard />

            <Card title={p('levels.title')}>
                <div className="overflow-x-auto">
                    <table className="min-w-full">
                        <thead><tr><th scope="col" className={TH}>{p('levels.level')}</th><th scope="col" className={TH}>{p('levels.name')}</th><th scope="col" className={TH}>{p('levels.can')}</th></tr></thead>
                        <tbody className="divide-y divide-border/60">
                            {d.levels.map((l) => (
                                <tr key={l.permission_level}>
                                    <td className={TD}><Badge tone={l.permission_level === myLevel ? 'info' : 'neutral'}>{l.permission_level}</Badge></td>
                                    <td className={`${TD} font-medium`}>{l.name}</td>
                                    <td className={`${TD} text-muted-foreground`}>{locale === 'en' ? l.en : l.es}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

            <Card title={p('accounts.title')} description={p('accounts.description')}>
                {d.accounts.length === 0 ? <EmptyState title={p('accounts.empty')} /> : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full">
                            <thead>
                                <tr>
                                    {['email', 'level', 'source', 'grantedBy', 'grantedAt', 'mfa', 'locked'].map((c) => <th key={c} scope="col" className={TH}>{p(`accounts.${c}`)}</th>)}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/60">
                                {d.accounts.map((a) => (
                                    <tr key={a.email}>
                                        <td className={`${TD} break-all`}>{a.email} {a.email === d.me.email && <span className="text-xs text-muted-foreground">{p('accounts.you')}</span>}{a.name && <span className="block text-xs text-muted-foreground">{a.name}</span>}</td>
                                        <td className={TD}><Badge tone={a.level >= 3 ? 'info' : 'neutral'}>{a.level} · {a.levelName}</Badge></td>
                                        <td className={TD}><Badge tone={a.source === 'env' ? 'warning' : 'neutral'}>{env(a.source)}</Badge></td>
                                        <td className={`${TD} break-all`}>{a.grantedBy ?? '-'}</td>
                                        <td className={TD}>{fmt(a.grantedAt)}</td>
                                        <td className={TD}>{a.mfaEnabled === null ? p('accounts.mfaUnknown') : a.mfaEnabled ? <Badge tone="success">{p('accounts.mfaOn')}</Badge> : <Badge tone="danger">{p('accounts.mfaOff')}</Badge>}</td>
                                        <td className={TD}>
                                            {a.locked ? (
                                                <span className="inline-flex items-center gap-2">
                                                    <Badge tone="danger">{p('accounts.lockedYes')}</Badge>
                                                    {myLevel >= 4 && <button type="button" className={btnOutline} title={p('accounts.unlockHint')} onClick={() => void unlock(a)}>{p('accounts.unlock')}</button>}
                                                </span>
                                            ) : <Badge tone="success">{p('accounts.lockedNo')}</Badge>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {!d.locked && (
                <Card title={p('set.title')} description={p('set.description')}>
                    <form onSubmit={apply} className="grid gap-4 sm:grid-cols-2">
                        <Field label={p('set.email')} htmlFor={`${uid}-e`} required><input id={`${uid}-e`} type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required /></Field>
                        <Field label={p('set.level')} htmlFor={`${uid}-l`} required>
                            <select id={`${uid}-l`} className={selectClass} value={level} onChange={(e) => setLevel(e.target.value)} required>
                                <option value="">{p('set.pick')}</option>
                                {assignable.map((l) => <option key={l.permission_level} value={l.permission_level}>{l.permission_level} · {l.name}</option>)}
                            </select>
                        </Field>
                        <Field label={p('set.note')} htmlFor={`${uid}-n`} className="sm:col-span-2"><input id={`${uid}-n`} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
                        {level === '4' && (
                            <label className="flex items-start gap-2 text-sm text-foreground sm:col-span-2">
                                <input type="checkbox" className="mt-1" checked={confirmSuper} onChange={(e) => setConfirmSuper(e.target.checked)} />
                                <span>{p('set.confirmSuper')}</span>
                            </label>
                        )}
                        <div className="sm:col-span-2">
                            <button type="submit" className={btnPrimary} disabled={busy || !email || level === ''}>{busy ? p('set.applying') : p('set.apply')}</button>
                        </div>
                        {msg && <p role={msg.ok ? 'status' : 'alert'} className={`sm:col-span-2 text-sm ${msg.ok ? 'text-success' : 'text-destructive'}`}>{msg.text}</p>}
                    </form>
                </Card>
            )}

            <Card title={p('history.title')}>
                {!h.data || h.data.history.length === 0 ? <EmptyState title={p('history.empty')} /> : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full">
                            <thead><tr>{['when', 'email', 'change', 'by', 'ip', 'note'].map((c) => <th key={c} scope="col" className={TH}>{p(`history.${c}`)}</th>)}</tr></thead>
                            <tbody className="divide-y divide-border/60">
                                {h.data.history.map((r) => (
                                    <tr key={r.id}>
                                        <td className={TD}>{fmt(r.changedAt)}</td>
                                        <td className={`${TD} break-all`}>{r.email}</td>
                                        <td className={TD}>{r.previousLevel} → {r.newLevel}</td>
                                        <td className={`${TD} break-all`}>{r.changedBy ?? '-'}{r.changedByLevel !== null && <span className="text-xs text-muted-foreground"> (L{r.changedByLevel})</span>}</td>
                                        <td className={TD}>{r.ip ?? '-'}</td>
                                        <td className={`${TD} text-muted-foreground`}>{r.note ?? ''}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
            {dialog}
        </div>
    );
}
