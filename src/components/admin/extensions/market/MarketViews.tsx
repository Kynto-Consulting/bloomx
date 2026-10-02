'use client';

import { ArrowLeft, ExternalLink, Layers } from 'lucide-react';
import { ExtensionIcon } from '@/components/expansions/ExtensionIcon';
import { Badge, btnOutline, btnPrimary } from '@/components/admin/console';
import { useI18n } from '@/components/I18nProvider';
import type { ExtensionRow } from '@/lib/admin/extensions-view';
import { discoverSections, type PublisherGroup, type SuiteGroup } from '@/lib/admin/marketplace/market-model';
import { MiniCard, PublisherBadges, useTextOr } from './MarketParts';

/** «Descubrir»: destacadas, novedades, populares y recomendadas segun lo ya instalado. Cada bloque enlaza a la lista completa. */
export function DiscoverView({ rows, onOpen, onSeeAll }: { rows: readonly ExtensionRow[]; onOpen: (row: ExtensionRow) => void; onSeeAll: (sort: 'popular' | 'recent' | 'relevance', origin?: 'official') => void }) {
    const { t } = useI18n();
    const sections = discoverSections(rows);
    const blocks: Array<{ key: 'featured' | 'fresh' | 'popular' | 'recommended'; rows: ExtensionRow[]; seeAll?: () => void }> = [
        { key: 'recommended', rows: sections.recommended },
        { key: 'featured', rows: sections.featured, seeAll: () => onSeeAll('relevance', 'official') },
        { key: 'popular', rows: sections.popular, seeAll: () => onSeeAll('popular') },
        { key: 'fresh', rows: sections.fresh, seeAll: () => onSeeAll('recent') },
    ];
    const visible = blocks.filter((b) => b.rows.length > 0);
    if (visible.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">{t('admin.console.extensions.market.discover.empty')}</p>;
    return (
        <div className="space-y-6">
            {visible.map((b) => (
                <section key={b.key} aria-labelledby={`disc-${b.key}`}>
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                        <div>
                            <h3 id={`disc-${b.key}`} className="text-sm font-semibold text-foreground">{t(`admin.console.extensions.market.discover.${b.key}`)}</h3>
                            <p className="text-xs text-muted-foreground">{t(`admin.console.extensions.market.discover.${b.key}Hint`)}</p>
                        </div>
                        {b.seeAll && <button type="button" className="text-xs font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={b.seeAll}>{t('admin.console.extensions.market.discover.seeAll')}</button>}
                    </div>
                    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">{b.rows.map((r) => <MiniCard key={r.id} row={r} onOpen={onOpen} />)}</ul>
                </section>
            ))}
        </div>
    );
}

/** Carpetas de suites (marcas): al abrir una se ven sus extensiones. */
export function SuiteGrid({ groups, onOpen }: { groups: readonly SuiteGroup[]; onOpen: (suiteId: string) => void }) {
    const { t } = useI18n();
    const textOr = useTextOr();
    if (groups.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">{t('admin.console.extensions.market.suites.empty')}</p>;
    return (
        <div className="space-y-3">
            <p className="max-w-3xl text-sm text-muted-foreground">{t('admin.console.extensions.market.suites.intro')}</p>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {groups.map((g) => (
                    <li key={g.id}>
                        <button
                            type="button"
                            onClick={() => onOpen(g.id)}
                            aria-label={`${t('admin.console.extensions.market.suites.open')} ${g.name}`}
                            className="flex h-full w-full items-start gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            {g.icon ? <ExtensionIcon icon={g.icon} label={g.name} size={32} /> : <Layers className="h-8 w-8 text-muted-foreground" aria-hidden="true" />}
                            <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold text-foreground">{g.name}</span>
                                <span className="mt-0.5 block text-xs text-muted-foreground">
                                    {t('admin.console.extensions.market.suites.count', { count: g.rows.length })} · {t('admin.console.extensions.market.suites.installedOf', { installed: g.installed, total: g.rows.length })}
                                </span>
                                <span className="mt-2 block line-clamp-2 text-xs text-muted-foreground">{textOr(`admin.console.extensions.market.suiteDesc.${g.id}`, 'admin.console.extensions.market.suiteDesc.generic', { name: g.name })}</span>
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

/** Cabecera de una suite abierta: descripcion, progreso e «Instalar la suite». */
export function SuiteHeader({ group, canInstall, busy, onBack, onInstallSuite }: { group: SuiteGroup; canInstall: boolean; busy: boolean; onBack: () => void; onInstallSuite: () => void }) {
    const { t } = useI18n();
    const textOr = useTextOr();
    const complete = group.installed === group.rows.length;
    return (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-muted/30 p-4">
            <div className="flex min-w-0 items-start gap-3">
                {group.icon ? <ExtensionIcon icon={group.icon} label={group.name} size={32} /> : <Layers className="h-9 w-9 text-muted-foreground" aria-hidden="true" />}
                <div className="min-w-0">
                    <h3 className="text-base font-semibold text-foreground">{group.name}</h3>
                    <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{textOr(`admin.console.extensions.market.suiteDesc.${group.id}`, 'admin.console.extensions.market.suiteDesc.generic', { name: group.name })}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{t('admin.console.extensions.market.suites.installedOf', { installed: group.installed, total: group.rows.length })}</p>
                </div>
            </div>
            <div className="flex flex-wrap gap-2">
                <button type="button" className={btnOutline} onClick={onBack}><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t('admin.console.extensions.market.suites.back')}</button>
                {canInstall && (
                    <button type="button" className={btnPrimary} disabled={busy || complete} onClick={onInstallSuite}>
                        {complete ? t('admin.console.extensions.market.suites.allInstalled') : t('admin.console.extensions.market.suites.installSuite')}
                    </button>
                )}
            </div>
        </header>
    );
}

/** Pagina de un editor/marca: nombre, insignias, descripcion y enlace (solo https). */
export function PublisherHeader({ group, onBack }: { group: PublisherGroup; onBack: () => void }) {
    const { t } = useI18n();
    const textOr = useTextOr();
    const desc = group.id === 'bloomx' ? t('admin.console.extensions.market.publisher.desc.bloomx')
        : group.id === 'community' ? t('admin.console.extensions.market.publisher.desc.community')
        : textOr(`admin.console.extensions.market.publisher.desc.${group.id}`, 'admin.console.extensions.market.publisher.desc.generic', { name: group.name });
    return (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-muted/30 p-4">
            <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('admin.console.extensions.market.publisher.title')}</p>
                <h3 className="mt-0.5 flex flex-wrap items-center gap-2 text-base font-semibold text-foreground">
                    {group.id === 'community' ? t('admin.console.extensions.market.badges.community') : group.name}
                    <PublisherBadges publisher={{ id: group.id, name: group.name, icon: group.icon, url: group.url, official: group.official, verified: group.verified }} />
                </h3>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{desc}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('admin.console.extensions.market.publisher.count', { count: group.rows.length })}</p>
                {group.url && (
                    <a href={group.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-2 hover:underline">
                        {t('admin.console.extensions.market.publisher.website')}<ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                )}
            </div>
            <button type="button" className={btnOutline} onClick={onBack}><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t('admin.console.extensions.market.publisher.back')}</button>
        </header>
    );
}

/** Cabecera de «Del proveedor»: texto de que son las oficiales. */
export function OfficialHeader() {
    const { t } = useI18n();
    return (
        <header className="mb-4 rounded-xl border border-border bg-muted/30 p-4">
            <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
                {t('admin.console.extensions.market.nav.official')}
                <Badge tone="info">{t('admin.console.extensions.market.badges.official')}</Badge>
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('admin.console.extensions.market.official.body')}</p>
        </header>
    );
}
