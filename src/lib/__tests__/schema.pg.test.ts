import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import { execSync } from 'node:child_process';
import { assertLocalPg, createFreshDatabase } from './helpers/pg';

// DDL real (src/lib/db/schema.ts) aplicado sobre Postgres embebido.

async function loadSchemaFor(url: string) {
    vi.resetModules();
    const g = globalThis as any;
    await g.__bloomxCustomPool?.end?.();
    g.__bloomxCustomPool = undefined;
    process.env.DATABASE_URL = url;
    return import('../db/schema');
}

describe('ensureDatabaseSchema sobre Postgres real', () => {
    const saved = process.env.DATABASE_URL;
    let freshUrl: string;
    let pool: Pool;

    beforeAll(async () => {
        assertLocalPg();
        freshUrl = await createFreshDatabase();
        const { ensureDatabaseSchema } = await loadSchemaFor(freshUrl);
        await ensureDatabaseSchema();
        pool = new Pool({ connectionString: freshUrl, max: 2 });
    });
    afterAll(async () => {
        await pool?.end();
        const g = globalThis as any;
        await g.__bloomxCustomPool?.end?.();
        g.__bloomxCustomPool = undefined;
        process.env.DATABASE_URL = saved;
    });

    const cols = async (table: string) =>
        (await pool.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table])).rows;
    const indexes = async () =>
        new Map<string, string>((await pool.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public'`)).rows.map((r: any) => [r.indexname, r.indexdef]));

    it('crea todas las tablas de Prisma y las aditivas', async () => {
        const t = (await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)).rows.map((r: any) => r.table_name);
        for (const name of ['User', 'Account', 'Email', 'Attachment', 'EmailEvent', 'Draft', 'Label', 'Rule', 'RuleRun', 'MoltSession',
            'Calendar', 'CalendarEvent', 'CalendarAttendee', 'Contact', 'AppointmentSchedule', 'AppointmentAvailability',
            'AppointmentBooking', 'AuditEvent', 'UserMfa', 'RevokedSession', 'push_subscriptions', 'push_vapid_config', '_EmailToLabel', 'SecureMessageMeta', 'ExtensionStorage', 'ExtensionNotification', 'AiSettings', 'AiUsage', 'AiAudit']) {
            expect(t, name).toContain(name);
        }
    });

    it('columnas y tipos criticos', async () => {
        const user = await cols('User');
        expect(user.find((c: any) => c.column_name === 'tokenVersion')).toMatchObject({ data_type: 'integer', is_nullable: 'NO' });
        const mfa = Object.fromEntries((await cols('UserMfa')).map((c: any) => [c.column_name, c.data_type]));
        expect(mfa).toMatchObject({ userId: 'text', secretEnc: 'text', enabled: 'boolean', lastStep: 'bigint', recoveryHashes: 'jsonb' });
        const audit = Object.fromEntries((await cols('AuditEvent')).map((c: any) => [c.column_name, c.data_type]));
        expect(audit).toMatchObject({ id: 'text', ts: 'timestamp with time zone', event: 'text', data: 'jsonb' });
        const rule = Object.fromEntries((await cols('Rule')).map((c: any) => [c.column_name, c.data_type]));
        expect(rule).toMatchObject({ conditions: 'jsonb', actions: 'jsonb', priority: 'integer', stopProcessing: 'boolean' });
        const rs = Object.fromEntries((await cols('RevokedSession')).map((c: any) => [c.column_name, c.data_type]));
        expect(rs).toMatchObject({ jti: 'text', expiresAt: 'timestamp with time zone' });
        expect((await cols('RuleRun')).map((c: any) => c.column_name).sort()).toEqual(['appliedAt', 'emailId', 'userId']);
        // Columna heredada eliminada
        expect((await cols('Email')).map((c: any) => c.column_name)).not.toContain('accountEmail');
    });

    it('indices declarados (incluye FTS GIN y unico parcial anti doble reserva)', async () => {
        const idx = await indexes();
        for (const name of ['Email_userId_folder_createdAt_idx', 'Email_userId_folder_read_idx', 'Email_userId_scheduledAt_idx',
            'AuditEvent_ts_idx', 'AuditEvent_userId_ts_idx', 'AuditEvent_event_ts_idx', 'RevokedSession_expiresAt_idx', 'RevokedSession_userId_idx',
            'Rule_userId_priority_idx', 'RuleRun_userId_idx', 'CalendarEvent_userId_startsAt_idx', 'AppointmentBooking_startsAt_idx',
            'AppointmentBooking_guestEmail_idx', 'EmailEvent_resendEmailId_idx', 'UserMfa_pkey', 'RevokedSession_pkey', 'AuditEvent_pkey', 'Rule_pkey', 'RuleRun_pkey', 'ExtensionStorage_pkey', 'ExtensionNotification_pkey', 'ExtensionNotification_pending_idx', 'AiSettings_pkey', 'AiUsage_pkey', 'AiUsage_ts_idx', 'AiUsage_userId_ts_idx', 'AiAudit_pkey', 'AiAudit_ts_idx']) {
            expect(idx.has(name), `falta indice ${name}`).toBe(true);
        }
        expect(idx.get('Email_fts_idx')).toMatch(/USING gin/i);
        const uniq = idx.get('AppointmentBooking_scheduleId_startsAt_confirmed_key')!;
        expect(uniq).toMatch(/CREATE UNIQUE INDEX/);
        expect(uniq).toMatch(/WHERE .*status.*confirmed/i);
        const idem = idx.get('EmailEvent_send_idem_key')!;
        expect(idem).toMatch(/CREATE UNIQUE INDEX/);
        expect(idem).toMatch(/send_idem/);
        expect(idx.has('Email_accountEmail_idx')).toBe(false);
    });

    it('el indice FTS es el que usa el planner para la expresion de search.ts', async () => {
        const { FTS_EXPRESSION_SQL } = await import('../rules/search');
        const c = await pool.connect();
        try {
            await c.query('SET enable_seqscan = off');
            const r = await c.query(`EXPLAIN SELECT "id" FROM "Email" WHERE ${FTS_EXPRESSION_SQL} @@ websearch_to_tsquery('simple', 'hola')`);
            expect(r.rows.map((x: any) => x['QUERY PLAN']).join('\n')).toMatch(/Email_fts_idx/);
        } finally {
            c.release();
        }
    });

    it('idempotente: segunda ejecucion en una instancia nueva no falla ni duplica', async () => {
        const before = await indexes();
        const count = async () => (await pool.query(`SELECT count(*)::int n FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'`)).rows[0].n;
        const beforeCons = await count();
        const { ensureDatabaseSchema } = await loadSchemaFor(freshUrl); // modulo nuevo => promesa cacheada nueva
        await ensureDatabaseSchema();
        await ensureDatabaseSchema();
        const after = await indexes();
        expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
        expect(await count()).toBe(beforeCons);
    });

    it('ejecuciones concurrentes del DDL (arranque de varias instancias) no fallan', async () => {
        const url = await createFreshDatabase();
        // 3 "instancias" (modulos con su propia promesa cacheada) que comparten el pool: conexiones distintas, DDL simultaneo
        const mods = [];
        for (let i = 0; i < 3; i++) mods.push(await loadSchemaFor(url));
        const runs = mods.map((m) => () => m.ensureDatabaseSchema());
        await Promise.all(runs.map((f) => f()));
        const g = globalThis as any;
        await g.__bloomxCustomPool?.end?.();
        g.__bloomxCustomPool = undefined;
    });

    it('indice unico parcial: bloquea doble confirmada, permite cancelada y otro horario', async () => {
        await pool.query(`INSERT INTO "User"("id","email","password") VALUES ('u1','u1@pg.test','x')`);
        await pool.query(`INSERT INTO "AppointmentSchedule"("id","userId","name") VALUES ('s1','u1','n')`);
        const ins = (id: string, status: string, at: string) =>
            pool.query(`INSERT INTO "AppointmentBooking"("id","scheduleId","guestName","guestEmail","startsAt","endsAt","status") VALUES ($1,'s1','g','g@x.test',$2,$2::timestamptz + interval '30 minutes',$3)`, [id, at, status]);
        await ins('b1', 'confirmed', '2030-01-01T10:00:00Z');
        await expect(ins('b2', 'confirmed', '2030-01-01T10:00:00Z')).rejects.toMatchObject({ code: '23505' });
        await ins('b3', 'cancelled', '2030-01-01T10:00:00Z');
        await ins('b4', 'cancelled', '2030-01-01T10:00:00Z');
        await ins('b5', 'confirmed', '2030-01-01T10:30:00Z');
    });

    it('DDL viejo: agrega columnas faltantes a tablas preexistentes (migracion aditiva)', async () => {
        const url = await createFreshDatabase();
        const p = new Pool({ connectionString: url, max: 1 });
        await p.query(`CREATE TABLE "User" ("id" TEXT NOT NULL, "email" TEXT NOT NULL, "password" TEXT NOT NULL, PRIMARY KEY("id"))`);
        await p.query(`INSERT INTO "User" VALUES ('old','old@x.test','x')`);
        const { ensureDatabaseSchema } = await loadSchemaFor(url);
        await ensureDatabaseSchema();
        const r = await p.query(`SELECT "tokenVersion" FROM "User" WHERE "id"='old'`);
        expect(r.rows[0].tokenVersion).toBe(0);
        await p.end();
    });

    it('BD creada por `prisma db push` (produccion historica) + ensureDatabaseSchema: se adapta y es idempotente', () => {
        // Solo contra el Postgres embebido: la URL se pasa explicitamente y se anula cualquier DIRECT_URL/.env
        return (async () => {
            const url = await createFreshDatabase();
            expect(url).toMatch(/127\.0\.0\.1/);
            const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };
            execSync('npx prisma db push --skip-generate --accept-data-loss --schema prisma/schema.prisma', { env, stdio: 'pipe', cwd: process.cwd() });
            const p = new Pool({ connectionString: url, max: 2 });
            try {
                const before = (await p.query(`SELECT count(*)::int n FROM pg_indexes WHERE schemaname='public' AND tablename='Email'`)).rows[0].n;
                const { ensureDatabaseSchema } = await loadSchemaFor(url);
                await ensureDatabaseSchema();
                const mid = (await p.query(`SELECT count(*)::int n FROM pg_indexes WHERE schemaname='public' AND tablename='Email'`)).rows[0].n;
                expect(mid).toBeGreaterThanOrEqual(before);
                const { ensureDatabaseSchema: again } = await loadSchemaFor(url);
                await again();
                const after = (await p.query(`SELECT count(*)::int n FROM pg_indexes WHERE schemaname='public' AND tablename='Email'`)).rows[0].n;
                expect(after).toBe(mid);
                // Sin duplicar la unicidad de Email.messageId (indice de Prisma + posible constraint de ensure)
                const uniq = (await p.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='Email' AND indexdef ILIKE 'CREATE UNIQUE%' AND indexdef LIKE '%(""messageId"")%'`.replace(/""/g, '"'))).rows;
                expect(uniq).toHaveLength(1);
                for (const [table, col] of [['User', 'tokenVersion'], ['UserMfa', 'lastStep'], ['AuditEvent', 'data'], ['Rule', 'conditions']]) {
                    const r = await p.query(`SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [table, col]);
                    expect(r.rowCount, `${table}.${col}`).toBe(1);
                }
                const idx = new Set((await p.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public'`)).rows.map((r: any) => r.indexname));
                for (const n of ['Email_fts_idx', 'EmailEvent_send_idem_key', 'AppointmentBooking_scheduleId_startsAt_confirmed_key']) expect(idx.has(n), n).toBe(true);
                // El DDL de ensure funciona sobre TIMESTAMP(3) (sin zona) creado por Prisma: insertar y leer sigue funcionando
                await p.query(`INSERT INTO "User"("id","email","password","updatedAt") VALUES ('pu','pu@x.test','x', NOW())`);
                await p.query(`INSERT INTO "UserMfa"("userId","secretEnc") VALUES ('pu','s')`);
                await p.query(`INSERT INTO "AuditEvent"("id","event") VALUES ('a1','e')`);
            } finally {
                await p.end();
            }
        })();
    }, 120_000);
});
