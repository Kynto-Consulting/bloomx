'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { ErrorState, LoadingState, useAdminQuery, useConsole } from '@/components/admin/console';
import { useExtensionsData } from '@/components/admin/extensions/useExtensionsData';
import { useStepUp } from '@/components/admin/permissions/useStepUp';
import { cn } from '@/lib/utils';
import { capsForLevel } from './logic';
import { useAiSave, useErrorText, useReason, type AiExtensionInfo, type AiSettingsView, type AiStateResponse, type TabProps } from './shared';
import { SummaryTab } from './SummaryTab';
import { ProviderTab } from './ProviderTab';
import { FeaturesTab } from './FeaturesTab';
import { GuardrailsTab } from './GuardrailsTab';
import { QuotasTab } from './QuotasTab';
import { UsageTab } from './UsageTab';
import { AuditTab } from './AuditTab';

const TABS = [
    { id: 'summary', C: SummaryTab }, { id: 'provider', C: ProviderTab }, { id: 'features', C: FeaturesTab }, { id: 'guardrails', C: GuardrailsTab },
    { id: 'quotas', C: QuotasTab }, { id: 'usage', C: UsageTab }, { id: 'audit', C: AuditTab },
] as const;

export function AiView() {
    const { t } = useI18n();
    const { me, domain } = useConsole();
    const errorText = useErrorText();
    const level = me?.permission_level ?? 0;
    const { guard, dialog } = useStepUp();
    const settingsQ = useAdminQuery<AiSettingsView>('/api/admin/ai/settings');
    const stateQ = useAdminQuery<AiStateResponse>('/api/admin/ai/state');
    // Extensiones afectadas: instaladas (o /api/config en solo lectura) con su bloqueo por IA (blocking.ts); no depende de la sesion de gestor.
    const extData = useExtensionsData(domain.id);
    const extensions = React.useMemo<AiExtensionInfo[]>(() => extData.rows
        .filter((r) => r.installed && r.requiresAi)
        .map((r) => ({ id: r.id, name: r.name, features: r.aiBlock.features, blocked: r.aiBlock.blocked, reason: r.aiBlock.reason, degraded: r.aiBlock.degraded })), [extData.rows]);
    const [tab, setTab] = React.useState<(typeof TABS)[number]['id']>('summary');
    const refreshAll = React.useCallback(async () => { await Promise.all([settingsQ.mutate(), stateQ.mutate()]); }, [settingsQ, stateQ]);
    const save = useAiSave(level, guard, refreshAll);
    const reasonFor = useReason(level);

    const onKey = (e: React.KeyboardEvent) => {
        const i = TABS.findIndex((x) => x.id === tab);
        let j = i;
        if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
        else if (e.key === 'ArrowLeft') j = (i - 1 + TABS.length) % TABS.length;
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = TABS.length - 1;
        else return;
        e.preventDefault();
        setTab(TABS[j].id);
        document.getElementById(`ai-tab-${TABS[j].id}`)?.focus();
    };

    if (settingsQ.error && !settingsQ.data) return <ErrorState message={errorText(settingsQ.error)} onRetry={() => void settingsQ.mutate()} />;
    if (!settingsQ.data) return <LoadingState label={t('admin.console.common.loading')} />;

    const props: TabProps = {
        settings: settingsQ.data, extensions, level, caps: capsForLevel(level), save, reasonFor,
        refresh: () => void refreshAll(),
    };
    const Active = TABS.find((x) => x.id === tab)!.C;

    return (
        <div className="space-y-4">
            {stateQ.error && <p role="alert" className="text-sm text-destructive">{errorText(stateQ.error)}</p>}
            <div role="tablist" aria-label={t('admin.ai.tabsLabel')} onKeyDown={onKey} className="flex gap-1 overflow-x-auto border-b border-border">
                {TABS.map(({ id }) => (
                    <button
                        key={id} id={`ai-tab-${id}`} type="button" role="tab" aria-selected={tab === id} aria-controls={`ai-panel-${id}`} tabIndex={tab === id ? 0 : -1}
                        onClick={() => setTab(id)}
                        className={cn('whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            tab === id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
                    >
                        {t(`admin.ai.tabs.${id}`)}
                    </button>
                ))}
            </div>
            <div role="tabpanel" id={`ai-panel-${tab}`} aria-labelledby={`ai-tab-${tab}`} tabIndex={0} className="focus-visible:outline-none">
                <Active {...props} />
            </div>
            {dialog}
        </div>
    );
}
