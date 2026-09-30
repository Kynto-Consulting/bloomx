/**
 * MOTOR DE TEMAS DE EMPRESA
 * ------------------------------------------------------------------------------
 * A partir de la configuracion saneada de una empresa (theme-config.ts) genera dos temas
 * completos, `brand-light` y `brand-dark`, con TODOS los tokens de TOKEN_KEYS y contraste AA
 * garantizado (salvo tokens explicitos cuando autoFixContrast === false: entonces solo se avisa).
 *
 *   deriveFullPalette(base, mode)      pocos colores base -> todos los tokens de un modo
 *   buildBrandThemes(cfg, {name})      -> { light, dark, list, warnings, derived } | null
 *   buildBrandCss(cfg)                 CSS (temas de empresa + radio + fuente) para <style id="bx-brand">
 *   getSelectableThemes(brand, policy) lista ordenada para el selector (empresa primero)
 *
 * Reglas:
 *   - Un valor explicito (palette[modo][token] o campo antiguo) GANA sobre la derivacion.
 *   - Un fondo de marca oscuro NUNCA se usa en un tema claro (ni uno claro en uno oscuro): se ignora y se avisa.
 *   - Si la empresa solo definio un modo, el otro se deriva del primero (matiz del fondo, luminosidad invertida).
 *   - Los colores de estado (destructive/success/warning/info) conservan su matiz semantico; solo se corrige el contraste.
 * Sin dependencias de DOM: se ejecuta igual en servidor y cliente.
 */
import { backgroundScheme, contrast, ensureContrast, hexToHsl, hexToRgb, hslToHex, luminance, mix, readableOnAA } from './color';
import {
    ALPHA_TOKENS, LEGACY_COLOR_FIELDS, TOKEN_KEYS, hasBrandConfig, legacyFontStack, normalizeThemeHex,
    resolveFontStack, resolveRadiusRem, sanitizeThemeConfig,
    type DomainThemeConfig, type ThemeMode, type ThemePalette, type TokenKey,
} from './theme-config';
import {
    CONTRAST_REQUIREMENTS, DARK_ACCENT_SHADES, HUES, darkPaletteRemap, getAvailableThemeIds, getTheme, getThemePolicy,
    type ThemeDefinition, type ThemePolicy, type ThemeTokens,
} from './themes';

export type BaseTokens = Partial<Record<TokenKey, string>>;

export interface PaletteWarning {
    mode: ThemeMode;
    token: TokenKey;
    /** Token contra el que se mide (o 'foreground' para el aviso de esquema). */
    against: TokenKey;
    /** contrast: no cumplia AA; scheme: fondo de otro esquema (descartado); invisible: muted/borde/secundario casi identico al fondo (se deriva uno visible). */
    reason: 'contrast' | 'scheme' | 'invisible';
    chosen: string;
    applied: string;
    chosenRatio: number;
    appliedRatio: number;
    min: number;
    /** true si el valor aplicado difiere del elegido. */
    corrected: boolean;
    /** true si el valor aplicado cumple el minimo. */
    ok: boolean;
}

