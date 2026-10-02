import { describe, expect, it, vi } from 'vitest';
import { BridgeError } from '../host-services/bridge-route';
import { decodeCursor, encodeCursor, handleUsers, toUser, usersRequest, type UsersDeps } from '../host-services/users';
import { grantAllowsService } from '@/lib/exec-grant';

type Row = { id: string; email: string; name: string | null; createdAt: Date; password?: string };
const seed = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `u${String(i).padStart(3, '0')}`, email: `user${i}@acme.com`, name: `Name ${i}`, createdAt: new Date(2026, 0, 1 + Math.floor(i / 2)), password: 'HASH' }));

function deps(rows: Row[], over: Partial<UsersDeps> = {}): UsersDeps & { audit: ReturnType<typeof vi.fn> } {
    const audit = vi.fn();
    const matchOne = (r: Row, c: any): boolean => {
        if ('OR' in c) return c.OR.some((x: any) => matchOne(r, x));
        if ('createdAt' in c && c.createdAt?.gt) return r.createdAt > c.createdAt.gt;
        if ('createdAt' in c && c.createdAt instanceof Date) return r.createdAt.getTime() === c.createdAt.getTime() && r.id > c.id.gt;
        if ('email' in c && c.email?.contains) return r.email.toLowerCase().includes(c.email.contains.toLowerCase());
        if ('email' in c && c.email?.equals) return r.email.toLowerCase() === c.email.equals.toLowerCase();
        if ('name' in c && c.name?.contains) return (r.name || '').toLowerCase().includes(c.name.contains.toLowerCase());
        if ('id' in c && typeof c.id === 'string') return r.id === c.id;
        return true;
    };
    const match = (r: Row, where: any) => (where.AND ? where.AND.every((c: any) => matchOne(r, c)) : Object.keys(where).length ? matchOne(r, where) : true);
    const strip = (r: Row, select: any) => Object.fromEntries(Object.keys(select).map((k) => [k, (r as any)[k]]));
    return {
        db: {
            user: {
                findMany: async ({ where, take, select }: any) => rows.filter((r) => match(r, where)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)).slice(0, take).map((r) => strip(r, select)),
                findFirst: async ({ where, select }: any) => { const r = rows.find((x) => match(x, where)); return r ? strip(r, select) : null; },
            },
        },
        rateLimit: async () => ({ ok: true, retryAfter: 0 }),
        audit,
        ...over,
    } as any;
}
const parse = (op: string, args: any) => usersRequest.parse({ op, userId: 'actor', extensionId: 'ext1', args });
const grant = { perms: ['READ_USERS'] };

describe('services.users (puente de instancia)', () => {
    it('sin READ_USERS en la executionGrant (o sin grant): forbidden', async () => {
        const d = deps(seed(3));
        await expect(handleUsers(d, parse('list', {}), {})).rejects.toMatchObject({ code: 'forbidden' });
        await expect(handleUsers(d, parse('list', {}), { grant: { perms: ['CONTACTS_READ'] } })).rejects.toBeInstanceOf(BridgeError);
        expect(d.audit).not.toHaveBeenCalled();
    });

    it('grantAllowsService: users solo con READ_USERS', () => {
        expect(grantAllowsService({ perms: ['READ_USERS'] }, 'users')).toBe(true);
        expect(grantAllowsService({ perms: ['READ_EMAIL', 'CONTACTS_READ'] }, 'users')).toBe(false);
    });

    it('campos minimos: nunca hash ni extras', async () => {
        const out: any = await handleUsers(deps(seed(2)), parse('list', {}), { grant });
        expect(Object.keys(out.users[0]).sort()).toEqual(['createdAt', 'email', 'id', 'name']);
        expect(JSON.stringify(out)).not.toContain('HASH');
        expect(Object.keys(toUser({ id: 'x', email: 'a@b.c', name: null, createdAt: new Date(), password: 'p', expansionSettings: {} })).sort()).toEqual(['createdAt', 'email', 'id', 'name']);
    });

    it('paginacion por cursor: recorre todo sin duplicados ni saltos', async () => {
        const d = deps(seed(7));
        const seen: string[] = [];
        let cursor: string | undefined;
        for (let i = 0; i < 10; i++) {
            const out: any = await handleUsers(d, parse('list', { limit: 3, ...(cursor ? { cursor } : {}) }), { grant });
            seen.push(...out.users.map((u: any) => u.id));
            if (!out.nextCursor) break;
            cursor = out.nextCursor;
        }
        expect(seen).toEqual(seed(7).map((r) => r.id));
    });

    it('limites: limit 1..100, cursor invalido, args desconocidos, search acotado', async () => {
        for (const bad of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { cursor: '!!' }, { search: '' }, { search: 'x'.repeat(101) }, { extra: 1 }]) {
            expect(usersRequest.safeParse({ op: 'list', userId: 'a', extensionId: 'e', args: bad }).success).toBe(false);
        }
        await expect(handleUsers(deps(seed(1)), parse('list', { cursor: 'AAAA' }), { grant })).rejects.toMatchObject({ code: 'invalid_args' });
        expect(decodeCursor(encodeCursor(new Date(5000), 'abc'))).toEqual({ createdAt: new Date(5000), id: 'abc' });
        expect(decodeCursor('!!')).toBeNull();
    });

    it('busqueda por correo o nombre', async () => {
        const out: any = await handleUsers(deps(seed(12)), parse('list', { search: 'USER1' }), { grant });
        expect(out.users.map((u: any) => u.email)).toEqual(expect.arrayContaining(['user1@acme.com', 'user10@acme.com', 'user11@acme.com']));
        expect(out.users.every((u: any) => /user1/.test(u.email))).toBe(true);
    });

    it('get por id o correo; inexistente => null; correo invalido => invalid_args', async () => {
        const d = deps(seed(3));
        expect(((await handleUsers(d, parse('get', { id: 'u001' }), { grant })) as any).user.email).toBe('user1@acme.com');
        expect(((await handleUsers(d, parse('get', { email: 'USER2@acme.com' }), { grant })) as any).user.id).toBe('u002');
        expect(((await handleUsers(d, parse('get', { id: 'nope' }), { grant })) as any).user).toBeNull();
        await expect(handleUsers(d, parse('get', { email: 'not-an-email' }), { grant })).rejects.toMatchObject({ code: 'invalid_args' });
        expect(usersRequest.safeParse({ op: 'get', userId: 'a', extensionId: 'e', args: { id: 'a', email: 'b@c.de' } }).success).toBe(false);
    });

    it('cuota por extension: rate_limited; auditoria sin PII', async () => {
        const limited = deps(seed(1), { rateLimit: async () => ({ ok: false, retryAfter: 7 }) });
        await expect(handleUsers(limited, parse('list', {}), { grant })).rejects.toMatchObject({ code: 'rate_limited', retryAfter: 7 });
        const d = deps(seed(4));
        await handleUsers(d, parse('list', { limit: 2 }), { grant });
        expect(d.audit).toHaveBeenCalledWith('extension.users.read', { userId: 'actor', extensionId: 'ext1', op: 'list', rows: 2 });
    });
});
