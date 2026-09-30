/**
 * Compatibilidad de clientes de correo (Gmail, Outlook de escritorio, Apple Mail, Yahoo) y legibilidad en modo oscuro sobre
 * TODAS las variantes x idiomas x marcas x (con/sin logo) x (claro / oscuro forzado). Una violacion `error` rompe el test.
 * Las reglas y el modelo de inversion estan documentados en ../email-lint.ts.
 */
import { describe, expect, it } from 'vitest';
import { contrast } from '@/lib/color';
import {
    DARK_MIN_RATIO,
    EMAIL_LINT_RULES,
    darkClassOverrides,
    flipLightness,
    issuesByClient,
    lintDarkMode,
    lintEmailHtml,
    parseEmailHtml,
    resolveTextPairs,
    simulateAutoInversion,
    simulateInvertedHtml,
    type LintIssue,
} from '../email-lint';
import { SAMPLE_BRANDS, SAMPLE_VARIANTS, buildSampleHtml, sampleBrand } from '../email-samples';
import { renderInviteEmailHtml } from '../invite-template.js';

const LOCALES = ['es', 'en'] as const;
const errors = (issues: LintIssue[]) => issues.filter((i) => i.severity === 'error');
const fmt = (issues: LintIssue[]) => issues.map((i) => `${i.rule}: ${i.message} :: ${i.snippet}`).join('\n');

describe('reglas documentadas', () => {
    it('cada regla tiene severidad, clientes y al menos una referencia caniemail; los ids son unicos', () => {
        const ids = EMAIL_LINT_RULES.map((r) => r.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const r of EMAIL_LINT_RULES) {
            expect(r.clients.length, r.id).toBeGreaterThan(0);
            expect(r.caniemail.length, r.id).toBeGreaterThan(0);
            expect(r.summary.length, r.id).toBeGreaterThan(10);
        }
    });
});

