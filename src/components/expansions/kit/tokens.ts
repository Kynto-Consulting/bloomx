/**
 * Kit de extensiones: traduccion de props SEMANTICAS (tone, variant, size, gap...) a clases de TOKENS del tema.
 *
 * Es el UNICO lugar donde se decide como se ve cada intencion. Ninguna extension elige colores: el renderer solo
 * pasa `tone`/`variant`/`size`/... y los componentes del kit leen de aqui. Todas las clases usan tokens
 * (bg-primary, text-success, border-destructive...), asi heredan modo claro/oscuro, paleta, radio y fuente de la
 * empresa. Nada de paleta cruda ni hex (guardia: src/lib/__tests__/no-raw-colors.test.ts).
 *
 * CONTRASTE GARANTIZADO: cada par (texto, fondo) que se pinta esta en `TONE_PAIRS` y lo verifica
 * kit/__tests__/kit-contrast.test.ts contra los 8 temas genericos y las paletas de empresa. Reglas:
 *   - relleno:   bg-X + text-X-foreground              (parejas del contrato de temas)
 *   - texto:     text-X sobre background/card/popover  (el contrato garantiza >= 4.5:1)
 *   - suave:     bg-card + text-card-foreground + borde de la intencion (sin tintes translucidos: no garantizan AA)
 *   - chip:      bg-chip + text-chip-foreground
 *   - hover:     bg-accent + text-accent-foreground     (nunca un tinte de la intencion)
 * Los literales de clase estan COMPLETOS (Tailwind los detecta al escanear el codigo): no los construyas con plantillas.
 */
import { TONES, SIZES, SIZES_XL, GAPS, ALIGNS, JUSTIFIES, DENSITIES, TEXT_SIZES, WEIGHTS } from '@/lib/expansions/ui-schema';
import type { TokenKey } from '@/lib/theme-config';

export type Tone = (typeof TONES)[number];
export type Size = (typeof SIZES)[number];
export type SizeXl = (typeof SIZES_XL)[number];
export type Gap = (typeof GAPS)[number];
export type Align = (typeof ALIGNS)[number];
export type Justify = (typeof JUSTIFIES)[number];
export type Density = (typeof DENSITIES)[number];
export type TextSize = (typeof TEXT_SIZES)[number];
export type Weight = (typeof WEIGHTS)[number];
export type ButtonVariant = 'solid' | 'soft' | 'outline' | 'ghost' | 'link';
export type SurfaceVariant = 'solid' | 'soft' | 'outline';

/** Valor seguro para un prop enum: si no esta en la lista devuelve el defecto. Nunca lanza. */
export function pick<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
    return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;
}
export const toTone = (value: unknown, fallback: Tone = 'neutral'): Tone => pick(value, TONES, fallback);

// ------------------------------------------------------------------ espaciado / alineacion / texto
export const GAP_CLASS: Record<number, string> = { 0: 'gap-0', 1: 'gap-1', 2: 'gap-2', 3: 'gap-3', 4: 'gap-4', 5: 'gap-5', 6: 'gap-6', 8: 'gap-8', 10: 'gap-10', 12: 'gap-12' };
export const PADDING_CLASS: Record<number, string> = { 0: 'p-0', 1: 'p-1', 2: 'p-2', 3: 'p-3', 4: 'p-4', 5: 'p-5', 6: 'p-6', 8: 'p-8', 10: 'p-10', 12: 'p-12' };
export const SPACER_CLASS: Record<number, string> = { 0: 'h-0', 1: 'h-1', 2: 'h-2', 3: 'h-3', 4: 'h-4', 5: 'h-5', 6: 'h-6', 8: 'h-8', 10: 'h-10', 12: 'h-12' };
export const MARGIN_Y_CLASS: Record<number, string> = { 0: 'my-0', 1: 'my-1', 2: 'my-2', 3: 'my-3', 4: 'my-4', 5: 'my-5', 6: 'my-6', 8: 'my-8', 10: 'my-10', 12: 'my-12' };
export const ALIGN_CLASS: Record<Align, string> = { start: 'items-start', center: 'items-center', end: 'items-end', stretch: 'items-stretch', baseline: 'items-baseline' };
export const JUSTIFY_CLASS: Record<Justify, string> = { start: 'justify-start', center: 'justify-center', end: 'justify-end', between: 'justify-between', around: 'justify-around' };
export const TEXT_ALIGN_CLASS: Record<'start' | 'center' | 'end', string> = { start: 'text-start', center: 'text-center', end: 'text-end' };
export const TEXT_SIZE_CLASS: Record<TextSize, string> = { xs: 'text-xs', sm: 'text-sm', md: 'text-base', lg: 'text-lg', xl: 'text-xl' };
export const WEIGHT_CLASS: Record<Weight, string> = { normal: 'font-normal', medium: 'font-medium', semibold: 'font-semibold', bold: 'font-bold' };
export const HEADING_SIZE_CLASS: Record<number, string> = { 1: 'text-2xl font-semibold tracking-tight', 2: 'text-xl font-semibold tracking-tight', 3: 'text-lg font-semibold', 4: 'text-base font-semibold', 5: 'text-sm font-semibold', 6: 'text-xs font-semibold uppercase tracking-wide' };
export const GRID_COLUMNS_CLASS: Record<number, string> = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-2 lg:grid-cols-4',
    5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
    6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
};
export const MAX_HEIGHT_CLASS: Record<string, string> = { sm: 'max-h-40 overflow-y-auto', md: 'max-h-60 overflow-y-auto', lg: 'max-h-96 overflow-y-auto', xl: 'max-h-[32rem] overflow-y-auto' };
export const DENSITY_PADDING_CLASS: Record<Density, string> = { compact: 'p-3', comfortable: 'p-4', spacious: 'p-6' };
export const DENSITY_CELL_CLASS: Record<Density, string> = { compact: 'px-3 py-1.5', comfortable: 'px-4 py-2.5', spacious: 'px-5 py-4' };
export const MODAL_WIDTH_CLASS: Record<string, string> = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', full: 'max-w-[90vw]' };
export const DRAWER_WIDTH_CLASS: Record<string, string> = { sm: 'w-80', md: 'w-96', lg: 'w-[32rem]' };

