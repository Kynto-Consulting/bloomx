'use client';

import * as React from 'react';
import { Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Cell, CmdOutput, Tone } from '@/lib/admin-cli/types';
import { cellText } from '@/lib/admin-cli/render';

/** Pinta la salida estructurada de un comando con clases de TEMA (tokens), nunca colores crudos. */

const TONE: Record<Tone, string> = {
    default: 'text-code-foreground',
    muted: 'text-muted-foreground',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-destructive',
    info: 'text-info',
    accent: 'text-primary',
};
export const toneClass = (t?: Tone) => TONE[t ?? 'default'];

function Csv({ filename, text }: { filename: string; text: string }) {
    const download = () => {
        try {
            const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch { /* sin descarga */ }
    };
    const lines = text.split(/\r?\n/);
    return (
        <div>
            <pre className="max-h-48 overflow-auto whitespace-pre text-code-foreground">{lines.slice(0, 20).join('\n')}{lines.length > 20 ? `\n… (${lines.length - 1} rows)` : ''}</pre>
            <button type="button" onClick={download} className="mt-1 inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                {filename}
            </button>
        </div>
    );
}

export function OutputView({ out }: { out: CmdOutput }): React.ReactElement | null {
    switch (out.type) {
        case 'text':
            return out.text ? <p className={cn('whitespace-pre-wrap break-words', toneClass(out.tone))}>{out.text}</p> : null;
        case 'json':
            return <pre className="overflow-x-auto whitespace-pre-wrap break-words text-code-foreground">{JSON.stringify(out.data, null, 2)}</pre>;
        case 'csv':
            return <Csv filename={out.filename} text={out.text} />;
        case 'list':
            return (
                <div>
                    {out.title && <p className="text-primary">{out.title}</p>}
                    <ul className="list-inside list-disc">{out.items.map((i, k) => <li key={k} className="break-all">{i}</li>)}</ul>
                </div>
            );
        case 'kv':
            return (
                <div>
                    {out.title && <p className="mb-0.5 text-primary">{out.title}</p>}
                    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5">
                        {out.items.map((i, k) => (
                            <React.Fragment key={k}>
                                <dt className="text-muted-foreground">{i.key}</dt>
                                <dd className={cn('min-w-0 whitespace-pre-wrap break-words', toneClass(i.tone))}>{cellText(i.value as Cell)}</dd>
                            </React.Fragment>
                        ))}
                    </dl>
                </div>
            );
        case 'table':
            if (out.rows.length === 0) return <p className="text-muted-foreground">{out.caption ? `${out.caption}: ` : ''}(0)</p>;
            return (
                <div className="overflow-x-auto">
                    <table className="min-w-full text-left">
                        {out.caption && <caption className="pb-0.5 text-left text-primary">{out.caption}</caption>}
                        <thead>
                            <tr>{out.columns.map((c) => <th key={c.key} scope="col" className={cn('whitespace-nowrap pr-4 font-semibold text-primary', c.align === 'right' && 'text-right')}>{c.label}</th>)}</tr>
                        </thead>
                        <tbody>
                            {out.rows.map((r, i) => (
                                <tr key={i}>
                                    {out.columns.map((c) => {
                                        const v = cellText(r[c.key]);
                                        return <td key={c.key} className={cn('max-w-[28rem] break-words pr-4 align-top', v === '-' && 'text-muted-foreground', c.align === 'right' && 'text-right')}>{v}</td>;
                                    })}
                                </tr>
                            ))}
                        </tbody>
                        {out.total !== undefined && out.total > out.rows.length && (
                            <tfoot><tr><td colSpan={out.columns.length} className="pt-0.5 text-muted-foreground">({out.rows.length} / {out.total})</td></tr></tfoot>
                        )}
                    </table>
                </div>
            );
        case 'multi':
            return <div className="space-y-2">{out.parts.map((p, i) => <OutputView key={i} out={p} />)}</div>;
    }
}
