import { z, type ZodType } from 'zod';
import { audit, HttpError, json, NO_STORE, type AdminCtx } from '@/lib/admin/http';
import { assertFreshMfa } from '@/lib/admin/stepup';
import { ownHost } from '@/lib/admin/extensions-instance';
import { backendBaseUrl, buildBackendHeaders } from '@/lib/backend-auth';
import { hasValidDomainKey } from '@/lib/domain-key';

/**
 * Proxy FIRMADO de /api/admin/billing/** y /api/admin/developer/** hacia el backend compartido (/api/payments/**, /api/developer/**).
 *
 *  - NUNCA es un proxy abierto: una tabla de rutas (metodo + patron) -> ruta del backend. Lo que no esta en la tabla es 404 (ruta) o 405 (metodo).
 *    Query: solo las claves listadas, con un patron por clave. Cuerpo: esquema zod por ruta; se reenvia el objeto PARSEADO (claves desconocidas
 *    descartadas), de modo que el navegador nunca puede inyectar dominio ni usuario: la identidad sale de la sesion y de la instancia.
 *  - Nivel 4 (lo exige adminRoute en la ruta Next) + step-up reciente (assertFreshMfa) salvo lecturas de configuracion publica.
 *  - Sin BLOOMX_DOMAIN_PRIVATE_KEY (modo legado) => 403 `signature_required` SIN llamar al backend.
 *  - Firma con buildBackendHeaders (Ed25519): dominio = el de ESTA instancia, userId/email = la sesion. Nunca se reenvia cookie ni JWT.
 *  - Topes: cuerpo de la peticion, cuerpo de la respuesta y timeout por ruta. Cache-Control: no-store siempre.
 *  - Auditoria con el audit de la instancia: ruta, estado e ids de objeto; sin cuerpos, sin correos del cliente, sin secretos.
 */

export type ProxyFamily = 'billing' | 'developer';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const idStr = z.string().regex(ID);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURSOR = /^[A-Za-z0-9_=.:-]{1,300}$/;

const MAX_RESPONSE_BYTES = 6 * 1024 * 1024;
const SMALL_BODY = 16 * 1024;
const FILES_BODY = 4 * 1024 * 1024; // por debajo del limite de 4,5 MB de las funciones de Vercel

const plan = z.enum(['one_time', 'month', 'year']);
const cents = z.number().int().min(0).max(99_999_999_99);
const pricing = z.object({
    model: z.enum(['free', 'one_time', 'subscription']),
    oneTimeCents: cents.optional(),
    monthCents: cents.optional(),
    yearCents: cents.optional(),
    trialDays: z.number().int().min(0).max(30).optional(),
});
const files = z.object({
    manifest: z.string().max(512 * 1024),
    serverJs: z.string().max(3 * 1024 * 1024).optional(),
    readme: z.string().max(256 * 1024).optional(),
    icon: z.string().max(600 * 1024).optional(),
});
const semver = z.string().max(64);
const changelog = z.string().max(8000);

const SCHEMAS = {
    order: z.object({ extensionId: idStr, plan: plan.optional() }),
    capture: z.object({ orderId: idStr.optional(), token: idStr.optional() }).refine((v) => !!v.orderId || !!v.token, { message: 'orderId_or_token' }),
    confirm: z.object({ subscriptionId: idStr }),
    // Cancelar siempre mantiene el acceso hasta el fin del periodo pagado: la cancelacion inmediata no se expone.
    cancel: z.object({ immediate: z.literal(false).optional() }),
    switchInterval: z.object({ interval: z.enum(['month', 'year']) }),
    empty: z.object({}),
    terms: z.object({ version: z.string().min(1).max(64) }),
    pricing: z.object({ extensionId: idStr, pricing }),
    validate: z.object({ extensionId: idStr, version: semver.optional(), changelog: changelog.optional(), pricing: pricing.optional(), files }),
    submission: z.object({ extensionId: idStr, version: semver, changelog, pricing: pricing.optional(), files, submit: z.boolean().optional() }),
    yank: z.object({ version: semver.optional() }),
    testInstall: z.object({ submissionId: idStr.optional(), version: semver.optional(), approvePermissions: z.boolean().optional() }),
} as const;

interface RouteDef {
    method: 'GET' | 'POST';
    /** Patron del frontend sin el prefijo (`:id` = un segmento validado). */
    fe: string;
    /** Ruta del backend (con los mismos `:id`). */
    be: string;
    stepUp: boolean;
    query?: Record<string, RegExp>;
    body?: ZodType<unknown>;
    maxBody?: number;
    csv?: boolean;
    /** Se audita tambien si es de lectura (exportaciones y recibos). */
    audit?: boolean;
    timeoutMs?: number;
}

