import { z } from 'zod';

/** Esquemas de entrada compartidos por las rutas /api/admin/extensions/** (ids acotados, sin campos extra reenviados). */
export const extensionId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);
export const domainId = z.string().min(1).max(200);

export const installBody = z.object({ domainId, extensionId });
export const toggleBody = z.object({ domainId, extensionId, enabled: z.boolean() });
export const mandatoryBody = z.object({ domainId, extensionId, mandatory: z.boolean() });
export const orderBody = z.object({
    domainId,
    items: z.array(z.object({ extensionId, order: z.number().int().min(0).max(100_000) })).min(1).max(100),
});
export const testBody = z.object({ extensionId });
export const installedQuery = z.object({ domainId });
