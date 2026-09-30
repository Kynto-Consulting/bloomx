import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contrast } from '@/lib/color';
import { analyzeEmailBrand, brandPassesAA, cleanBrandText, defaultEmailBrand, getEmailBrand, httpsOnly, resolveEmailLocale } from '../email-brand';
import { fetchDomainEmailContext, getRequestEmailBrand, getRequestEmailLocale, resolveEmailHost } from '../email-brand-server';
import { buildHostNotificationHtml } from '../email-templates';

const LOGO = 'https://cdn.acme.example/logo.png';
const ENV_KEYS = ['NEXT_PUBLIC_BRAND_NAME', 'NEXT_PUBLIC_BRAND_COLOR', 'TOP_DOMAIN', 'NEXT_PUBLIC_BACKEND_URL'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => {
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    vi.unstubAllGlobals();
});

describe('getEmailBrand: fallbacks', () => {
    it('sin configuracion: comportamiento historico (Bloom, azul, sin logo ni pie)', () => {
        for (const input of [null, undefined, {}, { theme: null }, { theme: 'basura' }, { theme: [] }]) {
            expect(getEmailBrand(input as never)).toEqual({ name: 'Bloom', color: '#2563eb', onColor: '#ffffff', linkColor: '#2563eb', logoUrl: null, url: null, footer: null, locale: null });
        }
        expect(defaultEmailBrand().name).toBe('Bloom');
    });

    it('el entorno (NEXT_PUBLIC_BRAND_*) sigue siendo el respaldo', () => {
        process.env.NEXT_PUBLIC_BRAND_NAME = 'Envco';
        process.env.NEXT_PUBLIC_BRAND_COLOR = '#7c3aed';
        const b = getEmailBrand(null);
        expect(b.name).toBe('Envco');
        expect(b.color).toBe('#7c3aed');
        process.env.NEXT_PUBLIC_BRAND_COLOR = 'no-es-hex';
        expect(getEmailBrand(null).color).toBe('#2563eb');
    });

    it('nombre: displayName > name > entorno; saneado', () => {
        expect(getEmailBrand({ name: 'mail.acme.example', displayName: 'Acme Corp' }).name).toBe('Acme Corp');
        expect(getEmailBrand({ name: 'mail.acme.example', displayName: '  ' }).name).toBe('mail.acme.example');
        const hostile = getEmailBrand({ displayName: '<script>alert(1)</script>\r\nBcc: x' + 'a'.repeat(200) });
        expect(hostile.name).not.toMatch(/[<>\r\n]/);
        expect(hostile.name.length).toBeLessThanOrEqual(60);
        expect(cleanBrandText(42, 10)).toBe('');
    });
});

