/**
 * http.ts - contexto comun de las rutas de importar/exportar: actor (administrador o usuario), limites, cuerpo JSON y re-autenticacion.
 * Sin dependencias de React. Las rutas son finas: extraen el actor (requireAdmin / sesion) y delegan en router.ts.
 */
import type { NextRequest } from 'next/server';
import type { ZodType } from 'zod';
import { HttpError, badRequest } from '@/lib/admin/http';
import { getClientIp, rateLimitAsync } from '@/lib/security';
import { auditLog } from '@/lib/audit';
import { REAUTH_COOKIE, sessionMfaRecent, verifyReauthToken } from './auth';
import { instanceDomain } from './mailboxes';
import { transferLimits, type TransferLimits } from './limits';
import { realEngineDeps } from './runtime';
import type { EngineDeps } from './import-engine';
import type { JobRow } from './store';

export interface TransferActor {
    /** admin: consola (dueno del dominio o ADMIN_EMAILS con MFA). self: un usuario sobre SU buzon. */
    mode: 'admin' | 'self';
    /** Clave estable para propiedad, limites y firmas. */
    key: string;
    kind: 'user' | 'manager';
    email: string | null;
    /** Solo modo self: el usuario y su direccion. */
    selfUserId: string | null;
    selfEmail: string | null;
    /** Id de sesion (jti) si la hay. */
    sessionId: string | null;
    session: { mfa?: unknown; at?: unknown; iat?: unknown } | null;
    /** El usuario de la app asociado (si lo hay): para MFA/contrasena locales. */
    localUserId: string | null;
}

export interface HCtx {
    req: NextRequest;
    actor: TransferActor;
    ip: string;
    /** Dominio principal de la instancia. */
    domain: string;
    limits: TransferLimits;
    deps: () => EngineDeps;
    /** Prefijo de API ("/api/admin/mail-transfer" o "/api/mail-transfer"). */
    apiPrefix: string;
    /** Encadena el worker tras la respuesta (after()). Inyectable en pruebas. */
    kick: (jobId: string) => void;
}

export function makeCtx(req: NextRequest, actor: TransferActor, apiPrefix: string, over: Partial<HCtx> = {}): HCtx {
    return {
        req,
        actor,
        ip: getClientIp(req),
        domain: instanceDomain(),
        limits: transferLimits(),
        deps: () => realEngineDeps(),
        apiPrefix,
        kick: () => undefined,
        ...over,
    };
}

export const owner = (c: HCtx) => ({ userId: c.actor.key, domain: c.domain });

export async function limit(c: HCtx, name: string, max: number, windowMs = 60_000): Promise<void> {
    const rl = await rateLimitAsync(`mt:${name}:${c.actor.key}`, max, windowMs);
    if (!rl.ok) throw new HttpError(429, 'rate_limited', String(rl.retryAfter));
}

const MAX_JSON = 768 * 1024;

export async function readJson<T>(c: HCtx, schema: ZodType<T>): Promise<T> {
    const text = await c.req.text().catch(() => '');
    if (text.length > MAX_JSON) throw new HttpError(413, 'payload_too_large');
    let raw: unknown;
    try { raw = text ? JSON.parse(text) : {}; } catch { throw badRequest('invalid_json'); }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        const fields = Array.from(new Set(parsed.error.issues.slice(0, 10).map((i) => i.path.map(String).join('.') || '(body)')));
        throw new HttpError(400, 'invalid_input', `Invalid input: ${fields.join(', ')}`);
    }
    return parsed.data;
}

/** Re-autenticacion reciente: cookie de prueba valida o sesion con MFA verificado hace < 10 min. */
export function hasRecentAuth(c: HCtx): { ok: boolean; method?: string; expiresAt?: number } {
    const v = verifyReauthToken(c.req.cookies.get(REAUTH_COOKIE)?.value, c.actor.key, c.actor.sessionId);
    if (v.ok) return v;
    if (sessionMfaRecent(c.actor.session)) return { ok: true, method: 'mfa' };
    return { ok: false };
}

export function requireRecent(c: HCtx): void {
    if (!hasRecentAuth(c).ok) throw new HttpError(403, 'reauth_required');
}

/** Confirmacion explicita: escribir el nombre del dominio. */
export function requireDomainConfirmation(c: HCtx, typed: string | undefined): void {
    const t = String(typed ?? '').trim().toLowerCase();
    if (!t || t !== c.domain.toLowerCase()) throw new HttpError(400, 'domain_confirmation_mismatch');
}

export function adminOnly(c: HCtx): void {
    if (c.actor.mode !== 'admin') throw new HttpError(403, 'admin_only');
}

/** El trabajo debe pertenecer al actor (propiedad estricta) y al modo. 404 si no (no revela existencia). */
export function assertJobAccess(c: HCtx, job: JobRow | null): JobRow {
    if (!job) throw new HttpError(404, 'not_found');
    if (c.actor.mode === 'self' && (job.scope !== 'self' || job.targetUserId !== c.actor.selfUserId)) throw new HttpError(404, 'not_found');
    if (c.actor.mode === 'admin' && job.scope === 'self') throw new HttpError(404, 'not_found');
    return job;
}

export function audit(c: HCtx, event: string, data: Record<string, unknown> = {}): void {
    auditLog(`admin.mail_transfer.${event}`, {
        ...data,
        userId: c.actor.localUserId ?? c.actor.key,
        actorKind: c.actor.kind,
        actorEmail: c.actor.email,
        mode: c.actor.mode,
        ip: c.ip,
    });
}
