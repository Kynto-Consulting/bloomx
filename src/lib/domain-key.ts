import { parseEd25519PrivateKey } from '@/lib/bloomx-signature';

/** true si esta instancia tiene una BLOOMX_DOMAIN_PRIVATE_KEY Ed25519 VALIDA (puede firmar sus peticiones y emitir executionGrant). */
export function hasValidDomainKey(env: Record<string, string | undefined> = process.env): boolean {
    const raw = env.BLOOMX_DOMAIN_PRIVATE_KEY;
    return !!raw && !!raw.trim() && parseEd25519PrivateKey(raw) !== null;
}
