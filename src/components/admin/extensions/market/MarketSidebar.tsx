'use client';

import { useId } from 'react';
import { BadgeCheck, CheckCircle2, Compass, Layers, LayoutGrid, Star, Users } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { cn } from '@/lib/utils';
import { MARKET_CATEGORIES, type MarketCategory } from '@/lib/admin/marketplace/market-meta';
import type { MarketSection, MarketState } from '@/lib/admin/marketplace/market-model';
import { selectClass } from '@/components/admin/console';

export interface SidebarCounts {
    installed: number;
    starred: number;
    suites: number;
    official: number;
    community: number;
    categories: Record<MarketCategory, number>;
}

type Target = { section: MarketSection; cat?: MarketCategory | 'all' };
type Item = { key: string; label: string; target: Target; count?: number; icon?: React.ReactNode; sub?: boolean };

/** Elementos de la navegacion (compartidos por la barra lateral de escritorio y el selector movil). */
export function useSidebarItems(counts: SidebarCounts): { top: Item[]; categories: Item[]; bottom: Item[] } {
    const { t } = useI18n();
    const n = (k: string) => t(`admin.console.extensions.market.nav.${k}`);
    const ic = 'h-4 w-4 shrink-0';
    return {
        top: [
            { key: 'discover', label: n('discover'), target: { section: 'discover' }, icon: <Compass className={ic} aria-hidden="true" /> },
            { key: 'installed', label: n('installed'), target: { section: 'installed' }, count: counts.installed, icon: <CheckCircle2 className={ic} aria-hidden="true" /> },
            { key: 'starred', label: n('starred'), target: { section: 'starred' }, count: counts.starred, icon: <Star className={ic} aria-hidden="true" /> },
        ],
        categories: [
            { key: 'cat-all', label: n('categoriesAll'), target: { section: 'categories', cat: 'all' }, sub: true },
            ...MARKET_CATEGORIES.map((c) => ({ key: `cat-${c}`, label: t(`admin.console.extensions.filters.categories.${c}`), target: { section: 'categories' as const, cat: c }, count: counts.categories[c], sub: true })),
        ],
        bottom: [
            { key: 'suites', label: n('suites'), target: { section: 'suites' }, count: counts.suites, icon: <Layers className={ic} aria-hidden="true" /> },
            { key: 'official', label: n('official'), target: { section: 'official' }, count: counts.official, icon: <BadgeCheck className={ic} aria-hidden="true" /> },
            { key: 'community', label: n('community'), target: { section: 'community' }, count: counts.community, icon: <Users className={ic} aria-hidden="true" /> },
        ],
    };
}

const isActive = (item: Item, st: MarketState): boolean => {
    if (item.target.section !== st.section) return false;
    if (item.target.section === 'categories') return (item.target.cat ?? 'all') === st.cat;
    return true;
};

/** Barra lateral (>= lg) con la navegacion del marketplace; en movil se usa el selector de `MarketSectionSelect`. */
export function MarketSidebar({ counts, state, onNavigate }: { counts: SidebarCounts; state: MarketState; onNavigate: (target: Target) => void }) {
    const { t } = useI18n();
    const items = useSidebarItems(counts);
    const headingId = useId();
    const btn = (item: Item) => {
        const active = isActive(item, state);
        return (
            <li key={item.key}>
                <button
                    type="button"
                    onClick={() => onNavigate(item.target)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        item.sub && 'pl-8',
                        active ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                    )}
                >
                    {item.icon}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {typeof item.count === 'number' && <span className="text-xs tabular-nums text-muted-foreground">{item.count}</span>}
                </button>
            </li>
        );
    };
    return (
        <nav aria-label={t('admin.console.extensions.market.nav.label')} className="hidden w-52 shrink-0 lg:block">
            <ul className="space-y-0.5">{items.top.map(btn)}</ul>
            <p id={headingId} className="mt-4 flex items-center gap-2 px-2.5 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
                {t('admin.console.extensions.market.nav.categories')}
            </p>
            <ul aria-labelledby={headingId} className="space-y-0.5">{items.categories.map(btn)}</ul>
            <ul className="mt-4 space-y-0.5 border-t border-border/60 pt-3">{items.bottom.map(btn)}</ul>
        </nav>
    );
}

/** Selector de seccion para pantallas estrechas (< lg): sustituye a la columna lateral. */
export function MarketSectionSelect({ counts, state, onNavigate }: { counts: SidebarCounts; state: MarketState; onNavigate: (target: Target) => void }) {
    const { t } = useI18n();
    const items = useSidebarItems(counts);
    const uid = useId();
    const all = [...items.top, ...items.categories.map((i) => ({ ...i, label: `${t('admin.console.extensions.market.nav.categories')}: ${i.label}` })), ...items.bottom];
    const current = all.find((i) => isActive(i, state))?.key ?? (state.section === 'publisher' ? '' : 'discover');
    return (
        <div className="lg:hidden">
            <label htmlFor={uid} className="mb-1 block text-xs font-medium text-muted-foreground">{t('admin.console.extensions.market.nav.mobileLabel')}</label>
            <select
                id={uid}
                value={current}
                onChange={(e) => {
                    const item = all.find((i) => i.key === e.target.value);
                    if (item) onNavigate(item.target);
                }}
                className={selectClass}
            >
                {current === '' && <option value="">{t('admin.console.extensions.market.nav.publisher')}</option>}
                {all.map((i) => <option key={i.key} value={i.key}>{typeof i.count === 'number' ? `${i.label} (${i.count})` : i.label}</option>)}
            </select>
        </div>
    );
}
