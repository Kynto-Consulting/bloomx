/**
 * liquid.ts — Motor Liquid propio para personalizar correos (Elixir).
 *
 * Diseno:
 *   - Pipeline compile -> render: `compileTemplate()` tokeniza y parsea UNA vez (errores de sintaxis,
 *     tags desconocidos y filtros desconocidos se detectan aqui, antes de enviar nada) y
 *     `CompiledTemplate.render(data)` se ejecuta por fila.
 *   - NUNCA devuelve la plantilla cruda: cualquier fallo lanza `LiquidError` (tipado, con codigo y posicion).
 *     `renderLiquid()` es la variante que no lanza (`{ ok: false, error }`).
 *   - Sin eval / Function / vm. Sin acceso a prototipos (solo propiedades propias).
 *   - Limites: tamano de plantilla, profundidad, iteraciones, rango, salida y tiempo (deadline).
 *   - Autoescape opcional (HTML) con filtro `raw` para valores de confianza.
 *
 * Tags: if/elsif/else, unless, for (limit, offset, reversed, rangos, else, forloop.*, parentloop),
 *       case/when (coma u `or`), assign, capture, comment, raw, increment, decrement, cycle, echo,
 *       break, continue. Control de espacios `{{-` `-}}` `{%-` `-%}`.
 * No soportados (error explicito): include, render, liquid, tablerow, ifchanged, etc.
 *
 * Diferencias deliberadas con Liquid estandar (pensadas para datos de CSV):
 *   - Una celda vacia, "false", "nil" o "null" se considera falsa en `if`/`unless`/`default`.
 *   - Los nombres de columna pueden contener espacios y acentos: `{{ Nombre completo }}`.
 *     Para nombres con simbolos use `{{ row["Precio (S/.)"] }}`.
 *   - Fechas `YYYY-MM-DD` y `DD/MM/YYYY` (dia primero) se tratan como fecha de calendario, sin zona horaria.
 */

export type LiquidRow = Record<string, string>;
export type LiquidData = Record<string, unknown>;

// ── Errores ───────────────────────────────────────────────────────────────────

export type LiquidErrorCode =
    | 'syntax'
    | 'unknown_tag'
    | 'unknown_filter'
    | 'undefined_variable'
    | 'runtime'
    | 'limit_template'
    | 'limit_depth'
    | 'limit_iterations'
    | 'limit_range'
    | 'limit_output'
    | 'limit_time';

export class LiquidError extends Error {
    readonly code: LiquidErrorCode;
    readonly start: number;
    readonly end: number;
    line = 1;
    column = 1;
    constructor(code: LiquidErrorCode, message: string, start = 0, end = start) {
        super(message);
        this.name = 'LiquidError';
        this.code = code;
        this.start = start;
        this.end = end;
    }
    toJSON() {
        return { code: this.code, message: this.message, line: this.line, column: this.column };
    }
}

function locate(err: LiquidError, src: string): LiquidError {
    const upto = src.slice(0, Math.min(err.start, src.length));
    const lines = upto.split('\n');
    err.line = lines.length;
    err.column = lines[lines.length - 1].length + 1;
    err.message = `${err.message} (línea ${err.line}, columna ${err.column})`;
    return err;
}

// ── Limites por defecto ───────────────────────────────────────────────────────

export const LIQUID_DEFAULT_LIMITS = {
    maxTemplateLength: 500_000,
    maxDepth: 24,
    maxIterations: 100_000,
    maxRangeItems: 10_000,
    maxOutputLength: 5 * 1024 * 1024,
    maxSteps: 2_000_000,
    timeoutMs: 2_000,
} as const;

export interface CompileOptions {
    /** Error si se usa un filtro que no existe (default true). */
    strictFilters?: boolean;
    maxTemplateLength?: number;
    maxDepth?: number;
}

export interface RenderOptions {
    /** Escapa HTML en `{{ }}` salvo `| raw`, `| escape` y resultados de `capture`. */
    autoescape?: boolean;
    /** Error si `{{ x }}` referencia una variable inexistente (salvo con `| default`). */
    strictVariables?: boolean;
    /** Zona IANA para `now` y timestamps con hora (default 'UTC'). */
    timezone?: string;
    locale?: 'en' | 'es';
    now?: Date;
    timeoutMs?: number;
    maxIterations?: number;
    maxRangeItems?: number;
    maxOutputLength?: number;
}

// ── Valores ───────────────────────────────────────────────────────────────────

class SafeString {
    constructor(readonly v: string) {}
}
const EMPTY = Symbol('empty');
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function unwrap(v: unknown): unknown {
    return v instanceof SafeString ? v.v : v;
}

function fmtNum(n: number): string {
    if (!Number.isFinite(n)) return '';
    if (Number.isInteger(n)) return String(n);
    return String(parseFloat(n.toPrecision(15)));
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

interface FilterEnv {
    autoescape: boolean;
    timezone: string;
    locale: 'en' | 'es';
    now: Date;
    maxOut: number;
    fail(msg: string, code?: LiquidErrorCode): never;
}

function str(v: unknown, env?: Pick<FilterEnv, 'timezone' | 'locale'>): string {
    v = unwrap(v);
    if (v === null || v === undefined || v === EMPTY) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return fmtNum(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (v instanceof Date) {
        const p = isNaN(v.getTime()) ? null : instantParts(v.getTime(), env?.timezone ?? 'UTC');
        return p ? formatDate(p, '%Y-%m-%d %H:%M:%S', env?.locale ?? 'en') : '';
    }
    if (Array.isArray(v)) return v.map(x => str(x, env)).join('');
    try { return JSON.stringify(v) ?? ''; } catch { return ''; }
}

const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;
function isNumeric(v: unknown): boolean {
    v = unwrap(v);
    if (typeof v === 'number') return Number.isFinite(v);
    return typeof v === 'string' && NUM_RE.test(v.trim());
}
function num(v: unknown): number {
    v = unwrap(v);
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'boolean') return 0;
    if (typeof v === 'string' && NUM_RE.test(v.trim())) return Number(v.trim());
    return 0;
}
function isIntLike(v: unknown): boolean {
    v = unwrap(v);
    if (typeof v === 'number') return Number.isInteger(v);
    return typeof v === 'string' && /^[+-]?\d+$/.test(v.trim());
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof SafeString);
}

function truthy(v: unknown): boolean {
    v = unwrap(v);
    if (v === null || v === undefined || v === false || v === EMPTY) return false;
    if (typeof v === 'string') return !(v === '' || v === 'false' || v === 'nil' || v === 'null');
    return true;
}

function isBlankValue(v: unknown): boolean {
    v = unwrap(v);
    if (!truthy(v)) return true;
    if (typeof v === 'string') return v.trim() === '';
    if (Array.isArray(v)) return v.length === 0;
    if (isPlainObject(v)) return Object.keys(v).length === 0;
    return false;
}

function getProp(obj: unknown, key: unknown): unknown {
    obj = unwrap(obj);
    if (obj === null || obj === undefined) return undefined;
    const k = typeof key === 'number' ? key : str(key);
    if (Array.isArray(obj)) {
        if (k === 'size') return obj.length;
        if (k === 'first') return obj[0];
        if (k === 'last') return obj[obj.length - 1];
        const n = typeof k === 'number' ? k : (/^-?\d+$/.test(k) ? Number(k) : NaN);
        if (Number.isInteger(n)) return obj[n < 0 ? obj.length + n : n];
        return undefined;
    }
    if (typeof obj === 'string') {
        if (k === 'size') return [...obj].length;
        if (k === 'first') return obj[0];
        if (k === 'last') return obj[obj.length - 1];
        return undefined;
    }
    if (isPlainObject(obj)) {
        const ks = String(k);
        if (FORBIDDEN_KEYS.has(ks)) return undefined;
        if (Object.prototype.hasOwnProperty.call(obj, ks)) return obj[ks];
        if (ks === 'size') return Object.keys(obj).length;
    }
    return undefined;
}

function looseEq(a: unknown, b: unknown): boolean {
    a = unwrap(a); b = unwrap(b);
    const isNil = (x: unknown) => x === null || x === undefined;
    if (a === EMPTY || b === EMPTY) {
        const o = a === EMPTY ? b : a;
        if (o === EMPTY) return true;
        return isNil(o) || o === '' || (Array.isArray(o) && o.length === 0) || (typeof o === 'string' && o.trim() === '');
    }
    if (isNil(a) || isNil(b)) {
        const o = isNil(a) ? b : a;
        return isNil(o) || o === '';
    }
    if (typeof a === 'number' || typeof b === 'number') {
        if (isNumeric(a) && isNumeric(b)) return num(a) === num(b);
        return false;
    }
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => looseEq(x, b[i]));
    if (typeof a === 'object' || typeof b === 'object') return false;
    return str(a) === str(b);
}

