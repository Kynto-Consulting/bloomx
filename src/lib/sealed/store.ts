/**
 * Almacen de mensajes sellados (servidor). Guarda SOLO el sobre cifrado por el navegador + metadatos.
 *
 *  - Objeto `secure/<id>.sealed` = encrypt(JSON) con la clave de datos del servidor (defensa en profundidad: oculta
 *    tambien remitente/fechas en reposo; el contenido ya viene cifrado E2E y el servidor no tiene esa clave).
 *  - TTL: `expiresAt` (SECURE_MESSAGE_TTL_DAYS como maximo). Caducado => se borra y responde como inexistente.
 *  - Limite de vistas opcional: cada `consume` (el POST "reveal" del visor) cuenta una vista; al alcanzar el limite
 *    (o al caducar) el objeto se borra del almacenamiento.
 *    La cuenta vive en la tabla `SecureMessageMeta` con un UPDATE atomico (`views = views + 1 WHERE views < maxViews AND
 *    expiresAt > now() RETURNING`): exacta entre instancias (ver meta-db.ts). Si la tabla no existe o la BD falla, se
 *    cae al modo anterior: lectura-modificacion-escritura sobre el objeto con cerrojo en memoria del proceso (con varias
 *    instancias dos lecturas simultaneas podrian superar el limite en 1). `db:ensure` crea la tabla.
 *  - Mensajes legados (`secure/<id>.msg`, texto en claro cifrado con la clave del servidor) siguen siendo legibles.
 */
import type { SealedEnvelope } from './crypto';
import { SECURE_ID_RE } from './schema';
import type { MetaStore } from './meta-db';

export interface SealedRecord {
    v: 2;
    envelope: SealedEnvelope;
    sender: string;
    createdAt: string;
    expiresAt: string;
    maxViews: number | null;
    views: number;
}

export interface StoreDeps {
    get: (key: string) => Promise<string | null | undefined>;
    put: (key: string, body: string) => Promise<unknown>;
    del: (key: string) => Promise<unknown>;
    wrap: (plain: string) => string;
    unwrap: (cipher: string) => string;
    now: () => number;
    newId: () => string;
    /** Contador atomico en BD (opcional: sin el, o con tabla ausente, se usa el conteo dentro del objeto). */
    meta?: MetaStore;
}

export async function defaultDeps(): Promise<StoreDeps> {
    const [storage, encryption, uuid, metaDb, prismaMod] = await Promise.all([
        import('@/lib/storage'), import('@/lib/encryption'), import('uuid'), import('./meta-db'), import('@/lib/prisma'),
    ]);
    return {
        get: (key) => storage.getFromStorage(key),
        put: (key, body) => storage.uploadToStorage(key, body, 'text/plain'),
        del: (key) => storage.deleteFromStorage(key),
        wrap: encryption.encrypt,
        unwrap: encryption.decrypt,
        now: () => Date.now(),
        newId: () => uuid.v4(),
        meta: metaDb.createMetaStore(prismaMod.prisma as any, (e) => console.error('[sealed] meta db error:', String((e as any)?.message || 'error').slice(0, 120))),
    };
}

const sealedKey = (id: string) => `secure/${id}.sealed`;
const legacyKey = (id: string) => `secure/${id}.msg`;

// ---- cerrojo por id (serializa consume/creacion dentro del mismo proceso) ----
const locks = new Map<string, Promise<unknown>>();
export async function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = locks.get(id) || Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const chained = previous.then(() => gate);
    locks.set(id, chained);
    try {
        await previous.catch(() => {});
        return await fn();
    } finally {
        release();
        if (locks.get(id) === chained) locks.delete(id);
    }
}

async function readSealed(deps: StoreDeps, id: string): Promise<SealedRecord | null> {
    const raw = await deps.get(sealedKey(id));
    if (!raw) return null;
    try {
        const rec = JSON.parse(deps.unwrap(raw)) as SealedRecord;
        if (rec?.v !== 2 || !rec.envelope) return null;
        return rec;
    } catch {
        return null;
    }
}

async function readLegacy(deps: StoreDeps, id: string): Promise<{ subject: string; content: string; sender: string; createdAt: string; expiresAt?: string } | null> {
    const raw = await deps.get(legacyKey(id));
    if (!raw) return null;
    try {
        const data = JSON.parse(deps.unwrap(raw));
        return {
            subject: String(data?.subject ?? ''),
            content: String(data?.content ?? ''),
            sender: String(data?.sender ?? ''),
            createdAt: String(data?.createdAt ?? ''),
            expiresAt: data?.expiresAt ? String(data.expiresAt) : undefined,
        };
    } catch {
        return null;
    }
}

export async function createSealed(
    deps: StoreDeps,
    input: { envelope: SealedEnvelope; sender: string; ttlDays: number; maxViews: number | null; userId?: string },
): Promise<{ id: string; expiresAt: string }> {
    const id = deps.newId();
    if (!SECURE_ID_RE.test(id)) throw new Error('invalid id');
    const now = deps.now();
    const record: SealedRecord = {
        v: 2,
        envelope: input.envelope,
        sender: input.sender,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + input.ttlDays * 24 * 3600 * 1000).toISOString(),
        maxViews: input.maxViews,
        views: 0,
    };
    await deps.put(sealedKey(id), deps.wrap(JSON.stringify(record)));
    // Fila de conteo atomico. Si falla/no existe la tabla, el objeto (con maxViews/views) sigue valiendo como respaldo.
    if (deps.meta && input.userId) {
        await deps.meta.insert({ id, userId: input.userId, maxViews: input.maxViews, expiresAt: new Date(record.expiresAt) });
    }
    return { id, expiresAt: record.expiresAt };
}

