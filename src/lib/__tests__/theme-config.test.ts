import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    ALPHA_TOKENS, FONT_FAMILIES, TOKEN_KEYS, hasBrandConfig, normalizeThemeHex, resolveFontStack, resolveRadiusRem,
    sanitizeThemeConfig, validateThemeConfig,
} from '../theme-config';
import golden from './fixtures/theme-config-golden.json';

describe('normalizeThemeHex', () => {
    it('normaliza #rgb, #rrggbb y #rrggbbaa a minusculas', () => {
        expect(normalizeThemeHex('#ABC')).toBe('#aabbcc');
        expect(normalizeThemeHex(' #4F46E5 ')).toBe('#4f46e5');
        expect(normalizeThemeHex('#12345678', true)).toBe('#12345678');
        expect(normalizeThemeHex('#123456ff')).toBe('#123456');
        expect(normalizeThemeHex('#abcf')).toBe('#aabbcc');
    });
    it('rechaza alfa cuando no esta permitido y cualquier no-hex', () => {
        expect(normalizeThemeHex('#12345678')).toBeNull();
        for (const bad of ['red', 'rgb(1,2,3)', 'hsl(0 0% 0%)', '#12', '#12345', '#1234567', '#gggggg', 'url(x)', 'var(--x)', '', null, undefined, 5, {}, '#fff;color:red']) {
            expect(normalizeThemeHex(bad as unknown)).toBeNull();
        }
    });
});

