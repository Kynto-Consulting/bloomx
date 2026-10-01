import { getDbPool } from '@/lib/db/pool';
import { MISSING_RE } from '@/lib/admin/sql';

/**
 * Persistencia (SQL crudo, aditiva) del flujo OAuth y de la configuracion OAuth propia de la instancia. Tablas "OAuthFlow" y
 * "OAuthProviderConfig" (src/lib/db/schema.ts, `db:ensure`). Si la tabla aun no existe NUNCA rompe el login con Google ya vinculado:
 *  - flujo: `consumeFlow` devuelve 'unavailable' y quien llama degrada al nonce de la cookie cifrada (con aviso en el log);
 *  - configuracion: `getProviderConfig` devuelve null (se usan las variables de entorno heredadas, solo con endpoints oficiales).
 */

export interface FlowRow { stateHash: string; provider: string; userId: string | null; mode: string; expiresAt: Date }
export type ConsumeResult = 'ok' | 'used' | 'unknown' | 'expired' | 'unavailable';

export interface ProviderConfigRow {
    provider: string;
    extensionId: string | null;
    /** Cifrado con la clave de datos de la instancia (lib/encryption.ts). */
    clientSecret: string | null;
    approvedHosts: string[];
    updatedAt: Date;
    updatedBy: string | null;
    /** Credenciales compartidas adicionales { NOMBRE: valor cifrado }. */
    extra: Record<string, string>;
}

export interface OAuthStore {
    insertFlow(flow: FlowRow): Promise<boolean>;
    consumeFlow(stateHash: string): Promise<ConsumeResult>;
    purgeFlows(): Promise<void>;
    getProviderConfig(provider: string): Promise<ProviderConfigRow | null>;
    saveProviderConfig(row: Omit<ProviderConfigRow, 'updatedAt' | 'extra'> & { extra?: Record<string, string> }): Promise<boolean>;
    deleteProviderConfig(provider: string): Promise<boolean>;
}

const missing = (error: unknown) => MISSING_RE.test(String((error as { code?: unknown; message?: unknown } | null)?.code ?? '') + ' ' + String((error as { message?: unknown } | null)?.message ?? ''));