export interface DeriveOptions {
    /** false: los tokens EXPLICITOS que incumplan AA se conservan (solo se avisa). Defecto true. */
    autoFix?: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function pickReadable(surface: string, candidates: (string | undefined)[], min = 4.5): string {
    for (const c of candidates) if (c && contrast(c, surface) >= min) return c;
    return readableOnAA(surface);
}

let shadeTextCache: string[] | null = null;
/**
 * Los tonos crudos text-<color>-500/600 se reasignan en temas oscuros (darkPaletteRemap). Devuelve, por escala, el
 * mas oscuro (peor caso): las superficies oscuras derivadas deben mantenerlos legibles (>= 4.5) como en los temas genericos.
 */
function worstShadeTexts(): string[] {
    if (!shadeTextCache) {
        shadeTextCache = ([500, 600] as const).map((shade) => {
            const { s, l } = DARK_ACCENT_SHADES[shade];
            return Object.values(HUES).map((h) => hslToHex(h, s, l)).reduce((a, b) => (luminance(b) < luminance(a) ? b : a));
        });
    }
    return shadeTextCache;
}

function isChromatic(hex: string): boolean {
    const { s, l } = hexToHsl(hex);
    return s >= 0.25 && l > 0.08 && l < 0.95;
}

// ---------------------------------------------------------------------------
// Derivacion de un modo
// ---------------------------------------------------------------------------

/**
 * Deriva TODOS los tokens de un modo. `base` puede traer cualquier subconjunto de tokens
 * (tipicamente primary, brand-accent, background, foreground y, opcionalmente, card/muted/border);
 * lo que venga es "explicito" y gana; el resto se calcula y siempre cumple AA.
 */
export function deriveFullPaletteDetailed(
    base: BaseTokens,
    mode: ThemeMode,
    opts: DeriveOptions = {},
): { tokens: ThemeTokens; warnings: PaletteWarning[] } {
    const autoFix = opts.autoFix !== false;
    const light = mode === 'light';
    const seed = getTheme(mode)!.tokens;
    const warnings: PaletteWarning[] = [];

    // Explicitos: solo hex validos (alfa solo en overlay).
    const ex: BaseTokens = {};
    for (const k of TOKEN_KEYS) {
        const v = normalizeThemeHex((base as Record<string, unknown>)[k], (ALPHA_TOKENS as readonly string[]).includes(k));
        if (v) ex[k] = v;
    }
    // Un fondo de un esquema distinto al del tema se descarta (nunca un lienzo oscuro con tokens claros).
    if (ex.background && backgroundScheme(ex.background) !== mode) {
        warnings.push({
            mode, token: 'background', against: 'foreground', reason: 'scheme',
            chosen: ex.background, applied: seed.background, chosenRatio: 0, appliedRatio: 0, min: 0, corrected: true, ok: true,
        });
        delete ex.background;
    }

    // Superficies/bordes explicitos casi identicos al fondo (p. ej. borde #ffffff sobre fondo #ffffff, muy comun en
    // configuraciones antiguas) no aportan nada y dejan la UI sin separadores: se descartan y se derivan visibles.
    const invisible: TokenKey[] = [];
    if (autoFix) {
        const bg0 = ex.background ?? seed.background;
        for (const [key, min] of [['muted', 1.03], ['border', 1.12], ['secondary', 1.06]] as const) {
            const v = ex[key];
            if (v && contrast(v, bg0) < min) {
                warnings.push({
                    mode, token: key, against: 'background', reason: 'invisible', chosen: v, applied: v,
                    chosenRatio: r2(contrast(v, bg0)), appliedRatio: 0, min, corrected: true, ok: true,
                });
                invisible.push(key);
                delete ex[key];
            }
        }
    }

    const t = {} as Record<TokenKey, string>;
    const hasBg = !!ex.background;

    /** Token de TEXTO/CONTROL: debe cumplir `min` contra todas las superficies `on`. */
    const check = (key: TokenKey, cand: string, on: TokenKey[], min: number) => {
        const surfaces = on.map((k) => t[k]);
        const passes = (c: string) => surfaces.every((s) => contrast(c, s) >= min);
        let v = ex[key] ?? cand;
        if (!passes(v)) {
            const fixed = ensureContrast(v, surfaces, min);
            if (ex[key] !== undefined) {
                let wi = 0;
                surfaces.forEach((s, i) => { if (contrast(v, s) < contrast(v, surfaces[wi])) wi = i; });
                const applied = autoFix ? fixed : v;
                warnings.push({
                    mode, token: key, against: on[wi], reason: 'contrast', chosen: v, applied,
                    chosenRatio: r2(contrast(v, surfaces[wi])), appliedRatio: r2(contrast(applied, surfaces[wi])),
                    min, corrected: applied !== v, ok: contrast(applied, surfaces[wi]) >= min,
                });
                v = applied;
            } else {
                v = fixed;
            }
        }
        t[key] = v;
    };
    /** Token de TEXTO sobre una superficie solida (X-foreground sobre X). */
    const solid = (key: TokenKey, surface: TokenKey, cands: (string | undefined)[]) => {
        check(key, pickReadable(t[surface], cands), [surface], 4.5);
    };
    /** Superficie derivada (mezcla) que conserva legible el texto principal; explicita si la hay. */
    const surf = (key: TokenKey, from: string, to: string, amt: number, texts: string[], min = 5, extra: string[] = []) => {
        if (ex[key] !== undefined) { t[key] = ex[key]!; return; }
        const ok = (v: string) => texts.every((x) => contrast(x, v) >= min) && extra.every((x) => contrast(x, v) >= 4.5);
        let a = amt;
        let v = mix(from, to, a);
        for (let i = 0; i < 8 && !ok(v); i++) { a *= 0.7; v = mix(from, to, a); }
        t[key] = ok(v) ? v : from;
    };
    const shades = light ? [] : worstShadeTexts();

    // ---- 1. Lienzo y superficies ------------------------------------------
    t.background = ex.background ?? seed.background;
    const bgHsl = hexToHsl(t.background);
    const tintedFg = light
        ? hslToHex(bgHsl.h, Math.min(bgHsl.s * 100, 30) * 0.6, 9)
        : hslToHex(bgHsl.h, Math.min(bgHsl.s * 100, 30) * 0.5, 93);

    if (!hasBg && ex.card === undefined) t.card = seed.card;
    else surf('card', t.background, '#ffffff', light ? 0.65 : 0.045, [], 5, shades);
    t.popover = ex.popover ?? ((hasBg || ex.card) ? (light ? t.card : mix(t.card, '#ffffff', 0.025)) : seed.popover);
    check('foreground', hasBg ? pickReadable(t.background, [tintedFg, seed.foreground]) : seed.foreground, ['background', 'card'], 4.5);
    const fg = t.foreground;

    if (!hasBg && ex.muted === undefined) t.muted = seed.muted;
    else surf('muted', t.background, light ? fg : '#ffffff', light ? 0.05 : 0.07, [fg], 5, shades);
    surf('secondary', t.background, fg, light ? 0.09 : 0.12, [fg]);
    t.accent = ex.accent ?? ((hasBg || ex.muted) ? mix(t.muted, fg, light ? 0.04 : 0.05) : seed.accent);
    t.border = ex.border ?? (hasBg ? mix(t.background, fg, light ? 0.12 : 0.16) : seed.border);

    solid('card-foreground', 'card', [fg, seed['card-foreground']]);
    solid('popover-foreground', 'popover', [fg, seed['popover-foreground']]);
    solid('secondary-foreground', 'secondary', [fg, seed['secondary-foreground']]);
    solid('accent-foreground', 'accent', [fg, seed['accent-foreground']]);

    // ---- 2. Marca -----------------------------------------------------------
    check('primary', seed.primary, ['background', 'card'], 4.5);
    solid('primary-foreground', 'primary', [seed['primary-foreground'], t.background, fg]);
    check('ring', t.primary, ['background', 'card'], 3);
    check('input', hasBg ? mix(t.background, fg, 0.5) : seed.input, ['background', 'card'], 3);

    // Acento de marca: si no se define y el primario tiene color, se deriva un analogo armonico (matiz +35).
    let accentCand = seed['brand-accent'];
    if (isChromatic(t.primary)) {
        const p = hexToHsl(t.primary);
        accentCand = hslToHex((p.h + 35) % 360, clamp(p.s * 100, 55, 85), light ? 40 : 70);
    }
    check('brand-accent', accentCand, ['background', 'card'], 4.5);
    solid('brand-accent-foreground', 'brand-accent', [seed['brand-accent-foreground'], t.background, fg]);

    // ---- 3. Estados semanticos (conservan matiz) ----------------------------
    for (const s of ['destructive', 'success', 'warning', 'info'] as const) {
        check(s, seed[s], ['background', 'card'], 4.5);
        solid(`${s}-foreground` as TokenKey, s, [seed[`${s}-foreground` as TokenKey], '#ffffff', '#0a0a0a']);
    }

    // ---- 4. Superficies nuevas ---------------------------------------------
    // Si el texto atenuado es explicito, tambien debe leerse sobre estas superficies.
    const tx = ex['muted-foreground'] ? [fg, ex['muted-foreground']!] : [fg];
    surf('sidebar', t.background, light ? fg : '#000000', light ? 0.03 : 0.25, tx);
    solid('sidebar-foreground', 'sidebar', [fg, t.background]);
    surf('sidebar-accent', t.sidebar, t.primary, light ? 0.12 : 0.22, [t['sidebar-foreground'], ...tx.slice(1)]);
    solid('sidebar-accent-foreground', 'sidebar-accent', [t['sidebar-foreground'], fg, t.background]);
    t['sidebar-border'] = ex['sidebar-border'] ?? mix(t.sidebar, t['sidebar-foreground'], light ? 0.12 : 0.16);

    t.header = ex.header ?? t.card;
    solid('header-foreground', 'header', [t['card-foreground'], fg, t.background]);

    surf('unread', t.background, t.primary, light ? 0.05 : 0.1, tx);
    solid('unread-foreground', 'unread', [fg, t['card-foreground']]);
    surf('row-hover', t.background, fg, light ? 0.045 : 0.06, tx);
    surf('row-selected', t.background, t.primary, light ? 0.14 : 0.24, tx);
    solid('row-selected-foreground', 'row-selected', [fg, t['card-foreground']]);

    surf('code', t.background, fg, light ? 0.07 : 0.12, [fg]);
    solid('code-foreground', 'code', [fg, t['card-foreground']]);
    surf('chip', t.background, t.primary, light ? 0.12 : 0.22, [fg]);
    solid('chip-foreground', 'chip', [t.primary, fg, t['card-foreground']]);
    surf('selection', t.background, t.primary, light ? 0.3 : 0.4, [fg]);
    solid('selection-foreground', 'selection', [fg, t['card-foreground']]);
    t.overlay = ex.overlay ?? `${mix(t.background, '#000000', light ? 0.85 : 0.7)}${light ? '73' : 'b3'}`;

    // ---- 5. Texto atenuado (contra todas las superficies donde se usa) -------
    check('muted-foreground', mix(fg, t.background, 0.35),
        ['background', 'card', 'muted', 'popover', 'sidebar', 'unread', 'row-hover', 'row-selected'], 4.5);

    // ---- 6. Enlaces y scroll -------------------------------------------------
    const linkCand = isChromatic(t.primary) ? t.primary : isChromatic(t['brand-accent']) ? t['brand-accent'] : t.info;
    check('link', linkCand, ['background', 'card', 'popover', 'row-hover'], 4.5);
    check('link-hover', mix(t.link, fg, 0.3), ['background', 'card', 'popover', 'row-hover'], 4.5);
    check('scrollbar', mix(t.background, fg, light ? 0.28 : 0.34), ['background'], 1.5);

    // ---- 7. Red de seguridad: todos los requisitos AA del registro ----------
    for (const req of CONTRAST_REQUIREMENTS) {
        const v = t[req.fg];
        if (contrast(v, t[req.on]) >= req.min) continue;
        // Solo llegan aqui tokens derivados (los explicitos ya se trataron y avisaron): correccion silenciosa.
        if (ex[req.fg] !== undefined) continue;
        t[req.fg] = ensureContrast(v, [t[req.on]], req.min);
    }

    for (const w of warnings) {
        if (w.reason === 'invisible' && invisible.includes(w.token)) {
            w.applied = t[w.token];
            w.appliedRatio = r2(contrast(t[w.token], t.background));
            w.ok = w.appliedRatio >= w.min;
        }
    }
    return { tokens: t as ThemeTokens, warnings };
}

/** Deriva todos los tokens de un modo (sin avisos). Ver deriveFullPaletteDetailed. */
export function deriveFullPalette(base: BaseTokens, mode: ThemeMode, opts: DeriveOptions = {}): ThemeTokens {
    return deriveFullPaletteDetailed(base, mode, opts).tokens;
}

// ---------------------------------------------------------------------------
// Inversion armonica de luminosidad (modo derivado del otro)
// ---------------------------------------------------------------------------

/**
 * Fondo del modo `target` derivado del fondo del otro modo: conserva el matiz (y algo de saturacion)
 * y lleva la luminosidad al extremo opuesto (L 8% oscuro / 97.5% claro). Si el fondo origen es neutro,
 * se tinta con el primario (si tiene color) o se usa el fondo por defecto del modo.
 */
export function harmonicBackground(source: string, target: ThemeMode, primaryHint?: string): string {
    const src = hexToHsl(source);
    const rgb = hexToRgb(source);
    const chroma = (Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)) / 255;
    let hue = src.h;
    let sat = src.s;
    // Casi neutro (croma bajo; la saturacion HSL se dispara en blancos/negros casi puros): se tinta con el primario o se usa el defecto.
    if (sat < 0.06 || chroma < 0.03) {
        const p = primaryHint ? hexToHsl(primaryHint) : null;
        if (p && p.s >= 0.25) { hue = p.h; sat = 0.12; } else return getTheme(target)!.tokens.background;
    }
    return target === 'dark'
        ? hslToHex(hue, clamp(sat * 0.65, 0.08, 0.3) * 100, 8)
        : hslToHex(hue, clamp(sat * 0.9, 0.1, 0.6) * 100, 97.5);
}

