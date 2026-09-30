import { describe, expect, it } from 'vitest';
import { backgroundScheme, contrast } from '../color';
import { BRAND_FIXTURES } from '../theme-fixtures';
import { TOKEN_KEYS, type DomainThemeConfig } from '../theme-config';
import {
    CONTRAST_REQUIREMENTS, THEMES, buildThemeCss, type ThemeTokens,
} from '../themes';
import {
    analyzeBrandTheme, buildBrandCss, buildBrandThemes, deriveFullPalette, deriveFullPaletteDetailed, harmonicBackground,
} from '../brand-theme';

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;

function failures(tokens: ThemeTokens) {
    return CONTRAST_REQUIREMENTS
        .map((r) => ({ r, ratio: contrast(tokens[r.fg], tokens[r.on]) }))
        .filter((x) => x.ratio < x.r.min)
        .map((x) => `${x.r.label}: ${x.ratio.toFixed(2)} < ${x.r.min}`);
}

describe('temas genericos: contrato completo', () => {
    it('los 8 temas tienen TODOS los tokens en hex valido y cumplen todos los requisitos AA', () => {
        expect(THEMES).toHaveLength(8);
        for (const t of THEMES) {
            for (const k of TOKEN_KEYS) expect(t.tokens[k], `${t.id}.${k}`).toMatch(HEX);
            expect(failures(t.tokens), t.id).toEqual([]);
        }
    });
    it('buildThemeCss emite cada token nuevo para cada tema', () => {
        const css = buildThemeCss();
        for (const k of TOKEN_KEYS) expect(css).toContain(`--color-${k}:`);
    });
});

describe('deriveFullPalette / buildBrandThemes con 12+ paletas variadas', () => {
    const entries = Object.entries(BRAND_FIXTURES);
    it('hay al menos 12 paletas de prueba', () => expect(entries.length).toBeGreaterThanOrEqual(12));

    for (const [name, cfg] of entries) {
        it(`${name}: brand-light y brand-dark completos, esquema correcto y AA en ambos modos`, () => {
            const bt = buildBrandThemes(cfg, { name });
            expect(bt).not.toBeNull();
            expect(bt!.light.id).toBe('brand-light');
            expect(bt!.dark.id).toBe('brand-dark');
            expect(bt!.light.scheme).toBe('light');
            expect(bt!.dark.scheme).toBe('dark');
            for (const th of bt!.list) {
                for (const k of TOKEN_KEYS) expect(th.tokens[k], `${th.id}.${k}`).toMatch(HEX);
                expect(failures(th.tokens), `${name} @ ${th.id}`).toEqual([]);
                expect(th.brand).toBe(true);
            }
            // El esquema del fondo coincide con el del tema (nunca un lienzo oscuro con tokens claros).
            expect(backgroundScheme(bt!.light.tokens.background)).toBe('light');
            expect(backgroundScheme(bt!.dark.tokens.background)).toBe('dark');
        });
    }

    it('es determinista y no muta la entrada', () => {
        const cfg = JSON.parse(JSON.stringify(BRAND_FIXTURES['pastel']));
        const before = JSON.stringify(cfg);
        expect(buildBrandThemes(cfg)!.light.tokens).toEqual(buildBrandThemes(cfg)!.light.tokens);
        expect(JSON.stringify(cfg)).toBe(before);
    });

    it('sin colores no hay temas de empresa', () => {
        expect(buildBrandThemes({})).toBeNull();
        expect(buildBrandThemes(null)).toBeNull();
        expect(buildBrandThemes({ radius: 'lg', fontFamily: 'serif' })).toBeNull();
    });
});

describe('integracion del criterio "fondo oscuro nunca en tema claro"', () => {
    it('un fondo de marca oscuro (campo antiguo) va al tema oscuro; el claro se DERIVA de el, sin lienzo oscuro', () => {
        const bt = buildBrandThemes({ backgroundColor: '#0d1117', textColor: '#e6edf3', primaryColor: '#2563eb' })!;
        expect(bt.dark.tokens.background).toBe('#0d1117');
        expect(backgroundScheme(bt.light.tokens.background)).toBe('light');
        expect(bt.derived).toEqual({ light: true, dark: false });
        expect(bt.light.tokens.background).not.toBe('#0d1117');
    });
    it('un fondo claro en palette.dark (o uno oscuro en palette.light) se descarta con aviso de esquema', () => {
        const bt = buildBrandThemes({ palette: { light: { background: '#101010' }, dark: { background: '#fafafa' }, } })!;
        expect(backgroundScheme(bt.light.tokens.background)).toBe('light');
        expect(backgroundScheme(bt.dark.tokens.background)).toBe('dark');
        expect(bt.warnings.filter((w) => w.reason === 'scheme').map((w) => w.mode).sort()).toEqual(['dark', 'light']);
    });
    it('un fondo de marca claro sigue aplicandose al tema claro', () => {
        const bt = buildBrandThemes({ backgroundColor: '#f5f5f0' })!;
        expect(bt.light.tokens.background).toBe('#f5f5f0');
        expect(bt.derived.dark).toBe(true);
    });
});

