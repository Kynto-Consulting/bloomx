/**
 * USER_DISABLED / USER_ENABLED: se emiten solo al CAMBIAR de estado, tras guardar, y un fallo del emisor o de la BD de lectura del usuario nunca
 * afecta al resultado de setUserDisabled.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    disabledNow: false,
    upsertOk: true,
    userRow: { id: 'u1', email: 'ana@acme.com' } as { id: string; email: string } | null,
    emitDisabled: vi.fn(),
    emitEnabled: vi.fn(),
    findUnique: vi.fn(),
}));

vi.mock('../sql', () => ({
    // isUserDisabled -> query(); upsert -> execute(); tolerant ejecuta la funcion
    query: vi.fn(async () => [{ d: h.disabledNow }]),
    execute: vi.fn(async () => { if (!h.upsertOk) throw Object.assign(new Error('relation does not exist'), { code: '42P01' }); return 1; }),
    tolerant: async (fn: () => Promise<unknown>, fallback: unknown) => { try { return await fn(); } catch { return fallback; } },
    toIso: (v: unknown) => (v ? String(v) : null),
}));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: (...a: unknown[]) => h.findUnique(...a) } } }));
vi.mock('@/lib/expansions/lifecycle-v2', () => ({
    emitUserDisabled: (u: unknown) => h.emitDisabled(u),
    emitUserEnabled: (u: unknown) => h.emitEnabled(u),
}));

import { setUserDisabled } from '../user-state';

beforeEach(() => {
    h.disabledNow = false;
    h.upsertOk = true;
    h.userRow = { id: 'u1', email: 'ana@acme.com' };
    h.emitDisabled.mockReset();
    h.emitEnabled.mockReset();
    h.findUnique.mockReset();
    h.findUnique.mockImplementation(async () => h.userRow);
});

describe('setUserDisabled -> eventos de extensiones', () => {
    it('habilitado -> deshabilitado: emite USER_DISABLED una vez', async () => {
        expect(await setUserDisabled('u1', true)).toBe(true);
        expect(h.emitDisabled).toHaveBeenCalledTimes(1);
        expect(h.emitDisabled).toHaveBeenCalledWith({ id: 'u1', email: 'ana@acme.com' });
        expect(h.emitEnabled).not.toHaveBeenCalled();
    });

    it('deshabilitado -> habilitado: emite USER_ENABLED', async () => {
        h.disabledNow = true;
        expect(await setUserDisabled('u1', false)).toBe(true);
        expect(h.emitEnabled).toHaveBeenCalledTimes(1);
        expect(h.emitDisabled).not.toHaveBeenCalled();
    });

    it('idempotente: repetir el mismo estado no emite', async () => {
        h.disabledNow = true;
        await setUserDisabled('u1', true);
        h.disabledNow = false;
        await setUserDisabled('u1', false);
        expect(h.emitDisabled).not.toHaveBeenCalled();
        expect(h.emitEnabled).not.toHaveBeenCalled();
    });

    it('si no se pudo guardar (tabla ausente) no emite y devuelve false', async () => {
        h.upsertOk = false;
        expect(await setUserDisabled('u1', true)).toBe(false);
        expect(h.emitDisabled).not.toHaveBeenCalled();
    });

    it('un fallo al leer el usuario o del emisor NO rompe la operacion', async () => {
        h.findUnique.mockImplementation(async () => { throw new Error('db down'); });
        expect(await setUserDisabled('u1', true)).toBe(true);
        h.findUnique.mockImplementation(async () => h.userRow);
        h.emitDisabled.mockImplementation(() => { throw new Error('hook roto'); });
        await expect(setUserDisabled('u1', true)).resolves.toBe(true);
        h.userRow = null; // usuario inexistente: no hay a quien avisar
        h.emitDisabled.mockReset();
        await expect(setUserDisabled('u1', true)).resolves.toBe(true);
        expect(h.emitDisabled).not.toHaveBeenCalled();
    });
});
