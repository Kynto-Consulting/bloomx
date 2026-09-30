import { z } from 'zod';
import { adminRoute, audit, badRequest, conflict, HttpError, json, parseBody, parseQuery } from '@/lib/admin/http';
import { assertDomainIsThisInstance, cleanFingerprint, looksLikePrivateKey, managerCookieHeader } from '@/lib/admin/profile-domain';
import { backendBaseUrl } from '@/lib/backend-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Proxy de la clave de firma del dominio -> backend /api/manager/domain-key (que exige la cookie de manager DUENO del dominio).
 *
 *   GET  ?domainId=..                                     -> { registered, fingerprint, requireSignature, legacyMode }
 *   POST { domainId, signingPublicKey }                   -> { success, registered, fingerprint }  (registra o ROTA)
 *   POST { domainId, requireSignature: boolean }          -> { success, requireSignature }         (compatibilidad con el aviso del panel)
 *
 * Seguridad:
 *  - Solo admin (adminRoute). Un admin kind "user" no tiene cookie de manager => 409 `manager_session_required`.
 *  - Solo se acepta el domainId de ESTA instancia (se comprueba en /api/manager/domains con la misma cookie): si no, 403.
 *  - Se reenvia SOLO la cookie auth_session (nunca el resto de cookies de la app).
 *  - NUNCA se acepta una clave PRIVADA: si el texto la contiene, 400 `private_key_rejected` antes de enviarlo a ningun sitio.
 *  - La respuesta se reconstruye con lista blanca; la auditoria guarda solo la huella (jamas la clave).
 *  - Con clave registrada el backend exige peticiones firmadas (deja el modo legado): "exigir firma" es un estado derivado.
 */

const domainIdSchema = z.string().min(1).max(200);
const querySchema = z.object({ domainId: domainIdSchema });
const postSchema = z.object({
    domainId: domainIdSchema,
    signingPublicKey: z.string().max(4000).optional(),
    requireSignature: z.boolean().optional(),
});

function mapBackendError(status: number): HttpError {
    if (status === 400) return badRequest('invalid_signing_key');
    if (status === 401 || status === 403) return new HttpError(403, 'forbidden_domain');
    if (status === 409) return conflict('register_key_first');
    if (status === 429) return new HttpError(429, 'rate_limited');
    return new HttpError(502, 'backend_error');
}

async function callBackend(cookie: string, path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<{ status: number; data: any }> {
    try {
        const res = await fetch(`${backendBaseUrl()}${path}`, {
            method: init.method,
            headers: { Cookie: cookie, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
            body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
            cache: 'no-store',
            signal: AbortSignal.timeout(6000),
        });
        return { status: res.status, data: await res.json().catch(() => ({})) };
    } catch {
        throw new HttpError(502, 'backend_unavailable');
    }
}

export const GET = adminRoute({ scope: 'domain-key.get', limit: 60 }, async (ctx) => {
    if (ctx.actor.kind !== 'manager') throw conflict('manager_session_required');
    const { domainId } = parseQuery(ctx.req, querySchema);
    await assertDomainIsThisInstance(ctx.req, domainId);
    const { status, data } = await callBackend(managerCookieHeader(ctx.req), `/api/manager/domain-key?${new URLSearchParams({ domainId })}`, { method: 'GET' });
    if (status < 200 || status >= 300) throw mapBackendError(status);
    const registered = data?.registered === true;
    return {
        registered,
        fingerprint: registered ? cleanFingerprint(data?.fingerprint) : null,
        requireSignature: data?.requireSignature === true,
        legacyMode: typeof data?.legacyMode === 'boolean' ? data.legacyMode : !registered,
    };
});

export const POST = adminRoute({ scope: 'domain-key.write', limit: 10, write: true }, async (ctx) => {
    if (ctx.actor.kind !== 'manager') throw conflict('manager_session_required');
    const body = await parseBody(ctx.req, postSchema);

    const key = body.signingPublicKey;
    // Antes de cualquier llamada de red: jamas se reenvia ni se procesa material privado.
    if (typeof key === 'string' && looksLikePrivateKey(key)) {
        audit(ctx, 'domain_key.private_key_rejected', { domainId: body.domainId });
        throw badRequest('private_key_rejected');
    }
    const hasKey = typeof key === 'string' && key.trim().length > 0;
    const hasFlag = typeof body.requireSignature === 'boolean';
    if (hasKey === hasFlag) throw badRequest('invalid_input');

    await assertDomainIsThisInstance(ctx.req, body.domainId);
    const cookie = managerCookieHeader(ctx.req);

    if (hasKey) {
        const { status, data } = await callBackend(cookie, '/api/manager/domain-key', {
            method: 'POST',
            // Solo estos dos campos: nada mas sale hacia el backend.
            body: { domainId: body.domainId, signingPublicKey: key!.trim() },
        });
        if (status < 200 || status >= 300) {
            audit(ctx, 'domain_key.register_failed', { domainId: body.domainId, status });
            throw mapBackendError(status);
        }
        const fingerprint = cleanFingerprint(data?.fingerprint);
        audit(ctx, 'domain_key.registered', { domainId: body.domainId, fingerprint });
        return { success: true, registered: true, fingerprint };
    }

    const { status, data } = await callBackend(cookie, '/api/manager/domain-key', {
        method: 'POST',
        body: { domainId: body.domainId, requireSignature: body.requireSignature },
    });
    if (status < 200 || status >= 300) throw mapBackendError(status);
    audit(ctx, 'domain_key.require_signature', { domainId: body.domainId, enabled: body.requireSignature });
    return json({ success: data?.success === true, requireSignature: data?.requireSignature === true });
});
