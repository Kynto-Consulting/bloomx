import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { assertLocalPg, createEmail, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { BODY_ESTIMATE, MB, QUOTA_USAGE_SQL, checkQuotaForSend, getQuotaStatus, invalidateQuotaCache, loadPolicy, loadUsage } from '../mail-quota';
import { getQuotaSettings, saveQuotaSettings } from '../admin/quota-settings';
import { __setAuditSink } from '../audit';

// Cuota de buzon contra Postgres REAL: consulta de uso, politica resuelta (usuario > dominio > entorno), cache corta,
// GET /api/quota, bloqueo opcional en POST /api/emails y ajustes de la consola. `npm run test:pg`.

const STARTED_AT = new Date(Date.now() - 1000);
let sessionUser: { id: string; email: string; name: string } | null = null;
const resendSend = vi.fn();
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => sessionUser }));
vi.mock('@/lib/resend', () => ({ resend: { emails: { send: (...a: unknown[]) => resendSend(...a) } } }));
vi.mock('@/lib/storage', () => ({ uploadToStorage: vi.fn(async () => undefined), getBufferFromStorage: vi.fn(async () => null) }));
vi.mock('@/lib/expansions/server-hooks', () => ({
    runEmailPreSendHooksForRequest: async () => ({ stop: false, modify: {}, warnings: [] }),
    buildEmailSentContext: () => ({}),
    fireLifecycleHook: () => false,
}));

const KEYS = ['mailQuotaMb', 'enforceMailQuota'];
const clearSettings = () => prisma.$executeRawUnsafe(`DELETE FROM "AdminSetting" WHERE "key" = ANY($1::text[]) OR "key" LIKE 'mailQuotaMb:user:%'`, KEYS);
const setting = (key: string, value: unknown) =>
    prisma.$executeRawUnsafe(`INSERT INTO "AdminSetting" ("key","value","updatedBy") VALUES ($1, $2::jsonb, 'test') ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"`, key, JSON.stringify(value));

let me: { id: string; email: string; name: string };

beforeAll(async () => {
    assertLocalPg();
    for (const m of ['log', 'error', 'warn'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
    __setAuditSink(async () => undefined);
    const u = await createUser(prisma);
    me = { id: u.id, email: u.email, name: 'Yo' };
});
beforeEach(async () => {
    sessionUser = me;
    invalidateQuotaCache();
    vi.unstubAllEnvs();
    vi.stubEnv('MAIL_QUOTA_MB', '');
    await clearSettings();
    resendSend.mockReset();
    resendSend.mockImplementation(async () => ({ data: { id: uid('re') }, error: null }));
});
// Los datos globales (usuarios, correos, eventos, borradores) que crea este archivo se borran al terminar: otras suites (metricas de admin)
// hacen agregados sobre toda la base y no deben verlos.
afterAll(async () => { await clearSettings(); vi.unstubAllEnvs(); __setAuditSink(null); await 
    await prisma.$executeRawUnsafe('DELETE FROM "EmailEvent" WHERE "createdAt" >= $1', STARTED_AT);
    await prisma.$executeRawUnsafe('DELETE FROM "Draft" WHERE "createdAt" >= $1', STARTED_AT);
    await prisma.$executeRawUnsafe('DELETE FROM "User" WHERE "createdAt" >= $1', STARTED_AT);
    await prisma.$disconnect();
});

describe('uso del buzon', () => {
    it('suma adjuntos (sin PENDING ni ajenos) + estimacion documentada de cuerpos, exacta y parametrizada', async () => {
        const u = await createUser(prisma);
        const stranger = await createUser(prisma);
        await createEmail(prisma, u.id, {
            subject: 'áé', snippet: 'hola', htmlKey: 'h/1', textKey: 't/1',
            attachments: { create: [
                { filename: 'a', mimeType: 'x/y', size: 1000, key: 'k/a' },
                { filename: 'b', mimeType: 'x/y', size: 500, key: 'k/b' },
                { filename: 'p', mimeType: 'x/y', size: 99999, key: 'PENDING' },
            ] },
        });
        await createEmail(prisma, u.id, { subject: null, snippet: null, htmlKey: null, textKey: 't/2' });
        await createEmail(prisma, u.id, { subject: 'sin cuerpo', snippet: '' });
        await createEmail(prisma, stranger.id, { htmlKey: 'h/9', attachments: { create: [{ filename: 'z', mimeType: 'x/y', size: 777, key: 'k/z' }] } });

        const usage = await loadUsage(u.id);
        const meta = BODY_ESTIMATE.meta;
        const expectedBodies =
            (4 /* "áé" = 4 bytes UTF-8 */ + 4 + meta + BODY_ESTIMATE.html + BODY_ESTIMATE.text) +
            (0 + 0 + meta + BODY_ESTIMATE.text) +
            (10 + 0 + meta);
        expect(usage).toEqual({ attachmentsBytes: 1500, bodiesBytes: expectedBodies, emails: 3 });
    });

    it('usa los indices existentes (Email_userId_idx y Attachment_emailId_idx)', async () => {
        const plan = await prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
            const rows = await tx.$queryRawUnsafe(`EXPLAIN ${QUOTA_USAGE_SQL}`, me.id, BODY_ESTIMATE.meta, BODY_ESTIMATE.html, BODY_ESTIMATE.text) as Array<Record<string, string>>;
            return rows.map((r) => Object.values(r)[0]).join('\n');
        });
        expect(plan).toMatch(/Email_userId_/);
        expect(plan).toContain('Attachment_emailId_idx');
    });
});

