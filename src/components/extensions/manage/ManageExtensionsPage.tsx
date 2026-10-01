'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { mutate } from 'swr';
import { Search, X } from 'lucide-react';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { useExtensionPrefs } from '@/hooks/useExtensionPrefs';
import { useSession } from '@/components/SessionProvider';
import { getPrefs, setPrefs } from '@/lib/expansions/client/prefs';
import { CATEGORY_IDS, type CategoryId } from '@/lib/expansions/manage/categories';
import {
    STATUS_FILTERS, buildRows, categoryCounts, filterRows, orderableIds, sortRows, statusCounts, tagCounts,
    type ExtensionRow, type StatusFilter,
} from '@/lib/expansions/manage/model';
import { Button } from '@/components/expansions/kit/Actions';
import { Alert, Chip, Empty, Skeleton, Spinner } from '@/components/expansions/kit/Feedback';
import { ExtensionItem, type ViewMode } from './ExtensionItem';
import { ExtensionDetail } from './ExtensionDetail';
import { ErrorsPanel } from './ErrorsPanel';
import { useCanSeeTools, useCatalogInfo, useExtensionUpdater, useLiveExtensionErrors, useNow } from './hooks';
import { fmt, useManageStrings } from './strings';

/** En desarrollo con tema de empresa forzado la pagina se pinta sin sesion (para probarla). */
function devBypass(): boolean {
    return process.env.NODE_ENV !== 'production' && !!process.env.NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE;
}

function useIsNarrow(): boolean {
    const [narrow, setNarrow] = React.useState(false);
    React.useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const query = window.matchMedia('(max-width: 639px)');
        const update = () => setNarrow(query.matches);
        update();
        query.addEventListener?.('change', update);
        return () => query.removeEventListener?.('change', update);
    }, []);
    return narrow;
}

