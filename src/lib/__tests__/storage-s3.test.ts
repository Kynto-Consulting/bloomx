// Ruta S3 de src/lib/storage.ts contra un servidor S3 FALSO local (scripts/fake-s3.mjs, 127.0.0.1). Sin BD ni red externa.
// El fake exige y VERIFICA la firma SigV4 (secretKey) y valida checksums/aws-chunked: si el SDK firma mal, falla aqui.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
// @ts-ignore - modulo .mjs sin tipos
import { startFakeS3 } from '../../../scripts/fake-s3.mjs';
import { ChunkWriter, ChunkedSource, CHUNK_SIZE, chunkName, realStorage } from '../mail-transfer/source';

// El proxy /api/assets toca sesion/BD solo si la firma no basta: se aisla.
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => null }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

const MIB = 1024 * 1024;
const TEST_SECRET = 'fake-secret-' + Math.random().toString(36).slice(2);
const KEY_ID = 'AKFAKETEST' + Math.random().toString(36).slice(2, 8).toUpperCase();

let s3: any;
let st: typeof import('../storage');

async function streamToBuf(body: ReadableStream): Promise<Buffer> {
    const reader = body.getReader();
    const parts: Buffer[] = [];
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(Buffer.from(value)); }
    return Buffer.concat(parts);
}
const seed = (n: number, prefix: string) => { for (let i = 0; i < n; i++) s3.objects.set(`${prefix}${String(i).padStart(5, '0')}`, { body: Buffer.from('x'), contentType: 'text/plain', etag: '"e"', lastModified: Date.now(), headers: {} }); };

beforeAll(async () => {
    s3 = await startFakeS3({ bucket: 'bkt-test', pageSize: 100, requireAuth: true, secretKey: TEST_SECRET });
    process.env.S3_ENDPOINT = s3.url;
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_ACCESS_KEY = KEY_ID;
    process.env.S3_SECRET_KEY = TEST_SECRET;
    process.env.S3_BUCKET = 'bkt-test';
    process.env.S3_SSE = 'AES256';
    delete process.env.B2_ACCESS_KEY; delete process.env.B2_BUCKET;
    process.env.RESEND_API_KEY = 're_test_dummy';
    process.env.NEXTAUTH_SECRET = 'test-nextauth-secret';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    vi.resetModules();
    st = await import('../storage');
});
afterAll(async () => { await s3?.stop(); });
beforeEach(() => s3.reset());

describe('fake-s3 (autoverificacion del servidor)', () => {
    it('se niega a arrancar fuera de loopback o en produccion', async () => {
        await expect(startFakeS3({ host: '0.0.0.0' })).rejects.toThrow(/loopback/);
        const prev = process.env.NODE_ENV;
        (process.env as any).NODE_ENV = 'production';
        try { await expect(startFakeS3({})).rejects.toThrow(/production/); } finally { (process.env as any).NODE_ENV = prev; }
    });

    it('rechaza sin firma (AccessDenied) y con firma calculada con otro secreto (SignatureDoesNotMatch)', async () => {
        const noAuth = await fetch(`${s3.url}/bkt-test/k`);
        expect(noAuth.status).toBe(403);
        expect(await noAuth.text()).toContain('<Code>AccessDenied</Code>');
        const bad = new S3Client({ region: 'us-east-1', endpoint: s3.url, forcePathStyle: true, credentials: { accessKeyId: KEY_ID, secretAccessKey: 'otro-secreto' } });
        await expect(bad.send(new PutObjectCommand({ Bucket: 'bkt-test', Key: 'k', Body: Buffer.from('a') }))).rejects.toMatchObject({ name: 'SignatureDoesNotMatch' });
        expect(s3.objects.size).toBe(0);
    });

    it('bucket inexistente -> NoSuchBucket 404', async () => {
        const c = new S3Client({ region: 'us-east-1', endpoint: s3.url, forcePathStyle: true, credentials: { accessKeyId: KEY_ID, secretAccessKey: TEST_SECRET } });
        await expect(c.send(new PutObjectCommand({ Bucket: 'otro', Key: 'k', Body: Buffer.from('a') }))).rejects.toMatchObject({ name: 'NoSuchBucket' });
    });

    it('con los checksums POR DEFECTO del SDK (CRC32, aws-chunked+trailer en streams) el fake decodifica y valida', async () => {
        const c = new S3Client({ region: 'us-east-1', endpoint: s3.url, forcePathStyle: true, credentials: { accessKeyId: KEY_ID, secretAccessKey: TEST_SECRET } });
        const data = randomBytes(300_000);
        await c.send(new PutObjectCommand({ Bucket: 'bkt-test', Key: 'def/buf', Body: data }));
        await c.send(new PutObjectCommand({ Bucket: 'bkt-test', Key: 'def/stream', Body: Readable.from([data.subarray(0, 100_000), data.subarray(100_000)]), ContentLength: data.length }));
        expect(s3.objects.get('def/buf')!.body.equals(data)).toBe(true);
        expect(s3.objects.get('def/stream')!.body.equals(data)).toBe(true);
        expect(s3.stats.requestsWithChecksum).toBeGreaterThanOrEqual(2);
    });
});

