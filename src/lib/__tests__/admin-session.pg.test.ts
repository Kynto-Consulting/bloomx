import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertLocalPg, createUser } from './helpers/pg';
import { prisma } from '../prisma';
import { __setAuditSink, type AuditRecord } from '../audit';
import { __resetRateLimitState } from '../security';
import { issueReauthToken } from '../mail-transfer/auth';
import { __resetPermissionSnapshot, type PermissionLevel } from '../permissions-core';
import { refreshPermissions } from '../permissions';
import {
    __resetPrivilegedPolicyCache, closePrivileged, enterPrivileged, getEnd, getPrivilegedStatus, isLocked, releaseIfOwner, setPrivilegedPolicy, type EnterInput,
} from '../privileged-session';
import { __setNotifyTransports } from '../privileged-notify';
import { authenticateCli } from '../admin-cli/auth';
import { executeCommand, stepUpKey, type ExecAuth } from '../admin-cli/exec';
import { MACHINE_MAX_TTL_HOURS, createCliToken, listCliTokens, verifyCliToken } from '../admin-cli/tokens';
import { query } from '../admin/sql';

/**
 * UNA sola sesion privilegiada por cuenta (nivel >= 1), contra Postgres real: web->web, web->CLI, CLI->CLI, carrera de dos entradas, 401
 * `superseded` con mensaje, nivel 0 sin restriccion, refrescos que no cuentan, avisos (correo + push) con dedupe, alerta a superadmins ante un
 * reemplazo sospechoso, cierre por inactividad / tope de 12 h, tokens "machine" que no ocupan el slot y bloqueo por "pelea de sesiones".
 */

const tag = `s${Math.random().toString(36).slice(2, 8)}`;
const em = (n: string) => `${n}.${tag}@pg.test`;
const U: Record<string, { id: string; email: string }> = {};
const emails: Array<{ to: string; subject: string; html: string; text: string }> = [];
const pushes: Array<{ userId: string; title: string; body: string }> = [];
const events: AuditRecord[] = [];

beforeAll(async () => {
    assertLocalPg();
    process.env.SESSION_REVOCATION_CACHE_MS = '0';
    process.env.NEXT_PUBLIC_BACKEND_URL = 'http://127.0.0.1:1'; // la marca del correo no debe esperar a la red
    process.env.ADMIN_EMAILS = `${em('sa1')}, ${em('sa2')}, ${em('alice')}, ${em('carol')}`;
    delete process.env.ADMIN_EMAILS_LOCKED;
    delete process.env.ADMIN_LOCKOUT_RESET;
    process.env.MFA_ENFORCE_ADMIN = 'true';
    for (const n of ['sa1', 'sa2', 'alice', 'carol', 'bob', 'dave']) U[n] = await createUser(prisma, em(n));
});
afterAll(async () => { __setAuditSink(null); __setNotifyTransports(null); await prisma.$disconnect(); });
beforeEach(async () => {
    __resetRateLimitState();
    __resetPermissionSnapshot();
    __resetPrivilegedPolicyCache();
    emails.length = 0; pushes.length = 0; events.length = 0;
    __setAuditSink(async (r) => { events.push(r); });
    __setNotifyTransports({
        email: async (to, subject, html, text) => { emails.push({ to, subject, html, text }); },
        push: async (userId, p) => { pushes.push({ userId, title: p.title, body: p.body }); },
    });
    const ids = Object.values(U).map((u) => u.id);
    for (const t of ['PrivilegedSession', 'PrivilegedSessionEnd', 'PrivilegedLock']) await prisma.$executeRawUnsafe(`DELETE FROM "${t}" WHERE "userId" = ANY($1::text[])`, ids);
    await prisma.$executeRawUnsafe(`DELETE FROM "AdminCliToken" WHERE "adminId" = ANY($1::text[])`, ids);
    await prisma.$executeRawUnsafe(`DELETE FROM "UserPermission" WHERE "email" LIKE $1`, `%.${tag}@pg.test`);
    await prisma.$executeRawUnsafe(`DELETE FROM "AdminSetting" WHERE "key" = 'privileged_session'`);
    await refreshPermissions({ force: true });
});

