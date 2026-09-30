import { describe, expect, it } from 'vitest';
import {
    EMPTY_DOC, PRESETS, TOKEN_GROUPS, analyze, applyAllFixes, applyFix, applyImported, applyPreset, applyThreeColors, canonicalDoc,
    checkForSave, docFromDomain, exportTheme, historyReducer, importTheme, initHistory, isDirty, paletteFromThree, proposedFix,
    resetThemeDefaults, resolveTokens, setTokenValue, validateHttpsUrl, type EditorDoc,
} from '../model';
import { TOKEN_KEYS, validateThemeConfig } from '@/lib/theme-config';
import { buildBrandThemes } from '@/lib/brand-theme';
import { contrast } from '@/lib/color';
import { CONTRAST_REQUIREMENTS } from '@/lib/themes';
import { BRAND_FIXTURES } from '@/lib/theme-fixtures';

const doc = (theme = {}, extra: Partial<EditorDoc> = {}): EditorDoc => ({ ...EMPTY_DOC, displayName: 'Acme', ...extra, theme });

describe('TOKEN_GROUPS', () => {
    it('cubre TODOS los tokens exactamente una vez', () => {
        const all = TOKEN_GROUPS.flatMap((g) => g.tokens);
        expect(new Set(all).size).toBe(all.length);
        expect([...all].sort()).toEqual([...TOKEN_KEYS].sort());
    });
});

describe('setTokenValue', () => {
    it('fija, normaliza y elimina (derivado); una paleta vacia desaparece', () => {
        let d = setTokenValue(doc(), 'light', 'primary', '#ABC');
        expect(d.theme.palette?.light?.primary).toBe('#aabbcc');
        d = setTokenValue(d, 'light', 'primary', null);
        expect(d.theme.palette).toBeUndefined();
    });
    it('rechaza valores invalidos y alfa fuera de overlay', () => {
        const d = doc();
        expect(setTokenValue(d, 'light', 'primary', 'red')).toBe(d);
        expect(setTokenValue(d, 'light', 'primary', '#11223344')).toBe(d);
        expect(setTokenValue(d, 'dark', 'overlay', '#00000080').theme.palette?.dark?.overlay).toBe('#00000080');
    });
    it('no muta el documento original', () => {
        const d = doc({ palette: { light: { primary: '#123456' } } });
        const snap = JSON.stringify(d);
        setTokenValue(d, 'light', 'primary', '#654321');
        expect(JSON.stringify(d)).toBe(snap);
    });
});

describe('generador desde 3 colores', () => {
    const reqOk = (theme: object, label: string) => {
        const bt = buildBrandThemes(theme)!;
        for (const m of ['light', 'dark'] as const) {
            for (const r of CONTRAST_REQUIREMENTS) {
                const t = bt[m].tokens;
                expect(contrast(t[r.fg], t[r.on]), `${label} ${m} ${r.label}`).toBeGreaterThanOrEqual(r.min - 0.01);
            }
        }
    };
    it('cada preset rellena ambos modos y cumple AA en los dos', () => {
        expect(PRESETS.length).toBeGreaterThanOrEqual(6);
        for (const p of PRESETS) {
            const d = applyPreset(doc(), p);
            expect(d.theme.palette?.light?.primary).toBeTruthy();
            expect(d.theme.palette?.dark?.background).toBeTruthy();
            expect(d.theme.radius).toBe(p.radius);
            reqOk(d.theme, p.id);
        }
    });
    it('colores hostiles (primario casi blanco sobre fondo blanco, texto igual al fondo) siguen cumpliendo AA', () => {
        const cases = [
            { primary: '#ffffff', background: '#ffffff', text: '#ffffff' },
            { primary: '#000000', background: '#000000', text: '#000000' },
            { primary: '#ffff00', background: '#fffff0', text: '#eeeeee' },
            { primary: '#ff00ff', background: '#101010' },
            { primary: '#123456', background: '#7f7f7f', text: '#808080' },
        ];
        for (const c of cases) {
            const d = applyThreeColors(doc(), c)!;
            reqOk(d.theme, JSON.stringify(c));
        }
    });
    it('respeta el esquema del fondo: uno oscuro va a dark y el claro se deriva', () => {
        const p = paletteFromThree({ primary: '#22d3ee', background: '#0b1220', text: '#e2e8f0' })!;
        expect(p.dark.background).toBe('#0b1220');
        expect(p.light.background).not.toBe('#0b1220');
        expect(contrast(p.light.foreground!, p.light.background!)).toBeGreaterThanOrEqual(4.5);
    });
    it('color invalido -> null', () => {
        expect(paletteFromThree({ primary: 'nope', background: '#ffffff' })).toBeNull();
        expect(applyThreeColors(doc(), { primary: '#123456', background: '#fff', text: 'x' })).toBeNull();
    });
});

