/**
 * source.ts - almacenamiento por trozos para importar/exportar sin cargar archivos enteros en memoria.
 *
 *  - `TransferStorage`: interfaz minima (put/get/del/list) con implementacion real sobre src/lib/storage.ts (S3/B2 o
 *    almacenamiento local) cargada bajo demanda, y doble en memoria para pruebas.
 *  - `ChunkedSource`: ByteSource sobre objetos de tamano fijo (trozo i cubre [i*chunkSize, (i+1)*chunkSize)).
 *  - `ChunkWriter`: escritor anadible (append) que vuelca trozos completos y deja la cola en un objeto, reanudable entre ticks.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ByteSource } from './mbox';

export interface TransferStorage {
    put(key: string, data: Buffer, contentType?: string): Promise<void>;
    get(key: string): Promise<Buffer | null>;
    del(keys: string[]): Promise<void>;
    list(prefix: string): Promise<Array<{ key: string; size: number }>>;
}

export const CHUNK_SIZE = 4 * 1024 * 1024;

export function chunkName(i: number): string {
    return String(i).padStart(6, '0');
}

/** Implementacion real (lazy: importar storage.ts exige variables de entorno validas). */
export function realStorage(): TransferStorage {
    return {
        async put(key, data, contentType = 'application/octet-stream') {
            const { uploadToStorage } = await import('@/lib/storage');
            await uploadToStorage(key, data, contentType);
        },
        async get(key) {
            const { getBufferFromStorage } = await import('@/lib/storage');
            return getBufferFromStorage(key);
        },
        async del(keys) {
            const { deleteManyFromStorage } = await import('@/lib/storage');
            await deleteManyFromStorage(keys);
        },
        async list(prefix) {
            const { listStorageObjects } = await import('@/lib/storage');
            const objs = await listStorageObjects(prefix, 100_000);
            return objs.map((o) => ({ key: o.key, size: o.size ?? 0 }));
        },
    };
}

/** Doble en memoria (pruebas). */
export function memoryStorage(): TransferStorage & { objects: Map<string, Buffer> } {
    const objects = new Map<string, Buffer>();
    return {
        objects,
        async put(key, data) { objects.set(key, Buffer.from(data)); },
        async get(key) { const v = objects.get(key); return v ? Buffer.from(v) : null; },
        async del(keys) { for (const k of keys) objects.delete(k); },
        async list(prefix) {
            return [...objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, size: v.length })).sort((a, b) => a.key.localeCompare(b.key));
        },
    };
}

/**
 * Almacenamiento en un directorio local (pruebas de volumen y `scripts/bench-mail-transfer.mjs`): mismo contrato que realStorage()
 * pero sin depender de variables de entorno ni cargar los objetos en memoria mientras no se lean. Las claves nunca salen de `root`.
 */
export function fsStorage(root: string): TransferStorage {
    const base = path.resolve(root);
    const full = (key: string) => {
        const p = path.resolve(base, key);
        if (p !== base && !p.startsWith(base + path.sep)) throw new Error('Invalid storage key');
        return p;
    };
    return {
        async put(key, data) {
            const f = full(key);
            await fs.promises.mkdir(path.dirname(f), { recursive: true });
            await fs.promises.writeFile(f, data);
        },
        async get(key) {
            try { return await fs.promises.readFile(full(key)); } catch { return null; }
        },
        async del(keys) {
            await Promise.all(keys.map((k) => fs.promises.unlink(full(k)).catch(() => undefined)));
        },
        async list(prefix) {
            const out: Array<{ key: string; size: number }> = [];
            const walk = async (dir: string) => {
                let entries: fs.Dirent[] = [];
                try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
                for (const e of entries) {
                    const p = path.join(dir, e.name);
                    if (e.isDirectory()) await walk(p);
                    else {
                        const key = path.relative(base, p).split(path.sep).join('/');
                        if (key.startsWith(prefix)) out.push({ key, size: (await fs.promises.stat(p)).size });
                    }
                }
            };
            await walk(base);
            return out.sort((a, b) => (a.key < b.key ? -1 : 1));
        },
    };
}

/** ByteSource sobre trozos `${prefix}/${000000}`; `size` total declarado. */
export class ChunkedSource implements ByteSource {
    private cache = new Map<number, Buffer>();

    constructor(
        private storage: TransferStorage,
        private prefix: string,
        public readonly size: number,
        private chunkSize = CHUNK_SIZE,
    ) {}

    private async chunk(i: number): Promise<Buffer> {
        const hit = this.cache.get(i);
        if (hit) return hit;
        const buf = await this.storage.get(`${this.prefix}/${chunkName(i)}`);
        if (!buf) throw new Error('chunk_missing');
        const expected = Math.min(this.chunkSize, this.size - i * this.chunkSize);
        if (buf.length !== expected) throw new Error('chunk_size_mismatch');
        if (this.cache.size >= 3) this.cache.delete(this.cache.keys().next().value as number);
        this.cache.set(i, buf);
        return buf;
    }

