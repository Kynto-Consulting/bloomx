import type { MeetingLinkProviderKey } from '@/lib/conferencing/hosts';
import { ExtensionIcon } from '@/components/expansions/ExtensionIcon';

/** Proveedores con logotipo real en el registro de marcas (Teams no lo tiene: ficha neutra con su inicial). */
const BRAND_OF: Partial<Record<MeetingLinkProviderKey, string>> = { 'google-meet': 'brand:googlemeet', zoom: 'brand:zoom', teams: 'brand:microsoftteams' };

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

    const brand = BRAND_OF[provider];
    if (brand) {
        return (
            <span data-provider-icon={provider} className={`inline-flex shrink-0 ${className ?? ''}`}>
                <ExtensionIcon icon={brand} size={16} />
            </span>
        );
    }

    switch (provider) {
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