describe('avisos de contraste y correccion', () => {
    it('un token explicito que incumple se avisa, propone valor y "aplicar correccion" lo deja en AA', () => {
        let d = doc({ palette: { light: { primary: '#ffb6c1', background: '#ffffff' } }, autoFixContrast: false });
        const ws = analyze(d.theme).filter((w) => w.token === 'primary' && w.mode === 'light');
        expect(ws.length).toBeGreaterThan(0);
        const w = ws[0];
        expect(w.ok).toBe(false); // autoFix apagado: solo aviso
        const fix = proposedFix(d.theme, w)!;
        expect(contrast(fix, '#ffffff')).toBeGreaterThanOrEqual(4.5);
        d = applyFix(d, w);
        expect(d.theme.palette!.light!.primary).toBe(fix);
        expect(analyze(d.theme).filter((x) => x.token === 'primary' && x.mode === 'light' && !x.ok)).toHaveLength(0);
    });
    it('applyAllFixes deja la configuracion sin avisos pendientes', () => {
        const d = applyAllFixes(doc({ palette: { light: { primary: '#ffe0e0', 'muted-foreground': '#eeeeee', ring: '#fefefe' } }, autoFixContrast: false }));
        expect(analyze(d.theme).filter((w) => !w.ok)).toHaveLength(0);
    });
    it('sin colores no hay avisos', () => {
        expect(analyze({})).toEqual([]);
    });
    it('fondo de otro esquema: aviso "scheme" y la correccion lo vuelve derivado', () => {
        let d = doc({ palette: { light: { background: '#101010', primary: '#1d4ed8' } } });
        const w = analyze(d.theme).find((x) => x.reason === 'scheme')!;
        expect(w).toBeTruthy();
        d = applyFix(d, w);
        expect(d.theme.palette!.light!.background).toBeUndefined();
    });
});

describe('importar / exportar', () => {
    it('ida y vuelta conserva la configuracion saneada', () => {
        const d = applyPreset(doc(), PRESETS[0]);
        const r = importTheme(exportTheme(d));
        expect(r.ok).toBe(true);
        if (r.ok) expect(canonicalDoc(applyImported(d, r.theme))).toBe(canonicalDoc(d));
    });
    it('JSON hostil: no lanza, descarta claves peligrosas y CSS', () => {
        const hostile = JSON.stringify({
            __proto__: { polluted: true },
            constructor: { prototype: { x: 1 } },
            primaryColor: 'red;}body{display:none}',
            palette: { light: { primary: 'url(javascript:alert(1))', background: '#ffffff', '__proto__': '#000000', evil: '#ffffff' }, dark: 'x' },
            fontFamily: '"><script>alert(1)</script>',
            radius: '9999rem',
            landing: { hero: { title: '<img src=x onerror=alert(1)>' } },
        });
        const r = importTheme(hostile);
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.issues.length).toBeGreaterThan(0);
            const out = JSON.stringify(r.theme);
            expect(out).not.toMatch(/script|javascript|onerror|display:none|polluted/i);
            expect(r.theme.palette?.light).toEqual({ background: '#ffffff' });
            expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        }
    });
    it('rechaza vacio, no JSON, arrays, escalares, gigantes y nada valido', () => {
        expect(importTheme('')).toMatchObject({ ok: false, reason: 'empty' });
        expect(importTheme('{oops')).toMatchObject({ ok: false, reason: 'invalid_json' });
        expect(importTheme('[1,2]')).toMatchObject({ ok: false, reason: 'not_object' });
        expect(importTheme('42')).toMatchObject({ ok: false, reason: 'not_object' });
        expect(importTheme('"x"')).toMatchObject({ ok: false, reason: 'not_object' });
        expect(importTheme('x'.repeat(200_000))).toMatchObject({ ok: false, reason: 'too_large' });
        expect(importTheme('{"foo":1}')).toMatchObject({ ok: false, reason: 'nothing_valid' });
    });
    it('acepta el envoltorio { theme } y migra campos antiguos a palette', () => {
        const r = importTheme(JSON.stringify({ theme: { primaryColor: '#1d4ed8', backgroundColor: '#ffffff' } }));
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect((r.theme as Record<string, unknown>).primaryColor).toBeUndefined();
            expect(r.theme.palette?.light?.primary).toBe('#1d4ed8');
        }
    });
    it('un import sin landing conserva la actual', () => {
        const d = doc({ landing: { layout: 'center' } });
        const r = importTheme('{"radius":"lg"}');
        expect(r.ok).toBe(true);
        if (r.ok) expect(applyImported(d, r.theme).theme.landing).toEqual({ layout: 'center' });
    });
});