const settle = () => new Promise((r) => setTimeout(r, 350));
const enter = (n: string, ref: string, over: Partial<EnterInput> = {}) =>
    enterPrivileged({ userId: U[n].id, email: U[n].email, level: 4, kind: 'web', ref, ip: '10.0.0.1', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36', ...over });
const revoked = async (jti: string) => (await query<{ jti: string }>(`SELECT "jti" FROM "RevokedSession" WHERE "jti" = $1`, jti)).length === 1;
const slot = async (n: string) => (await query<any>(`SELECT * FROM "PrivilegedSession" WHERE "userId" = $1`, U[n].id))[0] ?? null;
const req = (token: string, ip = '10.0.0.2') => new NextRequest('http://localhost/api/admin/cli/exec', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'user-agent': 'bloomx-cli/0.1', 'x-forwarded-for': ip } });
const mkToken = async (n: string, over: Record<string, unknown> = {}) => (await createCliToken({ kind: 'user', adminId: U[n].id, adminEmail: U[n].email, name: 't', scopes: ['read', 'write'], permissionLevel: 4, ...over })).token;
const body = async (r: Awaited<ReturnType<typeof authenticateCli>>) => (r.ok ? null : await r.response.json());

describe('slot unico: la sesion nueva reemplaza a la anterior', () => {
    it('web -> web: la primera se REVOCA en el acto y se anota por que', async () => {
        expect(await enter('alice', 'jti-A')).toEqual({ ok: true });
        expect((await slot('alice')).sessionRef).toBe('jti-A');
        const r = await enter('alice', 'jti-B', { ip: '10.0.0.9' });
        expect(r).toMatchObject({ ok: true, superseded: true });
        expect(await revoked('jti-A')).toBe(true);
        expect(await revoked('jti-B')).toBe(false);
        expect((await slot('alice')).sessionRef).toBe('jti-B');
        expect(await getEnd('jti-A')).toMatchObject({ reason: 'superseded', byKind: 'web', byIp: '10.0.0.9' });
    });

    it('web -> CLI y CLI -> web y CLI -> CLI: siempre gana la nueva y la vieja recibe 401 `superseded` con cuando y desde donde', async () => {
        // web -> CLI
        await enter('alice', 'jti-W');
        const t1 = await mkToken('alice');
        const a = await authenticateCli(req(t1, '203.0.113.7'));
        expect(a.ok).toBe(true);
        expect(await revoked('jti-W')).toBe(true);
        expect((await getEnd('jti-W'))).toMatchObject({ reason: 'superseded', byKind: 'cli', byIp: '203.0.113.7' });
        // CLI -> CLI
        const t2 = await mkToken('alice');
        expect((await authenticateCli(req(t2, '198.51.100.4'))).ok).toBe(true);
        const old = await authenticateCli(req(t1));
        expect(old.ok).toBe(false);
        expect(!old.ok && old.response.status).toBe(401);
        const oldBody = await body(old);
        expect(oldBody).toMatchObject({ code: 'superseded', reason: 'superseded', byKind: 'cli', byIp: '198.51.100.4' });
        expect(oldBody.byDevice).toContain('bloomx-cli');
        // (tres reemplazos seguidos bloquearian la cuenta: se limpia el historial para probar el siguiente caso por separado)
        await prisma.$executeRawUnsafe(`DELETE FROM "PrivilegedSessionEnd" WHERE "userId" = $1`, U.alice.id);
        // CLI -> web: el token (dueno del slot) queda revocado y su siguiente uso es `superseded`
        expect((await enter('alice', 'jti-W2', { ip: '192.0.2.50' })).ok).toBe(true);
        const t2again = await authenticateCli(req(t2));
        expect(await body(t2again)).toMatchObject({ code: 'superseded', byKind: 'web', byIp: '192.0.2.50' });
        expect((await verifyCliToken(t2))).toMatchObject({ ok: false, reason: 'revoked' });
    });

    it('carrera: dos entradas simultaneas -> gana una y la otra queda revocada (nunca dos activas)', async () => {
        for (let i = 0; i < 8; i++) {
            const a = `race-a-${i}`; const b = `race-b-${i}`;
            await prisma.$executeRawUnsafe(`DELETE FROM "PrivilegedSession" WHERE "userId" = $1`, U.carol.id);
            await prisma.$executeRawUnsafe(`DELETE FROM "PrivilegedSessionEnd" WHERE "userId" = $1`, U.carol.id);
            await prisma.$executeRawUnsafe(`DELETE FROM "PrivilegedLock" WHERE "userId" = $1`, U.carol.id);
            __resetRateLimitState();
            const [ra, rb] = await Promise.all([enter('carol', a), enter('carol', b)]);
            expect(ra.ok || rb.ok).toBe(true);
            const owner = (await slot('carol')).sessionRef as string;
            expect([a, b]).toContain(owner);
            const loser = owner === a ? b : a;
            const winner = owner;
            const ends = await query<{ sessionRef: string }>(`SELECT "sessionRef" FROM "PrivilegedSessionEnd" WHERE "userId" = $1`, U.carol.id);
            expect(ends.map((e) => e.sessionRef), `iteracion ${i}`).toEqual([loser]);
            expect(await revoked(loser)).toBe(true);
            expect(await revoked(winner)).toBe(false);
            await prisma.$executeRawUnsafe(`DELETE FROM "RevokedSession" WHERE "jti" = ANY($1::text[])`, [a, b]);
        }
    });

    it('nivel 0 (usuario normal): sin restriccion ni filas de slot', async () => {
        for (const ref of ['n1', 'n2', 'n3']) expect(await enter('bob', ref, { level: 0 })).toEqual({ ok: true });
        expect(await slot('bob')).toBeNull();
        expect(await revoked('n1')).toBe(false);
    });

    it('las renovaciones y refrescos (mismo jti) NO crean una sesion nueva', async () => {
        await enter('alice', 'jti-S');
        const created = (await slot('alice')).createdAt;
        for (let i = 0; i < 5; i++) expect(await enter('alice', 'jti-S')).toEqual({ ok: true });
        expect((await slot('alice')).createdAt).toEqual(created);
        expect(await query(`SELECT 1 FROM "PrivilegedSessionEnd" WHERE "userId" = $1`, U.alice.id)).toHaveLength(0);
    });

    it('el logout libera el slot; un cierre desde "Cerrar sesion privilegiada" la revoca', async () => {
        await enter('alice', 'jti-L');
        await releaseIfOwner(U.alice.id, 'jti-L');
        expect(await slot('alice')).toBeNull();
        expect(await enter('dave', 'x1')).toEqual({ ok: true });
        await enter('alice', 'jti-C');
        const c = await closePrivileged(U.alice.id);
        expect(c).toEqual({ closed: true, kind: 'web' });
        expect(await revoked('jti-C')).toBe(true);
        expect(await slot('alice')).toBeNull();
        expect(await closePrivileged(U.alice.id)).toEqual({ closed: false, kind: null });
    });

    it('un reemplazo se audita (admin.session.superseded) y el estado muestra donde y desde cuando', async () => {
        await enter('alice', 'jti-A', { ip: '10.0.0.1' });
        await enter('alice', 'jti-B', { ip: '10.0.0.1' });
        expect(events.map((e) => e.event)).toContain('admin.session.superseded');
        const st = await getPrivilegedStatus(U.alice.id);
        expect(st.active).toMatchObject({ kind: 'web', ip: '10.0.0.1' });
        expect(st.active?.device).toBe('Chrome / Windows');
        expect(st.policy).toMatchObject({ idleMinutes: 15, absoluteHours: 12, lockThreshold: 3, lockWindowMinutes: 10 });
    });
});