describe('storage.ts sobre S3 (put/get/delete)', () => {
    it('objeto pequeno: put -> get (texto y binario), Content-Type, SSE, y SIN checksum por defecto (WHEN_REQUIRED)', async () => {
        expect(await st.uploadToStorage('emails/2024-01-01/u1/content.html', Buffer.from('<p>hola ñ</p>'), 'text/html')).toBe('emails/2024-01-01/u1/content.html');
        await st.uploadToStorage('attachments/a b+c/ñandú (1).bin', Buffer.from([0, 1, 2, 255]), 'application/octet-stream');
        await st.uploadToStorage('str/key', 'texto plano', 'text/plain');
        expect(s3.objects.get('emails/2024-01-01/u1/content.html')!.contentType).toBe('text/html');
        expect(await st.getFromStorage('emails/2024-01-01/u1/content.html')).toBe('<p>hola ñ</p>');
        expect(await st.getFromStorage('str/key')).toBe('texto plano');
        expect([...(await st.getBufferFromStorage('attachments/a b+c/ñandú (1).bin'))!]).toEqual([0, 1, 2, 255]);
        expect(s3.stats.sseSeen).toEqual(['AES256', 'AES256', 'AES256']);
        expect(s3.stats.requestsWithChecksum).toBe(0);
        expect(s3.stats.awsChunkedBodies).toBe(0);
        expect(s3.stats.putObject).toBe(3);
    });

    it('cuerpo tipo ReadableStream (web) tambien se sube', async () => {
        const data = randomBytes(64 * 1024);
        const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(data)); c.close(); } });
        await st.uploadToStorage('streams/web.bin', body as any, 'application/octet-stream');
        expect(s3.objects.get('streams/web.bin')!.body.equals(data)).toBe(true);
    });

    it('objeto de 12 MiB usa multipart REAL (lib-storage): 3 partes, ETag compuesto, contenido identico', async () => {
        const data = randomBytes(12 * MIB);
        await st.uploadToStorage('big/file.bin', data, 'application/pdf');
        expect(s3.stats).toMatchObject({ createMultipart: 1, uploadPart: 3, completeMultipart: 1, putObject: 0 });
        const o = s3.objects.get('big/file.bin')!;
        expect(o.body.equals(data)).toBe(true);
        expect(o.etag).toMatch(/-3"$/);
        expect(o.contentType).toBe('application/pdf');
        expect(o.sse).toBe('AES256');
        expect(s3.uploads.size).toBe(0);
        const back = await st.getBufferFromStorage('big/file.bin');
        expect(back!.equals(data)).toBe(true);
    });

    it('multipart que falla a mitad: se aborta (sin partes huerfanas) y el error se propaga', async () => {
        s3.faults.push({ op: 'uploadPart', status: 403, code: 'AccessDenied', times: 50 });
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(st.uploadToStorage('big/fail.bin', randomBytes(11 * MIB), 'application/octet-stream')).rejects.toBeTruthy();
        err.mockRestore();
        expect(s3.stats.abortMultipart).toBe(1);
        expect(s3.uploads.size).toBe(0);
        expect(s3.objects.has('big/fail.bin')).toBe(false);
    });

    it('getFromStorage/getBufferFromStorage: inexistente -> null (sin ruido); otros errores: null por defecto, se propagan con {strict:true}', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(await st.getFromStorage('no/existe')).toBeNull();
        expect(await st.getBufferFromStorage('no/existe')).toBeNull();
        expect(await st.getBufferFromStorage('no/existe', { strict: true })).toBeNull();
        expect(err).not.toHaveBeenCalled(); // NoSuchKey no es un error de almacenamiento
        await st.uploadToStorage('k/ok', Buffer.from('v'), 'text/plain');

        s3.faults.push({ op: 'getObject', status: 403, code: 'AccessDenied', times: 1 });
        expect(await st.getBufferFromStorage('k/ok')).toBeNull(); // compatibilidad con los llamadores actuales
        expect(err).toHaveBeenCalledTimes(1);
        s3.faults.push({ op: 'getObject', status: 403, code: 'AccessDenied', times: 1 });
        await expect(st.getBufferFromStorage('k/ok', { strict: true })).rejects.toMatchObject({ name: 'AccessDenied' });
        s3.faults.push({ op: 'getObject', status: 403, code: 'AccessDenied', times: 1 });
        await expect(st.getFromStorage('k/ok', { strict: true })).rejects.toMatchObject({ name: 'AccessDenied' });
        err.mockRestore();
        expect(await st.getFromStorage('k/ok', { strict: true })).toBe('v');
    });

    it('deleteFromStorage: borra, es idempotente y devuelve false ante un error real', async () => {
        await st.uploadToStorage('d/one', Buffer.from('1'), 'text/plain');
        expect(await st.deleteFromStorage('d/one')).toBe(true);
        expect(s3.objects.has('d/one')).toBe(false);
        expect(await st.deleteFromStorage('d/one')).toBe(true);
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        s3.faults.push({ op: 'deleteObject', status: 403, code: 'AccessDenied', times: 1 });
        expect(await st.deleteFromStorage('d/two')).toBe(false);
        err.mockRestore();
    });
});