// ---------------------------------------------------------------------------
// Temas de empresa
// ---------------------------------------------------------------------------

export interface BrandThemes {
    light: ThemeDefinition;
    dark: ThemeDefinition;
    /** [light, dark]. */
    list: ThemeDefinition[];
    warnings: PaletteWarning[];
    /** true si el fondo de ese modo se derivo del otro (la empresa no lo definio). */
    derived: Record<ThemeMode, boolean>;
}

export const BRAND_LIGHT_ID = 'brand-light';
export const BRAND_DARK_ID = 'brand-dark';

function cleanName(name: unknown): string {
    if (typeof name !== 'string') return 'Empresa';
    const n = name.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 60);
    return n || 'Empresa';
}

/** Traduce los campos ANTIGUOS a tokens (marca comun + neutros del modo que corresponda al fondo). */
function legacyBase(cfg: DomainThemeConfig): { common: BaseTokens; neutrals: BaseTokens; neutralsMode: ThemeMode } {
    const common: BaseTokens = {};
    const neutrals: BaseTokens = {};
    if (cfg.primaryColor) common.primary = cfg.primaryColor;
    if (cfg.primaryForeground) common['primary-foreground'] = cfg.primaryForeground;
    if (cfg.accentColor) common['brand-accent'] = cfg.accentColor;
    if (cfg.accentForeground) common['brand-accent-foreground'] = cfg.accentForeground;

    const neutralsMode: ThemeMode = cfg.backgroundColor ? backgroundScheme(cfg.backgroundColor) : 'light';
    const bgForSecondary = cfg.backgroundColor ?? getTheme(neutralsMode)!.tokens.background;
    if (cfg.backgroundColor) neutrals.background = cfg.backgroundColor;
    if (cfg.textColor) neutrals.foreground = cfg.textColor;
    if (cfg.cardColor) { neutrals.card = cfg.cardColor; neutrals.popover = cfg.cardColor; }
    if (cfg.cardForeground) { neutrals['card-foreground'] = cfg.cardForeground; neutrals['popover-foreground'] = cfg.cardForeground; }
    if (cfg.mutedColor) neutrals.muted = cfg.mutedColor;
    if (cfg.mutedForeground) neutrals['muted-foreground'] = cfg.mutedForeground;
    if (cfg.borderColor) neutrals.border = cfg.borderColor;
    // Un secundario casi identico al fondo (el #ffffff por defecto del panel) no aporta nada.
    if (cfg.secondaryColor && contrast(cfg.secondaryColor, bgForSecondary) >= 1.08) {
        neutrals.secondary = cfg.secondaryColor;
        if (cfg.secondaryForeground) neutrals['secondary-foreground'] = cfg.secondaryForeground;
    }
    if (cfg.inputColor) neutrals.input = cfg.inputColor;
    if (cfg.ringColor) neutrals.ring = cfg.ringColor;
    return { common, neutrals, neutralsMode };
}

