import { adminRoute } from '@/lib/admin/http';
import { getStorageOverview } from '@/lib/admin/retention-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET -> agregados de almacenamiento (bytes y conteos, correos por carpeta, top 10 usuarios) y lo que se borraria hoy. Nunca contenido. */
export const GET = adminRoute({ scope: 'retention.storage', limit: 20 }, async () => ({ ...(await getStorageOverview()) }));
