/**
 * Listas de bloqueo / permitidos (puras): validacion, deduplicado, compilacion y coincidencia. La persistencia esta en lists-store.ts.
 *
 * Tipos: email exacto, dominio (opcion subdominios), comodin *@dominio, TLD y regex acotada (regex-safety.ts) evaluada sobre la
 * direccion completa. Una entrada caduca en `expiresAt`. Guardas: no se puede bloquear el propio dominio ni las direcciones de los
 * administradores (se comprueba con el MISMO matcher que se usa en produccion).
 */
import { compileSafeRegex, validateUserRegex } from '../rules/regex-safety';
import { normalizeDomain, sanitizePlainText } from './config-core';
import { domainOf } from './text';

export const MATCH_TYPES = ['email', 'domain', 'wildcard', 'tld', 'regex'] as const;
export type MatchType = (typeof MATCH_TYPES)[number];
export const LIST_KINDS = ['allow', 'block', 'external'] as const;
export type ListKind = (typeof LIST_KINDS)[number];
export const LIST_SCOPES = ['domain', 'user'] as const;
export type ListScope = (typeof LIST_SCOPES)[number];

/** Tope de entradas por lista (ambito + propietario + tipo). */
export const MAX_LIST_ENTRIES = 10_000;
/** La lista de confiables externos viaja al navegador: tope menor. */
export const MAX_EXTERNAL_ENTRIES = 2_000;
export const MAX_REASON = 200;

export interface ListEntryInput {
    matchType: MatchType;
    value: string;
    includeSubdomains?: boolean;
    reason?: string | null;
    expiresAt?: Date | string | null;
}

export interface ListEntry {
    id: string;
    scope: ListScope;
    ownerKey: string;
    kind: ListKind;
    matchType: MatchType;
    value: string;
    includeSubdomains: boolean;
    reason: string | null;
    expiresAt: Date | null;
    createdBy: string | null;
    hits: number;
    lastHitAt: Date | null;
    createdAt: Date;
}

export type Normalized = { ok: true; matchType: MatchType; value: string; includeSubdomains: boolean; reason: string | null; expiresAt: Date | null } | { ok: false; error: string };

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

export function normalizeEntry(input: ListEntryInput, now = new Date()): Normalized {
    const type = input.matchType;
    if (!(MATCH_TYPES as readonly string[]).includes(type)) return { ok: false, error: 'invalid_type' };
    const raw = typeof input.value === 'string' ? input.value.trim() : '';
    if (!raw || raw.length > 300) return { ok: false, error: 'invalid_value' };
    let value = '';
    let sub = input.includeSubdomains === true;
    if (type === 'email') {
        value = raw.toLowerCase();
        if (!EMAIL_RE.test(value)) return { ok: false, error: 'invalid_email' };
        sub = false;
    } else if (type === 'domain') {
        const d = normalizeDomain(raw);
        if (!d) return { ok: false, error: 'invalid_domain' };
        value = d;
        if (raw.trim().startsWith('*.')) sub = true;
    } else if (type === 'wildcard') {
        const m = raw.toLowerCase().match(/^\*@(.+)$/);
        const d = normalizeDomain(m ? m[1] : raw);
        if (!d) return { ok: false, error: 'invalid_wildcard' };
        value = `*@${d}`;
    } else if (type === 'tld') {
        const t = raw.toLowerCase().replace(/^\./, '');
        if (!/^[a-z]{2,24}$/.test(t)) return { ok: false, error: 'invalid_tld' };
        value = t;
        sub = false;
    } else {
        const v = validateUserRegex(raw);
        if (!v.ok) return { ok: false, error: 'unsafe_regex' };
        value = raw;
        sub = false;
    }
    let expiresAt: Date | null = null;
    if (input.expiresAt !== undefined && input.expiresAt !== null && input.expiresAt !== '') {
        const d = input.expiresAt instanceof Date ? input.expiresAt : new Date(String(input.expiresAt));
        if (Number.isNaN(d.getTime())) return { ok: false, error: 'invalid_expiry' };
        if (d.getTime() <= now.getTime()) return { ok: false, error: 'expiry_in_past' };
        if (d.getTime() > now.getTime() + 20 * 365 * 86_400_000) return { ok: false, error: 'invalid_expiry' };
        expiresAt = d;
    }
    const reason = input.reason ? sanitizePlainText(input.reason, MAX_REASON) || null : null;
    return { ok: true, matchType: type, value, includeSubdomains: sub, reason, expiresAt };
}

