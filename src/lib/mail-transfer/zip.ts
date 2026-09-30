/**
 * zip.ts - lectura SEGURA (directorio central + extraccion por entrada, con limites) y escritura de ZIP/ZIP64 con fflate.
 * Tambien gzip y tar (Google Takeout puede entregar .tgz).
 *
 * Defensas (entrada no confiable):
 *  - zip-slip: nombres normalizados con safeArchivePath (sin "..", rutas absolutas, unidad, NUL, control, profundidad excesiva);
 *  - zip-bomb: se exige tamano declarado <= limite, razon de compresion acotada y se CUENTAN los bytes realmente inflados
 *    (nunca se confia en la cabecera); la entrada se inflate en trozos de 16 KiB (maximo ~16 MiB por trozo: deflate 1032:1);
 *  - enlaces simbolicos: se marcan y se omiten (ademas nunca se escribe en un sistema de archivos);
 *  - entradas cifradas: rechazadas; nº de entradas y tamano del directorio central acotados.
 */
import { crc32 as nativeCrc32 } from 'node:zlib';
import { Gunzip, Inflate, deflateSync } from 'fflate';
import type { ByteSource } from './mbox';
import { safeArchivePath } from './formats';
import { ZipCryptoError, parseAesExtra, winzipAesDecryptor, zipCryptoDecryptor, type AesParams, type ZipDecryptor } from './zip-crypto';

export interface ZipLimits {
    maxEntries: number;
    maxEntryBytes: number;
    maxTotalBytes: number;
    /** Razon maxima usize/csize para entradas > 1 MiB. */
    maxRatio: number;
    maxDirectoryBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
    maxEntries: 200_000,
    maxEntryBytes: 1024 * 1024 * 1024,
    maxTotalBytes: 40 * 1024 * 1024 * 1024,
    maxRatio: 600,
    maxDirectoryBytes: 96 * 1024 * 1024,
};

export class ArchiveError extends Error {
    constructor(public code: string, message?: string) {
        super(message ?? code);
        this.name = 'ArchiveError';
    }
}

export interface ZipEntry {
    /** Nombre original (para informar). */
    rawName: string;
    /** Ruta normalizada y segura, o null si se rechaza. */
    path: string | null;
    method: number;
    compressedSize: number;
    size: number;
    crc: number;
    offset: number;
    isDirectory: boolean;
    isSymlink: boolean;
    encrypted: boolean;
    /** Tipo de cifrado: ZipCrypto (tradicional) o WinZip AES; null si la entrada no esta cifrada. */
    encKind: 'zipcrypto' | 'aes' | null;
    aes: AesParams | null;
    /** Banderas generales y hora DOS (byte de comprobacion de ZipCrypto con data descriptor). */
    flags: number;
    dosTime: number;
    /** Motivo por el que se omite (unsafe_path, symlink, encrypted, unsupported_method, too_large, bomb_ratio) o null. */
    skip: string | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// CRC32
// ---------------------------------------------------------------------------------------------------------------------
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

export function crc32(buf: Uint8Array, prev = 0): number {
    // zlib.crc32 nativo (Node >= 22.2): ~GB/s frente a ~0,4 GB/s del bucle JS
    if (typeof nativeCrc32 === 'function') return nativeCrc32(buf, prev) >>> 0;
    let c = ~prev >>> 0;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return ~c >>> 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------------------------------------------------

function decodeName(buf: Buffer, utf8Flag: boolean): string {
    if (utf8Flag) return buf.toString('utf8');
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
        return buf.toString('latin1');
    }
}

function u64(buf: Buffer, off: number): number {
    const v = buf.readBigUInt64LE(off);
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new ArchiveError('zip_too_large');
    return Number(v);
}

export interface ReadDirOptions {
    /** Incluir entradas cifradas (ZipCrypto / WinZip AES) para poder descifrarlas con contrasena. Por defecto se omiten. */
    allowEncrypted?: boolean;
}

export async function readZipDirectory(src: ByteSource, limits: Partial<ZipLimits> = {}, opts: ReadDirOptions = {}): Promise<ZipEntry[]> {
    const lim = { ...DEFAULT_ZIP_LIMITS, ...limits };
    if (src.size < 22) throw new ArchiveError('zip_invalid');
    const tailLen = Math.min(src.size, 65_557 + 22);
    const tailStart = src.size - tailLen;
    const tail = await src.read(tailStart, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
        if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new ArchiveError('zip_invalid');
    let total = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);

    if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
        // ZIP64: localizador 20 bytes antes del EOCD
        const locPos = eocd - 20;
        if (locPos < 0 || tail.readUInt32LE(locPos) !== 0x07064b50) throw new ArchiveError('zip_invalid');
        const z64Off = u64(tail, locPos + 8);
        const rec = await src.read(z64Off, 56);
        if (rec.length < 56 || rec.readUInt32LE(0) !== 0x06064b50) throw new ArchiveError('zip_invalid');
        total = u64(rec, 32);
        cdSize = u64(rec, 40);
        cdOffset = u64(rec, 48);
    }
    if (total > lim.maxEntries) throw new ArchiveError('zip_too_many_entries');
    if (cdSize > lim.maxDirectoryBytes || cdOffset + cdSize > src.size) throw new ArchiveError('zip_invalid');

