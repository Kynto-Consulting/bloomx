import { describe, expect, it } from 'vitest';
import {
    BRAND_THEME_IDS, DEFAULT_THEME_POLICY, THEMES, THEME_COOKIE, THEME_IDS, buildBootScript, fallbackThemeId,
    getAvailableThemeIds, getThemePolicy, getThemeScheme, isThemePreference, resolvePreference, resolveTheme,
    resolveThemeId, type ThemePolicy,
} from '../themes';
import { buildBrandThemes, getSelectableThemes } from '../brand-theme';
import type { DomainThemeConfig } from '../theme-config';

const BRAND: DomainThemeConfig = { primaryColor: '#7c3aed', backgroundColor: '#faf5ff' };

describe('sin config de empresa todo se comporta como hoy (fallback a los 8 temas)', () => {
    it('politica por defecto: 8 temas, sin empresa, system', () => {
        for (const cfg of [null, undefined, {}, 'basura', { radius: 'lg' }, { fontFamily: 'serif', defaultMode: 'system' }]) {
            const p = getThemePolicy(cfg);
            expect(p.brand).toBe(false);
            expect(p.lock).toBe(false);
            expect(getAvailableThemeIds(p)).toEqual(THEME_IDS);
        }
        expect(getAvailableThemeIds()).toEqual(THEMES.map((t) => t.id));
        expect(THEMES).toHaveLength(8);
        expect(getSelectableThemes(null, DEFAULT_THEME_POLICY).map((t) => t.id)).toEqual(THEME_IDS);
    });
    it('resolvePreference / resolveThemeId reproducen resolveTheme historico', () => {
        for (const dark of [false, true]) {
            expect(resolveThemeId('system', dark)).toBe(resolveTheme('system', dark).id);
            for (const id of THEME_IDS) expect(resolveThemeId(id, dark)).toBe(id);
        }
        expect(resolvePreference(null)).toBe('system');
        expect(resolvePreference('midnight')).toBe('midnight');
        expect(resolvePreference('basura')).toBe('system');
    });
    it('los temas de empresa son preferencias validas; un id de empresa sin marca cae al generico del mismo esquema', () => {
        for (const id of BRAND_THEME_IDS) expect(isThemePreference(id)).toBe(true);
        expect(resolvePreference('brand-dark')).toBe('dark');
        expect(resolvePreference('brand-light')).toBe('light');
        expect(getThemeScheme('brand-dark')).toBe('dark');
        expect(getThemeScheme('ocean')).toBe('light');
        expect(getThemeScheme('nope')).toBeUndefined();
    });
});

describe('empresa con colores: temas de primera clase', () => {
    const policy = getThemePolicy(BRAND);
    it('aparecen primero y los genericos Claro/Oscuro se ocultan (los sustituyen)', () => {
        expect(policy.brand).toBe(true);
        const ids = getAvailableThemeIds(policy);
        expect(ids.slice(0, 2)).toEqual(['brand-light', 'brand-dark']);
        expect(ids).not.toContain('light');
        expect(ids).not.toContain('dark');
        expect(ids).toContain('midnight');
        const list = getSelectableThemes(buildBrandThemes(BRAND, { name: 'Acme' }), policy);
        expect(list.map((t) => t.id).slice(0, 2)).toEqual(['brand-light', 'brand-dark']);
        expect(list[0].label).toContain('Acme');
    });
    it('una preferencia antigua "dark"/"light" se remapea a la de empresa del mismo esquema', () => {
        expect(resolvePreference('dark', policy)).toBe('brand-dark');
        expect(resolvePreference('light', policy)).toBe('brand-light');
        expect(resolvePreference('ocean', policy)).toBe('ocean');
        expect(resolveThemeId('system', true, policy)).toBe('brand-dark');
        expect(resolveThemeId('system', false, policy)).toBe('brand-light');
    });
    it('defaultMode manda cuando el usuario no eligio; system sigue al SO', () => {
        const dark = getThemePolicy({ ...BRAND, defaultMode: 'dark' });
        const light = getThemePolicy({ ...BRAND, defaultMode: 'light' });
        expect(resolvePreference(null, dark)).toBe('brand-dark');
        expect(resolvePreference(null, light)).toBe('brand-light');
        expect(resolvePreference(null, policy)).toBe('system');
        // Una eleccion explicita del usuario gana sobre el defecto.
        expect(resolvePreference('brand-light', dark)).toBe('brand-light');
        expect(resolvePreference('system', dark)).toBe('system');
        expect(resolveThemeId('system', true, dark)).toBe('brand-dark');
    });
    it('defaultMode sin colores de empresa usa el generico del esquema', () => {
        const p = getThemePolicy({ defaultMode: 'dark' });
        expect(resolvePreference(null, p)).toBe('dark');
    });
});