describe('modo derivado del otro (inversion armonica)', () => {
    it('el matiz del fondo se conserva al derivar claro -> oscuro y oscuro -> claro', () => {
        const dark = harmonicBackground('#fff4e6', 'dark');
        const light = harmonicBackground('#0b1e3a', 'light');
        expect(backgroundScheme(dark)).toBe('dark');
        expect(backgroundScheme(light)).toBe('light');
        // calido -> rojo/naranja dominante; azul marino -> azul dominante
        const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
        const [dr, , db] = rgb(dark); expect(dr).toBeGreaterThan(db);
        const [lr, , lb] = rgb(light); expect(lb).toBeGreaterThan(lr);
    });
    it('un fondo neutro casi blanco se tinta con el primario cromatico, no con olivas', () => {
        const d = harmonicBackground('#fffffe', 'dark', '#2563eb');
        const [r, , b] = [1, 3, 5].map((i) => parseInt(d.slice(i, i + 2), 16));
        expect(b).toBeGreaterThan(r);
        expect(harmonicBackground('#ffffff', 'dark')).toBe('#0f1115');
    });
    it('si solo se define el claro, el oscuro se deriva (y no es un simple inverso 255-x)', () => {
        const bt = buildBrandThemes({ backgroundColor: '#f2e9dc', primaryColor: '#8a4b08' })!;
        expect(bt.derived.dark).toBe(true);
        const inv = '#0d1623';
        expect(bt.dark.tokens.background).not.toBe(inv);
        expect(failures(bt.dark.tokens)).toEqual([]);
    });
});

describe('explicito gana; autoFixContrast', () => {
    it('un token explicito que cumple AA se respeta tal cual (cualquier token)', () => {
        const cfg: DomainThemeConfig = { palette: { light: { background: '#faf7f2', foreground: '#2b2118', sidebar: '#efe7da', 'row-hover': '#f0e8dc', code: '#eee6d8' } } };
        const t = buildBrandThemes(cfg)!.light.tokens;
        expect(t.background).toBe('#faf7f2');
        expect(t.sidebar).toBe('#efe7da');
        expect(t['row-hover']).toBe('#f0e8dc');
        expect(t.code).toBe('#eee6d8');
        expect(failures(t)).toEqual([]);
    });
    it('un explicito que rompe AA se corrige y se avisa (autoFix por defecto)', () => {
        const bt = buildBrandThemes({ palette: { light: { background: '#ffffff', 'muted-foreground': '#dddddd', link: '#ffff00' } } })!;
        const w = bt.warnings.filter((x) => x.mode === 'light');
        expect(w.map((x) => x.token).sort()).toEqual(['link', 'muted-foreground']);
        for (const x of w) { expect(x.corrected).toBe(true); expect(x.ok).toBe(true); expect(x.appliedRatio).toBeGreaterThanOrEqual(x.min); expect(x.chosenRatio).toBeLessThan(x.min); }
        expect(bt.light.tokens.link).not.toBe('#ffff00');
        expect(failures(bt.light.tokens)).toEqual([]);
    });
    it('con autoFixContrast:false el explicito se conserva y solo se avisa', () => {
        const bt = buildBrandThemes({ autoFixContrast: false, palette: { light: { background: '#ffffff', 'muted-foreground': '#dddddd' } } })!;
        expect(bt.light.tokens['muted-foreground']).toBe('#dddddd');
        const w = bt.warnings.find((x) => x.token === 'muted-foreground')!;
        expect(w.corrected).toBe(false);
        expect(w.ok).toBe(false);
        expect(analyzeBrandTheme({ autoFixContrast: false, palette: { light: { 'muted-foreground': '#dddddd' } } })).not.toHaveLength(0);
    });
    it('los tokens DERIVADOS siempre cumplen AA aunque autoFixContrast sea false', () => {
        const bt = buildBrandThemes({ autoFixContrast: false, ...BRAND_FIXTURES['pastel'] })!;
        // Solo puede fallar lo explicito (primary/brand-accent/textColor de la marca): comprobamos los pares de tokens derivados.
        for (const th of bt.list) {
            for (const r of CONTRAST_REQUIREMENTS.filter((x) => !['primary', 'brand-accent', 'link', 'link-hover', 'ring', 'foreground'].includes(x.fg) && x.on !== 'primary' && x.fg !== 'primary-foreground' && x.fg !== 'brand-accent-foreground' && x.fg !== 'chip-foreground')) {
                expect(contrast(th.tokens[r.fg], th.tokens[r.on]), `${th.id} ${r.label}`).toBeGreaterThanOrEqual(r.min);
            }
        }
    });
    it('header explicito de color de marca recibe texto legible derivado', () => {
        const t = buildBrandThemes({ palette: { light: { header: '#b45309' } } })!.light.tokens;
        expect(t.header).toBe('#b45309');
        expect(contrast(t['header-foreground'], t.header)).toBeGreaterThanOrEqual(4.5);
    });
    it('deriveFullPalette acepta pocos colores base y devuelve TODOS los tokens', () => {
        for (const mode of ['light', 'dark'] as const) {
            const t = deriveFullPalette({ primary: '#7c3aed', 'brand-accent': '#0ea5e9', background: mode === 'light' ? '#faf5ff' : '#120a1f', foreground: mode === 'light' ? '#1e1030' : '#efe7fb' }, mode);
            for (const k of TOKEN_KEYS) expect(t[k]).toMatch(HEX);
            expect(failures(t)).toEqual([]);
        }
        expect(deriveFullPaletteDetailed({}, 'dark').warnings).toEqual([]);
    });
    it('sin nada explicito deriveFullPalette reproduce los temas por defecto (claro/oscuro)', () => {
        for (const id of ['light', 'dark'] as const) {
            const t = deriveFullPalette({}, id);
            const th = THEMES.find((x) => x.id === id)!;
            for (const k of ['background', 'foreground', 'card', 'primary', 'muted', 'border', 'input'] as const) expect(t[k]).toBe(th.tokens[k]);
        }
    });
});

