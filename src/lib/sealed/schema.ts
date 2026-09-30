/**
 * Validacion (zod) de las peticiones de mensajes sellados en el servidor. El servidor NO puede descifrar nada:
 * solo valida la FORMA del sobre y aplica limites (tamano, TTL, vistas).
 */
import { z } from 'zod';

export const SECURE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const MAX_CIPHERTEXT_CHARS = 1_000_000; // base64url del ciphertext (~750 KB) — coincide con MAX_PLAINTEXT_BYTES del cliente
export const MAX_VIEWS_LIMIT = 100;

const b64u = (min: number, max: number) => z.string().min(min).max(max).regex(/^[A-Za-z0-9_-]+$/);

const envelopeBase = {
    v: z.literal(1),
    alg: z.literal('A256GCM'),
    iv: b64u(16, 16), // 12 bytes
    ct: b64u(22, MAX_CIPHERTEXT_CHARS), // >= 16 bytes de tag
};

export const envelopeSchema = z.union([
    z.strictObject({ ...envelopeBase, pw: z.literal(false) }),
    z.strictObject({
        ...envelopeBase,
        pw: z.literal(true),
        kdf: z.literal('PBKDF2-SHA256'),
        iter: z.number().int().min(100_000).max(2_000_000),
        salt: b64u(22, 22), // 16 bytes
    }),
]);

export const createSealedSchema = z.strictObject({
    v: z.literal(1),
    envelope: envelopeSchema,
    maxViews: z.number().int().min(1).max(MAX_VIEWS_LIMIT).nullable().optional(),
    ttlDays: z.number().int().min(1).max(365).optional(),
});

export type CreateSealedInput = z.infer<typeof createSealedSchema>;

export function configuredTtlDays(): number {
    return Number.parseInt(process.env.SECURE_MESSAGE_TTL_DAYS || '30', 10) || 30;
}

/** El cliente puede pedir un TTL MENOR que el configurado, nunca mayor. */
export function effectiveTtlDays(requested: number | undefined): number {
    const max = configuredTtlDays();
    return requested ? Math.min(requested, max) : max;
}