// ------------------------------------------------------------------ intencion (tone)
/** Texto coloreado por intencion (sobre background/card/popover). neutral = texto normal. */
export const TONE_TEXT: Record<Tone, string> = {
    neutral: 'text-foreground', primary: 'text-primary', success: 'text-success', warning: 'text-warning', danger: 'text-destructive', info: 'text-info',
};
/** Relleno solido con su pareja de primer plano. */
export const TONE_SOLID: Record<Tone, string> = {
    neutral: 'bg-secondary text-secondary-foreground',
    primary: 'bg-primary text-primary-foreground',
    success: 'bg-success text-success-foreground',
    warning: 'bg-warning text-warning-foreground',
    danger: 'bg-destructive text-destructive-foreground',
    info: 'bg-info text-info-foreground',
};
/**
 * "Suave": superficie de tarjeta + borde de la intencion + texto de tarjeta (pareja garantizada card-foreground/card).
 * No se usan tintes translucidos (bg-X/10): con paletas de empresa de texto justo en AA el tinte baja el contraste
 * por debajo de 4.5 (lo demostro kit-contrast.test.ts). El color de la intencion va en el borde y en los iconos.
 */
export const TONE_SOFT: Record<Tone, string> = {
    neutral: 'bg-chip text-chip-foreground border border-transparent',
    primary: 'bg-card text-card-foreground border border-primary/50',
    success: 'bg-card text-card-foreground border border-success/50',
    warning: 'bg-card text-card-foreground border border-warning/50',
    danger: 'bg-card text-card-foreground border border-destructive/50',
    info: 'bg-card text-card-foreground border border-info/50',
};
/** Solo borde y texto de la intencion sobre la superficie. */
export const TONE_OUTLINE: Record<Tone, string> = {
    neutral: 'border border-input text-foreground bg-transparent',
    primary: 'border border-primary text-primary bg-transparent',
    success: 'border border-success text-success bg-transparent',
    warning: 'border border-warning text-warning bg-transparent',
    danger: 'border border-destructive text-destructive bg-transparent',
    info: 'border border-info text-info bg-transparent',
};
/** Borde de acento (tarjetas, avisos). */
export const TONE_BORDER: Record<Tone, string> = {
    neutral: 'border-border', primary: 'border-primary', success: 'border-success', warning: 'border-warning', danger: 'border-destructive', info: 'border-info',
};
export const TONE_BORDER_LEFT: Record<Tone, string> = {
    neutral: 'border-l-border', primary: 'border-l-primary', success: 'border-l-success', warning: 'border-l-warning', danger: 'border-l-destructive', info: 'border-l-info',
};
/** Fondo plano de la intencion (puntos de leyenda, barras). neutral usa el gris de texto atenuado. */
export const TONE_BG: Record<Tone, string> = {
    neutral: 'bg-muted-foreground', primary: 'bg-primary', success: 'bg-success', warning: 'bg-warning', danger: 'bg-destructive', info: 'bg-info',
};
/** Rellenos y trazos SVG. */
export const TONE_FILL: Record<Tone, string> = {
    neutral: 'fill-muted-foreground', primary: 'fill-primary', success: 'fill-success', warning: 'fill-warning', danger: 'fill-destructive', info: 'fill-info',
};
export const TONE_STROKE: Record<Tone, string> = {
    neutral: 'stroke-muted-foreground', primary: 'stroke-primary', success: 'stroke-success', warning: 'stroke-warning', danger: 'stroke-destructive', info: 'stroke-info',
};
/** Orden en que los graficos reparten tonos cuando un dato no trae `tone`. */
export const CHART_SEQUENCE: readonly Tone[] = ['primary', 'info', 'success', 'warning', 'danger', 'neutral'];

