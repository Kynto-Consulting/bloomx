import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync, deflateSync } from 'fflate';
import { CHUNK_SIZE, ChunkedSource, chunkName, fsStorage, memoryStorage, type TransferStorage } from '../mail-transfer/source';
import { expandStep, type ArchiveDeps, type WriterState } from '../mail-transfer/archive';
import { ArchiveError, extractZipEntry, readZipDirectory, verifyZipPassword } from '../mail-transfer/zip';
import { bufferSource } from '../mail-transfer/mbox';
import { buildZip, makeTextBlock, writeBigDeflateZip } from './helpers/zip-fixtures';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomx-expand-'));
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

async function putSource(storage: TransferStorage, prefix: string, buf: Buffer) {
    for (let i = 0, o = 0; o < buf.length; i++, o += CHUNK_SIZE) await storage.put(`${prefix}/src/${chunkName(i)}`, buf.subarray(o, o + CHUNK_SIZE));
}

async function putSourceFile(storage: TransferStorage, prefix: string, file: string) {
    const fd = fs.openSync(file, 'r');
    try {
        const size = fs.fstatSync(fd).size;
        const b = Buffer.allocUnsafe(CHUNK_SIZE);
        for (let i = 0, o = 0; o < size; i++, o += CHUNK_SIZE) {
            const n = fs.readSync(fd, b, 0, Math.min(CHUNK_SIZE, size - o), o);
            await storage.put(`${prefix}/src/${chunkName(i)}`, Buffer.from(b.subarray(0, n)));
        }
        return size;
    } finally {
        fs.closeSync(fd);
    }
}

const deps = (storage: TransferStorage, prefix: string, totalBytes: number, fileName: string, over: Partial<ArchiveDeps> = {}): ArchiveDeps =>
    ({ storage, prefix, totalBytes, fileName, state: { expanded: {} }, ...over });

async function sha256Of(storage: TransferStorage, prefix: string, size: number): Promise<string> {
    const src = new ChunkedSource(storage, prefix, size);
    const h = createHash('sha256');
    for (let pos = 0; pos < size; pos += CHUNK_SIZE) h.update(await src.read(pos, CHUNK_SIZE));
    return h.digest('hex');
}

/** Ejecuta la expansion en ticks (con presupuesto `budget` ms) hasta terminar; devuelve el resumen. */
async function drainExpand(d: ArchiveDeps, target: 'gz' | number, budget: number, opts: { crashEvery?: number } = {}) {
    let prev: WriterState | undefined;
    let ticks = 0;
    let replayed = 0;
    let written = 0;
    for (;;) {
        const out = await expandStep(d, target, prev, { deadline: Date.now() + budget, now: () => Date.now() });
        ticks++;
        replayed += out.replayed;
        written += out.written;
        if (out.done) return { size: out.size!, ticks, replayed, written };
        // "Caida" tras escribir y ANTES de guardar el cursor: se descarta el estado y se repite el tick desde el checkpoint anterior
        if (opts.crashEvery && ticks % opts.crashEvery === 0) continue;
        prev = out.w;
        await out.commit();
        if (ticks > 5000) throw new Error('no converge');
    }
}