describe('docFromDomain / migracion', () => {
    it('la migracion de campos antiguos no cambia los tokens efectivos (12 fixtures)', () => {
        for (const [fname, fcfg] of Object.entries(BRAND_FIXTURES)) {
            const before = buildBrandThemes(fcfg);
            const d = docFromDomain({ theme: fcfg, name: 'x' });
            const after = buildBrandThemes(d.theme);
            expect(after?.light.tokens, fname).toEqual(before?.light.tokens);
            expect(after?.dark.tokens, fname).toEqual(before?.dark.tokens);
        }
    });
    it('respuesta vacia o hostil no lanza', () => {
        expect(docFromDomain(null).theme).toEqual({});
        expect(docFromDomain({ theme: 'x', displayName: 5, logo: {} })).toEqual({ displayName: '', logo: '', theme: {} });
    });
    it('sin colores resolveTokens usa el tema generico', () => {
        expect(resolveTokens({}, 'light').background).toBe('#ffffff');
    });
});

describe('checkForSave / payload / sucio', () => {
    it('payload = tema saneado completo (palette y landing) y sin campos antiguos', () => {
        const d = applyPreset(doc({ landing: { layout: 'center', hero: { title: 'Hola' } } }), PRESETS[1]);
        const c = checkForSave(d);
        expect(c.blocked).toBe(false);
        expect(c.payload.theme.palette?.dark).toBeTruthy();
        expect((c.payload.theme.landing as Record<string, unknown>).layout).toBe('center');
        expect(validateThemeConfig(c.payload.theme).issues).toEqual([]);
    });
    it('logo no https bloquea con error por campo; landing.logo http se avisa', () => {
        const c = checkForSave(doc({ landing: { logo: { light: 'http://x.com/a.png' } } }, { logo: 'http://x.com/a.png' }));
        expect(c.errors.logo).toBe('not_https');
        expect(c.blocked).toBe(true);
        expect(Object.keys(c.warnings).some((k) => k.startsWith('landing.logo'))).toBe(true);
    });
    it('displayName > 120 bloquea', () => {
        expect(checkForSave(doc({}, { displayName: 'x'.repeat(121) })).errors.displayName).toBe('tooLong');
    });
    it('isDirty ignora el orden de claves y detecta cambios reales', () => {
        const a = doc({ radius: 'lg', fontFamily: 'inter' });
        const b = doc({ fontFamily: 'inter', radius: 'lg' });
        expect(isDirty(a, b)).toBe(false);
        expect(isDirty(setTokenValue(a, 'light', 'primary', '#123456'), a)).toBe(true);
        expect(isDirty({ ...a, displayName: 'Otra' }, a)).toBe(true);
    });
    it('resetThemeDefaults limpia colores/forma/politica y conserva landing y logos', () => {
        const d = applyPreset(doc({ landing: { layout: 'center' }, lockBrand: true }, { logo: 'https://x.com/l.png' }), PRESETS[2]);
        const r = resetThemeDefaults(d);
        expect(r.theme).toEqual({ landing: { layout: 'center' } });
        expect(r.logo).toBe('https://x.com/l.png');
    });
});

describe('validateHttpsUrl', () => {
    it('acepta https y vacio; rechaza el resto', () => {
        expect(validateHttpsUrl('')).toBe('ok');
        expect(validateHttpsUrl('https://cdn.acme.com/logo.png')).toBe('ok');
        expect(validateHttpsUrl('http://a.com/x.png')).toBe('not_https');
        expect(validateHttpsUrl('javascript:alert(1)')).toBe('not_https');
        expect(validateHttpsUrl('data:image/png;base64,AAAA')).toBe('not_https');
        expect(validateHttpsUrl('https://a b.com')).toBe('invalid');
        expect(validateHttpsUrl('https://' + 'a'.repeat(2100))).toBe('too_long');
    });
});

describe('historial', () => {
    it('deshacer/rehacer y fusion de cambios seguidos con la misma clave', () => {
        let h = initHistory(doc());
        const d1 = setTokenValue(h.present, 'light', 'primary', '#111111');
        const d2 = setTokenValue(d1, 'light', 'primary', '#222222');
        const d3 = setTokenValue(d2, 'light', 'primary', '#333333');
        h = historyReducer(h, { type: 'set', doc: d1, key: 'c', at: 1000 });
        h = historyReducer(h, { type: 'set', doc: d2, key: 'c', at: 1100 });
        h = historyReducer(h, { type: 'set', doc: d3, key: 'c', at: 1200 });
        expect(h.past).toHaveLength(1); // los tres son un solo paso
        h = historyReducer(h, { type: 'undo' });
        expect(h.present.theme.palette).toBeUndefined();
        h = historyReducer(h, { type: 'redo' });
        expect(h.present.theme.palette?.light?.primary).toBe('#333333');
        h = historyReducer(h, { type: 'undo' });
        h = historyReducer(h, { type: 'set', doc: d1, at: 5000 });
        expect(h.future).toHaveLength(0); // un cambio nuevo borra el rehacer
    });
    it('undo/redo sin historial no hace nada; load reinicia', () => {
        const h = initHistory(doc());
        expect(historyReducer(h, { type: 'undo' })).toBe(h);
        expect(historyReducer(h, { type: 'redo' })).toBe(h);
        const l = historyReducer(h, { type: 'load', doc: doc({ radius: 'xl' }) });
        expect(l.past).toHaveLength(0);
    });
});