/**
 * Migra los campos ANTIGUOS de color (primaryColor, textColor, ...) a `palette` por modo, con la MISMA interpretacion
 * que buildBrandThemes (primario/acento en ambos modos; neutros en el modo del fondo). Devuelve una copia sin campos
 * antiguos de color; el resultado visual es identico. El editor del panel trabaja siempre sobre `palette`.
 */
export function migrateLegacyTheme(cfgInput: unknown): DomainThemeConfig {
    const cfg = sanitizeThemeConfig(cfgInput);
    const legacy = legacyBase(cfg);
    const out: DomainThemeConfig = { ...cfg };
    for (const f of LEGACY_COLOR_FIELDS) delete (out as Record<string, unknown>)[f];
    const light: BaseTokens = { ...legacy.common, ...(legacy.neutralsMode === 'light' ? legacy.neutrals : {}), ...(cfg.palette?.light ?? {}) };
    const dark: BaseTokens = { ...legacy.common, ...(legacy.neutralsMode === 'dark' ? legacy.neutrals : {}), ...(cfg.palette?.dark ?? {}) };
    const palette: ThemePalette = {};
    if (Object.keys(light).length) palette.light = light;
    if (Object.keys(dark).length) palette.dark = dark;
    if (palette.light || palette.dark) out.palette = palette; else delete out.palette;
    return out;
}