/**
 * Pares (texto sobre fondo) que pinta el kit, por token. Los usa el test de contraste (min = razon WCAG exigida).
 * `blend`: el fondo es el token `over` mezclado al 10 % con el token `bg` (tinte suave).
 */
export interface TonePair { name: string; fg: TokenKey; bg: TokenKey; min: number; blend?: { over: TokenKey; alpha: number } }
const solidPair = (tone: string, bg: TokenKey, fg: TokenKey): TonePair => ({ name: `solid ${tone}`, fg, bg, min: 4.5 });
const textPair = (tone: string, fg: TokenKey): TonePair[] => (['background', 'card'] as TokenKey[]).map((bg) => ({ name: `texto ${tone} sobre ${bg}`, fg, bg, min: 4.5 }));
const softPair = (): TonePair => ({ name: 'soft / superficie de tarjeta', fg: 'card-foreground', bg: 'card', min: 4.5 });
export const TONE_PAIRS: readonly TonePair[] = [
    solidPair('neutral', 'secondary', 'secondary-foreground'),
    solidPair('primary', 'primary', 'primary-foreground'),
    solidPair('success', 'success', 'success-foreground'),
    solidPair('warning', 'warning', 'warning-foreground'),
    solidPair('danger', 'destructive', 'destructive-foreground'),
    solidPair('info', 'info', 'info-foreground'),
    ...textPair('primary', 'primary'), ...textPair('success', 'success'), ...textPair('warning', 'warning'),
    ...textPair('danger', 'destructive'), ...textPair('info', 'info'),
    { name: 'chip', fg: 'chip-foreground', bg: 'chip', min: 4.5 },
    { name: 'enlace sobre card', fg: 'link', bg: 'card', min: 4.5 },
    { name: 'codigo', fg: 'code-foreground', bg: 'code', min: 4.5 },
    { name: 'atenuado sobre card', fg: 'muted-foreground', bg: 'card', min: 4.5 },
    { name: 'atenuado sobre muted', fg: 'muted-foreground', bg: 'muted', min: 4.5 },
    { name: 'hover accent', fg: 'accent-foreground', bg: 'accent', min: 4.5 },
    softPair(),
    { name: 'texto sobre fondo', fg: 'foreground', bg: 'background', min: 4.5 },
];

