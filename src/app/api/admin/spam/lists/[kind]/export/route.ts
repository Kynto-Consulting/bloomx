import { actorKey, adminRoute, audit, badRequest } from '@/lib/admin/http';
import { csvResponse } from '@/lib/admin/csv';
import { apiExportCsv, domainOwner, kindSchema } from '@/lib/spam/lists-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = adminRoute<{ kind: string }>({ scope: 'spam.lists.export', limit: 20 }, async (ctx, p) => {
    const k = kindSchema.safeParse(p.kind);
    if (!k.success) throw badRequest('invalid_kind');
    const csv = await apiExportCsv(domainOwner(ctx.actor.email || actorKey(ctx.actor, ctx.ip)), k.data);
    audit(ctx, 'spam.list_exported', { kind: k.data });
    return csvResponse(csv.replace(/\r\n$/, '\r\n'), `spam-${k.data}-${new Date().toISOString().slice(0, 10)}.csv`);
});
