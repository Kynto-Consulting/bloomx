import type { CSSProperties, ReactNode } from 'react';
import { TEXT_LIGHT, objectPosition, patternStyle, surfaceStyle, type Surface } from '@/lib/landing-surface';
import type { LandingPattern } from '@/lib/landing-config';

export interface ToneInfo {
    className: string;
    style: CSSProperties;
    /** Que variante de logo usar. */
    on: 'theme' | 'dark-surface' | 'light-surface';
}

/** Color de texto sobre una superficie. Personalizada -> color calculado (AA); de tema -> tokens. */
export function toneOf(surface: Surface | null, token: 'primary' | 'background'): ToneInfo {
    if (!surface || surface.kind === 'token') {
        return token === 'primary'
            ? { className: 'text-primary-foreground', style: {}, on: 'theme' }
            : { className: 'text-foreground', style: {}, on: 'theme' };
    }
    return {
        className: '',
        style: { color: surface.tone.fg },
        on: surface.tone.fg === TEXT_LIGHT ? 'dark-surface' : 'light-surface',
    };
}

interface BoxProps {
    surface: Surface | null;
    /** Cuando `surface` es token o null: clase de fondo (bg-primary/95, bg-background...). */
    tokenClass: string;
    pattern?: LandingPattern;
    imageAlt?: string;
    eager?: boolean;
    className?: string;
    children: ReactNode;
    as?: 'div' | 'section' | 'aside';
    ariaLabel?: string;
}

/**
 * Caja con fondo personalizado: color/degradado/imagen (+ velo calculado + trama). La imagen es un <img>
 * (nunca CSS url()), con referrerPolicy no-referrer; sin imagen no se hace ninguna peticion externa.
 */
export function SurfaceBox({ surface, tokenClass, pattern, imageAlt, eager, className, children, as, ariaLabel }: BoxProps) {
    const Tag = as || 'div';
    const custom = surface && surface.kind !== 'token' ? surface : null;
    const pat = patternStyle(pattern);
    return (
        <Tag
            aria-label={ariaLabel}
            className={`relative isolate overflow-hidden ${custom ? '' : tokenClass} ${className || ''}`}
            style={custom ? surfaceStyle(custom) : undefined}
        >
            {custom?.kind === 'image' && (
                <img
                    src={custom.url}
                    alt={imageAlt || ''}
                    loading={eager ? 'eager' : 'lazy'}
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 -z-10 h-full w-full object-cover"
                    style={{ objectPosition: objectPosition(custom.position) }}
                />
            )}
            {custom && custom.tone.scrim > 0 && (
                <div
                    aria-hidden="true"
                    data-landing-scrim={custom.tone.scrim}
                    className="absolute inset-0 -z-10"
                    style={{ backgroundColor: custom.tone.scrimColor, opacity: custom.tone.scrim }}
                />
            )}
            {pat && <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 opacity-10" style={pat} />}
            {children}
        </Tag>
    );
}