describe('avisos (correo + push) y alerta de reemplazo sospechoso', () => {
    it('al cerrar la sesion anterior se avisa por correo y push al titular, sin tokens ni datos sensibles, y con dedupe de 1/min', async () => {
        await enter('alice', 'jti-A', { ip: '10.0.0.1' });
        await enter('alice', 'jti-B', { ip: '10.0.0.1' }); // mismo IP y dispositivo: no es sospechoso
        await settle();
        const mine = emails.filter((e) => e.to === U.alice.email);
        expect(mine).toHaveLength(1);
        expect(mine[0].subject).toMatch(/sesi[oó]n de administraci[oó]n se cerr[oó]/i);
        expect(mine[0].text).toContain('10.0.0.1');
        expect(mine[0].text).toContain('Chrome / Windows');
        expect(mine[0].text).toMatch(/cambia tu contrase/i);
        expect(mine[0].html).toContain('/security');
        expect(JSON.stringify(mine)).not.toMatch(/bxa_|jti-A|jti-B|auth_session|Bearer/);
        expect(pushes.filter((p) => p.userId === U.alice.id)).toHaveLength(1);
        expect(emails.some((e) => U.sa1.email === e.to)).toBe(false); // no sospechoso: los superadmins no reciben alerta
        // dedupe: otro reemplazo dentro del mismo minuto no vuelve a avisar
        await enter('alice', 'jti-C', { ip: '10.0.0.1' });
        await settle();
        expect(emails.filter((e) => e.to === U.alice.email)).toHaveLength(1);
        expect(pushes.filter((p) => p.userId === U.alice.id)).toHaveLength(1);
    });

    it('reemplazo desde OTRA IP/dispositivo: aviso destacado al titular + alerta a TODOS los superadmins + evento de seguridad', async () => {
        await enter('alice', 'jti-A', { ip: '10.0.0.1' });
        await enter('alice', 'jti-B', { ip: '203.0.113.99', userAgent: 'Mozilla/5.0 (Linux; Android 14) Firefox/121.0' });
        await settle();
        const holder = emails.find((e) => e.to === U.alice.email)!;
        expect(holder.subject).toMatch(/alerta/i);
        expect(holder.text).toMatch(/NO fuiste t[uú]/);
        expect(holder.text).toMatch(/DIFERENTE|DISTINTO/i);
        expect(holder.html).toContain('Cambiar contraseña y cerrar sesiones');
        const alerted = emails.filter((e) => /Alerta de seguridad|Security alert/.test(e.subject)).map((e) => e.to).sort();
        expect(alerted).toEqual([U.carol.email, U.sa1.email, U.sa2.email].sort()); // los demas superadmins (no el titular)
        expect(events.map((e) => e.event)).toContain('admin.session.superseded.suspicious');
        const sus = events.find((e) => e.event === 'admin.session.superseded.suspicious')!;
        expect(sus.data).toMatchObject({ oldIp: '10.0.0.1', newDevice: 'Firefox / Android' });
    });

    it('un reemplazo de una sesion YA CADUCADA no avisa ni cuenta', async () => {
        await enter('alice', 'jti-A');
        await prisma.$executeRawUnsafe(`UPDATE "PrivilegedSession" SET "lastSeenAt" = NOW() - INTERVAL '2 hours' WHERE "userId" = $1`, U.alice.id);
        expect(await enter('alice', 'jti-B')).toEqual({ ok: true });
        await settle();
        expect(emails).toHaveLength(0);
        expect((await getEnd('jti-A'))?.reason).toBe('expired_idle');
    });
});