describe('ZIP cifrado (ZipCrypto / WinZip AES)', () => {
    const content = makeTextBlock(7, 300_000);
    const small = Buffer.from('hola mundo\n');

    for (const kind of ['zipcrypto', 'aes128', 'aes256'] as const) {
        it(`${kind}: descifra y verifica CRC/HMAC; contrasena incorrecta o dato manipulado se rechazan`, async () => {
            const zip = buildZip([{ name: 'a.txt', data: content, password: 'Sup3r-Secreta!', kind }, { name: 'b.txt', data: small, password: 'Sup3r-Secreta!', kind, deflate: false }]);
            const src = bufferSource(zip);
            const dir = await readZipDirectory(src, {}, { allowEncrypted: true });
            expect(dir.map((e) => e.encKind)).toEqual([kind === 'zipcrypto' ? 'zipcrypto' : 'aes', kind === 'zipcrypto' ? 'zipcrypto' : 'aes']);
            // sin allowEncrypted se omiten (comportamiento previo)
            expect((await readZipDirectory(src)).map((e) => e.skip)).toEqual(['encrypted', 'encrypted']);
            const out: Buffer[] = [];
            await extractZipEntry(src, dir[0], async (c) => { out.push(Buffer.from(c)); }, {}, { password: 'Sup3r-Secreta!' });
            expect(Buffer.concat(out).equals(content)).toBe(true);
            const out2: Buffer[] = [];
            await extractZipEntry(src, dir[1], async (c) => { out2.push(Buffer.from(c)); }, {}, { password: 'Sup3r-Secreta!' });
            expect(Buffer.concat(out2).toString()).toBe('hola mundo\n');
            // Sin contrasena / contrasena mala
            await expect(extractZipEntry(src, dir[0], async () => undefined)).rejects.toMatchObject({ code: 'zip_password_required' });
            await expect(extractZipEntry(src, dir[0], async () => undefined, {}, { password: 'incorrecta-1' })).rejects.toMatchObject({ code: 'zip_wrong_password' });
            expect(await verifyZipPassword(src, dir, 'Sup3r-Secreta!')).toBe('ok');
            expect(await verifyZipPassword(src, dir, 'incorrecta-1')).toBe('wrong_password');
            // Manipulacion de un byte del cuerpo cifrado
            const bad = Buffer.from(zip);
            const start = 30 + Buffer.byteLength('a.txt') + (kind === 'zipcrypto' ? 0 : 11) + 40;
            bad[start] ^= 0xff;
            const badDir = await readZipDirectory(bufferSource(bad), {}, { allowEncrypted: true });
            await expect(extractZipEntry(bufferSource(bad), badDir[0], async () => undefined, {}, { password: 'Sup3r-Secreta!' })).rejects.toBeInstanceOf(ArchiveError);
        });
    }

    it('reanudacion (startAt) y parada cooperativa con entrada cifrada', async () => {
        const zip = buildZip([{ name: 'big.txt', data: content, password: 'clave-de-prueba-77', kind: 'aes256' }]);
        const src = bufferSource(zip);
        const dir = await readZipDirectory(src, {}, { allowEncrypted: true });
        const first: Buffer[] = [];
        let count = 0;
        const r1 = await extractZipEntry(src, dir[0], async (c) => { first.push(Buffer.from(c)); count += c.length; }, {}, { password: 'clave-de-prueba-77', shouldStop: () => count > 50_000 });
        expect(r1.stopped).toBe(true);
        const rest: Buffer[] = [];
        const done = Buffer.concat(first).length;
        await extractZipEntry(src, dir[0], async (c) => { rest.push(Buffer.from(c)); }, {}, { password: 'clave-de-prueba-77', startAt: done });
        expect(Buffer.concat([...first, ...rest]).equals(content)).toBe(true);
    });

    // Interoperabilidad con implementaciones INDEPENDIENTES (7-Zip / Info-ZIP) si estan instaladas
    const has = (cmd: string, args: string[]) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch { return false; } };
    const has7z = has('7z', ['i']);
    const hasZip = has('zip', ['-v']);
    const payload = makeTextBlock(3, 200_000);

    it.skipIf(!has7z)('interoperabilidad: 7-Zip crea ZIP con AES-256 y AES-128 y ZipCrypto; lo leemos', async () => {
        for (const mem of ['AES256', 'AES128', 'ZipCrypto']) {
            const dir = fs.mkdtempSync(path.join(tmp, '7z-'));
            fs.writeFileSync(path.join(dir, 'datos.txt'), payload);
            fs.writeFileSync(path.join(dir, 'vacio.txt'), '');
            execFileSync('7z', ['a', '-tzip', `-mem=${mem}`, '-pcontrasena-larga-9', path.join(dir, 'out.zip'), path.join(dir, 'datos.txt')], { stdio: 'ignore' });
            const zip = fs.readFileSync(path.join(dir, 'out.zip'));
            const src = bufferSource(zip);
            const entries = await readZipDirectory(src, {}, { allowEncrypted: true });
            const e = entries.find((x) => x.rawName === 'datos.txt')!;
            expect(e.encKind).toBe(mem === 'ZipCrypto' ? 'zipcrypto' : 'aes');
            const out: Buffer[] = [];
            await extractZipEntry(src, e, async (c) => { out.push(Buffer.from(c)); }, {}, { password: 'contrasena-larga-9' });
            expect(Buffer.concat(out).equals(payload)).toBe(true);
            await expect(extractZipEntry(src, e, async () => undefined, {}, { password: 'mala-contrasena' })).rejects.toBeInstanceOf(ArchiveError);
        }
    });

    it.skipIf(!hasZip)('interoperabilidad: Info-ZIP (zip -P) crea ZipCrypto; lo leemos', async () => {
        const dir = fs.mkdtempSync(path.join(tmp, 'iz-'));
        fs.writeFileSync(path.join(dir, 'datos.txt'), payload);
        execFileSync('zip', ['-q', '-j', '-P', 'zipcrypto-clave', path.join(dir, 'out.zip'), path.join(dir, 'datos.txt')], { stdio: 'ignore' });
        const zip = fs.readFileSync(path.join(dir, 'out.zip'));
        const src = bufferSource(zip);
        const [e] = await readZipDirectory(src, {}, { allowEncrypted: true });
        expect(e.encKind).toBe('zipcrypto');
        const out: Buffer[] = [];
        await extractZipEntry(src, e, async (c) => { out.push(Buffer.from(c)); }, {}, { password: 'zipcrypto-clave' });
        expect(Buffer.concat(out).equals(payload)).toBe(true);
    });
});

