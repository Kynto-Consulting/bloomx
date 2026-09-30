/** Envoltorio de las rutas /api/spam/** del USUARIO: sesion, rate limit asincrono, errores sin detalle y no-store. */
import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { HttpError, json } from '@/lib/admin/http';
import { getClientIp, rateLimitAsync } from '@/lib/security';

export interface UserCtx { req: NextRequest; user: { id: string; email: string }; ip: string }
type RouteContext<P> = { params: Promise<P> } | undefined;

export function userRoute<P extends Record<string, string> = Record<string, string>>(
    opts: { scope: string; limit?: number; write?: boolean },
    handler: (ctx: UserCtx, params: P) => Promise<Response | Record<string, unknown>>,
) {
    return async function route(req: NextRequest, context?: RouteContext<P>): Promise<Response> {
        const user = await getCurrentUser();
        if (!user?.id) return json({ error: 'Unauthorized' }, { status: 401 });
        const ip = getClientIp(req);
        try {
            const rl = await rateLimitAsync(`spam:${opts.scope}:${user.id}`, opts.limit ?? (opts.write ? 30 : 120), 60_000);
            if (!rl.ok) return json({ error: 'Too many requests', code: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } });
            const params = (context?.params ? await context.params : {}) as P;
            const out = await handler({ req, user: { id: user.id, email: user.email }, ip }, params);
            return out instanceof Response ? out : json(out);
        } catch (error) {
            if (error instanceof HttpError) return json({ error: error.message, code: error.code }, { status: error.status });
            console.error(`[SPAM_${opts.scope.toUpperCase()}]`, error instanceof Error ? error.message.slice(0, 300) : 'error');
            return json({ error: 'Internal Server Error', code: 'internal' }, { status: 500 });
        }
    };
}
