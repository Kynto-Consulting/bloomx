import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { decrypt, encrypt } from '@/lib/encryption';
import { validateUserRegex } from '@/lib/rules/regex-safety';
import { execute, isMissingRelation, query, toIso } from '@/lib/admin/sql';
import {
    AI_FEATURES, AI_PROVIDERS, DEFAULT_CONFIG, PROVIDERS_NEED_BASE_URL, normalizeFeature,
    type AiConfig, type AiConfigSource, type AiFeature, type AiProvider, type AiPublicState,
} from './types';
import { UnsafeUrlError, assertSafeBaseUrl } from './url-guard';

/**
 * Configuracion del servicio de IA de la instancia: tabla AiSettings (una fila, id 'default').
 *
 *  - La clave API se guarda CIFRADA (lib/encryption, AES-GCM con el anillo de claves de datos) y es write-only: las vistas solo
 *    exponen `keyConfigured` y `keyLast4`. Nunca se registra ni se audita su valor.
 *  - Respaldo heredado: SI NO HAY FILA y existen AI_KEY/AI_PROVIDER/AI_MODEL en el entorno se usan con source 'env'
 *    (aviso "migra a /admin/ai"). Si la fila existe, el entorno se IGNORA por completo (nunca se mezclan).
 *  - Cache en proceso de 30 s (kill switch <= 30 s en otras instancias de servidor; en este proceso es inmediato al guardar).
 */
export const SETTINGS_ID = 'default';
export const CACHE_TTL_MS = 30_000;

export interface ResolvedAi {
    source: AiConfigSource;
    enabled: boolean;
    provider: AiProvider | null;
    model: string | null;
    baseUrl: string | null;
    /** SOLO uso interno del servicio; nunca sale en vistas ni logs. */
    apiKey: string | null;
    keyLast4: string | null;
    config: AiConfig;
    updatedAt: string | null;
    updatedBy: string | null;
}

// ------------------------------------------------------------------------------------------------------------------
// Normalizacion de la configuracion (JSONB) con valores por defecto
// ------------------------------------------------------------------------------------------------------------------
const int = (min: number, max: number) => z.number().int().min(min).max(max);
const quotaSet = z.object({ requestsDay: int(0, 1e9), requestsMonth: int(0, 1e9), tokensDay: int(0, 1e10), tokensMonth: int(0, 1e10) }).strict();
const mode = z.enum(['off', 'log', 'warn', 'enforce']);
const regexList = z.array(z.string().min(1).max(200)).max(50).superRefine((list, ctx) => {
    list.forEach((p, i) => { const v = validateUserRegex(p); if (!v.ok) ctx.addIssue({ code: 'custom', path: [i], message: 'unsafe_regex' }); });
});
const modelName = z.string().min(1).max(120).regex(/^[A-Za-z0-9_.:/@+-]+$/);

export const aiConfigSchema = z.object({
    allowedModels: z.array(modelName).max(100),
    features: z.object(Object.fromEntries(AI_FEATURES.map((f) => [f, z.boolean()])) as Record<AiFeature, z.ZodBoolean>).strict(),
    limits: z.object({ maxOutputTokens: int(16, 32000), maxInputChars: int(100, 400000), maxTemperature: z.number().min(0).max(2), timeoutMs: int(1000, 120000) }).strict(),
    quotas: z.object({ perUser: quotaSet, global: quotaSet }).strict(),
    retentionDays: int(1, 3650),
    pricing: z.record(modelName, z.object({ inPer1k: z.number().min(0).max(1000), outPer1k: z.number().min(0).max(1000) }).strict()),
    guardrails: z.object({
        systemPrefix: z.string().max(4000),
        redaction: z.object({
            mode,
            categories: z.object({ card: z.boolean(), iban: z.boolean(), nationalId: z.boolean(), secret: z.boolean(), email: z.boolean(), phone: z.boolean() }).strict(),
        }).strict(),
        blockedTopics: z.object({ mode, patterns: regexList }).strict(),
        output: z.object({ mode, maxChars: int(100, 400000), patterns: regexList }).strict(),
        bodyPolicy: z.object({ mode: z.enum(['full', 'subject-only', 'snippet']), snippetChars: int(0, 20000) }).strict(),
    }).strict(),
    extensions: z.record(z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/), z.object({ enabled: z.boolean().optional(), maxTokens: int(16, 32000).optional(), model: modelName.optional() }).strict()),
}).strict();