describe('fase de extraccion reanudable', () => {
    it('entrada deflate de 24 MB con presupuesto 0: un trozo por tick, reanuda re-inflando el prefijo, resultado identico', async () => {
        const raw = Buffer.concat(Array.from({ length: 24 }, (_, i) => makeTextBlock(i, 1024 * 1024)));
        const zip = buildZip([{ name: 'grande.mbox', data: raw }]);
        const storage = memoryStorage();
        await putSource(storage, 'job1', zip);
        const d = deps(storage, 'job1', zip.length, 'x.zip');
        const r = await drainExpand(d, 0, 0);
        expect(r.size).toBe(raw.length);
        expect(r.ticks).toBeGreaterThanOrEqual(5); // >= 24 MB / 4 MiB
        expect(r.replayed).toBeGreaterThan(0); // hubo re-inflado de prefijo
        expect(r.written).toBe(raw.length); // cada byte se escribe UNA sola vez (sin reescribir lo ya guardado)
        expect(await sha256Of(storage, 'job1/x/0', r.size)).toBe(createHash('sha256').update(raw).digest('hex'));
        // Las colas temporales se limpian
        expect((await storage.list('job1/x/0.tail')).length).toBe(0);
    });

    it('caida entre escribir y guardar el cursor: se repite el tick desde el checkpoint y el resultado es el mismo', async () => {
        const raw = Buffer.concat(Array.from({ length: 14 }, (_, i) => makeTextBlock(100 + i, 1024 * 1024)));
        const zip = buildZip([{ name: 'a.mbox', data: raw }]);
        const storage = memoryStorage();
        await putSource(storage, 'job2', zip);
        const r = await drainExpand(deps(storage, 'job2', zip.length, 'a.zip'), 0, 0, { crashEvery: 2 });
        expect(r.size).toBe(raw.length);
        expect(await sha256Of(storage, 'job2/x/0', r.size)).toBe(createHash('sha256').update(raw).digest('hex'));
    });

    it('.mbox.gz: gunzip por trozos reanudable con el mismo mecanismo', async () => {
        const raw = Buffer.concat(Array.from({ length: 13 }, (_, i) => makeTextBlock(200 + i, 1024 * 1024)));
        const gz = Buffer.from(gzipSync(raw, { level: 1 }));
        const storage = memoryStorage();
        await putSource(storage, 'job3', gz);
        const r = await drainExpand(deps(storage, 'job3', gz.length, 'mail.mbox.gz'), 'gz', 0);
        expect(r.size).toBe(raw.length);
        expect(r.ticks).toBeGreaterThanOrEqual(3);
        expect(await sha256Of(storage, 'job3/x/gz', r.size)).toBe(createHash('sha256').update(raw).digest('hex'));
    });

    it('zip-bomb: la entrada que infla mas de lo declarado se aborta durante la expansion', async () => {
        const zip = Buffer.from(buildZip([{ name: 'b.bin', data: Buffer.alloc(3 * 1024 * 1024, 0x61) }]));
        // Miente sobre el tamano descomprimido (cabecera central) para simular una bomba
        const cdOff = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
        zip.writeUInt32LE(1000, cdOff + 24);
        const storage = memoryStorage();
        await putSource(storage, 'job4', zip);
        await expect(expandStep(deps(storage, 'job4', zip.length, 'b.zip'), 0, undefined, { deadline: Date.now() + 5000, now: () => Date.now() })).rejects.toMatchObject({ code: 'zip_bomb' });
    });

    it('entrada cifrada AES: se expande descifrada a trozos y NO queda texto claro de la contrasena en el estado', async () => {
        const raw = makeTextBlock(9, 5 * 1024 * 1024);
        const zip = buildZip([{ name: 'c.mbox', data: raw, password: 'expandir-cifrado-1', kind: 'aes256' }]);
        const storage = memoryStorage();
        await putSource(storage, 'job5', zip);
        await expect(expandStep(deps(storage, 'job5', zip.length, 'c.zip'), 0, undefined, { deadline: Date.now() + 5000, now: () => Date.now() })).rejects.toMatchObject({ code: 'zip_password_required' });
        const r = await drainExpand(deps(storage, 'job5', zip.length, 'c.zip', { password: 'expandir-cifrado-1' }), 0, 0);
        expect(await sha256Of(storage, 'job5/x/0', r.size)).toBe(createHash('sha256').update(raw).digest('hex'));
        for (const o of await storage.list('job5/')) expect((await storage.get(o.key))!.includes(Buffer.from('expandir-cifrado-1'))).toBe(false);
    });
});