describe('getEmailBrand: color', () => {
    const cases: Array<[string, unknown]> = [
        ['paleta clara', { palette: { light: { primary: '#7c3aed' } } }],
        ['campo antiguo primaryColor', { primaryColor: '#7c3aed' }],
        ['solo paleta oscura (el motor deriva el claro)', { palette: { dark: { primary: '#a78bfa', background: '#0b0b12' } } }],
    ];
    for (const [label, theme] of cases) {
        it(`toma el primario de: ${label}`, () => {
            const b = getEmailBrand({ displayName: 'Acme', theme });
            expect(b.color).toMatch(/^#[0-9a-f]{6}$/);
            expect(brandPassesAA(b)).toBe(true);
        });
    }

    it('la paleta clara gana sobre el campo antiguo', () => {
        expect(getEmailBrand({ theme: { primaryColor: '#ff0000', palette: { light: { primary: '#1e3a8a' } } } }).color).toBe('#1e3a8a');
    });

    it('hex invalido o con inyeccion CSS => se ignora (cae al azul por defecto)', () => {
        for (const bad of ['red', 'rgb(1,2,3)', '#12345', '#ggg', '#fff;} body{display:none} /*', 'url(https://evil.example/x)', 42, null]) {
            const b = getEmailBrand({ theme: { primaryColor: bad } });
            expect(b.color, String(bad)).toBe('#2563eb');
        }
    });

    it('cualquier color de marca conserva su tono; el texto encima y la marca-como-texto cumplen AA', () => {
        for (const primary of ['#ffcc00', '#ffffff', '#00ff00', '#888888', '#f5e6c8', '#ff0000', '#000000', '#0a1f44', '#7c3aed', '#2563eb']) {
            const b = getEmailBrand({ displayName: 'X', theme: { palette: { light: { primary } } } });
            expect(b.color, primary).toBe(primary); // superficies: tono exacto
            expect(contrast(b.color, b.onColor), primary).toBeGreaterThanOrEqual(4.5);
            expect(contrast(b.linkColor, '#ffffff'), primary).toBeGreaterThanOrEqual(4.5);
            expect(brandPassesAA(b)).toBe(true);
        }
        expect(getEmailBrand({ theme: { palette: { light: { primary: '#1e3a8a' } } } }).color).toBe('#1e3a8a');
    });

    it('analyzeEmailBrand avisa cuando el color hubo que corregirlo como texto (no en las superficies)', () => {
        const yellow = getEmailBrand({ theme: { palette: { light: { primary: '#ffcc00' } } } });
        const a = analyzeEmailBrand(yellow, '#ffcc00');
        expect(a).toMatchObject({ requested: '#ffcc00', textCorrected: true, surfacesExact: true });
        expect(a.linkRatio).toBeGreaterThanOrEqual(4.5);
        expect(a.onColorRatio).toBeGreaterThanOrEqual(4.5);
        const navy = analyzeEmailBrand(getEmailBrand({ theme: { palette: { light: { primary: '#1e3a8a' } } } }), '#1e3a8a');
        expect(navy).toMatchObject({ textCorrected: false, surfacesExact: true });
    });
});

describe('getEmailBrand: logo, pie, idioma y sitio', () => {
    it('logo claro de landing.logo.light (solo https); el oscuro no se usa', () => {
        expect(getEmailBrand({ theme: { landing: { logo: { light: LOGO, dark: 'https://cdn.acme.example/dark.png' } } } }).logoUrl).toBe(LOGO);
        expect(getEmailBrand({ theme: { landing: { logo: { dark: 'https://cdn.acme.example/dark.png' } } } }).logoUrl).toBeNull();
        expect(getEmailBrand({ displayName: 'Acme', logo: LOGO }).logoUrl).toBeNull(); // favicon del dominio: no es logo de correo
    });

    it('logo http / javascript / data / con credenciales / puerto raro => rechazado (texto con el nombre)', () => {
        for (const bad of ['http://cdn.acme.example/logo.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'https://u:p@cdn.acme.example/l.png', 'https://cdn.acme.example:8443/l.png', 'https://intranet/l.png', '//cdn.acme.example/l.png']) {
            expect(getEmailBrand({ theme: { landing: { logo: { light: bad } } } }).logoUrl, bad).toBeNull();
            expect(httpsOnly(bad), bad).toBeNull();
        }
        expect(httpsOnly(LOGO)).toBe(LOGO);
    });

    it('pie, idioma forzado y sitio del dominio', () => {
        const b = getEmailBrand({ name: 'mail.acme.example', theme: { landing: { footer: { text: 'Av. Siempre Viva 742' }, locale: 'en' } } });
        expect(b.footer).toBe('Av. Siempre Viva 742');
        expect(b.locale).toBe('en');
        expect(b.url).toBe('https://mail.acme.example');
        expect(getEmailBrand({ name: 'localhost' }).url).toBeNull();
        expect(getEmailBrand({ name: 'x.local' }).url).toBeNull();
        expect(getEmailBrand({ name: 'javascript:alert(1)' }).url).toBeNull();
        expect(getEmailBrand({ theme: { landing: { locale: 'fr' } } }).locale).toBeNull();
    });
});

describe('resolveEmailLocale', () => {
    it('invitado (audience recipient): Accept-Language > empresa > es', () => {
        expect(resolveEmailLocale({ audience: 'recipient', acceptLanguage: 'en-US,en;q=0.9', brand: { locale: 'es' } })).toBe('en');
        expect(resolveEmailLocale({ audience: 'recipient', acceptLanguage: 'fr-FR', brand: { locale: 'en' } })).toBe('en');
        expect(resolveEmailLocale({ audience: 'recipient', acceptLanguage: null, brand: null })).toBe('es');
    });

    it('usuario / anfitrion: preferencia > empresa > Accept-Language > es', () => {
        expect(resolveEmailLocale({ audience: 'user', preferred: 'en', brand: { locale: 'es' }, acceptLanguage: 'es' })).toBe('en');
        expect(resolveEmailLocale({ audience: 'user', preferred: 'xx', brand: { locale: 'en' }, acceptLanguage: 'es' })).toBe('en');
        expect(resolveEmailLocale({ audience: 'user', brand: { locale: null }, acceptLanguage: 'en-GB' })).toBe('en');
        expect(resolveEmailLocale({ audience: 'user' })).toBe('es');
    });

    it('getRequestEmailLocale lee la cookie de idioma y Accept-Language de la peticion', () => {
        const req = new Request('https://a.test/x', { headers: { cookie: 'a=1; bloomx-lang=en; b=2', 'accept-language': 'es' } });
        expect(getRequestEmailLocale(req, { locale: null }, 'user')).toBe('en');
        expect(getRequestEmailLocale(req, { locale: null }, 'recipient')).toBe('es');
        expect(getRequestEmailLocale(null, null, 'user')).toBe('es');
    });
});

describe('carga de la config del dominio (misma peticion y cache que el layout)', () => {
    it('resolveEmailHost: TOP_DOMAIN > x-forwarded-host > host, sin puerto', () => {
        const req = new Request('https://a.test/x', { headers: { host: 'mail.acme.example:3000', 'x-forwarded-host': 'fwd.acme.example, other' } });
        expect(resolveEmailHost(req)).toBe('fwd.acme.example');
        process.env.TOP_DOMAIN = 'Top.Acme.Example';
        expect(resolveEmailHost(req)).toBe('top.acme.example');
        expect(resolveEmailHost(null)).toBe('top.acme.example');
    });

    it('GET {backend}/api/config?domain=... con tag domain-config y revalidate 60; devuelve la marca del dominio', async () => {
        process.env.NEXT_PUBLIC_BACKEND_URL = 'https://backend.test';
        const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ config: { name: 'mail.acme.example', displayName: 'Acme', theme: { primaryColor: '#7c3aed', landing: { logo: { light: LOGO } } } } }) }));
        vi.stubGlobal('fetch', fetchMock);
        const brand = await getRequestEmailBrand(new Request('https://a.test/x', { headers: { host: 'mail.acme.example' } }));
        expect(brand).toMatchObject({ name: 'Acme', color: '#7c3aed', logoUrl: LOGO, url: 'https://mail.acme.example' });
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { next: { revalidate: number; tags: string[] } }];
        expect(url).toBe('https://backend.test/api/config?domain=mail.acme.example');
        expect(init.next).toEqual({ revalidate: 60, tags: ['domain-config'] });
    });

    it('backend caido, respuesta rara o excepcion => marca por defecto, sin lanzar', async () => {
        for (const impl of [
            async () => { throw new Error('red'); },
            async () => ({ ok: false, json: async () => ({}) }),
            async () => ({ ok: true, json: async () => ({ config: 'x' }) }),
            async () => ({ ok: true, json: async () => { throw new Error('json'); } }),
        ]) {
            vi.stubGlobal('fetch', vi.fn(impl));
            expect(await fetchDomainEmailContext('a.test')).toBeNull();
            expect((await getRequestEmailBrand(null)).name).toBe('Bloom');
        }
    });
});

