import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    LANDING_ICONS,
    LANDING_LIMITS,
    LANDING_MAX_BYTES,
    landingFromTheme,
    resolveDocsVisibility,
    resolveLandingText,
    sanitizeLandingConfig,
    sanitizeLandingConfigDetailed,
    withSanitizedLanding,
} from '../landing-config';

const BACKEND_FILE = path.resolve(__dirname, '../../../../bloomx-backend/src/lib/landing-config.ts');
const FRONT_FILE = path.resolve(__dirname, '../landing-config.ts');

describe('paridad frontend/backend (espejo)', () => {
    it.skipIf(!fs.existsSync(BACKEND_FILE))('landing-config.ts es identico en ambos repos', () => {
        expect(fs.readFileSync(BACKEND_FILE, 'utf8')).toBe(fs.readFileSync(FRONT_FILE, 'utf8'));
    });
    it('no tiene imports ni caracteres no ASCII (debe correr tal cual en el backend con strip-types)', () => {
        const src = fs.readFileSync(FRONT_FILE, 'utf8');
        expect(src).not.toMatch(/^\s*import\s/m);
        expect(src).not.toMatch(/^\s*(export\s+)?enum\s/m);
        // eslint-disable-next-line no-control-regex
        expect(/[^\x09\x0a\x0d\x20-\x7e]/.test(src)).toBe(false);
    });
});

describe('sanitizeLandingConfig: entradas basura', () => {
    it.each([null, undefined, 5, 'x', true, [], [1, 2], () => 1])('devuelve {} para %s', (v) => {
        expect(sanitizeLandingConfig(v)).toEqual({});
    });
    it('config vacia o solo con claves desconocidas -> {}', () => {
        expect(sanitizeLandingConfig({})).toEqual({});
        expect(sanitizeLandingConfig({ evil: 1, script: '<script>', __proto__: { x: 1 } })).toEqual({});
    });
    it('referencia circular no lanza', () => {
        const a: any = { layout: 'center' };
        a.self = a;
        expect(sanitizeLandingConfig(a)).toEqual({});
    });
    it('JSON > 32 KB se rechaza entero', () => {
        const big = { hero: { title: 'x' }, features: Array.from({ length: 6 }, () => ({ title: 'x'.repeat(60), text: 'y'.repeat(160), pad: 'z'.repeat(6000) })) };
        expect(JSON.stringify(big).length).toBeGreaterThan(LANDING_MAX_BYTES);
        const r = sanitizeLandingConfigDetailed(big);
        expect(r.config).toEqual({});
        expect(r.issues[0].code).toBe('too_large');
    });
    it('no contamina Object.prototype', () => {
        sanitizeLandingConfig(JSON.parse('{"__proto__":{"polluted":true},"hero":{"__proto__":{"polluted":true},"title":"a"}}'));
        expect(({} as any).polluted).toBeUndefined();
    });
});

describe('sanitizeLandingConfig: texto hostil', () => {
    it('quita HTML y no deja < ni >', () => {
        const c = sanitizeLandingConfig({
            hero: { title: '<img src=x onerror=alert(1)>Hola<script>alert(2)</script>', subtitle: 'a <b>b</b> c', badge: '<<svg/onload=1>' },
            footer: { text: 'ok <iframe src=//e.com>' },
        });
        const all = JSON.stringify(c);
        expect(all).not.toMatch(/[<>]/);
        expect(c.hero?.title).toContain('Hola');
        expect(c.hero?.subtitle).toBe('a b c');
    });
    it('normaliza espacios, saltos de linea y caracteres de control/bidi', () => {
        const c = sanitizeLandingConfig({ hero: { title: '  a\n\tb‮  c​\u0000d ' } });
        expect(c.hero?.title).toBe('a b c d');
    });
    it('recorta a la longitud maxima y lo informa', () => {
        const r = sanitizeLandingConfigDetailed({ hero: { title: 'x'.repeat(500) } });
        expect(r.config.hero?.title?.length).toBe(LANDING_LIMITS.heroTitle);
        expect(r.issues.some((i) => i.path === 'hero.title' && i.code === 'truncated')).toBe(true);
    });
    it('ignora valores que no son texto', () => {
        expect(sanitizeLandingConfig({ hero: { title: 5, subtitle: { a: 1 }, badge: ['x'] } })).toEqual({});
    });
    it('sin CSS/JS: los textos nunca contienen etiquetas ni se interpretan', () => {
        const c = sanitizeLandingConfig({ i18n: { es: { heroTitle: '<style>*{display:none}</style>Hola' }, xx: { heroTitle: 'no' } } });
        expect(c.i18n).toEqual({ es: { heroTitle: '*{display:none}Hola' } });
    });
});

