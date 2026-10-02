'use client';

/**
 * Icono de una extension o de una accion suya. UN componente para todos los sitios (barras de acciones, menu "Extensiones",
 * paginas de gestion y administracion, pestanas de Ajustes, redactor, avisos de error...).
 *
 *   icon   `brand:<slug>` | `lucide:<Nombre>` | `initials:<XY>` | nombre Lucide sin esquema (compatibilidad). Ver lib/expansions/icon-ref.ts.
 *   size   16 | 20 | 24 | 32. Las dimensiones son FIJAS: nunca hay salto de maquetacion al cargar ni al cambiar de estado.
 *   mode   "brand" (logotipo con su color oficial sobre una ficha neutra) | "mono" (currentColor, sin ficha: menus densos y botones
 *          deshabilitados).
 *
 * Contraste: el color oficial se usa tal cual si contrasta >= 3:1 con las superficies del tema ACTIVO (fondo, tarjeta, atenuado y
 * hover); si no (Notion negro en un tema oscuro, Zoom en azul oscuro...) se pinta una variante mas clara/oscura del mismo tono
 * (brandGlyphColor) en el PLACEHOLDER. Se recalcula al cambiar de tema. El icono es decorativo (aria-hidden): el nombre accesible lo da
 * el boton o la fila que lo contiene.
 *
 * Imagen ASINCRONA: el dibujo NO esta en el bundle. Encima del placeholder (ficha con inicial / Lucide, mismas dimensiones: sin saltos de
 * maquetacion) se carga un <img loading=lazy decoding=async referrerPolicy=no-referrer> desde el backend (`iconUrl` del catalogo con
 * ?h=<hash>, o brand.<slug>), o desde un data URL valido en `icon`. Solo se monta al acercarse al viewport (IntersectionObserver); si falla
 * (404, red, backend caido) se queda el placeholder. Los logotipos con colores propios NO se recolorean; un SVG de data URL con
 * `currentColor` hereda el color de texto del tema. Ver lib/expansions/icon-image.ts.
 */
import * as React from 'react';
import { Loader2, Puzzle } from 'lucide-react';
import { resolveIcon } from './kit/resolve-icon';
import { BRAND_SURFACE_TOKENS, brandGlyphColor, initialsOf, resolveIconRef } from '@/lib/expansions/icon-ref';
import { brandIconUrl, parseIconDataUrl, recolorCurrentColor, resolveBackendIconUrl } from '@/lib/expansions/icon-image';
import { normalizeHex } from '@/lib/color';

export type ExtensionIconSize = 16 | 20 | 24 | 32;
export type ExtensionIconMode = 'brand' | 'mono';

/** Lado del glifo dentro del cuadrado (el resto es el margen de la ficha). */
const GLYPH_PX: Record<ExtensionIconSize, number> = { 16: 12, 20: 15, 24: 18, 32: 24 };
/** Lado de un icono Lucide (funcional) dentro del cuadrado. */
const LUCIDE_PX: Record<ExtensionIconSize, number> = { 16: 16, 20: 18, 24: 20, 32: 24 };
const INITIALS_TEXT_CLASS: Record<ExtensionIconSize, string> = { 16: 'text-[8px]', 20: 'text-[9px]', 24: 'text-[10px]', 32: 'text-xs' };

/** Tamano permitido mas cercano (para los tamanos en px de otros componentes). */
export function nearestIconSize(px: number): ExtensionIconSize {
    const sizes: ExtensionIconSize[] = [16, 20, 24, 32];
    return sizes.reduce((best, s) => (Math.abs(s - px) < Math.abs(best - px) ? s : best), 16 as ExtensionIconSize);
}

// ------------------------------------------------------------------ superficies del tema activo
// Un unico observador compartido: las superficies se leen de las variables CSS del <html> y se invalidan cuando cambia el tema.
let surfaceCache: string | null = null;
const surfaceListeners = new Set<() => void>();
let teardown: (() => void) | null = null;

function readSurfaces(): string {
    if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return '';
    const style = getComputedStyle(document.documentElement);
    return BRAND_SURFACE_TOKENS.map((token) => normalizeHex(style.getPropertyValue(`--color-${token}`).trim()) ?? '').filter(Boolean).join('|');
}

function subscribeSurfaces(listener: () => void): () => void {
    surfaceListeners.add(listener);
    surfaceCache = null;
    if (!teardown && typeof MutationObserver !== 'undefined') {
        const invalidate = () => { surfaceCache = null; surfaceListeners.forEach((l) => l()); };
        const observer = new MutationObserver(invalidate);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-scheme', 'data-theme-pref', 'class', 'style'] });
        if (document.head) observer.observe(document.head, { childList: true, subtree: true, characterData: true });
        const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
        media?.addEventListener?.('change', invalidate);
        teardown = () => { observer.disconnect(); media?.removeEventListener?.('change', invalidate); teardown = null; };
    }
    return () => {
        surfaceListeners.delete(listener);
        if (surfaceListeners.size === 0) teardown?.();
    };
}

