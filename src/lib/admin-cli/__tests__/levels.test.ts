import { describe, expect, it } from 'vitest';
import { COMMAND_LEVELS, DIRECT_ROUTES, SCOPE_LEVELS, SCOPE_MIN_LEVEL, commandLevel, levelForScope } from '@/lib/admin-levels';
import { ROUTE_TABLE } from '../bridge';
import { COMMANDS } from '../catalog';
import { EXIT, authorizeCommand, executeCommand, type ExecAuth } from '../exec';
import { SCOPES, type Scope } from '../types';
import { scopesAllowedForLevel } from '../tokens';
import type { PermissionLevel } from '@/lib/permissions-core';

/**
 * Matriz permission_level x comando x ruta: cada nivel accede SOLO a lo suyo. Una unica fuente de verdad (lib/admin-levels.ts) que el
 * motor de comandos (exec.ts) y las rutas (adminRoute -> requireLevel) aplican; aqui se comprueba que no hay huecos ni incoherencias.
 */

const LEVELS_0_4: PermissionLevel[] = [0, 1, 2, 3, 4];
const auth = (level: PermissionLevel, scopes: Scope[] = [...SCOPES]): Pick<ExecAuth, 'actor' | 'session'> => ({
    actor: { kind: 'user', id: 'u', email: 'u@x.test', level, levelSource: level === 4 ? 'env' : 'console' },
    session: { source: 'web', scopes },
});

describe('cada comando declara su nivel (sin valores por defecto silenciosos)', () => {
    it('todo comando del catalogo tiene una entrada explicita en COMMAND_LEVELS y no sobran entradas', () => {
        const names = new Set(COMMANDS.map((c) => c.name));
        const missing = [...names].filter((n) => COMMAND_LEVELS[n] === undefined);
        expect(missing, `comandos sin nivel: ${missing.join(', ')}`).toEqual([]);
        const stale = Object.keys(COMMAND_LEVELS).filter((n) => !names.has(n));
        expect(stale, `niveles de comandos que ya no existen: ${stale.join(', ')}`).toEqual([]);
        for (const [n, l] of Object.entries(COMMAND_LEVELS)) expect([1, 2, 3, 4], n).toContain(l);
    });
    it('un comando desconocido exige el nivel mas alto (falla cerrado) y un scope desconocido el 3 (== requireAdmin)', () => {
        expect(commandLevel('no existe')).toBe(4);
        expect(levelForScope('scope.inventado')).toBe(3);
    });
});

describe('matriz comando x nivel (ambito completo)', () => {
    it.each(COMMANDS.map((c) => [c.name, c] as const))('%s: accesible solo desde su nivel', (_n, c) => {
        const need = commandLevel(c.name);
        for (const l of LEVELS_0_4) {
            const r = authorizeCommand(c, auth(l));
            if (l < need) expect(r?.code, `${c.name} con nivel ${l}`).toBe('insufficient_level');
            else expect(r, `${c.name} con nivel ${l}`).toBeNull();
        }
    });

    it('nivel 0 (usuario normal) no puede ejecutar NINGUN comando', () => {
        for (const c of COMMANDS) expect(authorizeCommand(c, auth(0))?.code, c.name).toBe('insufficient_level');
    });

    it('support (1): solo lectura; operator (2) gestiona cuentas; admin (3) configura; superadmin (4) todo', () => {
        const can = (l: PermissionLevel) => COMMANDS.filter((c) => authorizeCommand(c, auth(l)) === null).map((c) => c.name);
        const L1 = can(1); const L2 = can(2); const L3 = can(3); const L4 = can(4);
        expect(L1.length).toBeLessThan(L2.length);
        expect(L2.length).toBeLessThan(L3.length);
        expect(L3.length).toBeLessThan(L4.length);
        expect(L4.length).toBe(COMMANDS.length);
        // support (1): ver, nunca escribir
        for (const n of ['users list', 'users show', 'audit', 'overview', 'system status', 'spam stats', 'spam list', 'theme show', 'perms levels', 'whoami']) expect(L1, n).toContain(n);
        for (const n of ['users create', 'users disable', 'users bulk', 'spam list add', 'theme import', 'retention set', 'extensions install', 'perms set', 'users mfa-reset', 'security keys']) expect(L1, n).not.toContain(n);
        // operator (2): cuentas y listas de spam; nunca configuracion ni seguridad
        for (const n of ['users create', 'users disable', 'users enable', 'users bulk', 'users quota set', 'users sessions revoke', 'spam list add', 'spam list remove', 'mail suppressions remove']) expect(L2, n).toContain(n);
        for (const n of ['theme import', 'domain set', 'retention set', 'quota set', 'extensions install', 'spam config set', 'transfer export', 'users password-reset', 'perms set', 'perms list', 'security status']) expect(L2, n).not.toContain(n);
        // admin (3): configuracion y gestion de niveles 0-2; no seguridad critica
        for (const n of ['theme import', 'domain set', 'retention set', 'quota set', 'extensions install', 'spam config set', 'transfer export', 'users password-reset', 'perms set', 'perms list', 'perms history', 'security status']) expect(L3, n).toContain(n);
        for (const n of ['users mfa-reset', 'security keys', 'security keys register', 'retention run', 'extensions mandatory', 'extensions credentials set', 'perms unlock', 'session policy set']) expect(L3, n).not.toContain(n);
        // superadmin (4): todo
        for (const n of ['users mfa-reset', 'security keys register', 'retention run', 'extensions mandatory', 'perms unlock', 'session policy set']) expect(L4, n).toContain(n);
    });

    it('un nivel suficiente pero un ambito insuficiente tambien se rechaza (el token no supera su ambito)', () => {
        const create = COMMANDS.find((c) => c.name === 'users create')!;
        expect(authorizeCommand(create, auth(4, ['read']))?.code).toBe('insufficient_scope');
        expect(authorizeCommand(create, auth(4, ['read', 'write']))?.code).toBe('insufficient_scope'); // users create es "security"
        expect(authorizeCommand(create, auth(4, ['read', 'write', 'security']))).toBeNull();
        // y al reves: ambito completo con nivel insuficiente
        expect(authorizeCommand(create, auth(1))?.code).toBe('insufficient_level');
    });

    it('executeCommand corta por nivel ANTES de analizar argumentos o pedir confirmacion', async () => {
        for (const line of ['users create', 'perms set', 'retention run --apply --yes', 'users mfa-reset x -y']) {
            const res = await executeCommand({ line }, { ...auth(1), ip: '203.0.113.1' });
            expect(res, line).toMatchObject({ ok: false, exitCode: EXIT.denied, error: { code: 'insufficient_level' } });
            expect(res.needs).toBeUndefined();
        }
        const lvl0 = await executeCommand({ line: 'users list' }, { ...auth(0), ip: '203.0.113.2' });
        expect(lvl0.error?.code).toBe('insufficient_level');
    });
});

