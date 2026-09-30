import { HttpError, actorKey, adminRoute, audit, badRequest } from '@/lib/admin/http';
import { ListStoreError } from '@/lib/spam/lists-store';
import { apiImportCsv, domainOwner, importBodySchema, kindSchema } from '@/lib/spam/lists-api';
import { MAX_CSV_BYTES } from '@/lib/spam/lists-csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST { csv: "<texto>" } (<= 2 MB, <= 10 000 filas) -> { added, duplicates, invalid, errors: [{ line, error }], limitReached }.
 * parseBody limita a 64 KB; aqui el limite es el del CSV (2 MB + sobre JSON).
 */
export const POST = adminRoute<{ kind: string }>({ scope: 'spam.lists.import', write: true, limit: 10 }, async (ctx, p) => {
    const k = kindSchema.safeParse(p.kind);
    if (!k.success) throw badRequest('invalid_kind');
    const text = await ctx.req.text().catch(() => '');
    if (text.length > MAX_CSV_BYTES * 1.2) throw new HttpError(413, 'payload_too_large');
    let json: unknown;
    try { json = JSON.parse(text); } catch { throw badRequest('invalid_json'); }
    const parsed = importBodySchema.safeParse(json);
    if (!parsed.success) throw badRequest('invalid_input', 'Invalid input: csv');
    try {
        const r = await apiImportCsv(domainOwner(ctx.actor.email || actorKey(ctx.actor, ctx.ip)), k.data, parsed.data.csv);
        audit(ctx, 'spam.list_imported', { kind: k.data, added: r.added, errors: r.errors.length });
        return { ...r };
    } catch (e) {
        if (e instanceof ListStoreError) throw new HttpError(503, 'storage_unavailable');
        throw e;
    }
});
