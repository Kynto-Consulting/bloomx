import { Resolver } from 'node:dns/promises';

/**
 * Salud DNS de SOLO LECTURA (SPF, DKIM, DMARC, MX) del dominio activo de la instancia.
 * - Logica pura (parseadores) + resolvedor inyectable: se prueba sin red.
 * - Cada consulta tiene su propio tiempo limite (Promise.race); ningun fallo DNS lanza: se traduce a status 'error'.
 * - Los `notes` son CODIGOS estables (la UI los traduce). Sin secretos: solo registros DNS publicos, recortados a 500.
 */

export type DnsStatus = 'ok' | 'warn' | 'missing' | 'error';

export interface DnsCheck {
    status: DnsStatus;
    /** Texto DNS encontrado (recortado a 500 caracteres) o null. */
    record: string | null;
    notes: string[];
}

export interface SpfCheck extends DnsCheck { includes: number; lookups: number }
export interface DkimCheck extends DnsCheck { selector: string | null; selectorsTried: string[] }
export interface DmarcCheck extends DnsCheck { policy: string | null }
export interface MxCheck extends DnsCheck { hosts: { priority: number; exchange: string }[] }

export interface DnsHealth {
    configured: boolean;
    domain: string | null;
    checkedAt: string;
    spf: SpfCheck | null;
    dkim: DkimCheck | null;
    dmarc: DmarcCheck | null;
    mx: MxCheck | null;
}

export interface DnsResolver {
    resolveTxt(name: string): Promise<string[][]>;
    resolveMx(name: string): Promise<{ exchange: string; priority: number }[]>;
}

export const DKIM_SELECTOR_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const DEFAULT_DKIM_SELECTORS = ['resend', 'default', 'google', 'selector1', 'k1'] as const;
export const DNS_TIMEOUT_MS = 3000;
const MAX_RECORD = 500;

const clip = (s: string) => (s.length > MAX_RECORD ? s.slice(0, MAX_RECORD) : s);

// ---------------------------------------------------------------------------------------------------------------------
// Consulta con tiempo limite
// ---------------------------------------------------------------------------------------------------------------------
export class DnsTimeoutError extends Error {
    code = 'ETIMEOUT';
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DnsTimeoutError('timeout')), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

type Lookup<T> = { kind: 'ok'; value: T } | { kind: 'missing' } | { kind: 'error' };

const MISSING_CODES = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN', 'NODATA']);

async function lookup<T>(fn: () => Promise<T>, timeoutMs: number): Promise<Lookup<T>> {
    try {
        return { kind: 'ok', value: await withTimeout(fn(), timeoutMs) };
    } catch (error) {
        const code = String((error as { code?: unknown } | null)?.code ?? '');
        return MISSING_CODES.has(code) ? { kind: 'missing' } : { kind: 'error' };
    }
}

const joinTxt = (records: string[][]) => records.map((chunks) => chunks.join(''));

// ---------------------------------------------------------------------------------------------------------------------
// Parseadores puros
// ---------------------------------------------------------------------------------------------------------------------
const SPF_PROVIDERS = /(^|[:.])(amazonses\.com|resend\.com|resend\.dev)$/i;

export function parseSpf(txt: string[]): SpfCheck {
    const spf = txt.map((t) => t.trim()).filter((t) => /^v=spf1(\s|$)/i.test(t));
    if (spf.length === 0) return { status: 'missing', record: null, notes: ['spf_missing'], includes: 0, lookups: 0 };
    const record = spf[0];
    const notes: string[] = [];
    let warn = false;
    const flag = (code: string, isWarn = true) => { notes.push(code); if (isWarn) warn = true; };

    if (spf.length > 1) flag('spf_multiple');

    const terms = record.split(/\s+/).slice(1);
    let includes = 0;
    let lookups = 0;
    let hasSender = false;
    let all: string | null = null;
    let redirect = false;
    for (const raw of terms) {
        const term = raw.toLowerCase();
        const m = /^([+\-~?]?)(all|include|a|mx|ptr|exists)(?=[:/]|$)/.exec(term);
        if (term.startsWith('redirect=')) { redirect = true; lookups++; continue; }
        if (!m) continue;
        const [, qual, mech] = m;
        if (mech === 'all') { all = qual || '+'; continue; }
        lookups++;
        if (mech === 'include') {
            includes++;
            if (SPF_PROVIDERS.test(term.slice(term.indexOf(':') + 1))) hasSender = true;
        }
        if (mech === 'ptr') flag('spf_ptr');
    }

    if (lookups > 10) flag('spf_too_many_lookups');
    if (all === '-') flag('spf_hardfail', false);
    else if (all === '~') flag('spf_softfail', false);
    else if (all === '?') flag('spf_neutral');
    else if (all === '+') flag('spf_allow_all');
    else if (!redirect) flag('spf_no_all');
    if (hasSender) flag('spf_sender_include', false);
    else if (!redirect) flag('spf_no_sender_include');

    return { status: warn ? 'warn' : 'ok', record: clip(record), notes, includes, lookups };
}

