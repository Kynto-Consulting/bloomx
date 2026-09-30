import React from 'react';

/**
 * Iconos propios por proveedor de videoconferencia (SVG en `currentColor`: heredan el color del tema, sin colores de
 * marca fijos). Son glifos genericos de "camara de video" diferenciados por la forma, no logotipos registrados.
 */
export type ProviderIconKey = 'google-meet' | 'zoom' | 'link' | string;

export function ProviderIcon({ icon, className = 'h-4 w-4' }: { icon: ProviderIconKey; className?: string }) {
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
