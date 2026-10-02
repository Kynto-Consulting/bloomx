import { createBridgeHandler } from '@/lib/expansions/host-services/bridge-route';
import { defaultStorageStore, handleStorage, storageRequest } from '@/lib/expansions/host-services/storage';

/** Puente `services.storage.*` del sandbox de extensiones. Ver src/lib/expansions/host-services/bridge-route.ts. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createBridgeHandler({
    service: 'storage',
    schema: storageRequest,
    limitPerMinute: 600,
    handle: async (req, ctx) => handleStorage(await defaultStorageStore(), req, ctx),
});
