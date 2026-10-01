import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { auditLog } from '@/lib/security';
import { credentialNamesOf, getProvider, invalidateProviderCache, saveProviderSecret, saveSharedCredential } from './providers';
import { parseServiceAccount } from './principals';

/**
 * ENTREGA de credenciales OAuth desde el backend compartido a ESTA instancia (migracion a GoogleLib): POST /api/internal/host/oauth-config.
 * El backend firma (Ed25519) y lleva el valor DESCIFRADO por TLS; aqui se guarda cifrado con la clave de datos de la instancia y anclado a los
 * hosts de los endpoints vigentes. Es una puerta de UN SOLO USO administrativo, por eso:
 *  - esta CERRADA por defecto: exige OAUTH_ACCEPT_BACKEND_HANDOFF=true en el entorno de la instancia (el admin la abre para la migracion y la cierra);
 *  - firma del backend verificada (verifyBackendRequest), cuerpo estricto, solo credenciales que el manifest del proveedor declara;
 *  - nunca se devuelve ni se registra el valor (la auditoria lleva solo proveedor y NOMBRE de la credencial).
 */
const body = z.strictObject({
    provider: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/),
    credential: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
    value: z.string().min(1).max(16_384),
});

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (b: unknown, status: number) => NextResponse.json(b, { status, headers: NO_STORE });

export interface HandoffDeps {
    verify: (req: NextRequest, raw: string) => Promise<{ ok: true; userId: string | null } | { ok: false; reason: 'unavailable' | 'invalid' }>;
    enabled: () => boolean;
}
export const defaultHandoffDeps: HandoffDeps = {
    verify: async (req, raw) => (await import('@/lib/backend-auth')).verifyBackendRequest(req, raw),
    enabled: () => process.env.OAUTH_ACCEPT_BACKEND_HANDOFF === 'true',
};

export function createHandoffHandler(deps: HandoffDeps = defaultHandoffDeps) {
    return async function POST(req: NextRequest): Promise<Response> {
        if (!deps.enabled()) return json({ error: 'Handoff disabled' }, 403);
        const raw = await req.text();
        if (Buffer.byteLength(raw, 'utf8') > 40_000) return json({ error: 'Payload too large' }, 413);
        const verified = await deps.verify(req, raw);
        if (!verified.ok) return verified.reason === 'unavailable' ? json({ error: 'Backend key unavailable' }, 503) : json({ error: 'Unauthorized' }, 401);
        let parsedBody: unknown = null;
        try { parsedBody = JSON.parse(raw); } catch { parsedBody = null; }
        const parsed = body.safeParse(parsedBody);
        if (!parsed.success) return json({ error: 'Invalid request', code: 'invalid_args' }, 400);
        invalidateProviderCache();
        const provider = await getProvider(parsed.data.provider);
        if (!provider || !credentialNamesOf(provider).includes(parsed.data.credential)) return json({ error: 'Unknown credential', code: 'unknown_credential' }, 409);
        // El handoff NO aprueba hosts: un proveedor no oficial exige antes la aprobacion explicita del admin (POST /api/admin/oauth/providers/<id>/approve).
        if (provider.status === 'pending_approval' || provider.status === 'needs_reapproval') return json({ error: 'Provider not approved', code: 'provider_not_approved' }, 409);
        const { credential, value } = parsed.data;
        if (credential === provider.principals.serviceAccountJson && !parseServiceAccount(value)) return json({ error: 'Invalid service account', code: 'invalid_service_account' }, 400);
        const ok = credential === provider.clientSecretName ? await saveProviderSecret(provider, value.trim(), 'backend-handoff') : await saveSharedCredential(provider, credential, value, 'backend-handoff');
        if (!ok) return json({ error: 'Storage unavailable', code: 'storage_unavailable' }, 503);
        auditLog('oauth.handoff', { provider: provider.id, credential, approvedHosts: provider.endpointHosts });
        return json({ success: true }, 200);
    };
}
