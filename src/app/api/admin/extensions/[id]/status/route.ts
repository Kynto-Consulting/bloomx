import { adminRoute, badRequest } from '@/lib/admin/http';
import { getExtensionStatus } from '@/lib/admin/extensions-status';
import { extensionId } from '@/lib/admin/extensions-schemas';

/**
 * GET /api/admin/extensions/[id]/status -> { extensionId, lastEvent, lastError, errors24h, entries (max. 20, resumidas) }
 * Sale de la auditoria del frontend (`AuditEvent`): el backend no guarda logs de ejecucion. Solo evento, fecha, resultado y
 * estado HTTP; sin valores ni nombres de credenciales. Sin registros => todo vacio/0.
 */
export const GET = adminRoute<{ id: string }>({ scope: 'extensions.status' }, async (_ctx, { id }) => {
    const parsed = extensionId.safeParse(id);
    if (!parsed.success) throw badRequest('invalid_input');
    return { extensionId: parsed.data, ...(await getExtensionStatus(parsed.data, 24)) };
});
