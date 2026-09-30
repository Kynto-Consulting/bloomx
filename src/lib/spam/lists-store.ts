/**
 * Persistencia de las listas (tabla SpamList). Todo parametrizado; tolerante a tabla ausente (sin ella las listas estan vacias y
 * el correo sigue entrando). Tope por lista (ambito + propietario + tipo) con candado de transaccion para que dos altas
 * concurrentes no lo superen.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { execute, isMissingRelation, num, query, toIso } from '@/lib/admin/sql';
import {
    CompiledList, MAX_EXTERNAL_ENTRIES, MAX_LIST_ENTRIES, blockGuard, dedupeKey, normalizeEntry,
    type ListEntry, type ListEntryInput, type ListKind, type ListScope, type MatchType, type Protected,
} from './lists-core';

export const SPAM_LIST_VERSION_KEY = 'spamListVersion';
export const LIST_CACHE_TTL_MS = 30_000;
export const LIST_VERSION_CHECK_MS = 5_000;

export const limitFor = (kind: ListKind) => (kind === 'external' ? MAX_EXTERNAL_ENTRIES : MAX_LIST_ENTRIES);
export const DOMAIN_OWNER = 'domain';

interface Row {
    id: string; scope: string; ownerKey: string; kind: string; matchType: string; value: string; includeSubdomains: boolean; reason: string | null;
    expiresAt: Date | string | null; createdBy: string | null; hits: number | bigint; lastHitAt: Date | string | null; createdAt: Date | string;
}
const toEntry = (r: Row): ListEntry => ({
    id: r.id, scope: r.scope as ListScope, ownerKey: r.ownerKey, kind: r.kind as ListKind, matchType: r.matchType as MatchType, value: r.value,
    includeSubdomains: !!r.includeSubdomains, reason: r.reason, expiresAt: r.expiresAt ? new Date(r.expiresAt) : null, createdBy: r.createdBy,
    hits: num(r.hits), lastHitAt: r.lastHitAt ? new Date(r.lastHitAt) : null, createdAt: new Date(r.createdAt),
});
const COLS = `"id","scope","ownerKey","kind","matchType","value","includeSubdomains","reason","expiresAt","createdBy","hits","lastHitAt","createdAt"`;

// ---------------------------------------------------------------------------
// Cache de listas compiladas + version
// ---------------------------------------------------------------------------
const compiled = new Map<string, { at: number; version: string | null; list: CompiledList }>();
let versionState: { at: number; value: string | null } | null = null;

export function invalidateListCache(scope?: ListScope, ownerKey?: string) {
    if (!scope) { compiled.clear(); versionState = null; return; }
    for (const k of [...compiled.keys()]) if (k.startsWith(`${scope}|${ownerKey ?? ''}`)) compiled.delete(k);
    if (scope === 'domain') versionState = null;
}

async function listVersion(now: number): Promise<string | null> {
    if (versionState && now >= versionState.at && now - versionState.at < LIST_VERSION_CHECK_MS) return versionState.value;
    let value = versionState?.value ?? null;
    try {
        const rows = await query<{ v: string }>(`SELECT ("updatedAt")::text AS "v" FROM "AdminSetting" WHERE "key" = $1`, SPAM_LIST_VERSION_KEY);
        value = rows[0]?.v ?? null;
    } catch { /* sin tabla */ }
    versionState = { at: now, value };
    return value;
}

export async function bumpListVersion(actor = 'system'): Promise<void> {
    try {
        await execute(
            `INSERT INTO "AdminSetting" ("key", "value", "updatedAt", "updatedBy") VALUES ($1, to_jsonb(md5(random()::text)), clock_timestamp(), $2)
             ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = clock_timestamp(), "updatedBy" = EXCLUDED."updatedBy"`,
            SPAM_LIST_VERSION_KEY, actor.slice(0, 200),
        );
    } catch (error) {
        console.error('[spam-lists] version bump failed:', error instanceof Error ? error.message.slice(0, 200) : 'error');
    }
    invalidateListCache();
}

/** Lista compilada (cache <= 30 s; la del dominio se invalida ademas por version en BD). Sin tabla: lista vacia. */
export async function getCompiledList(scope: ListScope, ownerKey: string, kind: ListKind, now = Date.now()): Promise<CompiledList> {
    const key = `${scope}|${ownerKey}|${kind}`;
    const version = scope === 'domain' ? await listVersion(now) : null;
    const hit = compiled.get(key);
    if (hit && now - hit.at < LIST_CACHE_TTL_MS && hit.version === version) return hit.list;
    let list: CompiledList;
    try {
        const rows = await query<Row>(
            `SELECT ${COLS} FROM "SpamList" WHERE "scope" = $1 AND "ownerKey" = $2 AND "kind" = $3 AND ("expiresAt" IS NULL OR "expiresAt" > NOW()) LIMIT $4`,
            scope, ownerKey, kind, limitFor(kind),
        );
        list = new CompiledList(rows.map(toEntry), new Date(now));
    } catch (error) {
        if (!isMissingRelation(error)) console.error('[spam-lists] load failed:', error instanceof Error ? error.message.slice(0, 200) : 'error');
        list = new CompiledList([]);
    }
    compiled.set(key, { at: now, version, list });
    if (compiled.size > 5000) compiled.delete(compiled.keys().next().value as string);
    return list;
}

