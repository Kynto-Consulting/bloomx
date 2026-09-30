/**
 * elixir-csv.ts — lectura de tablas (CSV) para Elixir.
 *
 *  - Quita BOM UTF-8.
 *  - Detecta el delimitador (`,` `;` tab `|`) o respeta una primera linea `sep=;` (Excel).
 *  - RFC 4180: comillas, comillas escapadas (""), saltos de linea dentro de comillas, \r\n / \n / \r.
 *  - Cabeceras vacias -> `columna_N`; duplicadas -> `nombre_2`; nombres peligrosos (__proto__) renombrados.
 *  - Filas completamente vacias se omiten.
 */

export type Row = Record<string, string>;

export interface ParsedTable {
    headers: string[];
    rows: Row[];
    delimiter: string;
    warnings: string[];
}

export class TableLimitError extends Error {
    constructor(message: string) { super(message); this.name = 'TableLimitError'; }
}

export const TABLE_LIMITS = { maxRows: 100_000, maxCols: 500 } as const;

const CANDIDATES = [',', ';', '\t', '|'];

export function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Divide en "lineas logicas" (respetando comillas), como maximo `max` lineas. */
function firstLogicalLines(text: string, max: number): string[] {
    const lines: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < text.length && lines.length < max; i++) {
        const c = text[i];
        if (c === '"') inQ = !inQ;
        if (!inQ && (c === '\n' || c === '\r')) {
            if (c === '\r' && text[i + 1] === '\n') i++;
            if (cur.trim()) lines.push(cur);
            cur = '';
        } else cur += c;
    }
    if (cur.trim() && lines.length < max) lines.push(cur);
    return lines;
}

function countOutsideQuotes(line: string, ch: string): number {
    let n = 0, inQ = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') inQ = !inQ;
        else if (!inQ && c === ch) n++;
    }
    return n;
}

export function detectDelimiter(text: string): string {
    text = stripBom(text);
    const sep = text.match(/^sep=(.)\r?\n/i);
    if (sep) return sep[1];
    const lines = firstLogicalLines(text, 10);
    if (!lines.length) return ',';
    let best = ',', bestScore = -1, bestCount = 0;
    for (const cand of CANDIDATES) {
        const head = countOutsideQuotes(lines[0], cand);
        if (head === 0) continue;
        const consistent = lines.filter(l => countOutsideQuotes(l, cand) === head).length;
        const score = consistent * 1000 + head;
        if (score > bestScore) { best = cand; bestScore = score; bestCount = head; }
    }
    return bestCount ? best : ',';
}

/** Parser de matriz (sin cabeceras). No recorta salvo espacios exteriores de cada campo. */
export function parseDelimited(text: string, delimiter: string, maxRows: number = TABLE_LIMITS.maxRows + 1): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQ = false;
    let fieldStart = true; // solo se abre una comilla al inicio del campo
    let quoted = false;
    const pushField = () => { row.push(field.trim()); field = ''; fieldStart = true; quoted = false; };
    const pushRow = () => {
        pushField();
        if (row.some(v => v !== '')) {
            rows.push(row);
            if (rows.length > maxRows) throw new TableLimitError(`El archivo excede el máximo de ${maxRows - 1} filas`);
        }
        row = [];
    };
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQ) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQ = false;
            } else field += c;
            continue;
        }
        if (c === '"' && fieldStart) { inQ = true; quoted = true; fieldStart = false; continue; }
        if (c === delimiter) { pushField(); continue; }
        if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            pushRow();
            continue;
        }
        field += c;
        if (c !== ' ' && c !== '\t') fieldStart = false;
    }
    if (inQ || field !== '' || row.length > 0 || quoted) pushRow();
    return rows;
}

const DANGEROUS = new Set(['__proto__', 'constructor', 'prototype']);

export function normalizeHeaders(raw: string[]): string[] {
    const seen = new Map<string, number>();
    return raw.map((h, i) => {
        let name = stripBom(String(h ?? '')).trim().replace(/\s+/g, ' ');
        if (!name) name = `columna_${i + 1}`;
        if (DANGEROUS.has(name)) name = `${name}_`;
        const n = (seen.get(name.toLowerCase()) ?? 0) + 1;
        seen.set(name.toLowerCase(), n);
        return n === 1 ? name : `${name}_${n}`;
    });
}

export function tableFromMatrix(matrix: string[][], delimiter = ','): ParsedTable {
    const warnings: string[] = [];
    if (!matrix.length) return { headers: [], rows: [], delimiter, warnings };
    const width = matrix[0].length;
    if (width > TABLE_LIMITS.maxCols) throw new TableLimitError(`El archivo excede el máximo de ${TABLE_LIMITS.maxCols} columnas`);
    const headers = normalizeHeaders(matrix[0]);
    if (headers.length !== new Set(matrix[0].map(h => String(h).trim())).size) warnings.push('Había cabeceras duplicadas o vacías; se renombraron.');
    let wider = 0;
    const rows: Row[] = matrix.slice(1).map(cells => {
        if (cells.length > headers.length && cells.slice(headers.length).some(v => v !== '')) wider++;
        const row: Row = {};
        headers.forEach((h, i) => { row[h] = cells[i] ?? ''; });
        return row;
    });
    if (wider) warnings.push(`${wider} fila(s) tenían más columnas que la cabecera; se ignoró el exceso.`);
    return { headers, rows, delimiter, warnings };
}

export function parseCsv(text: string, opts: { delimiter?: string } = {}): ParsedTable {
    text = stripBom(text);
    const delimiter = opts.delimiter ?? detectDelimiter(text);
    if (/^sep=.\r?\n/i.test(text)) text = text.replace(/^sep=.\r?\n/i, '');
    const matrix = parseDelimited(text, delimiter);
    return tableFromMatrix(matrix, delimiter);
}

/**
 * Decodifica los bytes de un CSV: UTF-8 (con o sin BOM), UTF-16 con BOM y, si no es UTF-8 valido,
 * Windows-1252 (CSV "ANSI" de Excel en Windows: sin esto los acentos salen como caracteres rotos).
 */
export function decodeCsvBytes(bytes: Uint8Array): string {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        return new TextDecoder('windows-1252').decode(bytes);
    }
}
