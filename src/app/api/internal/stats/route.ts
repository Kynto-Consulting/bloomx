import { createBridgeHandler } from '@/lib/expansions/host-services/bridge-route';
import { defaultStatsDeps, handleStats, statsRequest } from '@/lib/expansions/host-services/stats';

/** Puente `services.stats.*` (solo lectura, permiso READ_STATS, solo administradores) del sandbox de extensiones. Ver host-services/stats.ts. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createBridgeHandler({
    service: 'stats',
    schema: statsRequest,
    handle: async (req, ctx) => handleStats(await defaultStatsDeps(), req, ctx),
});
