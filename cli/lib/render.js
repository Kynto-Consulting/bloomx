'use strict';

// Render de la salida estructurada del servidor (CmdOutput) a texto, con ANSI opcional (usa los colores del TERMINAL del usuario).

const ANSI = { default: '', muted: '\u001b[2m', success: '\u001b[32m', warning: '\u001b[33m', danger: '\u001b[31m', info: '\u001b[36m', accent: '\u001b[35m' };
const RESET = '\u001b[0m';

function paint(text, tone, color) {
    return color && tone && ANSI[tone] ? `${ANSI[tone]}${text}${RESET}` : text;
}

function cellText(v) {
    if (Array.isArray(v)) return v.map(cellText).join(', ');
    if (v === null || v === undefined || v === '') return '-';
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    return String(v).replace(/[\r\n\t]+/g, ' ');
}

const MAX_CELL = 64;
const clip = (s) => (s.length > MAX_CELL ? `${s.slice(0, MAX_CELL - 1)}…` : s);
const pad = (s, n, right) => (right ? s.padStart(n) : s.padEnd(n));

function renderText(out, color) {
    switch (out && out.type) {
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
        case 'multi': return out.parts.filter((p) => !(p.type === 'text' && !p.text)).map((p) => renderText(p, color)).join('\n\n');
        default: return '';
    }
}

module.exports = { renderText, paint, cellText };