const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
function compareVals(a: unknown, b: unknown, op: '<' | '>' | '<=' | '>='): boolean {
    a = unwrap(a); b = unwrap(b);
    let x: number | string, y: number | string;
    if (isNumeric(a) && isNumeric(b)) { x = num(a); y = num(b); }
    else if (typeof a === 'string' && typeof b === 'string' && ISO_DATE_ONLY.test(a) && ISO_DATE_ONLY.test(b)) { x = a; y = b; }
    else return false;
    switch (op) {
        case '<': return x < y;
        case '>': return x > y;
        case '<=': return x <= y;
        default: return x >= y;
    }
}

function containsVal(a: unknown, b: unknown): boolean {
    a = unwrap(a);
    if (Array.isArray(a)) return a.some(x => looseEq(x, b));
    if (typeof a === 'string') return a.includes(str(b));
    return false;
}

// ── Fechas (sin desfase de zona horaria para fechas de calendario) ───────────

const LOCALE_DATA = {
    en: {
        months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
        monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
        days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        daysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
        am: 'AM', pm: 'PM',
    },
    es: {
        months: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
        monthsShort: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
        days: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
        daysShort: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
        am: 'a. m.', pm: 'p. m.',
    },
} as const;

interface DateParts {
    y: number; mo: number; d: number; h: number; mi: number; s: number;
    dow: number; yday: number;
    /** Desfase en minutos respecto a UTC; null para fecha/hora "de pared" sin zona. */
    off: number | null;
    tz: string;
}

function daysInMonth(y: number, mo: number): number {
    return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}
function validYMD(y: number, mo: number, d: number): boolean {
    return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}
function wallParts(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): DateParts {
    const t = Date.UTC(y, mo - 1, d);
    const dow = new Date(t).getUTCDay();
    const yday = Math.round((t - Date.UTC(y, 0, 1)) / 86400000) + 1;
    return { y, mo, d, h, mi, s, dow, yday, off: null, tz: '' };
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();
export function isValidTimezone(tz: string): boolean {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}
function instantParts(ms: number, tz: string): DateParts {
    let f = dtfCache.get(tz);
    if (!f) {
        f = new Intl.DateTimeFormat('en-US', {
            timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
            hour: 'numeric', minute: 'numeric', second: 'numeric',
        });
        dtfCache.set(tz, f);
    }
    const g: Record<string, number> = {};
    for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') g[p.type] = Number(p.value);
    const w = wallParts(g.year, g.month, g.day, g.hour === 24 ? 0 : g.hour, g.minute, g.second);
    const asUtc = Date.UTC(g.year, g.month - 1, g.day, w.h, g.minute, g.second);
    w.off = Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
    w.tz = tz;
    return w;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i;
const DMY_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

function parseDateInput(v: unknown, env: Pick<FilterEnv, 'timezone' | 'now'>): DateParts | null {
    v = unwrap(v);
    if (v instanceof Date) return isNaN(v.getTime()) ? null : instantParts(v.getTime(), env.timezone);
    if (typeof v === 'number') {
        if (!Number.isFinite(v)) return null;
        return instantParts(Math.abs(v) < 1e11 ? v * 1000 : v, env.timezone);
    }
    if (typeof v !== 'string') return null;
    const s = v.trim();
    if (!s) return null;
    if (s === 'now' || s === 'today') return instantParts(env.now.getTime(), env.timezone);
    let m: RegExpMatchArray | null;
    if ((m = s.match(ISO_RE))) {
        const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
        if (!validYMD(y, mo, d)) return null;
        if (m[4] === undefined) return wallParts(y, mo, d);
        const h = Number(m[4]), mi = Number(m[5]), sec = Number(m[6] ?? 0);
        if (h > 23 || mi > 59 || sec > 59) return null;
        if (m[7]) {
            let offMin = 0;
            if (m[7].toUpperCase() !== 'Z') {
                const sign = m[7][0] === '-' ? -1 : 1;
                const digits = m[7].slice(1).replace(':', '');
                offMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2)));
            }
            return instantParts(Date.UTC(y, mo - 1, d, h, mi, sec) - offMin * 60000, env.timezone);
        }
        return wallParts(y, mo, d, h, mi, sec);
    }
    if ((m = s.match(DMY_RE))) {
        let d = Number(m[1]), mo = Number(m[2]);
        if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // claramente mm/dd/yyyy
        const y = Number(m[3]);
        if (!validYMD(y, mo, d)) return null;
        const h = Number(m[4] ?? 0), mi = Number(m[5] ?? 0), sec = Number(m[6] ?? 0);
        if (h > 23 || mi > 59 || sec > 59) return null;
        return wallParts(y, mo, d, h, mi, sec);
    }
    if (/^\d{10}$|^\d{13}$/.test(s)) return instantParts(s.length === 10 ? Number(s) * 1000 : Number(s), env.timezone);
    if (/[a-z]{3}/i.test(s)) {
        const ms = Date.parse(s);
        if (!isNaN(ms)) return instantParts(ms, env.timezone);
    }
    return null;
}

