import { NextRequest } from 'next/server';
import { markTrustedAdminRequest, type AdminActor } from '@/lib/admin-auth';
import { CmdError, type RouteCall, type RouteResult } from './types';

/**
 * Puente a las rutas REALES de /api/admin/**.
 *
 * Los comandos NO duplican logica: fabrican una peticion en proceso y llaman al mismo handler que usa la consola web
 * (misma validacion zod, mismos limites de tasa, misma auditoria `admin.*`, mismas listas blancas de respuesta). La peticion
 * se marca como confiable para ese administrador (admin-auth.markTrustedAdminRequest) DESPUES de haberlo autenticado y de
 * haber comprobado ambito, riesgo y step-up en exec.ts. Solo existen las rutas de esta tabla: nada de URLs libres.
 */

type Loader = () => Promise<Record<string, any>>;
interface Entry { pattern: string; load: Loader }

/** Tabla estatica (imports literales: el empaquetador los incluye). La clave de cobertura es `METODO /api/admin<pattern>`. */
export const ROUTE_TABLE: readonly Entry[] = [
    { pattern: '/overview', load: () => import('@/app/api/admin/overview/route') },
    { pattern: '/system', load: () => import('@/app/api/admin/system/route') },
    { pattern: '/me', load: () => import('@/app/api/admin/me/route') },
    { pattern: '/search', load: () => import('@/app/api/admin/search/route') },
    { pattern: '/users', load: () => import('@/app/api/admin/users/route') },
    { pattern: '/users/bulk', load: () => import('@/app/api/admin/users/bulk/route') },
    { pattern: '/users/export', load: () => import('@/app/api/admin/users/export/route') },
    { pattern: '/users/[id]', load: () => import('@/app/api/admin/users/[id]/route') },
    { pattern: '/users/[id]/mfa-reset', load: () => import('@/app/api/admin/users/[id]/mfa-reset/route') },
    { pattern: '/users/[id]/password', load: () => import('@/app/api/admin/users/[id]/password/route') },
    { pattern: '/users/[id]/force-password-change', load: () => import('@/app/api/admin/users/[id]/force-password-change/route') },
    { pattern: '/users/[id]/quota', load: () => import('@/app/api/admin/users/[id]/quota/route') },
    { pattern: '/users/[id]/sessions', load: () => import('@/app/api/admin/users/[id]/sessions/route') },
    { pattern: '/users/[id]/sessions/[jti]', load: () => import('@/app/api/admin/users/[id]/sessions/[jti]/route') },
    { pattern: '/accounts', load: () => import('@/app/api/admin/accounts/route') },
    { pattern: '/accounts/[id]', load: () => import('@/app/api/admin/accounts/[id]/route') },
    { pattern: '/accounts/[id]/reconnect', load: () => import('@/app/api/admin/accounts/[id]/reconnect/route') },
    { pattern: '/mail/metrics', load: () => import('@/app/api/admin/mail/metrics/route') },
    { pattern: '/mail/dns', load: () => import('@/app/api/admin/mail/dns/route') },
    { pattern: '/mail/webhooks', load: () => import('@/app/api/admin/mail/webhooks/route') },
    { pattern: '/mail/suppressions', load: () => import('@/app/api/admin/mail/suppressions/route') },
    { pattern: '/mail/suppressions/bulk-delete', load: () => import('@/app/api/admin/mail/suppressions/bulk-delete/route') },
    { pattern: '/mail/suppressions/[id]', load: () => import('@/app/api/admin/mail/suppressions/[id]/route') },
    { pattern: '/domain', load: () => import('@/app/api/admin/domain/route') },
    { pattern: '/domain-key', load: () => import('@/app/api/admin/domain-key/route') },
    { pattern: '/conferencing', load: () => import('@/app/api/admin/conferencing/route') },
    { pattern: '/extensions/catalog', load: () => import('@/app/api/admin/extensions/catalog/route') },
    { pattern: '/extensions/installed', load: () => import('@/app/api/admin/extensions/installed/route') },
    { pattern: '/extensions/install', load: () => import('@/app/api/admin/extensions/install/route') },
    { pattern: '/extensions/uninstall', load: () => import('@/app/api/admin/extensions/uninstall/route') },
    { pattern: '/extensions/update', load: () => import('@/app/api/admin/extensions/update/route') },
    { pattern: '/extensions/toggle', load: () => import('@/app/api/admin/extensions/toggle/route') },
    { pattern: '/extensions/mandatory', load: () => import('@/app/api/admin/extensions/mandatory/route') },
    { pattern: '/extensions/order', load: () => import('@/app/api/admin/extensions/order/route') },
    { pattern: '/extensions/test', load: () => import('@/app/api/admin/extensions/test/route') },
    { pattern: '/extensions/settings', load: () => import('@/app/api/admin/extensions/settings/route') },
    { pattern: '/extensions/[id]/status', load: () => import('@/app/api/admin/extensions/[id]/status/route') },
    { pattern: '/retention/settings', load: () => import('@/app/api/admin/retention/settings/route') },
    { pattern: '/retention/quota', load: () => import('@/app/api/admin/retention/quota/route') },
    { pattern: '/retention/storage', load: () => import('@/app/api/admin/retention/storage/route') },
    { pattern: '/retention/run', load: () => import('@/app/api/admin/retention/run/route') },
    { pattern: '/permissions', load: () => import('@/app/api/admin/permissions/route') },
    { pattern: '/permissions/unlock', load: () => import('@/app/api/admin/permissions/unlock/route') },
    { pattern: '/privileged-session', load: () => import('@/app/api/admin/privileged-session/route') },
    { pattern: '/permissions/history', load: () => import('@/app/api/admin/permissions/history/route') },
    { pattern: '/audit', load: () => import('@/app/api/admin/audit/route') },
    { pattern: '/audit/export', load: () => import('@/app/api/admin/audit/export/route') },
    { pattern: '/security/status', load: () => import('@/app/api/admin/security/status/route') },
    { pattern: '/spam/config', load: () => import('@/app/api/admin/spam/config/route') },
    { pattern: '/spam/events', load: () => import('@/app/api/admin/spam/events/route') },
    { pattern: '/spam/stats', load: () => import('@/app/api/admin/spam/stats/route') },
    { pattern: '/spam/test', load: () => import('@/app/api/admin/spam/test/route') },
    { pattern: '/spam/simulate', load: () => import('@/app/api/admin/spam/simulate/route') },
    { pattern: '/spam/lists/[kind]', load: () => import('@/app/api/admin/spam/lists/[kind]/route') },
    { pattern: '/spam/lists/[kind]/import', load: () => import('@/app/api/admin/spam/lists/[kind]/import/route') },
    { pattern: '/spam/lists/[kind]/export', load: () => import('@/app/api/admin/spam/lists/[kind]/export/route') },
];

