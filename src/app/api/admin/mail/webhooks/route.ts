import { adminRoute } from '@/lib/admin/http';
import { getWebhookStatus } from '@/lib/admin/mail-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/mail/webhooks -> estado de los webhooks de Resend. Solo booleanos, rutas y fechas: JAMAS los secretos.
 * La firma es OPCIONAL por diseno (sin secreto se aceptan eventos sin firmar); no es un error.
 */
export const GET = adminRoute({ scope: 'mail.webhooks', limit: 60 }, async () => ({ ...(await getWebhookStatus()) }));
