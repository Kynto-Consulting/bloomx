import { adminRoute, audit, parseBody } from '@/lib/admin/http';
import { assertInstanceDomain } from '@/lib/admin/extensions-instance';
import { backendError, managerFetch } from '@/lib/admin/extensions-proxy';
import { toggleBody } from '@/lib/admin/extensions-schemas';
import { assertAiAllowsEnable } from '@/lib/admin/extensions-ai';

/**
 * POST { domainId, extensionId, enabled } -> { success: true, enabled }
 * Activa o desactiva una extension instalada SIN desinstalarla (no borra credenciales ni tokens). Audita `extension.toggled`.
 */
export const POST = adminRoute({ scope: 'extensions.toggle', write: true }, async (ctx) => {
    const body = await parseBody(ctx.req, toggleBody);
    await assertInstanceDomain(body.domainId, ctx.req);
    if (body.enabled) await assertAiAllowsEnable(body.extensionId);
    const result = await managerFetch(ctx.req, '/api/manager/extensions/toggle', {
        body: { domainId: body.domainId, extensionId: body.extensionId, enabled: body.enabled },
    });
    const ok = result.status >= 200 && result.status < 300 && result.data?.success === true;
    audit(ctx, 'extension.toggled', {
        domainId: body.domainId,
        extensionId: body.extensionId,
        enabled: body.enabled,
        outcome: ok ? 'ok' : 'failed',
        status: result.status,
    });
    if (!ok) throw backendError(result);
    return { success: true, enabled: result.data.enabled === true };
});
