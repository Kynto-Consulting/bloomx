// Ciclo REAL exportar -> descargar por trozos -> importar -> borrar prefijo, con el almacenamiento apuntando a un S3 FALSO
// local (scripts/fake-s3.mjs) a traves de src/lib/storage.ts (rama S3 con SDK v3, firma SigV4 verificada por el fake) y
// Postgres embebido. Nada de S3/B2/Resend reales.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { unzipSync } from 'fflate';
import { assertLocalPg, createUser, uid } from './helpers/pg';
// @ts-ignore - modulo .mjs sin tipos
import { startFakeS3 } from '../../../scripts/fake-s3.mjs';

const MIB = 1024 * 1024;
const SECRET = 'fake-secret-' + Math.random().toString(36).slice(2);
const KEY_ID = 'AKFAKETEST' + Math.random().toString(36).slice(2, 8).toUpperCase();
const tag = `s${Math.random().toString(36).slice(2, 8)}`;
const addr = (n: string) => `${n}.${tag}@example.test`;

let s3: any;
let M: {
    prisma: any; st: typeof import('../storage');
    store: typeof import('../mail-transfer/store');
    src: typeof import('../mail-transfer/source');
    imp: typeof import('../mail-transfer/import-engine');
    exp: typeof import('../mail-transfer/export-engine');
    lim: typeof import('../mail-transfer/limits');
};

beforeAll(async () => {
    assertLocalPg();
    process.env.TOP_DOMAIN = 'example.test';
    process.env.NEXT_PUBLIC_APP_URL = 'https://mail.example.test';
    process.env.RESEND_API_KEY ||= 're_test_dummy';
    process.env.NEXTAUTH_SECRET ||= 'test-nextauth-secret';
    // pageSize pequeno: fuerza paginacion real en cada listado del motor
    s3 = await startFakeS3({ bucket: 'bkt-mt', pageSize: 3, requireAuth: true, secretKey: SECRET });
    Object.assign(process.env, { S3_ENDPOINT: s3.url, S3_REGION: 'us-east-1', S3_ACCESS_KEY: KEY_ID, S3_SECRET_KEY: SECRET, S3_BUCKET: 'bkt-mt' });
    delete process.env.B2_ACCESS_KEY; delete process.env.B2_BUCKET;
    vi.resetModules(); // los modulos leen S3_* al importarse
    M = {
        prisma: (await import('../prisma')).prisma,
        st: await import('../storage'),
        store: await import('../mail-transfer/store'),
        src: await import('../mail-transfer/source'),
        imp: await import('../mail-transfer/import-engine'),
        exp: await import('../mail-transfer/export-engine'),
        lim: await import('../mail-transfer/limits'),
    };
});
afterAll(async () => { await M?.prisma?.$disconnect(); await s3?.stop(); });

