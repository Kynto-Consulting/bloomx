/**
 * elixir-xlsx.ts — lector minimo y seguro de .xlsx (primera hoja) sin dependencias.
 *
 * Reemplaza a `xlsx@0.18.5` (CVE-2023-30533 prototype pollution, CVE-2024-22363 ReDoS).
 * Un .xlsx es un ZIP con XML; aqui solo se leen: workbook, rels, sharedStrings, styles y la primera hoja.
 *
 *  - Sin evaluacion de formulas (se lee el valor en cache), sin macros, sin cargar imagenes ni enlaces externos.
 *  - Descompresion con `DecompressionStream('deflate-raw')` (navegadores modernos y Node >= 18) con tope de bytes
 *    reales descomprimidos (proteccion contra zip bombs aunque la cabecera mienta).
 *  - Objetos sin prototipo modificable: las celdas se guardan en arrays.
 *  - Fechas: las celdas con formato de fecha/hora se convierten a 'YYYY-MM-DD' / 'YYYY-MM-DD HH:MM:SS' (sin zona horaria).
 *  - No soporta ZIP64, cifrado ni .xls (binario antiguo): usar CSV.
 */

import { TABLE_LIMITS, TableLimitError, tableFromMatrix, type ParsedTable } from './elixir-csv';

export class XlsxError extends Error {
    constructor(message: string) { super(message); this.name = 'XlsxError'; }
}

export const XLSX_LIMITS = {
    maxFileBytes: 15 * 1024 * 1024,
    maxEntryBytes: 60 * 1024 * 1024,
    maxTotalBytes: 120 * 1024 * 1024,
    maxEntries: 2_000,
} as const;

// ── ZIP ───────────────────────────────────────────────────────────────────────

interface ZipEntry { name: string; method: number; compSize: number; size: number; offset: number; flags: number }

function readZipDirectory(b: Uint8Array): Map<string, ZipEntry> {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
        if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd === -1) throw new XlsxError('El archivo no es un .xlsx válido (ZIP no encontrado)');
    const total = dv.getUint16(eocd + 10, true);
    const cdSize = dv.getUint32(eocd + 12, true);
    const cdOffset = dv.getUint32(eocd + 16, true);
    if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new XlsxError('ZIP64 no soportado; exporte como CSV');
    if (total > XLSX_LIMITS.maxEntries) throw new XlsxError('El archivo contiene demasiadas entradas');
    if (cdOffset + cdSize > b.length) throw new XlsxError('Directorio ZIP corrupto');
    const entries = new Map<string, ZipEntry>();
    let p = cdOffset;
    const dec = new TextDecoder('utf-8');
    for (let n = 0; n < total; n++) {
        if (p + 46 > b.length || dv.getUint32(p, true) !== 0x02014b50) throw new XlsxError('Directorio ZIP corrupto');
        const flags = dv.getUint16(p + 8, true);
        const method = dv.getUint16(p + 10, true);
        const compSize = dv.getUint32(p + 20, true);
        const size = dv.getUint32(p + 24, true);
        const nameLen = dv.getUint16(p + 28, true);
        const extraLen = dv.getUint16(p + 30, true);
        const commentLen = dv.getUint16(p + 32, true);
        const offset = dv.getUint32(p + 42, true);
        const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
        entries.set(name, { name, method, compSize, size, offset, flags });
        p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
}

async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
    if (typeof DecompressionStream === 'undefined') throw new XlsxError('Este navegador no puede leer .xlsx; exporte como CSV');
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    const writePromise = writer.write(data as unknown as BufferSource).then(() => writer.close()).catch(() => { /* se reporta al leer */ });
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > limit) { await reader.cancel().catch(() => {}); throw new XlsxError('El archivo descomprimido es demasiado grande'); }
            chunks.push(value);
        }
    } catch (e) {
        if (e instanceof XlsxError) throw e;
        throw new XlsxError('Archivo .xlsx corrupto (error al descomprimir)');
    }
    await writePromise;
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
}

