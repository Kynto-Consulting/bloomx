'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { TabList, panelDomId, tabDomId } from '@/components/admin/extensions/Tabs';
import { SpamListEditor } from '@/components/spam/SpamListEditor';
import { ExternalTab } from './ExternalTab';
import { LevelTab } from './LevelTab';
import { LogTab } from './LogTab';
import { StatsTab } from './StatsTab';
import { TestTab } from './TestTab';
import { LISTS_BASE, SPAM_TABS, type SpamTabId } from './types';

const PREFIX = 'spam';
const isTab = (v: string | null): v is SpamTabId => !!v && (SPAM_TABS as readonly string[]).includes(v);

function renderTab(id: SpamTabId) {
    switch (id) {
        case 'level': return <LevelTab />;
        case 'block': return <SpamListEditor apiBase={LISTS_BASE} kind="block" variant="admin" idPrefix="spam-block" />;
        case 'allow': return <SpamListEditor apiBase={LISTS_BASE} kind="allow" variant="admin" idPrefix="spam-allow" />;
        case 'external': return <ExternalTab />;
        case 'log': return <LogTab />;
        case 'test': return <TestTab />;
        case 'stats': return <StatsTab />;
    }
}

/**
 * "Spam y remitentes": pestanas accesibles sincronizadas con ?tab=. Cada panel se monta al visitarse y se conserva (oculto)
 * al cambiar de pestana, para no perder cambios sin guardar de "Nivel de filtrado" o "Correos externos".
 */
export function SpamView() {
    const { t } = useI18n();
    const [tab, setTab] = React.useState<SpamTabId>('level');
    const [visited, setVisited] = React.useState<ReadonlySet<SpamTabId>>(new Set<SpamTabId>(['level']));

    React.useEffect(() => {
        const read = () => {
            const v = new URLSearchParams(window.location.search).get('tab');
            if (isTab(v)) setTab(v);
        };
        read();
        window.addEventListener('popstate', read);
        return () => window.removeEventListener('popstate', read);
    }, []);

    React.useEffect(() => {
        setVisited((s) => (s.has(tab) ? s : new Set([...s, tab])));
    }, [tab]);

    const select = (id: SpamTabId) => {
        setTab(id);
        try {
            const u = new URL(window.location.href);
            u.searchParams.set('tab', id);
            window.history.replaceState(null, '', `${u.pathname}${u.search}${u.hash}`);
        } catch { /* sin history */ }
    };

    const tabs = SPAM_TABS.map((id) => ({ id, label: t(`admin.console.spam.tabs.${id}`) }));

    return (
        <div className="space-y-6">
            <TabList tabs={tabs} active={tab} onChange={select} label={t('admin.console.spam.tablistLabel')} idPrefix={PREFIX} />
            {SPAM_TABS.filter((id) => visited.has(id) || id === tab).map((id) => (
                <div
                    key={id}
                    role="tabpanel"
                    id={panelDomId(PREFIX, id)}
                    aria-labelledby={tabDomId(PREFIX, id)}
                    hidden={tab !== id}
                    tabIndex={0}
                    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    {renderTab(id)}
                </div>
            ))}
        </div>
    );
}
