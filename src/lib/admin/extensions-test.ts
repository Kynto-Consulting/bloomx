import type { AdminActor } from '@/lib/admin-auth';
import { buildBackendHeaders, loadDomainPrivateKey } from '@/lib/backend-auth';
import { backendUrl, ownHost } from '@/lib/admin/extensions-instance';

/**
 * "Probar conexion" de una extension: ejecuta su funcion `testConnection` en el backend por la via soportada
 * (`POST /api/extension/execute`, la misma que usa `src/lib/expansions/api.ts` para CALL_BACKEND).
 *
 * Por que no siempre se puede (501 not_supported):
 *  - El backend ejecuta la funcion COMO UN USUARIO de la app (X-User-ID/X-User-Email). Un admin-gestor (manager del backend)
 *    no es un usuario de esta app: no hay contexto de usuario que enviar, y no se inventa uno.
 *  - Sin clave de dominio (`BLOOMX_DOMAIN_PRIVATE_KEY`) el backend corre la extension en modo LEGADO, SIN las credenciales
 *    del dominio: la prueba no probaria nada real (y daria falsos negativos), asi que no se ofrece.
 */

export type NotSupportedReason = 'user_context_required' | 'signing_key_required';

export function testConnectionSupport(actor: AdminActor): { supported: true } | { supported: false; reason: NotSupportedReason } {
    if (actor.kind !== 'user' || !actor.id || !actor.email) return { supported: false, reason: 'user_context_required' };
    if (!loadDomainPrivateKey()) return { supported: false, reason: 'signing_key_required' };
    return { supported: true };
}

export const TEST_TIMEOUT_MS = 10_000;

/** Codigos estables (la UI los traduce): nunca texto ni datos del proveedor. */
export type TestMessage = 'auth_required' | 'timeout' | 'not_installed' | 'rate_limited' | 'failed';

export interface TestOutcome {
    ok: boolean;
    message?: TestMessage;
    status: number;
}

export async function runTestConnection(args: {
    req: Request;
    actor: Extract<AdminActor, { kind: 'user' }>;
    extensionId: string;
    action: string;
}): Promise<TestOutcome> {
    const url = `${backendUrl()}/api/extension/execute`;
    const rawBody = JSON.stringify({ extensionId: args.extensionId, action: args.action, params: {}, context: {} });
    let res: Response;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...buildBackendHeaders({ method: 'POST', url, body: rawBody, domain: ownHost(args.req), userId: args.actor.id, email: args.actor.email }),
            },
            body: rawBody,
            cache: 'no-store',
            signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
        });
    } catch (error) {
        const timedOut = (error as { name?: string })?.name === 'TimeoutError' || (error as { name?: string })?.name === 'AbortError';
        return { ok: false, message: timedOut ? 'timeout' : 'failed', status: 0 };
    }
    const data: any = await res.json().catch(() => null);
    if (res.ok && data?.success === true) {
        // Una funcion de prueba puede devolver { ok: false } sin lanzar: tambien es fallo.
        const r = data.result;
        const reportedFail = r && typeof r === 'object' && (r.ok === false || r.success === false);
        return reportedFail ? { ok: false, message: 'failed', status: res.status } : { ok: true, status: res.status };
    }
    const message: TestMessage =
        res.status === 401 || data?.error === 'AUTH_REQUIRED' ? 'auth_required'
        : res.status === 408 ? 'timeout'
        : res.status === 404 ? 'not_installed'
        : res.status === 429 ? 'rate_limited'
        : 'failed';
    return { ok: false, message, status: res.status };
}