describe('la marca llega a los correos', () => {
    it('logo y color de la empresa aparecen en el HTML; sin logo, el nombre en texto', () => {
        const withLogo = getEmailBrand({ name: 'mail.acme.example', displayName: 'Acme', theme: { primaryColor: '#7c3aed', landing: { logo: { light: LOGO }, footer: { text: 'Av. 1' } } } });
        const args = { guestName: 'Ana', guestEmail: 'ana@example.com', scheduleName: 'Demo', startsAt: new Date('2030-01-15T15:00:00Z'), endsAt: new Date('2030-01-15T16:00:00Z'), timezone: 'America/Lima' };
        const html = buildHostNotificationHtml({ ...args, brand: withLogo, locale: 'es' });
        expect(html).toContain(`<img src="${LOGO}" alt="Acme"`);
        expect(html).toContain('#7c3aed');
        expect(html).toContain('Av. 1');
        expect(html).toContain('https://mail.acme.example');
        const noLogo = buildHostNotificationHtml({ ...args, brand: getEmailBrand({ displayName: 'Acme', theme: { primaryColor: '#7c3aed' } }), locale: 'en' });
        expect(noLogo).not.toContain('<img');
        expect(noLogo).toContain('>Acme<');
        expect(noLogo).toContain('New booking');
    });
});
