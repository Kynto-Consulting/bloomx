import { describe, expect, it, vi } from 'vitest';

// flow.ts importa el servidor de Next y la sesion: solo se prueban las funciones puras del perfil.
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/session', () => ({ getCurrentUser: vi.fn(), getSessionCookie: vi.fn(), setSessionCookie: vi.fn() }));
vi.mock('@/lib/mfa', () => ({ mfaRequiredFor: vi.fn(() => false) }));
vi.mock('@/lib/permissions', () => ({ refreshPermissions: vi.fn() }));
vi.mock('@/lib/google/meet', () => ({ patchAllUserMeetRooms: vi.fn() }));
vi.mock('@/lib/db/pool', () => ({ getDbPool: () => { throw new Error('no db'); } }));

import { profileBody, profileId } from '../flow';

describe('perfil de userinfo: id estable segun la forma de cada proveedor', () => {
    it('id / sub de texto (OIDC y la mayoria): id tiene prioridad sobre sub', () => {
        expect(profileId({ id: 'a1', sub: 'b2' })).toBe('a1');
        expect(profileId({ sub: 'b2' })).toBe('b2');
    });
    it('id numerico (GitHub) se convierte a texto; 0, negativos, decimales y no seguros se rechazan', () => {
        expect(profileId({ id: 583231 })).toBe('583231');
        for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2, NaN]) expect(profileId({ id: bad })).toBeNull();
    });
    it('account_id (Atlassian), gid envuelto en data (Asana) y uri envuelto en resource (Calendly)', () => {
        expect(profileId({ account_id: '5b10ac8d82e05b22cc7d4ef5', email: 'a@b.c' })).toBe('5b10ac8d82e05b22cc7d4ef5');
        expect(profileId({ data: { gid: '12345', name: 'Ana', email: 'ana@x.test' } })).toBe('12345');
        expect(profileId({ resource: { uri: 'https://api.calendly.com/users/AAA' } })).toBe('https://api.calendly.com/users/AAA');
        expect(profileBody({ data: { gid: '1', email: 'ana@x.test' } })).toMatchObject({ email: 'ana@x.test' });
    });
    it('sin identificador util => null (la vinculacion falla); objetos, arreglos y textos enormes no valen', () => {
        for (const raw of [null, {}, { id: {} }, { id: [] }, { id: '' }, { id: 'x'.repeat(257) }, { data: [] }, { data: 'x' }]) expect(profileId(raw as never)).toBeNull();
    });
    it('un perfil que ya trae id no se confunde con un sobre data/resource', () => {
        expect(profileId({ id: 'real', data: { gid: 'otro' } })).toBe('real');
    });
});