describe('listStorageObjects (paginacion)', () => {
    it('2600 objetos con paginas de 100 -> 26 peticiones, sin duplicados ni fugas de prefijos vecinos', async () => {
        seed(2600, 'p/'); seed(50, 'px/'); seed(50, 'other/');
        const res = await st.listStorageObjects('p/', 100_000);
        expect(res).toHaveLength(2600);
        expect(new Set(res.map((o) => o.key)).size).toBe(2600);
        expect(res.every((o) => o.key.startsWith('p/') && o.size === 1 && o.lastModified instanceof Date)).toBe(true);
        expect(res.map((o) => o.key)).toEqual([...res.map((o) => o.key)].sort());
        expect(s3.stats.listCalls).toBe(26);
        expect(s3.stats.listPageKeys.every((n: number) => n === 100)).toBe(true);
    });

    it('el corte por max: exactamente max resultados y sin pedir paginas de mas', async () => {
        seed(2600, 'p/');
        const r = await st.listStorageObjects('p/', 250);
        expect(r).toHaveLength(250);
        expect(s3.stats.listCalls).toBe(3);
        s3.stats.listCalls = 0;
        expect(await st.listStorageObjects('p/', 100)).toHaveLength(100);
        expect(s3.stats.listCalls).toBe(1);
        expect(await st.listStorageObjects('p/', 0)).toHaveLength(0);
        expect(await st.listStorageObjects('vacio/', 10)).toEqual([]);
    });

    it('claves con espacios, +, unicode y & se listan con su nombre exacto', async () => {
        const keys = ['w/a b', 'w/c+d', 'w/ñandú', 'w/x&y<z>', 'w/日本語.txt'];
        for (const k of keys) await st.uploadToStorage(k, Buffer.from('1'), 'text/plain');
        expect((await st.listStorageObjects('w/')).map((o) => o.key).sort()).toEqual([...keys].sort());
    });
});

