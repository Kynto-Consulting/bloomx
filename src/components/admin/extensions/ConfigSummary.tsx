'use client';

import { Badge, Card } from '@/components/admin/console';
import { useI18n } from '@/components/I18nProvider';
import type { ExtensionRow } from '@/lib/admin/extensions-view';
import { localizedText } from '@/lib/expansions/settings-schema';
import { useExtensionConfig } from './useExtensionConfig';

/**
 * Fila del Resumen: "Configuracion completa X/Y" (campos obligatorios del esquema), lista de lo que falta con enlace a la pestana
 * que lo resuelve y aviso si algun ajuste aun usa variables de entorno heredadas. No se muestra sin esquema ni sin instalar.
 */
export function ConfigSummary({ row, domainId, onGoTab }: { row: ExtensionRow; domainId: string; onGoTab: (tab: 'credentials' | 'settings') => void }) {
    const { t, locale } = useI18n();
    const schema = row.template?.settingsSchema;
    const config = useExtensionConfig(domainId, row.id, !!schema && row.installed);
    const data = config.data;
    if (!schema || !row.installed || !data) return null;

    const { done, total, items } = data.checklist;
    const legacy = data.envLegacy.filter((k) => data.sources[k] === 'legacy' || data.sources[k] === 'server-env');
    if (total === 0 && legacy.length === 0) return null;
    const missing = items.filter((i) => !i.ok);
    const label = (key: string) => {
        const field = schema.fields.find((f) => f.key === key);
        return field ? localizedText(field.label, locale, key) : key;
    };

    return (
        <Card title={t('admin.console.extensions.summaryTab.config.title')} headingLevel={3}>
            <div className="space-y-3 text-sm">
                {total > 0 && (
                    <p role="status" className="flex flex-wrap items-center gap-2 text-foreground">
                        <Badge tone={done === total ? 'success' : 'warning'}>{t('admin.console.extensions.summaryTab.config.progress', { done, total })}</Badge>
                        {done === total && <span>{t('admin.console.extensions.summaryTab.config.complete')}</span>}
                    </p>
                )}
                {missing.length > 0 && (
                    <div>
                        <p className="font-medium text-foreground">{t('admin.console.extensions.summaryTab.config.missing')}</p>
                        <ul className="mt-1 space-y-1">
                            {missing.map((i) => (
                                <li key={i.key} className="flex flex-wrap items-center gap-2">
                                    <span className="text-foreground">{label(i.key)}</span>
                                    <button
                                        type="button"
                                        onClick={() => onGoTab(i.secret ? 'credentials' : 'settings')}
                                        className="rounded text-xs font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    >
                                        {i.secret ? t('admin.console.extensions.summaryTab.config.goCredentials') : t('admin.console.extensions.summaryTab.config.goSettings')}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {legacy.length > 0 && (
                    <p className="flex flex-wrap items-center gap-2 text-foreground">
                        <Badge tone="warning">{t('admin.console.extensions.config.legacyBadge')}</Badge>
                        <span>{t('admin.console.extensions.summaryTab.config.legacy', { count: legacy.length })}</span>
                        <button
                            type="button"
                            onClick={() => onGoTab('settings')}
                            className="rounded text-xs font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            {t('admin.console.extensions.summaryTab.config.goSettings')}
                        </button>
                    </p>
                )}
            </div>
        </Card>
    );
}
