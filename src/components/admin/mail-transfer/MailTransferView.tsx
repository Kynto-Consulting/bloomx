'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ErrorState, LoadingState, useAdminQuery } from '@/components/admin/console';
import { ExportWizard } from './ExportWizard';
import { ImportWizard } from './ImportWizard';
import { JobsHistory } from './JobsHistory';
import { errorText, transferBase, type JobPublic, type TransferConfig, type TransferMode } from './api';

const TABS = ['export', 'import', 'history'] as const;
type TabId = (typeof TABS)[number];

function tabFromHash(): TabId {
    if (typeof window === 'undefined') return 'export';
    const h = window.location.hash.replace(/^#/, '');
    return (TABS as readonly string[]).includes(h) ? (h as TabId) : 'export';
}

/**
 * Cuerpo de "Importar / Exportar": pestanas Exportar, Importar y Historial. Sirve tanto a la consola (mode="admin", alcance de
 * dominio) como a "Mi buzon" en Ajustes (mode="self", solo el propio buzon).
 */
export function MailTransferView({ mode }: { mode: TransferMode }) {
    const { t } = useI18n();
    const base = transferBase(mode);
    const cfg = useAdminQuery<TransferConfig>(`${base}/config`);
    const [tab, setTab] = React.useState<TabId>('export');
    const [openJob, setOpenJob] = React.useState<{ kind: 'import' | 'export'; id: string } | null>(null);
    const [refreshKey, setRefreshKey] = React.useState(0);

    React.useEffect(() => {
        if (mode !== 'admin') return;
        const sync = () => setTab(tabFromHash());
        sync();
        window.addEventListener('hashchange', sync);
        return () => window.removeEventListener('hashchange', sync);
    }, [mode]);

    const onTab = (value: string) => {
        const next = (TABS as readonly string[]).includes(value) ? (value as TabId) : 'export';
        setTab(next);
        if (mode === 'admin') {
            try { window.history.replaceState(null, '', next === 'export' ? window.location.pathname : `${window.location.pathname}#${next}`); } catch { /* sin history */ }
        }
    };

    const onOpen = (job: JobPublic) => {
        setOpenJob({ kind: job.kind, id: job.id });
        onTab(job.kind);
    };
    const bump = () => setRefreshKey((k) => k + 1);

    if (cfg.isLoading && !cfg.data) return <LoadingState />;
    if (cfg.error || !cfg.data) return <ErrorState message={errorText(t, cfg.error)} onRetry={() => void cfg.mutate()} />;
    const config = cfg.data;

    return (
        <Tabs value={tab} onValueChange={onTab}>
            <TabsList aria-label={t('admin.console.transfer.tablistLabel')} className="mb-4 h-auto flex-wrap justify-start gap-1">
                {TABS.map((id) => <TabsTrigger key={id} value={id}>{t(`admin.console.transfer.tabs.${id}`)}</TabsTrigger>)}
            </TabsList>
            <TabsContent value="export">
                <ExportWizard key={`e-${openJob?.kind === 'export' ? openJob.id : 'new'}`} mode={mode} config={config} resumeJobId={openJob?.kind === 'export' ? openJob.id : null} onJobChange={bump} />
            </TabsContent>
            <TabsContent value="import">
                <ImportWizard key={`i-${openJob?.kind === 'import' ? openJob.id : 'new'}`} mode={mode} config={config} resumeJobId={openJob?.kind === 'import' ? openJob.id : null} onJobChange={bump} />
            </TabsContent>
            <TabsContent value="history">
                <JobsHistory mode={mode} onOpen={onOpen} refreshKey={refreshKey} />
            </TabsContent>
        </Tabs>
    );
}
