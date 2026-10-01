import { z } from 'zod';

/** Esquemas de entrada compartidos por las rutas /api/admin/extensions/** (ids acotados, sin campos extra reenviados). */
export const extensionId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);
export const domainId = z.string().min(1).max(200);

export const installBody = z.object({ domainId, extensionId });
/** Actualizar puede exigir aprobar PUBLIC_ROUTE si la version nueva la introduce. */
export const updateBody = z.object({ domainId, extensionId, approvePublicRoutes: z.boolean().optional() });
/** Instalar admite fijar una version concreta (el backend responde 404 VERSION_NOT_FOUND si no existe). */
export const installVersionBody = z.object({ domainId, extensionId, version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]{1,40})?$/).optional(), installDependencies: z.boolean().optional(), approvePublicRoutes: z.boolean().optional() });
export const toggleBody = z.object({ domainId, extensionId, enabled: z.boolean(), installDependencies: z.boolean().optional(), dryRun: z.boolean().optional() });
export const uninstallBody = z.object({ domainId, extensionId, dryRun: z.boolean().optional() });
export const mandatoryBody = z.object({ domainId, extensionId, mandatory: z.boolean() });
export const orderBody = z.object({
    domainId,
    items: z.array(z.object({ extensionId, order: z.number().int().min(0).max(100_000) })).min(1).max(100),
});
export const testBody = z.object({ extensionId });
export const installedQuery = z.object({ domainId });
