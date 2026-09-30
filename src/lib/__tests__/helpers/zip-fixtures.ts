// Utilidades de PRUEBA para construir ZIP a mano: entradas cifradas (ZipCrypto / WinZip AES) y una entrada deflate enorme escrita
// en flujo a disco (sin cargarla en memoria). No se usa en codigo de produccion.
import fs from 'node:fs';
import { Deflate, deflateSync } from 'fflate';
import { crc32 } from '../../mail-transfer/zip';
import { winzipAesEncrypt, zipCryptoEncrypt } from '../../mail-transfer/zip-crypto';

export type EncKind = 'zipcrypto' | 'aes128' | 'aes256' | 'none';

interface Built { local: Buffer; central: Buffer }

function le16(n: number) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function le32(n: number) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }

export function buildEntry(name: string, data: Buffer, offset: number, opts: { password?: string; kind?: EncKind; deflate?: boolean } = {}): Built {
    const kind = opts.kind ?? (opts.password ? 'zipcrypto' : 'none');
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const wantDeflate = opts.deflate !== false && data.length > 32;
    let body: Buffer = wantDeflate ? Buffer.from(deflateSync(data, { level: 6 })) : data;
    let method = wantDeflate ? 8 : 0;
    let flags = 0x0800;
    let extra: Buffer = Buffer.alloc(0);
    let crcField = crc;
    if (kind === 'zipcrypto') {
        flags |= 1;
        body = zipCryptoEncrypt(body, opts.password!, crc >>> 24);
    } else if (kind === 'aes128' || kind === 'aes256') {
        flags |= 1;
        const strength = kind === 'aes128' ? 1 : 3;
        extra = Buffer.concat([le16(0x9901), le16(7), le16(2), Buffer.from('AE'), Buffer.from([strength]), le16(method)]);
        method = 99;
        crcField = 0; // AE-2
        body = winzipAesEncrypt(body, opts.password!, strength as 1 | 3);
    }
    const hdr = (central: boolean) => {
        const parts = [
            le32(central ? 0x02014b50 : 0x04034b50),
            ...(central ? [le16((3 << 8) | 63)] : []),
            le16(kind === 'none' ? 20 : 51), le16(flags), le16(method), le16(0), le16(0x21), le32(crcField), le32(body.length), le32(data.length),
            le16(nameBuf.length), le16(extra.length),
            ...(central ? [le16(0), le16(0), le16(0), le32(0), le32(offset)] : []),
            nameBuf, extra,
        ];
        return Buffer.concat(parts);
    };
    return { local: Buffer.concat([hdr(false), body]), central: hdr(true) };
}

export function zipEnd(count: number, cdSize: number, cdOffset: number): Buffer {
    return Buffer.concat([le32(0x06054b50), le16(0), le16(0), le16(count), le16(count), le32(cdSize), le32(cdOffset), le16(0)]);
}

export function buildZip(files: Array<{ name: string; data: Buffer; password?: string; kind?: EncKind; deflate?: boolean }>): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let off = 0;
    for (const f of files) {
        const b = buildEntry(f.name, f.data, off, f);
        locals.push(b.local);
        centrals.push(b.central);
        off += b.local.length;
    }
    const cd = Buffer.concat(centrals);
    return Buffer.concat([...locals, cd, zipEnd(files.length, cd.length, off)]);
}

/** Generador determinista de texto tipo mbox (compresible ~3-4:1) por bloques. */
export function makeTextBlock(index: number, bytes: number): Buffer {
    const out = Buffer.allocUnsafe(bytes);
    let s = (index * 2654435761 + 12345) >>> 0;
    const words = ['factura', 'reunion', 'proyecto', 'cliente', 'enviado', 'adjunto', 'hola', 'gracias', 'saludos', 'pedido', 'oferta', 'precio', 'entrega', 'revision', 'contrato'];
    let o = 0;
    while (o < bytes) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        const w = words[(s >>> 16) % words.length] + ((s >>> 8) & 0x3f).toString(36) + ((s & 0xff) % 5 === 0 ? '\n' : ' ');
        o += out.write(w, o, 'latin1');
    }
    return out;
}

/**
 * ZIP de UNA entrada deflate de `size` bytes descomprimidos, generada y comprimida en flujo (nunca entera en memoria).
 * Devuelve tamanos y el CRC/sha256 esperados. Para <4 GiB (sin ZIP64).
 */
export async function writeBigDeflateZip(file: string, name: string, size: number, blockBytes = 1024 * 1024): Promise<{ zipBytes: number; size: number; crc: number }> {
    const fd = fs.openSync(file, 'w');
    try {
        const nameBuf = Buffer.from(name, 'utf8');
        const headLen = 30 + nameBuf.length;
        fs.writeSync(fd, Buffer.alloc(headLen), 0, headLen, 0);
        let pos = headLen;
        let comp = 0;
        const def = new Deflate({ level: 1 }, (chunk) => {
            fs.writeSync(fd, chunk, 0, chunk.length, pos);
            pos += chunk.length;
            comp += chunk.length;
        });
        let crc = 0;
        for (let i = 0, done = 0; done < size; i++) {
            const n = Math.min(blockBytes, size - done);
            const block = makeTextBlock(i, n);
            crc = crc32(block, crc);
            def.push(block, false);
            done += n;
        }
        def.push(new Uint8Array(0), true);
        const local = Buffer.alloc(headLen);
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
        local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc >>> 0, 14); local.writeUInt32LE(comp, 18); local.writeUInt32LE(size, 22);
        local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28); nameBuf.copy(local, 30);
        fs.writeSync(fd, local, 0, headLen, 0);
        const central = Buffer.alloc(46 + nameBuf.length);
        central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE((3 << 8) | 20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
        central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc >>> 0, 16); central.writeUInt32LE(comp, 20); central.writeUInt32LE(size, 24);
        central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(0, 42); nameBuf.copy(central, 46);
        const end = zipEnd(1, central.length, pos);
        fs.writeSync(fd, central, 0, central.length, pos);
        fs.writeSync(fd, end, 0, end.length, pos + central.length);
        return { zipBytes: pos + central.length + end.length, size, crc: crc >>> 0 };
    } finally {
        fs.closeSync(fd);
    }
}
