'use client';

import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useI18n } from '@/components/I18nProvider';
import { ApiError, Badge, Card, DefinitionList, DetailDrawer, adminFetch, apiErrorKey, btnDangerOutline, btnOutline, formatDateTime } from '@/components/admin/console';
import type { AccountRow } from '@/components/admin/users/types';
import { StatusBadge } from './StatusBadge';

type Pending = 'unlink' | 'reconnect';

/** Detalle de una cuenta vinculada: estado del token (sin tokens), scopes, integraciones; desvincular o pedir reconexion. */
export function AccountDrawer({ account, onClose, onChanged }: { account: AccountRow; onClose: () => void; onChanged: () => void }) {
    const { t, intlLocale } = useI18n();
    const [pending, setPending] = React.useState<Pending | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const d = (key: string, params?: Record<string, string | number>) => t(`admin.console.users.accounts.detail.${key}`, params);
    const provider = account.provider;

    const confirm = async () => {
        if (!pending) return;
        setBusy(true);
        setError(null);
        try {
            const base = `/api/admin/accounts/${encodeURIComponent(account.id)}`;
            if (pending === 'unlink') {
                await adminFetch(base, { method: 'DELETE' });
                toast.success(d('unlinked'));
                setPending(null);
                onChanged();
                onClose();
            } else {
                await adminFetch(`${base}/reconnect`, { method: 'POST', body: { mode: 'reconnect' } });
                toast.success(d('reconnectRequested'));
                setPending(null);
                onChanged();
            }
        } catch (err) {
            setError(err instanceof ApiError && err.status === 404 ? t('admin.console.common.errors.notFound') : t(apiErrorKey(err)));
        } finally {
            setBusy(false);
        }
    };

    const dialog =
        pending === 'unlink'
            ? { title: d('unlinkTitle'), body: d('unlinkBody', { provider, email: account.userEmail }), label: d('unlinkConfirm') }
            : { title: d('reconnectTitle'), body: d('reconnectBody', { provider, email: account.userEmail }), label: d('reconnectConfirm') };

    return (
        <>
            <DetailDrawer open onClose={onClose} title={`${provider} · ${account.userName || account.userEmail}`} subtitle={account.userEmail}>
                <div className="space-y-4">
                    <Card headingLevel={3}>
                        <DefinitionList
                            items={[
                                { label: d('user'), value: account.userEmail },
                                { label: d('provider'), value: <span className="capitalize">{provider}</span> },
                                { label: d('accountId'), value: <code className="text-xs">{account.providerAccountId}</code> },
                                { label: d('status'), value: <StatusBadge status={account.status} /> },
                                { label: d('expires'), value: account.expiresAt ? formatDateTime(account.expiresAt, intlLocale) : t('admin.console.users.accounts.noExpiry') },
                                { label: d('refresh'), value: account.hasRefreshToken ? d('refreshYes') : d('refreshNo') },
                            ]}
                        />
                        <p className="mt-3 text-sm text-muted-foreground">{t(`admin.console.users.accounts.statusHelp.${account.status}`)}</p>
                    </Card>

                    <Card title={d('scopes')} headingLevel={3}>
                        {account.scopes.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{d('noScopes')}</p>
                        ) : (
                            <ul className="space-y-1">
                                {account.scopes.map((s) => <li key={s}><code className="break-all text-xs text-foreground">{s}</code></li>)}
                            </ul>
                        )}
                    </Card>

                    <Card title={d('integrations')} headingLevel={3}>
                        {account.integrations.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{t('admin.console.users.accounts.noIntegrations')}</p>
                        ) : (
                            <ul className="flex flex-wrap gap-2">
                                {account.integrations.map((i) => <li key={i}><Badge tone="info">{t(`admin.console.users.accounts.integration.${i}`)}</Badge></li>)}
                            </ul>
                        )}
                        <p className="mt-3 text-xs text-muted-foreground">{t('admin.console.users.accounts.integrationsNote')}</p>
                    </Card>

                    <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">{d('reconnectHelp')}</p>
                        <div className="flex flex-wrap items-center gap-2">
                            <button type="button" className={btnOutline} onClick={() => { setError(null); setPending('reconnect'); }}>{d('reconnect')}</button>
                            <button type="button" className={btnDangerOutline} onClick={() => { setError(null); setPending('unlink'); }}>{d('unlink')}</button>
                            <Link href={`/admin/users?open=${encodeURIComponent(account.userId)}`} className="text-sm text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                {d('viewUser')}
                            </Link>
                        </div>
                    </div>
                </div>
            </DetailDrawer>
            <ConfirmDialog
                open={pending !== null}
                title={dialog.title}
                description={dialog.body}
                confirmLabel={dialog.label}
                cancelLabel={t('admin.console.common.cancel')}
                destructive
                busy={busy}
                error={error}
                onConfirm={() => void confirm()}
                onCancel={() => { if (!busy) setPending(null); }}
            />
        </>
    );
}
