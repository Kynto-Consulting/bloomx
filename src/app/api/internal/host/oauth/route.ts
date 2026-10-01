import { createBridgeHandler, defaultBridgeDeps } from '@/lib/expansions/host-services/bridge-route';
import { handleOAuthBridge, oauthBridgeRequest } from '@/lib/oauth/broker';

/**
 * Intermediario OAuth `services.oauth.*` / `ctx.libs.<proveedor>` del sandbox de extensiones (backend compartido -> instancia).
 * Firma Ed25519 del backend, usuario y extension fijados por el host, cuerpo estricto y TOKENS que jamas salen del nucleo. Ver src/lib/oauth/broker.ts.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createBridgeHandler({
    service: 'oauth',
    schema: oauthBridgeRequest,
    limitPerMinute: 300,
    maxBodyBytes: 1_300_000,
    handle: async (req) => handleOAuthBridge({ rateLimit: defaultBridgeDeps.rateLimit }, req),
});