// ---------------------------------------------------------------------------
// Lectura para la consola / ajustes
// ---------------------------------------------------------------------------
export interface ListQuery {
    scope: ListScope; ownerKey: string; kind: ListKind;
    q?: string; matchType?: MatchType; status?: 'active' | 'expired' | 'all';
    page?: number; pageSize?: number; sort?: 'createdAt' | 'hits' | 'value' | 'expiresAt';
}

const SORT_SQL = { createdAt: `"createdAt" DESC, "id" DESC`, hits: `"hits" DESC, "id" ASC`, value: `"value" ASC, "id" ASC`, expiresAt: `"expiresAt" ASC NULLS LAST, "id" ASC` } as const;

export async function listEntries(qy: ListQuery): Promise<{ rows: ListEntry[]; total: number; limit: number }> {
    const page = Math.max(1, Math.floor(qy.page ?? 1));
    const size = Math.min(200, Math.max(1, Math.floor(qy.pageSize ?? 50)));
    const params: unknown[] = [qy.scope, qy.ownerKey, qy.kind];
    let where = `"scope" = $1 AND "ownerKey" = $2 AND "kind" = $3`;
    if (qy.q) { params.push(`%${qy.q.replace(/[\\%_]/g, (c) => `\\${c}`).slice(0, 100)}%`); where += ` AND ("value" ILIKE $${params.length} OR COALESCE("reason", '') ILIKE $${params.length})`; }
    if (qy.matchType) { params.push(qy.matchType); where += ` AND "matchType" = $${params.length}`; }
    if (qy.status === 'active') where += ` AND ("expiresAt" IS NULL OR "expiresAt" > NOW())`;
    else if (qy.status === 'expired') where += ` AND "expiresAt" IS NOT NULL AND "expiresAt" <= NOW()`;
    try {
        const total = num((await query<{ n: bigint }>(`SELECT COUNT(*) AS n FROM "SpamList" WHERE ${where}`, ...params))[0]?.n);
        const rows = await query<Row>(
            `SELECT ${COLS} FROM "SpamList" WHERE ${where} ORDER BY ${SORT_SQL[qy.sort ?? 'createdAt']} LIMIT ${size} OFFSET ${(page - 1) * size}`, ...params,
        );
        return { rows: rows.map(toEntry), total, limit: limitFor(qy.kind) };
    } catch (error) {
        if (isMissingRelation(error)) return { rows: [], total: 0, limit: limitFor(qy.kind) };
        throw error;
    }
}

export async function exportEntries(scope: ListScope, ownerKey: string, kind: ListKind): Promise<ListEntry[]> {
    try {
        const rows = await query<Row>(`SELECT ${COLS} FROM "SpamList" WHERE "scope" = $1 AND "ownerKey" = $2 AND "kind" = $3 ORDER BY "createdAt" ASC, "id" ASC LIMIT $4`, scope, ownerKey, kind, limitFor(kind));
        return rows.map(toEntry);
    } catch (error) {
        if (isMissingRelation(error)) return [];
        throw error;
    }
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------
export interface AddResult {
    added: number;
    duplicates: number;
    invalid: Array<{ index: number; error: string }>;
    /** Se alcanzo el tope: las entradas restantes no se anadieron. */
    limitReached: boolean;
}

export class ListStoreError extends Error {
    constructor(public code: 'storage_unavailable') { super(code); }
}

export interface AddOptions { scope: ListScope; ownerKey: string; kind: ListKind; actor: string; guard?: Protected | null; now?: Date }

/** Alta masiva atomica por lista: valida, deduplica (dentro del lote y contra la BD), aplica guardas y respeta el tope. */
export async function addEntries(inputs: ListEntryInput[], opts: AddOptions): Promise<AddResult> {
    const now = opts.now ?? new Date();
    const result: AddResult = { added: 0, duplicates: 0, invalid: [], limitReached: false };
    const batch: Array<{ id: string; n: Extract<ReturnType<typeof normalizeEntry>, { ok: true }> }> = [];
    const seen = new Set<string>();
    inputs.forEach((input, index) => {
        const n = normalizeEntry(input, now);
        if (!n.ok) { result.invalid.push({ index, error: n.error }); return; }
        // La whitelist de externos viaja al navegador: sin regex (se evaluaria alli)
        if (opts.kind === 'external' && n.matchType === 'regex') { result.invalid.push({ index, error: 'regex_not_allowed' }); return; }
        if (opts.kind === 'block' && opts.guard) {
            const g = blockGuard(n, opts.guard);
            if (g) { result.invalid.push({ index, error: g }); return; }
        }
        const k = dedupeKey(n);
        if (seen.has(k)) { result.duplicates++; return; }
        seen.add(k);
        batch.push({ id: randomUUID(), n });
    });
    if (batch.length === 0) return result;
    const lockKey = `spamlist:${opts.scope}:${opts.ownerKey}:${opts.kind}`;
    try {
        await prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, lockKey);
            const current = num(((await tx.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM "SpamList" WHERE "scope" = $1 AND "ownerKey" = $2 AND "kind" = $3`, opts.scope, opts.ownerKey, opts.kind)) as Array<{ n: bigint }>)[0]?.n);
            let room = limitFor(opts.kind) - current;
            for (const b of batch) {
                if (room <= 0) { result.limitReached = true; break; }
                const n = await tx.$executeRawUnsafe(
                    `INSERT INTO "SpamList" ("id","scope","ownerKey","kind","matchType","value","includeSubdomains","reason","expiresAt","createdBy")
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
                    b.id, opts.scope, opts.ownerKey, opts.kind, b.n.matchType, b.n.value, b.n.includeSubdomains, b.n.reason, b.n.expiresAt, opts.actor.slice(0, 200),
                );
                if (Number(n) > 0) { result.added++; room--; } else result.duplicates++;
            }
        }, { timeout: 60_000, maxWait: 15_000 });
    } catch (error) {
        if (isMissingRelation(error)) throw new ListStoreError('storage_unavailable');
        throw error;
    }
    invalidateListCache(opts.scope, opts.ownerKey);
    if (opts.scope === 'domain') await bumpListVersion(opts.actor);
    return result;
}