describe('cierre por inactividad y tope absoluto', () => {
    it('15 min por defecto: a los 16 min la sesion caduca (401 expired), se revoca y se avisa', async () => {
        await enter('alice', 'jti-I');
        await prisma.$executeRawUnsafe(`UPDATE "PrivilegedSession" SET "lastSeenAt" = NOW() - INTERVAL '16 minutes' WHERE "userId" = $1`, U.alice.id);
        const r = await enter('alice', 'jti-I');
        expect(r).toMatchObject({ ok: false, reason: 'expired_idle' });
        expect(await revoked('jti-I')).toBe(true);
        expect(await slot('alice')).toBeNull();
        expect(await getEnd('jti-I')).toMatchObject({ reason: 'expired_idle' });
        await settle();
        expect(events.map((e) => e.event)).toContain('admin.session.expired');
        expect(emails.find((e) => e.to === U.alice.email)?.subject).toMatch(/caduc/i);
    });

    it('a los 14 min sigue viva y la actividad la renueva', async () => {
        await enter('alice', 'jti-I');
        await prisma.$executeRawUnsafe(`UPDATE "PrivilegedSession" SET "lastSeenAt" = NOW() - INTERVAL '14 minutes' WHERE "userId" = $1`, U.alice.id);
        expect(await enter('alice', 'jti-I')).toEqual({ ok: true });
        const idle = Date.now() - new Date((await slot('alice')).lastSeenAt).getTime();
        expect(idle).toBeLessThan(5_000); // el uso renovo el contador
    });

    it('las consultas pasivas (sondeo de estado) no extienden la sesion, pero tambien detectan la caducidad', async () => {
        await enter('alice', 'jti-P');
        await prisma.$executeRawUnsafe(`UPDATE "PrivilegedSession" SET "lastSeenAt" = NOW() - INTERVAL '10 minutes' WHERE "userId" = $1`, U.alice.id);
        expect(await enter('alice', 'jti-P', { passive: true })).toEqual({ ok: true });
        const idle = Date.now() - new Date((await slot('alice')).lastSeenAt).getTime();
        expect(idle).toBeGreaterThan(9 * 60_000); // no se renovo
        await prisma.$executeRawUnsafe(`UPDATE "PrivilegedSession" SET "lastSeenAt" = NOW() - INTERVAL '20 minutes' WHERE "userId" = $1`, U.alice.id);
        expect(await enter('alice', 'jti-P', { passive: true })).toMatchObject({ ok: false, reason: 'expired_idle' });
    });

    it('la inactividad es configurable por instancia entre 5 y 60 minutos', async () => {
        expect((await setPrivilegedPolicy({ idleMinutes: 5 }, 'test')).idleMinutes).toBe(5);
        expect((await setPrivilegedPolicy({ idleMinutes: 1 }, 'test')).idleMinutes).toBe(5); // acotado al minimo
        expect((await setPrivilegedPolicy({ idleMinutes: 500 }, 'test')).idleMinutes).toBe(60); // y al maximo
        await setPrivilegedPolicy({ idleMinutes: 5 }, 'test');
        await enter('alice', 'jti-5');
        await prisma.$executeRawUnsafe(`UPDATE "PrivilegedSession" SET "lastSeenAt" = NOW() - INTERVAL '6 minutes' WHERE "userId" = $1`, U.alice.id);
        expect(await enter('alice', 'jti-5')).toMatchObject({ ok: false, reason: 'expired_idle' });
    });

    it('tope absoluto de 12 h aunque haya actividad (expired_absolute)', async () => {
        await enter('alice', 'jti-12');
        await prisma.$executeRawUnsafe(`UPDATE "PrivilegedSession" SET "createdAt" = NOW() - INTERVAL '12 hours 5 minutes', "lastSeenAt" = NOW() WHERE "userId" = $1`, U.alice.id);
        expect(await enter('alice', 'jti-12')).toMatchObject({ ok: false, reason: 'expired_absolute' });
        expect(await revoked('jti-12')).toBe(true);
        expect(await getEnd('jti-12')).toMatchObject({ reason: 'expired_absolute' });
    });

    it('un token interactivo de CLI caduca igual: 401 con codigo `expired` (distinto de `superseded`)', async () => {
        const t = await mkToken('alice');
        expect((await authenticateCli(req(t))).ok).toBe(true);
        await prisma.$executeRawUnsafe(`UPDATE "PrivilegedSession" SET "lastSeenAt" = NOW() - INTERVAL '30 minutes' WHERE "userId" = $1`, U.alice.id);
        const r = await authenticateCli(req(t));
        expect(!r.ok && r.response.status).toBe(401);
        expect(await body(r)).toMatchObject({ code: 'expired', reason: 'expired_idle' });
        const again = await authenticateCli(req(t)); // ya revocado: sigue explicando `expired`
        expect(await body(again)).toMatchObject({ code: 'expired' });
    });
});

