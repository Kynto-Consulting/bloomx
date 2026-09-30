/**
 * Cabeceras del correo que el motor de reglas puede consultar. SOLO nombres de la lista blanca, valores acotados
 * (300 caracteres) y el conjunto completo <= 4 KB. Se guardan en Email.hdrs (JSONB aditivo) por SQL best-effort:
 * si la columna aun no existe, la ingesta no falla.
 */
import { prisma } from '@/lib/prisma';
import { HEADER_WHITELIST, HEADER_VALUE_MAX, HDRS_MAX_BYTES } from './conditions';

const ALLOWED = new Set<string>(HEADER_WHITELIST);

const toStr = (v: unknown): string => {
    if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean).join(', ');
    if (v === null || v === undefined) return '';
    return typeof v === 'object' ? '' : String(v).trim();
};

/** Extrae de un mapa de cabeceras (cualquier capitalizacion; valores string o array) solo las de la lista blanca. */
export function pickHeaders(raw: Record<string, unknown> | null | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    let bytes = 2;
    for (const [k, v] of Object.entries(raw ?? {})) {
        const key = String(k || '').trim().toLowerCase().replace(/_/g, '-');
        if (!ALLOWED.has(key) || key in out) continue;
        const val = toStr(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').slice(0, HEADER_VALUE_MAX);
        if (!val) continue;
        const add = Buffer.byteLength(key) + Buffer.byteLength(val) + 6;
        if (bytes + add > HDRS_MAX_BYTES) continue;
        bytes += add;
        out[key] = val;
    }
    return out;
}

/** Guarda las cabeceras (best effort: nunca lanza). Un objeto vacio se guarda como {} = "conocidas y sin ninguna". */
export async function saveEmailHdrs(emailId: string, hdrs: Record<string, string>): Promise<boolean> {
    try {
        await prisma.$executeRawUnsafe(`UPDATE "Email" SET "hdrs" = $1::jsonb WHERE "id" = $2`, JSON.stringify(hdrs), emailId);
        return true;
    } catch (e) {
        if (!/42703|does not exist/i.test(`${(e as any)?.code ?? ''} ${(e as any)?.message ?? ''}`)) {
            console.error('[rules] saveEmailHdrs failed:', (e as any)?.message);
        }
        return false;
    }
}