const D = (r: RegExp) => r;
const RANGE = { from: D(DATE), to: D(DATE) };
const PAGE = { cursor: D(CURSOR), limit: D(/^\d{1,3}$/) };

export const BILLING_ROUTES: readonly RouteDef[] = [
    { method: 'GET', fe: 'status', be: '/api/payments/status', stepUp: false },
    { method: 'POST', fe: 'orders', be: '/api/payments/orders', stepUp: true, body: SCHEMAS.order, timeoutMs: 25_000 },
    { method: 'POST', fe: 'orders/capture', be: '/api/payments/orders/capture', stepUp: true, body: SCHEMAS.capture, timeoutMs: 30_000 },
    { method: 'GET', fe: 'orders/:id', be: '/api/payments/orders/:id', stepUp: true },
    { method: 'POST', fe: 'subscriptions/confirm', be: '/api/payments/subscriptions/confirm', stepUp: true, body: SCHEMAS.confirm, timeoutMs: 30_000 },
    { method: 'GET', fe: 'subscriptions', be: '/api/payments/subscriptions', stepUp: true },
    { method: 'POST', fe: 'subscriptions/:id/cancel', be: '/api/payments/subscriptions/:id/cancel', stepUp: true, body: SCHEMAS.cancel, audit: true, timeoutMs: 25_000 },
    { method: 'POST', fe: 'subscriptions/:id/resume', be: '/api/payments/subscriptions/:id/resume', stepUp: true, body: SCHEMAS.empty, audit: true, timeoutMs: 25_000 },
    { method: 'POST', fe: 'subscriptions/:id/switch', be: '/api/payments/subscriptions/:id/switch', stepUp: true, body: SCHEMAS.switchInterval, audit: true, timeoutMs: 25_000 },
    { method: 'POST', fe: 'subscriptions/:id/approve-price', be: '/api/payments/subscriptions/:id/approve-price', stepUp: true, body: SCHEMAS.empty, audit: true, timeoutMs: 25_000 },
    { method: 'GET', fe: 'summary', be: '/api/payments/billing/summary', stepUp: true, query: RANGE },
    { method: 'GET', fe: 'purchases', be: '/api/payments/billing/purchases', stepUp: true, query: PAGE },
    { method: 'GET', fe: 'sales', be: '/api/payments/billing/sales', stepUp: true, query: PAGE },
    { method: 'GET', fe: 'payouts', be: '/api/payments/billing/payouts', stepUp: true },
    { method: 'GET', fe: 'ledger', be: '/api/payments/billing/ledger', stepUp: true, query: { ...RANGE, kind: D(/^[a-z_]{1,32}$/) } },
    { method: 'GET', fe: 'export', be: '/api/payments/billing/export', stepUp: true, csv: true, audit: true, query: { kind: D(/^(purchases|sales|ledger|payouts)$/), ...RANGE } },
    { method: 'GET', fe: 'receipt', be: '/api/payments/billing/receipt', stepUp: true, audit: true, query: { orderId: D(ID) } },
    { method: 'GET', fe: 'paypal/account', be: '/api/payments/paypal/account', stepUp: false },
    { method: 'POST', fe: 'paypal/link/start', be: '/api/payments/paypal/link/start', stepUp: true, body: SCHEMAS.empty, audit: true, timeoutMs: 25_000 },
    // Terminos y precio los usa la pantalla de facturacion del desarrollador desde /developer; no se duplican aqui.
];

export const DEVELOPER_ROUTES: readonly RouteDef[] = [
    { method: 'GET', fe: 'overview', be: '/api/developer/overview', stepUp: false },
    { method: 'GET', fe: 'terms', be: '/api/developer/terms', stepUp: false },
    { method: 'POST', fe: 'terms', be: '/api/developer/terms', stepUp: true, body: SCHEMAS.terms, audit: true },
    { method: 'GET', fe: 'pricing', be: '/api/developer/pricing', stepUp: true, query: { extensionId: D(ID) } },
    { method: 'POST', fe: 'pricing', be: '/api/developer/pricing', stepUp: true, body: SCHEMAS.pricing, audit: true, timeoutMs: 30_000 },
    { method: 'POST', fe: 'validate', be: '/api/developer/validate', stepUp: false, body: SCHEMAS.validate, maxBody: FILES_BODY, timeoutMs: 25_000 },
    { method: 'POST', fe: 'submissions', be: '/api/developer/submissions', stepUp: true, body: SCHEMAS.submission, maxBody: FILES_BODY, audit: true, timeoutMs: 30_000 },
    { method: 'GET', fe: 'submissions/:id', be: '/api/developer/submissions/:id', stepUp: false },
    { method: 'POST', fe: 'submissions/:id/submit', be: '/api/developer/submissions/:id/submit', stepUp: true, body: SCHEMAS.empty, audit: true },
    // Aprobar no publica: el desarrollador publica desde el estado `approved`.
    { method: 'POST', fe: 'submissions/:id/publish', be: '/api/developer/submissions/:id/publish', stepUp: true, body: SCHEMAS.empty, audit: true, timeoutMs: 30_000 },
    { method: 'POST', fe: 'submissions/:id/withdraw', be: '/api/developer/submissions/:id/withdraw', stepUp: true, body: SCHEMAS.empty, audit: true },
    { method: 'POST', fe: 'extensions/:id/test-install', be: '/api/developer/extensions/:id/test-install', stepUp: true, body: SCHEMAS.testInstall, audit: true, timeoutMs: 40_000 },
    { method: 'POST', fe: 'extensions/:id/yank', be: '/api/developer/extensions/:id/yank', stepUp: true, body: SCHEMAS.yank, audit: true },
];