/**
 * Construye brand-light y brand-dark. Devuelve null si la empresa no definio ningun color.
 * `cfgInput` puede ser cualquier cosa: se sanea antes (idempotente).
 */
export function buildBrandThemes(cfgInput: unknown, opts: { name?: string } = {}): BrandThemes | null {
    const cfg = sanitizeThemeConfig(cfgInput);
    if (!hasBrandConfig(cfg)) return null;
    const autoFix = cfg.autoFixContrast !== false;
    const legacy = legacyBase(cfg);

    const base: Record<ThemeMode, BaseTokens> = {
        light: { ...legacy.common, ...(legacy.neutralsMode === 'light' ? legacy.neutrals : {}), ...(cfg.palette?.light ?? {}) },
        dark: { ...legacy.common, ...(legacy.neutralsMode === 'dark' ? legacy.neutrals : {}), ...(cfg.palette?.dark ?? {}) },
    };

    // Fondo efectivo por modo (solo si respeta el esquema; el aviso lo emite deriveFullPaletteDetailed).
    const validBg = (m: ThemeMode) => {
        const bg = normalizeThemeHex(base[m].background);
        return bg && backgroundScheme(bg) === m ? bg : null;
    };
    const derived: Record<ThemeMode, boolean> = { light: false, dark: false };
    for (const [m, o] of [['light', 'dark'], ['dark', 'light']] as const) {
        if (!validBg(m) && validBg(o)) {
            base[m] = { ...base[m], background: harmonicBackground(validBg(o)!, m, base[m].primary ?? base[o].primary) };
            derived[m] = true;
        }
    }

    const l = deriveFullPaletteDetailed(base.light, 'light', { autoFix });
    const d = deriveFullPaletteDetailed(base.dark, 'dark', { autoFix });
    const name = cleanName(opts.name);
    const mk = (id: string, scheme: ThemeMode, tokens: ThemeTokens): ThemeDefinition => ({
        id,
        label: `${name} · ${scheme === 'dark' ? 'Oscuro' : 'Claro'}`,
        description: scheme === 'dark' ? 'Paleta oscura de tu empresa.' : 'Paleta clara de tu empresa.',
        scheme,
        brandable: false,
        brand: true,
        tokens,
    });
    const light = mk(BRAND_LIGHT_ID, 'light', l.tokens);
    const dark = mk(BRAND_DARK_ID, 'dark', d.tokens);
    return { light, dark, list: [light, dark], warnings: [...l.warnings, ...d.warnings], derived };
}