const getSurfaces = (): string => { if (surfaceCache === null) surfaceCache = readSurfaces(); return surfaceCache; };
const getServerSurfaces = (): string => '';

/** Superficies (hex, separadas por |) del tema activo; '' en el servidor y antes de la hidratacion. */
export function useThemeSurfaces(): string {
    return React.useSyncExternalStore(subscribeSurfaces, getSurfaces, getServerSurfaces);
}

const colorMemo = new Map<string, string>();
function glyphColor(hex: string, surfaces: string): string {
    const key = `${hex}#${surfaces}`;
    let color = colorMemo.get(key);
    if (!color) {
        color = brandGlyphColor(hex, surfaces ? surfaces.split('|') : []);
        if (colorMemo.size > 500) colorMemo.clear();
        colorMemo.set(key, color);
    }
    return color;
}

// ------------------------------------------------------------------ imagen asincrona
/** SVG de data URL: `currentColor` pasa a ser el foreground del tema activo. */
function recolorDataImage(image: NonNullable<ReturnType<typeof parseIconDataUrl>>, surfaces: string): string {
    if (!image.svg || !/currentColor/i.test(image.svg) || typeof document === 'undefined') return image.src;
    void surfaces; // dependencia: cambia con el tema
    const fg = normalizeHex(getComputedStyle(document.documentElement).getPropertyValue('--color-foreground').trim());
    return fg ? recolorCurrentColor(image, fg) : image.src; // sin tema legible: currentColor se queda (negro por defecto)
}

/** Imagenes ya cargadas (por URL con hash): al reaparecer no hay parpadeo ni espera de viewport. */
const loadedSrcs = new Set<string>();

function useNearViewport(ref: React.RefObject<HTMLElement | null>, immediate: boolean): boolean {
    const [near, setNear] = React.useState(() => immediate || typeof IntersectionObserver === 'undefined');
    React.useEffect(() => {
        if (near || !ref.current || typeof IntersectionObserver === 'undefined') return;
        const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setNear(true); observer.disconnect(); } }, { rootMargin: '200px' });
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, [near, ref]);
    return near;
}

/**
 * Placeholder instantaneo + <img> superpuesto. Mismas dimensiones siempre. `glyph` 0 = sin imagen (modo mono con icono remoto: un logotipo
 * con colores propios no se recolorea ni se mezcla con el color de texto; se queda el placeholder monocromo).
 */
