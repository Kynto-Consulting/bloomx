/**
 * Siembra en el E2E LOCAL la conversacion mixta de hilos (13 correos de 12 clientes; 2 hilos con el mismo asunto raiz) para el usuario de
 * prueba. Ver scripts/e2e-README.md. Requiere haber ejecutado antes `npx tsx scripts/seed-e2e.ts` (crea .env.e2e, el usuario y el esquema).
 *
 *   npx tsx scripts/e2e-seed-threads.ts
 *
 * Idempotente: borra los correos sembrados por este script (subject de las dos conversaciones) del usuario de prueba y los vuelve a crear.
 * Los correos se guardan en orden ALEATORIO (como llegarian por la red) y pasan por la MISMA asignacion de hilos que la ingesta real.
 * Fixtures sinteticos: personas y dominios ficticios (.test). SOLO local: aborta si DATABASE_URL no es 127.0.0.1.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');

function loadE2eEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const l of fs.readFileSync(path.join(root, '.env.e2e'), 'utf8').split(/\r?\n/)) {
        const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (m && !l.startsWith('#')) env[m[1]] = m[2].replace(/^"|"$/g, '');
    }
    return env;
}

async function main() {
    for (const [k, v] of Object.entries(loadE2eEnv())) process.env[k] = v;
    const dbUrl = new URL(process.env.DATABASE_URL!);
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(dbUrl.hostname)) throw new Error('e2e-seed-threads: DATABASE_URL no es local. Abortando.');

    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    const { buildFixtureMessages, shuffled, OWNER } = await import('../src/lib/__tests__/helpers/thread-fixtures');
    const { assignThread, headersOfInbound } = await import('../src/lib/thread-store');
    const { threadInfoFromRawMime } = await import('../src/lib/thread-headers');

    const USER_EMAIL = 'tester@bloomx.test';
    const user = await prisma.user.findUnique({ where: { email: USER_EMAIL } });
    if (!user) throw new Error('Falta el usuario de prueba: ejecuta antes `npx tsx scripts/seed-e2e.ts`.');

    const storageRoot = path.join(root, '.gemini', 'storage');
    const put = (key: string, data: string) => {
        const full = path.join(storageRoot, key);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, data);
    };
    const mine = (s: string | undefined) => (s ? s.split(OWNER).join(USER_EMAIL) : s);

    const msgs = buildFixtureMessages();
    const subjects = Array.from(new Set(msgs.map((m) => m.subject)));
    const old = await prisma.email.findMany({ where: { userId: user.id, messageId: { startsWith: 'thr-fixture-' } }, select: { id: true } });
    if (old.length) await prisma.email.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });

    // Las fechas de los fixtures se desplazan para quedar en los ultimos dias
    const base = Date.now() - 4 * 24 * 3600 * 1000;
    const t0 = msgs[0].date.getTime();
    const day = new Date().toISOString().split('T')[0];
    const created: Record<string, string> = {};
    for (const m of shuffled(msgs, 20260901)) {
        const uuid = crypto.randomUUID();
        const prefix = `emails/${day}/${uuid}`;
        const htmlKey = m.html ? `${prefix}/content.html` : null;
        const textKey = `${prefix}/content.txt`;
        if (htmlKey) put(htmlKey, mine(m.html)!);
        put(textKey, mine(m.text)!);
        const rawKey = `${prefix}/raw.json`;
        put(rawKey, JSON.stringify({ type: 'email.received', data: { message_id: `<${m.mid}>`, headers: {} } }));
        put(`${prefix}/raw.eml`, mine(m.mime)!);
        const when = new Date(base + (m.date.getTime() - t0));
        const to = mine(m.to)!;
        const row = await prisma.email.create({
            data: {
                userId: user.id, messageId: `thr-fixture-${m.key}-${uuid}`, from: mine(m.from)!, to, cc: mine(m.cc) ?? null,
                cleanTo: (to.match(/<([^>]+)>/g) ?? []).map((x) => x.slice(1, -1)).join(', '), subject: m.subject, snippet: m.text.slice(0, 200),
                htmlKey, textKey, rawKey, createdAt: when, read: m.direction === 'out', attachmentsChecked: true,
                folder: m.direction === 'out' ? 'sent' : 'inbox', status: m.direction === 'out' ? 'sent' : 'received',
            },
        });
        created[m.key] = row.id;
        const info = threadInfoFromRawMime(Buffer.from(mine(m.mime)!, 'utf8'));
        await assignThread({ userId: user.id, emailId: row.id, headers: headersOfInbound(info), date: when.getTime(), subject: m.subject, from: mine(m.from), to, cc: mine(m.cc), own: [USER_EMAIL] });
    }
    const keys = (await prisma.$queryRawUnsafe('SELECT "threadKey", count(*)::int AS n FROM "Email" WHERE "userId" = $1 AND "messageId" LIKE \'thr-fixture-%\' GROUP BY 1 ORDER BY 2 DESC', user.id)) as Array<{ threadKey: string; n: number }>;
    console.log(JSON.stringify({ subjects, emails: created, threads: keys }, null, 2));
    fs.mkdirSync(path.join(root, '.e2e'), { recursive: true });
    fs.writeFileSync(path.join(root, '.e2e', 'threads-manifest.json'), JSON.stringify({ emails: created, threads: keys }, null, 2));
    await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