/** Avisos de contraste/esquema de la configuracion (vacio si todo cumple o no hay marca). */
export function analyzeBrandTheme(cfgInput: unknown): PaletteWarning[] {
    return buildBrandThemes(cfgInput)?.warnings ?? [];
}

// ---------------------------------------------------------------------------
// Prueba local de un tema de empresa (solo desarrollo)
// ---------------------------------------------------------------------------

/**
 * Solo en desarrollo: NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE='{"primaryColor":"#7c3aed",...}' sustituye el tema que
 * devuelve /api/config (servidor y cliente), para ver un tema de empresa sin tocar la BD. Ignorado en produccion.
 * Devuelve la configuracion YA saneada o null si no hay override.
 */
export function getThemeOverride(): DomainThemeConfig | null {
    if (process.env.NODE_ENV === 'production') return null;
    const raw = process.env.NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE;
    if (!raw) return null;
    try { return sanitizeThemeConfig(JSON.parse(raw)); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Seleccion para la UI
// ---------------------------------------------------------------------------

/** Temas que el usuario puede elegir, en orden: empresa primero y despues los genericos permitidos. */
export function getSelectableThemes(brand: BrandThemes | null, policy: ThemePolicy): ThemeDefinition[] {
    const ids = getAvailableThemeIds(policy);
    const out: ThemeDefinition[] = [];
    for (const id of ids) {
        const th = brand && id === BRAND_LIGHT_ID ? brand.light : brand && id === BRAND_DARK_ID ? brand.dark : getTheme(id);
        if (th) out.push(th);
    }
    return out;
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

function decls(tokens: Partial<Record<TokenKey, string>>): string {
    return Object.entries(tokens).map(([k, v]) => `--color-${k}:${v}`).join(';');
}

/**
 * CSS de la empresa para <style id="bx-brand">. Vacio si no hay nada que aplicar.
 *   - :root[data-theme="brand-light|brand-dark"]: tokens completos de cada tema de empresa.
 *   - :root:not([data-theme]) y @media dark (pref system): respaldo sin JS segun defaultMode.
 *   - html:root { --radius / --font-body / --font-title }.
 */
export function buildBrandCss(cfgInput: unknown, opts: { name?: string } = {}): string {
    const cfg = sanitizeThemeConfig(cfgInput);
    const blocks: string[] = [];
    const bt = buildBrandThemes(cfg, opts);
    if (bt) {
        blocks.push(`:root[data-theme="${BRAND_LIGHT_ID}"]{color-scheme:light;${decls(bt.light.tokens)}}`);
        blocks.push(`:root[data-theme="${BRAND_DARK_ID}"]{color-scheme:dark;${decls(bt.dark.tokens)}}`);
        const policy = getThemePolicy(cfg);
        // Sin data-theme (sin JS / antes del script): claro por defecto; si el modo por defecto es 'system', oscuro segun el SO.
        blocks.push(`:root:not([data-theme]){${decls(bt.light.tokens)}}`);
        if (policy.defaultMode === 'system') {
            blocks.push(`@media (prefers-color-scheme:dark){:root[data-theme-pref="system"]:not([data-theme]){color-scheme:dark;${decls(bt.dark.tokens)};${darkPaletteRemap()}}}`);
        }
    }

    const root: string[] = [];
    const family = resolveFontStack(cfg.fontFamily);
    const body = family ?? legacyFontStack(cfg.bodyFont);
    const title = family ?? legacyFontStack(cfg.titleFont);
    if (body) root.push(`--font-body:${body}`);
    if (title) root.push(`--font-title:${title}`);
    const radius = resolveRadiusRem(cfg);
    if (radius !== null) root.push(`--radius:${radius}rem`);
    if (root.length) blocks.push(`html:root{${root.join(';')}}`);

    return blocks.join('\n');
}


