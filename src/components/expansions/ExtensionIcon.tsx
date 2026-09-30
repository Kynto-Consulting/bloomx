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
 * (brandGlyphColor). Se recalcula al cambiar de tema. El icono es decorativo (aria-hidden): el nombre accesible lo da el boton o la
 * fila que lo contiene. Sin imagenes remotas: todo sale del registro brand-icons.ts.
 */
import * as React from 'react';
import { Loader2, Puzzle } from 'lucide-react';
import { resolveIcon } from './kit/resolve-icon';
import { BRAND_SURFACE_TOKENS, brandGlyphColor, initialsOf, resolveIconRef } from '@/lib/expansions/icon-ref';
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

// ------------------------------------------------------------------ componente
export interface ExtensionIconProps {
    /** `brand:<slug>` | `lucide:<Nombre>` | `initials:<XY>` | nombre Lucide (compatibilidad). */
    icon?: string | null;
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

export function ExtensionIcon({ icon, label, size = 24, mode = 'brand', tile, loading = false, disabled = false, className }: ExtensionIconProps) {
    const surfaces = useThemeSurfaces();
    const ref = resolveIconRef(icon);
    const glyph = GLYPH_PX[size] ?? 16;
    const brandMode = mode === 'brand';

    let kind: string;
    let body: React.ReactNode;
    let chip = brandMode && tile !== false;

    if (ref?.kind === 'brand') {
        kind = 'brand';
        body = (
            <svg
                viewBox="0 0 24 24"
                width={glyph}
                height={glyph}
                focusable="false"
                aria-hidden="true"
                data-brand={ref.icon.slug}
                fill={brandMode ? undefined : 'currentColor'}
                style={brandMode ? { fill: glyphColor(ref.icon.hex, surfaces) } : undefined}
            >
                <path d={ref.icon.path} />
            </svg>
        );
    } else if (ref?.kind === 'neutral') {
        kind = 'neutral';
        body = <span className={`font-semibold leading-none ${INITIALS_TEXT_CLASS[size]}`}>{ref.brand.initial}</span>;
    } else if (ref?.kind === 'lucide' && resolveIcon(ref.name)) {
        kind = 'lucide';
        const Lucide = resolveIcon(ref.name)!;
        body = <Lucide size={LUCIDE_PX[size] ?? 16} aria-hidden={true} />;
        chip = false; // los iconos funcionales (Lucide) van sin ficha: son monocromos por naturaleza
    } else if (ref?.kind === 'initials' || (ref?.kind === 'lucide' && !label)) {
        kind = 'initials';
        body = <span className={`font-semibold leading-none ${INITIALS_TEXT_CLASS[size]}`}>{ref?.kind === 'initials' ? ref.text : <Puzzle size={glyph} aria-hidden={true} />}</span>;
    } else if (label && initialsOf(label)) {
        kind = 'initials';
        body = <span className={`font-semibold leading-none ${INITIALS_TEXT_CLASS[size]}`}>{initialsOf(label)}</span>;
    } else {
        kind = 'fallback';
        body = <Puzzle size={LUCIDE_PX[size] ?? 16} aria-hidden={true} />;
        chip = false;
    }

    // Las fichas con texto (iniciales, marca sin logotipo) siempre llevan ficha en modo brand para que se lean como icono.
    if ((kind === 'initials' || kind === 'neutral') && brandMode && tile !== false) chip = true;
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
            <span className={`inline-flex items-center justify-center transition-opacity ${loading ? 'opacity-30' : ''}`}>{body}</span>
            {loading && (
                <span data-extension-icon-loading="" className="absolute inset-0 flex items-center justify-center text-foreground">
                    <Loader2 size={size === 16 ? 12 : 14} aria-hidden={true} className="animate-spin motion-reduce:animate-none" />
                </span>
            )}
        </span>
    );
}
