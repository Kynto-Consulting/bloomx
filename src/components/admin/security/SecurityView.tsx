'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Info, KeyRound, RefreshCw, XCircle } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import {
    Badge, Card, EmptyState, ErrorState, LoadingState, StatCard, apiErrorKey, btnOutline, formatDateTime, formatNumber, useAdminQuery, type Tone,
} from '@/components/admin/console';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'info';
type CheckGroup = 'admins' | 'session' | 'config' | 'events';

interface Check { id: string; group: CheckGroup; status: CheckStatus; code: string; params?: Record<string, number> }
interface EventRow { id: string; ts: string | null; event: string; userId: string | null; ip: string | null; reason: string | null }
export interface SecurityStatusResponse {
    generatedAt: string;
    checks: Check[];
    admins: Array<{ email: string; userId: string | null; mfaEnabled: boolean | null }>;
    mfaPolicy: { enforceAdmin: boolean; requiredAll: boolean; available: boolean };
    session: { ttlSeconds: number; absoluteMaxSeconds: number };
    config: { domainSigning: boolean };
    events: { available: boolean; last24h: Record<string, number>; last7d: Record<string, number>; recent: EventRow[] };
    counts: { disabledUsers: number | null; mustChangePassword: number | null; activeSessions: number | null };
}

const STATUS_TONE: Record<CheckStatus, Tone> = { ok: 'success', warn: 'warning', fail: 'danger', info: 'info' };
const STATUS_ICON: Record<CheckStatus, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>> = {
    ok: CheckCircle2, warn: AlertTriangle, fail: XCircle, info: Info,
};
const STATUS_ICON_COLOR: Record<CheckStatus, string> = { ok: 'text-success', warn: 'text-warning', fail: 'text-destructive', info: 'text-info' };
const GROUPS: CheckGroup[] = ['admins', 'session', 'config', 'events'];

/** Clave i18n de una comprobacion: `mfa.admins_missing` -> `mfa_admins_missing`. */
const codeKey = (code: string) => code.replace(/\./g, '_');

