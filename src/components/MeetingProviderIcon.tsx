import type { MeetingLinkProviderKey } from '@/lib/conferencing/hosts';

/**
 * Icono minimo (SVG propio, `currentColor`) del proveedor de un enlace de reunion, para el boton "Unirse" del lector.
 * Decorativo (aria-hidden): el boton lleva su propio aria-label. Sin colores: hereda el color de texto.
 * (Si el kit de conferencing aporta un ProviderIcon comun, este componente puede reemplazarse por el.)
 */
export function MeetingProviderIcon({ provider, className }: { provider: MeetingLinkProviderKey; className?: string }) {
    const common = {
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.75,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
        className,
        'aria-hidden': true,
        focusable: false,
    };

    switch (provider) {
        case 'google-meet':
            // Camara con lente lateral.
            return (
                <svg {...common}>
                    <rect x="3" y="6.5" width="12" height="11" rx="2" />
                    <path d="M15 10.5l5-3v9l-5-3" />
                </svg>
            );
        case 'zoom':
            // Camara dentro de un circulo.
            return (
                <svg {...common}>
                    <circle cx="12" cy="12" r="9" />
                    <rect x="6.5" y="9" width="7" height="6" rx="1.25" />
                    <path d="M13.5 11l4-2v6l-4-2" />
                </svg>
            );
        case 'teams':
            // "T" dentro de un cuadrado.
            return (
                <svg {...common}>
                    <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
                    <path d="M8 9h8M12 9v7" />
                </svg>
            );
        case 'webex':
            // Arco de llamada.
            return (
                <svg {...common}>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M7.5 9.5l2.25 5 2.25-4 2.25 4 2.25-5" />
                </svg>
            );
        case 'jitsi':
            // Persona + senal.
            return (
                <svg {...common}>
                    <circle cx="12" cy="8.5" r="3" />
                    <path d="M6 19c.8-3 3.2-4.5 6-4.5s5.2 1.5 6 4.5" />
                </svg>
            );
        default:
            // Enlace generico.
            return (
                <svg {...common}>
                    <path d="M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1 1" />
                    <path d="M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1" />
                </svg>
            );
    }
}
