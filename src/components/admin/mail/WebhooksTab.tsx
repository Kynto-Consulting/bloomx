'use client';

import * as React from 'react';
import { Copy } from 'lucide-react';
import { Badge, Card, DefinitionList, ErrorState, LoadingState, apiErrorKey, btnOutline, formatDateTime, useAdminQuery } from '@/components/admin/console';
import { useI18n } from '@/components/I18nProvider';
import type { WebhookStatus } from './types';

type Hook = WebhookStatus['inbound'] | WebhookStatus['events'];

function HookCard({
    id, title, description, hook, lastLabel, last, onCopy,
}: { id: string; title: string; description: string; hook: Hook; lastLabel: string; last: string | null; onCopy: (text: string) => void }) {
    const { t, intlLocale } = useI18n();
    const target = hook.url ?? hook.path;
    return (
        <Card id={id} title={title} description={description} headingLevel={3}>
            <DefinitionList
                className="sm:grid-cols-1"
                items={[
                    {
                        label: t('admin.console.mail.webhooks.signature'),
                        value: hook.signatureConfigured ? (
                            <span className="space-y-1">
                                <Badge tone="success">{t('admin.console.mail.webhooks.signatureConfigured')}</Badge>
                                <span className="block text-xs text-muted-foreground">{t('admin.console.mail.webhooks.signatureConfiguredHint')}</span>
                            </span>
                        ) : (
                            <span className="space-y-1">
                                <Badge tone="neutral">{t('admin.console.mail.webhooks.signatureOptional')}</Badge>
                                <span className="block text-xs text-muted-foreground">{t('admin.console.mail.webhooks.signatureOptionalHint')}</span>
                            </span>
                        ),
                    },
                    {
                        label: t('admin.console.mail.webhooks.callback'),
                        value: (
                            <span className="space-y-2">
                                <span className="flex flex-wrap items-center gap-2">
                                    <code className="break-all rounded bg-muted px-2 py-1 text-xs">{target}</code>
                                    <button
                                        type="button"
                                        className={`${btnOutline} h-8`}
                                        aria-label={`${t('admin.console.mail.webhooks.copy')}: ${title}`}
                                        onClick={() => onCopy(target)}
                                    >
                                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                                        {t('admin.console.mail.webhooks.copy')}
                                    </button>
                                </span>
                                {!hook.url && <span className="block text-xs text-muted-foreground">{t('admin.console.mail.webhooks.callbackNoBase')}</span>}
                            </span>
                        ),
                    },
                    { label: lastLabel, value: last ? formatDateTime(last, intlLocale) : t('admin.console.mail.webhooks.never') },
                ]}
            />
        </Card>
    );
}

export function WebhooksTab() {
    const { t } = useI18n();
    const { data, error, isLoading, mutate } = useAdminQuery<WebhookStatus>('/api/admin/mail/webhooks');
    const [notice, setNotice] = React.useState('');

    const copy = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setNotice(t('admin.console.mail.webhooks.copied'));
        } catch {
            setNotice(t('admin.console.mail.webhooks.copyFailed'));
        }
    };

    return (
        <Card title={t('admin.console.mail.webhooks.title')} description={t('admin.console.mail.webhooks.description')} id="webhooks">
            {error && !data ? (
                <ErrorState message={`${t('admin.console.mail.webhooks.loadFailed')} ${t(apiErrorKey(error))}`} onRetry={() => void mutate()} />
            ) : isLoading && !data ? (
                <LoadingState />
            ) : data ? (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <HookCard
                        id="webhook-inbound"
                        title={t('admin.console.mail.webhooks.inbound')}
                        description={t('admin.console.mail.webhooks.inboundDescription')}
                        hook={data.inbound}
                        lastLabel={t('admin.console.mail.webhooks.lastInbound')}
                        last={data.inbound.lastReceivedAt}
                        onCopy={(text) => void copy(text)}
                    />
                    <HookCard
                        id="webhook-events"
                        title={t('admin.console.mail.webhooks.events')}
                        description={t('admin.console.mail.webhooks.eventsDescription')}
                        hook={data.events}
                        lastLabel={t('admin.console.mail.webhooks.lastEvent')}
                        last={data.events.lastEventAt}
                        onCopy={(text) => void copy(text)}
                    />
                </div>
            ) : null}
            <p role="status" className="mt-3 text-sm text-muted-foreground empty:hidden">{notice}</p>
        </Card>
    );
}