describe('sanitizeThemeConfig: entrada hostil', () => {
    it('no lanza con basura de cualquier tipo y devuelve {}', () => {
        for (const junk of [null, undefined, 0, 1, 'x', true, [], [1, 2], () => 1, Symbol('s'), new Date(), new Map()]) {
            expect(() => sanitizeThemeConfig(junk as unknown)).not.toThrow();
            expect(sanitizeThemeConfig(junk as unknown)).toEqual({});
        }
    });

    it('descarta CSS injection en colores, fuentes, radio y palette', () => {
        const evil = '#fff;} body{display:none} /*';
        const cfg = sanitizeThemeConfig({
            primaryColor: evil, accentColor: 'url(https://evil/x.png)', backgroundColor: 'expression(alert(1))',
            titleFont: 'Inter; } body{display:none', bodyFont: 'x</style><script>alert(1)</script>',
            radius: '1rem; } x{', fontFamily: 'Arial; } x{',
            palette: { light: { background: evil, primary: 'var(--x)', overlay: '#000000;' }, dark: { 'not-a-token;}': '#fff' } },
        });
        expect(cfg).toEqual({});
        expect(JSON.stringify(cfg)).not.toMatch(/[;<>]|url\(|expression/);
    });

    it('descarta claves desconocidas y prototipos peligrosos', () => {
        const input = JSON.parse('{"unknownKey":1,"__proto__":{"polluted":true},"constructor":"x","primaryColor":"#123456","palette":{"__proto__":{"a":1},"light":{"__proto__":"#fff","constructor":"#fff"}}}');
        const cfg = sanitizeThemeConfig(input);
        expect(cfg).toEqual({ primaryColor: '#123456' });
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect(Object.keys(cfg)).toEqual(['primaryColor']);
    });

    it('palette: solo tokens de la lista blanca, hex valido y alfa solo en overlay', () => {
        const cfg = sanitizeThemeConfig({
            palette: {
                light: { background: '#FFF', foreground: '#111', overlay: '#00000080', primary: '#f00c', bogus: '#fff', sidebar: 'nope', 'row-hover': '' },
                dark: { 'row-hover': '#222222ff' },
                extra: { background: '#fff' },
            },
        });
        expect(cfg.palette).toEqual({ light: { background: '#ffffff', foreground: '#111111', overlay: '#00000080' }, dark: { 'row-hover': '#222222' } });
        expect(ALPHA_TOKENS).toEqual(['overlay']);
        const { issues } = validateThemeConfig({ palette: { light: { primary: '#f00c', bogus: '#fff', sidebar: 'nope' } } });
        expect(issues.map((i) => i.code).sort()).toEqual(['alpha_not_allowed', 'invalid_color', 'invalid_token']);
    });

    it('palette: cada clave de TOKEN_KEYS se acepta y ninguna otra', () => {
        const all = Object.fromEntries(TOKEN_KEYS.map((k) => [k, '#123456']));
        expect(Object.keys(sanitizeThemeConfig({ palette: { light: all } }).palette!.light!)).toHaveLength(TOKEN_KEYS.length);
        expect(sanitizeThemeConfig({ palette: { light: { 'foo-bar': '#123456' } } }).palette).toBeUndefined();
    });

    it('rechaza entradas gigantes sin lanzar (too_large)', () => {
        const big = { landing: { text: 'x'.repeat(200_000) } };
        expect(validateThemeConfig(big).issues[0].code).toBe('too_large');
        expect(sanitizeThemeConfig(big)).toEqual({});
    });

    it('entrada circular no lanza', () => {
        const a: Record<string, unknown> = { primaryColor: '#123456' };
        a.self = a;
        expect(() => sanitizeThemeConfig(a)).not.toThrow();
        expect(sanitizeThemeConfig(a)).toEqual({});
    });

    it('allowedThemes: dedupe, minusculas, sin system/brand-*/rutas y maximo 32', () => {
        expect(sanitizeThemeConfig({ allowedThemes: ['Ocean', 'forest', 'ocean', 'system', 'brand-light', '../x', 'a'.repeat(40), 5] }).allowedThemes)
            .toEqual(['ocean', 'forest']);
        const many = Array.from({ length: 80 }, (_, i) => `t${i}`);
        expect(sanitizeThemeConfig({ allowedThemes: many }).allowedThemes).toHaveLength(32);
        expect(sanitizeThemeConfig({ allowedThemes: [] }).allowedThemes).toBeUndefined();
        expect(sanitizeThemeConfig({ allowedThemes: 'ocean' }).allowedThemes).toBeUndefined();
    });

    it('radius: enum, numero 0-3 o cadena numerica; el resto se descarta', () => {
        expect(sanitizeThemeConfig({ radius: 'LG' }).radius).toBe('lg');
        expect(sanitizeThemeConfig({ radius: 0.75 }).radius).toBe(0.75);
        expect(sanitizeThemeConfig({ radius: '1.25' }).radius).toBe(1.25);
        for (const bad of [99, -1, 'huge', NaN, Infinity, '1rem', {}, []]) expect(sanitizeThemeConfig({ radius: bad }).radius).toBeUndefined();
        expect(resolveRadiusRem({ radius: 'none' })).toBe(0);
        expect(resolveRadiusRem({ radius: 'xl' })).toBe(1);
        expect(resolveRadiusRem({})).toBeNull();
    });

    it('fontFamily: solo ids de la lista blanca (normalizados) y stacks constantes', () => {
        expect(sanitizeThemeConfig({ fontFamily: 'Humanist' }).fontFamily).toBe('humanist');
        expect(sanitizeThemeConfig({ fontFamily: 'comic sans; x' }).fontFamily).toBeUndefined();
        expect(sanitizeThemeConfig({ fontFamily: 'Arial' }).fontFamily).toBeUndefined();
        expect(resolveFontStack('serif')).toBe(FONT_FAMILIES.serif.stack);
        expect(resolveFontStack('nope')).toBeNull();
        for (const f of Object.values(FONT_FAMILIES)) expect(f.stack).not.toMatch(/[;{}<>]/);
    });

    it('defaultMode y booleanos: solo valores validos', () => {
        expect(sanitizeThemeConfig({ defaultMode: 'DARK' }).defaultMode).toBe('dark');
        expect(sanitizeThemeConfig({ defaultMode: 'auto' }).defaultMode).toBeUndefined();
        expect(sanitizeThemeConfig({ lockBrand: 'true', autoFixContrast: 1 })).toEqual({});
        expect(sanitizeThemeConfig({ lockBrand: true, autoFixContrast: false })).toEqual({ lockBrand: true, autoFixContrast: false });
    });
});

describe('sanitizeThemeConfig: retrocompatibilidad', () => {
    it('una config antigua se conserva tal cual (colores normalizados) y es idempotente', () => {
        const old = {
            primaryColor: '#000000', secondaryColor: '#ffffff', backgroundColor: '#f9fafb', textColor: '#111827', accentColor: '#4f46e5',
            mutedColor: '#F3F4F6', borderColor: '#e5e7eb', cardColor: '#fff', inputColor: '#9ca3af', ringColor: '#2563EB',
            primaryForeground: '#ffffff', titleFont: 'Inter', bodyFont: 'Inter',
        };
        const clean = sanitizeThemeConfig(old);
        expect(clean).toEqual({ ...old, mutedColor: '#f3f4f6', cardColor: '#ffffff', ringColor: '#2563eb' });
        expect(sanitizeThemeConfig(clean)).toEqual(clean);
        expect(hasBrandConfig(clean)).toBe(true);
    });
    it('hasBrandConfig: false sin colores (radio/fuente/modo no cuentan)', () => {
        expect(hasBrandConfig({})).toBe(false);
        expect(hasBrandConfig(null)).toBe(false);
        expect(hasBrandConfig({ radius: 'lg', fontFamily: 'serif', defaultMode: 'dark' })).toBe(false);
        expect(hasBrandConfig({ palette: { dark: { primary: '#123456' } } })).toBe(true);
    });
});

describe('sanitizeThemeConfig: landing (clave reservada)', () => {
    it('se preserva como objeto plano JSON-seguro, sin claves peligrosas', () => {
        const cfg = sanitizeThemeConfig(JSON.parse('{"landing":{"title":"Hola","nested":{"a":[1,"b",null],"__proto__":{"x":1}},"n":NaN}}'.replace('NaN', '1')));
        expect(cfg.landing).toEqual({ title: 'Hola', nested: { a: [1, 'b', null] }, n: 1 });
    });
    it('rechaza landing que no es objeto, o > 32 KB', () => {
        expect(sanitizeThemeConfig({ landing: 'x' }).landing).toBeUndefined();
        expect(sanitizeThemeConfig({ landing: [1] }).landing).toBeUndefined();
        expect(sanitizeThemeConfig({ landing: { t: 'x'.repeat(40_000) } }).landing).toBeUndefined();
    });
    it('delega en sanitizeLanding si se inyecta', () => {
        const cfg = sanitizeThemeConfig({ landing: { a: 1, b: 2 } }, { sanitizeLanding: (v) => ({ only: Object.keys(v as object).length }) });
        expect(cfg.landing).toEqual({ only: 2 });
        expect(sanitizeThemeConfig({ landing: { a: 1 } }, { sanitizeLanding: () => { throw new Error('x'); } }).landing).toBeUndefined();
    });
});

describe('paridad frontend <-> backend', () => {
    it('vectores de oro: mismo resultado que el fixture compartido con el backend', () => {
        for (const v of golden as unknown as { input?: unknown; inputRaw?: string; expected: unknown }[]) {
            // inputRaw: JSON con claves peligrosas (__proto__) que un import de JSON convertiria en prototipo.
            const input = v.inputRaw !== undefined ? JSON.parse(v.inputRaw) : v.input;
            expect(sanitizeThemeConfig(input)).toEqual(v.expected);
        }
    });
    it('theme-config.ts es identico al del backend (si el repo hermano esta presente)', () => {
        const backend = join(__dirname, '..', '..', '..', '..', 'bloomx-backend', 'src', 'lib', 'theme-config.ts');
        if (!existsSync(backend)) return;
        const norm = (s: string) => s.replace(/\r\n/g, '\n');
        const mine = readFileSync(join(__dirname, '..', 'theme-config.ts'), 'utf8');
        expect(norm(readFileSync(backend, 'utf8'))).toBe(norm(mine));
    });
});
