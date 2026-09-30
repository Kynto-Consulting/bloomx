import { describe, it, expect } from 'vitest';
import {
    hasRemoteImages, senderAddress, emptyPolicy, isRemoteImagesAllowed, allowForEmail, allowForSender,
} from '../remote-images';

describe('hasRemoteImages', () => {
    it('detecta img, background CSS y atributo background remotos', () => {
        expect(hasRemoteImages('<p>hola</p><img src="https://t.example.com/p.gif">')).toBe(true);
        expect(hasRemoteImages('<img alt="x" src=\'//cdn.example.com/a.png\'>')).toBe(true);
        expect(hasRemoteImages('<div style="background: url(https://x.com/a.png)"></div>')).toBe(true);
        expect(hasRemoteImages('<table background="http://x.com/bg.jpg"></table>')).toBe(true);
    });

    it('no marca data:, cid: ni imagenes relativas', () => {
        expect(hasRemoteImages('<img src="data:image/png;base64,AAAA">')).toBe(false);
        expect(hasRemoteImages('<img src="cid:logo@x">')).toBe(false);
        expect(hasRemoteImages('<p>solo texto https://x.com/a.png</p>')).toBe(false);
    });
});

describe('politica', () => {
    it('extrae y normaliza el remitente', () => {
        expect(senderAddress('"Ana, L" <Ana@X.com>')).toBe('ana@x.com');
        expect(senderAddress('bob@y.com')).toBe('bob@y.com');
        expect(senderAddress(null)).toBe('');
    });

    it('permite por correo o por remitente, sin mutar la politica anterior', () => {
        const base = emptyPolicy();
        const p1 = allowForEmail(base, 'e1');
        expect(base.emails).toEqual([]);
        expect(isRemoteImagesAllowed(p1, 'e1', 'a@x.com')).toBe(true);
        expect(isRemoteImagesAllowed(p1, 'e2', 'a@x.com')).toBe(false);

        const p2 = allowForSender(p1, 'Ana <A@x.com>');
        expect(isRemoteImagesAllowed(p2, 'e9', 'a@x.com')).toBe(true);
        expect(isRemoteImagesAllowed(p2, 'e9', 'otro@x.com')).toBe(false);
    });

    it('no anade duplicados ni remitentes vacios', () => {
        const p = allowForEmail(allowForEmail(emptyPolicy(), 'e1'), 'e1');
        expect(p.emails).toEqual(['e1']);
        expect(allowForSender(emptyPolicy(), '')).toEqual(emptyPolicy());
    });
});
