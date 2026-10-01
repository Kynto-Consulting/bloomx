import { NextRequest, NextResponse } from 'next/server';
import type { ZodType } from 'zod';
import { requireLevel, type AdminActor, type LevelInfo } from '@/lib/admin-auth';
import { levelForScope } from '@/lib/admin-levels';
import type { PermissionLevel } from '@/lib/permissions-core';
import { auditLog, getClientIp, rateLimitAsync } from '@/lib/security';

/**
 * Envoltorio unico de las rutas /api/admin/** de la consola.
 *
 *  1. requireLevel(minLevel) (manager duenio del dominio = nivel 4, o usuario con permission_level suficiente y MFA): sin sesion 401,
 *     sin nivel/propiedad 403. El nivel minimo sale de lib/admin-levels.ts (SCOPE_LEVELS) salvo que la ruta indique `minLevel`.
 *  2. Rate limit ASINCRONO (Redis si esta configurado, memoria si no) por admin+ambito.
 *  3. Validacion con zod (cuerpo y query) -> 400 sin repetir los valores recibidos.
 *  4. Errores: HttpError -> su estado; cualquier otro -> 500 generico (el detalle va solo al log del servidor).
 *  5. Todas las respuestas llevan Cache-Control: no-store.
 */

/** Sondeos de estado de la consola (cabecera): se validan pero NO cuentan como actividad para el cierre por inactividad. */
const PASSIVE_SCOPES = new Set(['me', 'system']);

export const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export class HttpError extends Error {
    constructor(public status: number, public code: string, message?: string) {
        super(message ?? code);
        this.name = 'HttpError';
    }
}
export const badRequest = (code = 'bad_request', message?: string) => new HttpError(400, code, message);
export const notFound = (code = 'not_found') => new HttpError(404, code);
export const conflict = (code = 'conflict') => new HttpError(409, code);

export interface AdminCtx {
    req: NextRequest;
    actor: AdminActor & LevelInfo;
    ip: string;
}

export function json(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}): NextResponse {
    return NextResponse.json(data, { status: init.status ?? 200, headers: { ...NO_STORE, ...(init.headers ?? {}) } });
}

/** Identificador estable del admin para limites y auditoria (manager: su id; usuario: su id). */
export function actorKey(actor: AdminActor, ip: string): string {
    return actor.id || actor.email || ip;
}

export interface AdminRouteOptions {
    /** Ambito del rate limit (p. ej. "users.write"). */
    scope: string;
    /** Peticiones por ventana (defecto 120 lectura / 30 escritura). */
    limit?: number;
    windowMs?: number;
    write?: boolean;
    /** Nivel minimo (0..4). Por defecto el de lib/admin-levels.ts para este scope (desconocido => 3). */
    minLevel?: PermissionLevel;
}

type RouteContext<P> = { params: Promise<P> } | undefined;

export function adminRoute<P extends Record<string, string> = Record<string, string>>(
    opts: AdminRouteOptions,
    handler: (ctx: AdminCtx, params: P) => Promise<Response | Record<string, unknown> | unknown[]>,
) {
    const minLevel: PermissionLevel = opts.minLevel ?? levelForScope(opts.scope);
    const route = async function route(req: NextRequest, context?: RouteContext<P>): Promise<Response> {
        const guard = await requireLevel(minLevel, req, { passive: PASSIVE_SCOPES.has(opts.scope) });
        if (!guard.ok) return guard.response;
        const ip = getClientIp(req);
        const limit = opts.limit ?? (opts.write ? 30 : 120);
        try {
            const rl = await rateLimitAsync(`admin:${opts.scope}:${actorKey(guard.actor, ip)}`, limit, opts.windowMs ?? 60_000);
            if (!rl.ok) {
                return json({ error: 'Too many requests', code: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } });
            }
            const params = (context?.params ? await context.params : {}) as P;
            const out = await handler({ req, actor: guard.actor, ip }, params);
            return out instanceof Response ? out : json(out);
        } catch (error) {
            if (error instanceof HttpError) return json({ error: error.message, code: error.code }, { status: error.status });
            // Solo el mensaje (nunca el objeto completo: puede arrastrar parametros SQL o cabeceras).
            console.error(`[ADMIN_${opts.scope.toUpperCase()}]`, error instanceof Error ? error.message.slice(0, 300) : 'error');
            return json({ error: 'Internal Server Error', code: 'internal' }, { status: 500 });
        }
    };
    // Metadatos para pruebas y documentacion (nivel exigido por la ruta).
    return Object.assign(route, { meta: { scope: opts.scope, minLevel, write: !!opts.write } });
}

const MAX_BODY = 64 * 1024;

/** Lee y valida el cuerpo JSON. 400 si no es JSON, es demasiado grande o no cumple el esquema. */
export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
    const text = await req.text().catch(() => '');
    if (text.length > MAX_BODY) throw new HttpError(413, 'payload_too_large');
    let raw: unknown;
    try {
        raw = text ? JSON.parse(text) : {};
    } catch {
        throw badRequest('invalid_json');
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw issuesToError(parsed.error.issues);
    return parsed.data;
}

/** Valida los parametros de la query (strings) con zod. */
export function parseQuery<T>(req: Request, schema: ZodType<T>): T {
    const sp = new URL(req.url).searchParams;
    const obj: Record<string, string> = {};
    for (const [k, v] of sp.entries()) if (!(k in obj)) obj[k] = v;
    const parsed = schema.safeParse(obj);
    if (!parsed.success) throw issuesToError(parsed.error.issues);
    return parsed.data;
}

function issuesToError(issues: ReadonlyArray<{ path: PropertyKey[]; message?: string; code?: string }>): HttpError {
    // Solo rutas de campo y codigo de la regla: nunca el valor recibido.
    const fields = Array.from(new Set(issues.slice(0, 10).map((i) => i.path.map(String).join('.') || '(body)')));
    return new HttpError(400, 'invalid_input', `Invalid input: ${fields.join(', ')}`);
}

/**
 * Auditoria de una accion de admin. `userId` del evento = usuario AFECTADO si se indica (asi el visor filtra por "usuario"),
 * si no el propio admin. El actor siempre queda en `actorId`/`actorKind`. auditLog redacta secretos y enmascara emails.
 */
export function audit(ctx: AdminCtx, event: string, data: Record<string, unknown> = {}): void {
    const { targetUserId, ...rest } = data;
    auditLog(`admin.${event}`, {
        ...rest,
        userId: typeof targetUserId === 'string' ? targetUserId : ctx.actor.id,
        targetUserId: typeof targetUserId === 'string' ? targetUserId : undefined,
        actorId: ctx.actor.id,
        actorKind: ctx.actor.kind,
        actorLevel: ctx.actor.level,
        actorEmail: ctx.actor.email,
        ip: ctx.ip,
    });
}