const TABLES: Record<ProxyFamily, readonly RouteDef[]> = { billing: BILLING_ROUTES, developer: DEVELOPER_ROUTES };

export interface RouteMatch { def: RouteDef; params: string[] }

/** Busca la ruta de la tabla. 404 si ningun patron coincide, 405 si el patron existe con otro metodo. Los segmentos `:id` se validan. */
export function matchRoute(family: ProxyFamily, method: string, segments: readonly string[]): RouteMatch {
    let pathMatched = false;
    // Una ruta literal (p. ej. orders/capture) gana siempre a un patron con :id (orders/:id): "capture" nunca es un id.
    const literalExists = TABLES[family].some((d) => d.fe === segments.join('/'));
    for (const def of TABLES[family]) {
        const pattern = def.fe.split('/');
        if (pattern.length !== segments.length) continue;
        if (literalExists && pattern.includes(':id')) continue;
        const params: string[] = [];
        let ok = true;
        for (let i = 0; i < pattern.length; i++) {
            if (pattern[i] === ':id') {
                if (!ID.test(segments[i])) { ok = false; break; }
                params.push(segments[i]);
            } else if (pattern[i] !== segments[i]) { ok = false; break; }
        }
        if (!ok) continue;
        pathMatched = true;
        if (def.method === method) return { def, params };
    }
    throw pathMatched ? new HttpError(405, 'method_not_allowed') : new HttpError(404, 'not_found');
}

/** Query saneada: solo claves permitidas con su patron; cualquier otra cosa es 400 (nunca se reenvia tal cual). */
export function buildQuery(def: RouteDef, search: URLSearchParams): string {
    const out = new URLSearchParams();
    const allowed = def.query ?? {};
    const seen = new Set<string>();
    for (const [k, v] of search.entries()) {
        const re = allowed[k];
        if (!re || seen.has(k) || !re.test(v)) throw new HttpError(400, 'invalid_input', 'Invalid input: query');
        seen.add(k);
        out.set(k, v);
    }
    const s = out.toString();
    return s ? `?${s}` : '';
}

async function readBody(req: Request, def: RouteDef): Promise<string> {
    if (!def.body) return '';
    const max = def.maxBody ?? SMALL_BODY;
    const declared = Number(req.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > max) throw new HttpError(413, 'payload_too_large');
    const type = (req.headers.get('content-type') || '').toLowerCase();
    const text = await req.text().catch(() => '');
    if (text.length > max) throw new HttpError(413, 'payload_too_large');
    if (text && !type.includes('application/json')) throw new HttpError(415, 'unsupported_media_type');
    let raw: unknown;
    try { raw = text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, 'invalid_json'); }
    const parsed = def.body.safeParse(raw);
    if (!parsed.success) {
        const fields = Array.from(new Set(parsed.error.issues.slice(0, 10).map((i) => i.path.map(String).join('.') || '(body)')));
        throw new HttpError(400, 'invalid_input', `Invalid input: ${fields.join(', ')}`);
    }
    return JSON.stringify(parsed.data);
}

const ERROR_CODE = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;

/** Cuerpo de error hacia el navegador: codigo estable del backend (si es valido) + extras acotados. Nunca stacks ni texto libre largo. */
function errorBody(status: number, data: any): { status: number; body: Record<string, unknown> } {
    const code = typeof data?.error === 'string' && ERROR_CODE.test(data.error) ? data.error : typeof data?.code === 'string' && ERROR_CODE.test(data.code) ? data.code : null;
    if (status === 401 || status === 403) {
        return code === 'signature_required'
            ? { status: 403, body: { error: 'signature_required', code: 'signature_required' } }
            : { status: 403, body: { error: 'backend_denied', code: 'backend_denied' } };
    }
    if ([400, 402, 404, 409, 410, 413, 422, 429, 503].includes(status)) {
        const c = code ?? (status === 503 ? 'payments_unavailable' : 'backend_error');
        const extra: Record<string, unknown> = {};
        if (data && typeof data === 'object') {
            for (const [k, v] of Object.entries(data)) {
                if (k === 'error' || k === 'code') continue;
                if (typeof v === 'string' ? v.length <= 500 : typeof v === 'number' || typeof v === 'boolean' || Array.isArray(v) || (v && typeof v === 'object')) extra[k] = v;
            }
        }
        const body = { ...extra, error: c, code: c };
        return JSON.stringify(body).length <= 32 * 1024 ? { status, body } : { status, body: { error: c, code: c } };
    }
    return { status: 502, body: { error: 'backend_error', code: 'backend_error' } };
}

