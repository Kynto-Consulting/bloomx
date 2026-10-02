'use client';

import { BadgeCheck, Boxes, Layers, Star } from 'lucide-react';
import { ExtensionIcon } from '@/components/expansions/ExtensionIcon';
import { Badge } from '@/components/admin/console';
import { useI18n } from '@/components/I18nProvider';
import { cn } from '@/lib/utils';
import type { MarketPublisher, MarketSuite } from '@/lib/admin/marketplace/market-meta';
import type { ExtensionRow } from '@/lib/admin/extensions-view';

/** Texto con respaldo: si la clave no existe `t` devuelve la propia clave y se usa `fallback`. */
export function useTextOr() {
    const { t } = useI18n();
    return (key: string, fallbackKey: string, params?: Record<string, string | number>) => {
        const hit = t(key, params);
        return hit === key ? t(fallbackKey, params) : hit;
    };
}

/** Insignias del editor: «Oficial» (plataforma), «Verificado» o «Comunidad». Siempre con texto, no solo color o icono. */
export function PublisherBadges({ publisher }: { publisher: MarketPublisher }) {
    const { t } = useI18n();
    return (
        <>
            {publisher.official && <Badge tone="info"><BadgeCheck className="h-3 w-3" aria-hidden="true" />{t('admin.console.extensions.market.badges.official')}</Badge>}
            {!publisher.official && publisher.verified && <Badge tone="success"><BadgeCheck className="h-3 w-3" aria-hidden="true" />{t('admin.console.extensions.market.badges.verified')}</Badge>}
            {!publisher.official && !publisher.verified && <Badge>{t('admin.console.extensions.market.badges.community')}</Badge>}
        </>
    );
}

/** Nombre del editor (boton que abre su pagina) + insignias. */
export function PublisherLine({ publisher, onOpen, className }: { publisher: MarketPublisher; onOpen?: (publisherId: string) => void; className?: string }) {
    const { t } = useI18n();
    const name = publisher.id === 'community' ? t('admin.console.extensions.market.badges.community') : publisher.name;
    return (
        <span className={cn('inline-flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground', className)}>
            {onOpen ? (
                <button
                    type="button"
                    onClick={() => onOpen(publisher.id)}
                    aria-label={t('admin.console.extensions.market.card.openPublisher', { name })}
                    className="inline-flex items-center gap-1 rounded font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <Boxes className="h-3 w-3" aria-hidden="true" />
                    {t('admin.console.extensions.market.card.by', { name })}
                </button>
            ) : (
                <span>{t('admin.console.extensions.market.card.by', { name })}</span>
            )}
            <PublisherBadges publisher={publisher} />
        </span>
    );
}

/** Chip de la suite (abre su carpeta). */
export function SuiteChip({ suite, onOpen }: { suite: MarketSuite; onOpen?: (suiteId: string) => void }) {
    const { t } = useI18n();
    const body = (
        <>
            {suite.icon ? <ExtensionIcon icon={suite.icon} label={suite.name} size={16} /> : <Layers className="h-3 w-3" aria-hidden="true" />}
            <span className="truncate">{suite.name}</span>
        </>
    );
    const cls = 'inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs text-foreground';
    return onOpen ? (
        <button
            type="button"
            onClick={() => onOpen(suite.id)}
            aria-label={t('admin.console.extensions.market.card.openSuite', { name: suite.name })}
            className={cn(cls, 'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
        >
            {body}
        </button>
    ) : (
        <span className={cls}>{body}</span>
    );
}

export function installsLabel(t: (k: string, p?: Record<string, string | number>) => string, count: number, ns: 'card' | 'detail' = 'card'): string {
    return count === 1 ? t(`admin.console.extensions.market.${ns}.installsOne`) : t(`admin.console.extensions.market.${ns}.installs`, { count });
}

/** Estrella de favoritas (por administrador). aria-pressed + etiqueta con el nombre; el icono se rellena cuando esta marcada. */
export function StarButton({ row, starred, onToggle }: { row: Pick<ExtensionRow, 'id' | 'name'>; starred: boolean; onToggle: (row: Pick<ExtensionRow, 'id' | 'name'>) => void }) {
    const { t } = useI18n();
    return (
        <button
            type="button"
            aria-pressed={starred}
            aria-label={t(starred ? 'admin.console.extensions.market.card.unstar' : 'admin.console.extensions.market.card.star', { name: row.name })}
            onClick={() => onToggle(row)}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
            <Star className={cn('h-4 w-4', starred && 'fill-current text-warning')} aria-hidden="true" />
        </button>
    );
}

/** Tarjeta pequena (Descubrir, «Otras de esta suite», «Relacionadas»): icono, nombre, editor y estado. */
export function MiniCard({ row, onOpen }: { row: ExtensionRow; onOpen: (row: ExtensionRow) => void }) {
    const { t } = useI18n();
    return (
        <li>
            <button
                type="button"
                onClick={() => onOpen(row)}
                aria-label={t('admin.console.extensions.actions.detailsOf', { name: row.name })}
                className="flex h-full w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                <ExtensionIcon icon={row.icon} iconUrl={row.iconUrl} label={row.name} size={32} />
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{row.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                        {row.installed ? t(row.enabled ? 'admin.console.extensions.status.enabled' : 'admin.console.extensions.status.disabled') : row.isPaid ? t('admin.console.extensions.card.price', { price: row.price, currency: row.currency }) : t('admin.console.extensions.card.free')}
                        {row.market.installCount > 0 ? ` · ${installsLabel(t, row.market.installCount)}` : ''}
                    </span>
                </span>
            </button>
        </li>
    );
}