// ------------------------------------------------------------------ controles
const BUTTON_BASE = 'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium ring-offset-background transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress';
export const BUTTON_SIZE_CLASS: Record<Size, string> = { xs: 'h-7 px-2 text-xs', sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-11 px-6 text-base' };
export const ICON_BUTTON_SIZE_CLASS: Record<Size, string> = { xs: 'h-7 w-7', sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-11 w-11' };
export const ICON_PX: Record<SizeXl, number> = { xs: 12, sm: 14, md: 16, lg: 20, xl: 28 };

const BUTTON_SOLID_HOVER: Record<Tone, string> = {
    neutral: 'hover:bg-secondary/80', primary: 'hover:bg-primary/90', success: 'hover:bg-success/90', warning: 'hover:bg-warning/90', danger: 'hover:bg-destructive/90', info: 'hover:bg-info/90',
};
const BUTTON_SOFT_HOVER: Record<Tone, string> = {
    neutral: 'hover:bg-accent hover:text-accent-foreground', primary: 'hover:bg-accent hover:text-accent-foreground', success: 'hover:bg-accent hover:text-accent-foreground', warning: 'hover:bg-accent hover:text-accent-foreground', danger: 'hover:bg-accent hover:text-accent-foreground', info: 'hover:bg-accent hover:text-accent-foreground',
};
const BUTTON_OUTLINE_HOVER: Record<Tone, string> = {
    neutral: 'hover:bg-accent hover:text-accent-foreground', primary: 'hover:bg-accent hover:text-accent-foreground', success: 'hover:bg-accent hover:text-accent-foreground', warning: 'hover:bg-accent hover:text-accent-foreground', danger: 'hover:bg-accent hover:text-accent-foreground', info: 'hover:bg-accent hover:text-accent-foreground',
};
const BUTTON_GHOST: Record<Tone, string> = {
    neutral: 'text-foreground hover:bg-accent hover:text-accent-foreground',
    primary: 'text-primary hover:bg-accent hover:text-accent-foreground',
    success: 'text-success hover:bg-accent hover:text-accent-foreground',
    warning: 'text-warning hover:bg-accent hover:text-accent-foreground',
    danger: 'text-destructive hover:bg-accent hover:text-accent-foreground',
    info: 'text-info hover:bg-accent hover:text-accent-foreground',
};
const BUTTON_LINK: Record<Tone, string> = {
    neutral: 'text-foreground underline-offset-4 hover:underline',
    primary: 'text-link underline-offset-4 hover:text-link-hover hover:underline',
    success: 'text-success underline-offset-4 hover:underline',
    warning: 'text-warning underline-offset-4 hover:underline',
    danger: 'text-destructive underline-offset-4 hover:underline',
    info: 'text-info underline-offset-4 hover:underline',
};

/** Tono por defecto de un boton segun su variante (solid/link -> primary; el resto -> neutral). */
export function defaultButtonTone(variant: ButtonVariant): Tone {
    return variant === 'solid' || variant === 'link' ? 'primary' : 'neutral';
}

export function buttonClasses(opts: { tone?: Tone; variant?: ButtonVariant; size?: Size; icon?: boolean; fullWidth?: boolean; alignStart?: boolean }): string {
    const variant = opts.variant ?? 'solid';
    const tone = opts.tone ?? defaultButtonTone(variant);
    const size = opts.size ?? 'md';
    const look =
        variant === 'solid' ? `${TONE_SOLID[tone]} ${BUTTON_SOLID_HOVER[tone]}`
            : variant === 'soft' ? `${TONE_SOFT[tone]} ${BUTTON_SOFT_HOVER[tone]}`
                : variant === 'outline' ? `${TONE_OUTLINE[tone]} ${BUTTON_OUTLINE_HOVER[tone]}`
                    : variant === 'ghost' ? BUTTON_GHOST[tone]
                        : BUTTON_LINK[tone];
    const sizing = opts.icon ? ICON_BUTTON_SIZE_CLASS[size] : variant === 'link' ? 'h-auto p-0 text-sm' : BUTTON_SIZE_CLASS[size];
    return [BUTTON_BASE, look, sizing, opts.fullWidth ? 'w-full' : '', opts.fullWidth && opts.alignStart ? 'justify-start text-left' : ''].filter(Boolean).join(' ');
}

/** Etiqueta de campo. */
export const LABEL_CLASS = 'text-sm font-medium text-foreground';
export const HELPER_CLASS = 'text-xs text-muted-foreground';
export const ERROR_TEXT_CLASS = 'text-xs text-destructive';
export const REQUIRED_MARK_CLASS = 'text-destructive';
/** Caja de entrada (input/select/textarea). `aria-invalid` activa el borde de error. */
export const FIELD_CLASS = 'flex w-full rounded-md border border-input bg-background px-3 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 read-only:bg-muted aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive';
export const FIELD_SIZE_CLASS: Record<Size, string> = { xs: 'h-7 text-xs', sm: 'h-8', md: 'h-10', lg: 'h-11 text-base' };
export const TEXTAREA_CLASS = `${FIELD_CLASS} py-2 min-h-[5rem] resize-y`;
export const CHECK_CLASS = 'h-4 w-4 shrink-0 rounded border border-input bg-background accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50';

// ------------------------------------------------------------------ superficies
export const SURFACE_CLASS = 'rounded-lg border border-border bg-card text-card-foreground';
export const SURFACE_ELEVATED_CLASS = 'rounded-lg border border-border bg-card text-card-foreground shadow-md';
export const SURFACE_FLAT_CLASS = 'rounded-lg bg-muted text-foreground';
/**
 * Superficie flotante del kit (menus, popovers). Usa la pareja card (no popover): el contrato de temas garantiza el
 * contraste de los textos de intencion (text-primary, text-destructive...) sobre background y card, no sobre popover.
 */
export const POPOVER_CLASS = 'rounded-lg border border-border bg-card text-card-foreground shadow-lg';
export const MENU_ITEM_CLASS = 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground disabled:pointer-events-none disabled:opacity-50';
export const MENU_ITEM_TONE_CLASS: Record<Tone, string> = {
    neutral: 'text-card-foreground', primary: 'text-primary', success: 'text-success', warning: 'text-warning', danger: 'text-destructive', info: 'text-info',
};
export const FOCUS_RING_CLASS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background';
export const ROW_HOVER_CLASS = 'hover:bg-row-hover';
export const ROW_SELECTED_CLASS = 'bg-row-selected text-row-selected-foreground';
export const OVERLAY_CLASS = 'bg-overlay';