describe('entrada deflate enorme (volumen)', () => {
    const MB = Number(process.env.MT_BIG_MB || 320);
    it.skipIf(process.env.MT_SKIP_BIG === '1')(`${MB} MB descomprimidos: memoria pico < 200 MB, trozos correctos, throughput medido`, async () => {
        const file = path.join(tmp, 'big.zip');
        const size = MB * 1024 * 1024;
        const meta = await writeBigDeflateZip(file, 'Takeout/Mail/Todo.mbox', size);
        const storage = fsStorage(path.join(tmp, 'store'));
        const srcBytes = await putSourceFile(storage, 'jobbig', file);
        expect(srcBytes).toBe(meta.zipBytes);
        const d = deps(storage, 'jobbig', srcBytes, 'big.zip');

        global.gc?.();
        await new Promise((r) => setTimeout(r, 100));
        const base = process.memoryUsage().rss;
        let peak = base;
        const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 25);
        const t0 = Date.now();
        const r = await drainExpand(d, 0, 800); // ticks de ~0,8 s de escritura
        const secs = (Date.now() - t0) / 1000;
        clearInterval(timer);
        peak = Math.max(peak, process.memoryUsage().rss);
        const peakDelta = (peak - base) / 1048576;

        // eslint-disable-next-line no-console
        console.log(`[expand-bench] entrada ${MB} MB (zip ${(srcBytes / 1048576).toFixed(0)} MB): ${secs.toFixed(1)} s, ${(size / 1048576 / secs).toFixed(0)} MB/s, ${r.ticks} ticks, prefijo re-inflado ${(r.replayed / 1048576).toFixed(0)} MB, memoria pico +${peakDelta.toFixed(0)} MB (rss ${(peak / 1048576).toFixed(0)} MB)`);
        expect(r.size).toBe(size);
        expect(r.written).toBe(size);
        expect(peakDelta).toBeLessThan(200);
        // Contenido exacto: se regenera el mismo flujo y se compara el sha256 por trozos
        const expected = createHash('sha256');
        for (let i = 0, done = 0; done < size; i++) { const n = Math.min(1024 * 1024, size - done); expected.update(makeTextBlock(i, n)); done += n; }
        expect(await sha256Of(storage, 'jobbig/x/0', size)).toBe(expected.digest('hex'));
        void deflateSync;
    }, 600_000);
});