export function parseDkim(txt: string[], selector: string | null, tried: string[]): DkimCheck {
    const candidates = txt.map((t) => t.trim()).filter(Boolean);
    const rec = candidates.find((t) => /(^|;)\s*p\s*=/i.test(t)) ?? candidates[0];
    if (!rec) return { status: 'missing', record: null, notes: ['dkim_not_found'], selector, selectorsTried: tried };
    const tags = new Map<string, string>();
    for (const part of rec.split(';')) {
        const i = part.indexOf('=');
        if (i > 0) tags.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim());
    }
    const notes: string[] = [];
    let warn = false;
    const p = tags.get('p');
    if (p === undefined) { notes.push('dkim_no_public_key'); warn = true; }
    else if (p === '') { notes.push('dkim_revoked'); warn = true; }
    else notes.push('dkim_key_present');
    if ((tags.get('t') || '').split(':').includes('y')) { notes.push('dkim_testing_mode'); warn = true; }
    return { status: warn ? 'warn' : 'ok', record: clip(rec), notes, selector, selectorsTried: tried };
}

export function parseDmarc(txt: string[]): DmarcCheck {
    const recs = txt.map((t) => t.trim()).filter((t) => /^v=DMARC1\s*(;|$)/i.test(t));
    if (recs.length === 0) return { status: 'missing', record: null, notes: ['dmarc_missing'], policy: null };
    const rec = recs[0];
    const tags = new Map<string, string>();
    for (const part of rec.split(';')) {
        const i = part.indexOf('=');
        if (i > 0) tags.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim());
    }
    const notes: string[] = [];
    let warn = false;
    if (recs.length > 1) { notes.push('dmarc_multiple'); warn = true; }
    const policy = (tags.get('p') || '').toLowerCase() || null;
    if (policy === 'reject') notes.push('dmarc_policy_reject');
    else if (policy === 'quarantine') notes.push('dmarc_policy_quarantine');
    else if (policy === 'none') { notes.push('dmarc_policy_none'); warn = true; }
    else { notes.push('dmarc_invalid_policy'); warn = true; }
    if (!tags.get('rua')) notes.push('dmarc_no_rua');
    const pct = tags.has('pct') ? Number.parseInt(tags.get('pct') || '', 10) : 100;
    if (Number.isFinite(pct) && pct < 100) { notes.push('dmarc_pct_partial'); warn = true; }
    return { status: warn ? 'warn' : 'ok', record: clip(rec), notes, policy };
}

export function parseMx(mx: { exchange: string; priority: number }[]): MxCheck {
    const hosts = [...mx].sort((a, b) => a.priority - b.priority).map((h) => ({ priority: h.priority, exchange: h.exchange }));
    if (hosts.length === 0) return { status: 'missing', record: null, notes: ['mx_missing'], hosts };
    const record = clip(hosts.map((h) => `${h.priority} ${h.exchange}`).join('\n'));
    if (hosts.every((h) => h.exchange === '' || h.exchange === '.')) return { status: 'warn', record, notes: ['mx_null'], hosts };
    if (hosts.length === 1) return { status: 'ok', record, notes: ['mx_single'], hosts };
    return { status: 'ok', record, notes: ['mx_redundant'], hosts };
}

// ---------------------------------------------------------------------------------------------------------------------
// Orquestacion
// ---------------------------------------------------------------------------------------------------------------------
const errorCheck = (code: string): DnsCheck => ({ status: 'error', record: null, notes: [code] });

