'use client';

import * as React from 'react';
import type { ExtensionErrorEntry } from '@/lib/expansions/client/error-log';
import { formatRelativeTime } from '@/lib/expansions/manage/model';
import { Badge } from '@/components/expansions/kit/Feedback';
import { fmt, useManageStrings } from './strings';

const KIND_TONE = { validation: 'warning', render: 'danger', action: 'danger', expression: 'warning', manifest: 'danger' } as const;

/** Tabla de errores de ejecucion (mensajes como TEXTO: nunca HTML). `showExtension` anade la columna de extension. */
export function ErrorsTable({ errors, now, showExtension, nameOf }: { errors: ExtensionErrorEntry[]; now: number; showExtension?: boolean; nameOf?: (id: string) => string }) {
    const { s, lang, kindLabel } = useManageStrings();
    return (
        <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
                <caption className="sr-only">{s.errorsTitle}</caption>
                <thead className="bg-muted text-muted-foreground">
                    <tr>
                        {showExtension && <th scope="col" className="px-3 py-2 font-medium">{s.colExtension}</th>}
                        <th scope="col" className="px-3 py-2 font-medium">{s.colType}</th>
                        <th scope="col" className="px-3 py-2 font-medium">{s.colPath}</th>
                        <th scope="col" className="px-3 py-2 font-medium">{s.colMessage}</th>
                        <th scope="col" className="px-3 py-2 font-medium">{s.colTimes}</th>
                        <th scope="col" className="px-3 py-2 font-medium">{s.colWhen}</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card text-card-foreground">
                    {errors.map((e) => (
                        <tr key={e.id} data-testid="error-row">
                            {showExtension && <td className="px-3 py-2 align-top"><code className="break-all text-xs">{nameOf ? nameOf(e.extensionId) : e.extensionId}</code></td>}
                            <td className="px-3 py-2 align-top"><Badge tone={KIND_TONE[e.kind] ?? 'neutral'} label={kindLabel(e.kind)} size="sm" /></td>
                            <td className="px-3 py-2 align-top">{e.path ? <code className="break-all text-xs">{e.path}</code> : <span className="text-muted-foreground">-</span>}</td>
                            <td className="whitespace-pre-wrap break-words px-3 py-2 align-top">{e.message}</td>
                            <td className="px-3 py-2 align-top tabular-nums">{fmt(s.times, { n: e.count })}</td>
                            <td className="whitespace-nowrap px-3 py-2 align-top text-muted-foreground"><time dateTime={new Date(e.at).toISOString()}>{formatRelativeTime(e.at, now, lang)}</time></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