    const cd = await readAll(src, cdOffset, cdSize);
    const entries: ZipEntry[] = [];
    let p = 0;
    let declaredTotal = 0;
    for (let i = 0; i < total; i++) {
        if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) throw new ArchiveError('zip_invalid');
        const madeBy = cd.readUInt16LE(p + 4);
        const flags = cd.readUInt16LE(p + 8);
        const dosTime = cd.readUInt16LE(p + 12);
        let method = cd.readUInt16LE(p + 10);
        const crc = cd.readUInt32LE(p + 16);
        let csize = cd.readUInt32LE(p + 20);
        let usize = cd.readUInt32LE(p + 24);
        const nameLen = cd.readUInt16LE(p + 28);
        const extraLen = cd.readUInt16LE(p + 30);
        const commentLen = cd.readUInt16LE(p + 32);
        const extAttr = cd.readUInt32LE(p + 38);
        let offset = cd.readUInt32LE(p + 42);
        const nameBuf = cd.subarray(p + 46, p + 46 + nameLen);
        const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
        if (p + 46 + nameLen + extraLen + commentLen > cd.length) throw new ArchiveError('zip_invalid');
        // zip64 extra
        for (let e = 0; e + 4 <= extra.length;) {
            const id = extra.readUInt16LE(e);
            const len = extra.readUInt16LE(e + 2);
            if (id === 0x0001) {
                let q = e + 4;
                if (usize === 0xffffffff) { usize = u64(extra, q); q += 8; }
                if (csize === 0xffffffff) { csize = u64(extra, q); q += 8; }
                if (offset === 0xffffffff) { offset = u64(extra, q); q += 8; }
            }
            e += 4 + len;
        }
        const rawName = decodeName(nameBuf, (flags & 0x800) !== 0);
        const isDirectory = rawName.endsWith('/') || (extAttr & 0x10) !== 0;
        const isSymlink = (madeBy >> 8) === 3 && ((extAttr >>> 16) & 0xf000) === 0xa000;
        const encrypted = (flags & 0x1) !== 0;
        const aes = method === 99 ? parseAesExtra(extra) : null;
        if (aes) method = aes.method;
        const encKind: ZipEntry['encKind'] = !encrypted ? null : aes ? 'aes' : 'zipcrypto';
        const path = safeArchivePath(rawName);
        let skip: string | null = null;
        if (isDirectory) skip = 'directory';
        else if (path === null) skip = 'unsafe_path';
        else if (isSymlink) skip = 'symlink';
        else if (encrypted && !opts.allowEncrypted) skip = 'encrypted';
        else if (encrypted && (flags & 0x40) !== 0) skip = 'unsupported_encryption'; // cifrado fuerte PKWARE (certificados)
        else if (encrypted && (method === 99 && !aes)) skip = 'unsupported_encryption';
        else if (method !== 0 && method !== 8) skip = 'unsupported_method';
        else if (usize > lim.maxEntryBytes) skip = 'too_large';
        else if (usize > 1024 * 1024 && csize > 0 && usize / csize > lim.maxRatio) skip = 'bomb_ratio';
        if (!skip) {
            declaredTotal += usize;
            if (declaredTotal > lim.maxTotalBytes) throw new ArchiveError('zip_bomb_total');
        }
        entries.push({ rawName, path: skip === 'unsafe_path' ? null : path, method, compressedSize: csize, size: usize, crc, offset, isDirectory, isSymlink, encrypted, encKind, aes, flags, dosTime, skip });
        p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
}