describe('deleteManyFromStorage / deleteStoragePrefix', () => {
    it('2600 claves (+duplicadas y vacias) -> 3 lotes de 1000/1000/600', async () => {
        seed(2600, 'm/'); seed(5, 'keep/');
        const keys = [...s3.objects.keys()].filter((k: string) => k.startsWith('m/'));
        const r = await st.deleteManyFromStorage([...keys, ...keys.slice(0, 10), '', keys[0]]);
        expect(r).toEqual({ deleted: 2600, failed: [] });
        expect(s3.stats.deleteObjectsCalls).toBe(3);
        expect(s3.stats.deleteBatchSizes).toEqual([1000, 1000, 600]);
        expect(s3.stats.deleteObjectsKeys).toBe(2600);
        expect(s3.stats.requestsWithChecksum).toBeGreaterThanOrEqual(3); // DeleteObjects exige checksum incluso en WHEN_REQUIRED
        expect(s3.objects.size).toBe(5);
    });

    it('los <Error> de DeleteObjects se reportan en failed y no cuentan como borrados', async () => {
        seed(30, 'e/');
        const keys = [...s3.objects.keys()];
        for (const k of keys.slice(0, 3)) s3.failDeleteKeys.add(k);
        const r = await st.deleteManyFromStorage(keys);
        expect(r.deleted).toBe(27);
        expect([...r.failed].sort()).toEqual(keys.slice(0, 3).sort());
        expect(s3.objects.size).toBe(3);
    });

    it('lote que falla entero: failed lleva todas sus claves; los demas lotes se borran; 501 -> cae a borrado clave a clave', async () => {
        seed(1500, 'b/');
        const keys = [...s3.objects.keys()];
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        s3.faults.push({ op: 'deleteObjects', status: 403, code: 'AccessDenied', times: 1 });
        const r = await st.deleteManyFromStorage(keys);
        err.mockRestore();
        expect(r.deleted).toBe(500);
        expect(r.failed).toHaveLength(1000);
        expect(s3.objects.size).toBe(1000);

        s3.reset(); seed(12, 'n/');
        s3.faults.push({ op: 'deleteObjects', status: 501, code: 'NotImplemented', times: 1 });
        const r2 = await st.deleteManyFromStorage([...s3.objects.keys()]);
        expect(r2).toEqual({ deleted: 12, failed: [] });
        expect(s3.stats.deleteObject).toBe(12);
        expect(s3.objects.size).toBe(0);
    });

    it('el fake rechaza >1000 claves con MalformedXML (garantiza que el lote de 1000 es el maximo real)', async () => {
        seed(1001, 'z/');
        const { DeleteObjectsCommand, S3Client: C } = await import('@aws-sdk/client-s3');
        const c = new C({ region: 'us-east-1', endpoint: s3.url, forcePathStyle: true, credentials: { accessKeyId: KEY_ID, secretAccessKey: TEST_SECRET } });
        await expect(c.send(new DeleteObjectsCommand({ Bucket: 'bkt-test', Delete: { Objects: [...s3.objects.keys()].map((Key) => ({ Key })) } }))).rejects.toMatchObject({ name: 'MalformedXML' });
    });

    it('deleteStoragePrefix: borra solo el prefijo (con "/" final implicito), rechaza prefijos amplios', async () => {
        seed(230, 'emails/2024-01-01/u1/'); seed(3, 'emails/2024-01-01/u10/'); seed(3, 'emails/2024-01-02/u1/');
        await expect(st.deleteStoragePrefix('')).rejects.toThrow(/broad/);
        await expect(st.deleteStoragePrefix('/')).rejects.toThrow(/broad/);
        await expect(st.deleteStoragePrefix('emails')).rejects.toThrow(/broad/);
        expect(s3.objects.size).toBe(236);
        const r = await st.deleteStoragePrefix('emails/2024-01-01/u1');
        expect(r).toEqual({ deleted: 230, failed: [] });
        expect(s3.objects.size).toBe(6); // u10 y otro dia intactos
    });
});

