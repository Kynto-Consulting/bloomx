import { describe, expect, it } from 'vitest';
import { contrast } from '@/lib/color';
import { BRAND_FIXTURES } from '@/lib/theme-fixtures';
import { buildBrandThemes } from '@/lib/brand-theme';
import { MAIL_TYPOGRAPHY_CSS, afterInvertFilter, preInvert, buildMailThemeCss, deriveMailDark, deriveMailPaper, MAIL_FALLBACK_DARK, MAIL_FALLBACK_LIGHT, type MailThemeTokens } from '@/lib/mail-theme';

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
        expect(dark).toContain(`background: ${preInvert(p.paper)}`);
        expect(buildMailThemeCss(MAIL_FALLBACK_LIGHT, 'light', true)).not.toContain('filter: invert');
    });

    it('todo valor emitido es hex validado (seguro para <style>)', () => {
        const css = buildMailThemeCss({ background: '#123456', foreground: '#abcdef', link: '#0000ff', warning: '#ffaa00' }, 'dark', false);
        const vals = [...css.matchAll(/--bx-[a-z-]+: ([^;]+);/g)].map((m) => m[1]);
        expect(vals.length).toBeGreaterThan(8);
        vals.forEach((v) => expect(v).toMatch(/^#[0-9a-f]{6}$/));
    });
});

describe('mail-theme: estilo tipografico base del cuerpo', () => {
    it.each(cases)('%s: muted, enlace hover y codigo legibles', (_n, t, scheme) => {
        const p = deriveMailPaper(t, scheme);
        expect(contrast(p.muted, p.paper)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.linkHover, p.paper)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.text, p.codeBg)).toBeGreaterThanOrEqual(4.5);
        expect(p.border).not.toBe(p.paper);
    });

    it('pila del sistema (sin fuentes web), 15px, interlineado 1.6', () => {
        expect(MAIL_TYPOGRAPHY_CSS).toMatch(/font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif/);
        expect(MAIL_TYPOGRAPHY_CSS).toMatch(/font-size: 15px; line-height: 1\.6/);
        expect(MAIL_TYPOGRAPHY_CSS).not.toMatch(/@import|@font-face|url\(/);
    });

    it('enlaces con token y sin subrayado permanente (subrayado al hover/foco)', () => {
        expect(MAIL_TYPOGRAPHY_CSS).toMatch(/a \{ color: var\(--bx-link\); text-decoration: none;/);
        expect(MAIL_TYPOGRAPHY_CSS).toMatch(/a:hover, a:focus-visible \{ color: var\(--bx-link-hover\); text-decoration: underline;/);
    });

    it('citas anidadas: borde de token, atenuadas desde el nivel 2 y sangria acotada a 3 niveles', () => {
        expect(MAIL_TYPOGRAPHY_CSS).toMatch(/border-left: 3px solid var\(--bx-quote\) !important/);
        expect(MAIL_TYPOGRAPHY_CSS).toMatch(/blockquote blockquote \{ color: var\(--bx-muted\); \}/);
        expect(MAIL_TYPOGRAPHY_CSS).toMatch(/blockquote blockquote blockquote blockquote \{ margin-left: 0 !important; padding-left: 0 !important/);
    });

    it('titulos, listas, codigo, imagenes, tablas y firma estan estilizados', () => {
        for (const frag of ['h1 { font-size: 1.6em; }', 'ul, ol {', 'pre {', 'overflow-x: auto', 'img { max-width: 100%; height: auto; border-radius: 4px; }', 'hr {', '.gmail_signature {', '.gmail_attr']) {
            expect(MAIL_TYPOGRAPHY_CSS).toContain(frag);
        }
    });

    it('el estilo base no contiene colores literales: todo va por variables --bx-*', () => {
        expect(MAIL_TYPOGRAPHY_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![\w-])/);
        expect(MAIL_TYPOGRAPHY_CSS).not.toMatch(/\brgba?\(|\bhsla?\(/);
    });

    it('tema oscuro en modo papel: hoja con margen interior; tema claro: sin margen', () => {
        expect(buildMailThemeCss(MAIL_FALLBACK_DARK, 'dark', false)).toContain('#content { padding: 16px 18px; }');
        expect(buildMailThemeCss(MAIL_FALLBACK_LIGHT, 'light', false)).not.toContain('padding: 16px 18px');
    });

    it('usa --link-hover del tema cuando existe', () => {
        const p = deriveMailPaper({ ...MAIL_FALLBACK_LIGHT, linkHover: '#1e3a8a' }, 'light');
        expect(p.linkHover).toBe('#1e3a8a');
    });
});

describe('mail-theme: modo oscurecer (invert + hue-rotate) conserva el matiz', () => {
    const near = (a: string, b: string, tol = 6) => [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= tol);
    it('el fondo azul marino del tema vuelve a ser azul marino tras el filtro (antes salia amarillento)', () => {
        const bg = '#0b1220';
        expect(near(afterInvertFilter(preInvert(bg)), bg)).toBe(true);
    });
    it.each(cases.filter(([, , s]) => s === 'dark'))('%s: papel, texto y enlace tras el filtro coinciden con la paleta y son legibles', (_n, t) => {
        const p = deriveMailDark(t);
        const seen = (hex: string) => afterInvertFilter(preInvert(hex));
        expect(near(seen(p.paper), p.paper, 10)).toBe(true);
        expect(contrast(seen(p.text), seen(p.paper))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(seen(p.link), seen(p.paper))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(seen(p.muted), seen(p.paper))).toBeGreaterThanOrEqual(3.5);
    });
});
