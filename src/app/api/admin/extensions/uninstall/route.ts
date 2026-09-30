import { adminRoute, audit, parseBody } from '@/lib/admin/http';
import { assertInstanceDomain } from '@/lib/admin/extensions-instance';
import { backendError, managerFetch } from '@/lib/admin/extensions-proxy';
import { installBody } from '@/lib/admin/extensions-schemas';

/**
 * POST { domainId, extensionId } -> { success: true }
 * Desinstala: el backend pone enabled:false y BORRA tokens OAuth, credenciales cifradas y claves de ajustes sensibles del
 * dominio (tras intentar revocar los tokens en el proveedor). Aqui queda la traza (`admin.extension.uninstall`).
 */
export const POST = adminRoute({ scope: 'extensions.uninstall', write: true }, async (ctx) => {
    const body = await parseBody(ctx.req, installBody);
    await assertInstanceDomain(body.domainId, ctx.req);
    const result = await managerFetch(ctx.req, '/api/manager/extensions/uninstall', { body: { domainId: body.domainId, extensionId: body.extensionId } });
    const ok = result.status >= 200 && result.status < 300 && result.data?.success === true;
    audit(ctx, 'extension.uninstall', {
        domainId: body.domainId,
        extensionId: body.extensionId,
        outcome: ok ? 'ok' : 'failed',
        status: result.status,
        credentialsWiped: ok,
    });
    if (!ok) throw backendError(result);
    return { success: true };
});