type Plain = Record<string, any>;
const isObj = (v: unknown): v is Plain => !!v && typeof v === 'object' && !Array.isArray(v);

/** Mezcla profunda: los objetos se fusionan; arrays y escalares se reemplazan; `pricing`/`extensions` se reemplazan enteros. */
function deepMerge(base: Plain, patch: Plain, atomic: ReadonlySet<string> = new Set(['pricing', 'extensions'])): Plain {
    const out: Plain = { ...base };
    for (const [k, v] of Object.entries(patch)) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        out[k] = isObj(v) && isObj(base[k]) && !atomic.has(k) ? deepMerge(base[k], v, atomic) : v;
    }
    return out;
}

/** Config persistida (posiblemente parcial o antigua) -> config completa y valida; lo invalido cae a los valores por defecto. */
export function normalizeConfig(raw: unknown): AiConfig {
    const merged = deepMerge(DEFAULT_CONFIG as unknown as Plain, isObj(raw) ? raw : {});
    const parsed = aiConfigSchema.safeParse(merged);
    return parsed.success ? (parsed.data as AiConfig) : structuredClone(DEFAULT_CONFIG);
}

export type ConfigPatch = Partial<{ [K in keyof AiConfig]: AiConfig[K] extends Record<string, unknown> ? Plain : AiConfig[K] }> & Plain;

export const settingsPatchSchema = z.object({
    enabled: z.boolean().optional(),
    provider: z.enum(AI_PROVIDERS).nullable().optional(),
    model: modelName.nullable().optional(),
    baseUrl: z.string().max(300).nullable().optional(),
    /** Clave nueva; `null` la borra. Write-only. */
    apiKey: z.string().min(8).max(4096).regex(/^[^\s\u0000-\u001f\u007f]+$/, 'apikey_chars').nullable().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
}).strict();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** Campos que exigen nivel 4 + step-up (clave, proveedor, URL base, kill switch). */
export const CRITICAL_FIELDS = ['enabled', 'provider', 'baseUrl', 'apiKey'] as const;
export function patchIsCritical(patch: SettingsPatch): boolean {
    return CRITICAL_FIELDS.some((f) => patch[f] !== undefined);
}

// ------------------------------------------------------------------------------------------------------------------
// Lectura
// ------------------------------------------------------------------------------------------------------------------
interface Row {
    enabled: boolean; provider: string | null; model: string | null; baseUrl: string | null; apiKeyEnc: string | null; apiKeyLast4: string | null;
    config: unknown; updatedAt: Date | null; updatedBy: string | null;
}

async function readRow(): Promise<Row | null> {
    try {
        const rows = await query<Row>(`SELECT "enabled","provider","model","baseUrl","apiKeyEnc","apiKeyLast4","config","updatedAt","updatedBy" FROM "AiSettings" WHERE "id" = $1`, SETTINGS_ID);
        return rows[0] ?? null;
    } catch (e) {
        if (isMissingRelation(e)) return null;
        throw e;
    }
}

function legacyEnv(env: NodeJS.ProcessEnv): { provider: AiProvider; model: string; baseUrl: string | null; apiKey: string } | null {
    const apiKey = env.AI_KEY?.trim();
    if (!apiKey) return null;
    let provider = (env.AI_PROVIDER || 'openai').toLowerCase().trim();
    let baseUrl: string | null = null;
    if (provider === 'grok') { provider = 'compatible'; baseUrl = 'https://api.x.ai/v1'; }
    if (provider === 'gemini') provider = 'google';
    if (!(AI_PROVIDERS as readonly string[]).includes(provider)) return null;
    return { provider: provider as AiProvider, model: env.AI_MODEL?.trim() || 'gpt-4o-mini', baseUrl, apiKey };
}

let cache: { at: number; value: ResolvedAi } | null = null;
export function invalidateAiCache(): void { cache = null; }

export function decryptKey(enc: string | null): string | null {
    if (!enc) return null;
    try { return decrypt(enc); } catch { return null; }
}

function emptyResolved(): ResolvedAi {
    return { source: 'none', enabled: false, provider: null, model: null, baseUrl: null, apiKey: null, keyLast4: null, config: structuredClone(DEFAULT_CONFIG), updatedAt: null, updatedBy: null };
}