async function readAll(src: ByteSource, offset: number, length: number): Promise<Buffer> {
    const parts: Buffer[] = [];
    let got = 0;
    while (got < length) {
        const b = await src.read(offset + got, Math.min(4 * 1024 * 1024, length - got));
        if (b.length === 0) throw new ArchiveError('zip_truncated');
        parts.push(b);
        got += b.length;
    }
    return parts.length === 1 ? parts[0] : Buffer.concat(parts);
}

/** Offset de inicio de los datos de una entrada (salta la cabecera local). */
export async function zipDataStart(src: ByteSource, entry: ZipEntry): Promise<number> {
    const head = await src.read(entry.offset, 30);
    if (head.length < 30 || head.readUInt32LE(0) !== 0x04034b50) throw new ArchiveError('zip_invalid');
    return entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
}

const INFLATE_SLICE = 16 * 1024;
const BEAT_BYTES = 32 * 1024 * 1024;

export interface ExtractOptions {
    /** Contrasena (solo entradas cifradas). Vive unicamente en memoria durante la llamada. */
    password?: string;
    /**
     * Reanudar: los primeros `startAt` bytes DESCOMPRIMIDOS se calculan (hace falta para reconstruir el estado de deflate y el CRC)
     * pero NO se envian al sink. Coste: CPU de re-inflar el prefijo ya escrito; no hay E/S de escritura.
     */
    startAt?: number;
    /** Se consulta tras cada trozo de 16 KiB comprimidos; si devuelve true la extraccion se detiene con {stopped:true} (sin verificar CRC). */
    shouldStop?: () => boolean;
    /** Se invoca cada ~32 MiB descomprimidos (latido del bloqueo del trabajo, incluso mientras se salta el prefijo). */
    heartbeat?: () => Promise<void> | void;
}

export interface ExtractResult {
    bytes: number;
    stopped?: boolean;
}

/** Descifrador de la entrada (o null). Lanza ArchiveError('zip_password_required'|'zip_wrong_password'). */
async function openDecryptor(src: ByteSource, entry: ZipEntry, dataStart: number, password: string | undefined): Promise<{ dec: ZipDecryptor | null; dataStart: number; dataLen: number; trailer: Buffer }> {
    if (!entry.encKind) return { dec: null, dataStart, dataLen: entry.compressedSize, trailer: Buffer.alloc(0) };
    if (password === undefined) throw new ArchiveError('zip_password_required');
    const dec = entry.encKind === 'aes'
        ? winzipAesDecryptor(password, entry.aes!)
        // Con data descriptor (bit 3) el byte de comprobacion es el alto de la hora DOS; si no, el del CRC
        : zipCryptoDecryptor(password, (entry.flags & 0x8) !== 0 ? entry.dosTime >>> 8 : entry.crc >>> 24);
    if (entry.compressedSize < dec.headerBytes + dec.trailerBytes) throw new ArchiveError('zip_corrupt');
    const header = await src.read(dataStart, dec.headerBytes);
    if (header.length < dec.headerBytes) throw new ArchiveError('zip_truncated');
    try {
        dec.start(header);
    } catch (e) {
        if (e instanceof ZipCryptoError) throw new ArchiveError(e.code);
        throw e;
    }
    const trailer = dec.trailerBytes ? await src.read(dataStart + entry.compressedSize - dec.trailerBytes, dec.trailerBytes) : Buffer.alloc(0);
    return { dec, dataStart: dataStart + dec.headerBytes, dataLen: entry.compressedSize - dec.headerBytes - dec.trailerBytes, trailer };
}