describe('tokens "machine" (automatizacion)', () => {
    it('NO ocupan el slot, no echan a la sesion interactiva y se acotan: solo lectura, nivel <= 3, 24 h por defecto y 7 d maximo', async () => {
        await enter('alice', 'jti-keep');
        const m = await createCliToken({ kind: 'user', adminId: U.alice.id, adminEmail: U.alice.email, name: 'cron', scopes: ['read'], permissionLevel: 4, tokenClass: 'machine' });
        expect(m.record.tokenClass).toBe('machine');
        expect(m.record.permissionLevel).toBe(3); // nunca nivel 4
        const hours = (new Date(m.record.expiresAt!).getTime() - Date.now()) / 3_600_000;
        expect(hours).toBeGreaterThan(23.9); expect(hours).toBeLessThanOrEqual(24.01);
        const a = await authenticateCli(req(m.token));
        expect(a.ok && a.auth.actor.level).toBe(3);
        expect(a.ok && a.auth.session.scopes).toEqual(['read']);
        expect((await slot('alice')).sessionRef).toBe('jti-keep'); // el slot sigue siendo de la sesion interactiva
        expect(await revoked('jti-keep')).toBe(false);
        const long = await createCliToken({ kind: 'user', adminId: U.alice.id, name: 'cron2', scopes: ['read'], permissionLevel: 4, tokenClass: 'machine', ttlHours: 99999 });
        expect((new Date(long.record.expiresAt!).getTime() - Date.now()) / 3_600_000).toBeLessThanOrEqual(MACHINE_MAX_TTL_HOURS);
        await expect(createCliToken({ kind: 'user', adminId: U.alice.id, name: 'w', scopes: ['write'], permissionLevel: 4, tokenClass: 'machine' })).rejects.toMatchObject({ code: 'scope_not_allowed_for_machine' });
    });

    it('se emiten solo con step-up MFA, se listan con su clase y se invalidan si la cuenta baja de nivel', async () => {
        const auth = (): ExecAuth => ({ actor: { kind: 'user', id: U.alice.id, email: U.alice.email, level: 4, levelSource: 'env' }, session: { source: 'web', scopes: ['read', 'write', 'security'] }, ip: '127.0.0.5', userAgent: 'vitest' });
        const line = 'tokens create --name cron --machine --yes';
        expect(await executeCommand({ line }, auth())).toMatchObject({ needs: 'stepup' });
        const pw = issueReauthToken(stepUpKey(U.alice), 'password', null).token;
        expect(await executeCommand({ line, stepUp: pw }, auth())).toMatchObject({ needs: 'stepup', error: { code: 'mfa_stepup_required' } });
        const mfa = issueReauthToken(stepUpKey(U.alice), 'mfa', null).token;
        const made = await executeCommand({ line: `${line} --json`, stepUp: mfa }, auth());
        expect(made.ok, JSON.stringify(made.error)).toBe(true);
        expect((made.json as any).class).toBe('machine');
        const listed = await listCliTokens(U.alice.id);
        expect(listed.map((t) => t.tokenClass)).toContain('machine');
        const tk = (made.json as any).token as string;
        expect((await authenticateCli(req(tk))).ok).toBe(true);
        // la cuenta baja a nivel 0 (sin concesion): el token machine deja de valer en la siguiente peticion
        await prisma.$executeRawUnsafe(`DELETE FROM "UserPermission" WHERE "email" = $1`, U.alice.email);
        const { revokeAllCliTokens } = await import('../admin-cli/tokens');
        await revokeAllCliTokens(U.alice.id);
        expect((await authenticateCli(req(tk))).ok).toBe(false);
    });

    it('cada uso queda auditado (con el token identificado por su id corto, nunca por su valor)', async () => {
        const m = await createCliToken({ kind: 'user', adminId: U.alice.id, adminEmail: U.alice.email, name: 'cron', scopes: ['read'], permissionLevel: 4, tokenClass: 'machine' });
        const a = await authenticateCli(req(m.token));
        expect(a.ok).toBe(true);
        const res = await executeCommand({ line: 'limits --json' }, (a as { ok: true; auth: ExecAuth }).auth);
        expect(res.ok).toBe(true);
        const rec = events.find((e) => e.event === 'admin.cli.exec')!;
        expect(rec.data.credRef).toBe(m.record.id.slice(0, 8));
        expect(JSON.stringify(events)).not.toContain(m.token);
    });
});