describe('exportar -> importar sobre S3 (fake local) con Postgres real', () => {
    it('ciclo completo con adjunto de 11 MiB (multipart), varios ticks, descarga por trozos y borrado final del prefijo', async () => {
        const { prisma, st, store, src, imp, exp, lim } = M;
        const storage = src.realStorage();
        const deps = (over: Partial<import('../mail-transfer/limits').TransferLimits> = {}) => imp.defaultEngineDeps({ storage, limits: { ...lim.transferLimits(), ...over } });

        // --- buzon origen con contenido REAL en el S3 fake (cuerpos, raw.json, adjuntos)
        const email = addr('ana');
        const u = await createUser(prisma, email);
        const big = randomBytes(11 * MIB);
        const small = Buffer.from('%PDF-1.4\n' + 'x'.repeat(2000));
        const put = async (key: string, body: string | Buffer, type = 'text/plain') => { await st.uploadToStorage(key, body as Buffer, type); return key; };
        const mk = async (over: Record<string, unknown>, html: string | null, text: string | null, atts: Array<{ filename: string; buf: Buffer }> = []) => {
            const base = `emails/2024-03-0${1 + Math.floor(Math.random() * 8)}/${uid('e')}`;
            return prisma.email.create({
                data: {
                    userId: u.id, messageId: `${uid('mid')}-${u.id}`, from: 'Luis <luis@remoto.test>', to: email, subject: 'x', read: true,
                    htmlKey: html ? await put(`${base}/content.html`, html, 'text/html') : null,
                    textKey: text ? await put(`${base}/content.txt`, text) : null,
                    rawKey: await put(`${base}/raw.json`, '{}', 'application/json'),
                    ...(over as object),
                    attachments: { create: await Promise.all(atts.map(async (a) => ({ filename: a.filename, mimeType: 'application/octet-stream', size: a.buf.length, key: await put(`${base}/attachments/${a.filename}`, a.buf, 'application/octet-stream'), status: 'ready' }))) },
                },
                select: { id: true },
            });
        };
        await mk({ subject: 'Con adjunto grande', createdAt: new Date('2024-03-01T10:00:00Z'), folder: 'inbox', read: false }, '<p>Hola</p>', 'Hola', [{ filename: 'grande.bin', buf: big }, { filename: 'peq ñ.pdf', buf: small }]);
        await mk({ subject: 'Enviado', createdAt: new Date('2024-03-02T10:00:00Z'), folder: 'sent', from: email, to: 'luis@remoto.test' }, null, 'Cuerpo\nFrom aqui\nfin');
        await mk({ subject: 'Papelera', createdAt: new Date('2024-03-03T10:00:00Z'), folder: 'trash' }, '<b>bye</b>', 'bye');
        expect(s3.stats.createMultipart).toBeGreaterThanOrEqual(1); // el adjunto de 11 MiB uso multipart real

        // --- exportacion en varios ticks (1 mensaje por tick) => la cola del ZIP se reanuda desde S3 (tailVersion)
        const opts = { scopeMode: 'one', mailboxes: [email], folders: [], includeAttachments: true, format: 'mbox', oneTime: true };
        const j = (await store.jobs.create({ userId: `adm_${tag}`, actorKind: 'user', domain: 'example.test', kind: 'export', scope: 'mailboxes', status: 'queued', format: 'mbox', options: opts as any }))!;
        const d = deps({ maxItemsPerTick: 1 });
        let ticks = 0;
        for (; ticks < 100; ticks++) { const r = await exp.runExportTick(j.id, d); if (!r.more) { expect(r.status).toBe('done'); break; } }
        expect(ticks).toBeGreaterThanOrEqual(3);
        const job = (await store.jobs.get(j.id))!;
        expect(job.status).toBe('done');
        expect(job.outputBytes).toBeGreaterThan(8 * MIB); // el adjunto (aleatorio) no comprime: mas de 2 trozos de 4 MiB
        const prefix = lim.jobPrefix(j.id);

        // --- en S3 quedan SOLO los trozos out/ (temporales cd/mf/colas borrados) y con tamano exacto
        const left = [...s3.objects.keys()].filter((k: string) => k.startsWith(`${prefix}`)).sort();
        const nChunks = Math.ceil(job.outputBytes / src.CHUNK_SIZE);
        expect(nChunks).toBeGreaterThanOrEqual(3);
        expect(left).toEqual(Array.from({ length: nChunks }, (_, i) => `${prefix}/out/${src.chunkName(i)}`));
        left.forEach((k, i) => expect(s3.objects.get(k).body.length).toBe(i < nChunks - 1 ? src.CHUNK_SIZE : job.outputBytes - (nChunks - 1) * src.CHUNK_SIZE));

        // --- descarga por trozos con ChunkedSource + Range directo sobre un trozo (como el proxy de descargas)
        const source = new src.ChunkedSource(storage, `${prefix}/out`, job.outputBytes);
        const zip = await source.read(0, job.outputBytes);
        expect(createHash('sha256').update(zip).digest('hex')).toBe(job.outputSha256);
        const first = (await st.getObjectStream(`${prefix}/out/000000`, `bytes=${src.CHUNK_SIZE - 16}-`))!;
        expect(first.status).toBe(206);
        expect(first.contentRange).toBe(`bytes ${src.CHUNK_SIZE - 16}-${src.CHUNK_SIZE - 1}/${src.CHUNK_SIZE}`);
        expect((await source.read(src.CHUNK_SIZE - 16, 32)).equals(zip.subarray(src.CHUNK_SIZE - 16, src.CHUNK_SIZE + 16))).toBe(true);
        const files = unzipSync(new Uint8Array(zip));
        expect(Object.keys(files).sort()).toEqual([`${email}/Inbox.mbox`, `${email}/Sent.mbox`, `${email}/Trash.mbox`, 'manifest.json']);

        // --- importacion del ZIP en OTRO buzon (origen leido de S3 por trozos, contenido escrito en S3)
        const carla = await createUser(prisma, addr('carla'));
        const ij = (await store.jobs.create({ userId: `adm_${tag}`, actorKind: 'user', domain: 'example.test', kind: 'import', scope: 'domain', status: 'analyzing', fileName: 'export.zip', totalBytes: zip.length }))!;
        for (let i = 0, o = 0; o < zip.length; i++, o += src.CHUNK_SIZE) await storage.put(`${lim.jobPrefix(ij.id)}/src/${src.chunkName(i)}`, zip.subarray(o, o + src.CHUNK_SIZE));
        const di = deps({ maxItemsPerTick: 1 });
        const drain = async () => { for (let i = 0; i < 100; i++) { const r = await imp.runImportTick(ij.id, di); if (!r.more) return r; } throw new Error('no termina'); };
        expect((await drain()).status).toBe('ready');
        expect((await store.jobs.get(ij.id))!.summary).toMatchObject({ messages: 3, folders: { inbox: 1, sent: 1, trash: 1 } });
        await store.jobs.update(ij.id, { status: 'queued', options: { mailboxMap: { [email]: addr('carla') } } });
        expect((await drain()).status).toBe('done');
        expect(await store.jobs.get(ij.id)).toMatchObject({ importedItems: 3, errorItems: 0, duplicateItems: 0 });

        // el buzon destino tiene el mismo contenido y los adjuntos coinciden byte a byte (leidos DESDE el S3 fake)
        const summarize = async (userId: string) => (await prisma.email.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, include: { attachments: true } }))
            .map((e: any) => ({ subject: e.subject, folder: e.folder, read: e.read, at: e.createdAt.toISOString(), att: e.attachments.map((x: any) => x.filename).sort() }));
        expect(await summarize(carla.id)).toEqual(await summarize(u.id));
        const copyBig = await prisma.attachment.findFirst({ where: { email: { userId: carla.id }, filename: 'grande.bin' } });
        expect(copyBig.key).not.toBe((await prisma.attachment.findFirst({ where: { email: { userId: u.id }, filename: 'grande.bin' } })).key);
        expect((await st.getBufferFromStorage(copyBig.key, { strict: true }))!.equals(big)).toBe(true);
        const copySent = await prisma.email.findFirst({ where: { userId: carla.id, folder: 'sent' } });
        expect((await st.getFromStorage(copySent.textKey))!.replace(/\r\n/g, '\n')).toBe('Cuerpo\nFrom aqui\nfin');

        // el import ya purgo su prefijo; el del export se borra ahora con la misma capa (list paginada + DeleteObjects)
        expect([...s3.objects.keys()].filter((k: string) => k.startsWith(`${lim.jobPrefix(ij.id)}/`))).toEqual([]);
        const calls0 = s3.stats.deleteObjectsCalls;
        expect(await imp.purgeJobStorage(j.id, { storage })).toBe(nChunks);
        expect(s3.stats.deleteObjectsCalls).toBeGreaterThan(calls0);
        expect([...s3.objects.keys()].filter((k: string) => k.startsWith('mailtransfer/'))).toEqual([]);
        // ...y no toca el resto del almacenamiento (correos, adjuntos)
        expect(s3.objects.size).toBeGreaterThan(10);
        expect(s3.uploads.size).toBe(0); // ningun multipart huerfano
        expect(s3.stats.requests).toBeGreaterThan(50);
        expect(s3.stats.denied).toBe(0); // toda peticion llevo una firma SigV4 valida
    }, 180_000);
});
