import { adminRoute, audit, badRequest, parseBody } from '@/lib/admin/http';
import { assertInstanceDomain } from '@/lib/admin/extensions-instance';
import { backendError, managerFetch } from '@/lib/admin/extensions-proxy';
import { orderBody } from '@/lib/admin/extensions-schemas';

/**
 * POST { domainId, items: [{ extensionId, order }] } -> { success: true, updated }
 * Guarda el orden de paneles/botones en `settings.ui.order` (se expone en /api/config). Audita `extension.reordered`.
 */
export const POST = adminRoute({ scope: 'extensions.order', write: true }, async (ctx) => {
    const body = await parseBody(ctx.req, orderBody);
    if (new Set(body.items.map((i) => i.extensionId)).size !== body.items.length) throw badRequest('duplicate_items');
    await assertInstanceDomain(body.domainId, ctx.req);
    const result = await managerFetch(ctx.req, '/api/manager/extensions/order', { body: { domainId: body.domainId, items: body.items } });
    const ok = result.status >= 200 && result.status < 300 && result.data?.success === true;
    audit(ctx, 'extension.reordered', { domainId: body.domainId, count: body.items.length, outcome: ok ? 'ok' : 'failed', status: result.status });
    if (!ok) throw backendError(result);
    return { success: true, updated: Number.isInteger(result.data.updated) ? result.data.updated : body.items.length };
});