class ZipReader {
    private entries: Map<string, ZipEntry>;
    private dv: DataView;
    private budget: number = XLSX_LIMITS.maxTotalBytes;
    constructor(private bytes: Uint8Array) {
        this.entries = readZipDirectory(bytes);
        this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    has(name: string) { return this.entries.has(name); }
    names() { return [...this.entries.keys()]; }
    async text(name: string): Promise<string | null> {
        const e = this.entries.get(name);
        if (!e) return null;
        if (e.flags & 1) throw new XlsxError('Archivo cifrado no soportado');
        if (e.size > XLSX_LIMITS.maxEntryBytes) throw new XlsxError('Una hoja del archivo es demasiado grande');
        const lh = e.offset;
        if (lh + 30 > this.bytes.length || this.dv.getUint32(lh, true) !== 0x04034b50) throw new XlsxError('Entrada ZIP corrupta');
        const start = lh + 30 + this.dv.getUint16(lh + 26, true) + this.dv.getUint16(lh + 28, true);
        if (start + e.compSize > this.bytes.length) throw new XlsxError('Entrada ZIP corrupta');
        const raw = this.bytes.subarray(start, start + e.compSize);
        const limit = Math.min(XLSX_LIMITS.maxEntryBytes, this.budget);
        let data: Uint8Array;
        if (e.method === 0) data = raw;
        else if (e.method === 8) data = await inflateRaw(raw, limit);
        else throw new XlsxError('Método de compresión ZIP no soportado');
        this.budget -= data.length;
        if (data.length > limit || this.budget < 0) throw new XlsxError('El archivo descomprimido es demasiado grande');
        return new TextDecoder('utf-8').decode(data);
    }
}

// ── XML helpers (regex acotadas; el XML de hojas es regular) ─────────────────

function decodeEntities(s: string): string {
    return s
        .replace(/_x([0-9A-Fa-f]{4})_/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
        .replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
            if (e === 'amp') return '&';
            if (e === 'lt') return '<';
            if (e === 'gt') return '>';
            if (e === 'quot') return '"';
            if (e === 'apos') return "'";
            const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
        });
}

function attrs(tag: string): Map<string, string> {
    const m = new Map<string, string>();
    const re = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g;
    let x: RegExpExecArray | null;
    while ((x = re.exec(tag)) !== null) m.set(x[1] ?? x[3], decodeEntities(x[2] ?? x[4] ?? ''));
    return m;
}

function textOf(xml: string): string {
    let out = '';
    const re = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g;
    let m: RegExpExecArray | null;
    const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    while ((m = re.exec(clean)) !== null) out += m[1] ?? '';
    return decodeEntities(out);
}

function parseSharedStrings(xml: string | null): string[] {
    if (!xml) return [];
    const out: string[] = [];
    const re = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
        out.push(textOf(m[1] ?? ''));
        if (out.length > 2_000_000) throw new XlsxError('Demasiadas cadenas compartidas');
    }
    return out;
}

// ── Estilos / fechas ──────────────────────────────────────────────────────────

const BUILTIN_DATE_FMTS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function classifyFormat(code: string): 'date' | 'datetime' | 'time' | null {
    const c = code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '').replace(/_./g, '').replace(/\*./g, '');
    if (/general/i.test(c)) return null;
    const hasDate = /[dy]/i.test(c);
    const hasTime = /[hs]/i.test(c) || /a\/p|am\/pm/i.test(c);
    if (hasDate && hasTime) return 'datetime';
    if (hasDate) return 'date';
    if (hasTime) return 'time';
    // "m" suelto ambiguo (mes); si no hay d/y/h/s no se considera fecha
    return null;
}