export function dedupeKey(e: { matchType: string; value: string; includeSubdomains: boolean }): string {
    return `${e.matchType}|${e.value}|${e.includeSubdomains ? 1 : 0}`;
}

// ---------------------------------------------------------------------------
// Compilacion y coincidencia
// ---------------------------------------------------------------------------
export interface Identity { email: string; domain: string }
export const identityOf = (email: string): Identity => {
    const e = String(email ?? '').trim().toLowerCase().replace(/^<|>$/g, '');
    return { email: e, domain: domainOf(e) };
};

type Active = Pick<ListEntry, 'id' | 'matchType' | 'value' | 'includeSubdomains' | 'expiresAt'>;

export class CompiledList {
    private emails = new Map<string, string>();
    private domains = new Map<string, Array<{ id: string; sub: boolean }>>();
    private wildcards = new Map<string, Array<{ id: string; sub: boolean }>>();
    private tlds = new Map<string, string>();
    private regexes: Array<{ id: string; re: RegExp }> = [];
    private expiries = new Map<string, number>();
    size = 0;

    constructor(entries: readonly Active[], now = new Date()) {
        for (const e of entries) {
            if (e.expiresAt && e.expiresAt.getTime() <= now.getTime()) continue;
            this.size++;
            if (e.expiresAt) this.expiries.set(e.id, e.expiresAt.getTime());
            const push = (m: Map<string, Array<{ id: string; sub: boolean }>>, k: string) => (m.get(k) ?? m.set(k, []).get(k)!).push({ id: e.id, sub: e.includeSubdomains });
            switch (e.matchType) {
                case 'email': this.emails.set(e.value, e.id); break;
                case 'domain': push(this.domains, e.value); break;
                case 'wildcard': push(this.wildcards, e.value.replace(/^\*@/, '')); break;
                case 'tld': this.tlds.set(e.value, e.id); break;
                case 'regex': { const re = compileSafeRegex(e.value); if (re) this.regexes.push({ id: e.id, re }); break; }
            }
        }
    }

    /** Id de la primera entrada que coincide con la identidad, o null. `at` permite comprobar la caducidad en el momento de uso. */
    match(who: Identity, at = new Date()): string | null {
        const alive = (id: string | undefined) => (id && (!this.expiries.has(id) || this.expiries.get(id)! > at.getTime()) ? id : null);
        if (!who.email && !who.domain) return null;
        const byEmail = alive(this.emails.get(who.email));
        if (byEmail) return byEmail;
        const labels = who.domain.split('.');
        for (let i = 0; i < labels.length; i++) {
            const suffix = labels.slice(i).join('.');
            for (const m of [this.domains, this.wildcards]) {
                for (const c of m.get(suffix) ?? []) if ((i === 0 || c.sub) && alive(c.id)) return c.id;
            }
        }
        const tld = labels[labels.length - 1];
        const byTld = alive(this.tlds.get(tld));
        if (byTld) return byTld;
        if (who.email) {
            for (const r of this.regexes) if (alive(r.id) && r.re.test(who.email.slice(0, 320))) return r.id;
        }
        return null;
    }
}

// ---------------------------------------------------------------------------
// Guardas de seguridad
// ---------------------------------------------------------------------------
export interface Protected { ownDomains: string[]; adminEmails: string[] }

/** ¿Bloquear esta entrada afectaria al propio dominio o a un administrador? Devuelve el motivo o null. */
export function blockGuard(entry: { matchType: MatchType; value: string; includeSubdomains: boolean }, prot: Protected): string | null {
    const own = prot.ownDomains.map((d) => d.toLowerCase()).filter(Boolean);
    const probe = new CompiledList([{ id: 'x', matchType: entry.matchType, value: entry.value, includeSubdomains: entry.includeSubdomains, expiresAt: null }]);
    for (const d of own) {
        if (probe.match(identityOf(`postmaster@${d}`)) || probe.match(identityOf(`user@sub.${d}`))) return 'protected_own_domain';
        // Cualquier direccion del propio dominio es un buzon interno (no solo postmaster)
        if (entry.matchType === 'email' && (entry.value.endsWith(`@${d}`) || entry.value.endsWith(`.${d}`))) return 'protected_own_domain';
        if (entry.matchType === 'domain' || entry.matchType === 'wildcard') {
            const v = entry.value.replace(/^\*@/, '');
            if (v === d || d.endsWith(`.${v}`) && entry.includeSubdomains || v.endsWith(`.${d}`)) return 'protected_own_domain';
        }
    }
    for (const a of prot.adminEmails) {
        if (probe.match(identityOf(a))) return 'protected_admin';
    }
    return null;
}