describe('linter: detecta cada violacion (el HTML defectuoso NO pasa)', () => {
    const GOOD = buildSampleHtml({ variant: 'invitation-rich', brand: sampleBrand(SAMPLE_BRANDS[0]), locale: 'es' });
    const rulesOf = (html: string) => new Set(errors(lintEmailHtml(html)).map((i) => i.rule));
    const inject = (html: string, at: string, extra: string) => html.replace(at, at + extra);
    const inBody = (extra: string) => inject(GOOD, '<body class="bxm-page" bgcolor="#f3f4f6" style="margin:0;padding:0;background-color:#f3f4f6;">', extra);

    it('el HTML de referencia esta limpio', () => {
        expect(fmt(errors(lintEmailHtml(GOOD)))).toBe('');
    });

    const cases: Array<[string, string, string]> = [
        ['css-external', 'link stylesheet', '<link rel="stylesheet" href="https://x.example/a.css">'],
        ['forbidden-elements', 'script', '<script>alert(1)</script>'],
        ['forbidden-elements', 'form', '<form action="https://x.example"><input name="a"></form>'],
        ['forbidden-elements', 'svg', '<svg width="10" height="10"></svg>'],
        ['forbidden-elements', 'evento on*', '<p onclick="x()" style="font-family:Arial,Helvetica,sans-serif;color:#000000;">x</p>'],
        ['insecure-links', 'http', '<a href="http://x.example" style="color:#000000;font-family:Arial,Helvetica,sans-serif;">x</a>'],
        ['insecure-links', 'protocolo relativo', '<img src="//x.example/a.png" alt="x" width="10" height="10" border="0" style="display:block;border:0;">'],
        ['insecure-links', 'javascript', '<a href="javascript:alert(1)" style="color:#000000;font-family:Arial,Helvetica,sans-serif;">x</a>'],
        ['img-attrs', 'sin alt', '<img src="https://x.example/a.png" width="10" height="10" style="display:block;border:0;">'],
        ['img-attrs', 'sin tamaño', '<img src="https://x.example/a.png" alt="x" style="display:block;border:0;">'],
        ['img-attrs', 'sin display:block', '<img src="https://x.example/a.png" alt="x" width="10" height="10" style="border:0;">'],
        ['img-attrs', 'data uri', '<img src="data:image/png;base64,AAAA" alt="x" width="10" height="10" style="display:block;border:0;">'],
        ['layout-flex-grid', 'flex', '<div style="display:flex;font-family:Arial,Helvetica,sans-serif;">x</div>'],
        ['layout-flex-grid', 'grid', '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="display:grid;"><tr><td style="font-family:Arial,Helvetica,sans-serif;">x</td></tr></table>'],
        ['layout-flex-grid', 'gap', '<td style="gap:8px;font-family:Arial,Helvetica,sans-serif;">x</td>'],
        ['layout-position', 'absolute', '<div style="position:absolute;font-family:Arial,Helvetica,sans-serif;">x</div>'],
        ['layout-float', 'float', '<div style="float:left;font-family:Arial,Helvetica,sans-serif;">x</div>'],
        ['css-modern-unsupported', 'calc', '<div style="width:calc(100% - 10px);font-family:Arial,Helvetica,sans-serif;">x</div>'],
        ['css-modern-unsupported', 'var', '<div style="color:var(--x);font-family:Arial,Helvetica,sans-serif;">x</div>'],
        ['web-fonts', 'font-face', '<style>@font-face{font-family:X;src:url(https://x.example/x.woff)}</style>'],
        ['web-fonts', 'fuente web', '<p style="font-family:Inter,sans-serif;color:#000000;">x</p>'],
        ['web-fonts', 'sin generica', '<p style="font-family:Arial;color:#000000;">x</p>'],
        ['background-image-fallback', 'sin fallback', '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="background-image:url(https://x.example/a.png);"><tr><td style="font-family:Arial,Helvetica,sans-serif;">x</td></tr></table>'],
        ['max-width-needs-width', 'sin width', '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width:500px;"><tr><td style="font-family:Arial,Helvetica,sans-serif;">x</td></tr></table>'],
        ['max-width-needs-width', 'div', '<div style="max-width:500px;font-family:Arial,Helvetica,sans-serif;">x</div>'],
        ['rgba-hsla', 'rgba', '<p style="color:rgba(0,0,0,0.5);font-family:Arial,Helvetica,sans-serif;">x</p>'],
        ['rgba-hsla', 'opacity', '<p style="opacity:.5;font-family:Arial,Helvetica,sans-serif;color:#000000;">x</p>'],
        ['rgba-hsla', 'hex8', '<p style="color:#00000080;font-family:Arial,Helvetica,sans-serif;">x</p>'],
        ['border-radius-degrade', 'overflow', '<div style="border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">x</div>'],
        ['button-bulletproof', 'sin td', '<a href="https://x.example" style="display:inline-block;padding:12px 24px;background-color:#123456;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">Ir</a>'],
        ['button-bulletproof', 'sin bgcolor ni mso', '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="border-radius:6px;"><a href="https://x.example" style="display:inline-block;padding:12px 24px;background-color:#123456;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">Ir</a></td></tr></table>'],
        ['tables-presentation', 'sin role', '<table cellpadding="0" cellspacing="0" border="0"><tr><td style="font-family:Arial,Helvetica,sans-serif;">x</td></tr></table>'],
        ['tables-presentation', 'sin cellspacing', '<table role="presentation" cellpadding="0" border="0"><tr><td style="font-family:Arial,Helvetica,sans-serif;">x</td></tr></table>'],
        ['bgcolor-mirror', 'sin bgcolor', '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background-color:#eeeeee;font-family:Arial,Helvetica,sans-serif;">x</td></tr></table>'],
        ['inline-critical-styles', 'clase sin estilo en linea', '<p class="bxm-ink" style="font-family:Arial,Helvetica,sans-serif;">x</p>'],
        ['inline-font-family', 'sin fuente', '<p style="color:#000000;">texto</p>'],
        ['link-inline-color', 'enlace sin color', '<a href="https://x.example" style="font-family:Arial,Helvetica,sans-serif;">enlace</a>'],
        ['min-font-size', 'diminuto', '<p style="font-size:9px;font-family:Arial,Helvetica,sans-serif;color:#000000;">x</p>'],
    ];
    for (const [rule, label, snippet] of cases) {
        it(`${rule}: ${label}`, () => {
            expect(rulesOf(inBody(snippet)), fmt(lintEmailHtml(inBody(snippet)))).toContain(rule);
        });
    }

    it('dark-color-scheme-meta: prefers-color-scheme sin las metas', () => {
        const html = GOOD.replace(/<meta name="color-scheme"[^>]*>/, '').replace(/<meta name="supported-color-schemes"[^>]*>/, '');
        expect(rulesOf(html)).toContain('dark-color-scheme-meta');
    });

    it('size-102kb: Gmail recorta a partir de 102 KB', () => {
        const big = GOOD.replace('</body>', `<!-- ${'x'.repeat(104 * 1024)} --></body>`);
        expect(rulesOf(big)).toContain('size-102kb');
        expect(rulesOf(GOOD)).not.toContain('size-102kb');
    });

    it('style-block-size y style-selectors-portable: selectores/at-rules no portables', () => {
        const withStyle = (css: string) => GOOD.replace('</style>', `${css}</style>`);
        expect(rulesOf(withStyle('.bxm-a{color:#000000}'.repeat(1300)))).toContain('style-block-size');
        expect(rulesOf(withStyle('body a:hover{color:red}'))).toContain('style-selectors-portable');
        expect(rulesOf(withStyle('*{margin:0}'))).toContain('style-selectors-portable');
        expect(rulesOf(withStyle('@supports (display:grid){.bxm-a{color:#000000}}'))).toContain('style-selectors-portable');
        expect(rulesOf(withStyle('@media (min-width:1px){.bxm-a{color:#000000}}'))).toContain('style-selectors-portable');
    });

    it('document-basics y fixed-width-table', () => {
        expect(rulesOf(GOOD.replace('<!DOCTYPE html>', ''))).toContain('document-basics');
        expect(rulesOf(GOOD.replace(' lang="es"', ''))).toContain('document-basics');
        expect(rulesOf(GOOD.replace(/<meta name="viewport"[^>]*>/, ''))).toContain('document-basics');
        expect(rulesOf(GOOD.replace(/<title>[\s\S]*?<\/title>/, '<title></title>'))).toContain('document-basics');
        expect(rulesOf(GOOD.replace(/ width="600"/g, ''))).toContain('fixed-width-table');
    });

    it('agrupa por cliente y separa info de error', () => {
        const issues = lintEmailHtml(inBody('<div style="position:absolute;font-family:Arial,Helvetica,sans-serif;">x</div>'));
        const by = issuesByClient(issues);
        expect(by.outlook.some((i) => i.rule === 'layout-position')).toBe(true);
        expect(by['apple-mail'].some((i) => i.rule === 'layout-position')).toBe(false);
        expect(lintEmailHtml(GOOD).filter((i) => i.severity === 'info').map((i) => i.rule)).toContain('inline-table');
    });
});