/** Borra una entrada del propietario indicado (nunca de otro: el ambito y el propietario van en el WHERE). */
export async function deleteEntry(id: string, scope: ListScope, ownerKey: string, actor = 'system'): Promise<boolean> {
    try {
        const n = await execute(`DELETE FROM "SpamList" WHERE "id" = $1 AND "scope" = $2 AND "ownerKey" = $3`, id, scope, ownerKey);
        if (n > 0) { invalidateListCache(scope, ownerKey); if (scope === 'domain') await bumpListVersion(actor); }
        return n > 0;
    } catch (error) {
        if (isMissingRelation(error)) return false;
        throw error;
    }
}

export async function deleteEntries(ids: string[], scope: ListScope, ownerKey: string, actor = 'system'): Promise<number> {
    if (ids.length === 0) return 0;
    try {
        const n = await execute(`DELETE FROM "SpamList" WHERE "id" = ANY($1::text[]) AND "scope" = $2 AND "ownerKey" = $3`, ids.slice(0, 1000), scope, ownerKey);
        if (n > 0) { invalidateListCache(scope, ownerKey); if (scope === 'domain') await bumpListVersion(actor); }
        return n;
    } catch (error) {
        if (isMissingRelation(error)) return 0;
        throw error;
    }
}

export async function clearList(scope: ListScope, ownerKey: string, kind: ListKind, actor = 'system'): Promise<number> {
    try {
        const n = await execute(`DELETE FROM "SpamList" WHERE "scope" = $1 AND "ownerKey" = $2 AND "kind" = $3`, scope, ownerKey, kind);
        invalidateListCache(scope, ownerKey);
        if (scope === 'domain') await bumpListVersion(actor);
        return n;
    } catch (error) {
        if (isMissingRelation(error)) return 0;
        throw error;
    }
}

/** Cuenta un acierto (mejor esfuerzo: nunca rompe la entrada del correo). */
export async function recordHits(ids: string[]): Promise<void> {
    const uniq = [...new Set(ids)].slice(0, 50);
    if (uniq.length === 0) return;
    try {
        await execute(`UPDATE "SpamList" SET "hits" = "hits" + 1, "lastHitAt" = NOW() WHERE "id" = ANY($1::text[])`, uniq);
    } catch (error) {
        if (!isMissingRelation(error)) console.error('[spam-lists] hit count failed:', error instanceof Error ? error.message.slice(0, 200) : 'error');
    }
}

/** Datos de una entrada por id (para el registro: tipo/valor de la regla que acerto). */
export async function describeEntries(ids: string[]): Promise<Map<string, { matchType: string; value: string; scope: string; kind: string }>> {
    const out = new Map<string, { matchType: string; value: string; scope: string; kind: string }>();
    if (ids.length === 0) return out;
    try {
        const rows = await query<{ id: string; matchType: string; value: string; scope: string; kind: string }>(`SELECT "id","matchType","value","scope","kind" FROM "SpamList" WHERE "id" = ANY($1::text[])`, ids.slice(0, 500));
        for (const r of rows) out.set(r.id, r);
    } catch { /* sin tabla */ }
    return out;
}

/** Retira entradas caducadas hace mas de `days` dias (mantenimiento oportunista). */
export async function purgeExpired(days = 30): Promise<number> {
    try {
        return await execute(`DELETE FROM "SpamList" WHERE "expiresAt" IS NOT NULL AND "expiresAt" < NOW() - ($1::int * INTERVAL '1 day')`, days);
    } catch { return 0; }
}

export { toIso };
