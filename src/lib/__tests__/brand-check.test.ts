import { describe, expect, it } from 'vitest';
import { analyzeBrand, brandWarnings } from '../brand-check';
import { contrast, hslToHex } from '../color';
import { DARK_ACCENT_SHADES, HUES, THEMES, applyBrand, buildThemeCss, getTheme } from '../themes';

describe('analyzeBrand / brandWarnings (aviso de contraste en el panel admin)', () => {
    it('un color de marca que ya cumple no genera avisos', () => {
        const issues = analyzeBrand({ primaryColor: '#111827', accentColor: '#4338ca' });
        expect(issues.length).toBe(2);
        expect(brandWarnings({ primaryColor: '#111827', accentColor: '#4338ca' })).toHaveLength(0);
        for (const i of issues) expect(i.corrected).toBe(false);
    });

    it('un primario claro se marca, se corrige y el color aplicado SI cumple AA', () => {
        const warns = brandWarnings({ primaryColor: '#ffb6c1' });
        expect(warns).toHaveLength(1);
        const w = warns[0];
        expect(w.field).toBe('primaryColor');
        expect(w.ok).toBe(false);
        expect(w.corrected).toBe(true);
        expect(w.chosenRatio).toBeLessThan(4.5);
        expect(w.appliedRatio).toBeGreaterThanOrEqual(4.5);
        expect(w.applied).not.toBe(w.chosen);
    });

    it('inputColor y ringColor propios se evaluan a 3:1 y se corrigen', () => {
        const warns = brandWarnings({ ringColor: '#dddddd', inputColor: '#eeeeee' });
        const fields = warns.map((w) => w.field).sort();
        expect(fields).toEqual(['inputColor', 'ringColor']);
        for (const w of warns) {
            expect(w.min).toBe(3);
            expect(w.appliedRatio).toBeGreaterThanOrEqual(3);
        }
    });

    it('ignora campos vacios o invalidos (no hay "auto" que avisar)', () => {
        expect(analyzeBrand({ ringColor: '', inputColor: 'no-es-hex' } as any)).toHaveLength(0);
    });

    it('applyBrand aplica ringColor/inputColor aunque no haya primario ni fondo', () => {
        const light = getTheme('light')!;
        const out = applyBrand(light, { ringColor: '#7c3aed', inputColor: '#6b7280' });
        expect(out.ring).toBe('#7c3aed');
        expect(contrast(out.input!, light.tokens.background)).toBeGreaterThanOrEqual(3);
    });
});

describe('remapeo de escalas 500/600 en temas oscuros', () => {
    it('el CSS de temas emite 500 y 600 aclarados para todos los tonos', () => {
        const css = buildThemeCss();
        for (const name of Object.keys(HUES)) {
            expect(css).toContain(`--color-${name}-500:hsl(`);
            expect(css).toContain(`--color-${name}-600:hsl(`);
        }
    });

    it('esos tonos se leen (>= 4.5) sobre fondo, tarjeta y muted de cada tema oscuro', () => {
        for (const theme of THEMES.filter((t) => t.scheme === 'dark')) {
            for (const shade of [500, 600] as const) {
                const { s, l } = DARK_ACCENT_SHADES[shade];
                for (const [name, h] of Object.entries(HUES)) {
                    const color = hslToHex(h, s, l);
                    for (const surface of ['background', 'card', 'muted'] as const) {
                        const ratio = contrast(color, theme.tokens[surface]);
                        expect(ratio, `${theme.id} ${name}-${shade} sobre ${surface}`).toBeGreaterThanOrEqual(4.5);
                    }
                }
            }
        }
    });
});
