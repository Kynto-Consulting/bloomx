import type { KeyObject } from 'node:crypto';
import { parseEd25519PublicKey, sha256Hex, verifyCanonical } from '@/lib/bloomx-signature';

/**
 * Integridad del REGISTRO de proveedores (respuesta de {backend}/api/config) SIN ninguna clave global del backend:
 *  - https obligatorio en produccion hacia una URL de backend FIJA por instancia (lib/backend-url.ts) y SIN redirecciones a otros hosts;
 *  - respuesta validada por esquema estricto (validateRegistryResponse);
 *  - los proveedores integrados (google...) los registra solo la extension oficial reservada; los demas exigen la aprobacion del admin (pending_approval).
 *
 * LEGADO DEPRECADO: backends antiguos firmaban /api/config con su clave global (X-BloomX-Config-Sig). Si la instancia tiene BLOOMX_BACKEND_PUBLIC_KEY y
 * BLOOMX_ACCEPT_BACKEND_SIGNATURE no es "false" y llega la cabecera, se verifica (y una firma invalida descarta el registro). No es necesaria.
 */
export const CONFIG_SIG_WINDOW_S = 300;
const MAX_REGISTRY_BYTES = 8 * 1024 * 1024;
const MAX_EXTENSIONS = 300;

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

/** Esquema estricto del registro: { extensions: [{ id, template (objeto o JSON), settings? }] } con tamanos acotados. Devuelve la lista saneada o null. */
export function validateRegistryResponse(data: unknown): Array<{ id: string; template: unknown; settings?: unknown }> | null {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const list = (data as { extensions?: unknown }).extensions;
    if (!Array.isArray(list) || list.length > MAX_EXTENSIONS) return null;
    const out: Array<{ id: string; template: unknown; settings?: unknown }> = [];
    for (const e of list) {
        if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
        const { id, template, settings } = e as Record<string, unknown>;
        if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) return null;
        const okTemplate = (typeof template === 'string' && template.length <= 2_000_000) || (!!template && typeof template === 'object' && !Array.isArray(template));
        if (!okTemplate) return null;
        if (settings !== undefined && settings !== null && (typeof settings !== 'object' || Array.isArray(settings))) return null;
        out.push({ id, template, ...(settings ? { settings } : {}) });
    }
    return out;
}
export { MAX_REGISTRY_BYTES };
