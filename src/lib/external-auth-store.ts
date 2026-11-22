import { execute, query } from '@/lib/admin/sql';
import { CODE_TTL_SECONDS } from '@/lib/external-auth';

/**
 * Codigos de autorizacion de un solo uso (tabla aditiva "ExternalAuthCode", DDL en lib/db/schema.ts). Solo se guarda el hash.
 * No usa `tolerant`: si la tabla falta el flujo falla cerrado (error del servidor) en lugar de emitir codigos que no se pueden invalidar.
 */

export interface StoredCode {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    userId: string;
}

export interface ExternalAuthCodeStore {
    put(codeHash: string, record: StoredCode, ttlSeconds?: number): Promise<void>;
    /** Borra y devuelve el codigo en una sola sentencia: se redime una vez, aunque falle la verificacion posterior. */
    consume(codeHash: string): Promise<StoredCode | null>;
}

export const sqlCodeStore: ExternalAuthCodeStore = {
    async put(codeHash, r, ttl = CODE_TTL_SECONDS) {
        await execute('DELETE FROM "ExternalAuthCode" WHERE "expiresAt" < NOW()');
        await execute(
            'INSERT INTO "ExternalAuthCode" ("codeHash","clientId","redirectUri","codeChallenge","userId","expiresAt") VALUES ($1,$2,$3,$4,$5, NOW() + ($6 || \' seconds\')::interval)',
            codeHash, r.clientId, r.redirectUri, r.codeChallenge, r.userId, String(ttl),
        );
    },
    async consume(codeHash) {
        const rows = await query<{ clientId: string; redirectUri: string; codeChallenge: string; userId: string }>(
            'DELETE FROM "ExternalAuthCode" WHERE "codeHash" = $1 AND "expiresAt" > NOW() RETURNING "clientId","redirectUri","codeChallenge","userId"',
            codeHash,
        );
        return rows[0] ?? null;
    },
};

export function createMemoryCodeStore(now: () => number = Date.now): ExternalAuthCodeStore {
    const map = new Map<string, StoredCode & { exp: number }>();
    return {
        async put(codeHash, r, ttl = CODE_TTL_SECONDS) {
            map.set(codeHash, { ...r, exp: now() + ttl * 1000 });
        },
        async consume(codeHash) {
            const r = map.get(codeHash);
            map.delete(codeHash);
            return r && r.exp > now() ? { clientId: r.clientId, redirectUri: r.redirectUri, codeChallenge: r.codeChallenge, userId: r.userId } : null;
        },
    };
}

let store: ExternalAuthCodeStore = sqlCodeStore;
export const getCodeStore = (): ExternalAuthCodeStore => store;
export function __setCodeStore(next: ExternalAuthCodeStore | null): void {
    store = next ?? sqlCodeStore;
}
