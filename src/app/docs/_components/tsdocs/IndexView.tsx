'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { cn } from '@/lib/utils';
import { Inline } from '../DocView';
import {
    CATEGORY_ORDER, CATEGORY_TITLE, KIND_ORDER, KIND_SINGULAR, KIND_TITLE, MODULES, SEARCH_ROWS, moduleHref, tsdocsHref, type SearchRow,
} from '../../_content/tsdocs-lite';
import { normalize } from '../../_content/search';
import { Badge, tt } from './parts';

type GroupBy = 'category' | 'module' | 'kind';

function matches(r: SearchRow, terms: string[]): boolean {
    const hay = normalize(`${r.n} ${r.s} ${r.m} ${r.k}`);
    return terms.every((t) => hay.includes(t));
}

function score(r: SearchRow, q: string): number {
    const n = normalize(r.n);
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (n.includes(q)) return 2;
    return 3;
}

/** Indice TSDocs: buscador cliente (atajo "/"), agrupado por categoria, modulo o tipo de simbolo. `module` filtra un modulo. */
export function IndexView({ module }: { module?: string }) {
    const { locale } = useI18n();
    const [q, setQ] = useState('');
    const [groupBy, setGroupBy] = useState<GroupBy>('category');
    const inputRef = useRef<HTMLInputElement>(null);

    // "/" enfoca este buscador (fase de captura: evita que el buscador global del layout lo reciba tambien).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const el = e.target as HTMLElement | null;
            const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
            if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                e.stopPropagation();
                inputRef.current?.focus();
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, []);

    const base = useMemo(() => (module ? SEARCH_ROWS.filter((r) => r.m === module) : SEARCH_ROWS), [module]);
    const rows = useMemo(() => {
        const nq = normalize(q.trim());
        if (!nq) return base;
        const terms = nq.split(/\s+/);
        return base.filter((r) => matches(r, terms)).sort((a, b) => score(a, nq) - score(b, nq) || a.n.localeCompare(b.n));
    }, [base, q]);

    const groups = useMemo(() => {
        const map = new Map<string, { title: string; rows: SearchRow[] }>();
        const order: string[] = groupBy === 'category' ? CATEGORY_ORDER : groupBy === 'kind' ? KIND_ORDER : MODULES.map((m) => m.id);
        for (const key of order) {
            const title = groupBy === 'category' ? CATEGORY_TITLE[key as keyof typeof CATEGORY_TITLE][locale]
                : groupBy === 'kind' ? KIND_TITLE[key as keyof typeof KIND_TITLE][locale] : key;
            map.set(key, { title, rows: [] });
        }
        for (const r of rows) map.get(groupBy === 'category' ? r.c : groupBy === 'kind' ? r.k : r.m)?.rows.push(r);
        return [...map.entries()].filter(([, g]) => g.rows.length > 0);
    }, [rows, groupBy, locale]);

    const mod = module ? MODULES.find((m) => m.id === module) : undefined;
    const OPTIONS: Array<[GroupBy, string]> = [['category', tt(locale, 'byCategory')], ['module', tt(locale, 'byModule')], ['kind', tt(locale, 'byKind')]];

    return (
        <div className="min-w-0 space-y-6">
            <header className="space-y-2 border-b border-border pb-6">
                <p className="text-sm text-muted-foreground">
                    <Link href="/docs/extension-tools" className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{tt(locale, 'tools')}</Link>
                    {module && <> / <Link href="/docs/extension-tools/tsdocs" className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{tt(locale, 'tsdocs')}</Link></>}
                </p>
                <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">{mod ? tt(locale, 'moduleTitle', { m: mod.id }) : tt(locale, 'indexTitle')}</h1>
                <p className="text-lg text-muted-foreground">{mod ? <Inline text={mod.description[locale]} /> : tt(locale, 'indexDesc')}</p>
                <p className="text-sm text-muted-foreground"><Inline text={tt(locale, 'generated')} /></p>
            </header>

            {!module && (
                <section aria-labelledby="ts-modules" className="space-y-3">
                    <h2 id="ts-modules" className="text-xl font-bold tracking-tight">{tt(locale, 'allModules')}</h2>
                    <ul className="grid gap-3 sm:grid-cols-2">
                        {MODULES.map((m) => (
                            <li key={m.id}>
                                <Link href={moduleHref(m.id)} className="block h-full rounded-lg border border-border bg-card p-4 text-card-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                    <span className="flex items-center justify-between gap-2">
                                        <span className="font-mono font-semibold">{m.id}</span>
                                        <Badge>{tt(locale, 'symbolsCount', { n: SEARCH_ROWS.filter((r) => r.m === m.id).length })}</Badge>
                                    </span>
                                    <span className="mt-1 block text-sm text-muted-foreground"><Inline text={m.description[locale]} /></span>
                                    <span className="mt-1 block font-mono text-xs text-muted-foreground">{m.file}</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <div className="flex flex-wrap items-center gap-3" role="search">
                <div className="relative min-w-[16rem] flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <input
                        ref={inputRef}
                        type="search"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); (e.target as HTMLInputElement).blur(); } }}
                        aria-label={tt(locale, 'searchLabel')}
                        placeholder={tt(locale, 'searchPlaceholder')}
                        autoComplete="off"
                        className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                </div>
                <div role="group" aria-label={tt(locale, 'groupBy')} className="flex items-center gap-1 rounded-md border border-border bg-card p-1">
                    {OPTIONS.map(([id, label]) => (
                        <button
                            key={id}
                            type="button"
                            aria-pressed={groupBy === id}
                            onClick={() => setGroupBy(id)}
                            className={cn('rounded px-2.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                groupBy === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground')}
                        >{label}</button>
                    ))}
                </div>
            </div>
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
                {rows.length === 0 ? tt(locale, 'noResults', { q }) : tt(locale, 'results', { n: rows.length })}
            </p>

            {groups.map(([key, g]) => (
                <section key={key} aria-labelledby={`ts-g-${key}`} className="space-y-2">
                    <h2 id={`ts-g-${key}`} className="scroll-mt-20 border-b border-border pb-1 text-lg font-bold tracking-tight">
                        {g.title} <span className="text-sm font-normal text-muted-foreground">({g.rows.length})</span>
                    </h2>
                    <ul className="grid gap-x-6 gap-y-1 md:grid-cols-2">
                        {g.rows.map((r) => (
                            <li key={r.n}>
                                <Link href={tsdocsHref({ name: r.n, module: r.m })} className="group flex flex-col rounded-md px-2 py-1.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                    <span className="flex flex-wrap items-center gap-2">
                                        <span className="break-all font-mono text-sm font-semibold text-link group-hover:text-accent-foreground">{r.n}</span>
                                        <span className="text-xs text-muted-foreground">{KIND_SINGULAR[r.k][locale]} · {r.m}</span>
                                        {r.d && <Badge tone="warning">{tt(locale, 'deprecated')}</Badge>}
                                    </span>
                                    {r.s && <span className="line-clamp-2 text-xs text-muted-foreground group-hover:text-accent-foreground">{r.s.replace(/[`*]/g, '')}</span>}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>
            ))}
        </div>
    );
}
