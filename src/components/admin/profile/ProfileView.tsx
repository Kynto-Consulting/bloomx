'use client';

import * as React from 'react';
import Link from 'next/link';
import { useI18n } from '@/components/I18nProvider';
import {
    Badge, Card, ErrorState, btnOutline, LoadingState, PageHeader, formatDateTime, initials, useAdminQuery, useConsole,
} from '@/components/admin/console';
import type { ProfileData } from '@/lib/admin/profile-types';
import { errorText } from './helpers';
import { PasswordSection } from './PasswordSection';
import { MfaSection } from './MfaSection';
import { SessionsSection } from './SessionsSection';
import { SigningKeySection } from './SigningKeySection';
import { PreferencesSection } from './PreferencesSection';
import { PrivilegedSessionCard } from '@/components/admin/permissions/PrivilegedSessionCard';

/** Hace scroll y foco a la seccion `id` (ancla). Seguro en jsdom. */
export function focusSection(id: string): boolean {
    const el = document.getElementById(id);
    if (!el) return false;
    el.scrollIntoView?.({ block: 'start' });
    el.focus?.({ preventScroll: true });
    return true;
}

function Section({ id, children }: { id: string; children: React.ReactNode }) {
    return (
        <div id={id} tabIndex={-1} className="scroll-mt-20 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {children}
        </div>
    );
}

export function ProfileView() {
    const { t, intlLocale } = useI18n();
    const { me: consoleMe, domain } = useConsole();
    const { data, error, isLoading, mutate } = useAdminQuery<ProfileData>('/api/admin/profile');
    const [active, setActive] = React.useState('');
    const p = (k: string) => t(`admin.console.profile.${k}`);

    const kind = data?.me.kind ?? consoleMe?.kind ?? 'user';
    const isUser = kind === 'user';

    // Respeta #ancla al abrir (y al cambiar el hash): scroll + foco cuando la pagina ya tiene las secciones.
    React.useEffect(() => {
        if (!data) return;
        const go = () => {
            const id = decodeURIComponent(window.location.hash.replace(/^#/, ''));
            if (id && focusSection(id)) setActive(id);
        };
        go();
        window.addEventListener('hashchange', go);
        return () => window.removeEventListener('hashchange', go);
    }, [data]);

    const nav = isUser
        ? [
            { id: 'password', label: p('nav.password') },
            { id: 'mfa', label: p('nav.mfa') },
            { id: 'sessions', label: p('nav.sessions') },
            { id: 'signing-key', label: p('nav.signingKey') },
            { id: 'preferences', label: p('nav.preferences') },
        ]
        : [
            { id: 'password', label: p('nav.credentials') },
            { id: 'signing-key', label: p('nav.signingKey') },
            { id: 'preferences', label: p('nav.preferences') },
        ];

    const go = (e: React.MouseEvent, id: string) => {
        e.preventDefault();
        try { window.history.pushState(null, '', `#${id}`); } catch { /* sin historial */ }
        if (focusSection(id)) setActive(id);
    };

    if (isLoading && !data) return <><PageHeader title={p('title')} /><LoadingState /></>;
    if (error && !data) {
        return <><PageHeader title={p('title')} /><ErrorState message={`${p('loadFailed')} ${errorText(t, error, 'profile')}`} onRetry={() => void mutate()} /></>;
    }
    if (!data) return null;

    const me = data.me;
    const displayName = me.name || me.email || p('header.noName');
    const domainId = domain.id ?? undefined;

    return (
        <div className="space-y-6">
            <PageHeader title={p('title')} description={p('description')} />

            <Card bodyClassName="flex flex-wrap items-center gap-4">
                {me.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={me.avatar} alt="" width={56} height={56} className="h-14 w-14 rounded-full border border-border object-cover" />
                ) : (
                    <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">{initials(me.name, me.email)}</span>
                )}
                <div className="min-w-0 flex-1 space-y-1">
                    <p className="break-words text-lg font-semibold text-foreground">{displayName}</p>
                    {me.email && <p className="break-all text-sm text-muted-foreground">{me.email}</p>}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Badge tone="info">{isUser ? p('header.kindUser') : p('header.kindManager')}</Badge>
                        <Badge tone="neutral" title={p('header.roleHelp')}>{p('header.role')}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{p('header.roleHelp')}</p>
                </div>
                {isUser && (
                    <p className="text-sm text-muted-foreground">
                        {p('header.lastAccess')}: <span className="text-foreground">{me.lastLoginAt ? formatDateTime(me.lastLoginAt, intlLocale) : t('admin.console.common.never')}</span>
                    </p>
                )}
            </Card>

            <nav aria-label={p('nav.label')}>
                <ul className="flex flex-wrap gap-2">
                    {nav.map((n) => (
                        <li key={n.id}>
                            <a
                                href={`#${n.id}`}
                                onClick={(e) => go(e, n.id)}
                                aria-current={active === n.id ? 'location' : undefined}
                                className={`inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active === n.id ? 'border-primary bg-accent text-accent-foreground' : 'border-border text-foreground hover:bg-accent/50'}`}
                            >
                                {n.label}
                            </a>
                        </li>
                    ))}
                </ul>
            </nav>

            {isUser ? (
                <>
                    <Section id="password"><PasswordSection mustChange={me.mustChangePassword} /></Section>
                    <Section id="mfa">{data.mfa && <MfaSection mfa={data.mfa} onChanged={() => void mutate()} />}</Section>
                    <Section id="sessions"><SessionsSection onChanged={() => void mutate()} /></Section>
                </>
            ) : (
                <Section id="password">
                    <Card title={p('managed.title')}>
                        {/* Anclas de compatibilidad (#mfa, #sessions) para la busqueda global. */}
                        <span id="mfa" tabIndex={-1} />
                        <span id="sessions" tabIndex={-1} />
                        <p className="text-sm text-foreground">{p('managed.body')}</p>
                        <p className="mt-2 text-sm text-muted-foreground">{p('managed.hint')}</p>
                    </Card>
                </Section>
            )}

            <Section id="signing-key">
                <SigningKeySection kind={kind} domainId={domainId} instanceSigning={data.instanceSigning} />
            </Section>
            <Section id="preferences"><PreferencesSection /></Section>
            <Section id="privileged-session"><PrivilegedSessionCard /></Section>
            <Section id="command-console">
                <Card title={t('admin.console.cli.linkTitle')} bodyClassName="flex flex-wrap items-center justify-between gap-3">
                    <p className="max-w-2xl text-sm text-muted-foreground">{t('admin.console.cli.linkText')}</p>
                    <Link href="/admin/profile/console" className={btnOutline}>{t('admin.console.cli.linkButton')}</Link>
                </Card>
            </Section>
        </div>
    );
}