describe('analizador de HTML', () => {
    it('resuelve atributos, estilos en linea con parentesis y texto directo', () => {
        const doc = parseEmailHtml('<p class="a b" style="color:#fff;background:url(data:image/png;base64,AA);x:y">hola <b>que</b> tal</p>');
        const p = doc.all.find((e) => e.tag === 'p')!;
        expect(p.attrs.class).toBe('a b');
        expect(p.style.color).toBe('#fff');
        expect(p.style.background).toBe('url(data:image/png;base64,AA)');
        expect(doc.all.map((e) => e.tag)).toEqual(['p', 'b']);
    });
});

describe('TODAS las variantes x idiomas x marcas x logo: compatibilidad de clientes', () => {
    for (const brandSpec of SAMPLE_BRANDS) {
        for (const locale of LOCALES) {
            for (const withLogo of [false, true]) {
                it(`${brandSpec.id} / ${locale} / ${withLogo ? 'con' : 'sin'} logo: ${SAMPLE_VARIANTS.length} variantes sin violaciones (claro y oscuro forzado)`, () => {
                    const brand = sampleBrand(brandSpec, withLogo);
                    for (const variant of SAMPLE_VARIANTS) {
                        for (const scheme of [undefined, 'dark'] as const) {
                            const html = buildSampleHtml({ variant: variant.id, brand, locale, scheme });
                            const bad = errors(lintEmailHtml(html));
                            expect(fmt(bad), `${variant.id} ${scheme ?? 'auto'}`).toBe('');
                        }
                    }
                });
            }
        }
    }
});

