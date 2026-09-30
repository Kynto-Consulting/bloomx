import { HttpError, badRequest, parseBody, parseQuery } from '@/lib/admin/http';
import { csvResponse } from '@/lib/admin/csv';
import { auditLog } from '@/lib/security';
import { ListStoreError } from '@/lib/spam/lists-store';
import { addBodySchema, apiAdd, apiDelete, apiExportCsv, apiList, deleteBodySchema, kindSchema, listQuerySchema, userOwner } from '@/lib/spam/lists-api';
import { userRoute } from '@/lib/spam/user-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type P = { kind: string };
const kindOf = (p: P) => { const k = kindSchema.safeParse(p.kind); if (!k.success) throw badRequest('invalid_kind'); return k.data; };

/** Listas PERSONALES del usuario de la sesion (block | allow | external). `?format=csv` las exporta. El propietario sale de la sesion. */
export const GET = userRoute<P>({ scope: 'lists.read' }, async ({ req, user }, p) => {
    const kind = kindOf(p);
    if (new URL(req.url).searchParams.get('format') === 'csv') return csvResponse(await apiExportCsv(userOwner(user.id), kind), `mis-${kind}.csv`);
    return { ...(await apiList(userOwner(user.id), kind, parseQuery(req, listQuerySchema))) };
});

export const POST = userRoute<P>({ scope: 'lists.write', write: true, limit: 60 }, async ({ req, user }, p) => {
    const kind = kindOf(p);
    const body = await parseBody(req, addBodySchema);
    try {
        const r = await apiAdd(userOwner(user.id), kind, body);
        auditLog('spam.user_list_added', { userId: user.id, kind, added: r.added });
        return { ...r };
    } catch (e) {
        if (e instanceof ListStoreError) throw new HttpError(503, 'storage_unavailable');
        throw e;
    }
});

export const DELETE = userRoute<P>({ scope: 'lists.write', write: true, limit: 60 }, async ({ req, user }, p) => {
    const kind = kindOf(p);
    const body = await parseBody(req, deleteBodySchema);
    const r = await apiDelete(userOwner(user.id), kind, body);
    auditLog('spam.user_list_removed', { userId: user.id, kind, deleted: r.deleted });
    return { ...r };
});
