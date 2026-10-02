'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Badge, DefinitionList, btnOutline } from '@/components/admin/console';
import { ExtensionIcon } from '@/components/expansions/ExtensionIcon';
import { useI18n } from '@/components/I18nProvider';
import type { ExtensionRow } from '@/lib/admin/extensions-view';
import { primaryState, relatedRows, suiteMates, type PrimaryState } from '@/lib/admin/marketplace/market-model';
import { MiniCard, PublisherBadges, PublisherLine, StarButton, SuiteChip, installsLabel } from './MarketParts';

/** Navegacion y favoritas que la ficha necesita del marketplace (opcional: sin ello la ficha es la de siempre). */
export interface DetailMarketProps {
    rows: readonly ExtensionRow[];
    starred: boolean;
    onToggleStar: (row: Pick<ExtensionRow, 'id' | 'name'>) => void;
    onOpenPublisher: (publisherId: string) => void;
    onOpenSuite: (suiteId: string) => void;
    onOpenRow: (row: ExtensionRow) => void;
}

const nameOf = (rows: readonly ExtensionRow[], id: string) => rows.find((r) => r.id === id)?.name ?? id;

/** Texto del estado del boton principal (lo que la ficha explica junto a los botones de accion). */
export function primaryNote(t: (k: string, p?: Record<string, string | number>) => string, state: PrimaryState, rows: readonly ExtensionRow[]): { tone: 'info' | 'warning'; text: string } | null {
    const p = (k: string, params?: Record<string, string | number>) => t(`admin.console.extensions.market.detail.primary.${k}`, params);
    switch (state.kind) {
        case 'install': return state.withDeps.length > 0 ? { tone: 'info', text: p('installWith', { libs: state.withDeps.map((id) => nameOf(rows, id)).join(', ') }) } : null;
        case 'buy': return { tone: 'info', text: p('buy') };
        case 'requires-lib': return { tone: 'warning', text: p('requiresLib', { libs: state.libs.map((id) => nameOf(rows, id)).join(', ') }) };
        case 'requires-client': return { tone: 'warning', text: p('requiresClient') };
        case 'requires-key': return { tone: 'warning', text: p('requiresKey') };
        case 'paused-ai': return { tone: 'warning', text: p('pausedAi') };
        default: return null;
    }
}

/** Cabecera de la ficha: editor con insignia, suite, instalaciones, categorias, precio, favorita y el estado del boton principal. */
export function DetailHeader({ row, market }: { row: ExtensionRow; market: DetailMarketProps }) {
    const { t } = useI18n();
    const m = row.market;
    const note = primaryNote(t, primaryState(row, market.rows), market.rows);
    return (
        <div className="space-y-2" data-testid="market-header">
            <div className="flex items-start gap-3">
                <ExtensionIcon icon={row.icon} label={row.name} size={32} />
                <div className="min-w-0 flex-1 space-y-1">
                    <PublisherLine publisher={m.publisher} onOpen={market.onOpenPublisher} />
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {m.suite && <SuiteChip suite={m.suite} onOpen={market.onOpenSuite} />}
                        {row.version && <span>{t('admin.console.extensions.card.version', { version: row.installedVersion ?? row.version })}</span>}
                        {m.installCount > 0 && <span>{installsLabel(t, m.installCount, 'detail')}</span>}
                        <span>{row.isPaid ? t('admin.console.extensions.card.price', { price: row.price, currency: row.currency }) : t('admin.console.extensions.card.free')}</span>
                    </div>
                    {m.categories.length > 0 && (
                        <div className="flex flex-wrap gap-1" aria-label={t('admin.console.extensions.market.card.categories')}>
                            {m.categories.map((c) => <Badge key={c}>{t(`admin.console.extensions.filters.categories.${c}`)}</Badge>)}
                        </div>
                    )}
                </div>
                <StarButton row={row} starred={market.starred} onToggle={market.onToggleStar} />
            </div>
            {note && <p role="note" className={`rounded-lg border p-2 text-xs ${note.tone === 'warning' ? 'border-warning/30 bg-warning/10' : 'border-info/30 bg-info/10'} text-foreground`}>{note.text}</p>}
        </div>
    );
}

