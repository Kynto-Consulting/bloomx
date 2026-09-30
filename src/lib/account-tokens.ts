import type { PrismaClient } from '@prisma/client';
import { encrypt, isEncrypted, needsReencrypt, tryDecrypt } from './encryption';

// Cifrado en reposo de los tokens OAuth de "Account" (access_token, refresh_token, id_token).
// NIST 800-53 SC-28 / SC-12, CIS v8 3.11, ISO 27001:2022 A.8.24.
//
// Se implementa como extension de Prisma sobre el modelo Account ("capa de acceso"): ningun consumidor cambia.
//  - ESCRITURA: create/createMany/update/updateMany/upsert cifran los tres campos (encryption.ts, AES-256-GCM v3).
//  - LECTURA: todas las lecturas devuelven texto plano. Si el valor esta cifrado se descifra; si esta en texto plano
//    (filas anteriores a este cambio) se devuelve tal cual y se re-cifra de forma PEREZOSA en segundo plano
//    (ACCOUNT_TOKENS_LAZY_MIGRATE=false lo desactiva). Un token cifrado que no se pueda descifrar (clave incorrecta)
//    se devuelve como null, lo que los consumidores ya tratan como "cuenta no vinculada / reconectar".
//  - Limitacion: solo aplica a consultas sobre `prisma.account`. Un `prisma.user.findMany({ include: { accounts: true } })`
//    devolveria los campos tal como estan en BD (cifrados). Ningun consumidor actual lo hace.
// Migracion masiva opcional: scripts/encrypt-account-tokens.ts.

export const ACCOUNT_TOKEN_FIELDS = ['access_token', 'refresh_token', 'id_token'] as const;
type Field = (typeof ACCOUNT_TOKEN_FIELDS)[number];

function encryptValue(v: unknown): unknown {
    if (typeof v === 'string') return v && !isEncrypted(v) ? encrypt(v) : v;
    // Prisma admite { set: "valor" } en updates
    if (v && typeof v === 'object' && 'set' in (v as any)) {
        return { ...(v as any), set: encryptValue((v as any).set) };
    }
    return v;
}

/** Cifra los campos de token de un objeto `data` de escritura (no muta el original). */
export function encryptAccountData<T extends Record<string, any> | null | undefined>(data: T): T {
    if (!data || typeof data !== 'object') return data;
    const out: any = { ...data };
    for (const f of ACCOUNT_TOKEN_FIELDS) if (f in out) out[f] = encryptValue(out[f]);
    return out;
}

/** Descifra los campos de token de un registro leido (no muta el original). */
export function decryptAccountRecord<T>(rec: T): T {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return rec;
    const out: any = { ...(rec as any) };
    for (const f of ACCOUNT_TOKEN_FIELDS) {
        const v = out[f];
        if (typeof v === 'string' && v) {
            const plain = tryDecrypt(v);
            out[f] = plain === null ? null : plain;
        }
    }
    return out;
}

/** True si algun token del registro leido (ya en BD) esta en texto plano / formato o clave antiguos. */
export function accountRecordNeedsMigration(raw: Record<string, any> | null | undefined): boolean {
    if (!raw) return false;
    return ACCOUNT_TOKEN_FIELDS.some((f) => typeof raw[f] === 'string' && raw[f] && needsReencrypt(raw[f]));
}

const READ_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany']);
const RESULT_OPS = new Set(['create', 'update', 'upsert', 'delete']);

export function withAccountTokenEncryption(base: PrismaClient) {
    const inflight = new Set<string>();

    const migrateLater = (raw: any) => {
        if (process.env.ACCOUNT_TOKENS_LAZY_MIGRATE === 'false') return;
        if (!raw?.id || inflight.has(raw.id) || !accountRecordNeedsMigration(raw)) return;
        inflight.add(raw.id);
        const data: Partial<Record<Field, string>> = {};
        for (const f of ACCOUNT_TOKEN_FIELDS) {
            const v = raw[f];
            if (typeof v === 'string' && v && needsReencrypt(v)) {
                const plain = tryDecrypt(v);
                if (plain !== null && plain !== '') data[f] = encrypt(plain);
            }
        }
        if (Object.keys(data).length === 0) {
            inflight.delete(raw.id);
            return;
        }
        // Cliente BASE (sin extension): escribe ya cifrado sin re-entrar en la extension
        void base.account
            .update({ where: { id: raw.id }, data })
            .catch(() => undefined)
            .finally(() => inflight.delete(raw.id));
    };

    return base.$extends({
        name: 'account-token-encryption',
        query: {
            account: {
                async $allOperations({ operation, args, query }: any) {
                    const a: any = args ? { ...args } : args;
                    if (a) {
                        if (operation === 'create' || operation === 'update' || operation === 'updateMany') {
                            a.data = encryptAccountData(a.data);
                        } else if (operation === 'createMany') {
                            a.data = Array.isArray(a.data) ? a.data.map(encryptAccountData) : encryptAccountData(a.data);
                        } else if (operation === 'upsert') {
                            a.create = encryptAccountData(a.create);
                            a.update = encryptAccountData(a.update);
                        }
                    }

                    const result = await query(a);

                    if (READ_OPS.has(operation)) {
                        const rows = Array.isArray(result) ? result : [result];
                        for (const r of rows) migrateLater(r);
                        return Array.isArray(result) ? result.map(decryptAccountRecord) : decryptAccountRecord(result);
                    }
                    if (RESULT_OPS.has(operation)) return decryptAccountRecord(result);
                    return result; // count, aggregate, groupBy, createMany, updateMany, deleteMany...
                },
            },
        },
    });
}
