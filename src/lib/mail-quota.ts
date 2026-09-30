// Cuota de buzon: uso estimado, limite resuelto por politica y bloqueo de envio opcional.
//
// USO = suma de Attachment.size de los correos del usuario + una ESTIMACION del tamano de los cuerpos. El esquema no guarda
// el tamano del html/text (viven en el almacenamiento de objetos), asi que por correo se suma lo que SI existe
// (octet_length de asunto y vista previa) mas una constante de metadatos y una constante por cuerpo almacenado (html o
// texto). Es una aproximacion documentada (BODY_ESTIMATE): el numero es estable y barato (dos indices existentes:
// Email(userId) y Attachment(emailId)) pero no exacto al byte. No cuenta adjuntos de borradores ni objetos crudos (rawKey).
//
// LIMITE (politica resuelta, de mas a menos especifica):
//   1. por usuario:  AdminSetting key `mailQuotaMb:user:<userId>` (numero de MB; 0 = sin limite para ese usuario)
//   2. por dominio:  AdminSetting key `mailQuotaMb`
//   3. entorno:      MAIL_QUOTA_MB
//   4. nada:         sin limite (solo se muestra el uso)
// BLOQUEO: solo si el dominio activo `enforceMailQuota` (AdminSetting). Por defecto NO bloquea.
import { prisma } from '@/lib/prisma';

export const QUOTA_DOMAIN_KEY = 'mailQuotaMb';
export const QUOTA_ENFORCE_KEY = 'enforceMailQuota';
export const QUOTA_USER_KEY_PREFIX = 'mailQuotaMb:user:';
export const QUOTA_MAX_MB = 10_000_000; // 10 PB: tope de cordura
export const MB = 1024 * 1024;

/** Constantes de la estimacion de cuerpos (bytes por correo). Ver la cabecera del archivo. */
export const BODY_ESTIMATE = { meta: 512, html: 6144, text: 2048 } as const;

/** Umbrales de la barra de uso (porcentaje). */
export const QUOTA_WARNING_PCT = 80;
export const QUOTA_CRITICAL_PCT = 95;
export const QUOTA_NOTICE_PCT = 90;

export type QuotaSource = 'user' | 'domain' | 'env' | 'none';
export type QuotaLevel = 'unlimited' | 'ok' | 'warning' | 'critical' | 'exceeded';

export interface QuotaPolicy {
    /** null = sin limite. */
    limitBytes: number | null;
    source: QuotaSource;
    enforce: boolean;
}

export interface QuotaStatus extends QuotaPolicy {
    usedBytes: number;
    attachmentsBytes: number;
    bodiesBytes: number;
    emails: number;
    /** null si no hay limite. Puede superar 100. */
    percent: number | null;
    level: QuotaLevel;
    /** Hay que avisar: el uso supera el 90 %. */
    notice: boolean;
    /** El uso de cuerpos es una estimacion (siempre true hoy). */
    approximate: true;
}

/** Numero de MB valido (entero 0..QUOTA_MAX_MB) o undefined si no lo es. */
export function parseQuotaMb(value: unknown): number | undefined {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > QUOTA_MAX_MB) return undefined;
    return n;
}

/** Politica a partir de las filas de AdminSetting (puras: sin BD). `null` en un valor = "no hay fila valida". */
export function resolvePolicy(input: {
    userMb?: unknown;
    domainMb?: unknown;
    enforce?: unknown;
    envMb?: string | undefined;
}): QuotaPolicy {
    const enforce = input.enforce === true;
    const user = parseQuotaMb(input.userMb);
    if (user !== undefined) return { limitBytes: user > 0 ? user * MB : null, source: 'user', enforce };
    const domain = parseQuotaMb(input.domainMb);
    if (domain !== undefined) return { limitBytes: domain > 0 ? domain * MB : null, source: 'domain', enforce };
    const env = parseQuotaMb(input.envMb);
    if (env !== undefined && env > 0) return { limitBytes: env * MB, source: 'env', enforce };
    return { limitBytes: null, source: 'none', enforce };
}

export function levelFor(percent: number | null): QuotaLevel {
    if (percent === null) return 'unlimited';
    if (percent >= 100) return 'exceeded';
    if (percent >= QUOTA_CRITICAL_PCT) return 'critical';
    if (percent >= QUOTA_WARNING_PCT) return 'warning';
    return 'ok';
}

export function buildStatus(policy: QuotaPolicy, usage: { attachmentsBytes: number; bodiesBytes: number; emails: number }): QuotaStatus {
    const usedBytes = usage.attachmentsBytes + usage.bodiesBytes;
    const percent = policy.limitBytes ? Math.round((usedBytes / policy.limitBytes) * 1000) / 10 : null;
    return { ...policy, ...usage, usedBytes, percent, level: levelFor(percent), notice: percent !== null && percent > QUOTA_NOTICE_PCT, approximate: true };
}

