/**
 * Correos EXTERNOS (puro): remitente fuera de los dominios propios/internos, salvo una whitelist propia de externos de confianza.
 * Compartido por el servidor (webhook: guarda isExternal) y el navegador (insignia y aviso, con la politica publica actual).
 */
import { identityOf, type Identity } from './lists-core';
import { normalizeText, domainOf, isSubdomainOf } from './text';

export interface ExternalInput {
    fromEmail: string;
    fromName?: string;
    /** Dominios propios + internos adicionales + dominio del destinatario. */
    internalDomains: string[];
    /** Whitelist de externos de confianza (dominio + personal). */
    trusted?: { match(who: Identity, at?: Date): string | null } | null;
    /** Nombres visibles (normalizados) de usuarios internos, para detectar suplantacion de companeros. */
    internalNames?: ReadonlySet<string>;
    firstTime?: boolean;
    colleagueSpoof?: boolean;
}

export interface ExternalVerdict {
    external: boolean;
    /** En la whitelist de confianza. */
    trusted: boolean;
    /** Hay que mostrar aviso (externo y no confiable). */
    warn: boolean;
    /** El nombre visible coincide con un usuario interno o con el dominio propio pero la direccion es externa. */
    colleagueSpoof: boolean;
    firstTime: boolean;
}

export function isInternalDomain(domain: string, internal: readonly string[]): boolean {
    const d = domain.toLowerCase();
    return internal.some((x) => x && isSubdomainOf(d, x.toLowerCase()));
}

export function classifyExternal(i: ExternalInput): ExternalVerdict {
    const email = i.fromEmail.toLowerCase();
    const domain = domainOf(email);
    if (!domain) return { external: false, trusted: false, warn: false, colleagueSpoof: false, firstTime: false };
    const external = !isInternalDomain(domain, i.internalDomains);
    if (!external) return { external: false, trusted: false, warn: false, colleagueSpoof: false, firstTime: false };
    const trusted = !!i.trusted && i.trusted.match(identityOf(email)) !== null;
    let spoof = false;
    if (i.colleagueSpoof !== false && i.fromName) {
        const n = normalizeText(i.fromName);
        const namesOwn = i.internalNames?.has(n) && n.split(' ').length >= 2;
        const mentionsOwn = i.internalDomains.some((d) => d && n.includes(d.toLowerCase()));
        spoof = !!(namesOwn || mentionsOwn);
    }
    // Un externo de confianza NO elude la alerta de suplantacion de companero (nombre interno con direccion externa).
    return { external: true, trusted, warn: !trusted || spoof, colleagueSpoof: spoof, firstTime: i.firstTime === true };
}

export const DEFAULT_EXTERNAL_TEXT = {
    es: 'Este mensaje viene de fuera de tu organización. Ten cuidado con los enlaces y adjuntos, y no compartas contraseñas.',
    en: 'This message comes from outside your organization. Be careful with links and attachments, and never share passwords.',
} as const;

export function externalNotice(cfgText: { es: string; en: string }, lang: 'es' | 'en'): string {
    return (cfgText[lang] || '').trim() || DEFAULT_EXTERNAL_TEXT[lang];
}

/** Etiqueta solo de visualizacion para el asunto de la lista. */
export const EXTERNAL_TAG = '[EXTERNO]';
export const EXTERNAL_TAG_EN = '[EXTERNAL]';
