'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { Locale } from '@/lib/i18n';
import type { DomainThemeConfig } from '@/lib/themes';
import {
    LANDING_ALIGNMENTS, LANDING_BACKGROUND_TYPES, LANDING_ICONS, LANDING_IMAGE_POSITIONS, LANDING_LAYOUTS,
    LANDING_LIMITS, LANDING_LOCALES, LANDING_LOGO_POSITIONS, LANDING_MAX_BYTES, LANDING_MOBILE_HERO,
    LANDING_PATTERNS, LANDING_TESTIMONIAL_STYLES, LANDING_TEXT_KEYS, LANDING_TEXT_LIMITS, LANDING_TEXT_PATHS,
    sanitizeLandingConfigDetailed, type LandingConfig, type LandingIssue, type LandingLayout, type LandingTextKey,
} from '@/lib/landing-config';
import { LandingPreview } from './LandingPreview';

// ---------------------------------------------------------------------------
// Textos de la interfaz del editor (locales al componente: no toca los diccionarios globales)
// ---------------------------------------------------------------------------

const T = {
    es: {
        title: 'Pantalla de acceso',
        intro: 'Configura la pantalla de inicio de sesión y registro de tu empresa. Sin configuración se usa el diseño estándar.',
        size: 'Tamaño de la configuración',
        issues: 'Avisos de validación',
        noIssues: 'Todo válido.',
        tooLarge: 'La configuración supera el máximo y no se guardará.',
        layout: 'Diseño', layoutHelp: 'Dónde va el panel de acceso.',
        'layout.split-left': 'Panel a la izquierda', 'layout.split-right': 'Panel a la derecha', 'layout.center': 'Centrado',
        'layout.fullscreen-bg': 'Sobre fondo completo', 'layout.minimal': 'Mínimo',
        panelWidth: 'Ancho del panel (px)', mobileHero: 'Hero en móvil', 'mobile.banner': 'Banner compacto arriba', 'mobile.hidden': 'Oculto (solo marca)',
        alignment: 'Alineación del formulario', 'align.left': 'Izquierda', 'align.center': 'Centro',
        texts: 'Textos', textsHelp: 'El texto por idioma gana sobre el base; si falta, se usa el del sistema.',
        base: 'Base (todos)', imageAlt: 'Texto alternativo de la imagen',
        heroTitle: 'Título del hero', heroSubtitle: 'Subtítulo del hero', heroBadge: 'Insignia', formTitle: 'Título del formulario',
        formSubtitle: 'Subtítulo del formulario', submitLabel: 'Botón de entrar', registerTitle: 'Título del registro',
        registerSubtitle: 'Subtítulo del registro', registerSubmitLabel: 'Botón de registrarse', footerText: 'Texto del pie',
        registrationMessage: 'Mensaje de registro cerrado',
        hero: 'Imagen y fondo del hero', imageUrl: 'URL de imagen (https)', imagePosition: 'Posición de la imagen', overlay: 'Velo oscuro',
        overlayHelp: 'El sistema sube el velo si hace falta para que el texto cumpla contraste AA.',
        gradient: 'Degradado', useGradient: 'Usar degradado', from: 'Desde', to: 'Hasta', angle: 'Ángulo (°)', pattern: 'Trama',
        'pos.center': 'Centro', 'pos.top': 'Arriba', 'pos.bottom': 'Abajo', 'pos.left': 'Izquierda', 'pos.right': 'Derecha',
        'pattern.none': 'Ninguna', 'pattern.dots': 'Puntos', 'pattern.grid': 'Cuadrícula', 'pattern.diagonal': 'Diagonal',
        logo: 'Logo', logoLight: 'Logo modo claro (https)', logoDark: 'Logo modo oscuro (https)', logoHeight: 'Altura del logo (px)',
        logoPosition: 'Posición del logo', 'lp.panel': 'En el panel', 'lp.hero': 'En el hero', 'lp.header': 'Cabecera', showName: 'Mostrar el nombre junto al logo',
        background: 'Fondo de página', bgHelp: 'Para diseños centrado, mínimo y fondo completo.', bgType: 'Tipo', 'bg.none': 'Ninguno',
        'bg.color': 'Color', 'bg.gradient': 'Degradado', 'bg.image': 'Imagen', color: 'Color',
        form: 'Formulario', showRegisterLink: 'Mostrar enlace a registro', showForgotLink: 'Mostrar “olvidé mi contraseña”',
        showGoogle: 'Mostrar “Continuar con Google”', showRememberMe: 'Mostrar “Recordarme”',
        formHint: 'Google, “olvidé mi contraseña” y “Recordarme” solo aparecen cuando la instancia ofrece ese flujo.',
        testimonials: 'Testimonios', enabled: 'Mostrar testimonios', style: 'Estilo', 'ts.cards': 'Tarjetas', 'ts.carousel': 'Carrusel', 'ts.quote': 'Cita única',
        quote: 'Testimonio', author: 'Autor', role: 'Cargo', avatarUrl: 'Avatar (https)',
        features: 'Características', icon: 'Icono', featureTitle: 'Título', featureText: 'Descripción',
        stats: 'Cifras', value: 'Valor', label: 'Etiqueta',
        footer: 'Pie de página y legales', linkLabel: 'Texto del enlace', linkUrl: 'URL (https o ruta /...)', showPoweredBy: 'Mostrar “con tecnología de Bloomx”',
        termsUrl: 'URL de términos', privacyUrl: 'URL de privacidad',
        docs: 'Documentación', docsVisible: 'Documentación visible (si se oculta, /docs muestra un 404 amable)',
        docsFooter: 'Enlace en el pie', docsSidebar: 'Enlace en la barra lateral / ajustes', docsLanding: 'Enlace en la pantalla de acceso',
        registration: 'Registro', regEnabled: 'Permitir registro', regKey: 'Pedir clave de registro',
        regHint: 'La clave y el cierre del registro los aplica también el servidor; esto controla lo que se muestra.',
        language: 'Idioma de la pantalla', 'lang.auto': 'Automático (el del visitante)',
        add: 'Añadir', remove: 'Eliminar', up: 'Subir', down: 'Bajar', item: 'Elemento',
        'issue.truncated': 'Se recortará por exceder el máximo.', 'issue.html_removed': 'Se quitará el HTML.',
        'issue.invalid_url': 'URL no válida.', 'issue.not_https': 'Solo se admite https.', 'issue.invalid_color': 'Color no válido (#rgb o #rrggbb).',
        'issue.invalid_value': 'Valor no permitido.', 'issue.clamped': 'Se ajustará al rango permitido.',
        'issue.too_many_items': 'Demasiados elementos: se descartarán los sobrantes.', 'issue.missing_field': 'Falta un campo obligatorio: se descartará.',
        'issue.too_large': 'Demasiado grande.', 'issue.invalid': 'Configuración no válida.',
    },
    en: {
        title: 'Sign-in screen',
        intro: 'Configure your organization\'s sign-in and registration screen. Without configuration the standard design is used.',
        size: 'Configuration size',
        issues: 'Validation notices',
        noIssues: 'Everything is valid.',
        tooLarge: 'The configuration exceeds the maximum and will not be saved.',
        layout: 'Layout', layoutHelp: 'Where the sign-in panel goes.',
        'layout.split-left': 'Panel on the left', 'layout.split-right': 'Panel on the right', 'layout.center': 'Centered',
        'layout.fullscreen-bg': 'Over full background', 'layout.minimal': 'Minimal',
        panelWidth: 'Panel width (px)', mobileHero: 'Hero on mobile', 'mobile.banner': 'Compact banner on top', 'mobile.hidden': 'Hidden (brand only)',
        alignment: 'Form alignment', 'align.left': 'Left', 'align.center': 'Center',
        texts: 'Texts', textsHelp: 'The per-language text wins over the base one; if missing, the system text is used.',
        base: 'Base (all)', imageAlt: 'Image alternative text',
        heroTitle: 'Hero title', heroSubtitle: 'Hero subtitle', heroBadge: 'Badge', formTitle: 'Form title',
        formSubtitle: 'Form subtitle', submitLabel: 'Sign-in button', registerTitle: 'Registration title',
        registerSubtitle: 'Registration subtitle', registerSubmitLabel: 'Register button', footerText: 'Footer text',
        registrationMessage: 'Registration closed message',
        hero: 'Hero image and background', imageUrl: 'Image URL (https)', imagePosition: 'Image position', overlay: 'Dark overlay',
        overlayHelp: 'The system raises the overlay when needed so the text meets AA contrast.',
        gradient: 'Gradient', useGradient: 'Use gradient', from: 'From', to: 'To', angle: 'Angle (°)', pattern: 'Pattern',
        'pos.center': 'Center', 'pos.top': 'Top', 'pos.bottom': 'Bottom', 'pos.left': 'Left', 'pos.right': 'Right',
        'pattern.none': 'None', 'pattern.dots': 'Dots', 'pattern.grid': 'Grid', 'pattern.diagonal': 'Diagonal',
        logo: 'Logo', logoLight: 'Light mode logo (https)', logoDark: 'Dark mode logo (https)', logoHeight: 'Logo height (px)',
        logoPosition: 'Logo position', 'lp.panel': 'In the panel', 'lp.hero': 'In the hero', 'lp.header': 'Header', showName: 'Show the name next to the logo',
        background: 'Page background', bgHelp: 'For centered, minimal and full-background layouts.', bgType: 'Type', 'bg.none': 'None',
        'bg.color': 'Color', 'bg.gradient': 'Gradient', 'bg.image': 'Image', color: 'Color',
        form: 'Form', showRegisterLink: 'Show link to registration', showForgotLink: 'Show "forgot password"',
        showGoogle: 'Show "Continue with Google"', showRememberMe: 'Show "Remember me"',
        formHint: 'Google, "forgot password" and "Remember me" only appear when the instance offers that flow.',
        testimonials: 'Testimonials', enabled: 'Show testimonials', style: 'Style', 'ts.cards': 'Cards', 'ts.carousel': 'Carousel', 'ts.quote': 'Single quote',
        quote: 'Testimonial', author: 'Author', role: 'Role', avatarUrl: 'Avatar (https)',
        features: 'Features', icon: 'Icon', featureTitle: 'Title', featureText: 'Description',
        stats: 'Key figures', value: 'Value', label: 'Label',
        footer: 'Footer and legal', linkLabel: 'Link text', linkUrl: 'URL (https or /path)', showPoweredBy: 'Show "Powered by Bloomx"',
        termsUrl: 'Terms URL', privacyUrl: 'Privacy URL',
        docs: 'Documentation', docsVisible: 'Documentation visible (if hidden, /docs shows a friendly 404)',
        docsFooter: 'Link in the footer', docsSidebar: 'Link in the sidebar / settings', docsLanding: 'Link on the sign-in screen',
        registration: 'Registration', regEnabled: 'Allow registration', regKey: 'Ask for registration key',
        regHint: 'The key and registration closing are also enforced by the server; this controls what is shown.',
        language: 'Screen language', 'lang.auto': 'Automatic (visitor\'s)',
        add: 'Add', remove: 'Remove', up: 'Move up', down: 'Move down', item: 'Item',
        'issue.truncated': 'Will be trimmed: over the maximum.', 'issue.html_removed': 'HTML will be removed.',
        'issue.invalid_url': 'Invalid URL.', 'issue.not_https': 'Only https is allowed.', 'issue.invalid_color': 'Invalid color (#rgb or #rrggbb).',
        'issue.invalid_value': 'Value not allowed.', 'issue.clamped': 'Will be clamped to the allowed range.',
        'issue.too_many_items': 'Too many items: extras will be discarded.', 'issue.missing_field': 'Required field missing: it will be discarded.',
        'issue.too_large': 'Too large.', 'issue.invalid': 'Invalid configuration.',
    },
} as const;
type Msg = Record<string, string>;