describe('buildBrandCss', () => {
    it('emite los dos temas de empresa, respaldo sin JS y radio/fuente', () => {
        const css = buildBrandCss({ primaryColor: '#7c3aed', radius: 'lg', fontFamily: 'serif' }, { name: 'Acme' });
        expect(css).toContain(':root[data-theme="brand-light"]{color-scheme:light;');
        expect(css).toContain(':root[data-theme="brand-dark"]{color-scheme:dark;');
        expect(css).toContain(':root:not([data-theme])');
        expect(css).toContain('@media (prefers-color-scheme:dark)');
        expect(css).toContain('html:root{');
        expect(css).toContain('--radius:0.75rem');
        expect(css).toContain('--font-body:ui-serif');
        for (const k of TOKEN_KEYS) expect(css).toContain(`--color-${k}:`);
    });
    it('vacio sin configuracion; solo radio/fuente sin colores', () => {
        expect(buildBrandCss(null)).toBe('');
        expect(buildBrandCss({})).toBe('');
        const css = buildBrandCss({ radius: 'none', fontFamily: 'mono' });
        expect(css).not.toContain('brand-light');
        expect(css).toContain('--radius:0rem');
    });
    it('defaultMode distinto de system no emite el @media de respaldo', () => {
        expect(buildBrandCss({ primaryColor: '#123456', defaultMode: 'dark' })).not.toContain('@media');
        expect(buildBrandCss({ primaryColor: '#123456', defaultMode: 'system' })).toContain('@media');
    });
    it('la salida solo contiene valores seguros aunque la entrada sea hostil', () => {
        const css = buildBrandCss({
            primaryColor: '#fff;} body{display:none}', titleFont: 'x;}</style>', fontFamily: 'evil}',
            palette: { light: { background: '#fff}' }, dark: { primary: '#123456' } },
        } as unknown as DomainThemeConfig);
        expect(css).not.toMatch(/display:none|<\/?style|<script/i);
        // Todo lo que aparece tras "--color-x:" es un hex.
        for (const m of css.matchAll(/--color-[a-z-]+:([^;}\s]*)/g)) if (!m[1].startsWith('var(') && !m[1].startsWith('hsl(')) expect(m[1]).toMatch(HEX);
    });
    it('titleFont/bodyFont antiguos se conservan; fontFamily nuevo los sustituye', () => {
        expect(buildBrandCss({ titleFont: 'Inter', bodyFont: 'Roboto Mono' })).toContain('--font-body:"Roboto Mono",system-ui,sans-serif');
        expect(buildBrandCss({ titleFont: 'Inter', fontFamily: 'mono' })).toContain('--font-title:ui-monospace');
    });
});
