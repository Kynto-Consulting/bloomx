'use client';

import { Fragment, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Copy, Info, Lightbulb, OctagonAlert } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { cn } from '@/lib/utils';
import { Diagram } from './Diagram';
import { DOC_NAV, docHref, findDocPage, neighbours } from '../_content/nav';
import { DOC_CONTENT } from '../_content/registry';
import { ENV_VARS } from '../_content/env';
import { ui } from '../_content/ui';
import type { Block, CalloutKind, Locale } from '../_content/types';

// ---------------------------------------------------------------------------
// Marcado en linea: `codigo`, **negrita**, [texto](ruta | https://...)
// ---------------------------------------------------------------------------

const INLINE_RE = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function Inline({ text }: { text: string }): ReactNode {
    const out: ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    INLINE_RE.lastIndex = 0;
    while ((m = INLINE_RE.exec(text))) {
        if (m.index > last) out.push(text.slice(last, m.index));
        if (m[1] !== undefined) {
            out.push(<code key={i++} className="rounded bg-code px-1 py-0.5 font-mono text-[0.85em] text-code-foreground break-words">{m[1]}</code>);
        } else if (m[2] !== undefined) {
            out.push(<strong key={i++} className="font-semibold text-foreground">{m[2]}</strong>);
        } else {
            const href = m[4];
            const cls = 'text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm';
            out.push(href.startsWith('/')
                ? <Link key={i++} href={href} className={cls}>{m[3]}</Link>
                : <a key={i++} href={href} target="_blank" rel="noopener noreferrer" className={cls}>{m[3]}</a>);
        }
        last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return <>{out}</>;
}

// ---------------------------------------------------------------------------
// Bloques
// ---------------------------------------------------------------------------

function CopyButton({ text, locale }: { text: string; locale: Locale }) {
    const [done, setDone] = useState(false);
    return (
        <button
            type="button"
            onClick={async () => {
                try {
                    await navigator.clipboard.writeText(text);
                    setDone(true);
                    setTimeout(() => setDone(false), 1800);
                } catch { /* portapapeles bloqueado */ }
            }}
            aria-label={ui(locale, 'copyCode')}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-card-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
            {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
            <span aria-live="polite">{done ? ui(locale, 'copied') : ui(locale, 'copy')}</span>
        </button>
    );
}

const CALLOUT: Record<CalloutKind, { icon: typeof Info; cls: string }> = {
    note: { icon: Info, cls: 'border-info/40 bg-info/10' },
    tip: { icon: Lightbulb, cls: 'border-success/40 bg-success/10' },
    warn: { icon: AlertTriangle, cls: 'border-warning/50 bg-warning/10' },
    danger: { icon: OctagonAlert, cls: 'border-destructive/50 bg-destructive/10' },
};

function ScopeLabel({ scope, locale }: { scope: 'frontend' | 'backend' | 'both'; locale: Locale }) {
    return <>{ui(locale, scope === 'frontend' ? 'scopeFrontend' : scope === 'backend' ? 'scopeBackend' : 'scopeBoth')}</>;
}

function EnvTable({ scope, group, locale }: { scope?: 'frontend' | 'backend' | 'all'; group?: string; locale: Locale }) {
    const rows = ENV_VARS.filter((v) => (!scope || scope === 'all' || v.scope === scope || v.scope === 'both') && (!group || v.group === group));
    return (
        <div className="my-4 overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label={group ?? 'env'}>
            <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-muted text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                        <th scope="col" className="px-3 py-2">{ui(locale, 'envName')}</th>
                        <th scope="col" className="px-3 py-2">{ui(locale, 'envScope')}</th>
                        <th scope="col" className="px-3 py-2">{ui(locale, 'envRequired')}</th>
                        <th scope="col" className="px-3 py-2">{ui(locale, 'envDefault')}</th>
                        <th scope="col" className="px-3 py-2">{ui(locale, 'envDesc')}</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border">
                    {rows.map((v) => (
                        <tr key={`${v.name}-${v.scope}`} className="align-top">
                            <th scope="row" className="px-3 py-2 text-left font-mono text-xs font-semibold break-all">{v.name}</th>
                            <td className="px-3 py-2"><ScopeLabel scope={v.scope} locale={locale} /></td>
                            <td className="px-3 py-2">
                                <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', v.required === 'required' ? 'bg-destructive/10 text-foreground' : v.required === 'conditional' ? 'bg-warning/10 text-foreground' : 'bg-muted text-foreground')}>
                                    {ui(locale, v.required === 'required' ? 'reqRequired' : v.required === 'conditional' ? 'reqConditional' : 'reqOptional')}
                                </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs break-words">{v.default ?? ui(locale, 'noDefault')}</td>
                            <td className="px-3 py-2 text-muted-foreground"><Inline text={v.desc[locale]} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function BlockView({ b, locale }: { b: Block; locale: Locale }) {
    switch (b.t) {
        case 'h2':
            return (
                <h2 id={b.id} className="group scroll-mt-20 border-b border-border pb-2 pt-6 text-2xl font-bold tracking-tight">
                    {b.text}
                    <a href={`#${b.id}`} aria-label={b.text} className="ml-2 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100">#</a>
                </h2>
            );
        case 'h3':
            return (
                <h3 id={b.id} className="group scroll-mt-20 pt-3 text-lg font-semibold">
                    {b.text}
                    <a href={`#${b.id}`} aria-label={b.text} className="ml-2 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100">#</a>
                </h3>
            );
        case 'p':
            return <p className="leading-7 text-muted-foreground"><Inline text={b.text} /></p>;
        case 'ul':
            return <ul className="list-disc space-y-1.5 pl-6 text-muted-foreground">{b.items.map((it, i) => <li key={i}><Inline text={it} /></li>)}</ul>;
        case 'ol':
            return <ol className="list-decimal space-y-1.5 pl-6 text-muted-foreground">{b.items.map((it, i) => <li key={i}><Inline text={it} /></li>)}</ol>;
        case 'code':
            return (
                <figure className="overflow-hidden rounded-lg border border-border bg-code">
                    <div className="flex items-center justify-between gap-2 border-b border-border bg-muted px-3 py-1.5">
                        <figcaption className="truncate font-mono text-xs text-foreground">{b.title ?? b.lang ?? ''}</figcaption>
                        <CopyButton text={b.code} locale={locale} />
                    </div>
                    <pre tabIndex={0} className="overflow-x-auto p-4 text-[13px] leading-6 text-code-foreground"><code>{b.code}</code></pre>
                </figure>
            );
        case 'table':
            return (
                <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label={b.caption ?? b.head[0]}>
                    <table className="w-full min-w-[520px] text-sm">
                        {b.caption && <caption className="sr-only">{b.caption}</caption>}
                        <thead className="bg-muted text-left text-xs uppercase tracking-wider text-muted-foreground">
                            <tr>{b.head.map((h, i) => <th key={i} scope="col" className="px-3 py-2">{h}</th>)}</tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {b.rows.map((r, ri) => (
                                <tr key={ri} className="align-top">
                                    {r.map((c, ci) => (ci === 0
                                        ? <th key={ci} scope="row" className="px-3 py-2 text-left font-medium text-foreground"><Inline text={c} /></th>
                                        : <td key={ci} className="px-3 py-2 text-muted-foreground"><Inline text={c} /></td>))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
        case 'callout': {
            const { icon: Icon, cls } = CALLOUT[b.kind];
            return (
                <div role="note" className={cn('flex gap-3 rounded-lg border p-4 text-sm text-foreground', cls)}>
                    <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <div className="space-y-1">
                        {b.title && <p className="font-semibold">{b.title}</p>}
                        <p className="leading-6"><Inline text={b.text} /></p>
                    </div>
                </div>
            );
        }
        case 'diagram':
            return <Diagram id={b.id} caption={b.caption} locale={locale} />;
        case 'env':
            return <EnvTable scope={b.scope} group={b.group} locale={locale} />;
    }
}

// ---------------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------------

export function DocView({ slug }: { slug: string }) {
    const { locale } = useI18n();
    const page = findDocPage(slug);
    const content = DOC_CONTENT[slug];
    if (!page || !content) return null;
    const blocks = content[locale] ?? content.es;
    const toc = blocks.filter((b): b is Extract<Block, { t: 'h2' | 'h3' }> => b.t === 'h2' || b.t === 'h3');
    const { prev, next } = neighbours(slug);

    return (
        <div className="flex gap-10">
            <article className="min-w-0 flex-1 space-y-4">
                <header className="space-y-2 border-b border-border pb-6">
                    <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">{page.title[locale]}</h1>
                    <p className="text-lg text-muted-foreground">{page.description[locale]}</p>
                </header>

                {toc.length > 2 && (
                    <details className="rounded-lg border border-border bg-card p-3 text-sm text-card-foreground xl:hidden">
                        <summary className="cursor-pointer font-medium">{ui(locale, 'onThisPage')}</summary>
                        <TocList toc={toc} />
                    </details>
                )}

                {blocks.map((b, i) => <Fragment key={i}><BlockView b={b} locale={locale} /></Fragment>)}

                {slug === '' && (
                    <div className="space-y-8 pt-6">
                        {DOC_NAV.map((section) => (
                            <section key={section.id} aria-labelledby={`sec-${section.id}`} className="space-y-3">
                                <h2 id={`sec-${section.id}`} className="text-xl font-bold tracking-tight">{section.title[locale]}</h2>
                                <ul className="grid gap-3 sm:grid-cols-2">
                                    {section.pages.filter((p) => p.slug !== '').map((p) => (
                                        <li key={p.slug}>
                                            <Link href={docHref(p.slug)} className="block h-full rounded-lg border border-border bg-card p-4 text-card-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                                <span className="block font-semibold">{p.title[locale]}</span>
                                                <span className="mt-1 block text-sm text-muted-foreground">{p.description[locale]}</span>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        ))}
                    </div>
                )}

                <nav aria-label={`${ui(locale, 'prev')} / ${ui(locale, 'next')}`} className="mt-12 grid gap-3 border-t border-border pt-6 sm:grid-cols-2">
                    {prev ? (
                        <Link href={docHref(prev.slug)} rel="prev" className="group flex flex-col rounded-lg border border-border p-4 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <span className="flex items-center gap-1 text-xs text-muted-foreground"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />{ui(locale, 'prev')}</span>
                            <span className="font-medium text-foreground group-hover:text-accent-foreground">{prev.title[locale]}</span>
                        </Link>
                    ) : <span />}
                    {next ? (
                        <Link href={docHref(next.slug)} rel="next" className="group flex flex-col items-end rounded-lg border border-border p-4 text-right hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">{ui(locale, 'next')}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></span>
                            <span className="font-medium text-foreground group-hover:text-accent-foreground">{next.title[locale]}</span>
                        </Link>
                    ) : <span />}
                </nav>
            </article>

            {toc.length > 2 && (
                <aside className="hidden w-56 shrink-0 xl:block" aria-label={ui(locale, 'onThisPage')}>
                    <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto text-sm">
                        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">{ui(locale, 'onThisPage')}</p>
                        <TocList toc={toc} />
                    </div>
                </aside>
            )}
        </div>
    );
}

function TocList({ toc }: { toc: Array<{ t: 'h2' | 'h3'; id: string; text: string }> }) {
    return (
        <ul className="mt-2 space-y-1">
            {toc.map((h) => (
                <li key={h.id} className={h.t === 'h3' ? 'pl-3' : undefined}>
                    <a href={`#${h.id}`} className="block rounded-sm py-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{h.text}</a>
                </li>
            ))}
        </ul>
    );
}