export async function resolveAi(opts: { env?: NodeJS.ProcessEnv; fresh?: boolean } = {}): Promise<ResolvedAi> {
    const now = Date.now();
    if (!opts.fresh && !opts.env && cache && now - cache.at < CACHE_TTL_MS) return cache.value;
    const env = opts.env ?? process.env;
    const row = await readRow();
    let value: ResolvedAi;
    if (row) {
        const key = decryptKey(row.apiKeyEnc);
        value = {
            source: 'ui', enabled: row.enabled === true,
            provider: (AI_PROVIDERS as readonly string[]).includes(row.provider ?? '') ? (row.provider as AiProvider) : null,
            model: row.model, baseUrl: row.baseUrl, apiKey: key, keyLast4: row.apiKeyLast4,
            config: normalizeConfig(row.config), updatedAt: toIso(row.updatedAt), updatedBy: row.updatedBy,
        };
    } else {
        const legacy = legacyEnv(env);
        value = legacy
            ? { ...emptyResolved(), source: 'env', enabled: true, provider: legacy.provider, model: legacy.model, baseUrl: legacy.baseUrl, apiKey: legacy.apiKey, keyLast4: legacy.apiKey.slice(-4) }
            : emptyResolved();
    }
    if (!opts.env) cache = { at: now, value };
    return value;
}

export function isConfigured(r: ResolvedAi): boolean {
    if (!r.provider || !r.model || !r.apiKey) return false;
    if (PROVIDERS_NEED_BASE_URL.includes(r.provider) && !r.baseUrl) return false;
    return true;
}

/** Estado publico (sin secretos) para el cargador de extensiones y el UI. */
export async function getPublicAiState(): Promise<AiPublicState> {
    const r = await resolveAi();
    const features = { ...r.config.features };
    return {
        enabled: r.enabled, configured: isConfigured(r), source: r.source, features,
        extensions: Object.fromEntries(Object.entries(r.config.extensions).filter(([, p]) => p.enabled === false).map(([id]) => [id, false])),
    };
}

/** Vista para el admin: NUNCA incluye la clave. */
export interface AiSettingsView {
    source: AiConfigSource;
    /** true si se usan variables de entorno heredadas (mostrar aviso de migracion). */
    legacyEnv: boolean;
    enabled: boolean;
    provider: AiProvider | null;
    model: string | null;
    baseUrl: string | null;
    keyConfigured: boolean;
    keyLast4: string | null;
    configured: boolean;
    config: AiConfig;
    updatedAt: string | null;
    updatedBy: string | null;
}

export function toView(r: ResolvedAi): AiSettingsView {
    return {
        source: r.source, legacyEnv: r.source === 'env', enabled: r.enabled, provider: r.provider, model: r.model, baseUrl: r.baseUrl,
        keyConfigured: !!r.apiKey, keyLast4: r.apiKey ? r.keyLast4 : null, configured: isConfigured(r), config: r.config,
        updatedAt: r.updatedAt, updatedBy: r.updatedBy,
    };
}

export async function getAiSettingsView(): Promise<AiSettingsView> {
    return toView(await resolveAi({ fresh: true }));
}

// ------------------------------------------------------------------------------------------------------------------
// Escritura
// ------------------------------------------------------------------------------------------------------------------
export class SettingsError extends Error {
    constructor(public readonly code: string, public readonly status = 400) { super(code); this.name = 'SettingsError'; }
}

/** Nombres de campos cambiados (sin valores) para la auditoria. */
export function changedFields(patch: SettingsPatch): string[] {
    const out: string[] = [];
    for (const k of ['enabled', 'provider', 'model', 'baseUrl'] as const) if (patch[k] !== undefined) out.push(k);
    if (patch.apiKey !== undefined) out.push(patch.apiKey === null ? 'apiKey:cleared' : 'apiKey:set');
    if (patch.config) for (const [k, v] of Object.entries(patch.config)) out.push(isObj(v) ? `config.${k}(${Object.keys(v).slice(0, 8).join(',')})` : `config.${k}`);
    return out;
}

export async function recordAudit(actor: string, action: string, fields: string[]): Promise<void> {
    try {
        await execute(`INSERT INTO "AiAudit" ("id","actor","action","fields") VALUES ($1,$2,$3,$4)`, randomUUID(), actor.slice(0, 200), action.slice(0, 60), fields.join(' ').slice(0, 1000));
    } catch (e) { if (!isMissingRelation(e)) throw e; }
}

