import { adminRoute } from '@/lib/admin/http';
import { getOverview } from '@/lib/admin/overview-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/overview -> tarjetas del Resumen (solo agregados y metadatos; ver overview-store.ts). */
export const GET = adminRoute({ scope: 'overview', limit: 60 }, async () => ({ ...(await getOverview()) } as Record<string, unknown>));