export function ManageExtensionsPage() {
    const { s, lang, statusLabel, categoryLabel } = useManageStrings();
    const { data: session, status: sessionStatus } = useSession();
    const domain = useDomainConfig();
    const { isLoading, isError, extensionsLoaded, isStale, isRetrying, retry } = domain;
    // Incluye las pausadas por la IA (aiBlock.blocked): se listan con su motivo, no se montan.
    const extensions = domain.allExtensions ?? domain.extensions;
    const { prefs, setEnabled, move } = useExtensionPrefs();
    const errors = useLiveExtensionErrors();
    const catalog = useCatalogInfo();
    const canOpenPlayground = useCanSeeTools();
    // El catalogo solo lo devuelve la ruta de administradores: si hay catalogo, este usuario puede intentar actualizar.
    const updater = useExtensionUpdater(catalog.size > 0);
    const now = useNow();
    const router = useRouter();
    const searchParams = useSearchParams();
    const narrow = useIsNarrow();

    const [query, setQuery] = React.useState('');
    const [category, setCategory] = React.useState<CategoryId | 'all'>('all');
    const [status, setStatus] = React.useState<StatusFilter>('all');
    const [tag, setTag] = React.useState<string | null>(null);
    const [chosenView, setChosenView] = React.useState<ViewMode | null>(null);
    const view: ViewMode = chosenView ?? (narrow ? 'list' : 'cards');
    const [openId, setOpenId] = React.useState<string | null>(() => searchParams?.get('ext') ?? null);
    const [announcement, setAnnouncement] = React.useState('');
    const tick = React.useRef(false);

    const announce = React.useCallback((message: string) => {
        tick.current = !tick.current;
        // El caracter invisible final fuerza a los lectores a repetir un mensaje identico.
        setAnnouncement(tick.current ? message : `${message}​`);
    }, []);

    // --- datos
    const rows = React.useMemo(() => buildRows({ extensions, prefs, errors, catalog, locale: lang }), [extensions, prefs, errors, catalog, lang]);
    const sorted = React.useMemo(() => sortRows(rows, prefs), [rows, prefs]);
    const ids = React.useMemo(() => orderableIds(rows, prefs), [rows, prefs]);
    const hasPrice = rows.some((r) => r.isPaid !== null);

    const visible = React.useMemo(() => filterRows(sorted, { query, category, status, tag }), [sorted, query, category, status, tag]);
    const statusTotals = React.useMemo(() => statusCounts(filterRows(sorted, { query, category, tag })), [sorted, query, category, tag]);
    const catTotals = React.useMemo(() => categoryCounts(filterRows(sorted, { query, status, tag })), [sorted, query, status, tag]);
    const tags = React.useMemo(() => tagCounts(filterRows(sorted, { query, category, status })), [sorted, query, category, status]);
    const filtering = query.trim() !== '' || category !== 'all' || status !== 'all' || tag !== null;
    const hasCustomOrder = prefs.order.length > 0;

    // --- detalle (?ext=id)
    const urlExt = searchParams?.get('ext') ?? null;
    React.useEffect(() => { setOpenId(urlExt); }, [urlExt]);
    const opened = openId ? rows.find((r) => r.id === openId) ?? null : null;
    const openDetail = React.useCallback((row: ExtensionRow) => {
        setOpenId(row.id);
        router.replace(`/extensions?ext=${encodeURIComponent(row.id)}`, { scroll: false });
    }, [router]);
    const closeDetail = React.useCallback(() => {
        setOpenId(null);
        router.replace('/extensions', { scroll: false });
    }, [router]);

    // --- acciones
    const onToggle = React.useCallback((row: ExtensionRow, enabled: boolean) => {
        // Una obligatoria no se puede desactivar (el servidor tambien lo ignora): el interruptor ya esta bloqueado.
        if (row.mandatory && !enabled) return;
        setEnabled(row.id, enabled);
        announce(fmt(enabled ? s.toggledOn : s.toggledOff, { name: row.name }));
    }, [setEnabled, announce, s]);

    const onMove = React.useCallback((row: ExtensionRow, direction: -1 | 1) => {
        const index = ids.indexOf(row.id);
        const target = index + direction;
        if (index < 0) return;
        if (target < 0 || target >= ids.length) { announce(fmt(s.movedNot, { name: row.name, n: index + 1 })); return; }
        move(ids, row.id, direction);
        announce(fmt(s.moved, { name: row.name, n: target + 1, total: ids.length }));
    }, [ids, move, announce, s]);

    const [updateNotice, setUpdateNotice] = React.useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
    const onUpdate = React.useCallback(async (row: ExtensionRow) => {
        setUpdateNotice(null);
        const result = await updater.update(row.id);
        const text = result.ok
            ? fmt(s.updateDone, { name: row.name, catalog: result.to ?? row.catalogVersion ?? '' })
            : result.reason === 'invalid-catalog' ? s.updateInvalidCatalog : result.reason === 'forbidden' ? s.updateAdminOnly : fmt(s.updateFailed, { name: row.name });
        announce(text);
        setUpdateNotice({ tone: result.ok ? 'success' : 'danger', text });
    }, [updater, announce, s]);

    const resetOrder = () => { setPrefs({ ...getPrefs(), order: [] }); announce(s.resetDone); };
    const clearFilters = () => { setQuery(''); setCategory('all'); setStatus('all'); setTag(null); };

    // --- acceso
    const allowed = sessionStatus === 'authenticated' || !!session?.user || devBypass();
    if (!allowed && sessionStatus === 'loading') {
        return <main className="mx-auto w-full max-w-6xl p-6"><Spinner label={s.checkingSession} /></main>;
    }
    if (!allowed) {
        return (
            <main className="mx-auto w-full max-w-2xl space-y-4 p-6">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">{s.title}</h1>
                <Alert tone="warning" message={s.sessionRequired}>
                    <Link href="/login" className="w-fit text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{s.goLogin}</Link>
                </Alert>
            </main>
        );
    }

    const shownStatuses = STATUS_FILTERS.filter((f) => (f === 'paid' || f === 'free') ? hasPrice : true);
    const shownCategories = CATEGORY_IDS.filter((id) => (catTotals.get(id) ?? 0) > 0 || category === id);

    return (
        <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6" data-testid="manage-extensions">
            <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="live-region">{announcement}</div>

            <header className="space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">{s.title}</h1>
                <p className="max-w-2xl text-sm text-muted-foreground">{s.subtitle}</p>
            </header>

            {updateNotice && <Alert tone={updateNotice.tone} message={updateNotice.text} />}

            {isError && (
                <Alert tone="danger" title={s.loadErrorTitle} message={isStale ? s.loadErrorStale : s.loadError}>
                    <Button label={isRetrying ? s.retrying : s.retry} variant="outline" size="sm" disabled={isRetrying} onPress={() => { if (retry) retry(); else void mutate('/api/config'); }} />
                </Alert>
            )}

            {isLoading || (!isError && extensionsLoaded === false && rows.length === 0) ? (
                <div aria-busy="true" aria-label={s.loading} className="space-y-3"><Skeleton variant="rect" size="sm" /><Skeleton variant="rect" size="sm" /></div>
            ) : rows.length === 0 ? (
                !isError && <Empty icon="Puzzle" title={s.emptyTitle} description={s.emptyText} />
            ) : (
                <>
                    <section aria-label={s.searchLabel} className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative min-w-0 flex-1 basis-64">
                                <label htmlFor="ext-search" className="sr-only">{s.searchLabel}</label>
                                <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <input
                                    id="ext-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={s.searchPlaceholder} autoComplete="off"
                                    className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                />
                                {query && (
                                    <button type="button" onClick={() => setQuery('')} aria-label={s.clearSearch} className="absolute right-1.5 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                        <X size={14} aria-hidden="true" />
                                    </button>
                                )}
                            </div>
                            <div role="group" aria-label={s.viewLabel} className="inline-flex gap-1">
                                <Chip label={s.viewCards} icon="LayoutGrid" selected={view === 'cards'} onPress={() => setChosenView('cards')} />
                                <Chip label={s.viewList} icon="List" selected={view === 'list'} onPress={() => setChosenView('list')} />
                            </div>
                        </div>

                        <div role="group" aria-label={s.statusLabel} className="flex flex-wrap gap-1.5">
                            {shownStatuses.map((f) => <Chip key={f} label={`${statusLabel(f)} (${statusTotals[f]})`} selected={status === f} onPress={() => setStatus(f)} />)}
                        </div>
                        <div role="group" aria-label={s.categoryLabel} className="flex flex-wrap gap-1.5">
                            <Chip label={`${s.allCategories} (${Array.from(catTotals.values()).reduce((a, b) => a + b, 0)})`} selected={category === 'all'} onPress={() => setCategory('all')} />
                            {shownCategories.map((id) => <Chip key={id} label={`${categoryLabel(id)} (${catTotals.get(id) ?? 0})`} selected={category === id} onPress={() => setCategory(category === id ? 'all' : id)} />)}
                        </div>
                        {tags.length > 0 && (
                            <div role="group" aria-label={s.tagsLabel} className="flex flex-wrap gap-1.5">
                                {tags.map((t) => <Chip key={t.tag} label={`#${t.tag} (${t.count})`} selected={tag === t.tag} onPress={() => setTag(tag === t.tag ? null : t.tag)} />)}
                            </div>
                        )}
                    </section>

                    <section aria-labelledby="ext-list-title" className="space-y-3">
                        <div className="flex flex-wrap items-end justify-between gap-2">
                            <div>
                                <h2 id="ext-list-title" className="text-lg font-semibold text-foreground">{s.orderTitle}</h2>
                                <p className="text-sm text-muted-foreground">{s.orderHelp}</p>
                            </div>
                            <div className="flex items-center gap-3">
                                <p aria-live="polite" className="text-sm text-muted-foreground" data-testid="result-count">{visible.length === 1 ? fmt(s.resultsOne, { total: rows.length }) : fmt(s.resultsCount, { n: visible.length, total: rows.length })}</p>
                                {hasCustomOrder && <Button label={s.resetOrder} icon="RotateCcw" variant="outline" size="sm" onPress={resetOrder} />}
                            </div>
                        </div>

                        {visible.length === 0 ? (
                            <Empty icon="SearchX" title={s.noMatchTitle} description={s.noMatchText} actionLabel={filtering ? s.clearFilters : undefined} onAction={filtering ? clearFilters : undefined} />
                        ) : (
                            <ul className={view === 'cards' ? 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3' : 'flex flex-col gap-2'} data-testid="extension-list">
                                {visible.map((row) => {
                                    const index = ids.indexOf(row.id);
                                    return <ExtensionItem key={row.id} row={row} position={index >= 0 ? index + 1 : null} total={ids.length} view={view} onToggle={onToggle} onMove={onMove} onOpen={openDetail} />;
                                })}
                            </ul>
                        )}
                    </section>
                </>
            )}

            <ErrorsPanel errors={errors} rows={rows} now={now} canOpenPlayground={canOpenPlayground} announce={announce} />

            <ExtensionDetail row={opened} rows={rows} errors={errors} now={now} canOpenPlayground={canOpenPlayground} announce={announce} onToggle={onToggle} onClose={closeDetail} updater={{ canUpdate: updater.canUpdate, busyId: updater.busyId, onUpdate: (row) => { void onUpdate(row); } }} />
        </main>
    );
}
