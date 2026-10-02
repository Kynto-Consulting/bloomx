import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { matchesFilter, resolveUsers, searchUsers, validateUserRefs, USERS_PAGE_MAX, type Query } from '../extension-users';
import { __resetPermissionSnapshot } from '@/lib/permissions-core';
import { normalizeSettingsSchema } from '@/lib/expansions/settings-schema';

/** BD en memoria de UNA instancia: solo contiene los usuarios de su dominio (el aislamiento por dominio es estructural). */
const USERS = [
    { id: 'u1', email: 'ana@a.test', name: 'Ana', disabled: false },
    { id: 'u2', email: 'bob@a.test', name: 'Bob', disabled: true },
    { id: 'u3', email: 'root@a.test', name: null, disabled: false },
];

function fakeQuery(): { q: Query; calls: { sql: string; params: unknown[] }[] } {
    const calls: { sql: string; params: unknown[] }[] = [];
    const q = (async (sql: string, ...params: unknown[]) => {
        calls.push({ sql, params });
        if (/COUNT\(\*\)/.test(sql)) return [{ n: USERS.length }];
        const ids = params.find((p) => Array.isArray(p) && p.every((x) => typeof x === 'string' && /^[A-Za-z0-9_-]+$/.test(x as string) && !String(x).includes('@')));
        if (/u\."id" = ANY/.test(sql) && Array.isArray(ids)) return USERS.filter((u) => (ids as string[]).includes(u.id));
        const emails = params.find((p) => Array.isArray(p) && p.some((x) => String(x).includes('@')));
        let rows = USERS;
        if (/lower\(u\."email"\) = ANY/.test(sql) && Array.isArray(emails)) rows = rows.filter((u) => (emails as string[]).includes(u.email));
        return rows;
    }) as Query;
    return { q, calls };
}

beforeEach(() => {
    __resetPermissionSnapshot();
    process.env.ADMIN_EMAILS = 'root@a.test';
});
afterEach(() => { delete process.env.ADMIN_EMAILS; });

describe('directorio de usuarios para ajustes de extensiones', () => {
    it('busca con SQL parametrizado: el texto del usuario nunca se interpola y se escapan % _ \\', async () => {
        const { q, calls } = fakeQuery();
        await searchUsers({ q: "x'; DROP TABLE \"User\"; -- 100%_\\", limit: 5 }, { query: q });
        for (const c of calls) {
            expect(c.sql).not.toContain('DROP TABLE');
            expect(c.sql).not.toContain('100%');
        }
        const like = calls[0].params.find((p) => typeof p === 'string') as string;
        expect(like).toContain('\\%');
        expect(like).toContain('\\_');
        expect(like).toContain('\\\\');
    });

    it('solo consulta "User" (y su estado) de ESTA instancia: ninguna consulta recibe un dominio ni toca otra tabla', async () => {
        const { q, calls } = fakeQuery();
        await searchUsers({ q: 'a' }, { query: q });
        await resolveUsers(['u1'], { query: q });
        for (const c of calls) {
            expect(c.sql).toMatch(/FROM "User" u/);
            expect(c.sql).not.toMatch(/FROM "(?!User\b)/);
            expect(c.sql.toLowerCase()).not.toContain('domain');
        }
    });

    it('proyecta solo id, correo, nombre, estado y nivel; tope de pagina 50 y hasMore', async () => {
        const { q } = fakeQuery();
        const out = await searchUsers({ limit: 1000 }, { query: q });
        expect(out.limit).toBe(USERS_PAGE_MAX);
        expect(Object.keys(out.users[0]).sort()).toEqual(['disabled', 'email', 'id', 'level', 'levelName', 'name']);
        expect(out.users.find((u) => u.id === 'u3')).toMatchObject({ level: 4, levelName: 'superadmin' });
        const paged = await searchUsers({ limit: 2 }, { query: (async (sql: string, ...p: unknown[]) => (/COUNT/.test(sql) ? [{ n: 3 }] : USERS)) as Query });
        expect(paged.users).toHaveLength(2);
        expect(paged.hasMore).toBe(true);
    });

    it('filtro minLevel/role: usa el nivel efectivo (ADMIN_EMAILS) y un rol desconocido no coincide con nadie', async () => {
        const { q, calls } = fakeQuery();
        const admins = await searchUsers({ filter: { minLevel: 3 } }, { query: q });
        expect(admins.users.map((u) => u.id)).toEqual(['u3']);
        const none = await searchUsers({ filter: { role: 'inventado' } }, { query: q });
        expect(calls.at(-1)!.sql).toContain('FALSE');
        void none;
        expect(matchesFilter({ level: 2 }, { minLevel: 3 })).toBe(false);
        expect(matchesFilter({ level: 3 }, { role: 'admin' })).toBe(true);
        expect(matchesFilter({ level: 4 }, { role: 'admin' })).toBe(false);
        expect(matchesFilter({ level: 0 }, undefined)).toBe(true);
    });

    it('resolveUsers descarta ids con formato invalido y los inexistentes no aparecen (= usuario eliminado)', async () => {
        const { q, calls } = fakeQuery();
        const found = await resolveUsers(['u1', 'zz', "bad id'--", 'u1'], { query: q });
        expect([...found.keys()]).toEqual(['u1']);
        expect((calls[0].params[0] as string[]).sort()).toEqual(['u1', 'zz']);
    });

    describe('validateUserRefs (servidor)', () => {
        const fields = normalizeSettingsSchema({
            fields: [
                { key: 'owner', type: 'user', label: 'o', filter: { minLevel: 3 } },
                { key: 'team', type: 'users', label: 't' },
                { key: 'digest', type: 'userMap', valueType: 'boolean', label: 'd' },
            ],
        }).fields;

        it('acepta ids existentes y activos', async () => {
            const { q } = fakeQuery();
            expect(await validateUserRefs(fields, { team: ['u1'], digest: { u3: true } }, {}, { query: q })).toEqual([]);
        });

        it('rechaza inexistente, desactivado y fuera de filtro con code estable y ruta values.<clave>', async () => {
            const { q } = fakeQuery();
            const issues = await validateUserRefs(fields, { owner: 'u1', team: ['u2'], digest: { nope: true } }, {}, { query: q });
            const by = Object.fromEntries(issues.map((i) => [i.path, i.code]));
            expect(by).toEqual({ 'values.owner': 'userFilter', 'values.team': 'userDisabled', 'values.digest': 'userMissing' });
            expect(JSON.stringify(issues)).not.toContain('@a.test');
        });

        it('solo valida ids NUEVOS: uno ya guardado que luego se desactivo no bloquea otros cambios', async () => {
            const { q } = fakeQuery();
            expect(await validateUserRefs(fields, { team: ['u2', 'u1'] }, { team: ['u2'] }, { query: q })).toEqual([]);
            expect(await validateUserRefs(fields, { digest: { nope: true, u1: false } }, { digest: { nope: true } }, { query: q })).toEqual([]);
        });

        it('sin campos de usuario no consulta la BD', async () => {
            const { q, calls } = fakeQuery();
            expect(await validateUserRefs(normalizeSettingsSchema({ fields: [{ key: 'a', type: 'string', label: 'a' }] }).fields, { a: 'x' }, {}, { query: q })).toEqual([]);
            expect(calls).toHaveLength(0);
        });
    });
});
