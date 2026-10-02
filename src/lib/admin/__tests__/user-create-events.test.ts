/** createUserAccount emite USER_CREATED (admin por defecto, import desde la importacion) solo tras crear la cuenta; un emisor roto no rompe el alta. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    emit: vi.fn(),
    create: vi.fn(),
    taken: false,
}));

vi.mock('@/lib/expansions/lifecycle-v2', () => ({ emitUserCreated: (...a: unknown[]) => h.emit(...a) }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { create: (...a: unknown[]) => h.create(...a) } } }));
vi.mock('bcryptjs', () => ({ default: { hash: async () => 'HASH' } }));
vi.mock('@/lib/security', () => ({ BCRYPT_COST: 4, validateNewPassword: () => null }));
vi.mock('../temp-password', () => ({ generateTemporaryPassword: () => 'Temp-Password-123!' }));
vi.mock('../users-store', () => ({ userEmailTaken: async () => h.taken }));
vi.mock('../user-state', () => ({ setMustChangePassword: async () => true }));

import { createUserAccount } from '../user-create';

beforeEach(() => {
    h.emit.mockReset();
    h.create.mockReset();
    h.taken = false;
    h.create.mockImplementation(async ({ data }: { data: { email: string; name?: string } }) => ({ id: 'cku1', email: data.email, name: data.name ?? null, createdAt: new Date('2026-01-01T00:00:00Z') }));
});

describe('createUserAccount -> USER_CREATED', () => {
    it('emite con origen admin por defecto, con el usuario creado y sin contrasena', async () => {
        const r = await createUserAccount({ email: 'Nuevo@Acme.com', name: 'Nuevo' });
        expect(r.user.email).toBe('nuevo@acme.com');
        expect(h.emit).toHaveBeenCalledTimes(1);
        const [user, source] = h.emit.mock.calls[0];
        expect(source).toBe('admin');
        expect(user).toMatchObject({ id: 'cku1', email: 'nuevo@acme.com' });
        expect(JSON.stringify(h.emit.mock.calls[0])).not.toMatch(/HASH|Temp-Password/);
    });

    it('la importacion de buzones pasa source import', async () => {
        await createUserAccount({ email: 'otro@acme.com', source: 'import' });
        expect(h.emit.mock.calls[0][1]).toBe('import');
    });

    it('no emite si el correo ya existe ni si la creacion falla', async () => {
        h.taken = true;
        await expect(createUserAccount({ email: 'dup@acme.com' })).rejects.toBeTruthy();
        h.taken = false;
        h.create.mockImplementation(async () => { throw Object.assign(new Error('unique'), { code: 'P2002' }); });
        await expect(createUserAccount({ email: 'dup@acme.com' })).rejects.toBeTruthy();
        expect(h.emit).not.toHaveBeenCalled();
    });
});
