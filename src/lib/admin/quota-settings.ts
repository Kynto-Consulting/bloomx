import { z } from 'zod';
import { maskEmail } from '@/lib/audit';
import { QUOTA_DOMAIN_KEY, QUOTA_ENFORCE_KEY, QUOTA_MAX_MB, QUOTA_USER_KEY_PREFIX, bumpQuotaVersion, getQuotaStatus, loadQuotaViews, parseQuotaMb, type UserQuotaView } from '@/lib/mail-quota';
import { HttpError, notFound } from './http';
import { execute, isMissingRelation, query, toIso } from './sql';

/**
 * Cuota de buzon editable desde la consola (AdminSetting): `mailQuotaMb` (MB por usuario del dominio; 0 = sin limite),
 * `enforceMailQuota` (bloquear envios al llegar al 100 %; por defecto NO) y, opcionalmente, una cuota por usuario
 * (`mailQuotaMb:user:<id>`). `null` borra la fila y se vuelve al valor anterior de la cadena (usuario > dominio > entorno).
 */

const mb = z.number().int().min(0).max(QUOTA_MAX_MB).nullable().optional();

export const quotaPatchSchema = z
    .object({
        mailQuotaMb: mb,
        enforceMailQuota: z.boolean().nullable().optional(),
        /** Si viene, `mailQuotaMb` se aplica SOLO a ese usuario (y `enforceMailQuota` no se admite). */
        userId: z.string().min(1).max(200).optional(),
    })
    .strict()
    .refine((o) => o.mailQuotaMb !== undefined || o.enforceMailQuota !== undefined, { message: 'empty' })
    .refine((o) => !(o.userId && o.enforceMailQuota !== undefined), { message: 'enforce_is_domain_wide' })
    .refine((o) => !(o.userId && o.mailQuotaMb === undefined), { message: 'empty' });

export type QuotaPatch = z.infer<typeof quotaPatchSchema>;

export interface QuotaSettingsView {
    /** Valor guardado desde la consola (null = no hay fila: manda el entorno). */
    mailQuotaMb: number | null;
    enforceMailQuota: boolean;
    /** MAIL_QUOTA_MB del entorno (null = sin definir o invalido). */
    envMailQuotaMb: number | null;
    /** Limite efectivo del dominio en MB (0/null = sin limite). */
    effectiveMb: number | null;
    source: 'console' | 'env' | 'none';
    updatedAt: string | null;
    updatedBy: string | null;
    maxMb: number;
}

const publicActor = (v: string | null): string | null => (v ? (v.includes('@') ? maskEmail(v) : v.slice(0, 200)) : null);

export async function getQuotaSettings(env: NodeJS.ProcessEnv = process.env): Promise<QuotaSettingsView> {
    let rows: Array<{ key: string; value: unknown; updatedAt: Date | null; updatedBy: string | null }> = [];
    try {
        rows = await query(`SELECT "key", "value", "updatedAt", "updatedBy" FROM "AdminSetting" WHERE "key" = ANY($1::text[])`, [QUOTA_DOMAIN_KEY, QUOTA_ENFORCE_KEY]);
    } catch (error) {
        if (!isMissingRelation(error)) throw error;
    }
    const by = new Map(rows.map((r) => [r.key, r]));
    const stored = parseQuotaMb(by.get(QUOTA_DOMAIN_KEY)?.value);
    const envParsed = parseQuotaMb(env.MAIL_QUOTA_MB);
    const envMb = envParsed !== undefined && envParsed > 0 ? envParsed : null;
    const newest = [by.get(QUOTA_DOMAIN_KEY), by.get(QUOTA_ENFORCE_KEY)].filter(Boolean).sort((a, b) => +new Date(b!.updatedAt ?? 0) - +new Date(a!.updatedAt ?? 0))[0];
    return {
        mailQuotaMb: stored ?? null,
        enforceMailQuota: by.get(QUOTA_ENFORCE_KEY)?.value === true,
        envMailQuotaMb: envMb,
        effectiveMb: stored !== undefined ? (stored > 0 ? stored : null) : envMb,
        source: stored !== undefined ? 'console' : envMb ? 'env' : 'none',
        updatedAt: toIso(newest?.updatedAt),
        updatedBy: publicActor(newest?.updatedBy ?? null),
        maxMb: QUOTA_MAX_MB,
    };
}

async function upsert(key: string, value: unknown, by: string) {
    await execute(
        `INSERT INTO "AdminSetting" ("key", "value", "updatedAt", "updatedBy") VALUES ($1, $2::jsonb, NOW(), $3)
         ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW(), "updatedBy" = EXCLUDED."updatedBy"`,
        key, JSON.stringify(value), by.slice(0, 200),
    );
}

/** Aplica el parche (null borra la fila), invalida la cache de cuota y devuelve la vista del dominio. */
export async function saveQuotaSettings(patch: QuotaPatch, updatedBy: string): Promise<QuotaSettingsView> {
    try {
        if (patch.userId) {
            const found = await query<{ id: string }>(`SELECT "id" FROM "User" WHERE "id" = $1`, patch.userId);
            if (found.length === 0) throw notFound('user_not_found');
            const key = `${QUOTA_USER_KEY_PREFIX}${patch.userId}`;
            if (patch.mailQuotaMb === null) await execute(`DELETE FROM "AdminSetting" WHERE "key" = $1`, key);
            else await upsert(key, patch.mailQuotaMb, updatedBy);
        } else {
            if (patch.mailQuotaMb !== undefined) {
                if (patch.mailQuotaMb === null) await execute(`DELETE FROM "AdminSetting" WHERE "key" = $1`, QUOTA_DOMAIN_KEY);
                else await upsert(QUOTA_DOMAIN_KEY, patch.mailQuotaMb, updatedBy);
            }
            if (patch.enforceMailQuota !== undefined) {
                // false/null = comportamiento por defecto (no bloquear): se borra la fila en vez de guardar `false`.
                if (patch.enforceMailQuota === true) await upsert(QUOTA_ENFORCE_KEY, true, updatedBy);
                else await execute(`DELETE FROM "AdminSetting" WHERE "key" = $1`, QUOTA_ENFORCE_KEY);
            }
        }
    } catch (error) {
        if (error instanceof HttpError) throw error;
        if (isMissingRelation(error)) throw new HttpError(503, 'settings_unavailable');
        throw error;
    }
    // Publica el cambio (version en BD) para que las demas instancias lo vean en <= 5 s, e invalida la cache local al momento.
    await bumpQuotaVersion(updatedBy);
    return getQuotaSettings();
}

export interface UserQuotaAdminView extends UserQuotaView {
    usedBytes: number;
    percent: number | null;
    level: string;
    approximate: true;
    maxMb: number;
}

/** Cuota efectiva de un usuario (valor y origen) y su uso actual, para el detalle de la consola. */
export async function getUserQuotaAdminView(userId: string): Promise<UserQuotaAdminView> {
    const view = (await loadQuotaViews([userId])).get(userId)!;
    const status = await getQuotaStatus(userId, { fresh: true });
    return { ...view, usedBytes: status.usedBytes, percent: status.percent, level: status.level, approximate: true, maxMb: QUOTA_MAX_MB };
}

export const userQuotaBodySchema = z.object({ mailQuotaMb: z.number().int().min(0).max(QUOTA_MAX_MB).nullable() }).strict();
