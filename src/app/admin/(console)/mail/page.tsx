'use client';

import * as React from 'react';
import { PageHeader } from '@/components/admin/console';
import { useI18n } from '@/components/I18nProvider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OverviewTab } from '@/components/admin/mail/OverviewTab';
import { QuotasTab } from '@/components/admin/mail/QuotasTab';
import { SuppressionTab } from '@/components/admin/mail/SuppressionTab';
import { WebhooksTab } from '@/components/admin/mail/WebhooksTab';
import { DnsTab } from '@/components/admin/mail/DnsTab';
import type { MailRange } from '@/components/admin/mail/types';

const TABS = ['overview', 'quotas', 'suppression', 'webhooks', 'dns'] as const;
type TabId = (typeof TABS)[number];

function tabFromHash(): TabId {
    if (typeof window === 'undefined') return 'overview';
    const h = window.location.hash.replace(/^#/, '');
    return (TABS as readonly string[]).includes(h) ? (h as TabId) : 'overview';
}

export default function AdminMailPage() {
    const { t } = useI18n();
    const [tab, setTab] = React.useState<TabId>('overview');
    const [range, setRange] = React.useState<MailRange>('7d');
    const arrivedByHash = React.useRef(false);

    // Anclas #suppression y #dns (enlaces de la busqueda global) y navegacion con atras/adelante.
    React.useEffect(() => {
        const sync = () => {
            const next = tabFromHash();
            if (window.location.hash) arrivedByHash.current = true;
            setTab(next);
        };
        sync();
        window.addEventListener('hashchange', sync);
        return () => window.removeEventListener('hashchange', sync);
    }, []);

    React.useEffect(() => {
        if (!arrivedByHash.current) return;
        const el = document.getElementById(tab);
        if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
        arrivedByHash.current = false;
    }, [tab]);

    const onTab = (value: string) => {
        const next = (TABS as readonly string[]).includes(value) ? (value as TabId) : 'overview';
        setTab(next);
        try {
            const base = window.location.pathname + window.location.search;
            window.history.replaceState(null, '', next === 'overview' ? base : `${base}#${next}`);
        } catch { /* sin history */ }
    };

    return (
        <div>
            <PageHeader title={t('admin.console.mail.title')} description={t('admin.console.mail.description')} />
            <Tabs value={tab} onValueChange={onTab}>
                <TabsList aria-label={t('admin.console.mail.tablistLabel')} className="mb-4 h-auto flex-wrap justify-start gap-1">
                    {TABS.map((id) => (
                        <TabsTrigger key={id} value={id}>{t(`admin.console.mail.tabs.${id}`)}</TabsTrigger>
                    ))}
                </TabsList>
                <TabsContent value="overview"><OverviewTab range={range} onRangeChange={setRange} /></TabsContent>
                <TabsContent value="quotas"><QuotasTab range={range} onRangeChange={setRange} /></TabsContent>
                <TabsContent value="suppression"><SuppressionTab /></TabsContent>
                <TabsContent value="webhooks"><WebhooksTab /></TabsContent>
                <TabsContent value="dns"><DnsTab /></TabsContent>
            </Tabs>
        </div>
    );
}
