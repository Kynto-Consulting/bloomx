/**
 * auth.ts - re-autenticacion reciente y enlaces de descarga firmados de importar/exportar correo.
 *
 * Re-autenticacion: prueba HMAC de corta vida en una cookie httpOnly (SameSite=Strict, ambito /api). Se emite tras reingresar la
 * contrasena o un codigo MFA y se ATA al administrador (clave del actor) y, si hay, al id de sesion. Tambien vale una sesion
 * cuyo segundo factor se verifico hace menos de REAUTH_TTL_MS (claim `mfa` + `at` del JWT).
 *
 * Enlaces de descarga: HMAC-SHA256 sobre (trabajo, actor, caducidad); vida corta (10 min). La ruta ademas exige la sesion del
 * mismo actor, asi que un enlace filtrado no sirve a otra persona.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const REAUTH_COOKIE = 'bx_mt_reauth';
export const REAUTH_TTL_MS = 10 * 60_000;
export const DOWNLOAD_LINK_TTL_S = 10 * 60;

function secret(purpose: string): Buffer {
    const explicit = process.env.ASSET_SIGNING_KEY;
    const base = explicit || process.env.NEXTAUTH_SECRET;
    if (!base) {
        if (process.env.NODE_ENV === 'production') throw new Error('ASSET_SIGNING_KEY (or NEXTAUTH_SECRET) is required in production');
        return createHmac('sha256', 'dev-mail-transfer-secret').update(purpose).digest();
    }
    return createHmac('sha256', base).update(`bloomx:mail-transfer:${purpose}:v1`).digest();
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const hashKey = (actorKey: string) => createHash('sha256').update(actorKey).digest('base64url').slice(0, 22);

function safeEq(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
}

export type ReauthMethod = 'password' | 'mfa';

export function issueReauthToken(actorKey: string, method: ReauthMethod, sid: string | null, now = Date.now()): { token: string; expiresAt: number } {
    const exp = now + REAUTH_TTL_MS;
    const body = b64(JSON.stringify({ k: hashKey(actorKey), s: sid ? hashKey(sid) : null, m: method, exp }));
    const sig = createHmac('sha256', secret('reauth')).update(body).digest('base64url');
    return { token: `${body}.${sig}`, expiresAt: exp };
}

export function verifyReauthToken(token: string | undefined | null, actorKey: string, sid: string | null, now = Date.now()): { ok: boolean; method?: ReauthMethod; expiresAt?: number } {
    if (!token || token.length > 600) return { ok: false };
    const [body, sig] = token.split('.');
    if (!body || !sig) return { ok: false };
    const expected = createHmac('sha256', secret('reauth')).update(body).digest('base64url');
    if (!safeEq(sig, expected)) return { ok: false };
    try {
        const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (typeof p.exp !== 'number' || p.exp < now) return { ok: false };
        if (p.k !== hashKey(actorKey)) return { ok: false };
        if (p.s && (!sid || p.s !== hashKey(sid))) return { ok: false };
        return { ok: true, method: p.m, expiresAt: p.exp };
    } catch {
        return { ok: false };
    }
}

/** Sesion con segundo factor verificado hace menos de 10 minutos (claims del JWT de sesion). */
export function sessionMfaRecent(session: { mfa?: unknown; at?: unknown; iat?: unknown } | null | undefined, now = Date.now()): boolean {
    if (!session || session.mfa !== true) return false;
    const at = typeof session.at === 'number' ? session.at : typeof session.iat === 'number' ? session.iat : 0;
    return at > 0 && now - at * 1000 < REAUTH_TTL_MS;
}

export function signDownload(jobId: string, actorKey: string, exp: number): string {
    return createHmac('sha256', secret('download')).update(`mt-dl:v1\n${jobId}\n${hashKey(actorKey)}\n${exp}`).digest('base64url');
}

export function verifyDownload(jobId: string, actorKey: string, expRaw: string | null, sigRaw: string | null, now = Date.now()): 'ok' | 'invalid' | 'expired' {
    if (!expRaw || !sigRaw || !/^\d{1,12}$/.test(expRaw) || sigRaw.length > 128) return 'invalid';
    const exp = Number(expRaw);
    if (!safeEq(sigRaw, signDownload(jobId, actorKey, exp))) return 'invalid';
    return exp * 1000 < now ? 'expired' : 'ok';
}

export function buildDownloadUrl(base: string, prefix: string, jobId: string, actorKey: string, now = Date.now()): { url: string; expiresAt: number } {
    const exp = Math.floor(now / 1000) + DOWNLOAD_LINK_TTL_S;
    const sig = signDownload(jobId, actorKey, exp);
    return { url: `${base.replace(/\/$/, '')}${prefix}/jobs/${encodeURIComponent(jobId)}/download?exp=${exp}&sig=${sig}`, expiresAt: exp * 1000 };
}
