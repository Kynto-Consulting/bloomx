'use client';

import { useI18n } from '@/components/I18nProvider';
import { Card, ErrorState, LoadingState, formatDateTime, useAdminQuery } from '@/components/admin/console';
import { useErrorText, type TabProps } from './shared';

interface AuditResponse { items: Array<{ id: string; actor: string; action: string; fields: string[]; ts: string | null }> }

export function AuditTab(_props: TabProps) {
    const { t, intlLocale } = useI18n();
    const errorText = useErrorText();
    const { data, error, mutate } = useAdminQuery<AuditResponse>('/api/admin/ai/audit');
    return (
        <Card title={t('admin.ai.audit.title')} description={t('admin.ai.audit.description')}>
            {error && !data ? <ErrorState message={errorText(error)} onRetry={() => void mutate()} />
                : !data ? <LoadingState label={t('admin.console.common.loading')} />
                    : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <caption className="sr-only">{t('admin.ai.audit.title')}</caption>
                                <thead>
                                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                                        <th scope="col" className="px-2 py-1.5 font-medium">{t('admin.ai.audit.when')}</th>
                                        <th scope="col" className="px-2 py-1.5 font-medium">{t('admin.ai.audit.who')}</th>
                                        <th scope="col" className="px-2 py-1.5 font-medium">{t('admin.ai.audit.action')}</th>
                                        <th scope="col" className="px-2 py-1.5 font-medium">{t('admin.ai.audit.fields')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.items.length === 0 && <tr><td colSpan={4} className="px-2 py-3 text-muted-foreground">{t('admin.ai.audit.empty')}</td></tr>}
                                    {data.items.map((a) => (
                                        <tr key={a.id} className="border-b border-border/50 align-top last:border-0">
                                            <td className="whitespace-nowrap px-2 py-1.5">{formatDateTime(a.ts, intlLocale)}</td>
                                            <td className="px-2 py-1.5">{a.actor}</td>
                                            <td className="px-2 py-1.5">{a.action}</td>
                                            <td className="break-words px-2 py-1.5 font-mono text-xs text-muted-foreground">{a.fields.join(' ')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
        </Card>
    );
}