describe('getObjectStream (Range)', () => {
    const data = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));

    it('todos los formatos de Range, 200 sin rango, y null si no existe / rango imposible', async () => {
        await st.uploadToStorage('r/obj.bin', data, 'image/png');
        const full = (await st.getObjectStream('r/obj.bin'))!;
        expect(full).toMatchObject({ status: 200, contentType: 'image/png', contentLength: 1000 });
        expect(full.contentRange).toBeUndefined();
        expect((await streamToBuf(full.body)).equals(data)).toBe(true);

        const cases: Array<[string, number, number]> = [['bytes=0-9', 0, 9], ['bytes=990-', 990, 999], ['bytes=-10', 990, 999], ['bytes=10-5000', 10, 999], ['bytes=500-500', 500, 500], ['bytes=-5000', 0, 999]];
        for (const [range, a, b] of cases) {
            const r = (await st.getObjectStream('r/obj.bin', range))!;
            expect(r.status, range).toBe(206);
            expect(r.contentRange, range).toBe(`bytes ${a}-${b}/1000`);
            expect(r.contentLength, range).toBe(b - a + 1);
            expect((await streamToBuf(r.body)).equals(data.subarray(a, b + 1)), range).toBe(true);
        }
        expect(await st.getObjectStream('r/obj.bin', 'bytes=1000-')).toBeNull(); // 416
        expect(await st.getObjectStream('r/obj.bin', 'bytes=5000-6000')).toBeNull();
        expect(await st.getObjectStream('r/no-existe.bin', 'bytes=0-9')).toBeNull();
        expect(await st.getObjectStream('r/no-existe.bin')).toBeNull();
        // sintaxis invalida: S3 la ignora -> objeto completo
        const junk = (await st.getObjectStream('r/obj.bin', 'lines=1-2'))!;
        expect(junk.status).toBe(200);
        expect(s3.stats.ranges).toContain('bytes=-10');
    });

    it('errores distintos de 404/416 se propagan (el proxy responde 500, no 404 engañoso)', async () => {
        await st.uploadToStorage('r/x', Buffer.from('x'), 'text/plain');
        s3.faults.push({ op: 'getObject', status: 403, code: 'AccessDenied', times: 1 });
        await expect(st.getObjectStream('r/x')).rejects.toMatchObject({ name: 'AccessDenied' });
    });
});

