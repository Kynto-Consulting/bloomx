import crypto from 'node:crypto';
import { b64urlDecode, b64urlEncode, signCanonical, verifyCanonical } from '@/lib/bloomx-signature';
import { loadDomainPrivateKey, ownDomains } from '@/lib/backend-auth';

/**
 * CONCESIONES DE EJECUCION (`executionGrant`, capacidad ext.grants.v1).
 *
 * Modelo: el backend compartido NO tiene ni usa ninguna clave propia. Cuando ESTA instancia le pide ejecutar una extension, incluye una concesion
 * firmada Ed25519 con SU PROPIA clave de dominio (la misma que firma sus peticiones). El backend la reenvia tal cual a /api/internal/host/*
 * cuando el sandbox necesita un servicio del host; aqui se verifica con la clave publica DERIVADA de la privada (sin red, sin clave del backend).
 *
 * La concesion fija: dominio (iss = aud = esta instancia), extension + version, usuario (sub, null en rutas publicas), permisos de esta ejecucion
 * (lista cerrada), jti, iat/exp (120 s por defecto), nonce y tope de usos. Una extension no puede ampliar permisos ni cambiar de usuario/dominio:
 * romperia la firma. El sandbox nunca la ve (la guarda el runtime del backend).
 *
 * Token: `bxg1.<payload b64url>.<firma b64url>`; se firma `BLOOMX-GRANT-V1\n<payload b64url>`.
 */

export const GRANT_PREFIX = 'bxg1';
export const GRANT_HEADER = 'x-bloomx-grant';
const DOMAIN_TAG = 'BLOOMX-GRANT-V1';
const PERM_RE = /^[A-Z][A-Z0-9_]{1,40}(?::[A-Za-z0-9._*/-]{1,64}){0,2}$/;
const MAX_PERMS = 64;
const MAX_TOKEN_CHARS = 8192;

type Env = Record<string, string | undefined>;

export interface GrantClaims {
    v: 1;
    iss: string;
    aud: string;
    ext: string;
    ver: string;
    sub: string | null;
    perms: string[];
    jti: string;
    iat: number;
    exp: number;
    nonce: string;
    max: number;
}

export function grantTtlSeconds(env: Env = process.env): number {
    const n = Number(env.BLOOMX_GRANT_TTL_SECONDS);
    return Number.isFinite(n) && n >= 30 && n <= 900 ? Math.floor(n) : 120;
}
export function grantMaxUses(env: Env = process.env): number {
    const n = Number(env.BLOOMX_GRANT_MAX_USES);
    return Number.isFinite(n) && n >= 1 && n <= 5000 ? Math.floor(n) : 300;
}

export interface IssueInput {
    domain: string;
    extensionId: string;
    version: string;
    userId: string | null;
    permissions: unknown;
}

/** Emite una concesion para UNA ejecucion. null si la instancia no tiene clave de dominio (modo legado). */
export function issueExecutionGrant(input: IssueInput, env: Env = process.env, nowMs: number = Date.now()): string | null {
    const key = loadDomainPrivateKey(env);
    if (!key) return null;
    const domain = input.domain.split(':')[0].toLowerCase();
    if (!domain) return null;
    const perms = (Array.isArray(input.permissions) ? input.permissions : [])
        .filter((p): p is string => typeof p === 'string' && PERM_RE.test(p))
        .slice(0, MAX_PERMS);
    const iat = Math.floor(nowMs / 1000);
    const claims: GrantClaims = {
        v: 1, iss: domain, aud: domain, ext: input.extensionId, ver: input.version, sub: input.userId,
        perms: Array.from(new Set(perms)).sort(), jti: b64urlEncode(crypto.randomBytes(16)), iat, exp: iat + grantTtlSeconds(env),
        nonce: b64urlEncode(crypto.randomBytes(12)), max: grantMaxUses(env),
    };
    const payload = b64urlEncode(Buffer.from(JSON.stringify(claims), 'utf8'));
    return `${GRANT_PREFIX}.${payload}.${signCanonical(key, `${DOMAIN_TAG}\n${payload}`)}`;
}

export type GrantFailure = 'malformed' | 'bad_signature' | 'expired' | 'wrong_audience' | 'no_key';

function parseClaims(payload: string): GrantClaims | null {
    try {
        const c = JSON.parse(b64urlDecode(payload).toString('utf8'));
        if (!c || typeof c !== 'object' || c.v !== 1) return null;
        const str = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
        if (!str(c.iss, 253) || !str(c.aud, 253) || !str(c.ext, 128) || !str(c.ver, 40) || !str(c.jti, 64) || !str(c.nonce, 64)) return null;
        if (c.sub !== null && !str(c.sub, 64)) return null;
        if (!Array.isArray(c.perms) || c.perms.length > MAX_PERMS || c.perms.some((p: unknown) => typeof p !== 'string' || !PERM_RE.test(p))) return null;
        if (!Number.isInteger(c.iat) || !Number.isInteger(c.exp) || !Number.isInteger(c.max) || c.max < 1 || c.exp <= c.iat || c.exp - c.iat > 900) return null;
        return c as GrantClaims;
    } catch {
        return null;
    }
}

