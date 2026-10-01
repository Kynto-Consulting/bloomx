import type { Cell, CmdOutput, Tone } from './types';

/**
 * Render de la salida estructurada a texto plano (la web la pinta con clases de tema; el CLI la imprime con ANSI opcional).
 * Sin dependencias; puro y testeable. Los colores ANSI son los 8 basicos del terminal del usuario (heredan SU tema).
 */

const ANSI: Record<Tone, string> = {
    default: '', muted: '\u001b[2m', success: '\u001b[32m', warning: '\u001b[33m', danger: '\u001b[31m', info: '\u001b[36m', accent: '\u001b[35m',
};
const RESET = '\u001b[0m';

export function paint(text: string, tone: Tone | undefined, color: boolean): string {
    return color && tone && ANSI[tone] ? `${ANSI[tone]}${text}${RESET}` : text;
}

export function cellText(v: Cell | Cell[]): string {
    if (Array.isArray(v)) return v.map(cellText).join(', ');
    if (v === null || v === undefined || v === '') return '-';
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    return String(v).replace(/[\r\n\t]+/g, ' ');
}

const MAX_CELL = 64;
const clip = (s: string) => (s.length > MAX_CELL ? `${s.slice(0, MAX_CELL - 1)}…` : s);
const pad = (s: string, n: number, right?: boolean) => (right ? s.padStart(n) : s.padEnd(n));

export function renderText(out: CmdOutput, opts: { color?: boolean } = {}): string {
    const color = !!opts.color;
    switch (out.type) {
        case 'text': return paint(out.text, out.tone, color);
        case 'json': return JSON.stringify(out.data, null, 2);
        case 'csv': return out.text;
        case 'list': return [out.title ? paint(out.title, 'accent', color) : '', ...out.items.map((i) => `  - ${i}`)].filter((s) => s !== '').join('\n');
        case 'kv': {
            const w = Math.max(0, ...out.items.map((i) => i.key.length));
            const lines = out.items.map((i) => `${paint(i.key.padEnd(w), 'muted', color)}  ${paint(cellText(i.value), i.tone, color)}`);
            return [out.title ? paint(out.title, 'accent', color) : '', ...lines].filter((s) => s !== '').join('\n');
        }
        case 'table': {
            if (out.rows.length === 0) return paint(out.caption ? `${out.caption}: (0)` : '(0)', 'muted', color);
            const cols = out.columns;
            const cells = out.rows.map((r) => cols.map((c) => clip(cellText(r[c.key]))));
            const widths = cols.map((c, i) => Math.max(c.label.length, ...cells.map((r) => r[i].length)));
            const head = cols.map((c, i) => pad(c.label, widths[i], c.align === 'right')).join('  ');
            const body = cells.map((r) => r.map((v, i) => pad(v, widths[i], cols[i].align === 'right')).join('  ').trimEnd());
            const foot = out.total !== undefined && out.total > out.rows.length ? [paint(`(${out.rows.length} / ${out.total})`, 'muted', color)] : [];
            return [paint(head.trimEnd(), 'accent', color), ...body, ...foot].join('\n');
        }
        case 'multi': return out.parts.filter((p) => !(p.type === 'text' && !p.text)).map((p) => renderText(p, opts)).join('\n\n');
    }
}

/** Datos en bruto de una salida (para --json y pipes): filas, objeto clave/valor, texto... sin formato de pantalla. */
export function toJsonData(out: CmdOutput): unknown {
    switch (out.type) {
        case 'json': return out.data;
        case 'text': return { message: out.text };
        case 'csv': return { filename: out.filename, csv: out.text };
        case 'list': return out.items;
        case 'table': return out.rows.map((r) => Object.fromEntries(out.columns.map((c) => [c.key, r[c.key] ?? null])));
        case 'kv': return Object.fromEntries(out.items.map((i) => [i.key, i.value ?? null]));
        case 'multi': return out.parts.filter((p) => !(p.type === 'text' && !p.text)).map(toJsonData);
    }
}

/** Tamano aproximado en bytes de la salida (para el tope de 1 MB). */
export function outputSize(out: CmdOutput): number {
    try { return Buffer.byteLength(JSON.stringify(out), 'utf8'); } catch { return Number.MAX_SAFE_INTEGER; }
}
