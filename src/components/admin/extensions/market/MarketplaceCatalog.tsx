'use client';

import { useEffect, useMemo } from 'react';
import { Puzzle, Star as StarIcon, Users } from 'lucide-react';
import { Card, EmptyState, ErrorState, LoadingState, btnOutline } from '@/components/admin/console';
import { useI18n } from '@/components/I18nProvider';
import type { ExtensionRow } from '@/lib/admin/extensions-view';
import {
    DEFAULT_MARKET_STATE, applyMarket, categoryCounts, groupByPublisher, groupBySuite, hasActiveFilters, paginate,
    type MarketSection, type MarketState,
} from '@/lib/admin/marketplace/market-model';
import type { MarketCategory } from '@/lib/admin/marketplace/market-meta';
import { ExtensionCard, type CardMarket, type RowActions } from '../ExtensionCard';
import { MarketSectionSelect, MarketSidebar, type SidebarCounts } from './MarketSidebar';
import { MARKET_SEARCH_ID, MarketToolbar } from './MarketToolbar';
import { DiscoverView, OfficialHeader, PublisherHeader, SuiteGrid, SuiteHeader } from './MarketViews';
import type { ExtensionStars } from './useExtensionStars';

export interface MarketplaceCatalogProps {
    rows: ExtensionRow[];
    loading: boolean;
    catalogError: boolean;
    configError: boolean;
    onRetry: () => void;
    state: MarketState;
    update: (patch: Partial<MarketState>) => void;
    stars: ExtensionStars;
    onToggleStar: (row: Pick<ExtensionRow, 'id' | 'name'>) => void;
    actions: RowActions;
    onOpen: (row: ExtensionRow) => void;
    onInstallSuite: (suiteId: string) => void;
}

const isTyping = (el: EventTarget | null) => {
    const node = el as HTMLElement | null;
    if (!node || !node.tagName) return false;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) || node.isContentEditable === true;
};

