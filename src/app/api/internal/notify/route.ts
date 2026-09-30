import { createBridgeHandler } from '@/lib/expansions/host-services/bridge-route';
import { defaultNotifyDeps, handleNotify, notifyRequest } from '@/lib/expansions/host-services/notify';

/** Puente `services.notify.*` del sandbox de extensiones. Ver src/lib/expansions/host-services/bridge-route.ts. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createBridgeHandler({
    service: 'notify',
    schema: notifyRequest,
    handle: async (req) => handleNotify(await defaultNotifyDeps(), req),
});
