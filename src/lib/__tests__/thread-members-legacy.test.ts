import { describe, expect, it } from 'vitest';
import { loadThreadMemberIds, type ThreadDb } from '@/lib/thread-store';

const KEY = 'h:sza@intendigital.com, cmr@intendigital.com::FACTURA - MANTENIMIENTO ZENTRICA';

function fakeDb(): ThreadDb {
    return {
        query: async (sql: string) => {
            if (sql.includes('"threadKey" = $2')) return [{ id: 'reply' }] as never;
            return [
                { id: 'original', subject: 'FACTURA - MANTENIMIENTO ZENTRICA', to: 'sza@intendigital.com, cmr@intendigital.com', cleanTo: null, createdAt: new Date() },
                { id: 'otro', subject: 'FACTURA - MANTENIMIENTO ZENTRICA', to: 'alguien@otro.com', cleanTo: null, createdAt: new Date() },
            ] as never;
        },
        execute: async () => 0,
    } as unknown as ThreadDb;
}

describe('loadThreadMemberIds', () => {
    it('incluye el original antiguo sin threadKey cuya clave heredada coincide', async () => {
        expect(await loadThreadMemberIds('u1', KEY, fakeDb())).toEqual(['reply', 'original']);
    });
    it('no mezcla correos con otros destinatarios', async () => {
        expect(await loadThreadMemberIds('u1', KEY, fakeDb())).not.toContain('otro');
    });
});