export interface SecureMeta {
    format: 'sealed' | 'legacy';
    hasPassword: boolean;
    sender: string;
    createdAt: string;
    expiresAt: string | null;
    remainingViews: number | null;
}

/** Metadatos sin contenido y SIN contar vista. null = no existe / caducado / agotado. */
export async function getMeta(deps: StoreDeps, id: string): Promise<SecureMeta | null> {
    if (!SECURE_ID_RE.test(id)) return null;
    const rec = await readSealed(deps, id);
    if (rec) {
        if (new Date(rec.expiresAt).getTime() <= deps.now()) {
            await deps.del(sealedKey(id));
            return null;
        }
        let views = rec.views;
        let maxViews = rec.maxViews;
        const peek = deps.meta ? await deps.meta.peek(id) : null;
        if (peek?.status === 'ok') {
            if (peek.row.expired || (peek.row.maxViews !== null && peek.row.views >= peek.row.maxViews)) {
                await deps.del(sealedKey(id));
                return null;
            }
            views = peek.row.views;
            maxViews = peek.row.maxViews;
        }
        if (maxViews !== null && views >= maxViews) return null;
        return {
            format: 'sealed',
            hasPassword: rec.envelope.pw,
            sender: rec.sender,
            createdAt: rec.createdAt,
            expiresAt: rec.expiresAt,
            remainingViews: maxViews === null ? null : maxViews - views,
        };
    }
    const legacy = await readLegacy(deps, id);
    if (!legacy) return null;
    if (legacy.expiresAt && new Date(legacy.expiresAt).getTime() < deps.now()) return null;
    return { format: 'legacy', hasPassword: false, sender: legacy.sender, createdAt: legacy.createdAt, expiresAt: legacy.expiresAt ?? null, remainingViews: null };
}

export type ConsumeResult =
    | { format: 'sealed'; envelope: SealedEnvelope; sender: string; createdAt: string; expiresAt: string; remainingViews: number | null }
    | { format: 'legacy'; subject: string; content: string; sender: string; createdAt: string }
    | null;

/**
 * Entrega el contenido y cuenta UNA vista (es el "reveal": solo lo llama el POST del visor, nunca un GET). Al agotar las
 * vistas o caducar borra el objeto.
 *
 * Orden: 1) leer el objeto, 2) contar en BD, 3) borrar si era la ultima. Leer ANTES de contar garantiza que quien gana
 * una vista siempre tiene el objeto (el borrado lo hace despues el que consumio la ultima).
 */
export async function consume(deps: StoreDeps, id: string): Promise<ConsumeResult> {
    if (!SECURE_ID_RE.test(id)) return null;

    if (deps.meta) {
        const rec = await readSealed(deps, id);
        if (rec) {
            if (new Date(rec.expiresAt).getTime() <= deps.now()) {
                await deps.del(sealedKey(id));
                return null;
            }
            const c = await deps.meta.consume(id);
            if (c.status === 'exhausted') {
                await deps.del(sealedKey(id));
                return null;
            }
            if (c.status === 'ok') {
                const remaining = c.maxViews === null ? null : Math.max(0, c.maxViews - c.views);
                if (c.maxViews !== null && c.views >= c.maxViews) await deps.del(sealedKey(id));
                return { format: 'sealed', envelope: rec.envelope, sender: rec.sender, createdAt: rec.createdAt, expiresAt: rec.expiresAt, remainingViews: remaining };
            }
            // 'none' (mensaje anterior a la tabla) o 'unavailable': conteo dentro del objeto.
        }
    }
    return consumeInObject(deps, id);
}

async function consumeInObject(deps: StoreDeps, id: string): Promise<ConsumeResult> {
    return withLock(id, async () => {
        const rec = await readSealed(deps, id);
        if (rec) {
            if (new Date(rec.expiresAt).getTime() <= deps.now()) {
                await deps.del(sealedKey(id));
                return null;
            }
            if (rec.maxViews !== null && rec.views >= rec.maxViews) {
                await deps.del(sealedKey(id));
                return null;
            }
            const views = rec.views + 1;
            const remaining = rec.maxViews === null ? null : rec.maxViews - views;
            if (remaining !== null && remaining <= 0) {
                await deps.del(sealedKey(id));
            } else if (rec.maxViews !== null) {
                await deps.put(sealedKey(id), deps.wrap(JSON.stringify({ ...rec, views })));
            }
            return { format: 'sealed', envelope: rec.envelope, sender: rec.sender, createdAt: rec.createdAt, expiresAt: rec.expiresAt, remainingViews: remaining };
        }

        const legacy = await readLegacy(deps, id);
        if (!legacy) return null;
        if (legacy.expiresAt && new Date(legacy.expiresAt).getTime() < deps.now()) return null;
        return { format: 'legacy', subject: legacy.subject, content: legacy.content, sender: legacy.sender, createdAt: legacy.createdAt };
    });
}