/** Importar/exportar correo: catch-all gestionado por mail-transfer/router.ts (se invoca `dispatch` directamente). */
export const MAIL_TRANSFER_PREFIX = '/mail-transfer';

function match(pattern: string, path: string): Record<string, string> | null {
    const a = pattern.split('/');
    const b = path.split('/');
    if (a.length !== b.length) return null;
    const params: Record<string, string> = {};
    for (let i = 0; i < a.length; i++) {
        const m = /^\[(\w+)\]$/.exec(a[i]);
        if (m) {
            if (!b[i]) return null;
            params[m[1]] = decodeURIComponent(b[i]);
        } else if (a[i] !== b[i]) return null;
    }
    return params;
}

export interface BridgeAuth {
    actor: AdminActor;
    ip: string;
    userAgent?: string | null;
    /** Cookie `auth_session` del manager (web: la de la peticion; token: la guardada cifrada). */
    managerSession?: string | null;
    /** Prueba de step-up (cookie bx_mt_reauth) para las operaciones de importar/exportar. */
    reauthProof?: string | null;
}

const BASE = 'http://bloomx.internal';

function buildRequest(call: RouteCall, auth: BridgeAuth, apiPath: string): NextRequest {
    const url = new URL(`${BASE}${apiPath}`);
    for (const [k, v] of Object.entries(call.query ?? {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    const cookies: string[] = [];
    if (auth.managerSession) cookies.push(`auth_session=${auth.managerSession}`);
    if (auth.reauthProof) cookies.push(`bx_mt_reauth=${auth.reauthProof}`);
    const headers: Record<string, string> = { 'x-forwarded-for': auth.ip, host: 'bloomx.internal', 'x-bloomx-via': 'cli' };
    if (auth.userAgent) headers['user-agent'] = auth.userAgent;
    if (cookies.length) headers.cookie = cookies.join('; ');
    const hasBody = call.body !== undefined && call.method !== 'GET';
    const binary = call.body instanceof Uint8Array;
    if (hasBody) headers['content-type'] = binary ? 'application/octet-stream' : 'application/json';
    for (const [k, v] of Object.entries(call.headers ?? {})) if (/^x-chunk-sha256$/i.test(k)) headers[k.toLowerCase()] = v;
    if (hasBody && binary) headers['content-length'] = String((call.body as Uint8Array).byteLength);
    const payload = !hasBody ? undefined : binary ? (call.body as Uint8Array) : typeof call.body === 'string' ? call.body : JSON.stringify(call.body);
    const req = new NextRequest(url, { method: call.method, headers, body: payload as BodyInit | undefined });
    markTrustedAdminRequest(req, auth.actor);
    return req;
}

async function readResult(res: Response): Promise<RouteResult> {
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    const ct = headers['content-type'] ?? '';
    const raw = await res.text();
    if (ct.includes('json') || /^\s*[{[]/.test(raw)) {
        try { return { status: res.status, data: JSON.parse(raw), headers }; } catch { /* texto */ }
    }
    return { status: res.status, data: null, text: raw, headers };
}

/** Llama a una ruta del admin en proceso. `path` es relativo a /api/admin ("/users/abc/quota"). */
export async function callAdminRoute(call: RouteCall & { raw: true }, auth: BridgeAuth): Promise<Response>;
export async function callAdminRoute(call: RouteCall, auth: BridgeAuth): Promise<RouteResult>;
export async function callAdminRoute(call: RouteCall, auth: BridgeAuth): Promise<RouteResult | Response> {
    if (!call.path.startsWith('/') || call.path.includes('..') || call.path.includes('?') || call.path.includes('//')) throw new CmdError('invalid_route', 'Invalid route');
    const apiPath = `/api/admin${call.path}`;

    if (call.path === MAIL_TRANSFER_PREFIX || call.path.startsWith(`${MAIL_TRANSFER_PREFIX}/`)) {
        const { dispatch } = await import('@/lib/mail-transfer/router');
        const segments = call.path.slice(MAIL_TRANSFER_PREFIX.length).split('/').filter(Boolean).map(decodeURIComponent);
        const a = auth.actor;
        const actor = {
            mode: 'admin' as const, key: a.id || a.email || 'admin', kind: a.kind, email: a.email ?? null, selfUserId: null, selfEmail: null,
            sessionId: null, session: null, localUserId: a.kind === 'user' ? a.id : null,
        };
        const res = await dispatch(buildRequest(call, auth, apiPath), segments, 'admin', { actor });
        return call.raw ? res : readResult(res);
    }

    for (const entry of ROUTE_TABLE) {
        const params = match(entry.pattern, call.path);
        if (!params) continue;
        const mod = await entry.load();
        const handler = mod[call.method];
        if (typeof handler !== 'function') throw new CmdError('method_not_supported', `${call.method} ${entry.pattern} is not available`, 2, 405);
        const req = buildRequest(call, auth, apiPath);
        const res: Response = await handler(req, { params: Promise.resolve(params) });
        return readResult(res);
    }
    throw new CmdError('invalid_route', 'Unknown route', 2, 404);
}

/** Claves `METODO /api/admin<patron>` de lo que el puente puede alcanzar (para el test de cobertura). */
export async function reachableRoutes(): Promise<string[]> {
    const out: string[] = [];
    for (const e of ROUTE_TABLE) {
        const mod = await e.load();
        for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) if (typeof mod[m] === 'function') out.push(`${m} /api/admin${e.pattern}`);
    }
    return out;
}
