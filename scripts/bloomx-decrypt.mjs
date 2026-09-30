#!/usr/bin/env node
/**
 * bloomx-decrypt.mjs - descifra un paquete de exportacion de Bloomx (contenedor BLMXENC1). Sin dependencias (Node >= 18).
 *
 *   node scripts/bloomx-decrypt.mjs paquete.zip.bmx paquete.zip
 *   BLOOMX_PACKAGE_PASSWORD='...' node scripts/bloomx-decrypt.mjs paquete.zip.bmx paquete.zip
 *
 * Formato (big-endian): cabecera de 37 bytes = "BLMXENC1" | version(1) | kdf(1=scrypt) | log2N | r | p | salt(16) | prefijo
 * de nonce(4) | tamano de registro(4); despues registros [longitud(4) | AES-256-GCM(clave=scrypt(pass, salt), nonce =
 * prefijo||contador(8), AAD = cabecera||byte_final)]. El ultimo registro esta vacio y lleva byte_final = 1 (si falta, el
 * archivo esta truncado y se rechaza).
 */
import { createDecipheriv, scryptSync } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';

const HEADER_LEN = 37;

export class DecryptError extends Error {}

/** Descifra un Buffer completo. Devuelve el texto en claro. */
export function decryptBuffer(input, password) {
    const chunks = [];
    const sink = { write: (b) => chunks.push(b) };
    const dec = new Decryptor(password, sink);
    dec.push(input);
    dec.end();
    return Buffer.concat(chunks);
}

export class Decryptor {
    constructor(password, sink) {
        this.password = password;
        this.sink = sink;
        this.buf = Buffer.alloc(0);
        this.header = null;
        this.key = null;
        this.counter = 0;
        this.finished = false;
    }

    push(data) {
        if (this.finished && data.length) throw new DecryptError('datos tras el registro final');
        this.buf = this.buf.length ? Buffer.concat([this.buf, data]) : data;
        if (!this.header) {
            if (this.buf.length < HEADER_LEN) return;
            const h = this.buf.subarray(0, HEADER_LEN);
            if (h.toString('latin1', 0, 8) !== 'BLMXENC1') throw new DecryptError('no es un paquete Bloomx cifrado');
            if (h[8] !== 1 || h[9] !== 1) throw new DecryptError('version o KDF no soportados');
            const N = 1 << h[10];
            const r = h[11];
            const p = h[12];
            if (h[10] < 14 || h[10] > 22 || r > 16 || p > 4) throw new DecryptError('parametros de KDF no razonables');
            this.header = Buffer.from(h);
            this.key = scryptSync(Buffer.from(String(this.password).normalize('NFC'), 'utf8'), h.subarray(13, 29), 32, { N, r, p, maxmem: 256 * 1024 * 1024 });
            this.buf = this.buf.subarray(HEADER_LEN);
        }
        for (;;) {
            if (this.buf.length < 4) return;
            const len = this.buf.readUInt32BE(0);
            if (len < 16 || len > 16 * 1024 * 1024) throw new DecryptError('registro invalido');
            if (this.buf.length < 4 + len) return;
            const ct = this.buf.subarray(4, 4 + len);
            this.buf = this.buf.subarray(4 + len);
            const iv = Buffer.alloc(12);
            this.header.copy(iv, 0, 29, 33);
            iv.writeBigUInt64BE(BigInt(this.counter++), 4);
            const isFinalCandidate = ct.length === 16;
            let plain = null;
            for (const flag of isFinalCandidate ? [0, 1] : [0]) {
                try {
                    const d = createDecipheriv('aes-256-gcm', this.key, iv);
                    d.setAAD(Buffer.concat([this.header, Buffer.from([flag])]));
                    d.setAuthTag(ct.subarray(ct.length - 16));
                    plain = { data: Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]), final: flag === 1 };
                    break;
                } catch { /* prueba el otro flag / falla */ }
            }
            if (!plain) throw new DecryptError('contrasena incorrecta o archivo alterado');
            if (plain.final) { this.finished = true; if (this.buf.length) throw new DecryptError('datos tras el registro final'); return; }
            this.sink.write(plain.data);
        }
    }

    end() {
        if (!this.header) throw new DecryptError('archivo vacio o sin cabecera');
        if (!this.finished) throw new DecryptError('archivo truncado (falta el registro final)');
    }
}

async function askPassword() {
    if (process.env.BLOOMX_PACKAGE_PASSWORD) return process.env.BLOOMX_PACKAGE_PASSWORD;
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    return new Promise((resolve) => {
        process.stderr.write('Contrasena del paquete: ');
        const orig = rl._writeToOutput;
        rl._writeToOutput = () => {};
        rl.question('', (answer) => { rl._writeToOutput = orig; rl.close(); process.stderr.write('\n'); resolve(answer); });
    });
}

async function main() {
    const [, , inPath, outPath] = process.argv;
    if (!inPath || !outPath) {
        console.error('Uso: node scripts/bloomx-decrypt.mjs <paquete.bmx> <salida.zip>');
        process.exit(2);
    }
    const password = await askPassword();
    const out = createWriteStream(outPath);
    const dec = new Decryptor(password, { write: (b) => out.write(b) });
    try {
        for await (const chunk of createReadStream(inPath, { highWaterMark: 1024 * 1024 })) dec.push(chunk);
        dec.end();
        await new Promise((res) => out.end(res));
        console.error('OK: paquete descifrado en ' + outPath);
    } catch (e) {
        out.destroy();
        console.error('ERROR: ' + (e instanceof DecryptError ? e.message : 'no se pudo descifrar'));
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('bloomx-decrypt.mjs')) {
    main();
}