function PlaceholderOrImage({ body, src, glyph }: { body: React.ReactNode; src: string | null; glyph: number }) {
    const anchor = React.useRef<HTMLSpanElement>(null);
    const [status, setStatus] = React.useState<'idle' | 'loaded' | 'error'>(() => (src && loadedSrcs.has(src) ? 'loaded' : 'idle'));
    const [prevSrc, setPrevSrc] = React.useState(src);
    if (prevSrc !== src) { setPrevSrc(src); setStatus(src && loadedSrcs.has(src) ? 'loaded' : 'idle'); }
    const enabled = src !== null && glyph > 0 && status !== 'error';
    const near = useNearViewport(anchor, !!src && (src.startsWith('data:') || loadedSrcs.has(src)));
    return (
        <span ref={anchor} className="relative inline-flex items-center justify-center">
            <span className={status === 'loaded' ? 'invisible' : 'inline-flex items-center justify-center'}>{body}</span>
            {enabled && near && (
                // eslint-disable-next-line @next/next/no-img-element -- icono diminuto del backend; next/image no aporta nada aqui
                <img
                    src={src!}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    draggable={false}
                    width={glyph}
                    height={glyph}
                    data-extension-icon-img=""
                    onLoad={() => { loadedSrcs.add(src!); setStatus('loaded'); }}
                    onError={() => setStatus('error')}
                    className={`absolute inset-0 m-auto object-contain transition-opacity ${status === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
                    style={{ width: glyph, height: glyph }}
                />
            )}
        </span>
    );
}

// ------------------------------------------------------------------ componente
/**
 * Letra del placeholder. Se pinta con un pseudo-elemento (CSS content: attr(data-initial)) y NO como texto del DOM: asi no se cuela
 * en el texto ni en el nombre accesible del boton/enlace que contiene al icono (p. ej. "GUnirse a la reunion") ni en la seleccion/copia.
 */
function InitialGlyph({ text, size, className, style, brand }: { text: string; size: ExtensionIconSize; className?: string; style?: React.CSSProperties; brand?: string }) {
    return (
        <span
            data-initial={text}
            data-brand={brand}
            style={style}
            className={`select-none font-semibold leading-none before:content-[attr(data-initial)] ${INITIALS_TEXT_CLASS[size]} ${className ?? ''}`}
        />
    );
}


export interface ExtensionIconProps {
    /** `brand:<slug>` | `lucide:<Nombre>` | `initials:<XY>` | nombre Lucide (compatibilidad). */
    icon?: string | null;
    /** `iconUrl` del catalogo del backend (ruta relativa con ?h=<hash>): la imagen se carga async sobre el placeholder. */
    iconUrl?: string | null;
    /** Solo para el RESPALDO: si `icon` no se puede resolver se muestran las iniciales de este texto (el nombre de la accion). */
    label?: string;
    size?: ExtensionIconSize;
    mode?: ExtensionIconMode;
    /** Ficha neutra (borde + tarjeta) tras el logotipo. Por defecto SI en modo "brand". */
    tile?: boolean;
    /** Spinner encima con el glifo atenuado; conserva las dimensiones. */
    loading?: boolean;
    /** Desaturado y atenuado. */
    disabled?: boolean;
    className?: string;
}

export function ExtensionIcon({ icon, iconUrl, label, size = 24, mode = 'brand', tile, loading = false, disabled = false, className }: ExtensionIconProps) {
    const surfaces = useThemeSurfaces();
    const isData = typeof icon === 'string' && icon.trim().startsWith('data:');
    const dataImage = isData ? parseIconDataUrl(icon) : null;
    // Un data URL invalido NO se interpreta como nada: respaldo con iniciales/puzzle.
    const ref = isData ? null : resolveIconRef(icon);
    const remote = resolveBackendIconUrl(iconUrl) ?? (ref?.kind === 'brand' ? brandIconUrl(ref.icon.slug) : null);
    const imageSrc = dataImage ? recolorDataImage(dataImage, surfaces) : remote;
    const glyph = GLYPH_PX[size] ?? 16;
    const brandMode = mode === 'brand';

    let kind: string;
    let body: React.ReactNode;
    let chip = brandMode && tile !== false;

    if (ref?.kind === 'brand') {
        kind = 'brand';
        // Placeholder: la inicial en el color de la marca (el dibujo llega del backend).
        body = <InitialGlyph brand={ref.icon.slug} text={initialsOf(ref.icon.name).slice(0, 1)} size={size} style={brandMode ? { color: glyphColor(ref.icon.hex, surfaces) } : undefined} />;
    } else if (ref?.kind === 'neutral') {
        kind = 'neutral';
        body = <InitialGlyph text={ref.brand.initial} size={size} />;
    } else if (ref?.kind === 'lucide' && resolveIcon(ref.name)) {
        kind = 'lucide';
        const Lucide = resolveIcon(ref.name)!;
        body = <Lucide size={LUCIDE_PX[size] ?? 16} aria-hidden={true} />;
        chip = false; // los iconos funcionales (Lucide) van sin ficha: son monocromos por naturaleza
    } else if (ref?.kind === 'initials' || (ref?.kind === 'lucide' && !label)) {
        kind = 'initials';
        body = ref?.kind === 'initials' ? <InitialGlyph text={ref.text} size={size} /> : <Puzzle size={glyph} aria-hidden={true} />;
    } else if (label && initialsOf(label)) {
        kind = 'initials';
        body = <InitialGlyph text={initialsOf(label)} size={size} />;
    } else {
        kind = 'fallback';
        body = <Puzzle size={LUCIDE_PX[size] ?? 16} aria-hidden={true} />;
        chip = false;
    }

    // Las fichas con texto (iniciales, marca sin logotipo) siempre llevan ficha en modo brand para que se lean como icono.
    if ((kind === 'initials' || kind === 'neutral') && brandMode && tile !== false) chip = true;
    const hasImage = imageSrc !== null;
    if (hasImage && brandMode && tile !== false) chip = true;
    const chipClass = chip ? 'rounded-md border border-border bg-card text-card-foreground' : '';
    const stateClass = disabled ? 'opacity-50 grayscale' : '';

    return (
        <span
            aria-hidden="true"
            data-extension-icon={kind}
            data-mode={mode}
            data-size={size}
            style={{ width: size, height: size }}
            className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden ${chipClass} ${stateClass} ${className ?? ''}`}
        >
            <span className={`inline-flex items-center justify-center transition-opacity ${loading ? 'opacity-30' : ''}`}>
                <PlaceholderOrImage body={body} src={imageSrc} glyph={!dataImage && !brandMode ? 0 : kind === 'lucide' || kind === 'fallback' ? LUCIDE_PX[size] ?? 16 : glyph} />
            </span>
            {loading && (
                <span data-extension-icon-loading="" className="absolute inset-0 flex items-center justify-center text-foreground">
                    <Loader2 size={size === 16 ? 12 : 14} aria-hidden={true} className="animate-spin motion-reduce:animate-none" />
                </span>
            )}
        </span>
    );
}
