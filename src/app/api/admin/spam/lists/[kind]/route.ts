import { actorKey, adminRoute, audit, badRequest, parseBody, parseQuery } from '@/lib/admin/http';
import { ListStoreError } from '@/lib/spam/lists-store';
import { addBodySchema, apiAdd, apiDelete, apiList, deleteBodySchema, domainOwner, kindSchema, listQuerySchema } from '@/lib/spam/lists-api';
import { HttpError } from '@/lib/admin/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type P = { kind: string };
const kindOf = (p: P) => { const k = kindSchema.safeParse(p.kind); if (!k.success) throw badRequest('invalid_kind'); return k.data; };

/** GET ?q&matchType&status&sort&page&pageSize -> { rows, total, limit }. kind: block | allow | external (dominio). */
export const GET = adminRoute<P>({ scope: 'spam.lists.read', limit: 120 }, async (ctx, p) => {
    return { ...(await apiList(domainOwner(ctx.actor.email || actorKey(ctx.actor, ctx.ip)), kindOf(p), parseQuery(ctx.req, listQuerySchema))) };
});

/** POST { entries: [{ matchType, value, includeSubdomains?, reason?, expiresAt? }] } -> { added, duplicates, invalid[], limitReached }. */
export const POST = adminRoute<P>({ scope: 'spam.lists.write', write: true, limit: 60 }, async (ctx, p) => {
    const kind = kindOf(p);
    const body = await parseBody(ctx.req, addBodySchema);
    try {
        const r = await apiAdd(domainOwner(ctx.actor.email || actorKey(ctx.actor, ctx.ip)), kind, body);
        audit(ctx, 'spam.list_added', { kind, added: r.added, invalid: r.invalid.length });
        return { ...r };
    } catch (e) {
        if (e instanceof ListStoreError) throw new HttpError(503, 'storage_unavailable');
        throw e;
    }
});

/** DELETE { ids: [...] } o { all: true, confirm: true }. Solo toca la lista del dominio. */
export const DELETE = adminRoute<P>({ scope: 'spam.lists.write', write: true, limit: 60 }, async (ctx, p) => {
    const kind = kindOf(p);
    const body = await parseBody(ctx.req, deleteBodySchema);
    const r = await apiDelete(domainOwner(ctx.actor.email || actorKey(ctx.actor, ctx.ip)), kind, body);
    audit(ctx, 'spam.list_removed', { kind, deleted: r.deleted, all: 'all' in body });
    return { ...r };
});
