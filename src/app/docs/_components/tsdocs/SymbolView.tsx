'use client';

import Link from 'next/link';
import { ArrowLeft, ArrowRight, ChevronRight } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import type { TsMember, TsSymbol } from '@/lib/tsdocs/extract';
import {
    KIND_SINGULAR, MODULES, TSDOCS_BASE, findSymbolByName, memberAnchor, moduleHref, tsdocsHref, type SymRef,
} from '../../_content/tsdocs-lite';
import { Badge, CodeBlock, DocText, InlineType, tt } from './parts';
import type { Locale } from '../../_content/types';

function Breadcrumb({ s, locale }: { s: TsSymbol; locale: Locale }) {
    const cls = 'rounded-sm hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
    return (
        <nav aria-label="breadcrumb" className="text-sm text-muted-foreground">
            <ol className="flex flex-wrap items-center gap-1">
                <li><Link href="/docs" className={cls}>{tt(locale, 'docs')}</Link></li>
                <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
                <li><Link href="/docs/extension-tools" className={cls}>{tt(locale, 'tools')}</Link></li>
                <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
                <li><Link href={TSDOCS_BASE} className={cls}>{tt(locale, 'tsdocs')}</Link></li>
                <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
                <li><Link href={moduleHref(s.module)} className={cls}>{s.module}</Link></li>
                <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
                <li aria-current="page" className="font-mono font-medium text-foreground">{s.name}</li>
            </ol>
        </nav>
    );
}

function RefList({ names }: { names: string[] }) {
    return (
        <ul className="flex flex-wrap gap-1.5">
            {names.map((n) => {
                const t = findSymbolByName(n);
                return (
                    <li key={n}>
                        {t
                            ? <Link href={tsdocsHref(t)} className="inline-block rounded border border-border bg-card px-2 py-0.5 font-mono text-xs text-link hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{n}</Link>
                            : <span className="inline-block rounded border border-border px-2 py-0.5 font-mono text-xs">{n}</span>}
                    </li>
                );
            })}
        </ul>
    );
}

function MemberDoc({ m, locale }: { m: TsMember; locale: Locale }) {
    const d = m.doc;
    return (
        <div className="space-y-1.5">
            {d.deprecated && <Badge tone="warning">{tt(locale, 'deprecated')}{d.deprecated !== 'true' ? `: ${d.deprecated}` : ''}</Badge>}
            {d.since && <> <Badge tone="info">{tt(locale, 'since')} {d.since}</Badge></>}
            {d.summary ? <p className="leading-6"><DocText text={d.summary} /></p> : <p className="italic">{tt(locale, 'noDescription')}</p>}
            {d.default && <p className="text-xs">{tt(locale, 'defaultValue')}: <code className="rounded bg-code px-1 py-0.5 font-mono text-code-foreground">{d.default}</code></p>}
            {m.params && m.params.some((p) => p.doc) && (
                <ul className="list-disc space-y-0.5 pl-5 text-xs">
                    {m.params.filter((p) => p.doc).map((p) => <li key={p.name}><code className="font-mono">{p.name}</code>: <DocText text={p.doc!} /></li>)}
                </ul>
            )}
            {d.returns && <p className="text-xs"><span className="font-semibold text-foreground">{tt(locale, 'returns')}:</span> <DocText text={d.returns} /></p>}
            {d.examples.map((e, i) => <CodeBlock key={i} code={e.code} title={e.title ?? e.lang} locale={locale} />)}
        </div>
    );
}