describe('getSignedDownloadUrl + proxy real /api/assets', () => {
    async function callProxy(url: string, headers: Record<string, string> = {}) {
        const { NextRequest } = await import('next/server');
        const { GET } = await import('@/app/api/assets/[...key]/route');
        const u = new URL(url);
        const key = decodeURIComponent(u.pathname.replace('/api/assets/', '')).split('/');
        return GET(new NextRequest(url, { headers }), { params: Promise.resolve({ key }) });
    }
    const KEY = 'attachments/usuario@ejemplo.test/foto vacaciones.png';
    const INBOUND = 'emails/2024-05-01/abc123/attachments/informe.pdf';

    it('URL firmada valida: sirve el objeto desde S3 (200), Range (206 + Content-Range), cabeceras seguras', async () => {
        const data = randomBytes(5000);
        await st.uploadToStorage(KEY, data, 'image/png');
        const url = await st.getSignedDownloadUrl(KEY, 'foto vacaciones.png');
        expect(url).toMatch(/^http:\/\/localhost:3000\/api\/assets\/attachments\/usuario%40ejemplo\.test\/foto%20vacaciones\.png\?filename=foto_vacaciones\.png&exp=\d+&sig=/);
        const res = await callProxy(url);
        expect(res.status).toBe(200);
        expect(Buffer.from(await res.arrayBuffer()).equals(data)).toBe(true);
        expect(res.headers.get('content-type')).toBe('image/png');
        expect(res.headers.get('content-disposition')).toBe('attachment; filename="foto_vacaciones.png"');
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
        expect(res.headers.get('accept-ranges')).toBe('bytes');

        const part = await callProxy(url, { range: 'bytes=100-199' });
        expect(part.status).toBe(206);
        expect(part.headers.get('content-range')).toBe('bytes 100-199/5000');
        expect(Buffer.from(await part.arrayBuffer()).equals(data.subarray(100, 200))).toBe(true);
        const bad = await callProxy(url, { range: 'bytes=9000-' });
        expect(bad.status).toBe(404); // 416 del origen -> null -> 404 (no 500)
    });

    it('URL con contenido activo (html) se sirve como octet-stream', async () => {
        await st.uploadToStorage('attachments/u/x.html', Buffer.from('<script>1</script>'), 'text/html');
        const res = await callProxy(await st.getSignedDownloadUrl('attachments/u/x.html'));
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/octet-stream');
    });

    it('caducada, firma manipulada, exp manipulada, clave distinta y sin firma (inbound) -> 404 sin tocar S3', async () => {
        await st.uploadToStorage(INBOUND, Buffer.from('%PDF'), 'application/pdf');
        await st.uploadToStorage('emails/2024-05-01/abc123/attachments/otro.pdf', Buffer.from('%PDF-otro'), 'application/pdf');
        const { buildSignedAssetUrl } = await import('@/lib/asset-url');
        const gets0 = s3.stats.getObject;
        const good = buildSignedAssetUrl(INBOUND, { baseUrl: 'http://localhost:3000' });
        expect((await callProxy(good)).status).toBe(200);
        const expired = buildSignedAssetUrl(INBOUND, { baseUrl: 'http://localhost:3000', nowMs: Date.now() - 7200_000, ttlSeconds: 3600 });
        const g = new URL(good);
        const tampSig = good.replace(/sig=(.)/, (_m, c) => `sig=${c === 'A' ? 'B' : 'A'}`);
        const tampExp = good.replace(/exp=(\d+)/, (_m, n) => `exp=${Number(n) + 100000}`);
        const otherKey = good.replace('informe.pdf', 'otro.pdf');
        const unsigned = `${g.origin}${g.pathname}`;
        for (const u of [expired, tampSig, tampExp, otherKey, unsigned]) expect((await callProxy(u)).status, u).toBe(404);
        expect(s3.stats.getObject).toBe(gets0 + 1);
        // firma valida pero el objeto no existe -> 404
        expect((await callProxy(buildSignedAssetUrl('attachments/u/nada.png', { baseUrl: 'http://localhost:3000' }))).status).toBe(404);
        // error real del almacenamiento -> 500
        s3.faults.push({ op: 'getObject', status: 403, code: 'AccessDenied', times: 1 });
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect((await callProxy(good)).status).toBe(500);
        err.mockRestore();
    });
});