describe('modo oscuro: legibilidad tras la inversion automatica (parcial y total) y con la paleta propia', () => {
    for (const brandSpec of SAMPLE_BRANDS) {
        for (const locale of LOCALES) {
            it(`${brandSpec.id} / ${locale}: texto principal, boton, cabecera y enlaces legibles`, () => {
                const brand = sampleBrand(brandSpec, false);
                for (const variant of SAMPLE_VARIANTS) {
                    const html = buildSampleHtml({ variant: variant.id, brand, locale });
                    const findings = lintDarkMode(html);
                    expect(findings.map((f) => `${f.mode}/${f.role} "${f.text}" ${f.fg} sobre ${f.bg} -> ${f.fgAfter} sobre ${f.bgAfter} = ${f.ratio.toFixed(2)} < ${f.min}`), `${variant.id}`).toEqual([]);
                    // La vista previa oscura forzada usa la MISMA paleta que prefers-color-scheme.
                    const forced = buildSampleHtml({ variant: variant.id, brand, locale, scheme: 'dark' });
                    expect(lintDarkMode(forced, ['palette']), `${variant.id} dark`).toEqual([]);
                }
            });
        }
    }

    it('un correo sin las reglas oscuras se detecta cuando el texto claro cae sobre fondo claro', () => {
        const html = renderInviteEmailHtml({ type: 'invitation', title: 'x', brand: { name: 'A', color: '#ffcc00' } })
            .replace(/color:#1f2937/g, 'color:#e5e7eb');
        const light = resolveTextPairs(html).find((p) => p.role === 'ink')!;
        expect(contrast(light.fg, light.bg)).toBeLessThan(4.5);
        expect(lintDarkMode(html, ['partial', 'full']).some((f) => f.role === 'ink')).toBe(true);
    });

    it('la paleta oscura se lee de las reglas .bxm-* y cambia los pares (tarjeta y texto)', () => {
        const html = buildSampleHtml({ variant: 'invitation-rich', brand: sampleBrand(SAMPLE_BRANDS[0]), locale: 'es' });
        const overrides = darkClassOverrides(parseEmailHtml(html).styleText);
        expect(overrides.get('bxm-card')?.['background-color']).toBe('#1b1e24');
        const lightInk = resolveTextPairs(html, false).find((p) => p.role === 'ink')!;
        const darkInk = resolveTextPairs(html, true).find((p) => p.role === 'ink')!;
        expect(lightInk.bg).toBe('#ffffff');
        expect(darkInk.bg).toBe('#1b1e24');
        expect(contrast(darkInk.fg, darkInk.bg)).toBeGreaterThanOrEqual(DARK_MIN_RATIO.palette.ink);
    });

    it('modelo de inversion: parcial solo invierte fondos claros; total invierte todos; el texto sigue al fondo', () => {
        // Negro sobre blanco -> claro sobre oscuro (ambos modos)
        for (const mode of ['partial', 'full'] as const) {
            const r = simulateAutoInversion({ fg: '#1f2937', bg: '#ffffff' }, mode);
            expect(r.bg).toBe('#000000');
            expect(contrast(r.fg, r.bg)).toBeGreaterThanOrEqual(4.5);
        }
        // Banda marino con texto blanco: parcial no toca el fondo oscuro; total lo invierte y el texto pasa a oscuro.
        expect(simulateAutoInversion({ fg: '#ffffff', bg: '#0a1f44' }, 'partial')).toEqual({ fg: '#ffffff', bg: '#0a1f44' });
        const full = simulateAutoInversion({ fg: '#ffffff', bg: '#0a1f44' }, 'full');
        expect(full.bg).not.toBe('#0a1f44');
        expect(contrast(full.fg, full.bg)).toBeGreaterThanOrEqual(4.5);
        // Amarillo (L=0.5): la inversion lo deja igual, asi que el texto oscuro NO se invierte.
        expect(flipLightness('#ffcc00')).toBe('#ffcc00');
        expect(simulateAutoInversion({ fg: '#0a0a0a', bg: '#ffcc00' }, 'full').fg).toBe('#0a0a0a');
    });
});

describe('vista previa de inversion automatica (simulateInvertedHtml)', () => {
    it('reescribe colores con el mismo modelo, quita la paleta oscura y el HTML sigue siendo valido', () => {
        const brand = sampleBrand(SAMPLE_BRANDS.find((b) => b.id === 'yellow')!, false);
        const html = buildSampleHtml({ variant: 'invitation-rich', brand, locale: 'es', scheme: 'light' });
        for (const mode of ['partial', 'full'] as const) {
            const inv = simulateInvertedHtml(html, mode);
            expect(inv).not.toBe(html);
            expect(inv).not.toContain('prefers-color-scheme');
            expect(fmt(errors(lintEmailHtml(inv)))).toBe('');
            const pairs = resolveTextPairs(inv);
            const ink = pairs.find((p) => p.role === 'ink')!;
            expect(ink.bg).toBe('#000000');
            expect(contrast(ink.fg, ink.bg)).toBeGreaterThanOrEqual(4.5);
            const button = pairs.find((p) => p.role === 'button')!;
            expect(button.bg).toBe('#ffcc00'); // L=0.5: la inversion no cambia el amarillo
            expect(contrast(button.fg, button.bg)).toBeGreaterThanOrEqual(4.5);
        }
    });
});
