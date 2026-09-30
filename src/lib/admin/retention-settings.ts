import { z } from 'zod';
import { maskEmail } from '@/lib/audit';
import {
    RETENTION_KEYS, RETENTION_LIMITS, RETENTION_SETTING_KEY, getRetentionConfig, isValidRetentionValue, loadRetentionOverrides,
    runRetention, type RetentionConfig, type RetentionKey, type RetentionReport,
} from '@/lib/retention';
import { HttpError } from './http';
import { execute, isMissingRelation, num, query, tolerant, toIso } from './sql';

/**
 * Politicas de retencion editables (AdminSetting key='retention') y resumen AGREGADO de almacenamiento.
 * Nunca se devuelven claves/rutas de almacenamiento ni contenido de correos: solo conteos, bytes y carpetas.
 */

export type RetentionOverridesPatch = Partial<Record<RetentionKey, number | null>>;

const oneKey = (key: RetentionKey) =>
    z.number().int().nullable().optional().superRefine((v, ctx) => {
        if (v === null || v === undefined) return;
        if (!isValidRetentionValue(key, v)) ctx.addIssue({ code: 'custom', message: 'out_of_range' });
    });

/** PUT: cada clave es un entero valido o `null` (= volver al valor del entorno). Claves desconocidas -> 400. */
export const retentionPatchSchema = z
    .object({
        spamDays: oneKey('spamDays'),
        trashDays: oneKey('trashDays'),
        rawDays: oneKey('rawDays'),
        auditDays: oneKey('auditDays'),
        secureMessageDays: oneKey('secureMessageDays'),
        batch: oneKey('batch'),
    })
    .strict()
    .refine((o) => RETENTION_KEYS.some((k) => o[k] !== undefined), { message: 'empty' });

export interface RetentionSettingsView {
    effective: RetentionConfig;
    env: RetentionConfig;
    overrides: Partial<RetentionConfig>;
    updatedAt: string | null;
    updatedBy: string | null;
    limits: typeof RETENTION_LIMITS;
}

const publicActor = (v: string | null): string | null => (v ? (v.includes('@') ? maskEmail(v) : v.slice(0, 200)) : null);

export async function getRetentionSettings(): Promise<RetentionSettingsView> {
    const env = getRetentionConfig();
    const { overrides, updatedAt, updatedBy } = await loadRetentionOverrides();
    return { effective: { ...env, ...overrides }, env, overrides, updatedAt: toIso(updatedAt), updatedBy: publicActor(updatedBy), limits: RETENTION_LIMITS };
}

/** Aplica el parche (null borra la clave), guarda (o borra la fila si no queda nada) y devuelve la vista actualizada. */
export async function saveRetentionSettings(patch: RetentionOverridesPatch, updatedBy: string): Promise<RetentionSettingsView> {
    const { overrides } = await loadRetentionOverrides();
    const next: Partial<RetentionConfig> = { ...overrides };
    for (const key of RETENTION_KEYS) {
        const v = patch[key];
        if (v === undefined) continue;
        if (v === null) delete next[key];
        else next[key] = v;
    }
    try {
        if (Object.keys(next).length === 0) {
            await execute(`DELETE FROM "AdminSetting" WHERE "key" = $1`, RETENTION_SETTING_KEY);
        } else {
            await execute(
                `INSERT INTO "AdminSetting" ("key", "value", "updatedAt", "updatedBy") VALUES ($1, $2::jsonb, NOW(), $3)
                 ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW(), "updatedBy" = EXCLUDED."updatedBy"`,
                RETENTION_SETTING_KEY,
                JSON.stringify(next),
                updatedBy.slice(0, 200),
            );
        }
    } catch (error) {
        if (isMissingRelation(error)) throw new HttpError(503, 'settings_unavailable');
        throw error;
    }
    return getRetentionSettings();
}

// ---------------------------------------------------------------------------------------------------------------------
// Almacenamiento (solo agregados)
// ---------------------------------------------------------------------------------------------------------------------
export interface StorageOverview {
    attachments: { count: number; bytes: number } | null;
    emailsByFolder: Array<{ folder: string; count: number }> | null;
    topUsers: Array<{ userId: string; email: string; bytes: number; attachments: number }> | null;
    tables: {
        userSessions: number | null;
        auditEvents: number | null;
        oldestAuditAt: string | null;
        revokedSessions: number | null;
    };
    policy: RetentionConfig;
    /** Lo que borraria HOY la politica vigente (simulacion). `null` si no se pudo calcular. */
    wouldDelete: RetentionReport | null;
}

const count = (table: string) =>
    // `table` es siempre una constante del codigo (nunca entrada del usuario).
    tolerant(async () => num((await query<{ n: bigint }>(`SELECT COUNT(*) AS n FROM "${table}"`))[0]?.n), null as number | null);

export async function getStorageOverview(): Promise<StorageOverview> {
    const [attachments, emailsByFolder, topUsers, userSessions, auditEvents, oldestAudit, revokedSessions, policy] = await Promise.all([
        tolerant(
            async () => {
                const r = (await query<{ n: bigint; bytes: bigint | null }>(`SELECT COUNT(*) AS n, COALESCE(SUM("size"), 0) AS bytes FROM "Attachment" WHERE "key" <> 'PENDING'`))[0];
                return { count: num(r?.n), bytes: num(r?.bytes) };
            },
            null as { count: number; bytes: number } | null,
        ),
        tolerant(
            async () => (await query<{ folder: string; n: bigint }>(`SELECT "folder", COUNT(*) AS n FROM "Email" GROUP BY "folder" ORDER BY n DESC LIMIT 50`)).map((r) => ({ folder: String(r.folder).slice(0, 60), count: num(r.n) })),
            null as Array<{ folder: string; count: number }> | null,
        ),
        tolerant(
            async () => (await query<{ id: string; email: string; bytes: bigint | null; n: bigint }>(
                `SELECT u."id", u."email", COALESCE(SUM(a."size"), 0) AS bytes, COUNT(a."id") AS n
                 FROM "Attachment" a JOIN "Email" e ON e."id" = a."emailId" JOIN "User" u ON u."id" = e."userId"
                 WHERE a."key" <> 'PENDING'
                 GROUP BY u."id", u."email" ORDER BY bytes DESC, u."id" ASC LIMIT 10`,
            )).map((r) => ({ userId: String(r.id), email: String(r.email), bytes: num(r.bytes), attachments: num(r.n) })),
            null as StorageOverview['topUsers'],
        ),
        count('UserSession'),
        count('AuditEvent'),
        tolerant(async () => toIso((await query<{ ts: Date | null }>(`SELECT MIN("ts") AS ts FROM "AuditEvent"`))[0]?.ts), null as string | null),
        count('RevokedSession'),
        getRetentionSettings().then((s) => s.effective),
    ]);

    let wouldDelete: RetentionReport | null = null;
    try {
        wouldDelete = await runRetention({ dryRun: true, quiet: true });
    } catch (error) {
        console.error('[ADMIN_RETENTION] simulation failed:', error instanceof Error ? error.message.slice(0, 200) : 'error');
    }

    return {
        attachments,
        emailsByFolder,
        topUsers,
        tables: { userSessions, auditEvents, oldestAuditAt: oldestAudit, revokedSessions },
        policy,
        wouldDelete,
    };
}
