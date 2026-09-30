import { describe, expect, it } from 'vitest';
import { contactDisplayName, contactInitial, isValidContactEmail, mergeContactPages, parsePageHeaders } from '../contacts';

describe('helpers de UI de contactos', () => {
    it('valida correos como el servidor', () => {
        expect(isValidContactEmail(' Ana@Example.com ')).toBe(true);
        expect(isValidContactEmail('no-es-correo')).toBe(false);
        expect(isValidContactEmail('')).toBe(false);
    });

    it('mergeContactPages no duplica ids al solaparse paginas', () => {
        const a = [{ id: '1' }, { id: '2' }];
        expect(mergeContactPages(a, [{ id: '2' }, { id: '3' }]).map(c => c.id)).toEqual(['1', '2', '3']);
        expect(mergeContactPages([], [])).toEqual([]);
    });

    it('nombre visible e inicial con fallbacks', () => {
        expect(contactDisplayName({ name: '  Ana ', email: 'a@x.com' })).toBe('Ana');
        expect(contactDisplayName({ name: null, email: 'a@x.com' })).toBe('a@x.com');
        expect(contactInitial({ name: 'ébano', email: 'a@x.com' })).toBe('É');
        expect(contactInitial({ name: '', email: 'zed@x.com' })).toBe('Z');
        expect(contactInitial({})).toBe('?');
    });

    it('interpreta cabeceras de paginacion', () => {
        const h = (m: Record<string, string>) => ({ get: (k: string) => m[k] ?? null });
        expect(parsePageHeaders(h({ 'X-Total-Count': '120', 'X-Has-More': 'true' }), 50)).toEqual({ total: 120, hasMore: true });
        expect(parsePageHeaders(h({}), 7)).toEqual({ total: 7, hasMore: false });
    });
});
