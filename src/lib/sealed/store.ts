/**
 * Almacen de mensajes sellados (servidor). Guarda SOLO el sobre cifrado por el navegador + metadatos.
 *
 *  - Objeto `secure/<id>.sealed` = encrypt(JSON) con la clave de datos del servidor (defensa en profundidad: oculta
 *    tambien remitente/fechas en reposo; el contenido ya viene cifrado E2E y el servidor no tiene esa clave).
 *  - TTL: `expiresAt` (SECURE_MESSAGE_TTL_DAYS como maximo). Caducado => se borra y responde como inexistente.
 *  - Limite de vistas opcional: cada `consume` cuenta una vista; al alcanzar el limite el objeto se borra.
 *    LIMITE CONOCIDO: la cuenta es lectura-modificacion-escritura sobre el objeto, serializada por un cerrojo en
 *    memoria del proceso. Con varias instancias serverless dos lecturas simultaneas podrian superar el limite en 1.
 *    Para garantia estricta hay que moverlo a una tabla con UPDATE atomico.
 *  - Mensajes legados (`secure/<id>.msg`, texto en claro cifrado con la clave del servidor) siguen siendo legibles.
 */
import type { SealedEnvelope } from './crypto';
import { SECURE_ID_RE } from './schema';

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
}

export async function defaultDeps(): Promise<StoreDeps> {
    const [storage, encryption, uuid] = await Promise.all([import('@/lib/storage'), import('@/lib/encryption'), import('uuid')]);
    return {
        get: (key) => storage.getFromStorage(key),
        put: (key, body) => storage.uploadToStorage(key, body, 'text/plain'),
        del: (key) => storage.deleteFromStorage(key),
        wrap: encryption.encrypt,
        unwrap: encryption.decrypt,
        now: () => Date.now(),
        newId: () => uuid.v4(),
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
    input: { envelope: SealedEnvelope; sender: string; ttlDays: number; maxViews: number | null },
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
        if (rec.maxViews !== null && rec.views >= rec.maxViews) return null;
        return {
            format: 'sealed',
            hasPassword: rec.envelope.pw,
            sender: rec.sender,
            createdAt: rec.createdAt,
            expiresAt: rec.expiresAt,
            remainingViews: rec.maxViews === null ? null : rec.maxViews - rec.views,
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

/** Entrega el contenido y cuenta UNA vista. Al agotar las vistas borra el objeto. */
export async function consume(deps: StoreDeps, id: string): Promise<ConsumeResult> {
    if (!SECURE_ID_RE.test(id)) return null;
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