// ---------------------------------------------------------------------------
// Utilidades de edicion
// ---------------------------------------------------------------------------

function isEmpty(v: unknown): boolean {
    if (v === undefined || v === null || v === '') return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') return Object.keys(v as object).length === 0;
    return false;
}

/** Quita valores vacios (undefined, '', {}, []) recursivamente para mantener el JSON pequeno. */
function prune<T>(v: T): T | undefined {
    if (Array.isArray(v)) {
        // Los elementos vacios se conservan ({}): un elemento recien anadido no debe desaparecer al editarlo.
        const arr = v.map((x) => (prune(x) ?? {}));
        return (arr.length ? arr : undefined) as T | undefined;
    }
    if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
            const p = prune(x);
            if (p !== undefined && !isEmpty(p)) out[k] = p;
        }
        return (Object.keys(out).length ? out : undefined) as T | undefined;
    }
    return isEmpty(v) ? undefined : v;
}

function setIn(root: Record<string, unknown>, path: (string | number)[], value: unknown): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...root };
    let cur: Record<string, unknown> | unknown[] = copy;
    for (let i = 0; i < path.length - 1; i++) {
        const k = path[i];
        const next = (cur as Record<string, unknown>)[k as string];
        const clone = Array.isArray(next) ? [...next] : next && typeof next === 'object' ? { ...(next as object) } : typeof path[i + 1] === 'number' ? [] : {};
        (cur as Record<string, unknown>)[k as string] = clone;
        cur = clone as Record<string, unknown>;
    }
    (cur as Record<string, unknown>)[path[path.length - 1] as string] = value;
    return copy;
}

