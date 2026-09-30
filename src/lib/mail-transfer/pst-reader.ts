/**
 * pst-reader.ts - lectura de un PST POR RANGOS sin copiarlo a disco ni cargarlo entero.
 *
 * pst-extractor lee siempre por una unica funcion SINCRONA, `PSTFile.readSync(buffer, length, position)` (dist/PSTFile.class.js;
 * todos los `read`, `readCompletely`, `seek`+lectura pasan por ella). El almacenamiento (S3/B2) es asincrono y no se puede
 * bloquear el hilo principal esperando una promesa. Solucion sin Worker ni SharedArrayBuffer:
 *
 *   1. `RangePstFile` (subclase de PSTFile) sobreescribe `readSync` y sirve los bytes desde una cache LRU de trozos de 4 MiB.
 *   2. Si el trozo no esta en cache, registra el fallo (`missing`) y lanza `PstNeedChunk`.
 *   3. `runWithReader` ejecuta una unidad de trabajo SINCRONA (abrir el PST, o convertir UN mensaje); si hubo fallo (aunque la
 *      libreria haya tragado la excepcion en un try/catch, por eso se mira la marca y no solo la excepcion) DESCARTA el resultado y
 *      todos los objetos PST (algunos cachean estado parcial, p. ej. PSTFolder.initEmailsTable cae a una tabla alternativa ante
 *      cualquier error), espera al trozo (async) y reintenta la unidad desde cero. Cada reintento carga un trozo nuevo, asi que
 *      siempre avanza; los trozos usados por la unidad en curso quedan "fijados" para que la LRU no los expulse (sin livelock).
 *
 * Memoria: <= maxCached trozos (por defecto 24 x 4 MiB = 96 MiB) + los fijados por una sola unidad (tope maxPinned).
 */
import { ArchiveError } from './zip';
import { CHUNK_SIZE } from './source';

/** Se lanza desde readSync cuando el trozo no esta en cache. */
export class PstNeedChunk extends Error {
    constructor(public readonly chunk: number) {
        super('pst_need_chunk');
    }
}

/** Error genuino (no de lectura ausente) lanzado por la unidad de trabajo: PST corrupto/ilegible. */
export class PstFnError extends Error {
    constructor(public readonly original: unknown) {
        super('pst_fn_error');
    }
}

export interface RangeSource {
    readonly size: number;
    read(offset: number, length: number): Promise<Buffer>;
}

export interface PstReaderStats {
    hits: number;
    misses: number;
    fetched: number;
    bytesFetched: number;
    peakCachedChunks: number;
    retries: number;
}

export class PstRangeReader {
    private cache = new Map<number, Buffer>();
    private touched = new Set<number>();
    private missing: number | null = null;
    readonly stats: PstReaderStats = { hits: 0, misses: 0, fetched: 0, bytesFetched: 0, peakCachedChunks: 0, retries: 0 };

    constructor(
        private source: RangeSource,
        private opts: { chunkSize?: number; maxCached?: number; maxPinned?: number } = {},
    ) {}

    get size() { return this.source.size; }
    private get chunkSize() { return this.opts.chunkSize ?? CHUNK_SIZE; }
    private get maxCached() { return this.opts.maxCached ?? 24; }
    private get maxPinned() { return this.opts.maxPinned ?? 96; }
    get cachedChunks() { return this.cache.size; }

    /** Semantica de fs.readSync: devuelve los bytes leidos (menos que `length` solo al final del archivo). */
    readSync(buffer: Buffer, length: number, position: number): number {
        // Envenenado: tras un fallo, cualquier lectura posterior del mismo intento falla (evita seguir con datos a medias)
        if (this.missing !== null) throw new PstNeedChunk(this.missing);
        const size = this.source.size;
        if (!Number.isFinite(position) || position < 0 || position >= size || length <= 0) return 0;
        const end = Math.min(size, position + length);
        const cs = this.chunkSize;
        const first = Math.floor(position / cs);
        const last = Math.floor((end - 1) / cs);
        // Primero se comprueba que estan todos (no copiar a medias)
        for (let i = first; i <= last; i++) {
            if (!this.cache.has(i)) {
                this.stats.misses++;
                this.missing = i;
                throw new PstNeedChunk(i);
            }
        }
        let written = 0;
        for (let i = first; i <= last; i++) {
            const c = this.cache.get(i)!;
            this.cache.delete(i); // LRU: reinsertar al final
            this.cache.set(i, c);
            this.touched.add(i);
            const from = i === first ? position - i * cs : 0;
            const to = i === last ? end - i * cs : c.length;
            c.copy(buffer, written, from, to);
            written += to - from;
            this.stats.hits++;
        }
        return written;
    }