describe('sanitizeLandingConfig: URLs', () => {
    const bad = [
        'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'http://cdn.example.com/a.png',
        '//cdn.example.com/a.png', 'ftp://x.com/a.png', 'https://user:pass@cdn.example.com/a.png', 'https://',
        'https://a.com/a b.png', 'https://a.com/"onerror="x', "https://a.com/'x", 'https://a.com/<x>', 'vbscript:x',
        '/relative/only.png', 'file:///etc/passwd', 'blob:https://a.com/1', 'https://a.com/' + 'x'.repeat(600),
    ];
    it.each(bad)('imagen: rechaza %s', (u) => {
        const c = sanitizeLandingConfig({
            hero: { imageUrl: u }, background: { type: 'image', imageUrl: u }, logo: { light: u, dark: u },
            testimonials: { enabled: true, items: [{ quote: 'q', avatarUrl: u }] },
        });
        expect(c.hero).toBeUndefined();
        expect(c.background?.imageUrl).toBeUndefined();
        expect(c.logo).toBeUndefined();
        expect(c.testimonials?.items?.[0].avatarUrl).toBeUndefined();
    });
    it('imagen: acepta https y lo normaliza', () => {
        const c = sanitizeLandingConfig({ hero: { imageUrl: ' https://CDN.Example.com/img/hero.jpg?w=1200 ' } });
        expect(c.hero?.imageUrl).toBe('https://cdn.example.com/img/hero.jpg?w=1200');
    });
    it('enlaces: aceptan https y rutas relativas seguras; rechazan lo demas', () => {
        const c = sanitizeLandingConfig({
            footer: {
                links: [
                    { label: 'ok1', url: 'https://example.com/terms' },
                    { label: 'ok2', url: '/legal/privacy' },
                    { label: 'js', url: 'javascript:alert(1)' },
                    { label: 'proto-rel', url: '//evil.com' },
                    { label: 'backslash', url: '/\\evil.com' },
                    { label: 'http', url: 'http://example.com' },
                    { label: 'data', url: 'data:text/html,<script>1</script>' },
                    { label: 'mailto', url: 'mailto:a@b.com' },
                    { label: '', url: 'https://example.com' },
                ],
            },
            legal: { termsUrl: 'javascript:alert(1)', privacyUrl: '/privacy' },
        });
        expect(c.footer?.links).toEqual([{ label: 'ok1', url: 'https://example.com/terms' }, { label: 'ok2', url: '/legal/privacy' }]);
        expect(c.legal).toEqual({ privacyUrl: '/privacy' });
    });
});

describe('sanitizeLandingConfig: colores, numeros y enums', () => {
    it('colores: solo hex; se normalizan a #rrggbb', () => {
        const c = sanitizeLandingConfig({
            hero: { gradient: { from: '#ABC', to: '#123456', angle: 90 } },
            background: { type: 'color', color: '#FF0000' },
        });
        expect(c.hero?.gradient).toEqual({ from: '#aabbcc', to: '#123456', angle: 90 });
        expect(c.background?.color).toBe('#ff0000');
    });
    it.each(['red', 'rgb(0,0,0)', 'url(x)', '#12', '#12345', '#gggggg', 'expression(1)', '#fff;background:url(x)', 5])('color invalido %s', (col) => {
        const c = sanitizeLandingConfig({ hero: { gradient: { from: col, to: '#000000' } }, background: { type: 'color', color: col } });
        expect(c.hero).toBeUndefined();
        expect(c.background?.color).toBeUndefined();
    });
    it('numeros acotados', () => {
        const c = sanitizeLandingConfig({ panelWidth: 99999, hero: { overlay: 7.777, gradient: { from: '#000', to: '#fff', angle: 9999 } }, logo: { height: 1 } });
        expect(c.panelWidth).toBe(LANDING_LIMITS.panelWidthMax);
        expect(c.hero?.overlay).toBe(1);
        expect(c.hero?.gradient?.angle).toBe(360);
        expect(c.logo?.height).toBe(LANDING_LIMITS.logoHeightMin);
        expect(sanitizeLandingConfig({ panelWidth: NaN, hero: { overlay: Infinity } })).toEqual({});
        expect(sanitizeLandingConfig({ panelWidth: '400' })).toEqual({});
    });
    it('enums: solo la lista blanca', () => {
        const c = sanitizeLandingConfig({
            layout: 'evil', locale: 'fr', hero: { pattern: 'x', imagePosition: 'diagonal', mobile: 'x' },
            testimonials: { style: 'x' }, logo: { position: 'x' }, form: { alignment: 'x' }, background: { type: 'x' },
        });
        expect(c).toEqual({});
        expect(sanitizeLandingConfig({ layout: 'fullscreen-bg', locale: 'en' })).toEqual({ layout: 'fullscreen-bg', locale: 'en' });
    });
    it('booleanos: solo booleanos reales', () => {
        const c = sanitizeLandingConfig({ docs: { visible: 'false', showInFooter: 0, landingLink: false }, form: { showGoogle: 'yes' } });
        expect(c).toEqual({ docs: { landingLink: false } });
    });
});

