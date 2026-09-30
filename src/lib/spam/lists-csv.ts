/** CSV de las listas (puro): columnas type,value,include_subdomains,reason,expires_at. Protegido contra inyeccion de formulas. */
import { csvCell } from '@/lib/admin/csv';
import type { ListEntry, ListEntryInput, MatchType } from './lists-core';
import { MATCH_TYPES } from './lists-core';

export const CSV_HEADER = ['type', 'value', 'include_subdomains', 'reason', 'expires_at'] as const;
export const MAX_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_CSV_ROWS = 10_000;

export function entriesToCsv(rows: ReadonlyArray<Pick<ListEntry, 'matchType' | 'value' | 'includeSubdomains' | 'reason' | 'expiresAt'>>): string {
    const lines = [CSV_HEADER.join(',')];
    for (const r of rows) {
        lines.push([r.matchType, r.value, r.includeSubdomains ? 'true' : 'false', r.reason ?? '', r.expiresAt ? r.expiresAt.toISOString() : ''].map(csvCell).join(','));
    }
    return lines.join('\r\n') + '\r\n';
}

/** Parser RFC 4180 minimo (comillas dobles, saltos de linea dentro de comillas). */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQ = false;
    const src = text.replace(/^﻿/, '');
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (inQ) {
            if (c === '"') {
                if (src[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
            } else cell += c;
        } else if (c === '"') inQ = true;
        else if (c === ',') { row.push(cell); cell = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && src[i + 1] === '\n') i++;
            row.push(cell); cell = '';
            if (row.some((x) => x.trim() !== '')) rows.push(row);
            row = [];
            if (rows.length > MAX_CSV_ROWS + 1) break;
        } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); if (row.some((x) => x.trim() !== '')) rows.push(row); }
    return rows;
}

export interface ParsedCsv { entries: Array<{ line: number; input: ListEntryInput }>; errors: Array<{ line: number; error: string }> }

/** Convierte el CSV en entradas sin validar el valor (eso lo hace normalizeEntry). Acepta cabecera opcional y valores sueltos. */
export function csvToInputs(text: string): ParsedCsv {
    const out: ParsedCsv = { entries: [], errors: [] };
    if (text.length > MAX_CSV_BYTES) { out.errors.push({ line: 0, error: 'too_large' }); return out; }
    const rows = parseCsv(text);
    let start = 0;
    const head = rows[0]?.map((x) => x.trim().toLowerCase());
    const hasHeader = !!head && (head[0] === 'type' || head[0] === 'tipo') && head.length >= 2;
    if (hasHeader) start = 1;
    if (rows.length - start > MAX_CSV_ROWS) { out.errors.push({ line: 0, error: 'too_many_rows' }); return out; }
    for (let i = start; i < rows.length; i++) {
        const r = rows[i].map((x) => x.trim());
        const line = i + 1;
        let type: string, value: string, rest: string[];
        if ((MATCH_TYPES as readonly string[]).includes(r[0]?.toLowerCase() ?? '') && r.length >= 2) {
            type = r[0].toLowerCase(); value = r[1]; rest = r.slice(2);
        } else if (r.length >= 1 && r[0]) {
            // Valor suelto: se infiere el tipo
            value = r[0]; rest = r.slice(1);
            const v = value.toLowerCase();
            type = v.startsWith('*@') ? 'wildcard' : /^\.?[a-z]{2,24}$/.test(v) && v.startsWith('.') ? 'tld' : v.includes('@') ? 'email' : 'domain';
        } else { out.errors.push({ line, error: 'invalid_row' }); continue; }
        const sub = /^(true|1|yes|si|sí)$/i.test(rest[0] ?? '');
        out.entries.push({ line, input: { matchType: type as MatchType, value, includeSubdomains: sub, reason: rest[1] || null, expiresAt: rest[2] || null } });
    }
    return out;
}
