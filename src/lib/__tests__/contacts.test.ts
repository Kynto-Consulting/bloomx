import { describe, it, expect } from 'vitest';
import { parseContactInput, parseContactPagination } from '../contacts';

describe('parseContactInput', () => {
    it('crea: exige correo valido, normaliza y limpia campos', () => {
        const r = parseContactInput({ email: '  Ana@Example.COM ', name: ' Ana\n', notes: '' });
        expect(r).toEqual({ ok: true, value: { email: 'ana@example.com', name: 'Ana', notes: null } });
        expect(parseContactInput({ email: 'no-es-correo' })).toMatchObject({ ok: false });
        expect(parseContactInput(null)).toMatchObject({ ok: false });
    });

    it('edicion parcial: solo devuelve lo enviado; cadena vacia borra', () => {
        expect(parseContactInput({ name: '' }, { partial: true })).toEqual({ ok: true, value: { name: null } });
        expect(parseContactInput({ notes: 'hola' }, { partial: true })).toEqual({ ok: true, value: { notes: 'hola' } });
        expect(parseContactInput({}, { partial: true })).toMatchObject({ ok: false });
        expect(parseContactInput({ email: 'xx' }, { partial: true })).toMatchObject({ ok: false });
    });
});

describe('parseContactPagination', () => {
    it('aplica limites y valores por defecto', () => {
        expect(parseContactPagination(new URLSearchParams(''))).toEqual({ limit: 1000, offset: 0, q: '' });
        expect(parseContactPagination(new URLSearchParams('limit=50&offset=100&q=ana'))).toEqual({ limit: 50, offset: 100, q: 'ana' });
        expect(parseContactPagination(new URLSearchParams('limit=999999&offset=-5'))).toEqual({ limit: 1000, offset: 0, q: '' });
        expect(parseContactPagination(new URLSearchParams('limit=abc&offset=xyz'))).toEqual({ limit: 1000, offset: 0, q: '' });
        expect(parseContactPagination(new URLSearchParams('limit=0')).limit).toBe(1);
    });
});