describe('pelea de sesiones: bloqueo del acceso privilegiado', () => {
    const fight = async (n: string, rounds: number) => {
        let last: Awaited<ReturnType<typeof enter>> | null = null;
        for (let i = 0; i <= rounds; i++) last = await enter(n, `fight-${i}`, { ip: `10.1.0.${i}` });
        return last!;
    };

    it('el TERCER reemplazo en 10 min bloquea la cuenta (web y CLI), cierra todo, avisa y audita', async () => {
        const last = await fight('alice', 3); // 1 entrada + 3 reemplazos
        expect(last).toMatchObject({ ok: false, reason: 'locked' });
        expect(await isLocked(U.alice.id, U.alice.email)).toBe(true);
        expect(await slot('alice')).toBeNull(); // nadie conserva acceso privilegiado
        expect(await revoked('fight-3')).toBe(true); // tambien la sesion que acaba de entrar
        // sigue bloqueada para cualquier sesion nueva y para los tokens (incluidos los machine)
        expect(await enter('alice', 'otra')).toMatchObject({ ok: false, reason: 'locked' });
        const t = await mkToken('alice');
        const m = await createCliToken({ kind: 'user', adminId: U.alice.id, name: 'cron', scopes: ['read'], permissionLevel: 4, tokenClass: 'machine' });
        for (const tok of [t, m.token]) {
            const r = await authenticateCli(req(tok));
            expect(!r.ok && r.response.status).toBe(403);
            expect(await body(r)).toMatchObject({ code: 'locked' });
        }
        await settle();
        expect(events.map((e) => e.event)).toContain('admin.session.lockout');
        const lock = events.find((e) => e.event === 'admin.session.lockout')!;
        expect(lock.data).toMatchObject({ replacements: 3, windowMinutes: 10 });
        // correo + push al afectado y alerta a los demas superadmins
        expect(emails.some((e) => e.to === U.alice.email && /bloqueado/i.test(e.subject))).toBe(true);
        expect(pushes.some((p) => p.userId === U.alice.id && /bloqueado/i.test(p.title))).toBe(true);
        expect(emails.filter((e) => /Alerta: acceso de administraci/.test(e.subject)).map((e) => e.to).sort()).toEqual([U.carol.email, U.sa1.email, U.sa2.email].sort());
        expect(emails.find((e) => e.to === U.alice.email && /bloqueado/i.test(e.subject))!.text).toMatch(/cambia tu contrase/i);
    });

    it('con 2 reemplazos NO bloquea; los reemplazos fuera de la ventana no cuentan; el umbral y la ventana son configurables', async () => {
        expect((await fight('alice', 2)).ok).toBe(true);
        expect(await isLocked(U.alice.id)).toBe(false);
        // los dos reemplazos previos salen de la ventana: el siguiente no bloquea
        await prisma.$executeRawUnsafe(`UPDATE "PrivilegedSessionEnd" SET "endedAt" = NOW() - INTERVAL '11 minutes' WHERE "userId" = $1`, U.alice.id);
        expect((await enter('alice', 'late-1', { ip: '10.9.9.9' })).ok).toBe(true);
        expect(await isLocked(U.alice.id)).toBe(false);
        // umbral 2 y ventana 30 min: ahora 2 reemplazos recientes bastan
        await setPrivilegedPolicy({ lockThreshold: 2, lockWindowMinutes: 30 }, 'test');
        await prisma.$executeRawUnsafe(`DELETE FROM "PrivilegedSessionEnd" WHERE "userId" = $1`, U.alice.id);
        await prisma.$executeRawUnsafe(`DELETE FROM "PrivilegedSession" WHERE "userId" = $1`, U.alice.id);
        expect((await enter('alice', 'p1', { ip: '10.9.9.8' })).ok).toBe(true);
        expect((await enter('alice', 'p2', { ip: '10.9.9.7' })).ok).toBe(true); // 1 reemplazo
        expect(await enter('alice', 'p3', { ip: '10.9.9.6' })).toMatchObject({ ok: false, reason: 'locked' }); // 2 reemplazos == umbral
    });

    it('el bloqueo no toca a otras cuentas ni al nivel 0', async () => {
        await fight('alice', 3);
        expect(await enter('carol', 'c1')).toEqual({ ok: true });
        expect(await isLocked(U.carol.id)).toBe(false);
        expect(await enter('bob', 'b1', { level: 0 })).toEqual({ ok: true });
    });

    it('solo un superadmin con step-up MFA desbloquea (perms unlock); un admin (3) o sin step-up no', async () => {
        await fight('alice', 3);
        const as = (n: string, level: PermissionLevel): ExecAuth => ({ actor: { kind: 'user', id: U[n].id, email: U[n].email, level, levelSource: level === 4 ? 'env' : 'console' }, session: { source: 'web', scopes: ['read', 'write', 'security'] }, ip: '127.0.0.6', userAgent: 'vitest' });
        const line = `perms unlock ${U.alice.email} --yes`;
        expect(await executeCommand({ line }, as('dave', 3))).toMatchObject({ ok: false, error: { code: 'insufficient_level' } });
        expect(await executeCommand({ line }, as('sa1', 4))).toMatchObject({ needs: 'stepup' });
        const pw = issueReauthToken(stepUpKey(U.sa1), 'password', null).token;
        expect(await executeCommand({ line, stepUp: pw }, as('sa1', 4))).toMatchObject({ needs: 'stepup', error: { code: 'mfa_stepup_required' } });
        expect(await isLocked(U.alice.id)).toBe(true);
        const mfa = issueReauthToken(stepUpKey(U.sa1), 'mfa', null).token;
        const ok = await executeCommand({ line, stepUp: mfa }, as('sa1', 4));
        expect(ok.ok, JSON.stringify(ok.error)).toBe(true);
        expect(await isLocked(U.alice.id)).toBe(false);
        expect(await enter('alice', 'back')).toEqual({ ok: true });
        expect(events.map((e) => e.event)).toContain('admin.session.unlocked');
    });

    it('rescate por entorno: ADMIN_LOCKOUT_RESET=<correo> levanta el bloqueo (unico superadmin bloqueado)', async () => {
        await fight('alice', 3);
        expect(await isLocked(U.alice.id, U.alice.email)).toBe(true);
        process.env.ADMIN_LOCKOUT_RESET = `otro@x.test, ${U.alice.email.toUpperCase()}`;
        try {
            expect(await isLocked(U.alice.id, U.alice.email)).toBe(false);
            expect(await enter('alice', 'rescued')).toEqual({ ok: true });
        } finally { delete process.env.ADMIN_LOCKOUT_RESET; }
    });
});