/** Verifica firma (con la clave publica derivada de la privada de ESTA instancia), caducidad y audiencia. Sin red. */
export function verifyExecutionGrant(token: string | null | undefined, env: Env = process.env, nowMs: number = Date.now()): { ok: true; claims: GrantClaims } | { ok: false; reason: GrantFailure } {
    if (!token || token.length > MAX_TOKEN_CHARS) return { ok: false, reason: 'malformed' };
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== GRANT_PREFIX) return { ok: false, reason: 'malformed' };
    const claims = parseClaims(parts[1]);
    if (!claims) return { ok: false, reason: 'malformed' };
    const priv = loadDomainPrivateKey(env);
    if (!priv) return { ok: false, reason: 'no_key' };
    if (!verifyCanonical(crypto.createPublicKey(priv), `${DOMAIN_TAG}\n${parts[1]}`, parts[2])) return { ok: false, reason: 'bad_signature' };
    if (Math.floor(nowMs / 1000) >= claims.exp) return { ok: false, reason: 'expired' };
    const own = ownDomains(env);
    if (claims.iss !== claims.aud || (own.length > 0 && !own.includes(claims.aud))) return { ok: false, reason: 'wrong_audience' };
    return { ok: true, claims };
}

// ---------------------------------------------------------------------------------------------------------------
// Usos acotados por jti (la MISMA ejecucion usa N llamadas hasta `max` o `exp`)
// ---------------------------------------------------------------------------------------------------------------
const uses = new Map<string, { n: number; exp: number }>();
const MAX_TRACKED = 50_000;

export function consumeGrantUse(claims: GrantClaims, nowMs: number = Date.now()): boolean {
    const now = Math.floor(nowMs / 1000);
    if (uses.size > MAX_TRACKED) for (const [k, v] of uses) if (v.exp <= now) uses.delete(k);
    if (uses.size > MAX_TRACKED) return false; // saturado: falla cerrado
    const cur = uses.get(claims.jti) ?? { n: 0, exp: claims.exp };
    if (cur.n >= claims.max) return false;
    cur.n += 1;
    uses.set(claims.jti, cur);
    return true;
}
export function __resetGrantUses(): void { uses.clear(); }

// ---------------------------------------------------------------------------------------------------------------
// Que servicios cubre la concesion (derivado de los permisos del manifest; lista cerrada)
// ---------------------------------------------------------------------------------------------------------------
export const GRANT_SERVICES = ['calendar', 'contacts', 'storage', 'notify', 'formats', 'ai', 'mail', 'oauth'] as const;
export type GrantService = (typeof GRANT_SERVICES)[number];

export function grantAllowsService(claims: Pick<GrantClaims, 'perms'>, service: string): boolean {
    const p = claims.perms;
    const has = (pred: (x: string) => boolean) => p.some(pred);
    switch (service) {
        case 'calendar': return has((x) => x.startsWith('CALENDAR_'));
        case 'contacts': return has((x) => x.startsWith('CONTACTS_'));
        case 'storage': return p.includes('STORAGE');
        case 'notify': return p.includes('NOTIFY');
        case 'formats': return p.includes('FORMATS');
        case 'ai': return p.includes('AI') || p.includes('AI_GENERATE');
        case 'mail': return p.includes('READ_EMAIL') || p.includes('MAIL_LABEL');
        case 'oauth': return has((x) => x.startsWith('OAUTH_ACCOUNT:') || x.startsWith('OAUTH_SHARED:'));
        default: return false;
    }
}

/** Grupos de scopes y acceso compartido que la concesion otorga para un proveedor (lo deriva la INSTANCIA; el cuerpo del backend se ignora). */
export function oauthGrantFor(claims: Pick<GrantClaims, 'perms'>, provider: string): { groups: string[]; shared: boolean } {
    const groups: string[] = [];
    for (const x of claims.perms) {
        const m = /^OAUTH_ACCOUNT:([a-z][a-z0-9-]{1,31}):([a-z][a-z0-9-]{0,31})$/.exec(x);
        if (m && m[1] === provider && !groups.includes(m[2])) groups.push(m[2]);
    }
    return { groups, shared: claims.perms.includes(`OAUTH_SHARED:${provider}`) };
}