function getIn(root: unknown, path: (string | number)[]): unknown {
    let cur: unknown = root;
    for (const k of path) {
        if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[k as string];
        else return undefined;
    }
    return cur;
}

// ---------------------------------------------------------------------------
// Controles
// ---------------------------------------------------------------------------

const inputClass = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
const btnClass = 'inline-flex h-8 items-center justify-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40';

interface Ctx {
    m: Msg;
    issues: LandingIssue[];
}

function IssuesFor({ ctx, path }: { ctx: Ctx; path: string }) {
    const found = ctx.issues.filter((i) => i.path === path || i.path.startsWith(path + '.') || i.path.startsWith(path + '['));
    if (!found.length) return null;
    return (
        <ul className="mt-1 space-y-0.5" role="alert">
            {found.map((i, n) => <li key={n} className="text-xs text-destructive">{ctx.m[`issue.${i.code}`] || i.code}</li>)}
        </ul>
    );
}

function Field({ label, children, counter, id }: { label: string; children: ReactNode; counter?: ReactNode; id: string }) {
    return (
        <div className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
                <label htmlFor={id} className="text-sm font-medium">{label}</label>
                {counter}
            </div>
            {children}
        </div>
    );
}

function Counter({ value, max }: { value: string; max: number }) {
    const over = value.length > max;
    return <span className={`text-xs tabular-nums ${over ? 'font-semibold text-destructive' : 'text-muted-foreground'}`} aria-label={`${value.length} / ${max}`}>{value.length}/{max}</span>;
}

