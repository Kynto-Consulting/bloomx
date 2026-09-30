/**
 * Seed para las pruebas E2E LOCALES (ver scripts/e2e-README.md).
 *
 * - Genera (si no existe) `.env.e2e` con secretos y credenciales de PRUEBA aleatorios (crypto). Ese archivo esta en .gitignore.
 * - Aplica `ensureDatabaseSchema` y siembra datos SOLO en un Postgres en 127.0.0.1 (aborta en cualquier otro host).
 * - Guarda los adjuntos reales en el storage LOCAL de la app (`.gemini/storage`, ver src/lib/storage.ts).
 * - Escribe `.e2e/manifest.json` (ids, hashes sha256 de los adjuntos) para que la verificacion los compare.
 *
 * Uso: npx tsx scripts/seed-e2e.ts        (idempotente: borra y recrea los datos del usuario de prueba)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const envFile = path.join(root, '.env.e2e');

const PG_PORT = process.env.E2E_PG_PORT || '54329';
const APP_PORT = process.env.E2E_APP_PORT || '3100';
const RESEND_PORT = process.env.E2E_RESEND_PORT || '54330';

function rnd(bytes = 24) { return crypto.randomBytes(bytes).toString('base64url'); }
function whsec() { return `whsec_${crypto.randomBytes(24).toString('base64')}`; }

export const USER_EMAIL = 'tester@bloomx.test';
export const ADMIN_EMAIL = 'admin@bloomx.test';

function ensureEnvFile() {
    if (fs.existsSync(envFile)) return;
    const lines = [
        '# Generado por scripts/seed-e2e.ts. SOLO valores de prueba. No commitear (.gitignore).',
        `DATABASE_URL=postgresql://bloomx_test:bloomx_test_pw@127.0.0.1:${PG_PORT}/bloomx_e2e`,
        `NEXT_PUBLIC_APP_URL=http://localhost:${APP_PORT}`,
        'NODE_ENV=development',
        'NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:54331',
        'AI_PROVIDER=openai',
        `RESEND_API_KEY=re_e2e_${rnd(12)}`,
        `RESEND_BASE_URL=http://127.0.0.1:${RESEND_PORT}`,
        `NEXTAUTH_SECRET=${rnd(32)}`,
        `INTERNAL_SECRET=${rnd(32)}`,
        `EXTENSION_HOOKS_SECRET=${rnd(32)}`,
        `WEBHOOK_SECRET=${whsec()}`,
        `RESEND_WEBHOOK_SECRET=${whsec()}`,
        `REGISTRATION_KEY=${rnd(18)}`,
        `CRON_SECRET=${rnd(24)}`,
        `DATA_ENCRYPTION_KEY=${rnd(32)}`,
        `ASSET_SIGNING_KEY=${rnd(32)}`,
        `MOLT_SIGNING_KEY=${rnd(32)}`,
        `MFA_RECOVERY_PEPPER=${rnd(24)}`,
        `COOKIE_SECRET=${rnd(32)}`,
        `EXPANSION_SECRET=${rnd(32)}`,
        `ADMIN_EMAILS=${ADMIN_EMAIL}`,
        'TOP_DOMAIN=',
        `E2E_USER_EMAIL=${USER_EMAIL}`,
        `E2E_USER_PASSWORD=Aa1!${rnd(14)}`,
        `E2E_ADMIN_PASSWORD=Aa1!${rnd(14)}`,
        '',
    ];
    fs.writeFileSync(envFile, lines.join('\n'), { mode: 0o600 });
}

export function loadE2eEnv(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (m && !line.trim().startsWith('#')) out[m[1]] = m[2];
    }
    return out;
}

const NAMES_WITH_COMMA = {
    to: '"Alarcon, Piero" <piero@bloomx.test>, "Doe, Jane" <jane.doe@ext.test>',
    cc: '"Lopez Ruiz, Maria" <maria.lopez@ext.test>, carlos@ext.test',
};

async function main() {
    ensureEnvFile();
    const env = loadE2eEnv();
    for (const [k, v] of Object.entries(env)) process.env[k] = v;

    // Salvaguarda dura: nunca sembrar fuera de un Postgres local.
    const dbUrl = new URL(process.env.DATABASE_URL!);
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(dbUrl.hostname)) {
        throw new Error('seed-e2e: DATABASE_URL no es local. Abortando.');
    }

    const { ensureDatabaseSchema } = await import('../src/lib/db/schema');
    await ensureDatabaseSchema();

    const { PrismaClient } = await import('@prisma/client');
    const bcrypt = (await import('bcryptjs')).default;
    const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

    const storageRoot = path.join(root, '.gemini', 'storage');
    const putStorage = (key: string, data: Buffer | string) => {
        const full = path.join(storageRoot, key);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, data);
    };

    // --- Limpieza previa (idempotente) ---
    await prisma.user.deleteMany({ where: { email: { in: [USER_EMAIL, ADMIN_EMAIL] } } });

    const user = await prisma.user.create({
        data: { email: USER_EMAIL, name: 'Tester E2E', password: await bcrypt.hash(env.E2E_USER_PASSWORD, 10) },
    });
    await prisma.user.create({
        data: { email: ADMIN_EMAIL, name: 'Admin E2E', password: await bcrypt.hash(env.E2E_ADMIN_PASSWORD, 10) },
    });

    // --- Labels ---
    const lNews = await prisma.label.create({ data: { userId: user.id, name: 'Newsletters', color: '#2563eb' } });
    const lFin = await prisma.label.create({ data: { userId: user.id, name: 'Finanzas', color: '#16a34a' } });
    const lProj = await prisma.label.create({ data: { userId: user.id, name: 'Proyectos', color: '#9333ea' } });

    // --- Regla preexistente ---
    // (Rule se usa por SQL crudo en la app; el cliente Prisma generado puede no incluir el modelo)
    const ruleId = 'rul_seed_' + crypto.randomUUID().replace(/-/g, '');
    const ruleConds = JSON.stringify({ match: 'all', items: [{ field: 'from', op: 'contains', value: 'newsletter@' }] });
    const ruleActs = JSON.stringify([{ type: 'addLabel', labelId: lNews.id }, { type: 'markRead' }]);
    await prisma.$executeRaw`INSERT INTO "Rule" ("id","userId","name","enabled","priority","conditions","actions","stopProcessing")
        VALUES (${ruleId}, ${user.id}, 'Newsletters a etiqueta', true, 10, ${ruleConds}::jsonb, ${ruleActs}::jsonb, false)`;

    // --- Contactos ---
    for (const c of [
        { email: 'jane.doe@ext.test', name: 'Doe, Jane' },
        { email: 'maria.lopez@ext.test', name: 'Maria Lopez' },
        { email: 'carlos@ext.test', name: 'Carlos Ruiz' },
    ]) await prisma.contact.create({ data: { userId: user.id, ...c } });

    // --- Correos ---
    const day = new Date().toISOString().split('T')[0];
    const manifest: any = { userId: user.id, userEmail: USER_EMAIL, emails: {}, attachments: {} };
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

    async function makeEmail(tag: string, o: {
        from: string; to: string; cc?: string | null; subject: string; html?: string; text?: string;
        minutes: number; headers?: Record<string, string>; read?: boolean; labels?: string[];
        attachments?: Array<{ filename: string; mimeType: string; data: Buffer; contentId?: string }>;
    }) {
        const uuid = crypto.randomUUID();
        const base = `emails/${day}/${uuid}`;
        const htmlKey = o.html ? `${base}/content.html` : null;
        const textKey = o.text ? `${base}/content.txt` : null;
        if (htmlKey) putStorage(htmlKey, o.html!);
        if (textKey) putStorage(textKey, o.text!);
        const rawKey = `${base}/raw.json`;
        putStorage(rawKey, JSON.stringify({ type: 'email.received', data: { from: o.from, to: [o.to], subject: o.subject, headers: o.headers || {} } }));
        const attRecords = (o.attachments || []).map((a) => {
            const key = `${base}/attachments/${a.filename}`;
            putStorage(key, a.data);
            manifest.attachments[a.filename] = { sha256: crypto.createHash('sha256').update(a.data).digest('hex'), size: a.data.length, key };
            return { filename: a.filename, mimeType: a.mimeType, size: a.data.length, key, status: 'ready' };
        });
        const created = await prisma.email.create({
            data: {
                userId: user.id, messageId: `seed-${tag}-${uuid}`, from: o.from, to: o.to, cc: o.cc ?? null,
                cleanTo: user.email, subject: o.subject, snippet: (o.text || '').slice(0, 200),
                htmlKey, textKey, rawKey, createdAt: minutesAgo(o.minutes), read: !!o.read, attachmentsChecked: true,
                attachments: { create: attRecords },
                labels: { connect: (o.labels || []).map((id) => ({ id })) },
            },
        });
        manifest.emails[tag] = created.id;
    }

    // 1) To + Cc de 4 personas (2 con coma en el nombre) + el propio usuario
    await makeEmail('multi', {
        from: '"Pérez, Ana" <ana.perez@ext.test>',
        to: `${NAMES_WITH_COMMA.to}, ${USER_EMAIL}`.replace('"Alarcon, Piero" <piero@bloomx.test>, ', '"Alarcon, Piero" <piero@bloomx.test>, '),
        cc: NAMES_WITH_COMMA.cc,
        subject: 'Kickoff del proyecto Alfa',
        html: '<p>Hola equipo, este es el <b>kickoff</b> del proyecto Alfa.</p>',
        text: 'Hola equipo, este es el kickoff del proyecto Alfa.',
        minutes: 5,
    });

    // 2) Dos adjuntos reales (PNG valido + PDF minimo) con bytes aleatorios al final para un hash distintivo
    const png = Buffer.concat([
        Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex'),
    ]);
    const pdf = Buffer.from(
        `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n% e2e ${crypto.randomBytes(16).toString('hex')}\n`,
    );
    await makeEmail('attachments', {
        from: 'Facturacion <billing@ext.test>',
        to: USER_EMAIL,
        subject: 'Factura 2026-09 con adjuntos',
        html: '<p>Adjunto la factura y el logo.</p>',
        text: 'Adjunto la factura y el logo.',
        minutes: 12,
        labels: [lFin.id],
        attachments: [
            { filename: 'logo-e2e.png', mimeType: 'image/png', data: png },
            { filename: 'factura-e2e.pdf', mimeType: 'application/pdf', data: pdf },
        ],
    });

    // 3) Hilo (3 mensajes)
    await makeEmail('thread1', { from: 'Bea <bea@ext.test>', to: USER_EMAIL, subject: 'Reunion semanal', text: 'Podemos movernos al jueves?', html: '<p>Podemos movernos al jueves?</p>', minutes: 180, read: true, labels: [lProj.id] });
    await makeEmail('thread2', { from: `Tester E2E <${USER_EMAIL}>`, to: 'bea@ext.test', subject: 'Re: Reunion semanal', text: 'Si, jueves a las 10.', html: '<p>Si, jueves a las 10.</p>', minutes: 120, read: true });
    await makeEmail('thread3', { from: 'Bea <bea@ext.test>', to: USER_EMAIL, subject: 'Re: Reunion semanal', text: 'Perfecto, gracias.', html: '<p>Perfecto, gracias.</p>', minutes: 60, labels: [lProj.id] });

    // 4) HTML hostil / imagenes remotas
    await makeEmail('hostile', {
        from: 'Promo <promo@evil.test>',
        to: USER_EMAIL,
        subject: 'Oferta especial imperdible',
        text: 'Oferta',
        html: [
            '<div id="hostile-marker">Contenido hostil</div>',
            '<script>window.__pwned = true; document.title = "PWNED";</script>',
            '<img src="http://127.0.0.1:54399/tracker.png?id=e2e" width="1" height="1" alt="tracker">',
            '<img src="http://127.0.0.1:54399/banner.png" alt="banner">',
            '<a href="javascript:alert(1)" id="js-link">click</a>',
            '<iframe src="http://127.0.0.1:54399/frame"></iframe>',
            '<form action="http://127.0.0.1:54399/steal"><input name="x"></form>',
            '<p onclick="window.__pwned=true" id="onclick-p">onclick</p>',
        ].join('\n'),
        minutes: 20,
    });

    // 5) Authentication-Results (pass/pass/pass) y otro fail
    await makeEmail('auth-pass', {
        from: 'Seguro <ok@ext.test>', to: USER_EMAIL, subject: 'Correo autenticado', text: 'Todo bien.', html: '<p>Todo bien.</p>', minutes: 30,
        headers: { 'Authentication-Results': 'mx.resend.test; spf=pass smtp.mailfrom=ext.test; dkim=pass header.d=ext.test; dmarc=pass header.from=ext.test' },
    });
    await makeEmail('auth-fail', {
        from: 'Banco <seguridad@banco-falso.test>', to: USER_EMAIL, subject: 'Verifique su cuenta urgente', text: 'Haga clic.', html: '<p>Haga clic.</p>', minutes: 35,
        headers: { 'Authentication-Results': 'mx.resend.test; spf=fail smtp.mailfrom=banco-falso.test; dkim=none; dmarc=fail header.from=banco-falso.test' },
    });

    // 6) Newsletter (sin regla aplicada: la regla solo actua en ingesta) y uno para busqueda
    await makeEmail('newsletter', { from: 'Semanal <newsletter@ext.test>', to: USER_EMAIL, subject: 'Boletin semanal', text: 'Novedades de la semana', html: '<p>Novedades de la semana</p>', minutes: 300 });

    // --- Borrador ---
    const draft = await prisma.draft.create({
        data: { from: USER_EMAIL, to: 'bea@ext.test', subject: 'Borrador E2E', body: '<p>Texto del borrador</p>' },
    });
    manifest.draftId = draft.id;

    fs.mkdirSync(path.join(root, '.e2e'), { recursive: true });
    fs.writeFileSync(path.join(root, '.e2e', 'manifest.json'), JSON.stringify(manifest, null, 2));
    await prisma.$disconnect();
    console.log(`[seed-e2e] OK: usuario ${USER_EMAIL}, ${Object.keys(manifest.emails).length} correos, .e2e/manifest.json escrito.`);
}

main().catch((e) => { console.error('[seed-e2e] FALLO:', e); process.exit(1); });
