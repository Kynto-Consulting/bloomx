import { describe, expect, it } from 'vitest';
import { buildReadingContext, parseFromContact, toBackendContext } from '../context';
import { safeHref, safeImageSrc, safeInternalPath } from '../safe-url';

describe('toBackendContext', () => {
    it('quita funciones, overlays y datos que solo puede fijar el servidor (auth, user, env)', () => {
        const ctx = toBackendContext({
            subject: 'Hola',
            emailContent: 'cuerpo',
            extensionId: 'core-x',
            setSubject: () => { },
            overlays: { a: {} },
            auth: { google: { accessToken: 'SECRET' } },
            user: { id: 'evil' },
            env: { K: 'v' },
            toolbarButtonMode: 'compact',
            to: ['a@x.com'],
        });
        expect(ctx).toEqual({ subject: 'Hola', emailContent: 'cuerpo', extensionId: 'core-x', to: ['a@x.com'] });
    });

    it('resiste referencias circulares y limita el tamano', () => {
        const a: any = { name: 'a' };
        a.self = a;
        expect(() => toBackendContext(a)).not.toThrow();
        expect(toBackendContext({ big: 'x'.repeat(300_000) }).big.length).toBe(200_000);
    });
});

describe('parseFromContact', () => {
    it('entiende "Nombre <mail>", comillas, "Apellido, Nombre" y mail suelto', () => {
        expect(parseFromContact('Ana Perez <ANA@x.com>')).toEqual({ email: 'ana@x.com', name: 'Ana Perez', firstName: 'Ana', lastName: 'Perez' });
        expect(parseFromContact('"Perez, Ana" <ana@x.com>')).toMatchObject({ firstName: 'Ana', lastName: 'Perez' });
        expect(parseFromContact('solo@x.com')).toMatchObject({ email: 'solo@x.com', firstName: 'solo' });
        expect(parseFromContact('')).toBeNull();
        expect(parseFromContact('sin arroba')).toBeNull();
    });
});

describe('buildReadingContext', () => {
    it('un correo abierto recibe emailContent (cuerpo o snippet) y fromContact', () => {
        const email = { id: '1', messageId: 'm', from: 'Ana <ana@x.com>', subject: 'S', snippet: 'resumen' };
        const ctx = buildReadingContext(email);
        expect(ctx.emailContent).toBe('resumen');
        expect(ctx.fromContact.email).toBe('ana@x.com');
        expect(ctx.from).toBe('Ana <ana@x.com>'); // from sigue siendo el string

        const withBody = buildReadingContext({ ...email, content: '<p>Hola <b>mundo</b></p><script>x()</script>' });
        expect(withBody.emailContent).toBe('Hola mundo');
    });

    it('no toca el contexto del composer', () => {
        const composer = { subject: 'S', emailContent: 'borrador', sender: { email: 'yo@x.com' } };
        expect(buildReadingContext(composer)).toBe(composer);
        expect(buildReadingContext(undefined)).toBeUndefined();
    });
});

describe('safe-url', () => {
    it('safeHref: http(s), mailto y tel; nunca javascript:/data:', () => {
        expect(safeHref('https://a.com/x')).toBe('https://a.com/x');
        expect(safeHref('mailto:a@b.com')).toBe('mailto:a@b.com');
        expect(safeHref('javascript:alert(1)')).toBeNull();
        expect(safeHref(' JaVaScRiPt:alert(1)')).toBeNull();
        expect(safeHref('data:text/html,<script>')).toBeNull();
        expect(safeHref('vbscript:x')).toBeNull();
        expect(safeHref('')).toBeNull();
    });

    it('safeImageSrc: solo http(s)', () => {
        expect(safeImageSrc('https://media.giphy.com/a.gif')).toBeTruthy();
        expect(safeImageSrc('data:image/svg+xml;base64,AAA')).toBeNull();
        expect(safeImageSrc('javascript:1')).toBeNull();
    });

    it('safeInternalPath: solo rutas locales', () => {
        expect(safeInternalPath('/calendar?x=1')).toBe('/calendar?x=1');
        expect(safeInternalPath('//evil.com')).toBeNull();
        expect(safeInternalPath('https://evil.com')).toBeNull();
        expect(safeInternalPath('/\\evil.com')).toBeNull();
        expect(safeInternalPath('javascript:1')).toBeNull();
    });
});