function TextField({ ctx, path, root, set, label, max, multiline, placeholder }: {
    ctx: Ctx; path: (string | number)[]; root: unknown; set: (path: (string | number)[], v: unknown) => void;
    label: string; max: number; multiline?: boolean; placeholder?: string;
}) {
    const id = useId();
    const value = (getIn(root, path) as string | undefined) ?? '';
    const p = path.map((x) => (typeof x === 'number' ? `[${x}]` : `.${x}`)).join('').replace(/^\./, '');
    const props = {
        id, value, placeholder, maxLength: max + 40, 'aria-describedby': `${id}-err`,
        onChange: (e: { target: { value: string } }) => set(path, e.target.value),
    };
    return (
        <Field id={id} label={label} counter={<Counter value={value} max={max} />}>
            {multiline ? <textarea rows={3} className={`${inputClass} h-auto py-2`} {...props} /> : <input type="text" className={inputClass} {...props} />}
            <div id={`${id}-err`}><IssuesFor ctx={ctx} path={p} /></div>
        </Field>
    );
}

function UrlField(props: { ctx: Ctx; path: (string | number)[]; root: unknown; set: (path: (string | number)[], v: unknown) => void; label: string; placeholder?: string }) {
    return <TextField {...props} max={LANDING_LIMITS.url} placeholder={props.placeholder || 'https://...'} />;
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
    const id = useId();
    return (
        <div className="flex items-start gap-3">
            <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <label htmlFor={id} className="text-sm">
                {label}
                {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
            </label>
        </div>
    );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
    const id = useId();
    return (
        <Field id={id} label={label}>
            <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
                {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
        </Field>
    );
}

function RangeField({ label, value, min, max, step, onChange, hint }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; hint?: string }) {
    const id = useId();
    return (
        <Field id={id} label={label} counter={<span className="text-xs tabular-nums text-muted-foreground">{value}</span>}>
            <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-primary" />
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </Field>
    );
}

function ColorField({ ctx, label, value, onChange, path }: { ctx: Ctx; label: string; value: string; onChange: (v: string) => void; path: string }) {
    const id = useId();
    const valid = /^#[0-9a-f]{6}$/i.test(value);
    return (
        <Field id={id} label={label}>
            <div className="flex items-center gap-2">
                <input aria-label={`${label} (picker)`} type="color" value={valid ? value : '#000000'} onChange={(e) => onChange(e.target.value)} className="h-9 w-12 cursor-pointer rounded-md border border-input bg-background p-1" />
                <input id={id} type="text" className={inputClass} value={value} maxLength={7} placeholder="#rrggbb" onChange={(e) => onChange(e.target.value)} />
            </div>
            <IssuesFor ctx={ctx} path={path} />
        </Field>
    );
}

function Section({ title, hint, defaultOpen, children }: { title: string; hint?: string; defaultOpen?: boolean; children: ReactNode }) {
    const [open, setOpen] = useState(!!defaultOpen);
    const id = useId();
    return (
        <section className="rounded-lg border border-border bg-card text-card-foreground">
            <h3>
                <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-2 rounded-lg px-4 py-3 text-left text-sm font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {title}
                    <span aria-hidden="true" className="text-muted-foreground">{open ? '−' : '+'}</span>
                </button>
            </h3>
            {open && (
                <div id={id} className="grid gap-4 border-t border-border px-4 py-4">
                    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
                    {children}
                </div>
            )}
        </section>
    );
}

function ListEditor<TItem>({ ctx, items, max, blank, onChange, render, title }: {
    ctx: Ctx; items: TItem[]; max: number; blank: () => TItem; onChange: (next: TItem[]) => void;
    render: (item: TItem, index: number) => ReactNode; title: string;
}) {
    const { m } = ctx;
    const move = (i: number, d: number) => {
        const j = i + d;
        if (j < 0 || j >= items.length) return;
        const next = [...items];
        [next[i], next[j]] = [next[j], next[i]];
        onChange(next);
    };
    return (
        <div className="grid gap-3">
            {items.map((item, i) => (
                <fieldset key={i} className="grid gap-3 rounded-md border border-border p-3">
                    <legend className="px-1 text-xs font-medium text-muted-foreground">{title} {i + 1}</legend>
                    {render(item, i)}
                    <div className="flex flex-wrap gap-2">
                        <button type="button" className={btnClass} onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${m.up} ${i + 1}`}><ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />{m.up}</button>
                        <button type="button" className={btnClass} onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label={`${m.down} ${i + 1}`}><ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />{m.down}</button>
                        <button type="button" className={`${btnClass} text-destructive`} onClick={() => onChange(items.filter((_, k) => k !== i))} aria-label={`${m.remove} ${i + 1}`}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{m.remove}</button>
                    </div>
                </fieldset>
            ))}
            <div className="flex items-center justify-between gap-2">
                <button type="button" className={btnClass} onClick={() => onChange([...items, blank()])} disabled={items.length >= max}>
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />{m.add}
                </button>
                <span className="text-xs tabular-nums text-muted-foreground">{items.length}/{max}</span>
            </div>
        </div>
    );
}

/** Esquema visual de cada layout (botones de seleccion). */
function LayoutThumb({ layout }: { layout: LandingLayout }) {
    const panel = <div className="rounded-sm bg-card ring-1 ring-border" />;
    const hero = <div className="rounded-sm bg-primary" />;
    const base = 'grid h-14 w-full gap-1 rounded-md bg-muted p-1';
    switch (layout) {
        case 'split-left': return <div aria-hidden="true" className={`${base} grid-cols-2`}>{panel}{hero}</div>;
        case 'split-right': return <div aria-hidden="true" className={`${base} grid-cols-2`}>{hero}{panel}</div>;
        case 'center': return <div aria-hidden="true" className={`${base} place-items-center`}><div className="h-full w-1/2 rounded-sm bg-card ring-1 ring-border" /></div>;
        case 'fullscreen-bg': return <div aria-hidden="true" className={`${base} place-items-center bg-primary`}><div className="h-full w-1/2 rounded-sm bg-card" /></div>;
        default: return <div aria-hidden="true" className={`${base} place-items-center`}><div className="h-3/4 w-2/5 rounded-sm bg-card ring-1 ring-border" /></div>;
    }
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export interface LandingEditorProps {
    /** Landing actual (Domain.theme.landing). Puede venir vacia/undefined. */
    value: LandingConfig | null | undefined;
    onChange: (next: LandingConfig) => void;
    /** Idioma de la interfaz del editor. */
    locale: Locale;
    /** Marca para la vista previa. */
    brandName?: string;
    brandLogo?: string | null;
    themeConfig?: DomainThemeConfig | null;
    /** false = solo controles (el llamador monta <LandingPreview/> donde quiera). */
    showPreview?: boolean;
}

export function LandingEditor({ value, onChange, locale, brandName, brandLogo, themeConfig, showPreview = true }: LandingEditorProps) {
    const m = (T[locale] || T.es) as unknown as Msg;
    const root = (value || {}) as Record<string, unknown>;
    const result = useMemo(() => sanitizeLandingConfigDetailed(value || {}), [value]);
    const ctx: Ctx = { m, issues: result.issues };
    const [textTab, setTextTab] = useState<'base' | 'es' | 'en'>('base');

    const set = (path: (string | number)[], v: unknown) => {
        const next = prune(setIn(root, path, v)) as LandingConfig | undefined;
        onChange((next || {}) as LandingConfig);
    };
    const get = (path: (string | number)[]) => getIn(root, path);
    const str = (path: (string | number)[]) => (get(path) as string | undefined) ?? '';
    const bool = (path: (string | number)[], dflt: boolean) => {
        const v = get(path);
        return typeof v === 'boolean' ? v : dflt;
    };
    const tf = (path: (string | number)[], label: string, max: number, multiline?: boolean) => (
        <TextField ctx={ctx} root={root} set={set} path={path} label={label} max={max} multiline={multiline} />
    );
    const uf = (path: (string | number)[], label: string) => <UrlField ctx={ctx} root={root} set={set} path={path} label={label} />;
    const opts = (list: readonly string[], prefix: string): [string, string][] => list.map((v) => [v, m[`${prefix}.${v}`] || v]);

    const layout = (str(['layout']) || 'split-right') as LandingLayout;
    const overSize = result.bytes > LANDING_MAX_BYTES;
    const pct = Math.min(100, Math.round((result.bytes / LANDING_MAX_BYTES) * 100));

    // ---- textos ----
    const textPath = (key: LandingTextKey): (string | number)[] => (textTab === 'base' ? [...LANDING_TEXT_PATHS[key]] : ['i18n', textTab, key]);

    // ---- listas ----
    const testimonials = ((get(['testimonials', 'items']) as unknown[]) || []) as Record<string, string>[];
    const features = ((get(['features']) as unknown[]) || []) as Record<string, string>[];
    const stats = ((get(['stats']) as unknown[]) || []) as Record<string, string>[];
    const links = ((get(['footer', 'links']) as unknown[]) || []) as Record<string, string>[];
    const gradient = get(['hero', 'gradient']) as { from?: string; to?: string; angle?: number } | undefined;
    const bgGradient = get(['background', 'gradient']) as { from?: string; to?: string; angle?: number } | undefined;
    const bgType = str(['background', 'type']);

    const gradientControls = (path: string[], g: { from?: string; to?: string; angle?: number } | undefined) => (
        <div className="grid gap-3 sm:grid-cols-3">
            <ColorField ctx={ctx} label={m.from} value={g?.from ?? ''} path={`${path.join('.')}.from`} onChange={(v) => set(path, { from: v, to: g?.to ?? '', angle: g?.angle ?? 135 })} />
            <ColorField ctx={ctx} label={m.to} value={g?.to ?? ''} path={`${path.join('.')}.to`} onChange={(v) => set(path, { from: g?.from ?? '', to: v, angle: g?.angle ?? 135 })} />
            <RangeField label={m.angle} value={g?.angle ?? 135} min={0} max={360} step={5} onChange={(v) => set(path, { from: g?.from ?? '', to: g?.to ?? '', angle: v })} />
        </div>
    );

    const controls = (
        <div className="grid gap-3">
            <div>
                <h2 className="text-lg font-semibold">{m.title}</h2>
                <p className="text-sm text-muted-foreground">{m.intro}</p>
            </div>

            {/* Estado: tamano + validacion en vivo */}
            <div className="rounded-lg border border-border bg-card p-3 text-card-foreground" aria-live="polite">
                <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{m.size}</span>
                    <span className={`tabular-nums ${overSize ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>{(result.bytes / 1024).toFixed(1)} / {LANDING_MAX_BYTES / 1024} KB</span>
                </div>
                <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={m.size} className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={`h-full ${overSize ? 'bg-destructive' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
                </div>
                {overSize && <p role="alert" className="mt-2 text-xs text-destructive">{m.tooLarge}</p>}
                <p className="mt-2 text-xs font-medium">{m.issues}</p>
                {result.issues.length === 0
                    ? <p className="text-xs text-muted-foreground">{m.noIssues}</p>
                    : <ul className="mt-1 max-h-28 space-y-0.5 overflow-auto">{result.issues.map((i, n) => <li key={n} className="text-xs text-destructive"><code>{i.path || '·'}</code>: {m[`issue.${i.code}`] || i.code}</li>)}</ul>}
            </div>

            <Section title={m.layout} hint={m.layoutHelp} defaultOpen>
                <div role="radiogroup" aria-label={m.layout} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {LANDING_LAYOUTS.map((l) => (
                        <button key={l} type="button" role="radio" aria-checked={layout === l} onClick={() => set(['layout'], l)}
                            className={`grid gap-1.5 rounded-lg border p-2 text-left text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${layout === l ? 'border-primary ring-2 ring-primary' : 'border-border hover:bg-accent'}`}>
                            <LayoutThumb layout={l} />
                            {m[`layout.${l}`]}
                        </button>
                    ))}
                </div>
                <RangeField label={m.panelWidth} value={Number(get(['panelWidth'])) || 350} min={LANDING_LIMITS.panelWidthMin} max={LANDING_LIMITS.panelWidthMax} step={10} onChange={(v) => set(['panelWidth'], v)} />
                <SelectField label={m.mobileHero} value={str(['hero', 'mobile']) || 'hidden'} options={opts(LANDING_MOBILE_HERO, 'mobile')} onChange={(v) => set(['hero', 'mobile'], v)} />
                <SelectField label={m.alignment} value={str(['form', 'alignment']) || 'center'} options={opts(LANDING_ALIGNMENTS, 'align')} onChange={(v) => set(['form', 'alignment'], v)} />
                <SelectField label={m.language} value={str(['locale'])} options={[['', m['lang.auto']], ...LANDING_LOCALES.map((l): [string, string] => [l, l.toUpperCase()])]} onChange={(v) => set(['locale'], v)} />
            </Section>

            <Section title={m.texts} hint={m.textsHelp}>
                <div role="tablist" aria-label={m.texts} className="inline-flex w-fit rounded-lg border border-border bg-background p-1">
                    {([['base', m.base], ['es', 'ES'], ['en', 'EN']] as const).map(([id, label]) => (
                        <button key={id} type="button" role="tab" aria-selected={textTab === id} onClick={() => setTextTab(id)}
                            className={`h-8 rounded-md px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${textTab === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}>
                            {label}
                        </button>
                    ))}
                </div>
                {LANDING_TEXT_KEYS.map((key) => (
                    <TextField key={`${textTab}-${key}`} ctx={ctx} root={root} set={set} path={textPath(key)} label={m[key] || key} max={LANDING_TEXT_LIMITS[key]} multiline={key.toLowerCase().includes('subtitle') || key === 'registrationMessage' || key === 'footerText'} />
                ))}
            </Section>

            <Section title={m.hero}>
                {uf(['hero', 'imageUrl'], m.imageUrl)}
                <SelectField label={m.imagePosition} value={str(['hero', 'imagePosition']) || 'center'} options={opts(LANDING_IMAGE_POSITIONS, 'pos')} onChange={(v) => set(['hero', 'imagePosition'], v)} />
                <RangeField label={m.overlay} value={Number(get(['hero', 'overlay'])) || 0} min={0} max={1} step={0.05} hint={m.overlayHelp} onChange={(v) => set(['hero', 'overlay'], v)} />
                <Toggle label={m.useGradient} checked={!!gradient} onChange={(on) => set(['hero', 'gradient'], on ? { from: '#1e3a8a', to: '#7c3aed', angle: 135 } : undefined)} />
                {gradient && gradientControls(['hero', 'gradient'], gradient)}
                <SelectField label={m.pattern} value={str(['hero', 'pattern']) || 'none'} options={opts(LANDING_PATTERNS, 'pattern')} onChange={(v) => set(['hero', 'pattern'], v === 'none' ? undefined : v)} />
            </Section>

            <Section title={m.logo}>
                {uf(['logo', 'light'], m.logoLight)}
                {uf(['logo', 'dark'], m.logoDark)}
                <RangeField label={m.logoHeight} value={Number(get(['logo', 'height'])) || 24} min={LANDING_LIMITS.logoHeightMin} max={LANDING_LIMITS.logoHeightMax} step={2} onChange={(v) => set(['logo', 'height'], v)} />
                <SelectField label={m.logoPosition} value={str(['logo', 'position']) || 'hero'} options={opts(LANDING_LOGO_POSITIONS, 'lp')} onChange={(v) => set(['logo', 'position'], v)} />
                <Toggle label={m.showName} checked={bool(['logo', 'showName'], true)} onChange={(v) => set(['logo', 'showName'], v)} />
            </Section>

            <Section title={m.background} hint={m.bgHelp}>
                <SelectField label={m.bgType} value={bgType} options={[['', m['bg.none']], ...opts(LANDING_BACKGROUND_TYPES, 'bg')]} onChange={(v) => set(['background', 'type'], v)} />
                {bgType === 'color' && <ColorField ctx={ctx} label={m.color} value={str(['background', 'color'])} path="background.color" onChange={(v) => set(['background', 'color'], v)} />}
                {bgType === 'gradient' && gradientControls(['background', 'gradient'], bgGradient)}
                {bgType === 'image' && (
                    <>
                        {uf(['background', 'imageUrl'], m.imageUrl)}
                        <RangeField label={m.overlay} value={Number(get(['background', 'overlay'])) || 0} min={0} max={1} step={0.05} hint={m.overlayHelp} onChange={(v) => set(['background', 'overlay'], v)} />
                    </>
                )}
            </Section>

            <Section title={m.form} hint={m.formHint}>
                <Toggle label={m.showRegisterLink} checked={bool(['form', 'showRegisterLink'], true)} onChange={(v) => set(['form', 'showRegisterLink'], v)} />
                <Toggle label={m.showForgotLink} checked={bool(['form', 'showForgotLink'], false)} onChange={(v) => set(['form', 'showForgotLink'], v)} />
                <Toggle label={m.showGoogle} checked={bool(['form', 'showGoogle'], false)} onChange={(v) => set(['form', 'showGoogle'], v)} />
                <Toggle label={m.showRememberMe} checked={bool(['form', 'showRememberMe'], false)} onChange={(v) => set(['form', 'showRememberMe'], v)} />
            </Section>

            <Section title={m.testimonials}>
                <Toggle label={m.enabled} checked={bool(['testimonials', 'enabled'], false)} onChange={(v) => set(['testimonials', 'enabled'], v)} />
                <SelectField label={m.style} value={str(['testimonials', 'style']) || 'cards'} options={opts(LANDING_TESTIMONIAL_STYLES, 'ts')} onChange={(v) => set(['testimonials', 'style'], v)} />
                <ListEditor ctx={ctx} title={m.item} items={testimonials} max={LANDING_LIMITS.testimonials} blank={() => ({ quote: '', author: '' })}
                    onChange={(next) => set(['testimonials', 'items'], next)}
                    render={(_, i) => (
                        <>
                            {tf(['testimonials', 'items', i, 'quote'], m.quote, LANDING_LIMITS.quote, true)}
                            {tf(['testimonials', 'items', i, 'author'], m.author, LANDING_LIMITS.author)}
                            {tf(['testimonials', 'items', i, 'role'], m.role, LANDING_LIMITS.role)}
                            {uf(['testimonials', 'items', i, 'avatarUrl'], m.avatarUrl)}
                        </>
                    )} />
            </Section>

            <Section title={m.features}>
                <ListEditor ctx={ctx} title={m.item} items={features} max={LANDING_LIMITS.features} blank={() => ({ icon: 'check', title: '' })}
                    onChange={(next) => set(['features'], next)}
                    render={(_, i) => (
                        <>
                            <SelectField label={m.icon} value={str(['features', i, 'icon']) || 'check'} options={LANDING_ICONS.map((v): [string, string] => [v, v])} onChange={(v) => set(['features', i, 'icon'], v)} />
                            {tf(['features', i, 'title'], m.featureTitle, LANDING_LIMITS.featureTitle)}
                            {tf(['features', i, 'text'], m.featureText, LANDING_LIMITS.featureText, true)}
                        </>
                    )} />
            </Section>

            <Section title={m.stats}>
                <ListEditor ctx={ctx} title={m.item} items={stats} max={LANDING_LIMITS.stats} blank={() => ({ value: '', label: '' })}
                    onChange={(next) => set(['stats'], next)}
                    render={(_, i) => (
                        <>
                            {tf(['stats', i, 'value'], m.value, LANDING_LIMITS.statValue)}
                            {tf(['stats', i, 'label'], m.label, LANDING_LIMITS.statLabel)}
                        </>
                    )} />
            </Section>

            <Section title={m.footer}>
                <ListEditor ctx={ctx} title={m.item} items={links} max={LANDING_LIMITS.links} blank={() => ({ label: '', url: '' })}
                    onChange={(next) => set(['footer', 'links'], next)}
                    render={(_, i) => (
                        <>
                            {tf(['footer', 'links', i, 'label'], m.linkLabel, LANDING_LIMITS.linkLabel)}
                            <TextField ctx={ctx} root={root} set={set} path={['footer', 'links', i, 'url']} label={m.linkUrl} max={LANDING_LIMITS.url} />
                        </>
                    )} />
                <Toggle label={m.showPoweredBy} checked={bool(['footer', 'showPoweredBy'], false)} onChange={(v) => set(['footer', 'showPoweredBy'], v)} />
                <TextField ctx={ctx} root={root} set={set} path={['legal', 'termsUrl']} label={m.termsUrl} max={LANDING_LIMITS.url} />
                <TextField ctx={ctx} root={root} set={set} path={['legal', 'privacyUrl']} label={m.privacyUrl} max={LANDING_LIMITS.url} />
            </Section>

            <Section title={m.docs}>
                <Toggle label={m.docsVisible} checked={bool(['docs', 'visible'], true)} onChange={(v) => set(['docs', 'visible'], v)} />
                <Toggle label={m.docsLanding} checked={bool(['docs', 'landingLink'], true)} onChange={(v) => set(['docs', 'landingLink'], v)} />
                <Toggle label={m.docsFooter} checked={bool(['docs', 'showInFooter'], false)} onChange={(v) => set(['docs', 'showInFooter'], v)} />
                <Toggle label={m.docsSidebar} checked={bool(['docs', 'showInSidebar'], true)} onChange={(v) => set(['docs', 'showInSidebar'], v)} />
            </Section>

            <Section title={m.registration} hint={m.regHint}>
                <Toggle label={m.regEnabled} checked={bool(['registration', 'enabled'], true)} onChange={(v) => set(['registration', 'enabled'], v)} />
                <Toggle label={m.regKey} checked={bool(['registration', 'requireKey'], true)} onChange={(v) => set(['registration', 'requireKey'], v)} />
            </Section>
        </div>
    );

    if (!showPreview) return controls;
    return (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
            {controls}
            <div className="xl:sticky xl:top-4 xl:self-start">
                <LandingPreview value={value || {}} locale={locale} brandName={brandName} brandLogo={brandLogo} themeConfig={themeConfig} />
            </div>
        </div>
    );
}

export { LandingPreview } from './LandingPreview';
