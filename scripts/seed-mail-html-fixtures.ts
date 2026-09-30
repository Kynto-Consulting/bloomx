/**
 * Siembra (ADITIVO e idempotente) los fixtures de HTML de correo de src/lib/__tests__/fixtures/mail-html/ en el usuario
 * de pruebas del stack E2E local (ver scripts/e2e-README.md). Solo Postgres local; no borra nada que no sea suyo.
 * Uso: npx tsx scripts/seed-mail-html-fixtures.ts     (despues de scripts/seed-e2e.ts)
 * Escribe los ids en .e2e/mail-fixtures.json.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const FIX_DIR = path.join(root, 'src/lib/__tests__/fixtures/mail-html');

function loadEnv(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of fs.readFileSync(path.join(root, '.env.e2e'), 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (m && !line.trim().startsWith('#')) out[m[1]] = m[2];
    }
    return out;
}

async function main() {
    for (const [k, v] of Object.entries(loadEnv())) process.env[k] = v;
    const dbUrl = new URL(process.env.DATABASE_URL!);
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(dbUrl.hostname)) throw new Error('DATABASE_URL no es local. Abortando.');

    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    const user = await prisma.user.findUnique({ where: { email: 'tester@bloomx.test' } });
    if (!user) throw new Error('Falta el usuario de pruebas: ejecuta antes scripts/seed-e2e.ts');

    await prisma.email.deleteMany({ where: { userId: user.id, messageId: { startsWith: 'mailfx-' } } });

    const day = new Date().toISOString().split('T')[0];
    const storageRoot = path.join(root, '.gemini', 'storage');
    const put = (key: string, data: string) => {
        const full = path.join(storageRoot, key);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, data);
    };
    const ids: Record<string, string> = {};
    const files = fs.readdirSync(FIX_DIR).filter((f) => f.endsWith('.html')).sort();
    let minutes = 5;
    for (const file of files) {
        const tag = file.replace(/\.html$/, '');
        const html = fs.readFileSync(path.join(FIX_DIR, file), 'utf8');
        const uuid = crypto.randomUUID();
        const base = `emails/${day}/${uuid}`;
        put(`${base}/content.html`, html);
        put(`${base}/raw.json`, JSON.stringify({ type: 'email.received', data: { from: 'x', headers: {} } }));
        const created = await prisma.email.create({
            data: {
                userId: user.id, messageId: `mailfx-${tag}-${uuid}`, from: 'Juan Diego <gjuandiego213@ext.test>', to: user.email, cleanTo: user.email,
                subject: `FX ${tag}`, snippet: tag, htmlKey: `${base}/content.html`, rawKey: `${base}/raw.json`,
                createdAt: new Date(Date.now() - minutes++ * 60_000), read: true, attachmentsChecked: true,
            },
        });
        ids[tag] = created.id;
    }
    fs.mkdirSync(path.join(root, '.e2e'), { recursive: true });
    fs.writeFileSync(path.join(root, '.e2e', 'mail-fixtures.json'), JSON.stringify(ids, null, 2));
    await prisma.$disconnect();
    console.log(`[seed-mail-html-fixtures] OK: ${files.length} correos sembrados (.e2e/mail-fixtures.json).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