export function SecurityView() {
    const { t, intlLocale } = useI18n();
    const { data, error, isLoading, isValidating, mutate } = useAdminQuery<SecurityStatusResponse>('/api/admin/security/status');
    const n = (v: number | null | undefined) => formatNumber(v ?? null, intlLocale);

    if (error && !data) return <ErrorState message={t(apiErrorKey(error))} onRetry={() => void mutate()} />;
    if (isLoading || !data) return <LoadingState />;

    const fails = data.checks.filter((c) => c.status === 'fail').length;
    const warns = data.checks.filter((c) => c.status === 'warn').length;
    const na = t('admin.console.account.security.unavailable');

    const translate = (key: string, fallback: string, params?: Record<string, number>) => {
        const out = t(key, params);
        return out === key ? fallback : out;
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p role="status" className="text-sm text-muted-foreground">
                    {fails === 0 && warns === 0
                        ? t('admin.console.account.security.summary.allGood')
                        : t('admin.console.account.security.summary.issues', { fail: fails, warn: warns })}
                    {' · '}
                    {t('admin.console.account.security.generatedAt', { date: formatDateTime(data.generatedAt, intlLocale) })}
                </p>
                <button type="button" className={btnOutline} onClick={() => void mutate()} disabled={isValidating}>
                    <RefreshCw className={isValidating ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden="true" />
                    {t('admin.console.account.security.refresh')}
                </button>
            </div>

            <Card title={t('admin.console.account.security.checks.title')} description={t('admin.console.account.security.checks.description')}>
                <div className="space-y-6">
                    {GROUPS.map((g) => {
                        const list = data.checks.filter((c) => c.group === g);
                        if (list.length === 0) return null;
                        return (
                            <section key={g} aria-labelledby={`sec-group-${g}`}>
                                <h3 id={`sec-group-${g}`} className="mb-2 text-sm font-semibold text-foreground">{t(`admin.console.account.security.groups.${g}`)}</h3>
                                <ul className="divide-y divide-border/60 rounded-lg border border-border">
                                    {list.map((c) => {
                                        const Icon = STATUS_ICON[c.status];
                                        const base = `admin.console.account.security.checkItems.${codeKey(c.code)}`;
                                        return (
                                            <li key={c.id} data-status={c.status} className="flex gap-3 p-3">
                                                <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${STATUS_ICON_COLOR[c.status]}`} aria-hidden="true" />
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <Badge tone={STATUS_TONE[c.status]}>{t(`admin.console.account.security.status.${c.status}`)}</Badge>
                                                        <p className="font-medium text-foreground">{translate(`${base}.title`, c.code, c.params)}</p>
                                                    </div>
                                                    <p className="mt-1 text-sm text-muted-foreground">{translate(`${base}.rec`, '', c.params)}</p>
                                                    {c.id === 'domain_signing' && (
                                                        <p className="mt-1 text-sm">
                                                            <Link href="/admin/profile#signing-key" className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2">
                                                                <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                                                                {t('admin.console.account.security.signingLink')}
                                                            </Link>
                                                        </p>
                                                    )}
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </section>
                        );
                    })}
                </div>
            </Card>

            <Card title={t('admin.console.account.security.admins.title')} description={t('admin.console.account.security.admins.description')}>
                {data.admins.length === 0 ? (
                    <EmptyState title={t('admin.console.account.security.admins.none')} description={t('admin.console.account.security.admins.noneHint')} />
                ) : (
                    <div className="overflow-x-auto rounded-lg border border-border">
                        <table className="w-full min-w-[420px] text-sm">
                            <caption className="sr-only">{t('admin.console.account.security.admins.caption')}</caption>
                            <thead className="bg-muted/60 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                <tr>
                                    <th scope="col" className="px-3 py-2">{t('admin.console.account.security.admins.email')}</th>
                                    <th scope="col" className="px-3 py-2">{t('admin.console.account.security.admins.account')}</th>
                                    <th scope="col" className="px-3 py-2">{t('admin.console.account.security.admins.mfa')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/60">
                                {data.admins.map((a) => (
                                    <tr key={a.email}>
                                        <th scope="row" className="max-w-[16rem] truncate px-3 py-2 text-left font-normal">{a.email}</th>
                                        <td className="px-3 py-2">
                                            {a.userId
                                                ? <Link href={`/admin/users?open=${encodeURIComponent(a.userId)}`} className="text-primary underline underline-offset-2">{t('admin.console.account.security.admins.viewUser')}</Link>
                                                : <span className="text-muted-foreground">{t('admin.console.account.security.admins.noAccount')}</span>}
                                        </td>
                                        <td className="px-3 py-2">
                                            {a.userId === null || a.mfaEnabled === null
                                                ? <Badge>{t('admin.console.account.security.admins.mfaUnknown')}</Badge>
                                                : a.mfaEnabled
                                                    ? <Badge tone="success">{t('admin.console.account.security.admins.mfaOn')}</Badge>
                                                    : <Badge tone="warning">{t('admin.console.account.security.admins.mfaOff')}</Badge>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                    {t(data.mfaPolicy.requiredAll ? 'admin.console.account.security.admins.policyAll' : data.mfaPolicy.enforceAdmin ? 'admin.console.account.security.admins.policyAdmins' : 'admin.console.account.security.admins.policyNone')}
                    {' '}
                    {t('admin.console.account.security.admins.envHint')}
                </p>
            </Card>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label={t('admin.console.account.security.counts.sessions')} value={data.counts.activeSessions === null ? na : n(data.counts.activeSessions)}
                    hint={t('admin.console.account.security.counts.sessionsHint', { hours: Math.round(data.session.ttlSeconds / 3600), days: Math.round(data.session.absoluteMaxSeconds / 86400) })} />
                <StatCard label={t('admin.console.account.security.counts.disabled')} value={data.counts.disabledUsers === null ? na : n(data.counts.disabledUsers)} href="/admin/users" />
                <StatCard label={t('admin.console.account.security.counts.mustChange')} value={data.counts.mustChangePassword === null ? na : n(data.counts.mustChangePassword)} href="/admin/users" />
                <StatCard label={t('admin.console.account.security.counts.mfaPolicy')}
                    value={t(data.mfaPolicy.requiredAll ? 'admin.console.account.security.counts.policyAll' : data.mfaPolicy.enforceAdmin ? 'admin.console.account.security.counts.policyAdmins' : 'admin.console.account.security.counts.policyOff')}
                    tone={!data.mfaPolicy.requiredAll && !data.mfaPolicy.enforceAdmin ? 'danger' : 'neutral'} />
            </div>

            <Card title={t('admin.console.account.security.events.title')} description={t('admin.console.account.security.events.description')}>
                {!data.events.available ? (
                    <EmptyState title={t('admin.console.account.security.events.unavailable')} />
                ) : (
                    <div className="space-y-6">
                        <div className="overflow-x-auto rounded-lg border border-border">
                            <table className="w-full min-w-[420px] text-sm">
                                <caption className="sr-only">{t('admin.console.account.security.events.countsCaption')}</caption>
                                <thead className="bg-muted/60 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    <tr>
                                        <th scope="col" className="px-3 py-2">{t('admin.console.account.security.events.type')}</th>
                                        <th scope="col" className="px-3 py-2 text-right">{t('admin.console.account.security.events.h24')}</th>
                                        <th scope="col" className="px-3 py-2 text-right">{t('admin.console.account.security.events.d7')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/60">
                                    {Object.keys(data.events.last7d).map((ev) => (
                                        <tr key={ev}>
                                            <th scope="row" className="px-3 py-2 text-left font-normal">
                                                <Link href={`/admin/audit?event=${encodeURIComponent(ev)}`} className="font-mono text-xs text-primary underline underline-offset-2">{ev}</Link>
                                            </th>
                                            <td className="px-3 py-2 text-right tabular-nums">{n(data.events.last24h[ev])}</td>
                                            <td className="px-3 py-2 text-right tabular-nums">{n(data.events.last7d[ev])}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <section aria-labelledby="sec-recent">
                            <h3 id="sec-recent" className="mb-2 text-sm font-semibold text-foreground">{t('admin.console.account.security.events.recent')}</h3>
                            {data.events.recent.length === 0 ? (
                                <p className="text-sm text-muted-foreground">{t('admin.console.account.security.events.none')}</p>
                            ) : (
                                <div className="overflow-x-auto rounded-lg border border-border">
                                    <table className="w-full min-w-[480px] text-sm">
                                        <caption className="sr-only">{t('admin.console.account.security.events.recent')}</caption>
                                        <thead className="bg-muted/60 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                            <tr>
                                                <th scope="col" className="px-3 py-2">{t('admin.console.account.security.events.date')}</th>
                                                <th scope="col" className="px-3 py-2">{t('admin.console.account.security.events.type')}</th>
                                                <th scope="col" className="px-3 py-2">{t('admin.console.account.security.events.ip')}</th>
                                                <th scope="col" className="hidden px-3 py-2 sm:table-cell">{t('admin.console.account.security.events.reason')}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/60">
                                            {data.events.recent.map((r) => (
                                                <tr key={r.id}>
                                                    <td className="whitespace-nowrap px-3 py-2">{formatDateTime(r.ts, intlLocale)}</td>
                                                    <td className="px-3 py-2">
                                                        <Link href={`/admin/audit?event=${encodeURIComponent(r.event)}`} className="font-mono text-xs text-primary underline underline-offset-2">{r.event}</Link>
                                                    </td>
                                                    <td className="px-3 py-2 font-mono text-xs">{r.ip ?? '—'}</td>
                                                    <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{r.reason ?? '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </section>
                    </div>
                )}
            </Card>
        </div>
    );
}
