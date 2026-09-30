/**
 * Superficies de la landing (fondo del hero / de la pagina) y contraste calculado.
 *
 * Regla: el texto sobre una superficie PERSONALIZADA (color, degradado, imagen) nunca usa tokens de tema; se
 * calcula con color.ts para que cumpla WCAG AA (4.5:1) en el PEOR caso:
 *  - color/degradado: contra todos los tramos del degradado (extremos y puntos intermedios);
 *  - imagen: no se conocen sus pixeles, asi que se garantiza contra blanco y negro puro (cualquier pixel queda
 *    entre ambos) mediante un velo (`scrim`) cuya opacidad sube hasta lo necesario.
 * Sobre superficies de tema (bg-background, bg-card, bg-primary...) se usan los tokens, que ya garantizan AA.
 */
import { contrast, mix, normalizeHex } from './color';
import type { LandingConfig, LandingGradient, LandingImagePosition, LandingPattern } from './landing-config';

export const AA_RATIO = 4.5;
export const TEXT_LIGHT = '#ffffff';
export const TEXT_DARK = '#0a0a0a';
/** Base bajo las imagenes: si la imagen no carga, el texto claro sigue teniendo contraste. */
export const IMAGE_BASE = '#111827';

export interface SurfaceTone {
    /** Color del texto sobre la superficie. */
    fg: string;
    /** Opacidad del velo (0..0.9) a colocar entre la superficie y el texto. */
    scrim: number;
    scrimColor: string;
    /** Peor contraste texto/fondo con el velo aplicado. */
    ratio: number;
}

function worstRatio(fg: string, colors: string[], scrimColor: string, alpha: number): number {
    return Math.min(...colors.map((c) => contrast(fg, mix(c, scrimColor, alpha))));
}

/** Elige texto claro u oscuro y el velo minimo para llegar a AA contra TODOS los colores dados. */
export function toneForColors(colors: string[], minRatio = AA_RATIO): SurfaceTone {
    const list = colors.map((c) => normalizeHex(c)).filter((c): c is string => !!c);
    if (list.length === 0) list.push('#ffffff');
    let best: SurfaceTone | null = null;
    for (const fg of [TEXT_LIGHT, TEXT_DARK]) {
        const scrimColor = fg === TEXT_LIGHT ? '#000000' : '#ffffff';
        for (let step = 0; step <= 18; step++) {
            const alpha = step * 0.05;
            const ratio = worstRatio(fg, list, scrimColor, alpha);
            if (ratio >= minRatio || step === 18) {
                const cand: SurfaceTone = { fg, scrim: Math.round(alpha * 100) / 100, scrimColor, ratio };
                if (!best || cand.scrim < best.scrim || (cand.scrim === best.scrim && cand.ratio > best.ratio)) best = cand;
                break;
            }
        }
    }
    return best as SurfaceTone;
}

/** Texto sobre una imagen desconocida: blanco + velo negro >= `overlay` y >= el minimo para AA. */
export function toneForImage(overlay: number | undefined, minRatio = AA_RATIO): SurfaceTone {
    const wanted = Math.min(Math.max(typeof overlay === 'number' && Number.isFinite(overlay) ? overlay : 0, 0), 1);
    // Peor pixel posible bajo texto claro: blanco puro.
    let needed = 0;
    while (needed < 1 && worstRatio(TEXT_LIGHT, ['#ffffff'], '#000000', needed) < minRatio) needed = Math.round((needed + 0.01) * 100) / 100;
    const scrim = Math.max(wanted, needed);
    return { fg: TEXT_LIGHT, scrim, scrimColor: '#000000', ratio: worstRatio(TEXT_LIGHT, ['#ffffff'], '#000000', scrim) };
}

export function gradientCss(g: LandingGradient): string {
    const angle = Math.min(Math.max(Math.round(g.angle), 0), 360);
    return `linear-gradient(${angle}deg, ${g.from}, ${g.to})`;
}

function gradientSamples(g: LandingGradient): string[] {
    return [0, 0.25, 0.5, 0.75, 1].map((t) => mix(g.from, g.to, t));
}

export type Surface =
    | { kind: 'token' }
    | { kind: 'color'; color: string; tone: SurfaceTone }
    | { kind: 'gradient'; css: string; tone: SurfaceTone }
    | { kind: 'image'; url: string; position: LandingImagePosition; tone: SurfaceTone };

/** Superficie del hero: imagen > degradado > token (bg-primary, como el diseno actual). */
export function heroSurface(cfg: LandingConfig): Surface {
    const h = cfg.hero;
    if (h?.imageUrl) return { kind: 'image', url: h.imageUrl, position: h.imagePosition || 'center', tone: toneForImage(h.overlay) };
    if (h?.gradient) return { kind: 'gradient', css: gradientCss(h.gradient), tone: toneForColors(gradientSamples(h.gradient)) };
    return { kind: 'token' };
}

/** Fondo de pagina (center/minimal/fullscreen-bg). Sin `background` devuelve null (el llamador decide). */
export function pageSurface(cfg: LandingConfig): Surface | null {
    const b = cfg.background;
    if (!b) return null;
    const type = b.type || (b.imageUrl ? 'image' : b.gradient ? 'gradient' : b.color ? 'color' : undefined);
    if (type === 'image' && b.imageUrl) return { kind: 'image', url: b.imageUrl, position: 'center', tone: toneForImage(b.overlay) };
    if (type === 'gradient' && b.gradient) return { kind: 'gradient', css: gradientCss(b.gradient), tone: toneForColors(gradientSamples(b.gradient)) };
    if (type === 'color' && b.color) return { kind: 'color', color: b.color, tone: toneForColors([b.color]) };
    return null;
}

/** Estilo inline (solo valores validados por el sanitizer: hex, enteros, gradientes propios). */
export function surfaceStyle(s: Surface): { backgroundColor?: string; backgroundImage?: string; color?: string } {
    switch (s.kind) {
        case 'color': return { backgroundColor: s.color, color: s.tone.fg };
        case 'gradient': return { backgroundImage: s.css, color: s.tone.fg };
        case 'image': return { backgroundColor: IMAGE_BASE, color: s.tone.fg };
        default: return {};
    }
}

const OBJECT_POSITION: Record<LandingImagePosition, string> = {
    center: 'center', top: 'top', bottom: 'bottom', left: 'left', right: 'right',
};
export function objectPosition(p: LandingImagePosition): string {
    return OBJECT_POSITION[p] || 'center';
}

/** Trama decorativa (CSS puro, sin recursos externos). */
export function patternStyle(p: LandingPattern | undefined): { backgroundImage: string; backgroundSize?: string } | null {
    switch (p) {
        case 'dots': return { backgroundImage: 'radial-gradient(currentColor 1.2px, transparent 1.6px)', backgroundSize: '22px 22px' };
        case 'grid': return {
            backgroundImage: 'linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)',
            backgroundSize: '32px 32px',
        };
        case 'diagonal': return { backgroundImage: 'repeating-linear-gradient(45deg, currentColor 0 1px, transparent 1px 14px)' };
        default: return null;
    }
}
