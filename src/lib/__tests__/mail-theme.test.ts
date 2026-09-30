import { describe, expect, it } from 'vitest';
import { contrast } from '@/lib/color';
import { BRAND_FIXTURES } from '@/lib/theme-fixtures';
import { buildBrandThemes } from '@/lib/brand-theme';
import { buildMailThemeCss, deriveMailDark, deriveMailPaper, MAIL_FALLBACK_DARK, MAIL_FALLBACK_LIGHT, type MailThemeTokens } from '@/lib/mail-theme';

function tokensOf(t: Record<string, string>): MailThemeTokens {
    return { background: t.background, foreground: t.foreground, link: t.link ?? t.primary, warning: t.warning };
}

const cases: Array<[string, MailThemeTokens, 'light' | 'dark']> = [
    ['fallback claro', MAIL_FALLBACK_LIGHT, 'light'],
    ['fallback oscuro', MAIL_FALLBACK_DARK, 'dark'],
];
for (const fx of Object.values(BRAND_FIXTURES).slice(0, 12) as unknown[]) {
    const themes = buildBrandThemes(fx as never);
    if (!themes) continue;
    cases.push([`empresa claro`, tokensOf(themes.light.tokens as never), 'light']);
    cases.push([`empresa oscuro`, tokensOf(themes.dark.tokens as never), 'dark']);
}

describe('mail-theme: papel derivado de tokens', () => {
    it.each(cases)('%s: texto >= 4.5, enlace >= 4.5 y chips legibles sobre el papel', (_n, t, scheme) => {
        const p = deriveMailPaper(t, scheme);
        expect(contrast(p.text, p.paper)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.link, p.paper)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.chipText, p.chip)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.warnText, p.warnBg)).toBeGreaterThanOrEqual(4.5);
    });

    it('tema oscuro en modo paper: papel claro con matiz del fondo', () => {
        const p = deriveMailPaper(MAIL_FALLBACK_DARK, 'dark');
        expect(contrast(p.paper, '#ffffff')).toBeLessThan(1.15);
    });

    it('tema claro usa el fondo del tema como papel', () => {
        const t = { ...MAIL_FALLBACK_LIGHT, background: '#faf5ff' };
        expect(deriveMailPaper(t, 'light').paper).toBe('#faf5ff');
    });

    it('CSS: variables --bx-* y sin colores del correo', () => {
        const css = buildMailThemeCss(MAIL_FALLBACK_LIGHT, 'light', false);
        expect(css).toContain('--bx-paper');
        expect(css).toContain('--bx-link');
        expect(css).not.toContain('filter: invert');
    });

    it('CSS invert: colores pre-invertidos y filtro solo en tema oscuro', () => {
        const dark = buildMailThemeCss(MAIL_FALLBACK_DARK, 'dark', true);
        expect(dark).toContain('filter: invert(1) hue-rotate(180deg)');
        // el papel emitido es el inverso del fondo del tema (tras el filtro vuelve al fondo)
        const p = deriveMailDark(MAIL_FALLBACK_DARK);
        expect(dark).toContain(`background: #${(0xffffff - parseInt(p.paper.slice(1), 16)).toString(16).padStart(6, '0')}`);
        expect(buildMailThemeCss(MAIL_FALLBACK_LIGHT, 'light', true)).not.toContain('filter: invert');
    });

    it('todo valor emitido es hex validado (seguro para <style>)', () => {
        const css = buildMailThemeCss({ background: '#123456', foreground: '#abcdef', link: '#0000ff', warning: '#ffaa00' }, 'dark', false);
        const vals = [...css.matchAll(/--bx-[a-z-]+: ([^;]+);/g)].map((m) => m[1]);
        expect(vals.length).toBeGreaterThan(8);
        vals.forEach((v) => expect(v).toMatch(/^#[0-9a-f]{6}$/));
    });
});
