/**
 * router.ts - despacho de /api/admin/mail-transfer/** (administrador) y /api/mail-transfer/** (usuario sobre SU buzon).
 *
 * Un unico enrutador por catch-all: los archivos de ruta de Next solo resuelven el actor y llaman a `dispatch`. Los errores
 * HttpError se traducen a JSON {error, code}; cualquier otro error es 500 generico (el detalle va solo al log). Tablas ausentes
 * (db:ensure sin ejecutar) => 503 `mail_transfer_tables_missing`.
 */
import { after, type NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { HttpError, NO_STORE } from '@/lib/admin/http';
import { getCurrentUser, getSessionCookie } from '@/lib/session';
import { isUserDisabled } from '@/lib/admin/user-state';
import * as H from './handlers';
import { chainNextTick } from './runtime';
import { makeCtx, type HCtx, type TransferActor } from './http';
import { MailTransferTablesMissingError } from './store';

type Handler = (c: HCtx, m: string[]) => Promise<Response | Record<string, unknown>>;
interface Route { method: string; re: RegExp; h: Handler }

const ID = '([^/]+)';
const routes: Route[] = [
    { method: 'GET', re: /^config$/, h: (c) => H.getConfig(c) },
    { method: 'POST', re: /^reauth$/, h: (c) => H.postReauth(c) },
    { method: 'GET', re: /^jobs$/, h: (c) => H.listJobs(c) },
    { method: 'POST', re: /^import$/, h: (c) => H.createImport(c) },
    { method: 'POST', re: /^export$/, h: (c) => H.createExport(c) },
    { method: 'GET', re: /^mailboxes$/, h: (c) => H.listMailboxes(c) },
    { method: 'GET', re: new RegExp(`^jobs/${ID}$`), h: (c, m) => H.getJob(c, m[0]) },
    { method: 'DELETE', re: new RegExp(`^jobs/${ID}$`), h: (c, m) => H.deleteJob(c, m[0]) },
    { method: 'GET', re: new RegExp(`^jobs/${ID}/chunks$`), h: (c, m) => H.getChunks(c, m[0]) },
    { method: 'PUT', re: new RegExp(`^jobs/${ID}/chunks/([0-9]+)$`), h: (c, m) => H.putChunk(c, m[0], m[1]) },
    { method: 'POST', re: new RegExp(`^jobs/${ID}/complete$`), h: (c, m) => H.completeUpload(c, m[0]) },
    { method: 'GET', re: new RegExp(`^jobs/${ID}/preview$`), h: (c, m) => H.getPreview(c, m[0]) },
    { method: 'POST', re: new RegExp(`^jobs/${ID}/mailboxes$`), h: (c, m) => H.createMailboxes(c, m[0]) },
    { method: 'POST', re: new RegExp(`^jobs/${ID}/zip-password$`), h: (c, m) => H.postZipPassword(c, m[0]) },
    { method: 'POST', re: new RegExp(`^jobs/${ID}/confirm$`), h: (c, m) => H.confirmImport(c, m[0]) },
    { method: 'POST', re: new RegExp(`^jobs/${ID}/tick$`), h: (c, m) => H.tickJob(c, m[0]) },
    { method: 'POST', re: new RegExp(`^jobs/${ID}/cancel$`), h: (c, m) => H.cancelJob(c, m[0]) },
    { method: 'POST', re: new RegExp(`^jobs/${ID}/resume$`), h: (c, m) => H.resumeJob(c, m[0]) },
    { method: 'GET', re: new RegExp(`^jobs/${ID}/report$`), h: (c, m) => H.getReport(c, m[0]) },
    { method: 'POST', re: new RegExp(`^jobs/${ID}/download-link$`), h: (c, m) => H.issueDownloadLink(c, m[0]) },
    { method: 'GET', re: new RegExp(`^jobs/${ID}/download$`), h: (c, m) => H.download(c, m[0]) },
];

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => NextResponse.json(data, { status, headers: { ...NO_STORE, ...headers } });

function kickFactory(): (jobId: string) => void {
    return (jobId: string) => {
        const run = () => { void chainNextTick(jobId, 0); };
        try { after(run); } catch { run(); }
    };
}

export async function dispatch(
    req: NextRequest,
    segments: string[] | undefined,
    mode: 'admin' | 'self',
    over: { actor?: TransferActor | null; ctx?: Partial<HCtx> } = {},
): Promise<Response> {
    const apiPrefix = mode === 'admin' ? '/api/admin/mail-transfer' : '/api/mail-transfer';
    let actor: TransferActor | null = over.actor ?? null;
    if (!actor) {
        const r = mode === 'admin' ? await resolveAdminActor(req) : await resolveSelfActor();
        if (r instanceof Response) return r;
        actor = r;
    }
    const path = (segments ?? []).join('/');
    const route = routes.find((r) => r.method === req.method && r.re.test(path));
    if (!route) {
        const other = routes.some((r) => r.re.test(path));
        return json({ error: other ? 'Method Not Allowed' : 'Not Found', code: other ? 'method_not_allowed' : 'not_found' }, other ? 405 : 404);
    }
    const ctx = makeCtx(req, actor, apiPrefix, { kick: kickFactory(), ...(over.ctx ?? {}) });
    try {
        const out = await route.h(ctx, route.re.exec(path)!.slice(1).map(decodeURIComponent));
        return out instanceof Response ? out : json(out);
    } catch (error) {
        if (error instanceof HttpError) {
            return json(
                { error: error.status === 429 ? 'Too many requests' : error.message, code: error.code },
                error.status,
                error.status === 429 ? { 'Retry-After': /^\d+$/.test(error.message) ? error.message : '30' } : {},
            );
        }
        if (error instanceof MailTransferTablesMissingError) return json({ error: 'Service unavailable', code: 'mail_transfer_tables_missing' }, 503);
        const msg = error instanceof Error ? error.message : '';
        if (/does not exist|42P01/i.test(msg) && /MailTransfer/.test(msg)) return json({ error: 'Service unavailable', code: 'mail_transfer_tables_missing' }, 503);
        // Solo el mensaje (nunca el objeto: puede arrastrar parametros SQL o rutas de storage)
        console.error('[MAIL_TRANSFER]', msg.slice(0, 300) || 'error');
        return json({ error: 'Internal Server Error', code: 'internal' }, 500);
    }
}

export async function resolveAdminActor(req: NextRequest): Promise<TransferActor | Response> {
    const guard = await requireAdmin(req);
    if (!guard.ok) return guard.response;
    const a = guard.actor;
    const key = a.id || a.email || 'admin';
    let session: TransferActor['session'] = null;
    let sessionId: string | null = null;
    let localUserId: string | null = a.kind === 'user' ? a.id : null;
    if (a.kind === 'user') {
        const s = await getSessionCookie();
        session = s ? { mfa: s.mfa, at: (s as any).at, iat: s.iat } : null;
        sessionId = typeof s?.jti === 'string' ? s.jti : null;
    }
    return { mode: 'admin', key, kind: a.kind, email: a.email ?? null, selfUserId: null, selfEmail: null, sessionId, session, localUserId };
}

export async function resolveSelfActor(): Promise<TransferActor | Response> {
    const user = await getCurrentUser();
    if (!user) return json({ error: 'Unauthorized', code: 'unauthorized' }, 401);
    if (await isUserDisabled(user.id)) return json({ error: 'Forbidden', code: 'account_disabled' }, 403);
    const s = await getSessionCookie();
    return {
        mode: 'self', key: user.id, kind: 'user', email: user.email, selfUserId: user.id, selfEmail: user.email.toLowerCase(),
        sessionId: typeof s?.jti === 'string' ? s.jti : null,
        session: s ? { mfa: s.mfa, at: (s as any).at, iat: s.iat } : null,
        localUserId: user.id,
    };
}
