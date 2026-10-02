'use client';

import { useId } from "react";
import { KeyRound } from 'lucide-react';
import { ExtensionIcon } from '@/components/expansions/ExtensionIcon';
import { Badge, btnDangerOutline, btnOutline, btnPrimary } from '@/components/admin/console';
import { useI18n } from '@/components/I18nProvider';
import type { ExtensionRow } from '@/lib/admin/extensions-view';
import { blockReason } from "@/lib/admin/extensions-compat";
import { CompatNotice, useCompatLocale } from "./CompatNotice";
import { AiRequirementSummary, aiBadgeLabel, aiBlockTitle, useAiText } from './AiRequirementSummary';
import { PublisherLine, StarButton, SuiteChip, installsLabel } from './market/MarketParts';

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
    const aiT = useAiText();
    const aiBadge = aiBadgeLabel(aiT, row);
    return (
        <>
            {aiBadge && <Badge tone={aiBadge.tone}>{aiBadge.label}</Badge>}
            {row.status === 'enabled' && <Badge tone="success">{t('admin.console.extensions.status.enabled')}</Badge>}
            {row.status === 'disabled' && <Badge tone="warning">{t('admin.console.extensions.status.disabled')}</Badge>}
            {row.status === 'available' && <Badge>{t('admin.console.extensions.status.available')}</Badge>}
            {row.updateAvailable && <Badge tone="info">{t('admin.console.extensions.status.update')}</Badge>}
            {row.mandatory && <Badge tone="warning">{t('admin.console.extensions.status.mandatory')}</Badge>}
            {row.hasErrors && <Badge tone="danger">{t('admin.console.extensions.status.errors')}</Badge>}
            {row.isPaid && <Badge tone="info">{t('admin.console.extensions.status.paid')}</Badge>}
            {row.pausedBy.length > 0 && <Badge tone="warning">{t('admin.console.extensions.dependencies.pausedBy', { names: row.pausedBy.map((i) => i.name).join(', ') })}</Badge>}
            {row.incompatible && <Badge tone="warning">{t('admin.console.extensions.card.incompatible')}</Badge>}
            {row.deprecated && <Badge>{t('admin.console.extensions.card.deprecated')}</Badge>}
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
    const aiT = useAiText();
    const aiLock = aiBlockTitle(aiT, row);
    const locale = useCompatLocale();
    const blockId = useId();
    const installBlock = blockReason(row, 'install', locale);
    const enableBlock = blockReason(row, 'enable', locale);
    const updateBlock = blockReason(row, 'update', locale);
    const anyBlock = (!row.installed && installBlock) || (row.installed && !row.enabled && enableBlock) || (row.installed && row.updateAvailable && updateBlock) || null;
    return (
        <>
            {anyBlock && <span id={blockId} className="sr-only">{anyBlock}</span>}
            {!row.installed && (
                <button type="button" className={btnPrimary} disabled={disabled || !!aiLock || !!installBlock} title={installBlock || aiLock || undefined} aria-describedby={installBlock ? blockId : undefined} aria-label={t('admin.console.extensions.actions.installOf', { name })} onClick={() => actions.onRequest('install', row)}>
                    {busy ? t('admin.console.extensions.actions.working') : row.isPaid ? t('admin.console.extensions.actions.buyInstall') : t('admin.console.extensions.actions.install')}
                </button>
            )}
            {row.installed && row.updateAvailable && (
                <button type="button" className={btnPrimary} disabled={disabled || !!updateBlock} title={updateBlock || undefined} aria-describedby={updateBlock ? blockId : undefined} aria-label={t('admin.console.extensions.actions.updateOf', { name })} onClick={() => actions.onRequest('update', row)}>
                    {busy ? t('admin.console.extensions.actions.working') : t('admin.console.extensions.actions.update')}
                </button>
            )}
            {row.installed && row.enabled && !row.mandatory && (
                <button type="button" className={btnOutline} disabled={disabled} aria-label={t('admin.console.extensions.actions.disableOf', { name })} onClick={() => actions.onRequest('disable', row)}>
                    {t('admin.console.extensions.actions.disable')}
                </button>
            )}
            {row.installed && !row.enabled && (
                <button type="button" className={btnOutline} disabled={disabled || !!aiLock || !!enableBlock} title={enableBlock || aiLock || undefined} aria-describedby={enableBlock ? blockId : undefined} aria-label={t('admin.console.extensions.actions.enableOf', { name })} onClick={() => actions.onEnable(row)}>
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

/** Extras de marketplace de la tarjeta: favorita, editor, suite y vista en lista. Opcionales (sin ellos la tarjeta es la de siempre). */
export interface CardMarket {
    starred: boolean;
    onToggleStar: (row: Pick<ExtensionRow, 'id' | 'name'>) => void;
    onOpenPublisher: (publisherId: string) => void;
    onOpenSuite: (suiteId: string) => void;
    layout: 'grid' | 'list';
}

export function ExtensionCard({ row, actions, onOpen, market }: { row: ExtensionRow; actions: RowActions; onOpen: (row: ExtensionRow) => void; market?: CardMarket }) {
    const { t } = useI18n();
    const list = market?.layout === 'list';
    return (
        <li>
            <article aria-label={row.name} className={`flex h-full flex-col rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm`}>
                <div className="flex items-start gap-3">
                    <ExtensionIcon icon={row.icon} label={row.name} size={32} />
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
                        {market && (
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                                <PublisherLine publisher={row.market.publisher} onOpen={market.onOpenPublisher} />
                                {row.market.installCount > 0 && <span className="text-xs text-muted-foreground">{installsLabel(t, row.market.installCount)}</span>}
                            </div>
                        )}
                    </div>
                    {market && <StarButton row={row} starred={market.starred} onToggle={market.onToggleStar} />}
                </div>
                {market && row.market.suite && <div className="mt-2"><SuiteChip suite={row.market.suite} onOpen={market.onOpenSuite} /></div>}
                <div className="mt-3 flex flex-wrap gap-1.5">
                    <StatusBadges row={row} />
                    {row.hasCredentials === true && (
                        <Badge><KeyRound className="h-3 w-3" aria-hidden="true" />{t('admin.console.extensions.card.credentialsConfigured')}</Badge>
                    )}
                </div>
                <p className={`mt-3 flex-1 text-sm text-muted-foreground ${list ? 'line-clamp-2' : 'line-clamp-3'}`}>{row.description || t('admin.console.extensions.card.noDescription')}</p>
                {row.requiresAi && <div className="mt-2"><AiRequirementSummary row={row} /></div>}
                <div className="mt-2"><CompatNotice row={row} /></div>
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
