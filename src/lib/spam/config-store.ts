/**
 * Persistencia de la configuracion del filtro (AdminSetting 'spamConfig') con cache en proceso de <= 30 s e invalidacion por
 * version en BD (AdminSetting 'spamConfigVersion', como la cuota). Sin tabla o sin fila -> configuracion por defecto (y, si no hay
 * base de datos, el comportamiento anterior: ver pipeline.ts).
 */
import { execute, query } from '@/lib/admin/sql';
import { SPAM_CONFIG_KEY, defaultSpamConfig, sanitizeSpamConfig, type SpamConfig } from './config-core';

export const SPAM_CONFIG_VERSION_KEY = 'spamConfigVersion';
export const SPAM_CACHE_TTL_MS = 30_000;
export const SPAM_VERSION_CHECK_MS = 5_000;

interface Cached { at: number; version: string | null; config: SpamConfig; source: 'db' | 'default' }
let cache: Cached | null = null;
let versionState: { at: number; value: string | null } | null = null;

export function invalidateSpamConfigCache() { cache = null; versionState = null; }

async function currentVersion(now: number): Promise<string | null> {
    if (versionState && now >= versionState.at && now - versionState.at < SPAM_VERSION_CHECK_MS) return versionState.value;
    let value = versionState?.value ?? null;
    try {
        const rows = await query<{ v: string }>(`SELECT ("updatedAt")::text AS "v" FROM "AdminSetting" WHERE "key" = $1`, SPAM_CONFIG_VERSION_KEY);
        value = rows[0]?.v ?? null;
    } catch { /* sin tabla: se conserva la ultima version */ }
    versionState = { at: now, value };
    return value;
}

export interface LoadedConfig { config: SpamConfig; source: 'db' | 'default'; updatedAt: string | null; updatedBy: string | null }

async function readRow(): Promise<{ config: SpamConfig; source: 'db' | 'default'; updatedAt: string | null; updatedBy: string | null }> {
    const base = defaultSpamConfig();
    const rows = await query<{ value: unknown; updatedAt: Date | string; updatedBy: string | null }>(
        `SELECT "value", "updatedAt", "updatedBy" FROM "AdminSetting" WHERE "key" = $1`, SPAM_CONFIG_KEY,
    );
    const row = rows[0];
    if (!row || row.value === null || typeof row.value !== 'object') return { config: base, source: 'default', updatedAt: null, updatedBy: null };
    return {
        config: sanitizeSpamConfig(row.value, base),
        source: 'db',
        updatedAt: new Date(row.updatedAt as string).toISOString(),
        updatedBy: row.updatedBy ? String(row.updatedBy).slice(0, 200) : null,
    };
}

/** Configuracion vigente (cache <= 30 s). Si la BD falla devuelve la de por defecto: el correo nunca deja de entrar. */
export async function getSpamConfig(opts: { fresh?: boolean; now?: number } = {}): Promise<SpamConfig> {
    return (await getSpamConfigInfo(opts)).config;
}

export async function getSpamConfigInfo(opts: { fresh?: boolean; now?: number } = {}): Promise<LoadedConfig> {
    const now = opts.now ?? Date.now();
    const version = await currentVersion(now);
    if (!opts.fresh && cache && now - cache.at < SPAM_CACHE_TTL_MS && cache.version === version) {
        return { config: cache.config, source: cache.source, updatedAt: null, updatedBy: null };
    }
    try {
        const r = await readRow();
        cache = { at: now, version, config: r.config, source: r.source };
        return r;
    } catch (error) {
        console.error('[spam-config] read failed, using defaults:', error instanceof Error ? error.message.slice(0, 200) : 'error');
        return { config: cache?.config ?? defaultSpamConfig(), source: 'default', updatedAt: null, updatedBy: null };
    }
}

/** Guarda (saneando) y publica la version para las demas instancias. Devuelve la configuracion resultante. */
export async function saveSpamConfig(patch: unknown, actor: string): Promise<SpamConfig> {
    const current = (await getSpamConfigInfo({ fresh: true })).config;
    const next = sanitizeSpamConfig(mergeConfig(current, patch), current);
    next.rev = current.rev + 1;
    await execute(
        `INSERT INTO "AdminSetting" ("key", "value", "updatedAt", "updatedBy") VALUES ($1, $2::jsonb, NOW(), $3)
         ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW(), "updatedBy" = EXCLUDED."updatedBy"`,
        SPAM_CONFIG_KEY, JSON.stringify(next), actor.slice(0, 200),
    );
    await bumpSpamConfigVersion(actor);
    return next;
}

/** Restaura la configuracion por defecto (borra la fila). */
export async function resetSpamConfig(actor: string): Promise<SpamConfig> {
    await execute(`DELETE FROM "AdminSetting" WHERE "key" = $1`, SPAM_CONFIG_KEY);
    await bumpSpamConfigVersion(actor);
    return defaultSpamConfig();
}

export async function bumpSpamConfigVersion(actor = 'system'): Promise<void> {
    try {
        await execute(
            `INSERT INTO "AdminSetting" ("key", "value", "updatedAt", "updatedBy") VALUES ($1, to_jsonb(md5(random()::text)), clock_timestamp(), $2)
             ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = clock_timestamp(), "updatedBy" = EXCLUDED."updatedBy"`,
            SPAM_CONFIG_VERSION_KEY, actor.slice(0, 200),
        );
    } catch (error) {
        console.error('[spam-config] version bump failed:', error instanceof Error ? error.message.slice(0, 200) : 'error');
    }
    invalidateSpamConfigCache();
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** Mezcla profunda de un parche parcial sobre la configuracion actual (los objetos se fusionan; el resto se reemplaza). */
export function mergeConfig(base: SpamConfig, patch: unknown): Record<string, unknown> {
    const out: Record<string, unknown> = JSON.parse(JSON.stringify(base));
    if (!isObj(patch)) return out;
    for (const [k, v] of Object.entries(patch)) {
        if (k === 'rev' || k === 'schema') continue;
        if (isObj(v) && isObj(out[k])) out[k] = { ...(out[k] as Record<string, unknown>), ...v };
        else out[k] = v;
    }
    return out;
}