describe('politica resuelta: usuario > dominio > entorno > sin limite', () => {
    it('sin nada: sin limite (solo se muestra el uso)', async () => {
        expect(await loadPolicy(me.id)).toEqual({ limitBytes: null, source: 'none', enforce: false });
        const s = await getQuotaStatus(me.id, { fresh: true });
        expect(s).toMatchObject({ limitBytes: null, percent: null, level: 'unlimited', notice: false });
    });

    it('entorno MAIL_QUOTA_MB; el dominio lo pisa; el usuario pisa al dominio; 0 = sin limite; valores invalidos se ignoran', async () => {
        vi.stubEnv('MAIL_QUOTA_MB', '100');
        expect(await loadPolicy(me.id)).toMatchObject({ limitBytes: 100 * MB, source: 'env' });
        await setting('mailQuotaMb', 50);
        expect(await loadPolicy(me.id)).toMatchObject({ limitBytes: 50 * MB, source: 'domain' });
        await setting(`mailQuotaMb:user:${me.id}`, 10);
        expect(await loadPolicy(me.id)).toMatchObject({ limitBytes: 10 * MB, source: 'user' });
        await setting(`mailQuotaMb:user:${me.id}`, 0); // este usuario sin limite aunque el dominio tenga
        expect(await loadPolicy(me.id)).toMatchObject({ limitBytes: null, source: 'user' });
        await clearSettings();
        await setting('mailQuotaMb', -5);
        expect(await loadPolicy(me.id)).toMatchObject({ limitBytes: 100 * MB, source: 'env' });
        await setting('mailQuotaMb', 'mucho');
        expect(await loadPolicy(me.id)).toMatchObject({ source: 'env' });
        vi.stubEnv('MAIL_QUOTA_MB', 'abc');
        expect(await loadPolicy(me.id)).toMatchObject({ limitBytes: null, source: 'none' });
    });

    it('la cuota de otro usuario no afecta a este', async () => {
        const o = await createUser(prisma);
        await setting(`mailQuotaMb:user:${o.id}`, 1);
        expect(await loadPolicy(me.id)).toMatchObject({ source: 'none' });
    });

    it('sin la tabla AdminSetting cae al entorno sin fallar', async () => {
        vi.stubEnv('MAIL_QUOTA_MB', '20');
        await prisma.$executeRawUnsafe('ALTER TABLE "AdminSetting" RENAME TO "AdminSetting_off"');
        try {
            expect(await loadPolicy(me.id)).toMatchObject({ limitBytes: 20 * MB, source: 'env', enforce: false });
        } finally {
            await prisma.$executeRawUnsafe('ALTER TABLE "AdminSetting_off" RENAME TO "AdminSetting"');
        }
    });
});