/** Capturas (solo https, tamano fijo, carga diferida): sin saltos de maquetacion. */
export function Screenshots({ row }: { row: ExtensionRow }) {
    const { t } = useI18n();
    const shots = row.market.screenshots;
    // Imagenes remotas: de extensiones oficiales siempre; de terceros solo tras aceptar (el servidor del editor veria la IP del administrador).
    const [consent, setConsent] = useState(false);
    if (shots.length === 0) return null;
    if (!row.market.publisher.official && !consent) {
        return (
            <section aria-label={t('admin.console.extensions.market.detail.screenshots.title')} className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">{t('admin.console.extensions.market.detail.screenshots.title')}</h3>
                <p className="text-xs text-muted-foreground">{t('admin.console.extensions.market.detail.screenshots.loadHint')}</p>
                <button type="button" className={btnOutline} onClick={() => setConsent(true)}>{t('admin.console.extensions.market.detail.screenshots.load')}</button>
            </section>
        );
    }
    return (
        <section aria-label={t('admin.console.extensions.market.detail.screenshots.title')}>
            <h3 className="mb-2 text-sm font-semibold text-foreground">{t('admin.console.extensions.market.detail.screenshots.title')}</h3>
            <ul className="flex gap-2 overflow-x-auto pb-1">
                {shots.map((src, i) => (
                    <li key={src} className="shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt={t('admin.console.extensions.market.detail.screenshots.alt', { n: i + 1, name: row.name })} width={240} height={150} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-[150px] w-[240px] rounded-lg border border-border bg-muted object-cover" />
                    </li>
                ))}
            </ul>
        </section>
    );
}

/** Etiquetas, «Otras de esta suite» y «Relacionadas» (mini-tarjetas que abren esa ficha). */
export function SummaryMarket({ row, market }: { row: ExtensionRow; market: DetailMarketProps }) {
    const { t } = useI18n();
    const mates = suiteMates(row, market.rows);
    const related = relatedRows(row, market.rows, 4);
    return (
        <div className="space-y-4">
            <Screenshots row={row} />
            {row.market.tags.length > 0 && (
                <section aria-label={t('admin.console.extensions.market.detail.tags')}>
                    <h3 className="mb-1 text-sm font-semibold text-foreground">{t('admin.console.extensions.market.detail.tags')}</h3>
                    <ul className="flex flex-wrap gap-1">{row.market.tags.map((tag) => <li key={tag}><Badge>{tag}</Badge></li>)}</ul>
                </section>
            )}
            {mates.length > 0 && (
                <section aria-label={t('admin.console.extensions.market.detail.suiteMates')}>
                    <h3 className="mb-2 text-sm font-semibold text-foreground">{t('admin.console.extensions.market.detail.suiteMates')}</h3>
                    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">{mates.map((r) => <MiniCard key={r.id} row={r} onOpen={market.onOpenRow} />)}</ul>
                </section>
            )}
            {related.length > 0 && (
                <section aria-label={t('admin.console.extensions.market.detail.related')}>
                    <h3 className="mb-2 text-sm font-semibold text-foreground">{t('admin.console.extensions.market.detail.related')}</h3>
                    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">{related.map((r) => <MiniCard key={r.id} row={r} onOpen={market.onOpenRow} />)}</ul>
                </section>
            )}
        </div>
    );
}

/** Historial de versiones con changelog, instalada vs disponible y compatibilidad por version. */
export function VersionsTab({ row }: { row: ExtensionRow }) {
    const { t } = useI18n();
    const v = (k: string, p?: Record<string, string | number>) => t(`admin.console.extensions.market.detail.versions.${k}`, p);
    const history = row.market.history.length > 0
        ? row.market.history
        : row.version ? [{ version: row.version, status: 'published' as const, date: null, compatible: !row.incompatible, notes: [] as string[] }] : [];
    if (history.length === 0) return <p className="text-sm text-muted-foreground">{v('empty')}</p>;
    return (
        <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">{v('title')}</h3>
            <ol className="space-y-3" data-testid="version-history">
                {history.map((h) => (
                    <li key={h.version} className="rounded-lg border border-border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-foreground">v{h.version}</span>
                            {row.installedVersion === h.version && <Badge tone="success">{v('installed')}</Badge>}
                            {row.latestVersion === h.version && <Badge tone="info">{v('latest')}</Badge>}
                            {row.version === h.version && row.version !== row.latestVersion && <Badge>{v('served')}</Badge>}
                            {h.status === 'deprecated' && <Badge>{v('deprecated')}</Badge>}
                            <Badge tone={h.compatible ? 'success' : 'warning'}>{h.compatible ? v('compatible') : v('incompatible')}</Badge>
                            {h.date && <span className="text-xs text-muted-foreground">{v('date', { date: h.date })}</span>}
                        </div>
                        {h.notes.length > 0 ? (
                            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">{h.notes.map((n, i) => <li key={i} className="break-words">{n}</li>)}</ul>
                        ) : (
                            <p className="mt-2 text-xs text-muted-foreground">{v('noNotes')}</p>
                        )}
                    </li>
                ))}
            </ol>
        </div>
    );
}

