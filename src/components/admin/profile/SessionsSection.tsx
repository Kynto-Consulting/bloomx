'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
    Badge, Card, ErrorState, LoadingState, adminFetch, btnDangerOutline, btnOutline, formatDateTime, useAdminQuery,
} from '@/components/admin/console';
import type { ProfileSession } from '@/lib/admin/profile-types';
import { errorText } from './helpers';

type Pending = { kind: 'one'; session: ProfileSession } | { kind: 'all' } | null;

/** Sesiones propias: lista, cerrar una (con confirmacion) y cerrar todas las demas. */
export function SessionsSection({ onChanged }: { onChanged?: () => void }) {
    const { t, intlLocale } = useI18n();
    const p = (k: string, params?: Record<string, string | number>) => t(`admin.console.profile.sessions.${k}`, params);
    const { data, error, isLoading, mutate } = useAdminQuery<{ sessions: ProfileSession[] }>('/api/admin/profile/sessions');
    const [pending, setPending] = React.useState<Pending>(null);
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState<{ type: 'ok' | 'error'; text: string } | null>(null);

    const sessions = data?.sessions ?? [];
    const others = sessions.filter((s) => !s.current);

    const run = async () => {
        if (!pending) return;
        setBusy(true);
        setMessage(null);
        try {
            if (pending.kind === 'one') {
                await adminFetch(`/api/admin/profile/sessions/${encodeURIComponent(pending.session.jti)}`, { method: 'DELETE' });
                setMessage({ type: 'ok', text: p('revokedOne') });
            } else {
                await adminFetch('/api/admin/profile/sessions', { method: 'DELETE' });
                setMessage({ type: 'ok', text: p('revokedAll') });
            }
            await mutate();
            onChanged?.();
        } catch (err) {
            setMessage({ type: 'error', text: `${p('failed')} ${errorText(t, err, 'sessions')}` });
        } finally {
            setBusy(false);
            setPending(null);
        }
    };

    const agentOf = (s: ProfileSession) => s.userAgent || p('unknownAgent');

    return (
        <Card
            title={p('title')}
            description={p('description')}
            actions={others.length > 0 ? (
                <button type="button" className={btnDangerOutline} onClick={() => setPending({ kind: 'all' })} disabled={busy}>{p('revokeAll')}</button>
            ) : undefined}
        >
            {isLoading && !data && <LoadingState />}
            {error && !data && <ErrorState message={errorText(t, error, 'sessions')} onRetry={() => void mutate()} />}
            {data && (
                <>
                    <p className="mb-3 text-sm text-muted-foreground">{p('total', { count: sessions.length })}</p>
                    <ul className="divide-y divide-border/60 rounded-lg border border-border">
                        {sessions.map((s) => (
                            <li key={s.jti} className="flex flex-wrap items-center justify-between gap-3 p-3">
                                <div className="min-w-0 flex-1 space-y-1">
                                    <p className="flex flex-wrap items-center gap-2 break-words text-sm font-medium text-foreground">
                                        {agentOf(s)}
                                        {s.current && <Badge tone="info">{p('thisSession')}</Badge>}
                                        {s.mfa && <Badge tone="success">{p('mfaOk')}</Badge>}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {p('ip')}: {s.ip || p('unknownIp')} · {p('created')}: {formatDateTime(s.createdAt, intlLocale)} · {p('expires')}: {formatDateTime(s.expiresAt, intlLocale)}
                                    </p>
                                </div>
                                {!s.current && (
                                    <button type="button" className={btnOutline} disabled={busy} aria-label={p('revokeAria', { agent: agentOf(s) })} onClick={() => setPending({ kind: 'one', session: s })}>
                                        {p('revoke')}
                                    </button>
                                )}
                            </li>
                        ))}
                        {sessions.length === 0 && <li className="p-3 text-sm text-muted-foreground">{p('empty')}</li>}
                    </ul>
                    {sessions.length > 0 && others.length === 0 && <p className="mt-3 text-sm text-muted-foreground">{p('empty')}</p>}
                </>
            )}
            <div aria-live="polite" className="mt-3">
                {message?.type === 'ok' && <p role="status" className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">{message.text}</p>}
                {message?.type === 'error' && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{message.text}</p>}
            </div>

            <ConfirmDialog
                open={pending !== null}
                title={pending?.kind === 'all' ? p('confirmAllTitle') : p('confirmOneTitle')}
                description={pending?.kind === 'all' ? p('confirmAllBody') : p('confirmOneBody')}
                confirmLabel={p('confirm')}
                cancelLabel={t('admin.console.common.cancel')}
                destructive
                busy={busy}
                onConfirm={run}
                onCancel={() => setPending(null)}
            />
        </Card>
    );
}