    async read(offset: number, length: number): Promise<Buffer> {
        if (offset >= this.size || length <= 0) return Buffer.alloc(0);
        const end = Math.min(this.size, offset + length);
        const first = Math.floor(offset / this.chunkSize);
        const last = Math.floor((end - 1) / this.chunkSize);
        if (first === last) {
            const c = await this.chunk(first);
            return c.subarray(offset - first * this.chunkSize, end - first * this.chunkSize);
        }
        const parts: Buffer[] = [];
        for (let i = first; i <= last; i++) {
            const c = await this.chunk(i);
            const from = i === first ? offset - i * this.chunkSize : 0;
            const to = i === last ? end - i * this.chunkSize : c.length;
            parts.push(c.subarray(from, to));
        }
        return Buffer.concat(parts);
    }
}

/**
 * Escritor anadible: acumula bytes y escribe trozos de `chunkSize` exactos como `${prefix}/${000000}`. La cola (< chunkSize)
 * se guarda al final de cada tick con `flushTail()` en `${prefix}.tail` y se recupera con `resume()`.
 */
export class ChunkWriter {
    private pending: Buffer[] = [];
    private pendingBytes = 0;
    /** Siguiente indice de trozo a escribir. */
    nextChunk: number;
    /** Bytes totales escritos (trozos completos) + cola. */
    totalBytes: number;

    /** Version de la cola: cada tick escribe `.tail<v+1>` y solo despues de guardar el cursor se borra la anterior (seguro ante caidas). */
    tailVersion: number;

    constructor(private storage: TransferStorage, private prefix: string, state: { nextChunk: number; totalBytes: number; tailVersion?: number } = { nextChunk: 0, totalBytes: 0 }, private chunkSize = CHUNK_SIZE) {
        this.nextChunk = state.nextChunk;
        this.totalBytes = state.totalBytes;
        this.tailVersion = state.tailVersion ?? 0;
    }

    private tailKey(v: number) { return `${this.prefix}.tail${v}`; }

    /** Recupera la cola guardada (solo si el estado indica bytes en la cola). */
    async resume(): Promise<void> {
        const full = this.nextChunk * this.chunkSize;
        const tailBytes = this.totalBytes - full;
        if (tailBytes > 0) {
            const tail = await this.storage.get(this.tailKey(this.tailVersion));
            if (!tail || tail.length !== tailBytes) throw new Error('tail_missing');
            this.pending = [tail];
            this.pendingBytes = tail.length;
        }
    }

    async write(data: Buffer): Promise<void> {
        if (data.length === 0) return;
        this.pending.push(data);
        this.pendingBytes += data.length;
        this.totalBytes += data.length;
        while (this.pendingBytes >= this.chunkSize) {
            const all = this.pending.length === 1 ? this.pending[0] : Buffer.concat(this.pending);
            const chunk = all.subarray(0, this.chunkSize);
            const rest = all.subarray(this.chunkSize);
            await this.storage.put(`${this.prefix}/${chunkName(this.nextChunk)}`, Buffer.from(chunk));
            this.nextChunk++;
            this.pending = rest.length ? [rest] : [];
            this.pendingBytes = rest.length;
        }
    }

    /** Guarda la cola para poder reanudar en otra invocacion. */
    async flushTail(): Promise<void> {
        if (this.pendingBytes > 0) {
            const tail = this.pending.length === 1 ? this.pending[0] : Buffer.concat(this.pending);
            this.tailVersion++;
            await this.storage.put(this.tailKey(this.tailVersion), tail);
        }
    }

    /** Borra colas antiguas (llamar DESPUES de persistir el cursor). */
    async dropOldTails(): Promise<void> {
        const old: string[] = [];
        for (let v = Math.max(0, this.tailVersion - 3); v < this.tailVersion; v++) old.push(this.tailKey(v));
        if (old.length) await this.storage.del(old).catch(() => undefined);
    }

    /** Cierra: escribe el ultimo trozo parcial (si lo hay) y devuelve el tamano total. */
    async finish(): Promise<number> {
        if (this.pendingBytes > 0) {
            const all = this.pending.length === 1 ? this.pending[0] : Buffer.concat(this.pending);
            await this.storage.put(`${this.prefix}/${chunkName(this.nextChunk)}`, Buffer.from(all));
            this.nextChunk++;
            this.pending = [];
            this.pendingBytes = 0;
        }
        await this.storage.del(Array.from({ length: this.tailVersion + 1 }, (_, v) => this.tailKey(v))).catch(() => undefined);
        return this.totalBytes;
    }

    state(): { nextChunk: number; totalBytes: number; tailVersion: number } {
        return { nextChunk: this.nextChunk, totalBytes: this.totalBytes, tailVersion: this.tailVersion };
    }
}