const num = (v: unknown): number => {
    const n = typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Filas de AdminSetting relevantes. Tolerante: sin tabla o con error -> {} (se usa el entorno). */
export async function loadPolicy(userId: string, env: NodeJS.ProcessEnv = process.env): Promise<QuotaPolicy> {
    let rows: Array<{ key: string; value: unknown }> = [];
    try {
        rows = (await prisma.$queryRawUnsafe(
            `SELECT "key", "value" FROM "AdminSetting" WHERE "key" = ANY($1::text[])`,
            [QUOTA_DOMAIN_KEY, QUOTA_ENFORCE_KEY, `${QUOTA_USER_KEY_PREFIX}${userId}`],
        )) as Array<{ key: string; value: unknown }>;
    } catch {
        rows = [];
    }
    const by = new Map(rows.map((r) => [r.key, r.value]));
    return resolvePolicy({
        userMb: by.get(`${QUOTA_USER_KEY_PREFIX}${userId}`),
        domainMb: by.get(QUOTA_DOMAIN_KEY),
        enforce: by.get(QUOTA_ENFORCE_KEY),
        envMb: env.MAIL_QUOTA_MB,
    });
}

/** Consulta de uso: parametrizada, dos agregados que usan Email(userId) y Attachment(emailId). */
export const QUOTA_USAGE_SQL = `
SELECT
  COALESCE((SELECT SUM(a."size") FROM "Attachment" a JOIN "Email" e ON e."id" = a."emailId"
            WHERE e."userId" = $1 AND a."key" <> 'PENDING'), 0)::bigint AS "attachmentsBytes",
  COALESCE((SELECT SUM(octet_length(COALESCE(m."subject", '')) + octet_length(COALESCE(m."snippet", '')) + $2::int
                        + CASE WHEN m."htmlKey" IS NOT NULL THEN $3::int ELSE 0 END
                        + CASE WHEN m."textKey" IS NOT NULL THEN $4::int ELSE 0 END)
            FROM "Email" m WHERE m."userId" = $1), 0)::bigint AS "bodiesBytes",
  (SELECT COUNT(*) FROM "Email" c WHERE c."userId" = $1)::bigint AS "emails"`;

export async function loadUsage(userId: string): Promise<{ attachmentsBytes: number; bodiesBytes: number; emails: number }> {
    const rows = (await prisma.$queryRawUnsafe(QUOTA_USAGE_SQL, userId, BODY_ESTIMATE.meta, BODY_ESTIMATE.html, BODY_ESTIMATE.text)) as Array<Record<string, unknown>>;
    const r = rows[0] ?? {};
    return { attachmentsBytes: num(r.attachmentsBytes), bodiesBytes: num(r.bodiesBytes), emails: num(r.emails) };
}

// Cache por usuario (por instancia). El USO cambia con el correo y se recalcula como mucho cada QUOTA_CACHE_TTL_MS. La POLITICA
// (limite por usuario / dominio / entorno, bloqueo) la cambia el administrador y debe verse en otras instancias en <= 5 s: cada
// escritura de cuota sube la version en BD (AdminSetting 'mailQuotaVersion', ver bumpQuotaVersion) y cada instancia compara el
// updatedAt de esa fila con UNA consulta por clave primaria como mucho cada QUOTA_VERSION_CHECK_MS. Si la version cambio, la
// politica se relee (barato) y se reutiliza el uso cacheado. La instancia que escribe invalida su cache al momento.
export const QUOTA_CACHE_TTL_MS = 30_000;
export const QUOTA_VERSION_KEY = 'mailQuotaVersion';
export const QUOTA_VERSION_CHECK_MS = 5_000;

interface CacheEntry { at: number; version: string | null; usage: QuotaUsage; status: QuotaStatus }
interface QuotaUsage { attachmentsBytes: number; bodiesBytes: number; emails: number }
const cache = new Map<string, CacheEntry>();
let versionState: { at: number; value: string | null } | null = null;

/** Solo para pruebas: olvida la version leida (equivale a reiniciar la instancia). */
export function resetQuotaVersionState() { versionState = null; }

export function invalidateQuotaCache(userId?: string) {
    if (userId) { cache.delete(userId); return; }
    cache.clear();
    versionState = null; // la proxima lectura vuelve a preguntar por la version
}

/** Version de la politica (updatedAt de la fila). Como mucho una consulta cada QUOTA_VERSION_CHECK_MS por instancia. */
async function currentQuotaVersion(now: number): Promise<string | null> {
    if (versionState && now >= versionState.at && now - versionState.at < QUOTA_VERSION_CHECK_MS) return versionState.value;
    let value: string | null = versionState?.value ?? null;
    try {
        const rows = (await prisma.$queryRawUnsafe(
            `SELECT ("updatedAt")::text AS "v" FROM "AdminSetting" WHERE "key" = $1`, QUOTA_VERSION_KEY,
        )) as Array<{ v: string }>;
        value = rows[0]?.v ?? null;
    } catch {
        // Sin tabla / sin BD: se conserva la ultima version conocida (el TTL sigue acotando la cache).
    }
    versionState = { at: now, value };
    return value;
}

/**
 * Publica un cambio de politica para las demas instancias: cambia el updatedAt de la fila de version (con microsegundos, aunque haya
 * varias escrituras en el mismo milisegundo). Llamar despues de CUALQUIER escritura de cuota.
 */
export async function bumpQuotaVersion(updatedBy = 'system'): Promise<void> {
    try {
        await prisma.$executeRawUnsafe(
            `INSERT INTO "AdminSetting" ("key", "value", "updatedAt", "updatedBy") VALUES ($1, to_jsonb(md5(random()::text)), clock_timestamp(), $2)
             ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = clock_timestamp(), "updatedBy" = EXCLUDED."updatedBy"`,
            QUOTA_VERSION_KEY, updatedBy.slice(0, 200),
        );
    } catch (error) {
        console.error('[mail-quota] version bump failed:', error instanceof Error ? error.message.slice(0, 200) : 'error');
    }
    invalidateQuotaCache();
}

export async function getQuotaStatus(userId: string, opts: { fresh?: boolean; now?: number } = {}): Promise<QuotaStatus> {
    const now = opts.now ?? Date.now();
    const version = await currentQuotaVersion(now);
    const hit = cache.get(userId);
    if (!opts.fresh && hit && now - hit.at < QUOTA_CACHE_TTL_MS) {
        if (hit.version === version) return hit.status;
        // La politica cambio en otra instancia: se relee (una consulta) y se reutiliza el uso ya calculado.
        const policy = await loadPolicy(userId);
        const status = buildStatus(policy, hit.usage);
        cache.set(userId, { ...hit, version, status });
        return status;
    }
    const [policy, usage] = await Promise.all([loadPolicy(userId), loadUsage(userId)]);
    const status = buildStatus(policy, usage);
    cache.set(userId, { at: now, version, usage, status });
    if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
    return status;
}

// ---------------------------------------------------------------------------
// Vista para la consola: cuota efectiva de un usuario y su origen
// ---------------------------------------------------------------------------

export interface UserQuotaView {
    /** Valor guardado SOLO para este usuario (MB; 0 = sin limite). null = hereda del dominio / entorno. */
    userMb: number | null;
    /** Valor del dominio guardado desde la consola (null = no hay fila). */
    domainMb: number | null;
    /** MAIL_QUOTA_MB del entorno (null = sin definir o invalido). */
    envMb: number | null;
    /** Limite efectivo en MB (null = sin limite). */
    effectiveMb: number | null;
    source: QuotaSource;
}

/** Politica de VARIOS usuarios con dos consultas fijas (fila del dominio + filas por usuario). */
export async function loadQuotaViews(userIds: string[], env: NodeJS.ProcessEnv = process.env): Promise<Map<string, UserQuotaView>> {
    const out = new Map<string, UserQuotaView>();
    if (userIds.length === 0) return out;
    let rows: Array<{ key: string; value: unknown }> = [];
    try {
        rows = (await prisma.$queryRawUnsafe(
            `SELECT "key", "value" FROM "AdminSetting" WHERE "key" = $1 OR "key" = ANY($2::text[])`,
            QUOTA_DOMAIN_KEY, userIds.map((id) => `${QUOTA_USER_KEY_PREFIX}${id}`),
        )) as Array<{ key: string; value: unknown }>;
    } catch {
        rows = [];
    }
    const by = new Map(rows.map((r) => [r.key, r.value]));
    const domain = parseQuotaMb(by.get(QUOTA_DOMAIN_KEY));
    const envParsed = parseQuotaMb(env.MAIL_QUOTA_MB);
    const envMb = envParsed !== undefined && envParsed > 0 ? envParsed : null;
    for (const id of userIds) {
        const user = parseQuotaMb(by.get(`${QUOTA_USER_KEY_PREFIX}${id}`));
        const policy = resolvePolicy({ userMb: user, domainMb: domain, envMb: env.MAIL_QUOTA_MB });
        out.set(id, {
            userMb: user ?? null,
            domainMb: domain ?? null,
            envMb,
            effectiveMb: policy.limitBytes ? Math.round(policy.limitBytes / MB) : null,
            source: policy.source,
        });
    }
    return out;
}

export interface QuotaCheck { blocked: boolean; status: QuotaStatus | null }

/**
 * Comprobacion previa al envio. Solo bloquea si el dominio activo `enforceMailQuota`, hay limite y el uso ya lo alcanza.
 * Falla ABIERTO: un error al calcular la cuota nunca impide enviar.
 */
export async function checkQuotaForSend(userId: string): Promise<QuotaCheck> {
    try {
        const policy = await loadPolicy(userId);
        if (!policy.enforce || !policy.limitBytes) return { blocked: false, status: null };
        const status = buildStatus(policy, await loadUsage(userId));
        return { blocked: status.usedBytes >= (policy.limitBytes as number), status };
    } catch (error) {
        console.error('[mail-quota] check failed (send allowed):', error instanceof Error ? error.message.slice(0, 200) : 'error');
        return { blocked: false, status: null };
    }
}