export const pgOAuthStore: OAuthStore = {
    async insertFlow(flow) {
        try {
            await getDbPool().query(
                'INSERT INTO "OAuthFlow" ("stateHash","provider","userId","mode","expiresAt") VALUES ($1,$2,$3,$4,$5)',
                [flow.stateHash, flow.provider, flow.userId, flow.mode, flow.expiresAt],
            );
            return true;
        } catch (error) {
            if (missing(error)) return false;
            throw error;
        }
    },
    async consumeFlow(stateHash) {
        try {
            const pool = getDbPool();
            // Atomico: solo UNA peticion consigue marcar el state como consumido (UPDATE ... WHERE consumedAt IS NULL).
            const res = await pool.query('UPDATE "OAuthFlow" SET "consumedAt" = NOW() WHERE "stateHash" = $1 AND "consumedAt" IS NULL AND "expiresAt" > NOW()', [stateHash]);
            if (res.rowCount === 1) return 'ok';
            const row = await pool.query('SELECT "consumedAt", "expiresAt" < NOW() AS expired FROM "OAuthFlow" WHERE "stateHash" = $1', [stateHash]);
            if (row.rowCount === 0) return 'unknown';
            return row.rows[0].consumedAt ? 'used' : 'expired';
        } catch (error) {
            if (missing(error)) return 'unavailable';
            throw error;
        }
    },
    async purgeFlows() {
        try {
            await getDbPool().query(`DELETE FROM "OAuthFlow" WHERE "expiresAt" < NOW() - INTERVAL '1 day'`);
        } catch (error) {
            if (!missing(error)) throw error;
        }
    },
    async getProviderConfig(provider) {
        try {
            const res = await getDbPool().query('SELECT "provider","extensionId","clientSecret","approvedHosts","updatedAt","updatedBy","extra" FROM "OAuthProviderConfig" WHERE "provider" = $1', [provider]);
            const r = res.rows[0];
            if (!r) return null;
            let hosts: string[] = [];
            try { const parsed = JSON.parse(String(r.approvedHosts)); hosts = Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === 'string') : []; } catch { hosts = []; }
            let extra: Record<string, string> = {};
            try {
                const parsed = JSON.parse(String(r.extra ?? '{}'));
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) extra = Object.fromEntries(Object.entries(parsed).filter(([k, v]) => /^[A-Z][A-Z0-9_]{1,63}$/.test(k) && typeof v === 'string')) as Record<string, string>;
            } catch { extra = {}; }
            return { provider: r.provider, extensionId: r.extensionId, clientSecret: r.clientSecret, approvedHosts: hosts, updatedAt: r.updatedAt, updatedBy: r.updatedBy, extra };
        } catch (error) {
            if (missing(error)) return null;
            throw error;
        }
    },
    async saveProviderConfig(row) {
        try {
            await getDbPool().query(
                `INSERT INTO "OAuthProviderConfig" ("provider","extensionId","clientSecret","approvedHosts","updatedAt","updatedBy","extra") VALUES ($1,$2,$3,$4,NOW(),$5,$6)
                 ON CONFLICT ("provider") DO UPDATE SET "extensionId"=EXCLUDED."extensionId","clientSecret"=EXCLUDED."clientSecret","approvedHosts"=EXCLUDED."approvedHosts","updatedAt"=NOW(),"updatedBy"=EXCLUDED."updatedBy","extra"=EXCLUDED."extra"`,
                [row.provider, row.extensionId, row.clientSecret, JSON.stringify([...row.approvedHosts].sort()), row.updatedBy, JSON.stringify(row.extra ?? {})],
            );
            return true;
        } catch (error) {
            if (missing(error)) return false;
            throw error;
        }
    },
    async deleteProviderConfig(provider) {
        try {
            const res = await getDbPool().query('DELETE FROM "OAuthProviderConfig" WHERE "provider" = $1', [provider]);
            return (res.rowCount ?? 0) > 0;
        } catch (error) {
            if (missing(error)) return false;
            throw error;
        }
    },
};

let current: OAuthStore = pgOAuthStore;
export const oauthStore = (): OAuthStore => current;

/** SOLO PRUEBAS. */
export function __setOAuthStore(store: OAuthStore | null): void {
    if (process.env.NODE_ENV !== 'test') throw new Error('__setOAuthStore is only available in tests');
    current = store ?? pgOAuthStore;
}

/** Almacen en memoria con la misma semantica (pruebas y desarrollo sin BD). */
export function createMemoryOAuthStore(opts: { flowsAvailable?: boolean } = {}): OAuthStore & { flows: Map<string, FlowRow & { consumedAt?: Date }>; configs: Map<string, ProviderConfigRow> } {
    const flows = new Map<string, FlowRow & { consumedAt?: Date }>();
    const configs = new Map<string, ProviderConfigRow>();
    const available = opts.flowsAvailable !== false;
    return {
        flows,
        configs,
        async insertFlow(flow) { if (!available) return false; flows.set(flow.stateHash, { ...flow }); return true; },
        async consumeFlow(stateHash) {
            if (!available) return 'unavailable';
            const f = flows.get(stateHash);
            if (!f) return 'unknown';
            if (f.consumedAt) return 'used';
            if (f.expiresAt.getTime() <= Date.now()) return 'expired';
            f.consumedAt = new Date();
            return 'ok';
        },
        async purgeFlows() { /* nada */ },
        async getProviderConfig(provider) { return configs.get(provider) ?? null; },
        async saveProviderConfig(row) { configs.set(row.provider, { ...row, extra: row.extra ?? {}, updatedAt: new Date() }); return true; },
        async deleteProviderConfig(provider) { return configs.delete(provider); },
    };
}
