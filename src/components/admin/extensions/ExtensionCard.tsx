'use client';

import { KeyRound, Puzzle } from 'lucide-react';
import { Badge, btnDangerOutline, btnOutline, btnPrimary } from '@/components/admin/console';
import { useI18n } from '@/components/I18nProvider';
import type { ExtensionRow } from '@/lib/admin/extensions-view';

export type DialogKind = 'install' | 'update' | 'uninstall' | 'disable' | 'mandatoryOn' | 'mandatoryOff';

export interface RowActions {
    readOnly: boolean;
    busyId: string | null;
    onRequest: (kind: DialogKind, row: ExtensionRow) => void;
    onEnable: (row: ExtensionRow) => void;
}

/** Insignias de estado de una extension (todas con texto, no solo color). */
export function StatusBadges({ row }: { row: ExtensionRow }) {
    const { t } = useI18n();
    return (
        <>
            {row.status === 'enabled' && <Badge tone="success">{t('admin.console.extensions.status.enabled')}</Badge>}
            {row.status === 'disabled' && <Badge tone="warning">{t('admin.console.extensions.status.disabled')}</Badge>}
            {row.status === 'available' && <Badge>{t('admin.console.extensions.status.available')}</Badge>}
            {row.updateAvailable && <Badge tone="info">{t('admin.console.extensions.status.update')}</Badge>}
            {row.mandatory && <Badge tone="warning">{t('admin.console.extensions.status.mandatory')}</Badge>}
            {row.hasErrors && <Badge tone="danger">{t('admin.console.extensions.status.errors')}</Badge>}
            {row.isPaid && <Badge tone="info">{t('admin.console.extensions.status.paid')}</Badge>}
        </>
    );
}

/** Botones de accion segun el estado; nada se hace sin pasar por `onRequest` (dialogo de confirmacion) salvo Activar. */
export function ExtensionActionButtons({ row, actions }: { row: ExtensionRow; actions: RowActions }) {
    const { t } = useI18n();
    if (actions.readOnly) return null;
    const busy = actions.busyId === row.id;
    const disabled = actions.busyId !== null;
    const name = row.name;
    return (
        <>
            {!row.installed && (
                <button type="button" className={btnPrimary} disabled={disabled} aria-label={t('admin.console.extensions.actions.installOf', { name })} onClick={() => actions.onRequest('install', row)}>
                    {busy ? t('admin.console.extensions.actions.working') : row.isPaid ? t('admin.console.extensions.actions.buyInstall') : t('admin.console.extensions.actions.install')}
                </button>
            )}
            {row.installed && row.updateAvailable && (
                <button type="button" className={btnPrimary} disabled={disabled} aria-label={t('admin.console.extensions.actions.updateOf', { name })} onClick={() => actions.onRequest('update', row)}>
                    {busy ? t('admin.console.extensions.actions.working') : t('admin.console.extensions.actions.update')}
                </button>
            )}
            {row.installed && row.enabled && !row.mandatory && (
                <button type="button" className={btnOutline} disabled={disabled} aria-label={t('admin.console.extensions.actions.disableOf', { name })} onClick={() => actions.onRequest('disable', row)}>
                    {t('admin.console.extensions.actions.disable')}
                </button>
            )}
            {row.installed && !row.enabled && (
                <button type="button" className={btnOutline} disabled={disabled} aria-label={t('admin.console.extensions.actions.enableOf', { name })} onClick={() => actions.onEnable(row)}>
                    {t('admin.console.extensions.actions.enable')}
                </button>
            )}
            {row.installed && (
                <button type="button" className={btnDangerOutline} disabled={disabled} aria-label={t('admin.console.extensions.actions.uninstallOf', { name })} onClick={() => actions.onRequest('uninstall', row)}>
                    {t('admin.console.extensions.actions.uninstall')}
                </button>
            )}
        </>
    );
}

export function ExtensionCard({ row, actions, onOpen }: { row: ExtensionRow; actions: RowActions; onOpen: (row: ExtensionRow) => void }) {
    const { t } = useI18n();
    return (
        <li>
            <article aria-label={row.name} className="flex h-full flex-col rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
                <div className="flex items-start gap-3">
                    <span aria-hidden="true" className="rounded-lg bg-primary/10 p-2 text-primary"><Puzzle className="h-5 w-5" /></span>
                    <div className="min-w-0 flex-1">
                        <h3 className="break-words text-sm font-semibold text-foreground">{row.name}</h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            {row.installed && row.updateAvailable && row.installedVersion && row.version
                                ? t('admin.console.extensions.card.updateAvailable', { from: row.installedVersion, to: row.version })
                                : row.installed && row.installedVersion
                                    ? t('admin.console.extensions.card.version', { version: row.installedVersion })
                                    : row.version
                                        ? t('admin.console.extensions.card.version', { version: row.version })
                                        : t('admin.console.extensions.card.versionUnknown')}
                            {' · '}
                            {row.isPaid ? t('admin.console.extensions.card.price', { price: row.price, currency: row.currency }) : t('admin.console.extensions.card.free')}
                        </p>
                    </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                    <StatusBadges row={row} />
                    {row.hasCredentials === true && (
                        <Badge><KeyRound className="h-3 w-3" aria-hidden="true" />{t('admin.console.extensions.card.credentialsConfigured')}</Badge>
                    )}
                </div>
                <p className="mt-3 line-clamp-3 flex-1 text-sm text-muted-foreground">{row.description || t('admin.console.extensions.card.noDescription')}</p>
                {!row.inCatalog && <p className="mt-2 text-xs text-muted-foreground">{t('admin.console.extensions.catalog.notInCatalog')}</p>}
                <div className="mt-4 flex flex-wrap gap-2 border-t border-border/60 pt-3">
                    <button type="button" className={btnOutline} aria-label={t('admin.console.extensions.actions.detailsOf', { name: row.name })} onClick={() => onOpen(row)}>
                        {t('admin.console.extensions.actions.details')}
                    </button>
                    <ExtensionActionButtons row={row} actions={actions} />
                </div>
            </article>
        </li>
    );
}