describe('nivel 0 y comandos de sesion', () => {
    it('bajar a nivel 0 revoca la sesion privilegiada (web o CLI) y libera el slot', async () => {
        await prisma.$executeRawUnsafe(`INSERT INTO "UserPermission" ("email","userId","permission_level","grantedBy") VALUES ($1,$2,2,'test')`, U.dave.email, U.dave.id);
        await refreshPermissions({ force: true });
        await enter('dave', 'jti-D', { level: 2 });
        const t = await mkToken('dave', { permissionLevel: 2, scopes: ['read'] });
        expect(await slot('dave')).toBeTruthy();
        const { changePermission } = await import('../permissions');
        await changePermission({ actor: { kind: 'user', id: U.sa1.id, email: U.sa1.email, level: 4 }, targetEmail: U.dave.email, newLevel: 0, ip: '127.0.0.5', source: 'cli' });
        expect(await slot('dave')).toBeNull();
        expect(await revoked('jti-D')).toBe(true);
        expect((await authenticateCli(req(t))).ok).toBe(false);
    });

    it('session show / session close por comandos', async () => {
        const auth: ExecAuth = { actor: { kind: 'user', id: U.alice.id, email: U.alice.email, level: 4, levelSource: 'env' }, session: { source: 'web', scopes: ['read', 'write', 'security'] }, ip: '127.0.0.5', userAgent: 'vitest' };
        await enter('alice', 'jti-cmd');
        const show = await executeCommand({ line: 'session show --json' }, auth);
        expect(show.ok, JSON.stringify(show.error)).toBe(true);
        expect(JSON.stringify(show.json)).toContain('web');
        const mfa = issueReauthToken(stepUpKey(U.alice), 'password', null).token;
        const close = await executeCommand({ line: 'session close --yes', stepUp: mfa }, auth);
        expect(close.ok, JSON.stringify(close.error)).toBe(true);
        expect(await slot('alice')).toBeNull();
        expect(await revoked('jti-cmd')).toBe(true);
    });

    it('la politica solo la cambia un superadmin con MFA y respeta los limites', async () => {
        const auth = (level: PermissionLevel): ExecAuth => ({ actor: { kind: 'user', id: U.alice.id, email: U.alice.email, level, levelSource: 'env' }, session: { source: 'web', scopes: ['read', 'write', 'security'] }, ip: '127.0.0.5', userAgent: 'vitest' });
        const mfa = issueReauthToken(stepUpKey(U.alice), 'mfa', null).token;
        expect(await executeCommand({ line: 'session policy set --idle-minutes 20 --yes', stepUp: mfa }, auth(3))).toMatchObject({ error: { code: 'insufficient_level' } });
        expect(await executeCommand({ line: 'session policy set --idle-minutes 3 --yes', stepUp: mfa }, auth(4))).toMatchObject({ ok: false, exitCode: 2 }); // fuera de 5..60
        expect(await executeCommand({ line: 'session policy set --idle-minutes 61 --yes', stepUp: mfa }, auth(4))).toMatchObject({ ok: false, exitCode: 2 });
        const ok = await executeCommand({ line: 'session policy set --idle-minutes 20 --lock-threshold 4 --lock-window 15 --yes --json', stepUp: mfa }, auth(4));
        expect(ok.ok, JSON.stringify(ok.error)).toBe(true);
        __resetPrivilegedPolicyCache();
        expect((await getPrivilegedStatus(U.alice.id)).policy).toMatchObject({ idleMinutes: 20, lockThreshold: 4, lockWindowMinutes: 15 });
    });
});

vi.setConfig({ testTimeout: 90_000 });
