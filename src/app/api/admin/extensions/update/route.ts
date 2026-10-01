import { adminRoute, audit, parseBody } from '@/lib/admin/http';
import { assertInstanceDomain } from '@/lib/admin/extensions-instance';
import { backendError, managerFetch } from '@/lib/admin/extensions-proxy';
import { updateBody } from '@/lib/admin/extensions-schemas';

/**
 * POST { domainId, extensionId } -> { success: true, updated, from, to }
 * ACTUALIZA una extension ya instalada a la version publicada en el catalogo: el backend (`/api/manager/extensions/update`) valida la
 * plantilla del catalogo en modo estricto, conserva credenciales, ajustes y estado, y fija la version instalada. Comprueba sesion de
 * manager y propiedad del dominio. Aqui solo se reenvian los dos ids y solo se devuelven versiones (nunca la fila de instalacion).
 */
export const POST = adminRoute({ scope: 'extensions.update', write: true }, async (ctx) => {
    const body = await parseBody(ctx.req, updateBody);
    await assertInstanceDomain(body.domainId, ctx.req);
    const result = await managerFetch(ctx.req, '/api/manager/extensions/update', { body: { domainId: body.domainId, extensionId: body.extensionId, ...(body.approvePublicRoutes ? { approvePublicRoutes: true } : {}) } });
    const ok = result.status >= 200 && result.status < 300 && result.data?.success === true;
    const version = (value: unknown) => (typeof value === 'string' && value.length <= 40 ? value : null);
    audit(ctx, 'extension.update', { domainId: body.domainId, extensionId: body.extensionId, outcome: ok ? 'ok' : 'failed', status: result.status, from: version(result.data?.from), to: version(result.data?.to) });
    if (!ok) throw backendError(result);
    return { success: true, updated: result.data?.updated === true, from: version(result.data?.from), to: version(result.data?.to) };
});