describe('capa mail-transfer sobre S3: realStorage / ChunkWriter / ChunkedSource', () => {
    it('put/get/list/del con realStorage() incluidos objetos inexistentes y listado de un prefijo', async () => {
        const store = realStorage();
        const prefix = 'mailtransfer/job-1';
        await store.put(`${prefix}/src/000000`, Buffer.from('aaa'));
        await store.put(`${prefix}/src/000001`, Buffer.from('bb'));
        await store.put('mailtransfer/job-2/src/000000', Buffer.from('c'));
        expect((await store.get(`${prefix}/src/000001`))!.toString()).toBe('bb');
        expect(await store.get(`${prefix}/src/999999`)).toBeNull();
        expect(await store.list(`${prefix}/`)).toEqual([{ key: `${prefix}/src/000000`, size: 3 }, { key: `${prefix}/src/000001`, size: 2 }]);
        await store.del([`${prefix}/src/000000`, `${prefix}/src/000001`, 'no/existe']);
        expect(await store.list(`${prefix}/`)).toEqual([]);
        expect(s3.objects.size).toBe(1);
    });

    it('ChunkWriter: 3 ticks con cola reanudable (tailVersion), trozos de 4 MiB exactos; ChunkedSource lee por rango a traves de fronteras', async () => {
        const store = realStorage();
        const prefix = 'mailtransfer/job-w/out';
        const total = 10 * MIB + 12345; // 2 trozos completos + cola de ~2 MiB
        const all = randomBytes(total);
        const cuts = [0, 3 * MIB + 7, 4 * MIB + 5 * 1024, 9 * MIB + 1, total];

        let w = new ChunkWriter(store, prefix);
        await w.write(all.subarray(cuts[0], cuts[1]));
        await w.flushTail();
        let state = w.state();
        await w.dropOldTails();
        expect(state).toEqual({ nextChunk: 0, totalBytes: 3 * MIB + 7, tailVersion: 1 });

        // "otra invocacion" (tick nuevo): reanuda desde el estado persistido
        w = new ChunkWriter(store, prefix, state);
        await w.resume();
        await w.write(all.subarray(cuts[1], cuts[2]));
        await w.write(all.subarray(cuts[2], cuts[3]));
        await w.flushTail();
        state = w.state();
        await w.dropOldTails();
        expect(state.nextChunk).toBe(2);
        expect(state.tailVersion).toBe(2);
        expect((await store.list(`${prefix}.tail`)).map((o) => o.key)).toEqual([`${prefix}.tail2`]); // la v1 se borro

        w = new ChunkWriter(store, prefix, state);
        await w.resume();
        await w.write(all.subarray(cuts[3], cuts[4]));
        expect(await w.finish()).toBe(total);
        expect((await store.list(`${prefix}.tail`))).toEqual([]);

        const chunks = await store.list(`${prefix}/`);
        expect(chunks.map((c) => c.key)).toEqual([0, 1, 2].map((i) => `${prefix}/${chunkName(i)}`));
        expect(chunks.map((c) => c.size)).toEqual([CHUNK_SIZE, CHUNK_SIZE, total - 2 * CHUNK_SIZE]);

        const src = new ChunkedSource(store, prefix, total);
        expect((await src.read(0, total)).equals(all)).toBe(true);
        for (const [off, len] of [[CHUNK_SIZE - 10, 20], [2 * CHUNK_SIZE - 1, 2], [CHUNK_SIZE - 1, CHUNK_SIZE + 2], [total - 5, 100], [17, 0], [total, 5]] as const) {
            const got = await src.read(off, len);
            expect(got.equals(all.subarray(off, Math.min(total, off + len))), `${off}+${len}`).toBe(true);
        }
        // trozo con tamano incorrecto o ausente
        await expect(new ChunkedSource(store, prefix, total + 1).read(total, 1)).rejects.toThrow('chunk_size_mismatch');
        await expect(new ChunkedSource(store, `${prefix}-x`, 10).read(0, 1)).rejects.toThrow('chunk_missing');

        // limpieza del prefijo del trabajo: solo los objetos de ese trabajo desaparecen
        await store.put('mailtransfer/job-z/src/000000', Buffer.from('otro'));
        await store.del((await store.list('mailtransfer/job-w/')).map((o) => o.key));
        expect((await store.list('mailtransfer/job-w/'))).toEqual([]);
        expect((await store.list('mailtransfer/')).map((o) => o.key)).toEqual(['mailtransfer/job-z/src/000000']);
    });

    it('trozos de 6 MiB (>5 MiB) pasan por multipart real y se releen por rango entre trozos', async () => {
        const store = realStorage();
        const chunk = 6 * MIB;
        const total = 13 * MIB;
        const all = randomBytes(total);
        const w = new ChunkWriter(store, 'mailtransfer/job-m/out', { nextChunk: 0, totalBytes: 0 }, chunk);
        await w.write(all);
        await w.finish();
        expect(s3.stats.createMultipart).toBe(2); // 2 trozos de 6 MiB (5 + 1 cada uno)
        expect(s3.stats.completeMultipart).toBe(2);
        const src = new ChunkedSource(store, 'mailtransfer/job-m/out', total, chunk);
        expect((await src.read(chunk - 3, 10)).equals(all.subarray(chunk - 3, chunk + 7))).toBe(true);
        expect((await src.read(0, total)).equals(all)).toBe(true);
    });
});