function formatDate(p: DateParts, fmt: string, locale: 'en' | 'es'): string {
    const L = LOCALE_DATA[locale] ?? LOCALE_DATA.en;
    const epoch = () => Math.floor((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - (p.off ?? 0) * 60000) / 1000);
    return fmt.replace(/%([-0_^#]?)(\d*)([a-zA-Z%])/g, (all, flag: string, width: string, c: string) => {
        const pad = (n: number, w: number, def: '0' | ' ' = '0') => {
            const ch = flag === '_' ? ' ' : flag === '0' ? '0' : def;
            return flag === '-' ? String(n) : String(n).padStart(width ? Number(width) : w, ch);
        };
        const text = (s: string) => {
            let r = s;
            if (flag === '^') r = r.toUpperCase();
            if (flag === '#') r = r === r.toUpperCase() ? r.toLowerCase() : r.toUpperCase();
            return width ? r.padStart(Number(width), ' ') : r;
        };
        const h12 = p.h % 12 || 12;
        const offStr = () => {
            const o = p.off ?? 0, a = Math.abs(o);
            return (o < 0 ? '-' : '+') + String(Math.floor(a / 60)).padStart(2, '0') + String(a % 60).padStart(2, '0');
        };
        switch (c) {
            case 'Y': return String(p.y);
            case 'C': return pad(Math.floor(p.y / 100), 2);
            case 'y': return pad(p.y % 100, 2);
            case 'm': return pad(p.mo, 2);
            case 'd': return pad(p.d, 2);
            case 'e': return pad(p.d, 2, ' ');
            case 'j': return pad(p.yday, 3);
            case 'H': return pad(p.h, 2);
            case 'k': return pad(p.h, 2, ' ');
            case 'I': return pad(h12, 2);
            case 'l': return pad(h12, 2, ' ');
            case 'M': return pad(p.mi, 2);
            case 'S': return pad(p.s, 2);
            case 'L': return '000';
            case 'p': return text(p.h < 12 ? L.am : L.pm);
            case 'P': return text((p.h < 12 ? L.am : L.pm).toLowerCase());
            case 'B': return text(L.months[p.mo - 1]);
            case 'b': case 'h': return text(L.monthsShort[p.mo - 1]);
            case 'A': return text(L.days[p.dow]);
            case 'a': return text(L.daysShort[p.dow]);
            case 'u': return String(p.dow === 0 ? 7 : p.dow);
            case 'w': return String(p.dow);
            case 'Z': return p.tz;
            case 'z': return offStr();
            case 's': return String(epoch());
            case 'F': return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
            case 'T': case 'X': return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}:${String(p.s).padStart(2, '0')}`;
            case 'R': return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
            case 'D': case 'x': return `${String(p.mo).padStart(2, '0')}/${String(p.d).padStart(2, '0')}/${String(p.y % 100).padStart(2, '0')}`;
            case 'n': return '\n';
            case 't': return '\t';
            case '%': return '%';
            default: return all;
        }
    });
}

/** Variables de sistema de fecha (mismas para vista previa y servidor). */
export function systemDateVars(now: Date = new Date(), timezone = 'UTC', locale: 'en' | 'es' = 'es'): Record<string, string> {
    const tz = isValidTimezone(timezone) ? timezone : 'UTC';
    const p = instantParts(now.getTime(), tz);
    return {
        current_date: formatDate(p, locale === 'es' ? '%-d de %B de %Y' : '%B %-d, %Y', locale),
        current_day: formatDate(p, '%A', locale),
        current_month: formatDate(p, '%B', locale),
        current_year: String(p.y),
    };
}

// ── Filtros ───────────────────────────────────────────────────────────────────

type FilterFn = (input: unknown, args: unknown[], kw: Record<string, unknown>, env: FilterEnv) => unknown;

function stripTags(s: string): string {
    let out = '';
    let i = 0;
    while (i < s.length) {
        const lt = s.indexOf('<', i);
        if (lt === -1) { out += s.slice(i); break; }
        out += s.slice(i, lt);
        if (s.startsWith('<!--', lt)) {
            const end = s.indexOf('-->', lt + 4);
            if (end === -1) break;
            i = end + 3;
            continue;
        }
        if (/[a-zA-Z/!?]/.test(s[lt + 1] ?? '')) {
            const gt = s.indexOf('>', lt + 1);
            if (gt === -1) break; // etiqueta sin cerrar: se descarta el resto
            i = gt + 1;
        } else {
            out += '<';
            i = lt + 1;
        }
    }
    return out;
}

function utf8ToB64(s: string): string {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
}
function b64ToUtf8(s: string): string {
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

function toArr(v: unknown): unknown[] {
    v = unwrap(v);
    if (Array.isArray(v)) return v;
    if (v === null || v === undefined || v === '') return [];
    return [v];
}

function needArg(env: FilterEnv, name: string, args: unknown[], n: number): void {
    if (args.length < n) env.fail(`El filtro "${name}" requiere ${n} argumento(s)`);
}

function cmpSort(a: unknown, b: unknown): number {
    if (isNumeric(a) && isNumeric(b)) return num(a) - num(b);
    return str(a).localeCompare(str(b), undefined, { numeric: true });
}

function ceilOrFloor(fn: (n: number) => number): FilterFn {
    return (v) => fn(num(v));
}

function roundHalfAway(n: number, digits: number): number {
    const f = 10 ** digits;
    const r = Math.round(Math.abs(n) * f + Number.EPSILON * f) / f;
    return n < 0 ? -r : r;
}

function replaceGuarded(s: string, find: string, repl: string, env: FilterEnv): string {
    if (find === '') return s;
    const parts = s.split(find);
    const grown = s.length + (parts.length - 1) * Math.max(0, repl.length - find.length);
    if (grown > env.maxOut) env.fail('El resultado de "replace" excede el límite de salida', 'limit_output');
    return parts.join(repl);
}

const FILTER_DEFS: Record<string, FilterFn> = {
    // strings
    upcase: (v) => str(v).toUpperCase(),
    downcase: (v) => str(v).toLowerCase(),
    capitalize: (v) => { const s = str(v); return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : ''; },
    strip: (v, a) => { const s = str(v); return a.length ? stripChars(s, str(a[0]), true, true) : s.trim(); },
    lstrip: (v, a) => { const s = str(v); return a.length ? stripChars(s, str(a[0]), true, false) : s.trimStart(); },
    rstrip: (v, a) => { const s = str(v); return a.length ? stripChars(s, str(a[0]), false, true) : s.trimEnd(); },
    strip_html: (v) => stripTags(str(v)),
    strip_newlines: (v) => str(v).replace(/\r?\n/g, ''),
    newline_to_br: (v, _a, _k, env) => {
        const wasSafe = v instanceof SafeString;
        let s = str(v);
        if (env.autoescape && !wasSafe) s = escapeHtml(s);
        s = s.replace(/\r?\n/g, '<br />\n');
        return env.autoescape ? new SafeString(s) : s;
    },
    escape: (v) => new SafeString(escapeHtml(str(v))),
    escape_once: (v) => new SafeString(
        str(v).replace(/&(?!amp;|lt;|gt;|quot;|#39;|#\d+;|#x[0-9a-f]+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    ),
    raw: (v) => new SafeString(str(v)),
    url_encode: (v) => encodeURIComponent(str(v)).replace(/%20/g, '+'),
    url_decode: (v) => { try { return decodeURIComponent(str(v).replace(/\+/g, ' ')); } catch { return str(v); } },
    base64_encode: (v) => utf8ToB64(str(v)),
    base64_decode: (v, _a, _k, env) => { try { return b64ToUtf8(str(v)); } catch { return env.fail('base64_decode: entrada no válida'); } },
    base64_url_safe_encode: (v) => utf8ToB64(str(v)).replace(/\+/g, '-').replace(/\//g, '_'),
    base64_url_safe_decode: (v, _a, _k, env) => {
        try { return b64ToUtf8(str(v).replace(/-/g, '+').replace(/_/g, '/')); } catch { return env.fail('base64_url_safe_decode: entrada no válida'); }
    },
    truncate: (v, a) => {
        const s = str(v), n = a.length ? Math.max(0, Math.floor(num(a[0]))) : 50, e = a.length > 1 ? str(a[1]) : '...';
        const chars = [...s];
        return chars.length > n ? chars.slice(0, Math.max(0, n - [...e].length)).join('') + e : s;
    },
    truncatewords: (v, a) => {
        const s = str(v).trim(), n = a.length ? Math.max(1, Math.floor(num(a[0]))) : 15, e = a.length > 1 ? str(a[1]) : '...';
        const words = s.split(/\s+/).filter(Boolean);
        return words.length > n ? words.slice(0, n).join(' ') + e : s;
    },
    replace: (v, a, _k, env) => { needArg(env, 'replace', a, 2); return replaceGuarded(str(v), str(a[0]), str(a[1]), env); },
    replace_first: (v, a, _k, env) => {
        needArg(env, 'replace_first', a, 2);
        const s = str(v), f = str(a[0]), i = s.indexOf(f);
        return f === '' || i === -1 ? s : s.slice(0, i) + str(a[1]) + s.slice(i + f.length);
    },
    replace_last: (v, a, _k, env) => {
        needArg(env, 'replace_last', a, 2);
        const s = str(v), f = str(a[0]), i = s.lastIndexOf(f);
        return f === '' || i === -1 ? s : s.slice(0, i) + str(a[1]) + s.slice(i + f.length);
    },
    remove: (v, a, _k, env) => { needArg(env, 'remove', a, 1); const f = str(a[0]); return f === '' ? str(v) : str(v).split(f).join(''); },
    remove_first: (v, a, _k, env) => {
        needArg(env, 'remove_first', a, 1);
        const s = str(v), f = str(a[0]), i = s.indexOf(f);
        return f === '' || i === -1 ? s : s.slice(0, i) + s.slice(i + f.length);
    },
    remove_last: (v, a, _k, env) => {
        needArg(env, 'remove_last', a, 1);
        const s = str(v), f = str(a[0]), i = s.lastIndexOf(f);
        return f === '' || i === -1 ? s : s.slice(0, i) + s.slice(i + f.length);
    },
    prepend: (v, a, _k, env) => { needArg(env, 'prepend', a, 1); return str(a[0]) + str(v); },
    append: (v, a, _k, env) => { needArg(env, 'append', a, 1); return str(v) + str(a[0]); },
    default: (v, a, kw) => {
        const fallback = a.length ? a[0] : '';
        if (kw.allow_false === true && unwrap(v) === false) return v;
        return isBlankValue(v) ? fallback : v;
    },
    json: (v) => { try { return JSON.stringify(unwrap(v)) ?? 'null'; } catch { return 'null'; } },
    // numbers
    abs: (v) => Math.abs(num(v)),
    ceil: ceilOrFloor(Math.ceil),
    floor: ceilOrFloor(Math.floor),
    round: (v, a) => roundHalfAway(num(v), a.length ? Math.max(0, Math.min(20, Math.floor(num(a[0])))) : 0),
    fixed: (v, a) => num(v).toFixed(a.length ? Math.max(0, Math.min(20, Math.floor(num(a[0])))) : 2),
    at_least: (v, a, _k, env) => { needArg(env, 'at_least', a, 1); return Math.max(num(v), num(a[0])); },
    at_most: (v, a, _k, env) => { needArg(env, 'at_most', a, 1); return Math.min(num(v), num(a[0])); },
    plus: (v, a, _k, env) => { needArg(env, 'plus', a, 1); return num(v) + num(a[0]); },
    minus: (v, a, _k, env) => { needArg(env, 'minus', a, 1); return num(v) - num(a[0]); },
    times: (v, a, _k, env) => { needArg(env, 'times', a, 1); return num(v) * num(a[0]); },
    divided_by: (v, a, _k, env) => {
        needArg(env, 'divided_by', a, 1);
        const d = num(a[0]);
        if (d === 0) env.fail('División entre cero en "divided_by"');
        const r = num(v) / d;
        return isIntLike(v) && isIntLike(a[0]) ? Math.floor(r) : r;
    },
    modulo: (v, a, _k, env) => {
        needArg(env, 'modulo', a, 1);
        const d = num(a[0]);
        if (d === 0) env.fail('División entre cero en "modulo"');
        return ((num(v) % d) + d) % d;
    },
    // dates
    date: (v, a, _k, env) => {
        const p = parseDateInput(v, env);
        if (!p) return v; // como Liquid: valor no fechable se devuelve tal cual
        return formatDate(p, a.length ? str(a[0]) : '%Y-%m-%d %H:%M:%S', env.locale);
    },
    // generic / collections
    size: (v) => {
        v = unwrap(v);
        if (Array.isArray(v)) return v.length;
        if (typeof v === 'string') return [...v].length;
        if (isPlainObject(v)) return Object.keys(v).length;
        return 0;
    },
    first: (v) => { v = unwrap(v); return Array.isArray(v) ? v[0] : typeof v === 'string' ? (v[0] ?? '') : undefined; },
    last: (v) => { v = unwrap(v); return Array.isArray(v) ? v[v.length - 1] : typeof v === 'string' ? (v[v.length - 1] ?? '') : undefined; },
    reverse: (v) => { v = unwrap(v); return typeof v === 'string' ? [...v].reverse().join('') : [...toArr(v)].reverse(); },
    split: (v, a, _k, env) => {
        needArg(env, 'split', a, 1);
        const s = str(v), sep = str(a[0]);
        const parts = sep === '' ? [...s] : s.split(sep);
        while (parts.length && parts[parts.length - 1] === '') parts.pop();
        return parts;
    },
    join: (v, a, _k, env) => toArr(v).map(x => str(x, env)).join(a.length ? str(a[0]) : ' '),
    sort: (v, a) => {
        const arr = [...toArr(v)];
        if (a.length) { const k = str(a[0]); return arr.sort((x, y) => cmpSort(getProp(x, k), getProp(y, k))); }
        return arr.sort(cmpSort);
    },
    sort_natural: (v, a) => {
        const arr = [...toArr(v)];
        const key = (x: unknown) => str(a.length ? getProp(x, str(a[0])) : x).toLowerCase();
        return arr.sort((x, y) => key(x).localeCompare(key(y), undefined, { numeric: true }));
    },
    uniq: (v, a) => {
        const seen = new Set<string>(), out: unknown[] = [];
        for (const x of toArr(v)) {
            const k = JSON.stringify(unwrap(a.length ? getProp(x, str(a[0])) : x)) ?? 'undefined';
            if (!seen.has(k)) { seen.add(k); out.push(x); }
        }
        return out;
    },
    compact: (v, a) => toArr(v).filter(x => { const y = a.length ? getProp(x, str(a[0])) : x; return y !== null && y !== undefined && y !== '' && y !== 'nil' && y !== 'null'; }),
    flatten: (v) => toArr(v).flat(20),
    sum: (v, a) => toArr(v).reduce<number>((acc, x) => acc + num(a.length ? getProp(x, str(a[0])) : x), 0),
    min: (v, a) => {
        const arr = toArr(v); if (!arr.length) return undefined;
        const key = (x: unknown) => num(a.length ? getProp(x, str(a[0])) : x);
        return arr.reduce((m, x) => (key(x) < key(m) ? x : m));
    },
    max: (v, a) => {
        const arr = toArr(v); if (!arr.length) return undefined;
        const key = (x: unknown) => num(a.length ? getProp(x, str(a[0])) : x);
        return arr.reduce((m, x) => (key(x) > key(m) ? x : m));
    },
    concat: (v, a, _k, env) => { needArg(env, 'concat', a, 1); return [...toArr(v), ...toArr(a[0])]; },
    push: (v, a, _k, env) => { needArg(env, 'push', a, 1); return [...toArr(v), a[0]]; },
    map: (v, a, _k, env) => { needArg(env, 'map', a, 1); return toArr(v).map(x => getProp(x, str(a[0]))); },
    where: (v, a, _k, env) => {
        needArg(env, 'where', a, 1);
        const k = str(a[0]);
        return toArr(v).filter(x => { const p = getProp(x, k); return a.length > 1 ? looseEq(p, a[1]) : truthy(p); });
    },
    reject: (v, a, _k, env) => {
        needArg(env, 'reject', a, 1);
        const k = str(a[0]);
        return toArr(v).filter(x => { const p = getProp(x, k); return !(a.length > 1 ? looseEq(p, a[1]) : truthy(p)); });
    },
    slice: (v, a, _k, env) => {
        needArg(env, 'slice', a, 1);
        const start = Math.floor(num(a[0])), len = a.length > 1 ? Math.max(0, Math.floor(num(a[1]))) : 1;
        const x = unwrap(v);
        const seq = Array.isArray(x) ? x : [...str(x)];
        const from = start < 0 ? Math.max(0, seq.length + start) : start;
        const part = seq.slice(from, from + len);
        return Array.isArray(x) ? part : (part as string[]).join('');
    },
};
const FILTERS: Record<string, FilterFn> = Object.assign(Object.create(null) as Record<string, FilterFn>, FILTER_DEFS);

function stripChars(s: string, chars: string, left: boolean, right: boolean): string {
    const set = new Set([...chars]);
    let a = 0, b = s.length;
    if (left) while (a < b && set.has(s[a])) a++;
    if (right) while (b > a && set.has(s[b - 1])) b--;
    return s.slice(a, b);
}

export const LIQUID_FILTER_NAMES: string[] = Object.keys(FILTERS);
export const LIQUID_TAG_NAMES = [
    'if', 'elsif', 'else', 'endif', 'unless', 'endunless', 'for', 'endfor', 'case', 'when', 'endcase',
    'assign', 'capture', 'endcapture', 'comment', 'endcomment', 'raw', 'endraw', 'increment', 'decrement',
    'cycle', 'echo', 'break', 'continue',
];

// ── Tokenizador ───────────────────────────────────────────────────────────────

type Tok =
    | { k: 'raw'; text: string; s: number; e: number; trimL: boolean; trimR: boolean }
    | { k: 'out'; expr: string; s: number; e: number }
    | { k: 'tag'; name: string; args: string; s: number; e: number };

const TAG_RE = /\{\{(-?)([\s\S]*?)(-?)\}\}|\{%(-?)([\s\S]*?)(-?)%\}/g;
const ENDRAW_RE = /\{%-?\s*endraw\s*-?%\}/g;

function tokenize(src: string): Tok[] {
    const toks: Tok[] = [];
    const re = new RegExp(TAG_RE.source, 'g');
    let last = 0;
    let trimNext = false;
    let m: RegExpExecArray | null;

    const pushRaw = (text: string, s: number, e: number) => {
        if (trimNext) { text = text.replace(/^\s+/, ''); trimNext = false; }
        if (text) toks.push({ k: 'raw', text, s, e, trimL: false, trimR: false });
    };
    const checkUnclosed = (text: string, offset: number) => {
        const i = text.search(/\{\{|\{%/);
        if (i !== -1) throw new LiquidError('syntax', `Etiqueta sin cerrar "${text.slice(i, i + 2)}"`, offset + i, offset + i + 2);
    };

    while ((m = re.exec(src)) !== null) {
        const before = src.slice(last, m.index);
        checkUnclosed(before, last);
        const isOut = m[0].startsWith('{{');
        const ltrim = (isOut ? m[1] : m[4]) === '-';
        const rtrim = (isOut ? m[3] : m[6]) === '-';
        const inner = (isOut ? m[2] : m[5]) ?? '';
        pushRaw(ltrim ? before.replace(/\s+$/, '') : before, last, m.index);
        const s = m.index, e = m.index + m[0].length;
        if (isOut) {
            toks.push({ k: 'out', expr: inner.trim(), s, e });
        } else {
            const t = inner.trim();
            if (!t) throw new LiquidError('syntax', 'Tag vacío "{% %}"', s, e);
            const nm = t.match(/^[A-Za-z_]\w*/);
            if (!nm) throw new LiquidError('syntax', `Nombre de tag no válido en "{% ${t.slice(0, 20)} %}"`, s, e);
            const name = nm[0].toLowerCase();
            const args = t.slice(nm[0].length).trim();
            if (name === 'raw') {
                ENDRAW_RE.lastIndex = re.lastIndex;
                const em = ENDRAW_RE.exec(src);
                if (!em) throw new LiquidError('syntax', 'Tag "raw" sin "endraw"', s, e);
                if (rtrim) trimNext = true;
                const body = src.slice(re.lastIndex, em.index);
                const endTag = em[0];
                const endLtrim = /^\{%-/.test(endTag);
                const endRtrim = /-%\}$/.test(endTag);
                let text = rtrim ? body.replace(/^\s+/, '') : body;
                if (endLtrim) text = text.replace(/\s+$/, '');
                trimNext = false;
                if (text) toks.push({ k: 'raw', text, s: re.lastIndex, e: em.index, trimL: false, trimR: false });
                re.lastIndex = em.index + endTag.length;
                last = re.lastIndex;
                trimNext = endRtrim;
                continue;
            }
            toks.push({ k: 'tag', name, args, s, e });
        }
        trimNext = rtrim;
        last = re.lastIndex;
    }
    const tail = src.slice(last);
    checkUnclosed(tail, last);
    pushRaw(tail, last, src.length);
    return toks;
}

// ── Lexer de expresiones ──────────────────────────────────────────────────────

type XTok = { t: 'str' | 'num' | 'word' | 'p'; v: string; s: number; e: number };

const WORD_CH = /[\p{L}\p{N}_]/u;

function lexExpr(src: string, at: { s: number; e: number }): XTok[] {
    const out: XTok[] = [];
    const bad = (msg: string): never => { throw new LiquidError('syntax', msg, at.s, at.e); };
    const prevIsValue = () => {
        const p = out[out.length - 1];
        return !!p && (p.t === 'str' || p.t === 'num' || p.t === 'word' || p.v === ')' || p.v === ']');
    };
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (/\s/.test(c)) { i++; continue; }
        if (c === '"' || c === "'") {
            const j = src.indexOf(c, i + 1);
            if (j === -1) bad('Cadena sin cerrar');
            out.push({ t: 'str', v: src.slice(i + 1, j), s: i, e: j + 1 });
            i = j + 1;
            continue;
        }
        const two = src.slice(i, i + 2);
        if (two === '..' || two === '==' || two === '!=' || two === '<>' || two === '<=' || two === '>=') {
            out.push({ t: 'p', v: two, s: i, e: i + 2 }); i += 2; continue;
        }
        if ('.[](),:|<>='.includes(c)) { out.push({ t: 'p', v: c, s: i, e: i + 1 }); i++; continue; }
        const isNegNum = c === '-' && /\d/.test(src[i + 1] ?? '') && !prevIsValue();
        if (/\d/.test(c) || isNegNum) {
            const nm = /-?\d+(?:\.\d+)?/y;
            nm.lastIndex = i;
            const mm = nm.exec(src)!;
            let end = i + mm[0].length;
            if (WORD_CH.test(src[end] ?? '')) { // p.ej. "2col": es un nombre
                while (end < src.length && (WORD_CH.test(src[end]) || src[end] === '-')) end++;
                out.push({ t: 'word', v: src.slice(i, end), s: i, e: end });
            } else {
                out.push({ t: 'num', v: mm[0], s: i, e: end });
            }
            i = end;
            continue;
        }
        if (WORD_CH.test(c)) {
            let end = i + 1;
            while (end < src.length && (WORD_CH.test(src[end]) || (src[end] === '-' && WORD_CH.test(src[end + 1] ?? '')))) end++;
            if (src[end] === '?') end++;
            out.push({ t: 'word', v: src.slice(i, end), s: i, e: end });
            i = end;
            continue;
        }
        bad(`Carácter inesperado "${c}"`);
    }
    return out;
}

// ── AST y parser de expresiones ───────────────────────────────────────────────

type Expr =
    | { k: 'lit'; v: unknown }
    | { k: 'range'; a: Expr; b: Expr }
    | { k: 'var'; name: string; path: Expr[] };
type FilterCall = { name: string; args: Expr[]; kw: Record<string, Expr> };
type Chain = { e: Expr; filters: FilterCall[] };
type Cmp = { l: Expr; op?: string; r?: Expr };
type Cond = { items: Cmp[]; ops: Array<'and' | 'or'> };
type Pos = { s: number; e: number };

const OP_WORDS = new Set(['and', 'or', 'contains']);
const STOP_WORDS = new Set(['and', 'or', 'contains', 'reversed', 'limit', 'offset']);

class ExprParser {
    private i = 0;
    private depth = 0;
    private toks: XTok[];
    constructor(private src: string, private pos: Pos, private ctx: ParseCtx) {
        this.toks = lexExpr(src, pos);
    }
    private fail(msg: string): never { throw new LiquidError('syntax', msg, this.pos.s, this.pos.e); }
    peek(o = 0): XTok | undefined { return this.toks[this.i + o]; }
    private next(): XTok { const t = this.toks[this.i++]; if (!t) this.fail('Expresión incompleta'); return t; }
    private isP(v: string, o = 0) { const t = this.peek(o); return t?.t === 'p' && t.v === v; }
    done() { return this.i >= this.toks.length; }
    skip(n = 1) { this.i += n; }
    expectEnd() {
        const t = this.peek();
        if (t) this.fail(`Token inesperado "${this.src.slice(t.s, t.e)}"`);
    }
    expectP(v: string) { if (!this.isP(v)) this.fail(`Se esperaba "${v}"`); this.i++; }

    value(): Expr {
        if (this.depth > 16) throw new LiquidError('limit_depth', 'Expresión demasiado anidada', this.pos.s, this.pos.e);
        const t = this.next();
        if (t.t === 'str') return { k: 'lit', v: t.v };
        if (t.t === 'num') return { k: 'lit', v: Number(t.v) };
        if (t.t === 'p' && t.v === '(') {
            const a = this.value();
            this.expectP('..');
            const b = this.value();
            this.expectP(')');
            return { k: 'range', a, b };
        }
        if (t.t === 'word') {
            if (t.v === 'true') return { k: 'lit', v: true };
            if (t.v === 'false') return { k: 'lit', v: false };
            if (t.v === 'nil' || t.v === 'null') return { k: 'lit', v: null };
            if (t.v === 'blank' || t.v === 'empty') return { k: 'lit', v: EMPTY };
            if (STOP_WORDS.has(t.v) && OP_WORDS.has(t.v)) this.fail(`Operador "${t.v}" inesperado`);
            let endTok = t;
            // nombres de columna con espacios: "Nombre completo"
            while (this.peek()?.t === 'word' && !STOP_WORDS.has(this.peek()!.v) && !(this.peek(1)?.t === 'p' && this.peek(1)!.v === ':')) {
                endTok = this.next();
            }
            const name = this.src.slice(t.s, endTok.e).replace(/\s+/g, ' ');
            const path: Expr[] = [];
            for (;;) {
                if (this.isP('.') ) {
                    this.i++;
                    const seg = this.next();
                    if (seg.t !== 'word' && seg.t !== 'num') this.fail('Se esperaba un nombre de propiedad tras "."');
                    path.push({ k: 'lit', v: seg.v });
                } else if (this.isP('[')) {
                    this.i++;
                    this.depth++;
                    const e = this.value();
                    this.depth--;
                    this.expectP(']');
                    path.push(e);
                } else break;
            }
            this.ctx.refs.push({ name, s: this.pos.s, e: this.pos.e });
            return { k: 'var', name, path };
        }
        return this.fail(`Token inesperado "${this.src.slice(t.s, t.e)}"`);
    }

    chain(): Chain {
        const e = this.value();
        const filters: FilterCall[] = [];
        while (this.isP('|')) {
            this.i++;
            const nameTok = this.next();
            if (nameTok.t !== 'word') this.fail('Se esperaba un nombre de filtro tras "|"');
            const name = nameTok.v;
            if (this.ctx.strictFilters && !FILTERS[name]) {
                throw new LiquidError('unknown_filter', `Filtro desconocido "${name}"`, this.pos.s, this.pos.e);
            }
            const args: Expr[] = [];
            const kw: Record<string, Expr> = {};
            if (this.isP(':')) {
                this.i++;
                for (;;) {
                    const a = this.peek(), b = this.peek(1);
                    if (a?.t === 'word' && b?.t === 'p' && b.v === ':') {
                        this.i += 2;
                        kw[a.v] = this.value();
                    } else args.push(this.value());
                    if (this.isP(',')) { this.i++; continue; }
                    break;
                }
            }
            filters.push({ name, args, kw });
        }
        return { e, filters };
    }

    cond(): Cond {
        const items: Cmp[] = [];
        const ops: Array<'and' | 'or'> = [];
        for (;;) {
            const l = this.value();
            const t = this.peek();
            let cmp: Cmp = { l };
            if (t && ((t.t === 'p' && ['==', '!=', '<>', '<', '>', '<=', '>='].includes(t.v)) || (t.t === 'word' && t.v === 'contains'))) {
                this.i++;
                cmp = { l, op: t.v, r: this.value() };
            }
            items.push(cmp);
            const n = this.peek();
            if (n?.t === 'word' && (n.v === 'and' || n.v === 'or')) { this.i++; ops.push(n.v); continue; }
            break;
        }
        return { items, ops };
    }

    /** `a, b` o `a or b` (when). */
    valueList(seps: Array<',' | 'or'>): Expr[] {
        const vs: Expr[] = [this.value()];
        for (;;) {
            const t = this.peek();
            if (t && ((t.t === 'p' && t.v === ',' && seps.includes(',')) || (t.t === 'word' && t.v === 'or' && seps.includes('or')))) {
                this.i++; vs.push(this.value()); continue;
            }
            break;
        }
        return vs;
    }
}

// ── Parser de bloques ─────────────────────────────────────────────────────────

type NodeBase = { pos: Pos };
type Node = NodeBase & (
    | { t: 'raw'; text: string }
    | { t: 'out'; chain: Chain }
    | { t: 'echo'; chain: Chain }
    | { t: 'if'; branches: { cond: Cond; negate: boolean; body: Node[] }[]; elseBody: Node[] }
    | { t: 'for'; varName: string; iter: Expr; limit?: Expr; offset?: Expr; reversed: boolean; body: Node[]; elseBody: Node[] }
    | { t: 'case'; expr: Expr; whens: { vals: Expr[]; body: Node[] }[]; elseBody: Node[] }
    | { t: 'assign'; varName: string; chain: Chain }
    | { t: 'capture'; varName: string; body: Node[] }
    | { t: 'break' }
    | { t: 'continue' }
    | { t: 'increment'; varName: string }
    | { t: 'decrement'; varName: string }
    | { t: 'cycle'; group?: Expr; vals: Expr[] }
);

interface ParseCtx {
    strictFilters: boolean;
    maxDepth: number;
    refs: Array<{ name: string; s: number; e: number }>;
    defined: Set<string>;
}

const STRAY = new Set(['endif', 'endunless', 'endfor', 'endcase', 'endcapture', 'endcomment', 'endraw', 'elsif', 'else', 'when']);
const UNSUPPORTED = new Set(['include', 'render', 'liquid', 'tablerow', 'endtablerow', 'ifchanged', 'endifchanged', 'layout', 'section', 'style', 'javascript', 'form', 'paginate']);

function parseTokens(toks: Tok[], ctx: ParseCtx): Node[] {
    let p = 0;
    let loopDepth = 0;

    const mk = (t: Tok): Pos => ({ s: t.s, e: t.e });
    const err = (code: LiquidErrorCode, msg: string, t: Tok): never => { throw new LiquidError(code, msg, t.s, t.e); };
    const ep = (text: string, t: Tok) => new ExprParser(text, mk(t), ctx);

    function block(terms: string[], opener: Tok | null, depth: number): { nodes: Node[]; term: (Tok & { k: 'tag' }) | null } {
        if (depth > ctx.maxDepth) throw new LiquidError('limit_depth', `Anidamiento excede el máximo (${ctx.maxDepth})`, opener?.s ?? 0, opener?.e ?? 0);
        const nodes: Node[] = [];
        while (p < toks.length) {
            const t = toks[p++];
            if (t.k === 'raw') { nodes.push({ t: 'raw', text: t.text, pos: mk(t) }); continue; }
            if (t.k === 'out') {
                const x = ep(t.expr, t);
                if (x.done()) err('syntax', 'Expresión vacía "{{ }}"', t);
                const chain = x.chain(); x.expectEnd();
                nodes.push({ t: 'out', chain, pos: mk(t) });
                continue;
            }
            if (terms.includes(t.name)) return { nodes, term: t };
            const pos = mk(t);
            switch (t.name) {
                case 'comment': {
                    let nest = 1;
                    while (p < toks.length && nest > 0) {
                        const c = toks[p++];
                        if (c.k === 'tag') { if (c.name === 'comment') nest++; else if (c.name === 'endcomment') nest--; }
                    }
                    if (nest > 0) err('syntax', 'Tag "comment" sin "endcomment"', t);
                    break;
                }
                case 'assign': {
                    const m = t.args.match(/^([\p{L}\p{N}_-]+)\s*=(?!=)\s*([\s\S]+)$/u);
                    if (!m) err('syntax', 'Sintaxis de assign: {% assign nombre = valor %}', t);
                    const x = ep(m![2], t);
                    const chain = x.chain(); x.expectEnd();
                    ctx.defined.add(m![1]);
                    nodes.push({ t: 'assign', varName: m![1], chain, pos });
                    break;
                }
                case 'capture': {
                    const name = t.args.trim();
                    if (!/^[\p{L}\p{N}_-]+$/u.test(name)) err('syntax', 'Sintaxis de capture: {% capture nombre %}', t);
                    ctx.defined.add(name);
                    const b = block(['endcapture'], t, depth + 1);
                    if (!b.term) err('syntax', 'Tag "capture" sin "endcapture"', t);
                    nodes.push({ t: 'capture', varName: name, body: b.nodes, pos });
                    break;
                }
                case 'echo': {
                    const x = ep(t.args, t);
                    if (x.done()) err('syntax', 'echo requiere una expresión', t);
                    const chain = x.chain(); x.expectEnd();
                    nodes.push({ t: 'echo', chain, pos });
                    break;
                }
                case 'increment':
                case 'decrement': {
                    if (!/^[\p{L}\p{N}_-]+$/u.test(t.args.trim())) err('syntax', `Sintaxis de ${t.name}: {% ${t.name} nombre %}`, t);
                    nodes.push({ t: t.name as 'increment' | 'decrement', varName: t.args.trim(), pos });
                    break;
                }
                case 'break':
                case 'continue':
                    if (loopDepth === 0) err('syntax', `"${t.name}" solo se puede usar dentro de un bucle for`, t);
                    nodes.push({ t: t.name as 'break' | 'continue', pos });
                    break;
                case 'cycle': {
                    const x = ep(t.args, t);
                    if (x.done()) err('syntax', 'cycle requiere valores', t);
                    let group: Expr | undefined;
                    let vals = x.valueList([',']);
                    if (x.peek()?.t === 'p' && x.peek()!.v === ':' ) {
                        if (vals.length !== 1) err('syntax', 'Sintaxis de cycle: {% cycle "grupo": a, b %}', t);
                        x.expectP(':');
                        group = vals[0];
                        vals = x.valueList([',']);
                    }
                    x.expectEnd();
                    nodes.push({ t: 'cycle', group, vals, pos });
                    break;
                }
                case 'if':
                case 'unless': {
                    const negate = t.name === 'unless';
                    const endName = negate ? 'endunless' : 'endif';
                    const x0 = ep(t.args, t);
                    if (x0.done()) err('syntax', `${t.name} requiere una condición`, t);
                    const c0 = x0.cond(); x0.expectEnd();
                    const branches: { cond: Cond; negate: boolean; body: Node[] }[] = [];
                    let elseBody: Node[] = [];
                    let b = block(['elsif', 'else', endName], t, depth + 1);
                    branches.push({ cond: c0, negate, body: b.nodes });
                    for (;;) {
                        if (!b.term) err('syntax', `Tag "${t.name}" sin "${endName}"`, t);
                        if (b.term!.name === endName) break;
                        if (b.term!.name === 'elsif') {
                            const xe = ep(b.term!.args, b.term!);
                            if (xe.done()) err('syntax', 'elsif requiere una condición', b.term!);
                            const ce = xe.cond(); xe.expectEnd();
                            b = block(['elsif', 'else', endName], t, depth + 1);
                            branches.push({ cond: ce, negate: false, body: b.nodes });
                        } else { // else
                            const e = block([endName], t, depth + 1);
                            if (!e.term) err('syntax', `Tag "${t.name}" sin "${endName}"`, t);
                            elseBody = e.nodes;
                            break;
                        }
                    }
                    nodes.push({ t: 'if', branches, elseBody, pos });
                    break;
                }
                case 'case': {
                    const x = ep(t.args, t);
                    if (x.done()) err('syntax', 'case requiere una expresión', t);
                    const expr = x.value(); x.expectEnd();
                    const whens: { vals: Expr[]; body: Node[] }[] = [];
                    let elseBody: Node[] = [];
                    let b = block(['when', 'else', 'endcase'], t, depth + 1); // texto previo: se ignora
                    for (;;) {
                        if (!b.term) err('syntax', 'Tag "case" sin "endcase"', t);
                        if (b.term!.name === 'endcase') break;
                        if (b.term!.name === 'when') {
                            const wx = ep(b.term!.args, b.term!);
                            if (wx.done()) err('syntax', 'when requiere un valor', b.term!);
                            const vals = wx.valueList([',', 'or']); wx.expectEnd();
                            b = block(['when', 'else', 'endcase'], t, depth + 1);
                            whens.push({ vals, body: b.nodes });
                        } else {
                            const e = block(['endcase'], t, depth + 1);
                            if (!e.term) err('syntax', 'Tag "case" sin "endcase"', t);
                            elseBody = e.nodes;
                            break;
                        }
                    }
                    nodes.push({ t: 'case', expr, whens, elseBody, pos });
                    break;
                }
                case 'for': {
                    const fm = t.args.match(/^([\p{L}\p{N}_-]+)\s+in\s+([\s\S]+)$/u);
                    if (!fm) err('syntax', 'Sintaxis de for: {% for item in lista %}', t);
                    const x = ep(fm![2], t);
                    const iter = x.value();
                    let limit: Expr | undefined, offset: Expr | undefined, reversed = false;
                    while (!x.done()) {
                        const w = x.peek()!;
                        if (w.t === 'word' && w.v === 'reversed') { x.skip(); reversed = true; continue; }
                        if (w.t === 'word' && (w.v === 'limit' || w.v === 'offset') && x.peek(1)?.v === ':') {
                            x.skip(2);
                            const v = x.value();
                            if (w.v === 'limit') limit = v; else offset = v;
                            continue;
                        }
                        err('syntax', `Parámetro no válido en for: "${w.v}"`, t);
                    }
                    ctx.defined.add(fm![1]);
                    loopDepth++;
                    const b = block(['else', 'endfor'], t, depth + 1);
                    let elseBody: Node[] = [];
                    let closed = b.term?.name === 'endfor';
                    if (b.term?.name === 'else') {
                        const e = block(['endfor'], t, depth + 1);
                        elseBody = e.nodes;
                        closed = !!e.term;
                    }
                    loopDepth--;
                    if (!closed) err('syntax', 'Tag "for" sin "endfor"', t);
                    nodes.push({ t: 'for', varName: fm![1], iter, limit, offset, reversed, body: b.nodes, elseBody, pos });
                    break;
                }
                default:
                    if (STRAY.has(t.name)) err('syntax', `"${t.name}" inesperado (sin bloque abierto)`, t);
                    if (UNSUPPORTED.has(t.name)) err('unknown_tag', `Tag no soportado "${t.name}"`, t);
                    err('unknown_tag', `Tag desconocido "${t.name}"`, t);
            }
        }
        if (terms.length) throw new LiquidError('syntax', `Bloque sin cerrar (falta "${terms[terms.length - 1]}")`, opener?.s ?? 0, opener?.e ?? 0);
        return { nodes, term: null };
    }

    return block([], null, 0).nodes;
}

// ── Evaluador ─────────────────────────────────────────────────────────────────

const SIG_BREAK = 1;
const SIG_CONTINUE = 2;
type Signal = typeof SIG_BREAK | typeof SIG_CONTINUE | undefined;

class Renderer {
    private scopes: Array<Map<string, unknown>>;
    private counters = new Map<string, number>();
    private cycles = new Map<string, number>();
    private cur: string[] = [];
    private total = 0;
    private steps = 0;
    private iterations = 0;
    private pos: Pos = { s: 0, e: 0 };
    private deadline: number;
    private loopStack: Array<Record<string, unknown>> = [];
    readonly env: FilterEnv;
    private opts: Required<Pick<RenderOptions, 'autoescape' | 'strictVariables' | 'maxIterations' | 'maxRangeItems' | 'maxOutputLength'>>;

    constructor(private ast: Node[], private data: LiquidData, o: RenderOptions) {
        const root = new Map<string, unknown>();
        for (const k of Object.keys(data)) if (!FORBIDDEN_KEYS.has(k)) root.set(k, data[k]);
        this.scopes = [root];
        this.opts = {
            autoescape: !!o.autoescape,
            strictVariables: !!o.strictVariables,
            maxIterations: o.maxIterations ?? LIQUID_DEFAULT_LIMITS.maxIterations,
            maxRangeItems: o.maxRangeItems ?? LIQUID_DEFAULT_LIMITS.maxRangeItems,
            maxOutputLength: o.maxOutputLength ?? LIQUID_DEFAULT_LIMITS.maxOutputLength,
        };
        const tz = o.timezone ?? 'UTC';
        if (!isValidTimezone(tz)) throw new LiquidError('runtime', `Zona horaria no válida "${tz}"`);
        this.deadline = Date.now() + (o.timeoutMs ?? LIQUID_DEFAULT_LIMITS.timeoutMs);
        this.env = {
            autoescape: this.opts.autoescape,
            timezone: tz,
            locale: o.locale ?? 'en',
            now: o.now ?? new Date(),
            maxOut: this.opts.maxOutputLength,
            fail: (msg, code = 'runtime') => { throw new LiquidError(code, msg, this.pos.s, this.pos.e); },
        };
    }

    run(): string {
        this.exec(this.ast);
        return this.cur.join('');
    }

    private fail(code: LiquidErrorCode, msg: string): never {
        throw new LiquidError(code, msg, this.pos.s, this.pos.e);
    }

    private write(s: string) {
        if (!s) return;
        this.total += s.length;
        if (this.total > this.opts.maxOutputLength) this.fail('limit_output', `La salida excede el máximo (${this.opts.maxOutputLength} caracteres)`);
        this.cur.push(s);
    }

    private tick() {
        if (++this.steps > LIQUID_DEFAULT_LIMITS.maxSteps) this.fail('limit_iterations', 'Demasiadas operaciones en la plantilla');
        if ((this.steps & 127) === 0 && Date.now() > this.deadline) this.fail('limit_time', 'La plantilla tardó demasiado en renderizarse');
    }

    private lookup(name: string): { has: boolean; v?: unknown } {
        for (let i = this.scopes.length - 1; i >= 0; i--) {
            const sc = this.scopes[i];
            if (sc.has(name)) return { has: true, v: sc.get(name) };
        }
        return { has: false };
    }

    private evalExpr(e: Expr, strict: boolean): unknown {
        switch (e.k) {
            case 'lit': return e.v;
            case 'range': {
                const a = Math.trunc(num(this.evalExpr(e.a, false)));
                const b = Math.trunc(num(this.evalExpr(e.b, false)));
                const n = Math.abs(b - a) + 1;
                if (n > this.opts.maxRangeItems) this.fail('limit_range', `Rango demasiado grande (${n} elementos; máximo ${this.opts.maxRangeItems})`);
                const out: number[] = [];
                if (a <= b) for (let x = a; x <= b; x++) out.push(x); else for (let x = a; x >= b; x--) out.push(x);
                return out;
            }
            case 'var': {
                const f = this.lookup(e.name);
                let cur: unknown;
                if (f.has) cur = f.v;
                else if (e.name === 'now' || e.name === 'today') cur = this.env.now;
                else if (e.name === 'row') cur = this.data;
                else {
                    if (strict) this.fail('undefined_variable', `Variable "${e.name}" no definida`);
                    return undefined;
                }
                for (const seg of e.path) {
                    const key = this.evalExpr(seg, false);
                    cur = getProp(cur, key);
                    if (cur === undefined && strict) this.fail('undefined_variable', `Propiedad "${str(key)}" no definida en "${e.name}"`);
                }
                return cur;
            }
        }
    }

    private evalChain(c: Chain, strict: boolean): unknown {
        const hasDefault = c.filters.some(f => f.name === 'default');
        let v = this.evalExpr(c.e, strict && !hasDefault);
        for (const f of c.filters) {
            const fn = FILTERS[f.name];
            if (!fn) this.fail('unknown_filter', `Filtro desconocido "${f.name}"`);
            const args = f.args.map(a => this.evalExpr(a, false));
            const kw: Record<string, unknown> = {};
            for (const k of Object.keys(f.kw)) kw[k] = this.evalExpr(f.kw[k], false);
            v = fn(v, args, kw, this.env);
            const u = unwrap(v);
            if (typeof u === 'string' && u.length > this.opts.maxOutputLength) this.fail('limit_output', 'Un valor excede el máximo de tamaño');
            if (Array.isArray(u) && u.length > this.opts.maxOutputLength / 4) this.fail('limit_output', 'Una lista excede el máximo de tamaño');
        }
        return v;
    }

    private outStr(v: unknown): string {
        if (v instanceof SafeString) return v.v;
        if (this.opts.autoescape) {
            if (Array.isArray(v)) return v.map(x => this.outStr(x)).join('');
            return escapeHtml(str(v, this.env));
        }
        return str(v, this.env);
    }

    private evalCmp(c: Cmp): boolean {
        const l = this.evalExpr(c.l, false);
        if (!c.op) return truthy(l);
        const r = this.evalExpr(c.r!, false);
        switch (c.op) {
            case '==': return looseEq(l, r);
            case '!=': case '<>': return !looseEq(l, r);
            case 'contains': return containsVal(l, r);
            default: return compareVals(l, r, c.op as '<' | '>' | '<=' | '>=');
        }
    }

    /** Liquid evalua and/or de derecha a izquierda, sin precedencia. */
    private evalCond(c: Cond): boolean {
        let res = this.evalCmp(c.items[c.items.length - 1]);
        for (let i = c.items.length - 2; i >= 0; i--) {
            const left = this.evalCmp(c.items[i]);
            res = c.ops[i] === 'and' ? left && res : left || res;
        }
        return res;
    }

    private setVar(name: string, v: unknown) {
        this.scopes[0].set(name, v);
        const u = unwrap(v);
        if (typeof u === 'string' && u.length > this.opts.maxOutputLength) this.fail('limit_output', 'Un valor excede el máximo de tamaño');
    }

    private exec(ns: Node[]): Signal {
        for (const n of ns) {
            this.pos = n.pos;
            this.tick();
            switch (n.t) {
                case 'raw': this.write(n.text); break;
                case 'out': this.write(this.outStr(this.evalChain(n.chain, this.opts.strictVariables))); break;
                case 'echo': this.write(this.outStr(this.evalChain(n.chain, this.opts.strictVariables))); break;
                case 'assign': this.setVar(n.varName, this.evalChain(n.chain, false)); break;
                case 'capture': {
                    const saved = this.cur;
                    this.cur = [];
                    const sig = this.exec(n.body);
                    const text = this.cur.join('');
                    this.cur = saved;
                    this.pos = n.pos;
                    this.setVar(n.varName, new SafeString(text));
                    if (sig) return sig;
                    break;
                }
                case 'increment': {
                    const v = this.counters.get(n.varName) ?? 0;
                    this.write(String(v));
                    this.counters.set(n.varName, v + 1);
                    break;
                }
                case 'decrement': {
                    const v = (this.counters.get(n.varName) ?? 0) - 1;
                    this.counters.set(n.varName, v);
                    this.write(String(v));
                    break;
                }
                case 'cycle': {
                    const vals = n.vals.map(v => this.evalExpr(v, false));
                    const key = n.group ? `g:${str(this.evalExpr(n.group, false))}` : `v:${vals.map(v => str(v)).join('\u0000')}`;
                    const i = this.cycles.get(key) ?? 0;
                    this.write(this.outStr(vals[i % vals.length]));
                    this.cycles.set(key, i + 1);
                    break;
                }
                case 'break': return SIG_BREAK;
                case 'continue': return SIG_CONTINUE;
                case 'if': {
                    let body = n.elseBody;
                    for (const b of n.branches) {
                        this.pos = n.pos;
                        const ok = this.evalCond(b.cond);
                        if (b.negate ? !ok : ok) { body = b.body; break; }
                    }
                    const sig = this.exec(body);
                    if (sig) return sig;
                    break;
                }
                case 'case': {
                    const cv = this.evalExpr(n.expr, false);
                    let body = n.elseBody;
                    for (const w of n.whens) {
                        if (w.vals.some(v => looseEq(cv, this.evalExpr(v, false)))) { body = w.body; break; }
                    }
                    const sig = this.exec(body);
                    if (sig) return sig;
                    break;
                }
                case 'for': {
                    const sig = this.execFor(n);
                    if (sig) return sig;
                    break;
                }
            }
        }
        return undefined;
    }

    private execFor(n: Extract<Node, { t: 'for' }>): Signal {
        const v = unwrap(this.evalExpr(n.iter, false));
        let items: unknown[];
        if (Array.isArray(v)) items = v;
        else if (typeof v === 'string' && v !== '') items = [v];
        else items = [];
        const offset = n.offset ? Math.max(0, Math.trunc(num(this.evalExpr(n.offset, false)))) : 0;
        let arr = items.slice(offset);
        if (n.limit) arr = arr.slice(0, Math.max(0, Math.trunc(num(this.evalExpr(n.limit, false)))));
        if (n.reversed) arr = [...arr].reverse();
        if (arr.length === 0) return this.exec(n.elseBody) ?? undefined;

        const parent = this.loopStack[this.loopStack.length - 1];
        for (let i = 0; i < arr.length; i++) {
            this.pos = n.pos;
            if (++this.iterations > this.opts.maxIterations) this.fail('limit_iterations', `Se excedió el máximo de iteraciones (${this.opts.maxIterations})`);
            const forloop: Record<string, unknown> = {
                index: i + 1, index0: i, rindex: arr.length - i, rindex0: arr.length - i - 1,
                first: i === 0, last: i === arr.length - 1, length: arr.length,
            };
            if (parent) forloop.parentloop = parent;
            this.loopStack.push(forloop);
            this.scopes.push(new Map<string, unknown>([[n.varName, arr[i]], ['forloop', forloop]]));
            let sig: Signal;
            try { sig = this.exec(n.body); }
            finally { this.scopes.pop(); this.loopStack.pop(); }
            if (sig === SIG_BREAK) break;
        }
        return undefined;
    }
}

// ── API publica ───────────────────────────────────────────────────────────────

export class CompiledTemplate {
    constructor(
        private readonly src: string,
        private readonly ast: Node[],
        /** Variables raiz referenciadas (excluye las definidas con assign/capture/for y las de sistema del motor). */
        readonly variables: Array<{ name: string; from: number; to: number }>,
    ) {}

    render(data: LiquidData = {}, options: RenderOptions = {}): string {
        try {
            return new Renderer(this.ast, data, options).run();
        } catch (e) {
            if (e instanceof LiquidError) throw locate(e, this.src);
            const err = new LiquidError('runtime', e instanceof RangeError ? 'Error de rango en la plantilla' : `Error interno: ${(e as Error)?.message ?? 'desconocido'}`);
            throw err;
        }
    }
}

export function compileTemplate(template: string, options: CompileOptions = {}): CompiledTemplate {
    const src = String(template ?? '');
    const maxLen = options.maxTemplateLength ?? LIQUID_DEFAULT_LIMITS.maxTemplateLength;
    if (src.length > maxLen) throw new LiquidError('limit_template', `La plantilla excede el máximo (${maxLen} caracteres)`);
    const ctx: ParseCtx = {
        strictFilters: options.strictFilters !== false,
        maxDepth: options.maxDepth ?? LIQUID_DEFAULT_LIMITS.maxDepth,
        refs: [],
        defined: new Set(),
    };
    try {
        const ast = parseTokens(tokenize(src), ctx);
        const builtins = new Set(['now', 'today', 'row', 'forloop']);
        const variables = ctx.refs
            .filter(r => !ctx.defined.has(r.name) && !builtins.has(r.name))
            .map(r => ({ name: r.name, from: r.s, to: r.e }));
        return new CompiledTemplate(src, ast, variables);
    } catch (e) {
        if (e instanceof LiquidError) throw locate(e, src);
        throw new LiquidError('syntax', `Error al analizar la plantilla: ${(e as Error)?.message ?? 'desconocido'}`);
    }
}

export type LiquidResult = { ok: true; output: string } | { ok: false; error: LiquidError };

/** Variante que nunca lanza. */
export function renderLiquid(template: string, data: LiquidData = {}, options: RenderOptions & CompileOptions = {}): LiquidResult {
    try {
        return { ok: true, output: compileTemplate(template, options).render(data, options) };
    } catch (e) {
        return { ok: false, error: e instanceof LiquidError ? e : new LiquidError('runtime', (e as Error)?.message ?? 'Error desconocido') };
    }
}

/** Renderiza o lanza `LiquidError`. NUNCA devuelve la plantilla sin renderizar. */
export function renderTemplate(template: string, data: LiquidData = {}, options: RenderOptions & CompileOptions = {}): string {
    return compileTemplate(template, options).render(data, options);
}

export interface LiquidDiagnostic {
    severity: 'error' | 'warning';
    message: string;
    from: number;
    to: number;
    code: LiquidErrorCode | 'unknown_variable';
}

/** Diagnosticos estaticos para el editor: sintaxis, tags/filtros desconocidos y variables no definidas. */
export function validateTemplate(template: string, opts: { knownVariables?: string[] } = {}): LiquidDiagnostic[] {
    try {
        const c = compileTemplate(template);
        if (!opts.knownVariables) return [];
        const known = new Set(opts.knownVariables);
        const seen = new Set<string>();
        const out: LiquidDiagnostic[] = [];
        for (const v of c.variables) {
            const key = `${v.name}@${v.from}`;
            if (known.has(v.name) || seen.has(key)) continue;
            seen.add(key);
            out.push({ severity: 'warning', message: `Variable "${v.name}" no existe en los datos`, from: v.from, to: v.to, code: 'unknown_variable' });
        }
        return out;
    } catch (e) {
        if (e instanceof LiquidError) {
            const end = Math.max(e.end, e.start + 1);
            return [{ severity: 'error', message: e.message, from: e.start, to: Math.min(end, Math.max(template.length, end)), code: e.code }];
        }
        return [{ severity: 'error', message: (e as Error)?.message ?? 'Error', from: 0, to: 1, code: 'syntax' }];
    }
}
