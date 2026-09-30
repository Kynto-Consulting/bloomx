/** Lectura tolerante de cabeceras para el motor de spam (puro). */
import { domainOf, parseAddress } from './text';

export type HeaderBag = Record<string, string[]>;

/** Cabeceras en minusculas; cada una como lista (Received y Authentication-Results pueden repetirse). Valores acotados. */
export function bagOf(headers: Record<string, unknown> | null | undefined): HeaderBag {
    const out: HeaderBag = {};
    for (const [k, v] of Object.entries(headers ?? {})) {
        const key = String(k).trim().toLowerCase();
        if (!key) continue;
        const list = (Array.isArray(v) ? v : [v]).map((x) => (x === null || x === undefined ? '' : String(x)).trim().slice(0, 2000)).filter(Boolean).slice(0, 60);
        if (list.length) out[key] = [...(out[key] ?? []), ...list];
    }
    return out;
}

export const first = (bag: HeaderBag, name: string): string => bag[name]?.[0] ?? '';

export type Verdict = 'pass' | 'fail' | 'softfail' | 'neutral' | 'none' | 'temperror' | 'permerror' | 'policy' | 'unknown';

export interface AuthSummary {
    present: boolean;
    spf: Verdict;
    dkim: Verdict;
    dmarc: Verdict;
    arc: Verdict;
    /** Dominios firmantes DKIM (d=) de firmas que pasaron o que constan en la cabecera. */
    dkimDomains: string[];
    /** Dominio del sobre segun SPF (smtp.mailfrom). */
    spfDomain: string;
    /** Dominio del From segun DMARC (header.from), si consta. */
    headerFrom: string;
}

const KNOWN: Verdict[] = ['pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror', 'policy'];

function verdict(text: string, method: string): Verdict {
    const m = text.match(new RegExp(`(?:^|[;\\s(])${method}\\s*=\\s*([a-z]+)`, 'i'));
    const v = (m?.[1] ?? '').toLowerCase() as Verdict;
    return KNOWN.includes(v) ? v : 'unknown';
}

/** Lee Authentication-Results (primera, la de NUESTRO receptor), Received-SPF y las firmas DKIM-Signature. */
export function authOf(bag: HeaderBag): AuthSummary {
    const ar = bag['authentication-results'] ?? [];
    const primary = ar[0] ?? '';
    let spf = verdict(primary, 'spf');
    const dkim = verdict(primary, 'dkim');
    const dmarc = verdict(primary, 'dmarc');
    const arc = verdict(primary, 'arc');
    if (spf === 'unknown' && bag['received-spf']?.[0]) {
        const m = bag['received-spf'][0].match(/^\s*([a-z]+)/i);
        const v = (m?.[1] ?? '').toLowerCase() as Verdict;
        if (KNOWN.includes(v)) spf = v;
    }
    const dkimDomains = new Set<string>();
    for (const m of primary.matchAll(/header\.d=([a-z0-9.-]+)/gi)) dkimDomains.add(m[1].toLowerCase());
    for (const sig of bag['dkim-signature'] ?? []) {
        const d = sig.match(/(?:^|[;\s])d=([a-z0-9.-]+)/i);
        if (d) dkimDomains.add(d[1].toLowerCase());
    }
    const mf = primary.match(/smtp\.mailfrom=(?:[^@\s;]*@)?([a-z0-9.-]+)/i);
    const hf = primary.match(/header\.from=([a-z0-9.-]+)/i);
    return {
        present: ar.length > 0 || !!bag['received-spf'] || !!bag['dkim-signature'],
        spf, dkim, dmarc, arc,
        dkimDomains: [...dkimDomains],
        spfDomain: (mf?.[1] ?? '').toLowerCase(),
        headerFrom: (hf?.[1] ?? '').toLowerCase(),
    };
}

/** Dominio del remitente del sobre: parametro > Return-Path > X-Envelope-From > smtp.mailfrom. */
export function envelopeDomain(bag: HeaderBag, given: string | null | undefined, auth: AuthSummary): string {
    for (const c of [given, first(bag, 'return-path'), first(bag, 'x-envelope-from'), first(bag, 'envelope-from')]) {
        if (!c) continue;
        const a = parseAddress(String(c).replace(/^<|>$/g, ''));
        const d = domainOf(a.email || String(c).replace(/[<>\s]/g, ''));
        if (d.includes('.')) return d;
    }
    return auth.spfDomain;
}

export function messageIdDomain(bag: HeaderBag): string {
    const v = first(bag, 'message-id');
    const m = v.match(/@([a-z0-9.\-_[\]:]+)>?/i);
    return m ? m[1].toLowerCase().replace(/^\[|\]$/g, '') : '';
}

export function parseAddressList(value: string): string[] {
    const out: string[] = [];
    for (const part of value.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
        const a = parseAddress(part);
        if (a.email) out.push(a.email);
    }
    return out;
}