/**
 * Extrae UNA entrada enviando los bytes descomprimidos a `sink`. Cuenta los bytes reales: si superan el tamano declarado
 * (o el limite) aborta con ArchiveError('zip_bomb'). Verifica CRC32 al final (y el HMAC en WinZip AES).
 * Soporta entradas cifradas (opts.password), reanudacion por prefijo (opts.startAt) y parada cooperativa (opts.shouldStop).
 */
export async function extractZipEntry(
    src: ByteSource,
    entry: ZipEntry,
    sink: (chunk: Buffer) => Promise<void>,
    limits: Partial<ZipLimits> = {},
    opts: ExtractOptions = {},
): Promise<ExtractResult> {
    const lim = { ...DEFAULT_ZIP_LIMITS, ...limits };
    if (entry.skip) throw new ArchiveError(entry.skip);
    const start0 = await zipDataStart(src, entry);
    const { dec, dataStart, dataLen, trailer } = await openDecryptor(src, entry, start0, opts.password);
    const maxOut = Math.min(lim.maxEntryBytes, entry.size + 1024);
    const startAt = Math.max(0, opts.startAt ?? 0);
    let written = 0;
    let beat = 0;
    let crc = 0;
    const emit = async (chunk: Uint8Array) => {
        if (chunk.length === 0) return;
        const before = written;
        written += chunk.length;
        if (written > maxOut) throw new ArchiveError('zip_bomb');
        crc = crc32(chunk, crc);
        if (written > startAt) {
            const from = Math.max(0, startAt - before);
            await sink(Buffer.from(chunk.buffer, chunk.byteOffset + from, chunk.length - from));
        }
        if (opts.heartbeat && written - beat >= BEAT_BYTES) { beat = written; await opts.heartbeat(); }
    };

    if (entry.method === 0) {
        let pos = 0;
        while (pos < dataLen) {
            const raw = await src.read(dataStart + pos, Math.min(1024 * 1024, dataLen - pos));
            if (raw.length === 0) throw new ArchiveError('zip_truncated');
            pos += raw.length;
            await emit(dec ? dec.push(raw) : raw);
            if (pos < dataLen && opts.shouldStop?.()) return { bytes: written, stopped: true };
        }
    } else {
        const pending: Uint8Array[] = [];
        let failure: unknown = null;
        const inf = new Inflate((chunk) => { pending.push(chunk); });
        let pos = 0;
        while (pos < dataLen) {
            const raw = await src.read(dataStart + pos, Math.min(1024 * 1024, dataLen - pos));
            if (raw.length === 0) throw new ArchiveError('zip_truncated');
            const block = dec ? dec.push(raw) : raw;
            for (let o = 0; o < block.length; o += INFLATE_SLICE) {
                const slice = block.subarray(o, Math.min(block.length, o + INFLATE_SLICE));
                const last = pos + o + slice.length >= dataLen;
                try { inf.push(slice, last); } catch (e) { failure = e; break; }
                while (pending.length) await emit(pending.shift()!);
                if (written > maxOut) throw new ArchiveError('zip_bomb');
                if (!last && opts.shouldStop?.()) return { bytes: written, stopped: true };
            }
            if (failure) throw new ArchiveError(dec && entry.encKind === 'zipcrypto' ? 'zip_wrong_password' : 'zip_corrupt');
            pos += raw.length;
        }
        while (pending.length) await emit(pending.shift()!);
    }
    try {
        dec?.finish(trailer);
    } catch (e) {
        if (e instanceof ZipCryptoError) throw new ArchiveError(e.code);
        throw e;
    }
    if (entry.crc !== 0 || entry.size === 0) {
        if ((crc >>> 0) !== (entry.crc >>> 0)) throw new ArchiveError(entry.encKind === 'zipcrypto' ? 'zip_wrong_password' : 'zip_crc_mismatch');
    }
    return { bytes: written };
}

