import { createBridgeHandler } from '@/lib/expansions/host-services/bridge-route';
import { contactsRequest, defaultContactsDeps, handleContacts } from '@/lib/expansions/host-services/contacts';

/** Puente `services.contacts.*` del sandbox de extensiones. Ver src/lib/expansions/host-services/bridge-route.ts. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createBridgeHandler({
    service: 'contacts',
    schema: contactsRequest,
    handle: async (req) => handleContacts(await defaultContactsDeps(), req),
});
