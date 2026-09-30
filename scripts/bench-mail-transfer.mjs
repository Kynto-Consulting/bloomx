// Benchmark de VOLUMEN de importar/exportar buzones (100 % local): genera un mbox sintetico de ~2 GB en flujo (nunca en memoria),
// lo importa con el motor real (Postgres embebido + almacenamiento en disco) y lo exporta, midiendo tiempo, throughput y memoria pico.
// Borra todo al terminar (mbox, almacenamiento, cluster Postgres).
//
//   npx tsx scripts/bench-mail-transfer.mjs [--gb=2] [--msg-kb=64] [--keep] [--budget-ms=45000]
//
// NUNCA usa la BD ni el almacenamiento del .env: usa un cluster efimero en 127.0.0.1 y un directorio temporal.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const GB = Number(args.gb ?? 2);
const MSG_KB = Number(args['msg-kb'] ?? 64);
const BUDGET_MS = Number(args['budget-ms'] ?? 45000);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomx-bench-'));
const MB = 1024 * 1024;
const fmt = (n) => (n / MB).toFixed(0);

if (process.env.NODE_ENV === 'production') throw new Error('bench: no se ejecuta con NODE_ENV=production');

// --- muestreo de memoria (RSS del proceso: incluye el motor de Prisma en proceso; NO incluye el Postgres embebido) -----------------
let peak = 0;
const sample = () => { peak = Math.max(peak, process.memoryUsage().rss); };
const timer = setInterval(sample, 200);
const phase = async (name, fn) => {
    peak = 0;
    const t0 = Date.now();
    const value = await fn();
    sample();
    const secs = (Date.now() - t0) / 1000;
    return { name, secs, peakRssMb: Math.round(peak / MB), value };
};

let pg = null;
const cleanup = async () => {
    clearInterval(timer);
    try { const { prisma } = await import(pathToFileURL(path.join(root, 'src/lib/prisma.ts')).href); await prisma.$disconnect(); } catch { /* no cargado */ }
    try { await pg?.stop(); } catch { /* ya detenido */ }
    if (!args.keep) fs.rmSync(work, { recursive: true, force: true });
};
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

