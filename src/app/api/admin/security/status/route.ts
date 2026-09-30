import { adminRoute } from '@/lib/admin/http';
import { getSecurityStatus } from '@/lib/admin/security-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET -> comprobaciones de seguridad de la instancia. Solo booleanos y conteos: ningun valor de secreto. */
export const GET = adminRoute({ scope: 'security.status', limit: 60 }, async () => ({ ...(await getSecurityStatus()) }));
