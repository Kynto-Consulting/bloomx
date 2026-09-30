/**
 * CONTRASTE GARANTIZADO del kit: cada par (texto, fondo) que pinta el kit (TONE_PAIRS en kit/tokens.ts) cumple su
 * razon WCAG en los 8 temas genericos y en TODAS las paletas de empresa de prueba (claro y oscuro).
 * Si un tema nuevo rompe un par, este test lo dice con el nombre del par.
 */
import { describe, expect, it } from 'vitest';
import { THEMES } from '@/lib/themes';
import { BRAND_FIXTURES } from '@/lib/theme-fixtures';
import { buildBrandThemes } from '@/lib/brand-theme';
import { contrast, mix } from '@/lib/color';
import { TONE_PAIRS, TONE_SOFT, TONE_SOLID, TONE_TEXT, TONE_OUTLINE, buttonClasses, type Tone } from '../tokens';
import { TONES } from '@/lib/expansions/ui-schema';
import type { ThemeTokens } from '@/lib/themes';

function failuresFor(tokens: ThemeTokens): string[] {
    const out: string[] = [];
    for (const pair of TONE_PAIRS) {
        const fg = tokens[pair.fg];
        let bg = tokens[pair.bg];
        if (pair.blend) bg = mix(tokens[pair.blend.over], bg, pair.blend.alpha);
        const ratio = contrast(fg, bg);
        if (ratio < pair.min) out.push(`${pair.name}: ${ratio.toFixed(2)} < ${pair.min}`);
    }
    return out;
}

describe('contraste del kit', () => {
    describe.each(THEMES.map((t) => [t.id, t] as const))('tema generico %s', (_id, theme) => {
        it('todos los pares texto/fondo del kit cumplen su razon WCAG', () => {
            expect(failuresFor(theme.tokens)).toEqual([]);
        });
    });

    describe.each(Object.keys(BRAND_FIXTURES))('paleta de empresa "%s"', (name) => {
        const themes = buildBrandThemes(BRAND_FIXTURES[name]);
        it.each(['light', 'dark'] as const)('modo %s', (mode) => {
            expect(themes).toBeTruthy();
            expect(failuresFor(themes![mode].tokens)).toEqual([]);
        });
    });

    it('cada tono tiene clases completas en todos los mapas y usan solo tokens (nada de paleta cruda)', () => {
        for (const tone of TONES as readonly Tone[]) {
            for (const map of [TONE_TEXT, TONE_SOLID, TONE_SOFT, TONE_OUTLINE]) {
                expect(map[tone], `${tone}`).toBeTruthy();
                expect(map[tone]).not.toMatch(/\b(?:gray|slate|zinc|blue|red|green|amber|yellow|white|black)\b/);
            }
        }
        for (const variant of ['solid', 'soft', 'outline', 'ghost', 'link'] as const) {
            for (const tone of TONES as readonly Tone[]) {
                expect(buttonClasses({ tone, variant })).toMatch(/focus-visible:ring-ring/);
            }
        }
    });
});