describe('tokens: el ambito maximo depende del nivel', () => {
    it('read desde 1, write y security desde 2', () => {
        expect(SCOPE_MIN_LEVEL).toEqual({ read: 1, write: 2, security: 2 });
        expect(scopesAllowedForLevel(0)).toEqual([]);
        expect(scopesAllowedForLevel(1)).toEqual(['read']);
        expect(scopesAllowedForLevel(2)).toEqual(['read', 'write', 'security']);
        expect(scopesAllowedForLevel(4)).toEqual(['read', 'write', 'security']);
    });
});

describe('rutas /api/admin/**: todas declaran su nivel y es coherente con los comandos', () => {
    const levelOfRoute = async (key: string): Promise<number | null> => {
        const [method, path] = key.split(' ');
        const pattern = path.replace('/api/admin', '');
        const entry = ROUTE_TABLE.find((e) => e.pattern === pattern);
        if (!entry) return null;
        const mod = await entry.load();
        const handler = mod[method];
        if (handler?.meta) return handler.meta.minLevel;
        return DIRECT_ROUTES[key] ?? null;
    };

    it('toda ruta hecha con adminRoute usa un scope con nivel EXPLICITO (nada cae en el 3 por defecto sin querer)', async () => {
        const bad: string[] = [];
        for (const e of ROUTE_TABLE) {
            const mod = await e.load();
            for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
                const h = mod[m];
                if (typeof h !== 'function') continue;
                if (h.meta) { if (SCOPE_LEVELS[h.meta.scope] === undefined) bad.push(`${m} ${e.pattern} (${h.meta.scope})`); }
                else if (DIRECT_ROUTES[`${m} /api/admin${e.pattern}`] === undefined) bad.push(`${m} ${e.pattern} (guardia directo sin nivel en DIRECT_ROUTES)`);
            }
        }
        expect(bad, bad.join('\n')).toEqual([]);
    }, 60_000);

    it('el nivel de un comando nunca es MENOR que el de las rutas que cubre', async () => {
        const wrong: string[] = [];
        for (const c of COMMANDS) {
            for (const key of c.covers ?? []) {
                if (key.startsWith('ALL ')) { if (commandLevel(c.name) < 3) wrong.push(`${c.name} cubre ${key}`); continue; }
                const lvl = await levelOfRoute(key);
                if (lvl === null) { wrong.push(`${c.name}: ruta sin nivel ${key}`); continue; }
                if (commandLevel(c.name) < lvl) wrong.push(`${c.name} (${commandLevel(c.name)}) < ${key} (${lvl})`);
            }
        }
        expect(wrong, wrong.join('\n')).toEqual([]);
    }, 60_000);

    it('las rutas de gestion de niveles y de la sesion privilegiada tienen el nivel documentado', async () => {
        expect(await levelOfRoute('GET /api/admin/permissions')).toBe(3);
        expect(await levelOfRoute('POST /api/admin/permissions')).toBe(3);
        expect(await levelOfRoute('POST /api/admin/permissions/unlock')).toBe(4);
        expect(await levelOfRoute('GET /api/admin/privileged-session')).toBe(1);
        expect(await levelOfRoute('PUT /api/admin/privileged-session')).toBe(4);
        expect(await levelOfRoute('GET /api/admin/users')).toBe(1);
        expect(await levelOfRoute('POST /api/admin/users')).toBe(2);
        expect(await levelOfRoute('PUT /api/admin/retention/settings')).toBe(3);
        expect(await levelOfRoute('POST /api/admin/retention/run')).toBe(4);
        expect(await levelOfRoute('POST /api/admin/users/[id]/mfa-reset')).toBe(4);
        expect(await levelOfRoute('GET /api/admin/domain')).toBe(1);
        expect(await levelOfRoute('PUT /api/admin/domain')).toBe(3);
        expect(await levelOfRoute('PUT /api/admin/extensions/settings')).toBe(4);
    }, 60_000);
});
