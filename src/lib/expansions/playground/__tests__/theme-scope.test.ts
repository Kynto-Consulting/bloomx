import { describe, expect, it } from 'vitest';
import { THEMES } from '@/lib/themes';
import { TOKEN_KEYS } from '@/lib/theme-config';
import { BRAND_FIXTURES } from '@/lib/theme-fixtures';
import { RAW_CLASS, RAW_LITERAL } from '@/lib/__tests__/helpers/raw-colors';
import { fixtureThemeId, galleryThemeIds, listThemeChoices, resolveThemeChoice, themeStyle, themeVariables } from '../theme-scope';

describe('theme-scope (logica pura)', () => {
    const choices = listThemeChoices({ primaryColor: '#7c3aed', radius: 'lg', fontFamily: 'serif' }, 'Acme');

    it('incluye los 8 genericos, las paletas de prueba (claro/oscuro) y la empresa real', () => {
        const ids = choices.map((c) => c.id);
        for (const t of THEMES) expect(ids).toContain(t.id);
        expect(THEMES).toHaveLength(8);
        for (const name of Object.keys(BRAND_FIXTURES)) {
            expect(ids).toContain(fixtureThemeId(name, 'light'));
            expect(ids).toContain(fixtureThemeId(name, 'dark'));
        }
        expect(ids).toContain('domain:light');
        expect(ids).toContain('domain:dark');
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('sin empresa real (o sin colores) no hay temas domain', () => {
        expect(listThemeChoices(null).some((c) => c.group === 'domain')).toBe(false);
        expect(listThemeChoices({}).some((c) => c.group === 'domain')).toBe(false);
    });

    it('resuelve ids y cae al claro si el id no existe', () => {
        expect(resolveThemeChoice('dark', choices).id).toBe('dark');
        expect(resolveThemeChoice('no-existe', choices).id).toBe('light');
        expect(resolveThemeChoice(null, choices).id).toBe('light');
    });

    it('tema generico -> una variable --color-<token> por cada token, sin radio ni fuente', () => {
        const vars = themeVariables(resolveThemeChoice('midnight', choices));
        for (const token of TOKEN_KEYS) expect(vars[`--color-${token}`], token).toBeTruthy();
        expect(vars['--radius']).toBeUndefined();
        expect(vars['--font-body']).toBeUndefined();
        expect(Object.keys(vars).every((k) => k.startsWith('--color-'))).toBe(true);
    });

    it('empresa: radio y fuente de la lista blanca', () => {
        const vars = themeVariables(resolveThemeChoice('domain:dark', choices));
        expect(vars['--radius']).toBe('0.75rem');
        expect(vars['--font-body']).toContain('serif');
        expect(vars['--color-primary']).toMatch(/^#[0-9a-f]{6}$/);
    });

    it('color-scheme sigue al esquema del tema y el estilo solo usa var(--color-*)', () => {
        expect(themeStyle(resolveThemeChoice('dark', choices)).colorScheme).toBe('dark');
        expect(themeStyle(resolveThemeChoice('light', choices)).colorScheme).toBe('light');
        expect(themeStyle(resolveThemeChoice(fixtureThemeId('pastel', 'dark'), choices)).colorScheme).toBe('dark');
        const style = themeStyle(resolveThemeChoice('light', choices));
        expect(style.backgroundColor).toBe('var(--color-background)');
        expect(style.color).toBe('var(--color-foreground)');
    });

    it('vista "todos los temas": 8 genericos + 3 paletas x 2 modos, sin ids inexistentes', () => {
        const ids = galleryThemeIds(choices);
        expect(ids).toHaveLength(14);
        for (const id of ids) expect(choices.some((c) => c.id === id)).toBe(true);
    });

    it('fuera de los tokens, el estilo no contiene colores crudos', () => {
        const style = JSON.stringify(themeStyle(resolveThemeChoice('light', choices)));
        const noTokens = style.replace(/"--color-[a-z-]+":"[^"]*"/g, '');
        expect(noTokens.match(RAW_LITERAL) ?? []).toEqual([]);
        expect(noTokens.match(RAW_CLASS) ?? []).toEqual([]);
    });
});
