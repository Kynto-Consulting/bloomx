import { describe, expect, it } from 'vitest';
import fixture from './fixtures/ulima-domain-config.json';
import { contrast } from '../color';
import { sanitizeThemeConfig } from '../theme-config';
import { CONTRAST_REQUIREMENTS, getAvailableThemeIds, getThemePolicy, resolvePreference, THEME_IDS } from '../themes';
import { buildBrandCss, buildBrandThemes } from '../brand-theme';

/** Configuracion REAL de produccion (ulima.dev): sin palette/logo/landing y con valores problematicos. */
const rawTheme = fixture.config.theme;

describe('config real de ulima.dev (campos antiguos y valores problematicos)', () => {
    it('(1) no lanza en ninguna etapa (sanear, temas, CSS, politica)', () => {
        expect(() => sanitizeThemeConfig(rawTheme)).not.toThrow();
        expect(() => buildBrandThemes(rawTheme, { name: fixture.config.displayName })).not.toThrow();
        expect(() => buildBrandCss(rawTheme, { name: fixture.config.displayName })).not.toThrow();
        expect(() => getThemePolicy(rawTheme)).not.toThrow();
    });

    it('el saneado conserva todos los campos antiguos validos (sin inventar nada nuevo)', () => {
        const clean = sanitizeThemeConfig(rawTheme);
        expect(clean).toEqual(rawTheme);
        expect(clean.palette).toBeUndefined();
        expect(clean.landing).toBeUndefined();
    });

    const bt = buildBrandThemes(rawTheme, { name: fixture.config.displayName })!;

    it('(2) todos los pares de contraste clave cumplen AA en brand-light y en brand-dark (derivado)', () => {
        expect(bt).not.toBeNull();
        expect(bt.derived).toEqual({ light: false, dark: true });
        for (const th of bt.list) {
            for (const r of CONTRAST_REQUIREMENTS) {
                expect(contrast(th.tokens[r.fg], th.tokens[r.on]), `${th.id}: ${r.label}`).toBeGreaterThanOrEqual(r.min);
            }
        }
    });

    it('(3) borde y muted quedan distinguibles del fondo (no blanco sobre blanco)', () => {
        for (const th of bt.list) {
            const t = th.tokens;
            expect(t.border, th.id).not.toBe(t.background);
            expect(contrast(t.border, t.background), `${th.id} borde`).toBeGreaterThanOrEqual(1.12);
            expect(t.muted, th.id).not.toBe(t.background);
            expect(contrast(t.muted, t.background), `${th.id} muted`).toBeGreaterThanOrEqual(1.03);
        }
        // Y se avisa de la sustitucion.
        const invisible = bt.warnings.filter((w) => w.reason === 'invisible' && w.mode === 'light').map((w) => w.token).sort();
        expect(invisible).toEqual(['border', 'muted']);
    });

    it('respeta la marca real: primario/acento/fondo/texto, y el secundario propio', () => {
        const t = bt.light.tokens;
        expect(t.primary).toBe('#4f46e5');
        expect(t.background).toBe('#ffffff');
        expect(t.foreground).toBe('#111827');
        expect(t.secondary).toBe('#7f5757');
        expect(contrast(t['secondary-foreground'], t.secondary)).toBeGreaterThanOrEqual(4.5);
    });

    it('(4) las fuentes Inter se conservan (lista blanca, titulo y cuerpo)', () => {
        const clean = sanitizeThemeConfig(rawTheme);
        expect(clean.titleFont).toBe('Inter');
        expect(clean.bodyFont).toBe('Inter');
        const css = buildBrandCss(rawTheme);
        expect(css).toContain('--font-body:"Inter",system-ui,sans-serif');
        expect(css).toContain('--font-title:"Inter",system-ui,sans-serif');
    });

    it('la instancia sigue funcionando sin configurar nada nuevo: ofrece temas de empresa + los genericos, default system', () => {
        const policy = getThemePolicy(rawTheme);
        expect(policy).toMatchObject({ brand: true, defaultMode: 'system', allowed: null, lock: false });
        const ids = getAvailableThemeIds(policy);
        expect(ids.slice(0, 2)).toEqual(['brand-light', 'brand-dark']);
        for (const id of THEME_IDS.filter((x) => x !== 'light' && x !== 'dark')) expect(ids).toContain(id);
        expect(resolvePreference(null, policy)).toBe('system');
        // Quien tenia guardado "dark" sigue en oscuro (ahora el de la empresa).
        expect(resolvePreference('dark', policy)).toBe('brand-dark');
    });
});