async function readCapped(res: Response): Promise<string> {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_RESPONSE_BYTES) throw new HttpError(502, 'backend_response_too_large');
    return new TextDecoder().decode(buf);
}

const SAFE_FILENAME = /^[A-Za-z0-9._-]{1,80}\.csv$/;

function csvFilename(res: Response, kind: string): string {
    const m = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') || '');
    return m && SAFE_FILENAME.test(m[1]) ? m[1] : `bloomx-${kind}.csv`;
}

export interface ProxyDeps { fetchImpl?: typeof fetch }

/**
 * Atiende una peticion ya autenticada a nivel 4. Orden: ruta/metodo -> modo legado -> step-up -> query/cuerpo -> llamada firmada.
 * (Se valida antes la ruta para no revelar nada a quien llama algo que no existe, y la firma antes del step-up para no pedir
 * reautenticacion en una instancia donde la operacion nunca podra completarse.)
 */
export async function proxyPayments(ctx: AdminCtx, family: ProxyFamily, segments: readonly string[], deps: ProxyDeps = {}): Promise<Response> {
    const { def, params } = matchRoute(family, ctx.req.method, segments);
    if (!hasValidDomainKey()) {
        throw new HttpError(403, 'signature_required', 'Payments and the developer portal require this instance to sign its requests with its domain key (BLOOMX_DOMAIN_PRIVATE_KEY).');
    }
    if (def.stepUp) await assertFreshMfa(ctx);

    const query = buildQuery(def, new URL(ctx.req.url).searchParams);
    const body = await readBody(ctx.req, def);

    let path = def.be;
    for (const p of params) path = path.replace(':id', encodeURIComponent(p));
    const url = `${backendBaseUrl()}${path}${query}`;
    const method = def.method;
    const eventKey = `${family}.${def.fe.replace(/:id/g, '_').replace(/\//g, '.')}`;
    const objectIds: Record<string, string> = {};
    if (params[0]) objectIds.objectId = params[0];
    const qs = new URL(url).searchParams;
    if (qs.get('orderId')) objectIds.orderId = qs.get('orderId')!;
    if (qs.get('kind')) objectIds.kind = qs.get('kind')!;

    let status = 0;
    try {
        let res: Response;
        try {
            res = await (deps.fetchImpl ?? fetch)(url, {
                method,
                headers: {
                    Accept: def.csv ? 'text/csv, application/json' : 'application/json',
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                    ...buildBackendHeaders({ method, url, body, domain: ownHost(ctx.req), userId: ctx.actor.id ?? '', email: ctx.actor.email ?? '' }),
                },
                body: body || undefined,
                cache: 'no-store',
                redirect: 'manual',
                signal: AbortSignal.timeout(def.timeoutMs ?? 15_000),
            });
        } catch (error) {
            const timeout = (error as { name?: string })?.name === 'TimeoutError' || (error as { name?: string })?.name === 'AbortError';
            throw new HttpError(timeout ? 504 : 502, timeout ? 'backend_timeout' : 'backend_unavailable');
        }
        status = res.status;
        const text = await readCapped(res);

        if (res.ok && def.csv) {
            return new Response(text, {
                status: 200,
                headers: {
                    ...NO_STORE,
                    'Content-Type': 'text/csv; charset=utf-8',
                    'Content-Disposition': `attachment; filename="${csvFilename(res, objectIds.kind ?? 'export')}"`,
                    'X-Content-Type-Options': 'nosniff',
                },
            });
        }
        let data: any = null;
        try { data = text ? JSON.parse(text) : {}; } catch { data = null; }
        if (res.ok) {
            if (data === null || typeof data !== 'object') throw new HttpError(502, 'backend_error');
            return json(data, { status: res.status === 201 ? 201 : 200 });
        }
        const e = errorBody(res.status, data);
        return json(e.body, { status: e.status });
    } catch (error) {
        if (error instanceof HttpError) status = status || error.status;
        throw error;
    } finally {
        if (method !== 'GET' || def.audit) audit(ctx, eventKey, { ...objectIds, status, outcome: status >= 200 && status < 300 ? 'ok' : 'failed' });
    }
}