try {
    // --- Postgres embebido + esquema real -------------------------------------------------------------------------------------------
    const { startPgTestServer } = await import('./pg-test-server.mjs');
    pg = await startPgTestServer({ quiet: true });
    process.env.DATABASE_URL = pg.url;
    delete process.env.DIRECT_URL;
    process.env.TOP_DOMAIN = 'bench.test';
    process.env.NEXT_PUBLIC_APP_URL = 'https://mail.bench.test';
    const src = (p) => import(pathToFileURL(path.join(root, 'src/lib', p)).href);
    const { ensureDatabaseSchema } = await src('db/schema.ts');
    await ensureDatabaseSchema();
    const { prisma } = await src('prisma.ts');
    const { fsStorage, CHUNK_SIZE, chunkName, ChunkedSource } = await src('mail-transfer/source.ts');
    const { jobs } = await src('mail-transfer/store.ts');
    const { runImportTick, defaultEngineDeps } = await src('mail-transfer/import-engine.ts');
    const { runExportTick } = await src('mail-transfer/export-engine.ts');
    const { transferLimits, jobPrefix } = await src('mail-transfer/limits.ts');
    const { readZipDirectory, extractZipEntry } = await src('mail-transfer/zip.ts');

    const email = 'bench@bench.test';
    const user = await prisma.user.create({ data: { email, password: 'x' } });
    const storage = fsStorage(path.join(work, 'store'));
    const limits = { ...transferLimits(), budgetMs: BUDGET_MS };
    const deps = defaultEngineDeps({ storage, limits });

    // --- 1) generar el mbox en flujo -----------------------------------------------------------------------------------------------
    const mboxPath = path.join(work, 'synthetic.mbox');
    const target = Math.floor(GB * 1024 * MB);
    let count = 0;
    const gen = await phase('generar mbox', async () => {
        const out = fs.createWriteStream(mboxPath, { highWaterMark: 4 * MB });
        let written = 0;
        const words = ['factura', 'reunion', 'proyecto', 'cliente', 'enviado', 'adjunto', 'hola', 'gracias', 'saludos', 'pedido'];
        const attBytes = Math.max(1024, Math.floor((MSG_KB * 1024 - 6000) * 0.75));
        while (written < target) {
            const i = count++;
            let body = '';
            for (let k = 0; body.length < 5000; k++) body += words[(i * 7 + k * 13) % words.length] + ((k % 9) === 8 ? '\n' : ' ');
            const b64 = randomBytes(attBytes).toString('base64').replace(/(.{76})/g, '$1\r\n');
            const date = new Date(Date.UTC(2015 + (i % 10), i % 12, 1 + (i % 27), i % 24, i % 60, 0));
            const raw =
                `From bench@example.test ${date.toUTCString().slice(0, 3)} Jan  1 00:00:00 2015\n` +
                `Message-ID: <bench-${i}@remoto.test>\nDate: ${date.toUTCString().replace('GMT', '+0000')}\nFrom: Remoto <r${i % 50}@remoto.test>\nTo: ${email}\nDelivered-To: ${email}\n` +
                `Subject: Mensaje sintetico ${i}\nX-Gmail-Labels: ${i % 5 === 0 ? 'Sent' : 'Inbox'},Etiqueta${i % 7}\nMIME-Version: 1.0\nContent-Type: multipart/mixed; boundary="bb${i}"\n\n` +
                `--bb${i}\nContent-Type: text/plain; charset=utf-8\n\n${body}\n--bb${i}\nContent-Type: application/pdf; name="doc${i}.pdf"\nContent-Transfer-Encoding: base64\nContent-Disposition: attachment; filename="doc${i}.pdf"\n\n%PDF-${b64}\n--bb${i}--\n\n`;
            const buf = Buffer.from(raw, 'latin1');
            written += buf.length;
            if (!out.write(buf)) await once(out, 'drain');
        }
        out.end();
        await once(out, 'finish');
        return written;
    });
    const mboxBytes = fs.statSync(mboxPath).size;

    // --- 2) "subida": trozos de 4 MiB al almacenamiento (igual que la ruta de subida) ---------------------------------------------------
    const job = await jobs.create({ userId: 'bench_admin', actorKind: 'user', domain: 'bench.test', kind: 'import', scope: 'domain', status: 'analyzing', fileName: 'synthetic.mbox', totalBytes: mboxBytes, options: {} });
    const up = await phase('subir a trozos', async () => {
        const fd = fs.openSync(mboxPath, 'r');
        const buf = Buffer.allocUnsafe(CHUNK_SIZE);
        for (let i = 0, o = 0; o < mboxBytes; i++, o += CHUNK_SIZE) {
            const n = fs.readSync(fd, buf, 0, Math.min(CHUNK_SIZE, mboxBytes - o), o);
            await storage.put(`${jobPrefix(job.id)}/src/${chunkName(i)}`, Buffer.from(buf.subarray(0, n)));
        }
        fs.closeSync(fd);
        return null;
    });
    fs.rmSync(mboxPath, { force: true }); // ya esta en el almacenamiento

    // --- 3) analisis + importacion ------------------------------------------------------------------------------------------------
    let ticks = 0;
    const drain = async (fn, id) => { for (;;) { const r = await fn(id, deps); ticks++; if (!r.more) return r; } };
    const an = await phase('analisis', async () => { ticks = 0; const r = await drain(runImportTick, job.id); return { status: r.status, ticks }; });
    await jobs.update(job.id, { status: 'queued', options: { targetMode: 'auto' } });
    const im = await phase('importacion', async () => { ticks = 0; const r = await drain(runImportTick, job.id); return { status: r.status, ticks }; });
    const done = await jobs.get(job.id);
    const emailCount = await prisma.email.count({ where: { userId: user.id } });

    // --- 4) exportacion ----------------------------------------------------------------------------------------------------------
    const ej = await jobs.create({ userId: 'bench_admin', actorKind: 'user', domain: 'bench.test', kind: 'export', scope: 'mailboxes', status: 'queued', format: 'mbox',
        options: { scopeMode: 'one', mailboxes: [email], folders: [], includeAttachments: true, format: 'mbox', oneTime: true, includePim: false } });
    const ex = await phase('exportacion', async () => { ticks = 0; const r = await drain(runExportTick, ej.id); return { status: r.status, ticks }; });
    const exported = await jobs.get(ej.id);

    // --- 5) verificacion del paquete (directorio central + sha256 de cada parte contra el manifiesto, en flujo) ----------------------------
    const ver = await phase('verificar paquete', async () => {
        const zsrc = new ChunkedSource(storage, `${jobPrefix(ej.id)}/out`, exported.outputBytes);
        const dir = await readZipDirectory(zsrc, { maxTotalBytes: 64 * 1024 * MB });
        const mf = dir.find((e) => e.path === 'manifest.json');
        const parts = [];
        await extractZipEntry(zsrc, mf, async (c) => { parts.push(Buffer.from(c)); });
        const manifest = JSON.parse(Buffer.concat(parts).toString('utf8'));
        let ok = 0;
        for (const f of manifest.files) {
            const e = dir.find((x) => x.path === f.path);
            const h = createHash('sha256');
            await extractZipEntry(zsrc, e, async (c) => { h.update(c); });
            if (h.digest('hex') === f.sha256) ok++;
        }
        return { files: manifest.files.length, shaOk: ok, messages: manifest.totals.messages };
    });

    const report = {
        target: { gb: GB, msgKb: MSG_KB, budgetMs: BUDGET_MS, node: process.version, cpus: os.cpus().length, platform: `${os.platform()} ${os.arch()}` },
        dataset: { messages: count, mboxMb: Number(fmt(mboxBytes)) },
        phases: [gen, up, an, im, ex, ver].map((p) => ({ fase: p.name, seg: Number(p.secs.toFixed(1)), rssPicoMb: p.peakRssMb, detalle: p.value })),
        throughput: {
            importacionMBs: Number((mboxBytes / MB / (an.secs + im.secs)).toFixed(1)),
            importacionMsgS: Number((count / (an.secs + im.secs)).toFixed(0)),
            exportacionMBs: Number((exported.outputBytes / MB / ex.secs).toFixed(1)),
            exportacionMsgS: Number((count / ex.secs).toFixed(0)),
        },
        result: { importedItems: done.importedItems, errorItems: done.errorItems, emailsInDb: emailCount, exportMessages: ver.value.messages, exportMb: Number(fmt(exported.outputBytes)), packageOk: ver.value.shaOk === ver.value.files },
        memoriaPicoMb: Math.max(gen.peakRssMb, up.peakRssMb, an.peakRssMb, im.peakRssMb, ex.peakRssMb, ver.peakRssMb),
    };
    console.log(JSON.stringify(report, null, 2));
    if (!report.result.packageOk || emailCount !== count) process.exitCode = 1;
} finally {
    await cleanup();
}
