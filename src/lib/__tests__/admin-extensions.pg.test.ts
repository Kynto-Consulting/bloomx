import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLocalPg, uid } from './helpers/pg';
import { prisma } from '../prisma';
import { execute } from '../admin/sql';
import { countExtensionsWithErrors, extensionIdsWithErrors, getExtensionStatus } from '../admin/extensions-status';

beforeAll(() => assertLocalPg());
afterAll(async () => { await prisma.$disconnect(); });

const ins = (event: string, data: object, ago = '0 seconds') =>
    execute(`INSERT INTO "AuditEvent" ("id","ts","event","data") VALUES ($1, NOW() - $2::interval, $3, $4::jsonb)`, uid('ae'), ago, event, JSON.stringify(data));

describe('estado de extension sobre AuditEvent (Postgres real)', () => {
    it('ultimo evento, ultimo error, errores en 24 h y entradas resumidas (max. 20)', async () => {
        const ext = uid('ext');
        await ins('admin.extension.install', { extensionId: ext, outcome: 'ok', status: 200 }, '5 hours');
        await ins('admin.extension.credentials', { extensionId: ext, outcome: 'failed', status: 503, set: ['NOTION_API_KEY'], password: 'SECRETO' }, '3 hours');
        await ins('admin.extension.test', { extensionId: ext, outcome: 'failed', status: 401 }, '1 hours');
        await ins('admin.extension.test', { extensionId: ext, outcome: 'ok', status: 200 }, '10 minutes');
        await ins('admin.extension.test', { extensionId: ext, outcome: 'failed' }, '3 days'); // fuera de 24 h
        await ins('extension.uninstall_error', { extensionId: ext }, '2 days'); // nombre con "error", fuera de 24 h

        const s = await getExtensionStatus(ext);
        expect(s.entries).toHaveLength(6);
        expect(s.lastEvent).toMatchObject({ event: 'admin.extension.test', outcome: 'ok', status: 200 });
        expect(s.lastError).toMatchObject({ event: 'admin.extension.test', outcome: 'failed', status: 401 });
        expect(s.errors24h).toBe(2);
        // Solo escalares resumidos: nada de data completa (ni nombres de credenciales ni valores).
        expect(Object.keys(s.entries[0]).sort()).toEqual(['event', 'id', 'outcome', 'status', 'ts']);
        expect(JSON.stringify(s)).not.toContain('SECRETO');
        expect(JSON.stringify(s)).not.toContain('NOTION_API_KEY');
    });

    it('un evento cuyo NOMBRE indica fallo cuenta aunque no lleve outcome', async () => {
        const ext = uid('ext');
        await ins('extension.execute_failed', { extensionId: ext }, '1 hours');
        const s = await getExtensionStatus(ext);
        expect(s.errors24h).toBe(1);
        expect(s.lastError?.event).toBe('extension.execute_failed');
        expect(s.lastError?.outcome).toBeNull();
    });

    it('solo eventos de extensiones y solo de ESA extension', async () => {
        const ext = uid('ext');
        const other = uid('ext');
        await ins('auth.login', { extensionId: ext, outcome: 'failed' }); // no es un evento de extension
        await ins('admin.extension.test', { extensionId: other, outcome: 'failed' });
        const s = await getExtensionStatus(ext);
        expect(s).toEqual({ lastEvent: null, lastError: null, errors24h: 0, entries: [] });
    });

    it('limita a 20 entradas, las mas recientes primero', async () => {
        const ext = uid('ext');
        for (let i = 0; i < 25; i++) await ins('admin.extension.test', { extensionId: ext, outcome: 'ok', status: 200 }, `${i + 1} minutes`);
        const s = await getExtensionStatus(ext);
        expect(s.entries).toHaveLength(20);
        const times = s.entries.map((e) => new Date(e.ts!).getTime());
        expect([...times].sort((a, b) => b - a)).toEqual(times);
    });

    it('la consulta es parametrizada: un id con SQL no inyecta nada y no encuentra nada', async () => {
        const evil = `x' OR '1'='1`;
        const s = await getExtensionStatus(evil);
        expect(s.entries).toEqual([]);
    });

    it('extensionIdsWithErrors / countExtensionsWithErrors: extensiones distintas con errores en la ventana', async () => {
        const a = uid('ext');
        const b = uid('ext');
        const before = await countExtensionsWithErrors(24);
        await ins('admin.extension.test', { extensionId: a, outcome: 'failed' });
        await ins('admin.extension.test', { extensionId: a, outcome: 'failed' });
        await ins('admin.extension.credentials', { extensionId: b, outcome: 'ok' });
        await ins('admin.extension.test', { extensionId: uid('ext'), outcome: 'failed' }, '3 days');
        expect(await countExtensionsWithErrors(24)).toBe(before + 1);
        const ids = await extensionIdsWithErrors(24);
        expect(ids).toContain(a);
        expect(ids).not.toContain(b);
        // ventana de 7 dias incluye el antiguo
        expect(await countExtensionsWithErrors(24 * 7)).toBeGreaterThanOrEqual(before + 2);
    });
});
