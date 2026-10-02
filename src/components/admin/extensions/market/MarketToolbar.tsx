'use client';

import { useId, useState } from 'react';
import { LayoutGrid, List, SlidersHorizontal } from 'lucide-react';
import { FilterBar, FilterSelect, SearchInput, btnGhost, btnOutline } from '@/components/admin/console';
import { useI18n } from '@/components/I18nProvider';
import { cn } from '@/lib/utils';
import { MARKET_CATEGORIES } from '@/lib/admin/marketplace/market-meta';
import { MARKET_STATUSES, SORT_KEYS, type MarketState } from '@/lib/admin/marketplace/market-model';

export const MARKET_SEARCH_ID = 'market-search';

/** Busqueda (atajo /), filtros combinables, orden y vista. Los filtros avanzados van en un bloque plegable. */
export function MarketToolbar({ state, onChange }: { state: MarketState; onChange: (patch: Partial<MarketState>) => void }) {
    const { t } = useI18n();
    const m = (k: string) => t(`admin.console.extensions.market.${k}`);
    const [more, setMore] = useState(() => state.origin !== 'all' || state.risk !== 'all' || state.ai !== 'all' || state.compat !== 'all');
    const moreId = useId();
    const all = { value: 'all', label: t('admin.console.common.all') };
    const advancedActive = [state.origin, state.risk, state.ai, state.compat].filter((v) => v !== 'all').length;

    return (
        <div className="mb-4 space-y-3">
            <FilterBar label={t('admin.console.extensions.filters.label')}>
                <SearchInput
                    id={MARKET_SEARCH_ID}
                    value={state.q}
                    onChange={(q) => onChange({ q })}
                    label={t('admin.console.extensions.search.label')}
                    placeholder={m('search.placeholder')}
                    className="sm:w-80"
                />
                <FilterSelect
                    label={t('admin.console.extensions.filters.category')}
                    value={state.cat}
                    onChange={(cat) => onChange({ cat: cat as MarketState['cat'] })}
                    options={[all, ...MARKET_CATEGORIES.map((c) => ({ value: c, label: t(`admin.console.extensions.filters.categories.${c}`) }))]}
                />
                <FilterSelect
                    label={t('admin.console.extensions.filters.status')}
                    value={state.status}
                    onChange={(status) => onChange({ status: status as MarketState['status'] })}
                    options={MARKET_STATUSES.map((s) => ({ value: s, label: t(`admin.console.extensions.filters.statuses.${s}`) }))}
                />
                <FilterSelect
                    label={m('sort.label')}
                    value={state.sort}
                    onChange={(sort) => onChange({ sort: sort as MarketState['sort'] })}
                    options={SORT_KEYS.map((s) => ({ value: s, label: m(`sort.${s}`) }))}
                />
                <button
                    type="button"
                    className={cn(btnOutline, 'self-end')}
                    aria-expanded={more}
                    aria-controls={moreId}
                    onClick={() => setMore((v) => !v)}
                >
                    <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                    {more ? m('filters.less') : m('filters.more')}
                    {advancedActive > 0 && <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{advancedActive}</span>}
                </button>
                <div role="group" aria-label={m('view.label')} className="flex items-center gap-1 self-end">
                    {(['grid', 'list'] as const).map((v) => (
                        <button
                            key={v}
                            type="button"
                            aria-pressed={state.view === v}
                            aria-label={m(`view.${v}`)}
                            title={m(`view.${v}`)}
                            onClick={() => onChange({ view: v })}
                            className={cn(btnGhost, 'px-2', state.view === v && 'bg-accent text-accent-foreground')}
                        >
                            {v === 'grid' ? <LayoutGrid className="h-4 w-4" aria-hidden="true" /> : <List className="h-4 w-4" aria-hidden="true" />}
                        </button>
                    ))}
                </div>
            </FilterBar>
            <div id={moreId} hidden={!more} className="flex flex-wrap items-end gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
                <FilterSelect
                    label={m('filters.origin')}
                    value={state.origin}
                    onChange={(origin) => onChange({ origin: origin as MarketState['origin'] })}
                    options={(['all', 'official', 'community'] as const).map((v) => ({ value: v, label: m(`filters.origins.${v}`) }))}
                />
                <FilterSelect
                    label={m('filters.risk')}
                    value={state.risk}
                    onChange={(risk) => onChange({ risk: risk as MarketState['risk'] })}
                    options={(['all', 'low', 'medium'] as const).map((v) => ({ value: v, label: m(`filters.risks.${v}`) }))}
                />
                <FilterSelect
                    label={m('filters.ai')}
                    value={state.ai}
                    onChange={(ai) => onChange({ ai: ai as MarketState['ai'] })}
                    options={(['all', 'yes', 'no'] as const).map((v) => ({ value: v, label: m(`filters.ais.${v}`) }))}
                />
                <FilterSelect
                    label={m('filters.compat')}
                    value={state.compat}
                    onChange={(compat) => onChange({ compat: compat as MarketState['compat'] })}
                    options={(['all', 'yes'] as const).map((v) => ({ value: v, label: m(`filters.compats.${v}`) }))}
                />
            </div>
        </div>
    );
}
