import { adminRoute, parseQuery } from '@/lib/admin/http';
import { assertInstanceDomain } from '@/lib/admin/extensions-instance';
import { backendError, isManagerDenied, managerFetch } from '@/lib/admin/extensions-proxy';
import { installedQuery } from '@/lib/admin/extensions-schemas';
import { shapeInstalled } from '@/lib/admin/extensions-shape';
import { extensionIdsWithErrors } from '@/lib/admin/extensions-status';
import { testConnectionSupport } from '@/lib/admin/extensions-test';
import { loadAiStateDto } from '@/lib/admin/extensions-ai';

/**
 * GET ?domainId= -> {
 *   managerSessionRequired: boolean,          // true: el admin no tiene sesion de gestor del dominio => pantalla de SOLO LECTURA
 *   extensions: InstalledExtension[],         // instaladas (activadas y desactivadas), sin secretos
 *   errorExtensionIds: string[],              // con errores en las ultimas 24 h (auditoria)
 *   capabilities: { test, testReason? },      // si "Probar conexion" puede ejecutarse en esta instancia
 * }
 * El backend (`GET /api/manager/extensions`) exige sesion de manager dueno del dominio: a los admins de tipo "user"
 * (ADMIN_EMAILS) les responde 401/403 y aqui se traduce a `managerSessionRequired` (no es un error). La respuesta se
 * reconstruye con lista blanca: aunque el backend enviara authData/credenciales/settings, no llegan al navegador.
 */
export const GET = adminRoute({ scope: 'extensions.installed' }, async (ctx) => {
    const { domainId } = parseQuery(ctx.req, installedQuery);
    await assertInstanceDomain(domainId, ctx.req);

    const [result, errorExtensionIds] = await Promise.all([
        managerFetch(ctx.req, `/api/manager/extensions?domainId=${encodeURIComponent(domainId)}`),
        extensionIdsWithErrors(24),
    ]);
    const ai = await loadAiStateDto();
    const support = testConnectionSupport(ctx.actor);
    const capabilities = support.supported ? { test: true } : { test: false, testReason: support.reason };

    if (isManagerDenied(result.status)) {
        return { managerSessionRequired: true, extensions: [], errorExtensionIds, capabilities, ai };
    }
    if (result.status < 200 || result.status >= 300) throw backendError(result);
    return { managerSessionRequired: false, extensions: shapeInstalled(result.data), errorExtensionIds, capabilities, ai };
});
