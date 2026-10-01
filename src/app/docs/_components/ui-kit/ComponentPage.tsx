'use client';

import { useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { ArrowLeft, ArrowRight, Check, Copy } from 'lucide-react';
import { COMMON_PROPS, UI_ACTIONS, UI_COMPONENTS } from '@/lib/expansions/ui-schema';
import { UI_EXAMPLES } from '@/lib/expansions/ui-examples';
import { useI18n } from '@/components/I18nProvider';
import { cn } from '@/lib/utils';
import { Inline } from '../DocView';
import { ui } from '../../_content/ui';
import { KIT_BASE, kitCategoryLabel, kitDescription, kitHref, kitNeighbours } from '../../_content/ui-kit/kit';
import { actionsReceived, actionsUsed, eventDocs, manifestSnippet, nestedDocs, propDocRows, stateUsage, usageOf, type PropDocRow } from '../../_content/ui-kit/component-docs';
import { ACTIONS_ANCHOR } from '../../_content/ui-kit/kit';
import { fill, kitStrings, type KitStrings } from './strings';
import type { Locale } from '../../_content/types';

// El simulador (renderer + kit + editor) solo se descarga en estas paginas y fuera del render del servidor.
const Simulator = dynamic(() => import('./Simulator'), {
    ssr: false,
    loading: () => <div role="status" aria-busy="true" className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">…</div>,
});

const th = 'px-3 py-2 text-left';
const cardCls = 'rounded-lg border border-border bg-card p-4 text-card-foreground';
const chip = 'rounded-full bg-chip px-2 py-0.5 text-xs font-medium text-chip-foreground';

function CodeBlock({ code, title, locale }: { code: string; title: string; locale: Locale }) {
    const [done, setDone] = useState(false);
    return (
        <figure className="overflow-hidden rounded-lg border border-border bg-code">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-muted px-3 py-1.5">
                <figcaption className="truncate font-mono text-xs text-foreground">{title}</figcaption>
                <button
                    type="button"
                    onClick={async () => { try { await navigator.clipboard.writeText(code); setDone(true); setTimeout(() => setDone(false), 1800); } catch { /* portapapeles bloqueado */ } }}
                    aria-label={ui(locale, 'copyCode')}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-card-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                    <span aria-live="polite">{done ? ui(locale, 'copied') : ui(locale, 'copy')}</span>
                </button>
            </div>
            <pre tabIndex={0} className="max-h-96 overflow-auto p-4 text-[13px] leading-6 text-code-foreground"><code>{code}</code></pre>
        </figure>
    );
}

export function PropsTable({ rows, caption, t, withRequired = true }: { rows: PropDocRow[]; caption: string; t: KitStrings; withRequired?: boolean }) {
    if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t.noProps}</p>;
    return (
        <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label={caption}>
            <table className="w-full min-w-[720px] text-sm">
                <caption className="sr-only">{caption}</caption>
                <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                        <th scope="col" className={th}>{t.colProp}</th>
                        <th scope="col" className={th}>{t.colType}</th>
                        {withRequired && <th scope="col" className={th}>{t.colRequired}</th>}
                        <th scope="col" className={th}>{t.colValues}</th>
                        <th scope="col" className={th}>{t.colDefault}</th>
                        <th scope="col" className={th}>{t.colDesc}</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border">
                    {rows.map((r) => (
                        <tr key={r.name} className="align-top" data-prop={r.name}>
                            <th scope="row" className="px-3 py-2 text-left font-mono text-xs font-semibold text-foreground break-all">{r.name}</th>
                            <td className="px-3 py-2 text-xs text-foreground">{r.type}{r.isAction && <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">{t.actionProp}</span>}</td>
                            {withRequired && <td className="px-3 py-2 text-xs text-foreground">{r.required ? t.yes : t.no}</td>}
                            <td className="px-3 py-2">
                                {r.values.length ? <span className="inline-flex flex-wrap gap-1">{r.values.map((v) => <code key={v} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">{v}</code>)}</span> : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-foreground">{r.def || <span className="text-muted-foreground">—</span>}</td>
                            <td className="px-3 py-2 text-muted-foreground"><Inline text={r.doc} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
    return <h2 id={id} className="scroll-mt-20 border-b border-border pb-2 pt-6 text-2xl font-bold tracking-tight">{children}</h2>;
}

export function ComponentPage({ type }: { type: string }) {
    const { locale } = useI18n();
    const t = kitStrings(locale);
    const spec = UI_COMPONENTS[type];
    if (!spec) return null;

    const rows = propDocRows(spec.props, locale);
    const nested = nestedDocs(spec.props, locale);
    const events = eventDocs(type);
    const state = stateUsage(type);
    const used = actionsUsed(type);
    const received = actionsReceived(type);
    const usage = usageOf(type);
    const fallbackExample = UI_EXAMPLES[type]?.[0]?.node;
    const snippetNode = usage?.node ?? fallbackExample;
    const { prev, next } = kitNeighbours(type);
    const category = kitCategoryLabel(spec.category, locale);
    const toc = [
        { id: 'props', text: t.propsTitle },
        { id: 'events', text: t.events },
        { id: 'state', text: t.stateTitle },
        { id: 'simulator', text: t.simulator },
        { id: 'related', text: t.related },
        { id: 'manifest', text: t.manifestExample },
    ];
    const actionCard = (name: string) => {
        const a = UI_ACTIONS[name];
        if (!a) return null;
        return (
            <li key={name} className="rounded-md border border-border bg-card p-3 text-sm text-card-foreground">
                <Link href={ACTIONS_ANCHOR} className="font-mono text-xs font-semibold text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">{name}</Link>
                <p className="mt-1 text-xs text-muted-foreground"><Inline text={a.doc} /></p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                    {t.actionRequired}: {(a.required ?? []).map((r) => <code key={r} className="mr-1 font-mono">{r}</code>)}{(a.required ?? []).length === 0 && '—'}
                    {' · '}{t.actionFields}: {Object.keys(a.props).slice(0, 8).map((k) => <code key={k} className="mr-1 font-mono">{k}</code>)}{Object.keys(a.props).length === 0 && '—'}
                </p>
            </li>
        );
    };

    return (
        <div className="flex gap-10">
            <article className="min-w-0 flex-1 space-y-4" data-testid="component-page" data-component={type}>
                <nav aria-label={t.breadcrumb}>
                    <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                        <li><Link href="/docs" className="hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">{t.docs}</Link></li>
                        <li aria-hidden="true">/</li>
                        <li><Link href={KIT_BASE} className="hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">{t.kitTitle}</Link></li>
                        <li aria-hidden="true">/</li>
                        <li><Link href={`${KIT_BASE}#cat-${spec.category}`} className="hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">{category}</Link></li>
                        <li aria-hidden="true">/</li>
                        <li aria-current="page" className="font-mono font-medium text-foreground">{type}</li>
                    </ol>
                </nav>

                <header className="space-y-3 border-b border-border pb-6">
                    <h1 className="font-mono text-3xl font-extrabold tracking-tight lg:text-4xl">{type}</h1>
                    <div className="flex flex-wrap gap-2">
                        <span className={chip}>{t.category}: {category}</span>
                        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">{spec.children ? t.acceptsChildren : t.noChildren}</span>
                    </div>
                    <p className="text-lg text-muted-foreground"><Inline text={kitDescription(type, locale)} /></p>
                    {locale === 'en' && spec.doc !== kitDescription(type, locale) && <p className="text-sm text-muted-foreground"><Inline text={spec.doc} /></p>}
                </header>

                <details className="rounded-lg border border-border bg-card p-3 text-sm text-card-foreground xl:hidden">
                    <summary className="cursor-pointer font-medium">{ui(locale, 'onThisPage')}</summary>
                    <TocList toc={toc} />
                </details>

                <H2 id="props">{t.propsTitle}</H2>
                <p className="leading-7 text-muted-foreground"><Inline text={t.propsIntro} /></p>
                <PropsTable rows={rows} caption={`${t.propsTitle}: ${type}`} t={t} />
                {nested.length > 0 && (
                    <section aria-label={t.nested} className="space-y-3">
                        <h3 id="nested" className="scroll-mt-20 pt-3 text-lg font-semibold">{t.nested}</h3>
                        {nested.map((n) => (
                            <div key={n.path} className="space-y-1">
                                <h4 className="font-mono text-sm font-semibold text-foreground">{n.path}</h4>
                                <PropsTable rows={n.rows} caption={`${type}: ${n.path}`} t={t} withRequired={false} />
                            </div>
                        ))}
                    </section>
                )}
                <details className="rounded-lg border border-border p-3 text-sm">
                    <summary className="cursor-pointer font-medium text-foreground">{t.commonProps}</summary>
                    <div className="mt-3"><PropsTable rows={propDocRows(COMMON_PROPS, locale)} caption={t.commonProps} t={t} withRequired={false} /></div>
                </details>

                <H2 id="events">{t.events}</H2>
                <p className="leading-7 text-muted-foreground"><Inline text={t.eventsIntro} /></p>
                {events.length <= 1 && <p className="text-sm text-muted-foreground"><Inline text={t.noEvents} /></p>}
                <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label={t.events}>
                    <table className="w-full min-w-[560px] text-sm">
                        <caption className="sr-only">{t.events}</caption>
                        <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground"><tr><th scope="col" className={th}>{t.colEvent}</th><th scope="col" className={th}>{t.colReceives}</th><th scope="col" className={th}>{t.colDesc}</th></tr></thead>
                        <tbody className="divide-y divide-border">
                            {events.map((e) => (
                                <tr key={e.path} className="align-top" data-event={e.path}>
                                    <th scope="row" className="px-3 py-2 text-left font-mono text-xs font-semibold text-foreground break-all">{e.path}</th>
                                    <td className="px-3 py-2">{e.payload.length ? e.payload.map((p) => <code key={p} className="mr-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">{`\${${p}}`}</code>) : <span className="text-muted-foreground">—</span>}</td>
                                    <td className="px-3 py-2 text-muted-foreground"><Inline text={e.doc} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <H2 id="state">{t.stateTitle}</H2>
                <p className="leading-7 text-muted-foreground"><Inline text={t.stateIntro} /></p>
                <ul className="space-y-2">
                    {state.map((s) => (
                        <li key={s.name} className={cn(cardCls, 'text-sm')}>
                            <code className="font-mono text-xs font-semibold text-foreground">{s.name}</code>
                            <p className="mt-1 text-muted-foreground"><Inline text={s.how[locale]} /></p>
                        </li>
                    ))}
                </ul>

                <H2 id="simulator">{t.simulator}</H2>
                <p className="leading-7 text-muted-foreground">{t.simulatorIntro}</p>
                <Simulator type={type} />

                <H2 id="related">{t.related}</H2>
                <p className="leading-7 text-muted-foreground"><Inline text={t.relatedIntro} /></p>
                <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                        <h3 className="text-lg font-semibold">{t.actionsUsedHere}</h3>
                        {used.length ? <ul className="space-y-2">{used.map(actionCard)}</ul> : <p className="text-sm text-muted-foreground">{t.none}</p>}
                    </div>
                    <div className="space-y-2">
                        <h3 className="text-lg font-semibold">{t.actionsReceived}</h3>
                        {received.length ? <ul className="space-y-2">{received.map(actionCard)}</ul> : <p className="text-sm text-muted-foreground">{t.none}</p>}
                    </div>
                </div>
                <p><Link href={ACTIONS_ANCHOR} className="text-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">{t.seeAllActions}</Link></p>

                <H2 id="manifest">{t.manifestExample}</H2>
                {usage ? (
                    <>
                        <p className="leading-7 text-muted-foreground"><Inline text={fill(t.manifestFrom, { file: `bloomx-extensions/${usage.file}`, extension: usage.extensionId, path: usage.path, point: usage.point })} /></p>
                        {usage.alsoIn.length > 0 && <p className="text-sm text-muted-foreground"><Inline text={fill(t.manifestAlso, { files: usage.alsoIn.slice(0, 6).map((f) => `\`${f}\``).join(', ') })} /></p>}
                        <CodeBlock code={JSON.stringify(usage.node, null, 2)} title={`${usage.file} · ${usage.path}`} locale={locale} />
                    </>
                ) : (
                    <p className="leading-7 text-muted-foreground"><Inline text={t.manifestNone} /></p>
                )}
                {snippetNode && <CodeBlock code={manifestSnippet(snippetNode, usage?.point && !usage.point.startsWith('overlay:') ? usage.point : 'EMAIL_TOOLBAR')} title={t.manifestSnippetTitle} locale={locale} />}

                <nav aria-label={`${t.prev} / ${t.next}`} className="mt-12 grid gap-3 border-t border-border pt-6 sm:grid-cols-2">
                    {prev ? (
                        <Link href={kitHref(prev)} rel="prev" className="group flex flex-col rounded-lg border border-border p-4 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <span className="flex items-center gap-1 text-xs text-muted-foreground"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />{t.prev}</span>
                            <span className="font-mono font-medium text-foreground group-hover:text-accent-foreground">{prev}</span>
                        </Link>
                    ) : <span />}
                    {next ? (
                        <Link href={kitHref(next)} rel="next" className="group flex flex-col items-end rounded-lg border border-border p-4 text-right hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">{t.next}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></span>
                            <span className="font-mono font-medium text-foreground group-hover:text-accent-foreground">{next}</span>
                        </Link>
                    ) : <span />}
                </nav>
            </article>

            <aside className="hidden w-56 shrink-0 xl:block" aria-label={t.onThisPage}>
                <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto text-sm">
                    <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.onThisPage}</p>
                    <TocList toc={toc} />
                </div>
            </aside>
        </div>
    );
}

function TocList({ toc }: { toc: Array<{ id: string; text: string }> }) {
    return (
        <ul className="mt-2 space-y-1">
            {toc.map((h) => (
                <li key={h.id}>
                    <a href={`#${h.id}`} className="block rounded-sm py-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{h.text}</a>
                </li>
            ))}
        </ul>
    );
}
