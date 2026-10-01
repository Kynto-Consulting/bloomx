import type { KeyObject } from 'node:crypto';
import { parseEd25519PublicKey, sha256Hex, verifyCanonical } from '@/lib/bloomx-signature';

/**
 * Confianza en el REGISTRO de proveedores (respuesta de {backend}/api/config):
 *  - la URL del backend debe ser https en produccion (http solo en localhost / desarrollo);
 *  - si hay BLOOMX_BACKEND_PUBLIC_KEY (clave fijada) la respuesta DEBE traer X-BloomX-Config-Sig valida (Ed25519 sobre dominio, hora y hash del
 *    cuerpo, ventana de 5 min): si no, el registro se descarta (solo el proveedor integrado);
 *  - sin clave fijada el registro se acepta pero queda marcado `unverified`: los proveedores no integrados igualmente exigen aprobacion del admin.
 */
export type RegistryTrust = 'verified' | 'unverified' | 'rejected';
export const CONFIG_SIG_WINDOW_S = 300;

export function isSafeBackendUrl(url: string, env: Record<string, string | undefined> = process.env): boolean {
    let u: URL;
    try { u = new URL(url); } catch { return false; }
    if (u.protocol === 'https:') return true;
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
    return u.protocol === 'http:' && (env.NODE_ENV !== 'production' || local);
}

export function verifyConfigSignature(input: { domain: string; body: string; header: string | null; publicKey: KeyObject; now?: number }): boolean {
    const m = /^(\d{9,12})\.([A-Za-z0-9_-]{80,100})$/.exec(input.header ?? '');
    if (!m) return false;
    const ts = Number(m[1]);
    const now = Math.floor((input.now ?? Date.now()) / 1000);
    if (Math.abs(now - ts) > CONFIG_SIG_WINDOW_S) return false;
    return verifyCanonical(input.publicKey, `BLOOMX-CFG-V1\n${input.domain}\n${ts}\n${sha256Hex(input.body)}`, m[2]);
}

export function pinnedBackendKey(env: Record<string, string | undefined> = process.env): KeyObject | null {
    return env.BLOOMX_BACKEND_PUBLIC_KEY ? parseEd25519PublicKey(env.BLOOMX_BACKEND_PUBLIC_KEY) : null;
}