export async function listAudit(limit = 100): Promise<Array<{ id: string; actor: string; action: string; fields: string[]; ts: string | null }>> {
    try {
        const rows = await query<{ id: string; actor: string; action: string; fields: string; ts: Date }>(`SELECT "id","actor","action","fields","ts" FROM "AiAudit" ORDER BY "ts" DESC LIMIT $1`, Math.min(500, Math.max(1, limit)));
        return rows.map((r) => ({ id: r.id, actor: r.actor, action: r.action, fields: r.fields ? r.fields.split(' ') : [], ts: toIso(r.ts) }));
    } catch (e) { if (isMissingRelation(e)) return []; throw e; }
}

/** Valida y aplica un parche. Lanza SettingsError (400) con un codigo corto. No audita: lo hace quien llama (conoce al actor). */
export async function saveAiSettings(patchIn: unknown, updatedBy: string): Promise<AiSettingsView> {
    const parsed = settingsPatchSchema.safeParse(patchIn);
    if (!parsed.success) throw new SettingsError('invalid_input');
    const patch = parsed.data;

    const current = await readRow();
    const provider = patch.provider !== undefined ? patch.provider : ((current?.provider as AiProvider | null) ?? null);
    let baseUrl = patch.baseUrl !== undefined ? patch.baseUrl : (current?.baseUrl ?? null);
    if (baseUrl !== null && baseUrl !== undefined && baseUrl !== '') {
        try { baseUrl = (await assertSafeBaseUrl(baseUrl)).toString().replace(/\/+$/, ''); }
        catch (e) { throw new SettingsError(e instanceof UnsafeUrlError ? `unsafe_base_url:${e.reason}` : 'unsafe_base_url'); }
    } else baseUrl = null;
    if (provider && PROVIDERS_NEED_BASE_URL.includes(provider) && !baseUrl && (patch.provider !== undefined || patch.baseUrl !== undefined)) throw new SettingsError('base_url_required');

    const mergedConfig = patch.config ? deepMerge((current ? normalizeConfig(current.config) : structuredClone(DEFAULT_CONFIG)) as unknown as Plain, patch.config) : (current ? normalizeConfig(current.config) : structuredClone(DEFAULT_CONFIG));
    const checked = aiConfigSchema.safeParse(mergedConfig);
    if (!checked.success) throw new SettingsError('invalid_config');
    const config = checked.data as AiConfig;
    // Los modelos elegidos deben estar dentro de la lista permitida cuando esta no esta vacia.
    const model = patch.model !== undefined ? patch.model : (current?.model ?? null);
    if (config.allowedModels.length > 0 && model && !config.allowedModels.includes(model)) throw new SettingsError('model_not_allowed');
    for (const p of Object.values(config.extensions)) if (p.model && config.allowedModels.length > 0 && !config.allowedModels.includes(p.model)) throw new SettingsError('model_not_allowed');

    let apiKeyEnc = current?.apiKeyEnc ?? null;
    let last4 = current?.apiKeyLast4 ?? null;
    if (patch.apiKey !== undefined) {
        if (patch.apiKey === null) { apiKeyEnc = null; last4 = null; }
        else { apiKeyEnc = encrypt(patch.apiKey); last4 = patch.apiKey.slice(-4); }
    }
    // Migrar de 'env' a 'ui': la fila nueva NO hereda la clave del entorno (nunca se mezclan).
    const enabled = patch.enabled !== undefined ? patch.enabled : (current?.enabled ?? false);

    await execute(
        `INSERT INTO "AiSettings" ("id","enabled","provider","model","baseUrl","apiKeyEnc","apiKeyLast4","config","updatedAt","updatedBy")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW(),$9)
         ON CONFLICT ("id") DO UPDATE SET "enabled"=EXCLUDED."enabled","provider"=EXCLUDED."provider","model"=EXCLUDED."model","baseUrl"=EXCLUDED."baseUrl",
           "apiKeyEnc"=EXCLUDED."apiKeyEnc","apiKeyLast4"=EXCLUDED."apiKeyLast4","config"=EXCLUDED."config","updatedAt"=NOW(),"updatedBy"=EXCLUDED."updatedBy"`,
        SETTINGS_ID, enabled, provider, model, baseUrl, apiKeyEnc, last4, JSON.stringify(config), updatedBy.slice(0, 200),
    );
    invalidateAiCache();
    return getAiSettingsView();
}

export { normalizeFeature };
