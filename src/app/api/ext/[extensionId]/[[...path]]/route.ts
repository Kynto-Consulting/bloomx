import { backendUrl } from '@/lib/backend-url';
import { NextRequest, NextResponse } from 'next/server';
import { buildBackendHeaders } from '@/lib/backend-auth';
import { getClientIp, rateLimitAsync } from '@/lib/security';
import { resolveEdgeIdentity } from '@/lib/ext-edge-identity';
import {
    EDGE_MAX_BODY_BYTES, EXTENSION_ID_RE, buildBackendRouteUrl, edgeRoutePath, forwardableHeaders, isSafeMethod, relayResponseHeaders, sanitizeEdgeQuery, sessionAllowed,
} from '@/lib/expansions/ext-edge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * /api/ext/[extensionId]/[...path]  — puerta PUBLICA de las rutas HTTP propias de extensiones (`backendRoutes`).
 *
 * Este borde NO decide el modo de autenticacion: lo decide el manifest en el backend (por defecto `session`, falla cerrado). Aqui:
 *  - se identifica al llamador SOLO con la sesion de la instancia y solo en peticiones de mismo origen (CSRF); terceros = anonimos;
 *  - se firma (Ed25519 de la instancia) la URL con `_bx_src=edge`, nivel de admin, step-up e IP real; el llamador no puede fijar `_bx_*`;
 *  - jamas se reenvian cookies ni Authorization; las cabeceras del tercero viajan como `x-bloomx-fwd-*` (para verificar HMAC);
 *  - de la respuesta solo se relevan cabeceras en lista blanca (nunca set-cookie).
 * El token OAuth de ningun proveedor pasa por aqui.
 */

const BACKEND_URL = (backendUrl()).replace(/\/+$/, '');
const SECURITY = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

const fail = (status: number, code: string, headers: Record<string, string> = {}) => NextResponse.json({ error: code }, { status, headers: { ...SECURITY, ...headers } });

async function handle(req: NextRequest, ctx: { params: Promise<{ extensionId: string; path?: string[] }> }): Promise<NextResponse> {
    const { extensionId } = await ctx.params;
    const method = req.method.toUpperCase();
    if (!EXTENSION_ID_RE.test(extensionId)) return fail(404, 'ROUTE_NOT_FOUND');
    const path = edgeRoutePath(req.nextUrl.pathname, extensionId);
    if (path === null) return fail(404, 'ROUTE_NOT_FOUND');
    if (method === 'HEAD' || method === 'TRACE' || method === 'CONNECT') return fail(405, 'METHOD_NOT_ALLOWED');

    const ip = getClientIp(req);
    // Tope del borde por IP (defensa de la instancia antes de molestar al backend compartido).
    const rl = await rateLimitAsync(`ext-edge:${ip}`, 300, 60_000);
    if (!rl.ok) return fail(429, 'RATE_LIMITED', { 'Retry-After': String(rl.retryAfter) });

    // Cuerpo con tope duro.
    let rawBody = '';
    if (!isSafeMethod(method)) {
        const declared = Number(req.headers.get('content-length') || 0);
        if (declared > EDGE_MAX_BODY_BYTES) return fail(413, 'ROUTE_BODY_TOO_LARGE');
        rawBody = await req.text().catch(() => '');
        if (Buffer.byteLength(rawBody, 'utf8') > EDGE_MAX_BODY_BYTES) return fail(413, 'ROUTE_BODY_TOO_LARGE');
    }

    // Identidad: solo de mismo origen. Un POST cross-site con cookies de sesion se trata como anonimo.
    const identity = sessionAllowed(method, req.headers) ? await resolveEdgeIdentity(req).catch(() => null) : null;

    const url = buildBackendRouteUrl(BACKEND_URL, extensionId, path, sanitizeEdgeQuery(req.nextUrl.searchParams), {
        level: identity?.level ?? null,
        stepUp: identity?.stepUp === true,
        clientIp: ip !== 'unknown' ? ip : null,
        fetchSite: req.headers.get('sec-fetch-site'),
    });
    const domain = process.env.TOP_DOMAIN || req.headers.get('host') || '';
    const contentType = req.headers.get('content-type');
    const origin = req.headers.get('origin');
    try {
        const res = await fetch(url, {
            method,
            headers: {
                ...(contentType ? { 'Content-Type': contentType } : {}),
                ...(origin ? { Origin: origin } : {}),
                ...forwardableHeaders(req.headers),
                ...buildBackendHeaders({ method, url, body: rawBody, domain, userId: identity?.id ?? null, email: identity?.email ?? null }),
            },
            body: isSafeMethod(method) ? undefined : rawBody,
            cache: 'no-store',
            redirect: 'manual',
            signal: AbortSignal.timeout(35_000),
        });
        const text = res.status === 204 || res.status === 304 ? null : await res.text();
        const relayed = relayResponseHeaders(res.headers);
        return new NextResponse(text, { status: res.status, headers: { ...SECURITY, ...relayed } });
    } catch {
        return fail(502, 'BACKEND_UNAVAILABLE');
    }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
export const HEAD = handle;