describe('allowedThemes y lockBrand', () => {
    it('allowedThemes filtra los genericos (vacio = todos; ids desconocidos se ignoran)', () => {
        const p = getThemePolicy({ ...BRAND, allowedThemes: ['ocean', 'amoled', 'no-existe'] });
        expect(getAvailableThemeIds(p)).toEqual(['brand-light', 'brand-dark', 'amoled', 'ocean']);
        expect(getThemePolicy({ ...BRAND, allowedThemes: [] }).allowed).toBeNull();
        expect(getThemePolicy({ ...BRAND, allowedThemes: ['no-existe'] }).allowed).toBeNull();
    });
    it('allowedThemes puede volver a listar light/dark expresamente', () => {
        const p = getThemePolicy({ ...BRAND, allowedThemes: ['light', 'dark'] });
        expect(getAvailableThemeIds(p)).toEqual(['brand-light', 'brand-dark', 'light', 'dark']);
    });
    it('una preferencia no permitida cae al tema de su esquema', () => {
        const p = getThemePolicy({ ...BRAND, allowedThemes: ['ocean'] });
        expect(resolvePreference('rose', p)).toBe('brand-light');
        expect(resolvePreference('midnight', p)).toBe('brand-dark');
    });
    it('sin empresa, allowedThemes restringe y el fallback usa un permitido del mismo esquema', () => {
        const p = getThemePolicy({ allowedThemes: ['ocean', 'amoled'] });
        expect(getAvailableThemeIds(p)).toEqual(['amoled', 'ocean']);
        expect(resolveThemeId('system', true, p)).toBe('amoled');
        expect(resolveThemeId('system', false, p)).toBe('ocean');
        expect(resolvePreference('dark', p)).toBe('amoled');
    });
    it('lockBrand: solo los temas de empresa; todo lo demas se remapea', () => {
        const p = getThemePolicy({ ...BRAND, lockBrand: true, allowedThemes: ['ocean'] });
        expect(p.lock).toBe(true);
        expect(getAvailableThemeIds(p)).toEqual(['brand-light', 'brand-dark']);
        expect(resolvePreference('ocean', p)).toBe('brand-light');
        expect(resolvePreference('amoled', p)).toBe('brand-dark');
        expect(resolvePreference('system', p)).toBe('system');
    });
    it('lockBrand sin colores de empresa se ignora (no se puede bloquear a nada)', () => {
        const p = getThemePolicy({ lockBrand: true });
        expect(p.lock).toBe(false);
        expect(getAvailableThemeIds(p)).toEqual(THEME_IDS);
    });
});

/** Ejecuta el script bloqueante con un DOM simulado y devuelve los atributos que fijo. */
function runBoot(policy: ThemePolicy, opts: { cookie?: string; ls?: string; dark?: boolean; noMatchMedia?: boolean }) {
    const attrs: Record<string, string> = {};
    const style: Record<string, string> = {};
    const doc = { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; }, style }, cookie: opts.cookie !== undefined ? `${THEME_COOKIE}=${encodeURIComponent(opts.cookie)}; other=1` : 'other=1' };
    const win = opts.noMatchMedia ? {} : { matchMedia: () => ({ matches: !!opts.dark }) };
    const ls = { getItem: () => (opts.ls ?? null) };
    new Function('document', 'window', 'localStorage', buildBootScript(policy))(doc, win, ls);
    return { attrs, style };
}

describe('script bloqueante: paridad con resolvePreference/resolveThemeId', () => {
    const policies: Record<string, ThemePolicy> = {
        'sin empresa': DEFAULT_THEME_POLICY,
        'empresa system': getThemePolicy(BRAND),
        'empresa dark': getThemePolicy({ ...BRAND, defaultMode: 'dark' }),
        'empresa light + permitidos': getThemePolicy({ ...BRAND, defaultMode: 'light', allowedThemes: ['ocean', 'amoled'] }),
        'empresa lock': getThemePolicy({ ...BRAND, lockBrand: true }),
        'sin empresa + permitidos': getThemePolicy({ allowedThemes: ['ocean', 'amoled'] }),
    };
    const stored: (string | undefined)[] = [undefined, 'system', 'light', 'dark', 'ocean', 'amoled', 'rose', 'brand-light', 'brand-dark', 'basura'];

    for (const [name, policy] of Object.entries(policies)) {
        it(`${name}: cookie y localStorage, con SO claro y oscuro`, () => {
            for (const s of stored) {
                for (const dark of [false, true]) {
                    for (const source of ['cookie', 'ls'] as const) {
                        const { attrs, style } = runBoot(policy, { dark, ...(source === 'cookie' ? { cookie: s } : { ls: s }) });
                        const pref = resolvePreference(s ?? null, policy);
                        const id = resolveThemeId(pref, dark, policy);
                        const label = `${name} stored=${s} dark=${dark} via=${source}`;
                        expect(attrs['data-theme-pref'], label).toBe(pref);
                        expect(attrs['data-theme'], label).toBe(id);
                        expect(attrs['data-scheme'], label).toBe(getThemeScheme(id));
                        expect(style.colorScheme, label).toBe(getThemeScheme(id));
                    }
                }
            }
        });
    }
    it('sin matchMedia y sin preferencia no lanza y elige el claro', () => {
        const { attrs } = runBoot(DEFAULT_THEME_POLICY, { noMatchMedia: true });
        expect(attrs['data-theme']).toBe('light');
    });
    it('fallbackThemeId es coherente con el script', () => {
        expect(fallbackThemeId('dark', getThemePolicy(BRAND))).toBe('brand-dark');
        expect(fallbackThemeId('light')).toBe('light');
    });
});
