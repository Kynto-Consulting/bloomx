'use client';

/**
 * Galeria VIVA de componentes: catalogo generado desde UI_COMPONENTS (props, defectos, docs), ejemplos renderizados
 * con JsonRenderer (backend simulado), copiar JSON, abrir en el playground y vista en todos los temas.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ALIGNS, BUTTON_VARIANTS, DENSITIES, FORBIDDEN_PROP_KEYS, GAPS, SIZES, SURFACE_VARIANTS, TONES, UI_COMPONENTS, UI_LIMITS } from '@/lib/expansions/ui-schema';
import { FILTER_NAMES } from '@/lib/expansions/expressions';
import { UI_EXAMPLES, type UiExample } from '@/lib/expansions/ui-examples';
import { actionRows, commonPropRows, filterCatalog, propRows, CATEGORY_ORDER } from '@/lib/expansions/playground/schema-docs';
import { galleryThemeIds } from '@/lib/expansions/playground/theme-scope';
import { THEME_KEY, queueForPlayground, safeGet, safeSet } from '@/lib/expansions/playground/storage';
import { ExamplePreview, LazyMount } from './LivePreview';
import { ThemePicker } from './ThemePicker';
import { ThemeChoicesProvider, useThemeChoices } from './ThemeScope';
import { useToolStrings } from './strings';

const btn = 'inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const card = 'rounded-lg border border-border bg-card p-4 text-card-foreground';
const th = 'px-2 py-1.5 text-left text-xs font-semibold text-muted-foreground';
const td = 'px-2 py-1.5 align-top text-xs';

function PropsTable({ rows, caption }: { rows: ReturnType<typeof propRows>; caption: string }) {
    const t = useToolStrings();
    if (rows.length === 0) return <p className="text-xs text-muted-foreground">{t.noProps}</p>;
    return (
        <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[32rem] border-collapse">
                <caption className="sr-only">{caption}</caption>
                <thead className="bg-muted"><tr><th scope="col" className={th}>{t.colProp}</th><th scope="col" className={th}>{t.colType}</th><th scope="col" className={th}>{t.colDefault}</th><th scope="col" className={th}>{t.colDoc}</th></tr></thead>
                <tbody className="divide-y divide-border">
                    {rows.map((row) => (
                        <tr key={row.name}>
                            <th scope="row" className={`${td} font-mono font-semibold text-foreground`}>{row.name}{row.required && <span className="ml-1 text-destructive" title={t.required} aria-label={t.required}>*</span>}</th>
                            <td className={`${td} break-words font-mono text-foreground`}>{row.type}</td>
                            <td className={`${td} font-mono text-muted-foreground`}>{row.def || '-'}</td>
                            <td className={`${td} text-foreground`}>{row.doc}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ExampleBlock({ type, example, index, themeId, allThemes }: { type: string; example: UiExample; index: number; themeId: string; allThemes: boolean }) {
    const t = useToolStrings();
    const router = useRouter();
    const choices = useThemeChoices();
    const [status, setStatus] = useState('');
    const json = useMemo(() => JSON.stringify(example.node, null, 2), [example]);
    useEffect(() => {
        if (!status) return;
        const handle = setTimeout(() => setStatus(''), 2500);
        return () => clearTimeout(handle);
    }, [status]);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(json);
            setStatus(t.copied);
        } catch {
            setStatus(t.copyFailed);
        }
    };
    const open = () => {
        if (!queueForPlayground(json)) setStatus(t.storageFailed);
        router.push('/extensions/playground');
    };
    const themes = useMemo(() => (allThemes ? galleryThemeIds(choices) : []), [allThemes, choices]);
    const id = `${type}-${index}`;

    return (
        <div className="space-y-2" data-testid={`example-${id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-medium text-foreground">{example.title}</h4>
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={btn} onClick={copy}>{t.copyJson}</button>
                    <button type="button" className={btn} onClick={open}>{t.openInPlayground}</button>
                    <span role="status" aria-live="polite" className="min-w-[4rem] text-xs text-muted-foreground">{status}</span>
                </div>
            </div>
            {allThemes ? (
                <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label={t.allThemes}>
                    {themes.map((tid) => (
                        <li key={tid} className="min-w-0 space-y-1">
                            <p className="truncate text-[11px] font-medium text-muted-foreground">{choices.find((c) => c.id === tid)?.label ?? tid}</p>
                            <LazyMount minHeight={96}><ExamplePreview node={example.node} themeId={tid} label={choices.find((c) => c.id === tid)?.label} /></LazyMount>
                        </li>
                    ))}
                </ul>
            ) : (
                <LazyMount minHeight={96}><ExamplePreview node={example.node} themeId={themeId} label={`${type}: ${example.title}`} /></LazyMount>
            )}
            <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t.showJson}</summary>
                <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] text-foreground">{json}</pre>
            </details>
        </div>
    );
}

function ComponentCard({ type, themeId, allThemes }: { type: string; themeId: string; allThemes: boolean }) {
    const t = useToolStrings();
    const spec = UI_COMPONENTS[type];
    const examples = UI_EXAMPLES[type] ?? [];
    const rows = useMemo(() => propRows(spec.props), [spec]);
    return (
        <article id={`c-${type}`} aria-labelledby={`h-${type}`} className={`${card} space-y-3`}>
            <header className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                    <h3 id={`h-${type}`} className="font-mono text-base font-semibold text-foreground">{type}</h3>
                    <span className="rounded-full bg-chip px-2 py-0.5 text-[11px] font-medium text-chip-foreground">{t.categories[spec.category] ?? spec.category}</span>
                    {spec.children && <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{t.acceptsChildren}</span>}
                </div>
                <p className="text-sm text-foreground">{spec.doc}</p>
            </header>
            <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.props}</h4>
                <PropsTable rows={rows} caption={`${t.props}: ${type}`} />
            </div>
            <div className="space-y-4">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.examplesTitle}</h4>
                {examples.map((example, index) => <ExampleBlock key={index} type={type} example={example} index={index} themeId={themeId} allThemes={allThemes} />)}
            </div>
        </article>
    );
}

function Chips({ items }: { items: readonly (string | number)[] }) {
    return <span className="inline-flex flex-wrap gap-1">{items.map((item) => <code key={String(item)} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">{String(item)}</code>)}</span>;
}

function ThemingRules() {
    const t = useToolStrings();
    const allowed: Array<[string, readonly (string | number)[]]> = [
        ['tone', TONES], ['variant (BUTTON)', BUTTON_VARIANTS], ['variant (BADGE/superficies)', SURFACE_VARIANTS], ['size', SIZES], ['density', DENSITIES], ['align', ALIGNS], ['gap / padding', GAPS],
    ];
    return (
        <section id="rules" aria-labelledby="rules-h" className={`${card} space-y-4`}>
            <h2 id="rules-h" className="text-lg font-semibold text-foreground">{t.rulesTitle}</h2>
            <p className="text-sm text-foreground">{t.rulesIntro}</p>
            <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-success">{t.rulesAllowed}</h3>
                    <dl className="space-y-1.5 text-xs">
                        {allowed.map(([name, values]) => (
                            <div key={name} className="flex flex-wrap items-baseline gap-2"><dt className="min-w-[8rem] font-mono font-semibold text-foreground">{name}</dt><dd><Chips items={values} /></dd></div>
                        ))}
                    </dl>
                </div>
                <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-destructive">{t.rulesRejected}</h3>
                    <p className="text-xs text-foreground">{t.rulesRejectedKeys}</p>
                    <Chips items={FORBIDDEN_PROP_KEYS} />
                    <ul className="list-disc space-y-1 pl-5 text-xs text-foreground">
                        <li>{t.rulesHtml}</li>
                        <li>{t.rulesCssFn}</li>
                        <li>{t.rulesHex}</li>
                        <li>{t.rulesLimits.replace('{nodes}', String(UI_LIMITS.maxNodes)).replace('{depth}', String(UI_LIMITS.maxDepth)).replace('{kb}', String(Math.round(UI_LIMITS.maxBytes / 1024)))}</li>
                    </ul>
                    <p className="text-xs text-muted-foreground">{t.rulesMigrate}</p>
                </div>
            </div>
        </section>
    );
}

function ActionsAndExpressions() {
    const t = useToolStrings();
    const actions = useMemo(() => actionRows(), []);
    const common = useMemo(() => commonPropRows(), []);
    return (
        <section id="actions" aria-labelledby="actions-h" className={`${card} space-y-4`}>
            <h2 id="actions-h" className="text-lg font-semibold text-foreground">{t.actionsTitle}</h2>
            <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[40rem] border-collapse">
                    <caption className="sr-only">{t.actionsTitle}</caption>
                    <thead className="bg-muted"><tr><th scope="col" className={th}>{t.colAction}</th><th scope="col" className={th}>{t.colDoc}</th><th scope="col" className={th}>{t.colRequired}</th><th scope="col" className={th}>{t.colFields}</th></tr></thead>
                    <tbody className="divide-y divide-border">
                        {actions.map((action) => (
                            <tr key={action.name}>
                                <th scope="row" className={`${td} font-mono font-semibold text-foreground`}>{action.name}</th>
                                <td className={`${td} text-foreground`}>{action.doc}</td>
                                <td className={`${td} font-mono text-foreground`}>{action.required.join(', ') || '-'}</td>
                                <td className={`${td} font-mono text-muted-foreground`}>{action.fields.map((f) => f.name).join(', ') || '-'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-foreground">{t.commonProps}</h3>
                    <PropsTable rows={common} caption={t.commonProps} />
                </div>
                <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-foreground">{t.expressionsTitle}</h3>
                    <p className="text-xs text-foreground">{t.expressionsIntro}</p>
                    <h4 className="text-xs font-semibold text-muted-foreground">{t.filters}</h4>
                    <Chips items={FILTER_NAMES} />
                    <h4 className="text-xs font-semibold text-muted-foreground">{t.variables}</h4>
                    <dl className="space-y-1 text-xs">
                        <div><dt className="inline font-mono font-semibold text-foreground">{'${state.$loading.<clave>}'}</dt><dd className="inline text-foreground"> {t.varLoading}</dd></div>
                        <div><dt className="inline font-mono font-semibold text-foreground">{'${state.$error.<clave>}'}</dt><dd className="inline text-foreground"> {t.varError}</dd></div>
                        <div><dt className="inline font-mono font-semibold text-foreground">{'${context.*} ${state.*}'}</dt><dd className="inline text-foreground"> {t.varRoots}</dd></div>
                        <div><dt className="inline font-mono font-semibold text-foreground">{'${value} ${result} ${row} ${item} ${formData}'}</dt><dd className="inline text-foreground"> {t.varAliases}</dd></div>
                    </dl>
                </div>
            </div>
        </section>
    );
}

function GalleryInner() {
    const t = useToolStrings();
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('all');
    const [themeId, setThemeId] = useState('light');
    const [allThemes, setAllThemes] = useState(false);

    useEffect(() => {
        const saved = safeGet(THEME_KEY);
        if (saved) setThemeId(saved);
    }, []);
    const changeTheme = (id: string) => { setThemeId(id); safeSet(THEME_KEY, id); };

    const groups = useMemo(() => filterCatalog(query, category), [query, category]);
    const total = groups.reduce((n, g) => n + g.entries.length, 0);

    return (
        <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                    <h1 className="text-2xl font-semibold text-foreground">{t.galleryTitle}</h1>
                    <p className="max-w-3xl text-sm text-muted-foreground">{t.galleryIntro}</p>
                </div>
                <Link href="/extensions/playground" className="text-sm text-link underline-offset-4 hover:text-link-hover hover:underline">{t.goToPlayground}</Link>
            </header>

            <section aria-label={t.toolbar} className={`${card} sticky top-0 z-10 flex flex-wrap items-end gap-3`}>
                <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
                    <label htmlFor="gal-search" className="text-xs font-medium text-muted-foreground">{t.search}</label>
                    <input id="gal-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.searchPlaceholder} className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </div>
                <div className="flex flex-col gap-1">
                    <label htmlFor="gal-category" className="text-xs font-medium text-muted-foreground">{t.category}</label>
                    <select id="gal-category" value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <option value="all">{t.allCategories}</option>
                        {CATEGORY_ORDER.map((c) => <option key={c} value={c}>{t.categories[c]}</option>)}
                    </select>
                </div>
                <ThemePicker id="gal-theme" value={themeId} onChange={changeTheme} />
                <label className="flex h-9 items-center gap-2 text-sm text-foreground">
                    <input type="checkbox" role="switch" checked={allThemes} onChange={(e) => setAllThemes(e.target.checked)} className="h-4 w-4 accent-primary" />
                    <span>{t.allThemes}</span>
                </label>
                <nav aria-label={t.sections} className="flex h-9 items-center gap-3 text-sm">
                    <a href="#rules" className="text-link hover:text-link-hover hover:underline">{t.rulesTitle}</a>
                    <a href="#actions" className="text-link hover:text-link-hover hover:underline">{t.actionsTitle}</a>
                </nav>
            </section>

            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{t.resultsCount.replace('{n}', String(total))}</p>

            <div className="space-y-8">
                {groups.length === 0 && <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t.noResults}</p>}
                {groups.map((group) => (
                    <section key={group.category} aria-labelledby={`cat-${group.category}`} className="space-y-4">
                        <h2 id={`cat-${group.category}`} className="text-lg font-semibold text-foreground">{t.categories[group.category] ?? group.category} <span className="text-sm font-normal text-muted-foreground">({group.entries.length})</span></h2>
                        {group.entries.map(({ type }) => <ComponentCard key={type} type={type} themeId={themeId} allThemes={allThemes} />)}
                    </section>
                ))}
                <ThemingRules />
                <ActionsAndExpressions />
            </div>
        </main>
    );
}

export function Gallery() {
    return (
        <ThemeChoicesProvider>
            <GalleryInner />
        </ThemeChoicesProvider>
    );
}