function parseStyles(xml: string | null): Array<'date' | 'datetime' | 'time' | null> {
    if (!xml) return [];
    const custom = new Map<number, string>();
    const nre = /<numFmt\b([^>]*?)\/?>/g;
    let m: RegExpExecArray | null;
    while ((m = nre.exec(xml)) !== null) {
        const a = attrs(m[1]);
        const id = Number(a.get('numFmtId'));
        if (Number.isInteger(id)) custom.set(id, a.get('formatCode') ?? '');
    }
    const cx = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
    if (!cx) return [];
    const out: Array<'date' | 'datetime' | 'time' | null> = [];
    const xre = /<xf\b([^>]*?)(?:\/>|>)/g;
    while ((m = xre.exec(cx[1])) !== null) {
        const id = Number(attrs(m[1]).get('numFmtId') ?? 0);
        if (custom.has(id)) out.push(classifyFormat(custom.get(id)!));
        else if (BUILTIN_DATE_FMTS.has(id)) out.push(id >= 45 && id <= 47 ? 'time' : (id >= 18 && id <= 21) ? 'time' : id === 22 ? 'datetime' : 'date');
        else out.push(null);
    }
    return out;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function excelSerialToString(serial: number, kind: 'date' | 'datetime' | 'time', date1904 = false): string {
    const days = Math.floor(serial);
    const secs = Math.round((serial - days) * 86400);
    const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    const d = new Date(base + days * 86400000 + secs * 1000);
    const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    const time = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
    if (kind === 'time') return time;
    return kind === 'date' ? date : `${date} ${time}`;
}

// ── Hoja ──────────────────────────────────────────────────────────────────────

function colToIndex(letters: string): number {
    let n = 0;
    for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

function normalizeNumber(v: string): string {
    const t = v.trim();
    if (/e/i.test(t)) {
        const n = Number(t);
        if (Number.isFinite(n)) return Number.isInteger(n) ? String(n) : String(parseFloat(n.toPrecision(15)));
    }
    return t;
}

function parseSheet(xml: string, shared: string[], styles: Array<'date' | 'datetime' | 'time' | null>, date1904: boolean): string[][] {
    const grid = new Map<number, string[]>();
    const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
    let rm: RegExpExecArray | null;
    let seqRow = 0;
    while ((rm = rowRe.exec(xml)) !== null) {
        const ra = attrs(rm[1]);
        const rIdx = ra.has('r') ? Number(ra.get('r')) - 1 : seqRow;
        seqRow = rIdx + 1;
        if (!Number.isInteger(rIdx) || rIdx < 0) continue;
        if (rIdx > TABLE_LIMITS.maxRows + 1) throw new TableLimitError(`El archivo excede el máximo de ${TABLE_LIMITS.maxRows} filas`);
        const body = rm[2];
        if (!body) continue;
        const cells: string[] = [];
        const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
        let cm: RegExpExecArray | null;
        let seqCol = 0;
        while ((cm = cellRe.exec(body)) !== null) {
            const ca = attrs(cm[1]);
            const ref = ca.get('r')?.match(/^([A-Za-z]+)(\d+)$/);
            const cIdx = ref ? colToIndex(ref[1]) : seqCol;
            seqCol = cIdx + 1;
            if (cIdx >= TABLE_LIMITS.maxCols) continue;
            const inner = cm[2] ?? '';
            const t = ca.get('t') ?? 'n';
            let value = '';
            const vm = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
            const raw = vm ? decodeEntities(vm[1]) : '';
            if (t === 's') value = shared[Number(raw)] ?? '';
            else if (t === 'inlineStr') value = textOf(inner);
            else if (t === 'str') value = raw;
            else if (t === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
            else if (t === 'e') value = '';
            else if (t === 'd') value = raw.replace('T', ' ').replace(/Z$/, '').replace(/\.\d+$/, '').replace(/ 00:00:00$/, '');
            else if (raw !== '') {
                const kind = styles[Number(ca.get('s') ?? 0)] ?? null;
                const n = Number(raw);
                value = kind && Number.isFinite(n) ? excelSerialToString(n, kind, date1904) : normalizeNumber(raw);
            }
            while (cells.length < cIdx) cells.push('');
            cells[cIdx] = value.trim();
        }
        if (cells.some(v => v !== '')) grid.set(rIdx, cells);
    }
    const matrix: string[][] = [];
    const keys = [...grid.keys()].sort((a, b) => a - b);
    for (const k of keys) matrix.push(grid.get(k)!);
    return matrix;
}

// ── API ───────────────────────────────────────────────────────────────────────

function resolveFirstSheetPath(workbookXml: string | null, relsXml: string | null, zip: ZipReader): string {
    if (workbookXml && relsXml) {
        const sm = workbookXml.match(/<sheet\b([^>]*?)\/?>/);
        const rid = sm ? attrs(sm[1]).get('r:id') : undefined;
        if (rid) {
            const rre = /<Relationship\b([^>]*?)\/?>/g;
            let m: RegExpExecArray | null;
            while ((m = rre.exec(relsXml)) !== null) {
                const a = attrs(m[1]);
                if (a.get('Id') === rid && a.get('Target')) {
                    const target = a.get('Target')!;
                    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
                    const norm = path.replace(/\/\.\//g, '/');
                    if (zip.has(norm)) return norm;
                }
            }
        }
    }
    const fallback = zip.names().filter(n => /^xl\/worksheets\/[^/]+\.xml$/.test(n)).sort()[0];
    if (!fallback) throw new XlsxError('No se encontró ninguna hoja en el archivo');
    return fallback;
}

/** Lee la primera hoja de un .xlsx y la devuelve como tabla (primera fila = cabeceras). */
export async function parseXlsx(input: ArrayBuffer | Uint8Array): Promise<ParsedTable> {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length > XLSX_LIMITS.maxFileBytes) throw new XlsxError(`El archivo excede ${Math.round(XLSX_LIMITS.maxFileBytes / 1048576)} MB`);
    if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
        throw new XlsxError('Formato no soportado: use .xlsx o CSV (los .xls antiguos no se admiten)');
    }
    const zip = new ZipReader(bytes);
    if (!zip.has('xl/workbook.xml') && !zip.has('xl/worksheets/sheet1.xml')) throw new XlsxError('El archivo no parece un libro de Excel');
    const [workbook, rels, sharedXml, stylesXml] = [
        await zip.text('xl/workbook.xml'), await zip.text('xl/_rels/workbook.xml.rels'),
        await zip.text('xl/sharedStrings.xml'), await zip.text('xl/styles.xml'),
    ];
    const sheetPath = resolveFirstSheetPath(workbook, rels, zip);
    const sheetXml = await zip.text(sheetPath);
    if (!sheetXml) throw new XlsxError('Hoja vacía');
    const date1904 = !!workbook && /<workbookPr\b[^>]*date1904\s*=\s*"(1|true)"/i.test(workbook);
    const matrix = parseSheet(sheetXml, parseSharedStrings(sharedXml), parseStyles(stylesXml), date1904);
    return tableFromMatrix(matrix, 'xlsx');
}