    /** Inicio de una unidad de trabajo: los trozos que use quedan fijados hasta la siguiente. */
    beginUnit() { this.touched.clear(); this.missing = null; }
    clearMiss() { this.missing = null; }
    takeMiss(): number | null { const m = this.missing; this.missing = null; return m; }

    async load(i: number): Promise<void> {
        if (this.cache.has(i)) { this.touched.add(i); return; }
        const cs = this.chunkSize;
        const len = Math.min(cs, this.source.size - i * cs);
        if (len <= 0) throw new ArchiveError('pst_unreadable');
        const buf = await this.source.read(i * cs, len);
        this.stats.fetched++;
        this.stats.bytesFetched += buf.length;
        this.cache.set(i, buf);
        this.touched.add(i);
        if (this.touched.size > this.maxPinned) throw new ArchiveError('pst_unreadable');
        for (const k of this.cache.keys()) {
            if (this.cache.size <= this.maxCached) break;
            if (!this.touched.has(k)) this.cache.delete(k);
        }
        this.stats.peakCachedChunks = Math.max(this.stats.peakCachedChunks, this.cache.size);
    }
}

/**
 * Ejecuta `fn` (sincrona, sin efectos externos) hasta que termine sin fallos de lectura. `discard` debe olvidar todo objeto PST
 * creado antes (se reconstruyen dentro de `fn`). Los errores que no vienen de un trozo ausente se propagan tal cual.
 */
export async function runWithReader<T>(reader: PstRangeReader, fn: () => T, discard: () => void, maxRetries = 4096): Promise<T> {
    reader.beginUnit();
    for (let tries = 0; ; tries++) {
        reader.clearMiss();
        let out: T | undefined;
        let err: unknown;
        let threw = false;
        // pst-extractor escribe con console.error/log dentro de sus try/catch. `fn` es sincrona (nada mas se ejecuta mientras
        // tanto), asi que se captura y solo se reproduce si el intento fue bueno (un reintento por trozo ausente no debe hacer ruido).
        const logged: Array<['error' | 'log' | 'warn', unknown[]]> = [];
        const orig = { error: console.error, log: console.log, warn: console.warn };
        console.error = (...a: unknown[]) => { logged.push(['error', a]); };
        console.log = (...a: unknown[]) => { logged.push(['log', a]); };
        console.warn = (...a: unknown[]) => { logged.push(['warn', a]); };
        try { out = fn(); } catch (e) { err = e; threw = true; } finally {
            console.error = orig.error; console.log = orig.log; console.warn = orig.warn;
        }
        const miss = reader.takeMiss();
        if (miss === null) {
            for (const [k, a] of logged.slice(0, 20)) orig[k](...a);
            if (threw) throw new PstFnError(err);
            return out as T;
        }
        discard();
        reader.stats.retries++;
        if (tries >= maxRetries) throw new ArchiveError('pst_unreadable');
        await reader.load(miss);
    }
}

// --- Subclase de PSTFile ---------------------------------------------------------------------------------------------------
let activeReader: PstRangeReader | null = null;

/** Crea (una vez por clase base) la subclase que lee del PstRangeReader en vez de un fd o un Buffer. */
export function makeRangePstClass(PSTFile: any): new (reader: PstRangeReader) => any {
    class RangePstFile extends (PSTFile as new (b: Buffer) => any) {
        declare __reader: PstRangeReader;
        constructor(reader: PstRangeReader) {
            // La cabecera se lee dentro de super(): el lector se pasa por variable de modulo (mismo hilo, sincrono)
            activeReader = reader;
            super(Buffer.alloc(0));
            activeReader = null;
            this.__reader = reader;
        }
        readSync(buffer: Buffer, length: number, position: any): number {
            const r = this.__reader ?? activeReader;
            if (!r) throw new Error('pst_reader_missing');
            const pos = typeof position === 'number' ? position : typeof position?.toNumber === 'function' ? position.toNumber() : Number(position);
            return r.readSync(buffer, length, pos);
        }
        close(): void { /* sin fd */ }
    }
    return RangePstFile as any;
}
