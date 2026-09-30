import React from 'react';
import { ExtensionIcon, nearestIconSize } from '@/components/expansions/ExtensionIcon';

/**
 * Iconos por proveedor de videoconferencia. Zoom y Google Meet usan su logotipo real del registro de marcas (ExtensionIcon,
 * con garantia de contraste segun el tema); el resto (enlace, desconocidos) usa un glifo propio en `currentColor`.
 */
export type ProviderIconKey = 'google-meet' | 'zoom' | 'link' | string;

/** Logotipo real (registro de marcas) de los proveedores que lo tienen; el resto usa el glifo generico de abajo. */
const BRAND_OF: Record<string, string> = { zoom: 'brand:zoom', 'google-meet': 'brand:googlemeet' };

/** Tamano en px a partir de las clases h-N del llamante (h-4 = 16 px). */
function sizeFromClass(className: string): 16 | 20 | 24 | 32 {
    const match = /(?:^|\s)h-(\d+)(?:\s|$)/.exec(className);
    return nearestIconSize(match ? Number(match[1]) * 4 : 16);
}

export function ProviderIcon({ icon, className = 'h-4 w-4' }: { icon: ProviderIconKey; className?: string }) {
    if (BRAND_OF[icon]) {
        return (
            <span data-provider-icon={icon} className="inline-flex shrink-0">
                <ExtensionIcon icon={BRAND_OF[icon]} size={sizeFromClass(className)} />
            </span>
        );
    }
    const common = {
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
        className,
        'aria-hidden': true as const,
        focusable: false as const,
        'data-provider-icon': icon,
    };
    if (icon === 'zoom') {
        // Camara en un recuadro redondeado (cuerpo + lente).
        return (
            <svg {...common}>
                <rect x="2.5" y="6" width="13" height="12" rx="3" />
                <path d="M15.5 10.5 21 7.5v9l-5.5-3" />
            </svg>
        );
    }
    if (icon === 'google-meet') {
        // Camara con un corte en la esquina (estilo "sala").
        return (
            <svg {...common}>
                <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H13v12H5.5A2.5 2.5 0 0 1 3 15.5z" />
                <path d="M13 10.5 17 7h4v10h-4l-4-3.5" />
                <path d="M7 12h3" />
            </svg>
        );
    }
    // 'link' y desconocidos: cadena.
    return (
        <svg {...common}>
            <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
            <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
        </svg>
    );
}