type DepState = 'active' | 'inactive' | 'missing' | 'unavailable';
const depState = (dep: ExtensionRow | undefined): DepState => (!dep ? 'unavailable' : !dep.installed ? 'missing' : !dep.enabled ? 'inactive' : 'active');
const STATE_TONE: Record<DepState, 'success' | 'warning' | 'neutral' | 'danger'> = { active: 'success', inactive: 'warning', missing: 'neutral', unavailable: 'danger' };

function DepNode({ id, range, rows, depth, seen }: { id: string; range: string; rows: readonly ExtensionRow[]; depth: number; seen: ReadonlySet<string> }) {
    const { t } = useI18n();
    const dep = rows.find((r) => r.id === id);
    const state = depState(dep);
    const children = dep && depth < 4 && !seen.has(id) ? Object.entries(dep.dependencies) : [];
    return (
        <li>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
                <span className="text-sm font-medium text-foreground">{dep?.name ?? id}</span>
                <span className="font-mono text-xs text-muted-foreground">{t('admin.console.extensions.market.detail.deps.range', { range })}</span>
                <Badge tone={STATE_TONE[state]}>{t(`admin.console.extensions.market.detail.deps.state.${state}`)}</Badge>
            </div>
            {children.length > 0 && (
                <ul className="ml-4 mt-1 space-y-1 border-l border-border pl-3">
                    {children.map(([cid, crange]) => <DepNode key={cid} id={cid} range={crange} rows={rows} depth={depth + 1} seen={new Set([...seen, id])} />)}
                </ul>
            )}
        </li>
    );
}

/** Arbol de dependencias (con estado de cada una) y quien depende de esta extension. */
export function DependenciesTab({ row, rows }: { row: ExtensionRow; rows: readonly ExtensionRow[] }) {
    const { t } = useI18n();
    const d = (k: string) => t(`admin.console.extensions.market.detail.deps.${k}`);
    const deps = Object.entries(row.dependencies);
    const dependents = rows.filter((r) => r.id !== row.id && row.id in r.dependencies);
    return (
        <div className="space-y-4">
            <section>
                <h3 className="mb-2 text-sm font-semibold text-foreground">{d('title')}</h3>
                {deps.length === 0 ? <p className="text-sm text-muted-foreground">{d('none')}</p> : (
                    <ul className="space-y-1" data-testid="dependency-tree">{deps.map(([id, range]) => <DepNode key={id} id={id} range={range} rows={rows} depth={0} seen={new Set([row.id])} />)}</ul>
                )}
            </section>
            <section>
                <h3 className="mb-2 text-sm font-semibold text-foreground">{d('dependents')}</h3>
                {dependents.length === 0 ? <p className="text-sm text-muted-foreground">{d('noDependents')}</p> : (
                    <ul className="flex flex-wrap gap-2">{dependents.map((r) => <li key={r.id}><Badge>{r.name}</Badge></li>)}</ul>
                )}
            </section>
        </div>
    );
}

/** Soporte e informacion: editor, enlace, licencia, identificador, suite y categorias. */
export function SupportTab({ row, onOpenPublisher }: { row: ExtensionRow; onOpenPublisher?: (publisherId: string) => void }) {
    const { t } = useI18n();
    const s = (k: string) => t(`admin.console.extensions.market.detail.support.${k}`);
    const m = row.market;
    return (
        <div className="space-y-4">
            <DefinitionList
                items={[
                    { label: s('publisher'), value: <PublisherLine publisher={m.publisher} onOpen={onOpenPublisher} /> },
                    {
                        label: s('website'),
                        value: m.publisher.url
                            ? <a href={m.publisher.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">{m.publisher.url}<ExternalLink className="h-3 w-3" aria-hidden="true" /></a>
                            : s('none'),
                    },
                    { label: s('license'), value: m.publisher.official ? s('licenseValue') : s('licenseCommunity') },
                    { label: s('id'), value: <code className="break-all text-xs">{row.id}</code> },
                    { label: s('suite'), value: m.suite?.name ?? s('none') },
                    { label: s('categories'), value: m.categories.length ? m.categories.map((c) => t(`admin.console.extensions.filters.categories.${c}`)).join(', ') : s('none') },
                ]}
            />
            <p className="text-xs text-muted-foreground"><PublisherBadges publisher={m.publisher} /></p>
        </div>
    );
}
