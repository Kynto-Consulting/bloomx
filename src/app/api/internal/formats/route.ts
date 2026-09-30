import { createBridgeHandler } from '@/lib/expansions/host-services/bridge-route';
import { defaultFormatsDeps, formatsRequest, handleFormats } from '@/lib/expansions/host-services/formats';

/** Puente `services.formats.*` (solo renderTemplate y sanitizeHtml; el resto son operaciones locales del backend). */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createBridgeHandler({
    service: 'formats',
    schema: formatsRequest,
    handle: async (req) => handleFormats(defaultFormatsDeps, req),
});