function MembersTable({ s, locale }: { s: TsSymbol; locale: Locale }) {
    const isEnum = s.kind === 'enum';
    return (
        <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label={tt(locale, isEnum ? 'enumMembers' : 'members')}>
            <table className="w-full min-w-[640px] text-sm">
                <caption className="sr-only">{tt(locale, isEnum ? 'enumMembers' : 'members')}</caption>
                <thead className="bg-muted text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                        <th scope="col" className="px-3 py-2">{tt(locale, 'name')}</th>
                        <th scope="col" className="px-3 py-2">{tt(locale, 'type')}</th>
                        <th scope="col" className="px-3 py-2">{tt(locale, 'description')}</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border">
                    {s.members.map((m, i) => (
                        <tr key={`${m.name}-${i}`} id={memberAnchor(m.name)} className="scroll-mt-20 align-top">
                            <th scope="row" className="px-3 py-2 text-left font-mono text-xs font-semibold text-foreground break-all">
                                <a href={`#${memberAnchor(m.name)}`} className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{m.name}</a>
                                <span className="mt-1 flex flex-wrap gap-1 font-sans font-normal">
                                    {m.kind === 'property' && <Badge tone={m.optional ? 'muted' : 'primary'}>{tt(locale, m.optional ? 'optional' : 'required')}</Badge>}
                                    {m.kind === 'method' && m.optional && <Badge>{tt(locale, 'optional')}</Badge>}
                                    {m.readonly && !isEnum && <Badge>{tt(locale, 'readonly')}</Badge>}
                                </span>
                            </th>
                            <td className="px-3 py-2 text-card-foreground">
                                <InlineType type={m.kind === 'method' || m.kind === 'call' ? m.signature ?? m.type : (isEnum ? m.type || m.name : m.type)} />
                            </td>
                            <td className="px-3 py-2 text-muted-foreground"><MemberDoc m={m} locale={locale} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
    return (
        <section aria-labelledby={`h-${id}`} className="space-y-3">
            <h2 id={`h-${id}`} className="scroll-mt-20 border-b border-border pb-2 pt-4 text-xl font-bold tracking-tight">{title}</h2>
            {children}
        </section>
    );
}

export function SymbolView({ symbol: s, prev, next }: { symbol: TsSymbol; prev?: SymRef; next?: SymRef }) {
    const { locale } = useI18n();
    const d = s.doc;
    const showSignature = s.members.length <= 24 || s.kind !== 'interface';
    return (
        <article className="min-w-0 space-y-4">
            <Breadcrumb s={s} locale={locale} />
            <header className="space-y-2 border-b border-border pb-5">
                <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="primary">{KIND_SINGULAR[s.kind][locale]}</Badge>
                    <Badge>{s.module}</Badge>
                    {d.deprecated && <Badge tone="warning">{tt(locale, 'deprecated')}{d.deprecated !== 'true' ? `: ${d.deprecated}` : ''}</Badge>}
                    {d.since && <Badge tone="info">{tt(locale, 'since')} {d.since}</Badge>}
                </div>
                <h1 className="break-all font-mono text-3xl font-extrabold tracking-tight lg:text-4xl">{s.name}</h1>
                {d.summary
                    ? <p className="text-lg leading-7 text-muted-foreground"><DocText text={d.summary} /></p>
                    : <p className="text-lg italic text-muted-foreground">{tt(locale, 'noDescription')}</p>}
            </header>

            <Section id="signature" title={tt(locale, 'signature')}>
                <CodeBlock code={s.signature} title={`${s.module} · ${KIND_SINGULAR[s.kind][locale]}`} locale={locale} self={s.name} />
                {(s.extends.length > 0 || s.implements.length > 0) && (
                    <dl className="space-y-1 text-sm">
                        {s.extends.length > 0 && <div className="flex flex-wrap items-baseline gap-2"><dt className="font-semibold">{tt(locale, 'extends')}</dt><dd><RefList names={s.extends.map((e) => e.replace(/<.*$/, ''))} /></dd></div>}
                        {s.implements.length > 0 && <div className="flex flex-wrap items-baseline gap-2"><dt className="font-semibold">{tt(locale, 'implements')}</dt><dd><RefList names={s.implements.map((e) => e.replace(/<.*$/, ''))} /></dd></div>}
                    </dl>
                )}
                {!showSignature && null}
            </Section>

            {d.remarks && (
                <Section id="remarks" title={tt(locale, 'remarks')}>
                    <p className="leading-7 text-muted-foreground"><DocText text={d.remarks} /></p>
                </Section>
            )}

            {s.typeParams.length > 0 && (
                <Section id="typeparams" title={tt(locale, 'typeParams')}>
                    <ul className="space-y-1 text-sm">
                        {s.typeParams.map((t) => (
                            <li key={t.name}>
                                <code className="font-mono font-semibold">{t.name}</code>
                                {t.constraint && <> · {tt(locale, 'constraint')}: <InlineType type={t.constraint} /></>}
                                {t.default && <> · {tt(locale, 'defaultValue')}: <InlineType type={t.default} /></>}
                            </li>
                        ))}
                    </ul>
                </Section>
            )}

            {s.kind === 'function' && (s.params.length > 0 || s.returns) && (
                <Section id="params" title={tt(locale, 'params')}>
                    {s.params.length > 0 && (
                        <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label={tt(locale, 'params')}>
                            <table className="w-full min-w-[520px] text-sm">
                                <thead className="bg-muted text-left text-xs uppercase tracking-wider text-muted-foreground">
                                    <tr>
                                        <th scope="col" className="px-3 py-2">{tt(locale, 'param')}</th>
                                        <th scope="col" className="px-3 py-2">{tt(locale, 'type')}</th>
                                        <th scope="col" className="px-3 py-2">{tt(locale, 'description')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {s.params.map((p) => (
                                        <tr key={p.name} className="align-top">
                                            <th scope="row" className="px-3 py-2 text-left font-mono text-xs font-semibold">{p.rest ? '...' : ''}{p.name}{p.optional ? '?' : ''}</th>
                                            <td className="px-3 py-2"><InlineType type={p.type} /></td>
                                            <td className="px-3 py-2 text-muted-foreground">{p.doc ? <DocText text={p.doc} /> : '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {s.returns && (
                        <p className="text-sm"><span className="font-semibold">{tt(locale, 'returns')}:</span> <InlineType type={s.returns} />{d.returns && <> — <span className="text-muted-foreground"><DocText text={d.returns} /></span></>}</p>
                    )}
                </Section>
            )}

            {s.kind === 'const' && s.returns && (
                <Section id="consttype" title={tt(locale, 'type')}>
                    <p className="text-sm"><InlineType type={s.returns} /></p>
                </Section>
            )}

            {s.unionValues.length > 0 && s.kind === 'type' && (
                <Section id="values" title={tt(locale, 'values')}>
                    <ul className="flex flex-wrap gap-1.5">
                        {s.unionValues.map((v) => <li key={v}><code className="inline-block rounded border border-border bg-card px-2 py-0.5 font-mono text-xs text-success">{v}</code></li>)}
                    </ul>
                </Section>
            )}

            {s.members.length > 0 && (
                <Section id="members" title={`${tt(locale, s.kind === 'enum' ? 'enumMembers' : 'members')} (${s.members.length})`}>
                    <MembersTable s={s} locale={locale} />
                </Section>
            )}

            {d.examples.length > 0 && (
                <Section id="examples" title={tt(locale, 'examples')}>
                    <div className="space-y-3">
                        {d.examples.map((e, i) => <CodeBlock key={i} code={e.code} title={e.title ?? e.lang} locale={locale} />)}
                    </div>
                </Section>
            )}

            {d.see.length > 0 && (
                <Section id="see" title={tt(locale, 'see')}>
                    <ul className="list-disc space-y-1 pl-6 text-muted-foreground">{d.see.map((x, i) => <li key={i}><DocText text={x} /></li>)}</ul>
                </Section>
            )}

            <Section id="related" title={tt(locale, 'usedBy')}>
                {s.usedBy.length ? <RefList names={s.usedBy} /> : <p className="text-sm text-muted-foreground">{tt(locale, 'none')}</p>}
                {s.refs.length > 0 && (
                    <div className="space-y-2 pt-2">
                        <h3 className="text-sm font-semibold">{tt(locale, 'uses')}</h3>
                        <RefList names={s.refs} />
                    </div>
                )}
            </Section>

            <p className="text-sm text-muted-foreground">
                {tt(locale, 'source')}: <code className="rounded bg-code px-1 py-0.5 font-mono text-code-foreground">{s.source.file}:{s.source.line}</code>
                {' · '}{MODULES.find((m) => m.id === s.module)?.file}
            </p>

            <nav aria-label={`${tt(locale, 'prev')} / ${tt(locale, 'next')}`} className="mt-10 grid gap-3 border-t border-border pt-6 sm:grid-cols-2">
                {prev ? (
                    <Link href={tsdocsHref(prev)} rel="prev" className="group flex flex-col rounded-lg border border-border p-4 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <span className="flex items-center gap-1 text-xs text-muted-foreground"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />{tt(locale, 'prev')}</span>
                        <span className="break-all font-mono font-medium text-foreground group-hover:text-accent-foreground">{prev.name}</span>
                    </Link>
                ) : <span />}
                {next ? (
                    <Link href={tsdocsHref(next)} rel="next" className="group flex flex-col items-end rounded-lg border border-border p-4 text-right hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">{tt(locale, 'next')}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></span>
                        <span className="break-all font-mono font-medium text-foreground group-hover:text-accent-foreground">{next.name}</span>
                    </Link>
                ) : <span />}
            </nav>
        </article>
    );
}
