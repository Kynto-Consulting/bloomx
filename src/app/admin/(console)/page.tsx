'use client';

import Link from 'next/link';
import { Activity, AlertTriangle, CalendarClock, Database, HardDrive, Inbox, Mail, MailWarning, Puzzle, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import {
    Badge, Card, ErrorState, PageHeader, StatCard, apiErrorKey, btnOutline, formatBytes, formatDateTime, formatNumber, initials, useAdminQuery, useConsole,
} from '@/components/admin/console';
import { LegacyModeBanner } from '@/components/admin/LegacyModeBanner';
import type { OverviewData } from '@/lib/admin/overview-store';

/** Resumen de la consola: tarjetas utiles (usuarios, correo, cola de Elixir, almacenamiento, extensiones, MFA) y aviso de modo heredado. */
export default function OverviewPage() {
    const { t, intlLocale } = useI18n();
    const { domain } = useConsole();
    const { data, error, isLoading, mutate } = useAdminQuery<OverviewData>('/api/admin/overview', { refreshInterval: 120_000 });
    const nf = (n: number | undefined) => formatNumber(n ?? 0, intlLocale);
    const c = (k: string, p?: Record<string, string | number>) => t(`admin.console.overview.cards.${k}`, p);
    const d = data;
    const loading = isLoading && !d;

    return (
        <div className="mx-auto max-w-7xl">
            <PageHeader
                title={t('admin.console.overview.title')}
                description={t('admin.console.overview.subtitle', { domain: domain.displayName })}
                actions={d ? <span className="text-xs text-muted-foreground">{t('admin.console.overview.updated', { when: formatDateTime(d.generatedAt, intlLocale) })}</span> : undefined}
            />

            <LegacyModeBanner domainId={domain.id} className="mb-6" />

            {error && !d ? (
                <ErrorState message={`${t('admin.console.overview.loadFailed')} ${t(apiErrorKey(error))}`} onRetry={() => void mutate()} />
            ) : (
                <>
                    <section aria-label={t('admin.console.overview.title')} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <StatCard
                            label={c('users')} icon={<Users className="h-4 w-4" />} loading={loading} href="/admin/users"
                            value={nf(d?.users.total)} hint={c('usersHint', { active: nf(d?.users.active30d), disabled: nf(d?.users.disabled) })}
                        />
                        <StatCard label={c('signups')} icon={<UserPlus className="h-4 w-4" />} loading={loading} value={nf(d?.users.new7d)} hint={c('signupsHint')} />
                        <StatCard label={c('sent')} icon={<Mail className="h-4 w-4" />} loading={loading} href="/admin/mail" value={nf(d?.mail.sent24h)} />
                        <StatCard label={c('received')} icon={<Inbox className="h-4 w-4" />} loading={loading} href="/admin/mail" value={nf(d?.mail.received24h)} />
                        <StatCard
                            label={c('bounces')} icon={<MailWarning className="h-4 w-4" />} loading={loading} href="/admin/mail#suppression"
                            tone={d && d.mail.bounces7d + d.mail.complaints7d > 0 ? 'warning' : 'neutral'}
                            value={nf((d?.mail.bounces7d ?? 0) + (d?.mail.complaints7d ?? 0))}
                            hint={c('bouncesHint', { bounces: nf(d?.mail.bounces7d), complaints: nf(d?.mail.complaints7d) })}
                        />
                        <StatCard
                            label={c('elixir')} icon={<Activity className="h-4 w-4" />} loading={loading}
                            value={d?.elixir.available ? nf(d.elixir.pendingRows) : '—'}
                            hint={d?.elixir.available ? c('elixirHint', { running: nf(d.elixir.running), pending: nf(d.elixir.pendingRows) }) : c('elixirNA')}
                        />
                        <StatCard
                            label={c('storage')} icon={<HardDrive className="h-4 w-4" />} loading={loading} href="/admin/retention"
                            value={formatBytes(d?.storage.attachmentBytes, intlLocale)} hint={c('storageHint', { count: nf(d?.storage.attachmentCount), emails: nf(d?.storage.emailCount) })}
                        />
                        <StatCard
                            label={c('extErrors')} icon={<Puzzle className="h-4 w-4" />} loading={loading} href="/admin/extensions"
                            tone={d && d.extensions.errors24h > 0 ? 'danger' : 'neutral'}
                            value={nf(d?.extensions.errors24h)} hint={d && d.extensions.errors24h === 0 ? c('extErrorsNone') : c('extErrorsHint')}
                        />
                        <StatCard
                            label={c('mfa')} icon={<ShieldCheck className="h-4 w-4" />} loading={loading} href="/admin/security"
                            tone={d && d.adminMfa.available && d.adminMfa.total > 0 && d.adminMfa.withMfa < d.adminMfa.total ? 'danger' : 'success'}
                            value={d?.adminMfa.available ? `${nf(d.adminMfa.withMfa)}/${nf(d.adminMfa.total)}` : c('mfaNA')}
                            hint={d?.adminMfa.missing.length ? c('mfaMissing', { list: d.adminMfa.missing.join(', ') }) : c('mfaHint', { with: nf(d?.adminMfa.withMfa), total: nf(d?.adminMfa.total) })}
                        />
                        <StatCard label={c('scheduled')} icon={<CalendarClock className="h-4 w-4" />} loading={loading} href="/admin/mail" value={nf(d?.mail.scheduledPending)} hint={c('scheduledHint')} />
                    </section>

                    <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
                        <Card title={t('admin.console.overview.recent.title')} className="lg:col-span-2" actions={<Link href="/admin/users" className={btnOutline}>{t('admin.console.overview.recent.viewAll')}</Link>}>
                            {d && d.users.recent.length > 0 ? (
                                <ul className="divide-y divide-border/60">
                                    {d.users.recent.map((u) => (
                                        <li key={u.id} className="flex items-center gap-3 py-2.5">
                                            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">{initials(u.name, u.email)}</span>
                                            <div className="min-w-0 flex-1">
                                                <Link href={`/admin/users?open=${encodeURIComponent(u.id)}`} className="block truncate text-sm font-medium text-foreground hover:underline">{u.name || t('admin.console.overview.recent.unnamed')}</Link>
                                                <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                                            </div>
                                            <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(u.createdAt, intlLocale)}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-muted-foreground">{isLoading ? t('admin.console.common.loading') : t('admin.console.overview.recent.empty')}</p>
                            )}
                        </Card>
                        <Card title={t('admin.console.overview.shortcuts.title')}>
                            <ul className="space-y-2 text-sm">
                                {[
                                    { href: '/admin/users?create=1', label: 'createUser', icon: UserPlus },
                                    { href: '/admin/mail#dns', label: 'dns', icon: Mail },
                                    { href: '/admin/audit', label: 'audit', icon: Database },
                                    { href: '/admin/extensions', label: 'extensions', icon: AlertTriangle },
                                ].map((s) => (
                                    <li key={s.href}>
                                        <Link href={s.href} className="flex items-center gap-2 rounded-md px-2 py-2 text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                            <s.icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                                            {t(`admin.console.overview.shortcuts.${s.label}`)}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                            {d && d.mail.bounces7d + d.mail.complaints7d > 0 && (
                                <div className="mt-3"><Badge tone="warning">{c('bounces')}</Badge></div>
                            )}
                        </Card>
                    </div>
                </>
            )}
        </div>
    );
}
