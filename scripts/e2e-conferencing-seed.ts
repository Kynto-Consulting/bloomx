/**
 * Siembra el E2E LOCAL de conferencias (ver scripts/e2e-README.md): cuentas Google y Zoom FALSAS del usuario de prueba y el
 * archivo de entorno con las bases de los servidores falsos. NUNCA servicios reales; aborta si la BD no es 127.0.0.1.
 *
 * Requisitos: haber ejecutado antes `npx tsx scripts/seed-e2e.ts` (crea .env.e2e y el usuario de prueba).
 * Uso:        npx tsx scripts/e2e-conferencing-seed.ts [--zoom-s2s]
 *   --zoom-s2s  escribe ademas credenciales de instancia (Server-to-Server) de PRUEBA en .e2e/ext-credentials.json para core-zoom
 *               (simula lo definido en el panel del administrador); sin la opcion Zoom solo usa la cuenta del usuario.
 * No imprime ni guarda secretos reales: todos los valores son literales de prueba ("fake-...").
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const envFile = path.join(root, '.env.e2e');
if (!fs.existsSync(envFile)) {
    console.error('[e2e-conferencing-seed] Falta .env.e2e: ejecuta antes `npx tsx scripts/seed-e2e.ts`.');
    process.exit(1);
}
const env: Record<string, string> = {};
for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2];
}
for (const [k, v] of Object.entries(env)) process.env[k] = v;
if (new URL(env.DATABASE_URL).hostname !== '127.0.0.1') {
    console.error('[e2e-conferencing-seed] DATABASE_URL no es 127.0.0.1. Abortando.');
    process.exit(1);
}

const FAKE = `http://127.0.0.1:${process.env.E2E_CONFERENCING_PORT || '54340'}`;

async function main() {
    const { prisma } = await import('../src/lib/prisma'); // con la extension de cifrado de tokens de Account
    const user = await prisma.user.findUnique({ where: { email: env.E2E_USER_EMAIL || 'tester@bloomx.test' } });
    if (!user) throw new Error('Usuario de prueba no encontrado: ejecuta scripts/seed-e2e.ts');

    const far = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    for (const [provider, scope] of [
        ['google', 'openid email https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/meetings.space.created'],
        ['zoom', 'meeting:write'],
    ] as const) {
        const existing = await prisma.account.findFirst({ where: { userId: user.id, provider } });
        const data = { access_token: `fake-${provider}-access`, refresh_token: `fake-${provider}-refresh`, expires_at: far, scope, token_type: 'Bearer' };
        if (existing) await prisma.account.update({ where: { id: existing.id }, data });
        else await prisma.account.create({ data: { userId: user.id, type: 'oauth', provider, providerAccountId: `fake-${provider}-${user.id}`, ...data } });
    }

    // Entorno adicional que e2e-dev.mjs mezcla al arrancar next dev (bases de API SOLO para pruebas locales).
    fs.mkdirSync(path.join(root, '.e2e'), { recursive: true });
    fs.writeFileSync(
        path.join(root, '.e2e', 'conferencing.env'),
        [
            'GOOGLE_CLIENT_ID=fake-google-client',
            'GOOGLE_CLIENT_SECRET=fake-google-secret',
            `GOOGLE_TOKEN_URL=${FAKE}/google/token`,
            `GOOGLE_API_BASE=${FAKE}/google`,
            `MEET_API_BASE=${FAKE}/meet/v2`,
            `GOOGLE_USERINFO_URL=${FAKE}/google/oauth2/v2/userinfo`,
            'ZOOM_CLIENT_ID=fake-zoom-client',
            'ZOOM_CLIENT_SECRET=fake-zoom-secret',
            `ZOOM_API_BASE=${FAKE}/zoom/v2`,
            `ZOOM_OAUTH_BASE=${FAKE}/zoom`,
            '',
        ].join('\n'),
    );

    const credFile = path.join(root, '.e2e', 'ext-credentials.json');
    if (process.argv.includes('--zoom-s2s')) {
        fs.writeFileSync(credFile, JSON.stringify({ 'core-zoom': { ZOOM_AUTH_MODE: 'server-to-server', ZOOM_ACCOUNT_ID: 'fake-account', ZOOM_CLIENT_ID: 'fake-s2s-client', ZOOM_CLIENT_SECRET: 'fake-s2s-secret' } }, null, 2));
    } else if (fs.existsSync(credFile)) {
        fs.rmSync(credFile);
    }
    await prisma.$disconnect();
    console.log(`[e2e-conferencing-seed] OK: cuentas falsas Google/Zoom para ${user.email}${process.argv.includes('--zoom-s2s') ? ' + credenciales Zoom S2S de prueba' : ''}.`);
}

main().catch((e) => { console.error('[e2e-conferencing-seed] FALLO:', e); process.exit(1); });
