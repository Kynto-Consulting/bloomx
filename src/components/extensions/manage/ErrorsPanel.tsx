'use client';

import * as React from 'react';
import Link from 'next/link';
import { clearExtensionErrors, type ExtensionErrorEntry } from '@/lib/expansions/client/error-log';
import { formatErrorReport } from '@/lib/expansions/manage/report';
import type { ExtensionRow } from '@/lib/expansions/manage/model';
import { Button } from '@/components/expansions/kit/Actions';
import { Badge } from '@/components/expansions/kit/Feedback';
import { ErrorsTable } from './ErrorsTable';
import { fmt, useManageStrings } from './strings';

interface ErrorsPanelProps {
    errors: ExtensionErrorEntry[];
    rows: ExtensionRow[];
    now: number;
    /** Si se indica, solo los errores de esa extension (panel del detalle) y sin encabezados por extension. */
    scopeId?: string;
    canOpenPlayground: boolean;
    announce: (message: string) => void;
    headingLevel?: 2 | 3;
}

async function copyText(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
    } catch { /* cae al metodo antiguo */ }
    try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.className = 'fixed -top-96 opacity-0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
    } catch { return false; }
}

export function ErrorsPanel({ errors, rows, now, scopeId, canOpenPlayground, announce, headingLevel = 2 }: ErrorsPanelProps) {
    const { s } = useManageStrings();
    const list = scopeId ? errors.filter((e) => e.extensionId === scopeId) : errors;
    const Heading = (headingLevel === 2 ? 'h2' : 'h3') as 'h2';
    const nameOf = (id: string) => rows.find((r) => r.id === id)?.name ?? id;
    const groups = React.useMemo(() => {
        const map = new Map<string, ExtensionErrorEntry[]>();
        for (const e of list) map.set(e.extensionId, [...(map.get(e.extensionId) ?? []), e]);
        return Array.from(map.entries());
    }, [list]);

    const copy = async () => {
        const report = formatErrorReport({ extensions: rows.map((r) => ({ id: r.id, name: r.name, version: r.version })), errors: list });
        announce((await copyText(report)) ? s.copied : s.copyFailed);
    };
    const clear = (id?: string) => { clearExtensionErrors(id ?? scopeId); announce(s.cleared); };

    return (
        <section aria-labelledby={`errors-h-${scopeId ?? 'all'}`} className="space-y-3" data-testid={scopeId ? 'errors-scoped' : 'errors-panel'}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                    <Heading id={`errors-h-${scopeId ?? 'all'}`} className={headingLevel === 2 ? 'text-lg font-semibold text-foreground' : 'text-base font-semibold text-foreground'}>
                        {scopeId ? s.errorsOf : s.errorsTitle}
                        {list.length > 0 && <span className="ml-2 align-middle"><Badge tone="danger" label={String(list.length)} size="sm" /></span>}
                    </Heading>
                    {!scopeId && <p className="text-sm text-muted-foreground">{s.errorsHelp}</p>}
                </div>
                {list.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        <Button label={s.copyReport} icon="Copy" variant="outline" size="sm" onPress={() => { void copy(); }} />
                        <Button label={scopeId ? s.clear : s.clearAll} icon="Trash2" variant="outline" size="sm" onPress={() => clear()} />
                        {canOpenPlayground && (
                            <Link href="/extensions/playground" className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                {s.openPlayground}
                            </Link>
                        )}
                    </div>
                )}
            </div>
            {list.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">{s.errorsNone}</p>
            ) : scopeId ? (
                <ErrorsTable errors={list} now={now} />
            ) : (
                groups.map(([id, entries]) => (
                    <div key={id} className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-sm font-medium text-foreground">{nameOf(id)} <code className="text-xs text-muted-foreground">{id}</code> <span className="text-muted-foreground">({entries.length === 1 ? s.errorCountOne : fmt(s.errorCount, { n: entries.length })})</span></h3>
                            <Button label={`${s.clear}: ${nameOf(id)}`} icon="Trash2" variant="ghost" size="xs" onPress={() => clear(id)} />
                        </div>
                        <ErrorsTable errors={entries} now={now} />
                    </div>
                ))
            )}
        </section>
    );
}
