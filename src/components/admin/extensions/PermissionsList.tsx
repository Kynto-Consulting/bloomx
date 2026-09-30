'use client';

import { Badge, type Tone } from '@/components/admin/console';
import { useI18n } from '@/components/I18nProvider';
import { permissionsByRisk } from '@/lib/admin/extensions-manifest';
import type { PermissionRisk } from '@/lib/expansions/manifest-schema';

export const RISK_TONE: Record<PermissionRisk, Tone> = { high: 'danger', medium: 'warning', low: 'neutral' };

/** Permisos legibles del manifest, de mayor a menor riesgo, con insignia de riesgo (texto + tono). */
export function PermissionsList({ template, compact = false, label }: { template: unknown; compact?: boolean; label?: string }) {
    const { t } = useI18n();
    const items = permissionsByRisk(template);
    if (items.length === 0) return <p className="text-sm text-muted-foreground">{t('admin.console.extensions.permissions.none')}</p>;
    return (
        <ul aria-label={label ?? t('admin.console.extensions.permissions.summary')} data-testid="permission-list" className="space-y-2">
            {items.map((item) => (
                <li key={item.permission} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">{item.label}</span>
                        <Badge tone={item.known ? RISK_TONE[item.risk] : 'danger'}>
                            {item.known ? t(`admin.console.extensions.permissions.risk.${item.risk}`) : t('admin.console.extensions.permissions.unknown')}
                        </Badge>
                    </div>
                    {!compact && <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>}
                    <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{item.permission}</p>
                </li>
            ))}
        </ul>
    );
}