describe('niveles y cache', () => {
    async function withUsage(bytes: number) {
        const u = await createUser(prisma);
        await createEmail(prisma, u.id, { subject: null, snippet: null, attachments: { create: [{ filename: 'x', mimeType: 'x/y', size: bytes - BODY_ESTIMATE.meta, key: 'k/x' }] } });
        await setting(`mailQuotaMb:user:${u.id}`, 1);
        return u;
    }

    it.each([
        [0.5, 'ok', false], [0.79, 'ok', false], [0.8, 'warning', false], [0.9, 'warning', false], [0.91, 'warning', true], [0.95, 'critical', true], [1, 'exceeded', true], [1.4, 'exceeded', true],
    ])('uso al %s de la cuota -> nivel %s (aviso >90%%: %s)', async (fraction, level, notice) => {
        const u = await withUsage(Math.round(fraction * MB));
        const s = await getQuotaStatus(u.id, { fresh: true });
        expect(s.level).toBe(level);
        expect(s.notice).toBe(notice);
        expect(s.percent).toBeCloseTo(fraction * 100, 0);
    });

    it('cache corta: no recalcula dentro del TTL y se invalida al enviar / expirar', async () => {
        const u = await createUser(prisma);
        const a = await getQuotaStatus(u.id, { now: 1_000_000 });
        await createEmail(prisma, u.id, { subject: 'nuevo' });
        expect((await getQuotaStatus(u.id, { now: 1_000_000 + 5_000 })).emails).toBe(a.emails); // cacheado
        expect((await getQuotaStatus(u.id, { now: 1_000_000 + 31_000 })).emails).toBe(a.emails + 1); // TTL vencido
        await createEmail(prisma, u.id, { subject: 'otro' });
        invalidateQuotaCache(u.id);
        expect((await getQuotaStatus(u.id)).emails).toBe(a.emails + 2);
    });
});

describe('GET /api/quota', () => {
    const call = async () => {
        const { GET } = await import('../../app/api/quota/route');
        const res = await GET();
        return { status: res.status, body: await res.json(), headers: res.headers };
    };

    it('sin sesion: 401', async () => {
        sessionUser = null;
        expect((await call()).status).toBe(401);
    });

    it('devuelve uso, limite, nivel y origen; nunca datos ajenos ni claves de almacenamiento', async () => {
        const u = await createUser(prisma);
        sessionUser = { id: u.id, email: u.email, name: 'Q' };
        await createEmail(prisma, u.id, { htmlKey: 'secret/key', attachments: { create: [{ filename: 'f', mimeType: 'x/y', size: 1000, key: 'attachments/private/f' }] } });
        await setting('mailQuotaMb', 2);
        const r = await call();
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ limitBytes: 2 * MB, source: 'domain', enforce: false, level: 'ok', notice: false, approximate: true, attachmentsBytes: 1000, emails: 1 });
        expect(r.body.usedBytes).toBe(1000 + BODY_ESTIMATE.meta + BODY_ESTIMATE.html + 0 + 0);
        expect(JSON.stringify(r.body)).not.toMatch(/secret|private/);
        expect(r.headers.get('cache-control')).toMatch(/no-store/);
    });

    it('rate limit asincrono: pasado el limite por minuto responde 429 con Retry-After', async () => {
        const u = await createUser(prisma);
        sessionUser = { id: u.id, email: u.email, name: 'RL' };
        let last = 200;
        let retry: string | null = null;
        for (let i = 0; i < 65; i++) {
            const { GET } = await import('../../app/api/quota/route');
            const res = await GET();
            last = res.status;
            if (res.status === 429) { retry = res.headers.get('retry-after'); break; }
        }
        expect(last).toBe(429);
        expect(Number(retry)).toBeGreaterThan(0);
    });
});

