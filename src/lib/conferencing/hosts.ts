/**
 * Validacion y reconocimiento de enlaces de reunion (puro: sirve en navegador, servidor y tests).
 *
 * Regla de seguridad: un enlace de reunion solo se ofrece como boton "Unirse" si es https, sin credenciales en la URL,
 * sin puertos raros y si su host pertenece EXACTAMENTE (o es subdominio) de un proveedor conocido. Cualquier otro
 * enlace se muestra como texto con un aviso, nunca como boton de confianza.
 */
import type { ConferencingProviderId } from './types';

export type MeetingLinkProviderKey = 'google-meet' | 'zoom' | 'teams' | 'webex' | 'jitsi' | 'custom';

interface HostRule {
    key: MeetingLinkProviderKey;
    name: string;
    /** Dominios registrables: host === d || host termina en ".d". */
    domains: string[];
    /** Regex sobre pathname para exigir forma de enlace de reunion. */
    path?: RegExp;
}

const RULES: HostRule[] = [
    {
        key: 'google-meet',
        name: 'Google Meet',
        domains: ['meet.google.com'],
        path: /^\/(?:[a-z]{3}-[a-z]{4}-[a-z]{3}|lookup\/[A-Za-z0-9_-]+|_meet\/[A-Za-z0-9_-]+)\/?$/i,
    },
    { key: 'zoom', name: 'Zoom', domains: ['zoom.us', 'zoom.com', 'zoomgov.com'], path: /^\/(?:j|s|w|wc|my|meeting)\//i },
    {
        key: 'teams',
        name: 'Microsoft Teams',
        domains: ['teams.microsoft.com', 'teams.live.com', 'teams.microsoft.us'],
        path: /^\/(?:l\/meetup-join|meet|meeting)\//i,
    },
    { key: 'webex', name: 'Webex', domains: ['webex.com'], path: /^\/(?:meet|join|[^/]+\/j\.php|wbxmjs)/i },
    { key: 'jitsi', name: 'Jitsi Meet', domains: ['meet.jit.si', '8x8.vc'], path: /^\/[^/]{3,}/ },
];

export interface MeetingLinkInfo {
    /** URL normalizada (href del objeto URL), solo si es segura de abrir. */
    url: string;
    provider: MeetingLinkProviderKey;
    /** Nombre del proveedor reconocido, o el host si no se reconoce. */
    providerName: string;
    /** true si el host es de un proveedor conocido y la ruta tiene la forma de un enlace de reunion. */
    recognized: boolean;
}

function hostMatches(host: string, domain: string): boolean {
    return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Analiza un enlace. Devuelve null si NO es una URL https segura (esquema distinto de https, credenciales, puerto
 * no estandar, caracteres de control o longitud excesiva).
 */
export function analyzeMeetingUrl(raw: unknown): MeetingLinkInfo | null {
    if (typeof raw !== 'string') return null;
    const text = raw.trim();
    // eslint-disable-next-line no-control-regex
    if (!text || text.length > 2048 || /[\u0000- \u007f"'<>\\`]/.test(text)) return null;
    let url: URL;
    try {
        url = new URL(text);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    if (url.port && url.port !== '443') return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!host || !host.includes('.')) return null;

    for (const rule of RULES) {
        if (!rule.domains.some((d) => hostMatches(host, d))) continue;
        if (!rule.path || rule.path.test(url.pathname)) {
            return { url: url.href, provider: rule.key, providerName: rule.name, recognized: true };
        }
    }
    return { url: url.href, provider: 'custom', providerName: host, recognized: false };
}

/** Enlace reconocido de un proveedor conocido (https + host + forma de ruta), o null. */
export function recognizeMeetingUrl(raw: unknown): MeetingLinkInfo | null {
    const info = analyzeMeetingUrl(raw);
    return info && info.recognized ? info : null;
}

/** Extrae el primer enlace de reunion reconocido de un texto libre (ubicacion, descripcion de un evento). */
export function findMeetingUrlInText(text: unknown): string | null {
    if (typeof text !== 'string' || !text) return null;
    const re = /https:\/\/[^\s<>"'\])\\]+/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
        const cleaned = m[0].replace(/[.,;:!?]+$/, '');
        const info = recognizeMeetingUrl(cleaned);
        if (info) return info.url;
    }
    return null;
}

/** Proveedor del registro del host que corresponde a un enlace reconocido (null para webex/jitsi/otros). */
export function providerIdForLink(raw: unknown): ConferencingProviderId | null {
    const info = recognizeMeetingUrl(raw);
    if (!info) return null;
    if (info.provider === 'google-meet') return 'google-meet';
    if (info.provider === 'zoom') return 'zoom';
    if (info.provider === 'teams') return 'microsoft-teams';
    return null;
}

/** Nombre mostrado para cualquier enlace https valido (reconocido o no); null si no es seguro. */
export function meetingProviderName(raw: unknown): string | null {
    return analyzeMeetingUrl(raw)?.providerName ?? null;
}

/**
 * Enlace apto para `LOCATION`/`URL` de un ICS o para un href: https sin caracteres de control; null si no lo es.
 * (No exige proveedor reconocido: un enlace propio valido tambien puede ir en el ICS.)
 */
export function safeConferenceUrl(raw: unknown): string | null {
    return analyzeMeetingUrl(raw)?.url ?? null;
}
