import { adminRoute, audit, parseBody } from '@/lib/admin/http';
import { assertInstanceDomain } from '@/lib/admin/extensions-instance';
import { backendError, managerFetch } from '@/lib/admin/extensions-proxy';
import { installVersionBody } from '@/lib/admin/extensions-schemas';
import { assertAiAllowsEnable } from '@/lib/admin/extensions-ai';

/**
 * POST { domainId, extensionId } -> { success: true }
 * Instala (o ACTUALIZA: es idempotente, conserva credenciales y ajustes y refresca la version instalada) una extension en el
 * dominio de esta instancia. El backend comprueba sesion de manager, propiedad del dominio y pago (402 PAYMENT_REQUIRED).
 * Solo se reenvian los dos ids y solo se devuelve `success`: nunca la fila de instalacion (podria llevar authData).
 */
export const POST = adminRoute({ scope: 'extensions.install', write: true }, async (ctx) => {
    const body = await parseBody(ctx.req, installVersionBody);
    await assertInstanceDomain(body.domainId, ctx.req);
    await assertAiAllowsEnable(body.extensionId);
    const result = await managerFetch(ctx.req, '/api/manager/extensions/install', { body: { domainId: body.domainId, extensionId: body.extensionId, ...(body.version ? { version: body.version } : {}) } });
    const ok = result.status >= 200 && result.status < 300 && result.data?.success === true;
    audit(ctx, 'extension.install', { domainId: body.domainId, extensionId: body.extensionId, outcome: ok ? 'ok' : 'failed', status: result.status });
    if (!ok) throw backendError(result, 'extension_not_found');
    return { success: true };
});