describe('sanitizeLandingConfig: listas y limites', () => {
    it('maximos de elementos', () => {
        const many = (n: number, f: (i: number) => object) => Array.from({ length: n }, (_, i) => f(i));
        const r = sanitizeLandingConfigDetailed({
            testimonials: { enabled: true, items: many(20, (i) => ({ quote: 'q' + i })) },
            features: many(20, (i) => ({ title: 't' + i })),
            stats: many(20, (i) => ({ value: String(i) })),
            footer: { links: many(20, (i) => ({ label: 'l' + i, url: '/x' + i })) },
        });
        expect(r.config.testimonials?.items).toHaveLength(LANDING_LIMITS.testimonials);
        expect(r.config.features).toHaveLength(LANDING_LIMITS.features);
        expect(r.config.stats).toHaveLength(LANDING_LIMITS.stats);
        expect(r.config.footer?.links).toHaveLength(LANDING_LIMITS.links);
        expect(r.issues.filter((i) => i.code === 'too_many_items')).toHaveLength(4);
    });
    it('iconos: lista blanca', () => {
        const c = sanitizeLandingConfig({ features: [{ icon: 'shield', title: 'a' }, { icon: '../../evil', title: 'b' }, { icon: '<svg>', title: 'c' }] });
        expect(c.features).toEqual([{ icon: 'shield', title: 'a' }, { title: 'b' }, { title: 'c' }]);
        expect(LANDING_ICONS).toContain('shield');
    });
    it('descarta elementos sin campo obligatorio y elementos que no son objetos', () => {
        const c = sanitizeLandingConfig({
            testimonials: { enabled: true, items: [{ author: 'sin cita' }, 'x', null, { quote: 'ok', author: 'A' }] },
            features: [{ text: 'sin titulo' }, 5],
            stats: [{ label: 'sin valor' }],
        });
        expect(c.testimonials?.items).toEqual([{ quote: 'ok', author: 'A' }]);
        expect(c.features).toBeUndefined();
        expect(c.stats).toBeUndefined();
    });
    it('es idempotente y el resultado cabe en 32 KB', () => {
        const input = {
            layout: 'split-left', panelWidth: 400,
            hero: { title: 'Hola', gradient: { from: '#000', to: '#fff', angle: 45 }, overlay: 0.4, pattern: 'dots' },
            testimonials: { enabled: true, style: 'carousel', items: [{ quote: 'q', author: 'a', role: 'r', avatarUrl: 'https://a.com/a.png' }] },
            features: [{ icon: 'lock', title: 'Seguro', text: 'Cifrado' }], stats: [{ value: '99%', label: 'uptime' }],
            footer: { text: 'f', links: [{ label: 'x', url: '/x' }], showPoweredBy: true },
            docs: { visible: false }, registration: { enabled: false, message: 'cerrado' },
            i18n: { es: { heroTitle: 'Hola' }, en: { heroTitle: 'Hello' } },
        };
        const once = sanitizeLandingConfig(input);
        expect(sanitizeLandingConfig(once)).toEqual(once);
        expect(sanitizeLandingConfigDetailed(input).bytes).toBeLessThanOrEqual(LANDING_MAX_BYTES);
        expect(sanitizeLandingConfigDetailed(input).issues).toEqual([]);
    });
});

describe('helpers', () => {
    it('resolveDocsVisibility: sin config = comportamiento historico', () => {
        expect(resolveDocsVisibility(undefined)).toEqual({ visible: true, landingLink: true, footer: false, sidebar: true });
        expect(resolveDocsVisibility({})).toEqual({ visible: true, landingLink: true, footer: false, sidebar: true });
    });
    it('resolveDocsVisibility: visible=false apaga todos los enlaces', () => {
        expect(resolveDocsVisibility({ docs: { visible: false, showInFooter: true } })).toEqual({ visible: false, landingLink: false, footer: false, sidebar: false });
        expect(resolveDocsVisibility({ docs: { showInFooter: true, landingLink: false } })).toEqual({ visible: true, landingLink: false, footer: true, sidebar: true });
    });
    it('resolveLandingText: i18n[locale] > base > undefined', () => {
        const cfg = sanitizeLandingConfig({ hero: { title: 'Base' }, i18n: { en: { heroTitle: 'English' } } });
        expect(resolveLandingText(cfg, 'en', 'heroTitle')).toBe('English');
        expect(resolveLandingText(cfg, 'es', 'heroTitle')).toBe('Base');
        expect(resolveLandingText(cfg, 'es', 'heroSubtitle')).toBeUndefined();
        expect(resolveLandingText(undefined, 'es', 'heroTitle')).toBeUndefined();
    });
    it('landingFromTheme / withSanitizedLanding: instancias viejas sin landing quedan igual', () => {
        const old = { primaryColor: '#000000' };
        expect(landingFromTheme(old)).toEqual({});
        expect(landingFromTheme(null)).toEqual({});
        expect(withSanitizedLanding(old)).toBe(old);
        expect(withSanitizedLanding(null)).toBeNull();
        const t = withSanitizedLanding({ primaryColor: '#000', landing: { layout: 'center', hero: { imageUrl: 'http://x' }, junk: 1 } });
        expect(t).toEqual({ primaryColor: '#000', landing: { layout: 'center' } });
        expect(withSanitizedLanding({ primaryColor: '#000', landing: { junk: 1 } })).toEqual({ primaryColor: '#000' });
    });
});
