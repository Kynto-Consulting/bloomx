import { createBridgeHandler } from '@/lib/expansions/host-services/bridge-route';
import { defaultUsersDeps, handleUsers, usersRequest } from '@/lib/expansions/host-services/users';

/** Puente `services.users.*` (solo lectura, permiso READ_USERS) del sandbox de extensiones. Ver host-services/users.ts. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createBridgeHandler({
    service: 'users',
    schema: usersRequest,
    handle: async (req, ctx) => handleUsers(await defaultUsersDeps(), req, ctx),
});