/** Pestana «Catalogo» de /admin/extensions convertida en marketplace: navegacion lateral, busqueda, filtros, secciones y paginas de suite/editor. */
export function MarketplaceCatalog(props: MarketplaceCatalogProps) {
    const { rows, loading, catalogError, configError, onRetry, state, update, stars, onToggleStar, actions, onOpen, onInstallSuite } = props;
    const { t } = useI18n();

    // Atajo «/»: enfoca la busqueda (salvo que ya se este escribiendo en un campo o haya un dialogo abierto).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
            if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
            const input = document.getElementById(MARKET_SEARCH_ID) as HTMLInputElement | null;
            if (!input) return;
            e.preventDefault();
            input.focus();
            input.select();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);

    const ctx = useMemo(() => ({ starred: stars.starred }), [stars.starred]);
    const suites = useMemo(() => groupBySuite(rows), [rows]);
    const publishers = useMemo(() => groupByPublisher(rows), [rows]);
    const counts = useMemo<SidebarCounts>(() => ({
        installed: rows.filter((r) => r.installed).length,
        starred: rows.filter((r) => stars.starred.has(r.id)).length,
        suites: suites.length,
        official: rows.filter((r) => r.market.publisher.official).length,
        community: rows.filter((r) => !r.market.publisher.official).length,
        categories: categoryCounts(rows),
    }), [rows, stars.starred, suites.length]);

    const filtered = useMemo(() => applyMarket(rows, state, ctx), [rows, state, ctx]);
    const page = paginate(filtered, state.page);
    const filtersOn = hasActiveFilters(state);

    const activeSuite = state.suite ? suites.find((s) => s.id === state.suite) ?? null : null;
    const activePublisher = state.publisher ? publishers.find((p) => p.id === state.publisher) ?? null : null;
    const overview = (state.section === 'discover' || (state.section === 'suites' && !state.suite) || (state.section === 'publisher' && !state.publisher)) && !filtersOn;

    // Cambiar un filtro desde una vista general (Descubrir, carpetas de suites) lleva a la lista completa para ver el resultado.
    const change = (patch: Partial<MarketState>) => {
        const leaving = (state.section === 'discover' || (state.section === 'suites' && !state.suite) || (state.section === 'publisher' && !state.publisher)) && !('section' in patch);
        update(leaving ? { ...patch, section: 'categories' } : patch);
    };
    const navigate = (target: { section: MarketSection; cat?: MarketCategory | 'all' }) =>
        update({ section: target.section, cat: target.cat ?? 'all', suite: '', publisher: '', q: '', status: 'all', origin: 'all', risk: 'all', ai: 'all', compat: 'all' });

    const sectionLabel =
        state.section === 'categories' ? (state.cat === 'all' ? t('admin.console.extensions.market.nav.categoriesAll') : t(`admin.console.extensions.filters.categories.${state.cat}`))
        : state.section === 'suites' && activeSuite ? activeSuite.name
        : state.section === 'publisher' && activePublisher ? activePublisher.name
        : t(`admin.console.extensions.market.nav.${state.section}`);

    const cardMarket = (row: ExtensionRow): CardMarket => ({
        starred: stars.starred.has(row.id),
        onToggleStar,
        onOpenPublisher: (publisher) => update({ section: 'publisher', publisher, suite: '', cat: 'all', q: '' }),
        onOpenSuite: (suite) => update({ section: 'suites', suite, publisher: '', cat: 'all', q: '' }),
        layout: state.view,
    });

    let body: React.ReactNode;
    if (loading) {
        body = <LoadingState />;
    } else if (catalogError) {
        body = <ErrorState message={t('admin.console.extensions.catalog.loadError')} onRetry={onRetry} />;
    } else if (configError) {
        body = <ErrorState message={t('admin.console.extensions.catalog.configError')} onRetry={onRetry} />;
    } else if (rows.length === 0) {
        body = <EmptyState icon={<Puzzle className="h-10 w-10" />} title={t('admin.console.extensions.catalog.empty')} />;
    } else if (state.section === 'discover' && overview) {
        body = <DiscoverView rows={rows} onOpen={onOpen} onSeeAll={(sort, origin) => update({ section: 'categories', sort, origin: origin ?? 'all' })} />;
    } else if (state.section === 'suites' && !state.suite && overview) {
        body = <SuiteGrid groups={suites} onOpen={(suite) => update({ suite })} />;
    } else if (state.section === 'publisher' && !state.publisher && overview) {
        body = (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {publishers.map((p) => (
                    <li key={p.id}>
                        <button type="button" className={`${btnOutline} h-auto w-full justify-start py-3`} onClick={() => update({ publisher: p.id })}>
                            {p.id === 'community' ? t('admin.console.extensions.market.badges.community') : p.name} · {t('admin.console.extensions.market.publisher.count', { count: p.rows.length })}
                        </button>
                    </li>
                ))}
            </ul>
        );
    } else {
        const empty = page.total === 0;
        const emptyNode = !empty ? null
            : state.section === 'starred' && !filtersOn ? <EmptyState icon={<StarIcon className="h-10 w-10" />} title={t('admin.console.extensions.market.stars.emptyTitle')} description={t('admin.console.extensions.market.stars.emptyBody')} />
            : state.section === 'installed' && !filtersOn ? <EmptyState icon={<Puzzle className="h-10 w-10" />} title={t('admin.console.extensions.market.installedEmpty.title')} description={t('admin.console.extensions.market.installedEmpty.body')} />
            : state.section === 'community' && !filtersOn ? <EmptyState icon={<Users className="h-10 w-10" />} title={t('admin.console.extensions.market.communityEmpty.title')} description={t('admin.console.extensions.market.communityEmpty.body')} />
            : (
                <EmptyState
                    icon={<Puzzle className="h-10 w-10" />}
                    title={t('admin.console.common.emptyTitle')}
                    description={t('admin.console.extensions.catalog.emptyFiltered')}
                    action={<button type="button" className={btnOutline} onClick={() => update({ ...DEFAULT_MARKET_STATE, section: state.section, suite: state.suite, publisher: state.publisher, view: state.view, ext: state.ext })}>{t('admin.console.common.clearFilters')}</button>}
                />
            );
        body = (
            <>
                {state.section === 'suites' && activeSuite && (
                    <SuiteHeader group={activeSuite} canInstall={!actions.readOnly} busy={actions.busyId !== null} onBack={() => update({ suite: '' })} onInstallSuite={() => onInstallSuite(activeSuite.id)} />
                )}
                {state.section === 'publisher' && activePublisher && <PublisherHeader group={activePublisher} onBack={() => update({ publisher: '', section: 'discover' })} />}
                {state.section === 'official' && <OfficialHeader />}
                <p role="status" aria-live="polite" className="mb-3 text-xs text-muted-foreground">
                    {t('admin.console.extensions.market.results.count', { count: page.total, section: sectionLabel })}
                    {page.total > page.shown ? ` · ${t('admin.console.extensions.market.results.shown', { shown: page.shown, total: page.total })}` : ''}
                </p>
                {emptyNode ?? (
                    <>
                        <ul className={state.view === 'list' ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3'}>
                            {page.items.map((row) => (
                                <ExtensionCard key={row.id} row={row} actions={actions} onOpen={onOpen} market={cardMarket(row)} />
                            ))}
                        </ul>
                        {page.hasMore && (
                            <div className="mt-4 flex justify-center">
                                <button type="button" className={btnOutline} onClick={() => update({ page: state.page + 1 })}>{t('admin.console.extensions.market.results.more')}</button>
                            </div>
                        )}
                    </>
                )}
            </>
        );
    }

    return (
        <Card title={t('admin.console.extensions.catalog.title')} id="catalog" bodyClassName="px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
                <MarketSectionSelect counts={counts} state={state} onNavigate={navigate} />
                <MarketSidebar counts={counts} state={state} onNavigate={navigate} />
                <div className="min-w-0 flex-1">
                    <MarketToolbar state={state} onChange={change} />
                    {body}
                </div>
            </div>
        </Card>
    );
}
