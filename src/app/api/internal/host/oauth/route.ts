import { createBridgeHandler, defaultBridgeDeps } from '@/lib/expansions/host-services/bridge-route';
import { handleOAuthBridge, oauthBridgeRequest } from '@/lib/oauth/broker';
import { oauthGrantFor } from '@/lib/exec-grant';

/**
 * Intermediario OAuth `services.oauth.*` / `ctx.libs.<proveedor>` del sandbox de extensiones (backend compartido -> instancia).
 * Concesion de ejecucion firmada por ESTA instancia (los grupos de scopes y el acceso compartido los deriva la instancia de la concesion; lo que diga el cuerpo se ignora),
 * usuario y extension fijados por el host, cuerpo estricto y TOKENS que jamas salen del nucleo. Ver src/lib/oauth/broker.ts.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createBridgeHandler({
    service: 'oauth',
    schema: oauthBridgeRequest,
    limitPerMinute: 300,
    maxBodyBytes: 1_300_000,
    handle: async (req, ctx) => {
        // Con concesion: la INSTANCIA decide los permisos (no el cuerpo reenviado por el backend). Sin concesion: camino legado (cuerpo firmado por el backend).
        if (ctx.grant) {
            const g = oauthGrantFor(ctx.grant, req.args.provider);
            req = { ...req, grantedGroups: g.groups, sharedAllowed: g.shared } as typeof req;
        }
        return handleOAuthBridge({ rateLimit: defaultBridgeDeps.rateLimit }, req);
    },
});
