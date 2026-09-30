import { adminRoute, audit, HttpError, parseBody } from '@/lib/admin/http';
import { assertInstanceDomain } from '@/lib/admin/extensions-instance';
import { backendError, managerFetch } from '@/lib/admin/extensions-proxy';
import { mandatoryBody } from '@/lib/admin/extensions-schemas';

/**
 * POST { domainId, extensionId, mandatory } -> { success: true, mandatory, effective }
 * Politica "obligatoria para todos": ningun usuario del dominio puede desactivarla y el backend ejecuta siempre sus hooks de
 * servidor (DLP, seguridad). Solo administradores (adminRoute) con sesion de gestor del dominio; el backend comprueba ademas que el
 * manager es dueno del dominio. `effective` sigue en true si el propio manifest la declara obligatoria. Audita
 * `extension.mandatory_changed`.
 */
export const POST = adminRoute({ scope: 'extensions.mandatory', write: true }, async (ctx) => {
    const body = await parseBody(ctx.req, mandatoryBody);
    await assertInstanceDomain(body.domainId, ctx.req);
    const result = await managerFetch(ctx.req, '/api/manager/extensions/mandatory', {
        body: { domainId: body.domainId, extensionId: body.extensionId, mandatory: body.mandatory },
    });
    const ok = result.status >= 200 && result.status < 300 && result.data?.success === true;
    audit(ctx, 'extension.mandatory_changed', {
        domainId: body.domainId,
        extensionId: body.extensionId,
        mandatory: body.mandatory,
        outcome: ok ? 'ok' : 'failed',
        status: result.status,
    });
    if (!ok) {
        // 409: la extension esta desactivada; se traduce a un codigo estable (no se reenvia el texto del backend).
        if (result.status === 409) throw new HttpError(409, 'EXTENSION_NOT_ENABLED');
        throw backendError(result);
    }
    return { success: true, mandatory: result.data.mandatory === true, effective: result.data.effective === true };
});
