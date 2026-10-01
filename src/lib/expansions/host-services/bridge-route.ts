/**
 * Helper comun de las rutas /api/internal/{calendar,contacts,storage,notify,formats}: puente servidor-a-servidor de
 * `services.*` del sandbox de extensiones (bloomx-backend). Mismo modelo de confianza que /api/internal/mail:
 *
 *  - Auth SIN claves globales: la `executionGrant` que ESTA instancia firmo con su clave de dominio (lib/exec-grant.ts, verifyHostCall). Camino
 *    LEGADO deprecado: firma Ed25519 del backend (apagable con BLOOMX_ACCEPT_BACKEND_SIGNATURE=false). 401 si no es valida.
 *  - `userId` del cuerpo == X-User-Id firmado (la extension nunca lo elige). `extensionId` lo fija el host.
 *  - Cuerpo estricto (zod .strict()): claves desconocidas => 400. Limite de 256 KB.
 *  - Rate limit por usuario+servicio, usuario inexistente => 404, errores tipados sin detalles internos ni PII.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { GrantClaims } from '@/lib/exec-grant';

export const MAX_BODY_BYTES = 256 * 1024;
const NO_STORE = { 'Cache-Control': 'no-store' };

export type BridgeErrorCode = 'invalid_args' | 'not_found' | 'forbidden' | 'read_only' | 'conflict' | 'quota_exceeded' | 'rate_limited'
    // Intermediario OAuth (lib/oauth/broker.ts):
    | 'scope_missing' | 'not_linked' | 'reconnect_required' | 'not_configured' | 'provider_error';

const STATUS_BY_CODE: Record<BridgeErrorCode, number> = {
    invalid_args: 400,
    not_found: 404,
    forbidden: 403,
    read_only: 403,
    conflict: 409,
    quota_exceeded: 413,
    rate_limited: 429,
    scope_missing: 403,
    not_linked: 404,
    reconnect_required: 409,
    not_configured: 503,
    provider_error: 502,
};

/** Error de negocio tipado: el mensaje nunca llega al cliente (solo `code`). */
export class BridgeError extends Error {
    readonly code: BridgeErrorCode;
    readonly retryAfter?: number;
    constructor(code: BridgeErrorCode, retryAfter?: number) {
        super(code);
        this.name = 'BridgeError';
        this.code = code;
        this.retryAfter = retryAfter;
    }
}

export const idString = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
/** Id canonico de la extension instalada (lo fija el host). */
export const extensionIdString = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/);

/** Construye el esquema del cuerpo { op, userId, extensionId, args } para una operacion. */
export function op<O extends string, A extends z.ZodType>(name: O, args: A) {
    return z.strictObject({ op: z.literal(name), userId: idString, extensionId: extensionIdString, args });
}

export interface BridgeRequest<Op extends string = string, Args = unknown> {
    op: Op;
    userId: string;
    extensionId: string;
    args: Args;
}

export interface BridgeDeps {
    verify: (req: NextRequest, raw: string) => Promise<{ ok: true; userId: string | null; grant?: GrantClaims } | { ok: false; reason: 'unavailable' | 'invalid' }>;
    rateLimit: (key: string, limit: number, windowMs: number) => Promise<{ ok: boolean; retryAfter: number }>;
    userExists: (userId: string) => Promise<boolean>;
}

export const defaultBridgeDeps: BridgeDeps = {
    verify: async (req, raw) => (await import('@/lib/host-call-auth')).verifyHostCall(req, raw),
    rateLimit: async (key, limit, windowMs) => (await import('@/lib/security')).rateLimitAsync(key, limit, windowMs),
    userExists: async (userId) => {
        const { prisma } = await import('@/lib/prisma');
        return !!(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }));
    },
};

export interface BridgeRouteOptions<S extends z.ZodType> {
    /** Nombre del servicio (clave del rate limit y de los logs). */
    service: string;
    /** Union discriminada por `op` construida con `op()`. */
    schema: S;
    /** Ejecuta la operacion ya validada. Lanza BridgeError para errores tipados. */
    handle: (req: z.infer<S>, ctx: { grant?: GrantClaims }) => Promise<unknown>;
    /** Peticiones por minuto y usuario (default 300). */
    limitPerMinute?: number;
    /** Tope del cuerpo en bytes (default 256 KB; el intermediario OAuth admite subidas de hasta ~1 MB). */
    maxBodyBytes?: number;
    deps?: BridgeDeps;
}

const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
    NextResponse.json(body, { status, headers: { ...NO_STORE, ...extra } });

export function errorResponse(code: BridgeErrorCode, retryAfter?: number) {
    const message = code === 'not_found' || code === 'not_linked' ? 'Not found' : code === 'rate_limited' ? 'Too many requests' : code === 'quota_exceeded' ? 'Quota exceeded' : code === 'invalid_args' ? 'Invalid request' : code === 'conflict' || code === 'reconnect_required' ? 'Conflict' : code === 'read_only' ? 'Read only' : code === 'not_configured' ? 'Not configured' : code === 'provider_error' ? 'Provider error' : 'Forbidden';
    return json({ error: message, code }, STATUS_BY_CODE[code], code === 'rate_limited' && retryAfter ? { 'Retry-After': String(retryAfter) } : {});
}

export function createBridgeHandler<S extends z.ZodType>(opts: BridgeRouteOptions<S>) {
    const deps = opts.deps ?? defaultBridgeDeps;
    const limit = opts.limitPerMinute ?? 300;
    const maxBody = opts.maxBodyBytes ?? MAX_BODY_BYTES;

    return async function POST(req: NextRequest): Promise<Response> {
        const declared = Number(req.headers.get('content-length') || 0);
        if (declared > maxBody) return json({ error: 'Payload too large' }, 413);
        const raw = await req.text();
        if (Buffer.byteLength(raw, 'utf8') > maxBody) return json({ error: 'Payload too large' }, 413);

        const verified = await deps.verify(req, raw);
        if (!verified.ok) {
            return verified.reason === 'unavailable'
                ? json({ error: 'Backend key unavailable' }, 503, { 'Retry-After': '30' })
                : json({ error: 'Unauthorized' }, 401);
        }

        let body: unknown = null;
        try { body = JSON.parse(raw); } catch { body = null; }
        const parsed = opts.schema.safeParse(body);
        if (!parsed.success) return errorResponse('invalid_args');
        const data = parsed.data as BridgeRequest;
        // El usuario del cuerpo debe ser el firmado en la cabecera (evita reutilizar una firma con otro userId).
        if (!verified.userId || verified.userId !== data.userId) return json({ error: 'Unauthorized' }, 401);

        const rl = await deps.rateLimit(`internal-${opts.service}:${data.userId}`, limit, 60_000);
        if (!rl.ok) return errorResponse('rate_limited', rl.retryAfter);

        try {
            if (!(await deps.userExists(data.userId))) return errorResponse('not_found');
            const result = await opts.handle(parsed.data as z.infer<S>, { grant: verified.grant });
            return json({ success: true, data: result }, 200);
        } catch (e: any) {
            if (e instanceof BridgeError) return errorResponse(e.code, e.retryAfter);
            // Sin contenido de usuario en el log: solo servicio, operacion y un mensaje corto.
            console.error(`[internal-${opts.service}] failed:`, data.op, String(e?.message || 'error').slice(0, 120));
            return json({ error: 'Internal error' }, 500);
        }
    };
}