export interface CheckOptions {
    resolver: DnsResolver;
    /** Selector DKIM ya validado; si falta se prueban los habituales. */
    selector?: string | null;
    timeoutMs?: number;
    now?: Date;
}

/** Nunca lanza: los fallos DNS quedan como status 'error' (o 'missing' si el registro no existe). */
export async function checkDomainDns(domain: string, opts: CheckOptions): Promise<DnsHealth> {
    const { resolver } = opts;
    const timeoutMs = opts.timeoutMs ?? DNS_TIMEOUT_MS;
    const selectors = opts.selector ? [opts.selector] : [...DEFAULT_DKIM_SELECTORS];

    const [spfRes, dmarcRes, mxRes, dkimRes] = await Promise.all([
        lookup(() => resolver.resolveTxt(domain), timeoutMs),
        lookup(() => resolver.resolveTxt(`_dmarc.${domain}`), timeoutMs),
        lookup(() => resolver.resolveMx(domain), timeoutMs),
        Promise.all(selectors.map(async (s) => ({ s, res: await lookup(() => resolver.resolveTxt(`${s}._domainkey.${domain}`), timeoutMs) }))),
    ]);

    const spf: SpfCheck = spfRes.kind === 'ok'
        ? parseSpf(joinTxt(spfRes.value))
        : spfRes.kind === 'missing'
            ? parseSpf([])
            : { ...errorCheck('dns_error'), includes: 0, lookups: 0 };

    const dmarc: DmarcCheck = dmarcRes.kind === 'ok'
        ? parseDmarc(joinTxt(dmarcRes.value))
        : dmarcRes.kind === 'missing'
            ? parseDmarc([])
            : { ...errorCheck('dns_error'), policy: null };

    const mx: MxCheck = mxRes.kind === 'ok'
        ? parseMx(mxRes.value)
        : mxRes.kind === 'missing'
            ? parseMx([])
            : { ...errorCheck('dns_error'), hosts: [] };

    let dkim: DkimCheck;
    const found = dkimRes.find((r) => r.res.kind === 'ok' && joinTxt(r.res.value).some((t) => /(^|;)\s*p\s*=/i.test(t)))
        ?? dkimRes.find((r) => r.res.kind === 'ok' && r.res.value.length > 0);
    if (found && found.res.kind === 'ok') {
        dkim = parseDkim(joinTxt(found.res.value), found.s, selectors);
    } else if (dkimRes.some((r) => r.res.kind === 'error')) {
        dkim = { ...errorCheck('dns_error'), selector: null, selectorsTried: selectors };
    } else {
        dkim = parseDkim([], null, selectors);
    }

    return { configured: true, domain, checkedAt: (opts.now ?? new Date()).toISOString(), spf, dkim, dmarc, mx };
}

/** Resolvedor real (servidores del sistema) con tiempo limite propio por consulta. */
export function systemResolver(timeoutMs = DNS_TIMEOUT_MS): DnsResolver {
    const r = new Resolver({ timeout: timeoutMs, tries: 1 });
    return {
        resolveTxt: (name) => r.resolveTxt(name),
        resolveMx: (name) => r.resolveMx(name),
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Cache en memoria (60 s)
// ---------------------------------------------------------------------------------------------------------------------
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 50;
const cache = new Map<string, { at: number; value: DnsHealth }>();

export function clearDnsCache(): void {
    cache.clear();
}

export async function getDnsHealth(
    domain: string,
    opts: { selector?: string | null; fresh?: boolean; resolver?: DnsResolver; nowMs?: number } = {},
): Promise<DnsHealth> {
    const now = opts.nowMs ?? Date.now();
    const key = `${domain}|${opts.selector ?? ''}`;
    const hit = cache.get(key);
    if (!opts.fresh && hit && now - hit.at < CACHE_TTL_MS) return hit.value;
    const value = await checkDomainDns(domain, { resolver: opts.resolver ?? systemResolver(), selector: opts.selector, now: new Date(now) });
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: now, value });
    return value;
}

/** Nombre de dominio publico plausible (con punto, sin IP ni puerto). */
export function isPlausibleDomain(domain: string | undefined | null): domain is string {
    if (!domain || domain.length > 253) return false;
    if (/^\d+(\.\d+){3}$/.test(domain)) return false;
    return /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain);
}