describe('bloqueo de envio (solo si el dominio activa enforceMailQuota)', () => {
    const send = async () => {
        const { POST } = await import('../../app/api/emails/route');
        const res = await POST(new NextRequest('http://localhost/api/emails', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ to: 'dest@ext.test', subject: 'Hola', html: '<p>hola</p>', text: 'hola' }),
        }));
        return { status: res.status, body: await res.json() };
    };
    async function fullMailbox() {
        const u = await createUser(prisma);
        sessionUser = { id: u.id, email: u.email, name: 'Lleno' };
        await createEmail(prisma, u.id, { subject: null, snippet: null, attachments: { create: [{ filename: 'g', mimeType: 'x/y', size: 3 * MB, key: 'k/g' }] } });
        await setting('mailQuotaMb', 1);
        return u;
    }

    it('por defecto NO bloquea aunque supere la cuota', async () => {
        await fullMailbox();
        const r = await send();
        expect(r.status).toBe(200);
        expect(resendSend).toHaveBeenCalledTimes(1);
    });

    it('con enforceMailQuota activo y el 100% alcanzado: 403 QUOTA_EXCEEDED, sin llamar a Resend ni guardar nada', async () => {
        const u = await fullMailbox();
        await setting('enforceMailQuota', true);
        const before = await prisma.email.count({ where: { userId: u.id } });
        const r = await send();
        expect(r.status).toBe(403);
        expect(r.body).toMatchObject({ code: 'QUOTA_EXCEEDED', limitBytes: MB });
        expect(r.body.usedBytes).toBeGreaterThan(MB);
        expect(resendSend).not.toHaveBeenCalled();
        expect(await prisma.email.count({ where: { userId: u.id } })).toBe(before);
    });

    it('con enforce activo pero por debajo del limite, o sin limite, envia; con enforce y cuota 0 (sin limite) tambien', async () => {
        const u = await createUser(prisma);
        sessionUser = { id: u.id, email: u.email, name: 'Ok' };
        await setting('mailQuotaMb', 1);
        await setting('enforceMailQuota', true);
        expect((await send()).status).toBe(200);
        await setting(`mailQuotaMb:user:${u.id}`, 0);
        expect((await send()).status).toBe(200);
        await clearSettings();
        await setting('enforceMailQuota', true); // sin limite en ninguna parte
        expect((await send()).status).toBe(200);
    });

    it('falla ABIERTO: si no se puede calcular la cuota, el envio no se bloquea', async () => {
        await fullMailbox();
        await setting('enforceMailQuota', true);
        await prisma.$executeRawUnsafe('ALTER TABLE "Attachment" RENAME COLUMN "size" TO "size_off"');
        try {
            expect((await checkQuotaForSend(sessionUser!.id)).blocked).toBe(false);
        } finally {
            await prisma.$executeRawUnsafe('ALTER TABLE "Attachment" RENAME COLUMN "size_off" TO "size"');
        }
    });
});

describe('ajustes de la consola (AdminSetting)', () => {
    it('guardar/leer dominio: valor, bloqueo, origen; null borra la fila y vuelve al entorno; false = comportamiento por defecto', async () => {
        vi.stubEnv('MAIL_QUOTA_MB', '30');
        let v = await getQuotaSettings();
        expect(v).toMatchObject({ mailQuotaMb: null, enforceMailQuota: false, envMailQuotaMb: 30, effectiveMb: 30, source: 'env' });
        v = await saveQuotaSettings({ mailQuotaMb: 200, enforceMailQuota: true }, 'admin@x.test');
        expect(v).toMatchObject({ mailQuotaMb: 200, enforceMailQuota: true, effectiveMb: 200, source: 'console', updatedBy: 'a***@x.test' });
        expect((await loadPolicy(me.id))).toMatchObject({ limitBytes: 200 * MB, source: 'domain', enforce: true });
        v = await saveQuotaSettings({ mailQuotaMb: 0 }, 'admin@x.test');
        expect(v).toMatchObject({ mailQuotaMb: 0, effectiveMb: null, source: 'console' }); // 0 = sin limite explicito
        v = await saveQuotaSettings({ mailQuotaMb: null, enforceMailQuota: false }, 'admin@x.test');
        expect(v).toMatchObject({ mailQuotaMb: null, enforceMailQuota: false, effectiveMb: 30, source: 'env' });
        const rows = await prisma.$queryRawUnsafe(`SELECT "key" FROM "AdminSetting" WHERE "key" = ANY($1::text[])`, KEYS) as any[];
        expect(rows).toEqual([]);
    });

    it('cuota por usuario: solo ese usuario; usuario inexistente 404; enforce no admite userId', async () => {
        const u = await createUser(prisma);
        await saveQuotaSettings({ userId: u.id, mailQuotaMb: 5 }, 'admin@x.test');
        expect(await loadPolicy(u.id)).toMatchObject({ limitBytes: 5 * MB, source: 'user' });
        expect(await loadPolicy(me.id)).toMatchObject({ source: 'none' });
        await saveQuotaSettings({ userId: u.id, mailQuotaMb: null }, 'admin@x.test');
        expect(await loadPolicy(u.id)).toMatchObject({ source: 'none' });
        await expect(saveQuotaSettings({ userId: 'no-existe', mailQuotaMb: 5 }, 'a@x.test')).rejects.toMatchObject({ status: 404 });
    });

    it('guardar invalida la cache de cuota', async () => {
        const u = await createUser(prisma);
        expect((await getQuotaStatus(u.id)).limitBytes).toBeNull();
        await saveQuotaSettings({ mailQuotaMb: 10 }, 'admin@x.test');
        expect((await getQuotaStatus(u.id)).limitBytes).toBe(10 * MB);
    });
});