/**
 * Comprueba la contrasena sobre la entrada cifrada MAS PEQUENA con datos (hasta `maxVerifyBytes` descomprimidos). AES: verificador de
 * 2 bytes + HMAC; ZipCrypto: byte de comprobacion + CRC completo (elimina el falso positivo 1/256).
 */
export async function verifyZipPassword(src: ByteSource, entries: ZipEntry[], password: string, limits: Partial<ZipLimits> = {}, maxVerifyBytes = 64 * 1024 * 1024): Promise<'ok' | 'wrong_password' | 'no_encrypted_entries'> {
    const enc = entries.filter((e) => e.encKind && !e.skip && e.size > 0).sort((a, b) => a.size - b.size);
    if (enc.length === 0) return 'no_encrypted_entries';
    const e = enc[0];
    if (e.size > maxVerifyBytes) return 'ok'; // no se puede comprobar de forma barata; el descifrado real lo confirmara
    try {
        await extractZipEntry(src, e, async () => undefined, limits, { password });
        return 'ok';
    } catch (err) {
        if (err instanceof ArchiveError && (err.code === 'zip_wrong_password' || err.code === 'zip_auth_failed')) return 'wrong_password';
        throw err;
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// gzip
// ---------------------------------------------------------------------------------------------------------------------

export async function gunzipStream(
    src: ByteSource,
    sink: (chunk: Buffer) => Promise<void>,
    opts: { maxBytes: number; ratio?: number; startAt?: number; shouldStop?: () => boolean; heartbeat?: () => Promise<void> | void },
): Promise<{ bytes: number; stopped?: boolean }> {
    const pending: Uint8Array[] = [];
    let written = 0;
    let beat = 0;
    const startAt = Math.max(0, opts.startAt ?? 0);
    const gz = new Gunzip((chunk) => { pending.push(chunk); });
    let pos = 0;
    while (pos < src.size) {
        const block = await src.read(pos, Math.min(1024 * 1024, src.size - pos));
        if (block.length === 0) break;
        for (let o = 0; o < block.length; o += INFLATE_SLICE) {
            const slice = block.subarray(o, Math.min(block.length, o + INFLATE_SLICE));
            const last = pos + o + slice.length >= src.size;
            try { gz.push(slice, last); } catch { throw new ArchiveError('gzip_corrupt'); }
            while (pending.length) {
                const c = pending.shift()!;
                const before = written;
                written += c.length;
                if (written > opts.maxBytes) throw new ArchiveError('gzip_bomb');
                if (written > startAt) {
                    const from = Math.max(0, startAt - before);
                    await sink(Buffer.from(c.buffer, c.byteOffset + from, c.length - from));
                }
                if (opts.heartbeat && written - beat >= BEAT_BYTES) { beat = written; await opts.heartbeat(); }
            }
            if (!last && opts.shouldStop?.()) return { bytes: written, stopped: true };
        }
        pos += block.length;
    }
    return { bytes: written };
}

// ---------------------------------------------------------------------------------------------------------------------
// tar (ustar/GNU/pax basico)
// ---------------------------------------------------------------------------------------------------------------------

export interface TarEntry {
    rawName: string;
    path: string | null;
    size: number;
    /** Offset de los datos dentro del tar. */
    offset: number;
    isSymlink: boolean;
    skip: string | null;
}

function tarString(b: Buffer, from: number, len: number): string {
    const s = b.subarray(from, from + len);
    const z = s.indexOf(0);
    return (z >= 0 ? s.subarray(0, z) : s).toString('utf8');
}

function tarOctal(b: Buffer, from: number, len: number): number {
    const s = tarString(b, from, len).trim();
    if (!s) return 0;
    if (b[from] & 0x80) {
        // base-256
        let v = 0;
        for (let i = 1; i < len; i++) v = v * 256 + b[from + i];
        return v;
    }
    const n = parseInt(s, 8);
    return Number.isFinite(n) ? n : 0;
}

export async function readTarDirectory(src: ByteSource, limits: Partial<ZipLimits> = {}): Promise<TarEntry[]> {
    const lim = { ...DEFAULT_ZIP_LIMITS, ...limits };
    const out: TarEntry[] = [];
    let pos = 0;
    let longName: string | null = null;
    let paxPath: string | null = null;
    let declaredTotal = 0;
    while (pos + 512 <= src.size) {
        const h = await src.read(pos, 512);
        if (h.length < 512) break;
        if (h.every((x) => x === 0)) break;
        let name = tarString(h, 0, 100);
        const size = tarOctal(h, 124, 12);
        const type = String.fromCharCode(h[156] || 0x30);
        const prefix = tarString(h, 345, 155);
        if (prefix && h.toString('latin1', 257, 262) === 'ustar') name = `${prefix}/${name}`;
        const dataOff = pos + 512;
        const padded = Math.ceil(size / 512) * 512;
        if (type === 'L') {
            const nb = await src.read(dataOff, Math.min(size, 4096));
            longName = tarString(nb, 0, nb.length);
        } else if (type === 'x' || type === 'g') {
            if (type === 'x') {
                const pb = (await src.read(dataOff, Math.min(size, 16384))).toString('utf8');
                const m = /\d+ path=([^\n]+)\n/.exec(pb);
                if (m) paxPath = m[1];
            }
        } else {
            const rawName = longName ?? paxPath ?? name;
            longName = null;
            paxPath = null;
            const isFile = type === '0' || type === '\0' || type === '7';
            const isSymlink = type === '1' || type === '2';
            const path = safeArchivePath(rawName);
            let skip: string | null = null;
            if (!isFile) skip = isSymlink ? 'symlink' : 'directory';
            else if (path === null) skip = 'unsafe_path';
            else if (size > lim.maxEntryBytes) skip = 'too_large';
            if (!skip) {
                declaredTotal += size;
                if (declaredTotal > lim.maxTotalBytes) throw new ArchiveError('zip_bomb_total');
            }
            out.push({ rawName, path, size, offset: dataOff, isSymlink, skip });
            if (out.length > lim.maxEntries) throw new ArchiveError('zip_too_many_entries');
        }
        pos = dataOff + padded;
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------------------------------------------------

function dosDateTime(d: Date): { time: number; date: number } {
    const y = Math.max(1980, d.getUTCFullYear());
    return {
        time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
        date: ((y - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
    };
}

export interface WrittenEntry {
    /** Cabecera local + datos. */
    local: Buffer;
    /** Registro del directorio central (con el offset dado). */
    central: Buffer;
    crc: number;
    size: number;
    compressedSize: number;
}

/** Entrada completa en memoria (cabecera local, datos comprimidos con deflate o almacenados) y su registro central. */
export function buildZipEntry(name: string, data: Buffer, offset: number, opts: { deflate?: boolean; date?: Date } = {}): WrittenEntry {
    const nameBuf = Buffer.from(name, 'utf8');
    if (nameBuf.length > 0xffff) throw new ArchiveError('zip_name_too_long');
    const crc = crc32(data);
    let method = 0;
    let body: Buffer = data;
    if (opts.deflate !== false && data.length > 64) {
        const z = Buffer.from(deflateSync(data, { level: 6 }));
        if (z.length < data.length) { body = z; method = 8; }
    }
    const { time, date } = dosDateTime(opts.date ?? new Date());
    const needsZip64 = data.length >= 0xffffffff || body.length >= 0xffffffff;
    if (needsZip64) throw new ArchiveError('zip_entry_too_large');
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    const big = offset >= 0xffffffff;
    const extra = big ? Buffer.alloc(12) : Buffer.alloc(0);
    if (big) { extra.writeUInt16LE(0x0001, 0); extra.writeUInt16LE(8, 2); extra.writeBigUInt64LE(BigInt(offset), 4); }
    const central = Buffer.alloc(46 + nameBuf.length + extra.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 45, 4);
    central.writeUInt16LE(big ? 45 : 20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(big ? 0xffffffff : offset, 42);
    nameBuf.copy(central, 46);
    extra.copy(central, 46 + nameBuf.length);
    return { local: Buffer.concat([local, body]), central, crc, size: data.length, compressedSize: body.length };
}

/** Cabecera local para una entrada "stored" cuyos datos se emiten aparte (p. ej. manifest.json leido por partes). */
export function buildStoredHeader(name: string, size: number, crc: number, date = new Date()): { local: Buffer; nameBuf: Buffer; time: number; date: number } {
    const nameBuf = Buffer.from(name, 'utf8');
    const d = dosDateTime(date);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(d.time, 10);
    local.writeUInt16LE(d.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    return { local, nameBuf, time: d.time, date: d.date };
}

export function buildStoredCentral(name: string, size: number, crc: number, offset: number, date = new Date()): Buffer {
    const h = buildStoredHeader(name, size, crc, date);
    const big = offset >= 0xffffffff;
    const extra = big ? Buffer.alloc(12) : Buffer.alloc(0);
    if (big) { extra.writeUInt16LE(0x0001, 0); extra.writeUInt16LE(8, 2); extra.writeBigUInt64LE(BigInt(offset), 4); }
    const c = Buffer.alloc(46 + h.nameBuf.length + extra.length);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE((3 << 8) | 45, 4);
    c.writeUInt16LE(big ? 45 : 20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt16LE(h.time, 12);
    c.writeUInt16LE(h.date, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(size, 20);
    c.writeUInt32LE(size, 24);
    c.writeUInt16LE(h.nameBuf.length, 28);
    c.writeUInt16LE(extra.length, 30);
    c.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    c.writeUInt32LE(big ? 0xffffffff : offset, 42);
    h.nameBuf.copy(c, 46);
    extra.copy(c, 46 + h.nameBuf.length);
    return c;
}

/** Fin del ZIP: EOCD (y registros ZIP64 si hacen falta). `cdOffset` = offset absoluto donde empieza el directorio central. */
export function buildZipEnd(entryCount: number, cdSize: number, cdOffset: number): Buffer {
    const needs64 = entryCount >= 0xffff || cdSize >= 0xffffffff || cdOffset >= 0xffffffff;
    const parts: Buffer[] = [];
    if (needs64) {
        const z = Buffer.alloc(56);
        z.writeUInt32LE(0x06064b50, 0);
        z.writeBigUInt64LE(BigInt(44), 4);
        z.writeUInt16LE((3 << 8) | 45, 12);
        z.writeUInt16LE(45, 14);
        z.writeBigUInt64LE(BigInt(entryCount), 24);
        z.writeBigUInt64LE(BigInt(entryCount), 32);
        z.writeBigUInt64LE(BigInt(cdSize), 40);
        z.writeBigUInt64LE(BigInt(cdOffset), 48);
        const loc = Buffer.alloc(20);
        loc.writeUInt32LE(0x07064b50, 0);
        loc.writeUInt32LE(0, 4);
        loc.writeBigUInt64LE(BigInt(cdOffset + cdSize), 8);
        loc.writeUInt32LE(1, 16);
        parts.push(z, loc);
    }
    const e = Buffer.alloc(22);
    e.writeUInt32LE(0x06054b50, 0);
    e.writeUInt16LE(needs64 ? 0xffff : entryCount, 8);
    e.writeUInt16LE(needs64 ? 0xffff : entryCount, 10);
    e.writeUInt32LE(needs64 ? 0xffffffff : cdSize, 12);
    e.writeUInt32LE(needs64 ? 0xffffffff : cdOffset, 16);
    parts.push(e);
    return Buffer.concat(parts);
}
