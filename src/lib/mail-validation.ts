/**
 * Validacion y saneamiento para el envio de correo.
 * Evita inyeccion de cabeceras (CRLF, RFC 5322 sec. 2.2), direcciones malformadas
 * y abuso por listas gigantes de destinatarios.
 *
 * Controles: NIST SP 800-177r1 sec. 4, CIS v8 9.x / 16.x, ISO 27002:2022 8.26.
 */

import { splitAddressList } from './email-utils';

// Direccion "razonable" (RFC 5321 simplificado): sin espacios, sin CR/LF, un solo @.
// El dominio debe llegar ya en ASCII (los IDN se convierten antes con domainToAsciiSafe).
// El TLD puede ser alfabetico o punycode (xn--...).
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59})$/;

export const MAX_RECIPIENTS = 100;
export const MAX_SUBJECT_LENGTH = 998;

/** Elimina CR, LF y otros caracteres de control (anti header injection). */
export function stripControlChars(value: unknown): string {
    return String(value ?? '').replace(new RegExp('[\u0000-\u001F\u007F\u2028\u2029]+', 'g'), ' ').trim();
}

/** Asunto seguro para cabecera Subject. */
export function sanitizeSubject(value: unknown): string {
    return stripControlChars(value).slice(0, MAX_SUBJECT_LENGTH);
}

/** Nombre visible seguro para From:/To: (sin <>, comillas, comas, punto y coma ni control). */
export function sanitizeDisplayName(value: unknown): string {
    return stripControlChars(value).replace(/[<>",;\\]/g, '').slice(0, 120).trim();
}

/**
 * Convierte un dominio (posiblemente IDN, p. ej. "bücher.de") a ASCII/punycode usando el
 * parser WHATWG URL (Node y navegador). Devuelve null si contiene caracteres que no pueden
 * formar parte de un nombre de host.
 */
export function domainToAsciiSafe(domain: string): string | null {
    const d = String(domain ?? '').trim();
    if (!d || d.length > 253) return null;
    // Nada que un parser de URL pudiera reinterpretar (ruta, puerto, credenciales, espacios...).
    if (/[\s\u0000-\u001F\u007F/\\?#@:%<>[\]()"',;]/.test(d)) return null;
    if (d.startsWith('.') || d.endsWith('.') || d.includes('..')) return null;
    // Sin parte no-ASCII no hay nada que convertir.
    if (/^[\x00-\x7F]*$/.test(d)) return d.toLowerCase();
    try {
        const host = new URL(`http://${d}`).hostname;
        return host && /^[\x00-\x7F]+$/.test(host) ? host.toLowerCase() : null;
    } catch {
        return null;
    }
}

/**
 * Normaliza una direccion "local@dominio" con dominio IDN a su forma ASCII (punycode).
 * Devuelve null si no es valida. La parte local debe ser ASCII (sin SMTPUTF8).
 */
export function normalizeEmailAddressAscii(value: unknown): string | null {
    const v = String(value ?? '').trim();
    if (!v || v.length > 320) return null;
    const at = v.lastIndexOf('@');
    if (at <= 0) return null;
    const ascii = domainToAsciiSafe(v.slice(at + 1));
    if (!ascii) return null;
    const candidate = `${v.slice(0, at)}@${ascii}`;
    return candidate.length <= 254 && EMAIL_RE.test(candidate) ? candidate : null;
}

export function isValidEmailAddress(value: unknown): boolean {
    return normalizeEmailAddressAscii(value) !== null;
}

/** Extrae la direccion de "Nombre <a@b.com>" o "a@b.com" (sin validar). */
export function extractAddress(value: unknown): string {
    const raw = stripControlChars(value);
    const m = raw.match(/<([^<>]+)>\s*$/);
    return (m?.[1] || raw).trim();
}

/**
 * Convierte `a@b.com, "Doe, John" <c@d.com>` (string, o array de entradas) en una lista de
 * direcciones validas. Las comas dentro de comillas o de <...> no separan destinatarios
 * (splitAddressList). Los dominios IDN se devuelven en punycode. Devuelve { valid, invalid }.
 */
export function parseRecipientList(value: unknown): { valid: string[]; invalid: string[] } {
    const items: string[] = Array.isArray(value)
        ? value.flatMap((v) => splitAddressList(String(v ?? '')))
        : splitAddressList(String(value ?? ''));

    const valid: string[] = [];
    const invalid: string[] = [];
    const seen = new Set<string>();

    for (const item of items) {
        const trimmed = item.trim();
        if (!trimmed) continue;
        const address = normalizeEmailAddressAscii(extractAddress(trimmed));
        if (!address) {
            invalid.push(stripControlChars(trimmed).slice(0, 80));
            continue;
        }
        const key = address.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        valid.push(address);
    }

    return { valid, invalid };
}

/** "Nombre <email>" con nombre saneado; si no hay nombre, solo el email. */
export function formatFromHeader(name: unknown, email: string): string {
    const safeName = sanitizeDisplayName(name);
    return safeName ? `${safeName} <${email}>` : email;
}

/** Extensiones ejecutables / de script que no deben enviarse ni servirse en linea. */
const DANGEROUS_EXTENSIONS = new Set([
    'exe', 'scr', 'bat', 'cmd', 'com', 'pif', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'msi', 'msp',
    'jar', 'lnk', 'hta', 'ps1', 'psm1', 'reg', 'cpl', 'dll', 'sys', 'inf', 'gadget', 'application',
    'appx', 'msix', 'apk', 'dmg', 'iso', 'img', 'vhd', 'one',
]);

/** True si alguna de las extensiones del nombre es peligrosa (detecta doble extension: a.pdf.exe). */
export function hasDangerousExtension(filename: unknown): boolean {
    const parts = String(filename ?? '').toLowerCase().trim().split('.');
    if (parts.length < 2) return false;
    return parts.slice(1).some((ext) => DANGEROUS_EXTENSIONS.has(ext.trim()));
}

/** Tipos activos que un navegador podria ejecutar/renderizar si se sirven en linea. */
export function isActiveContentType(contentType: unknown): boolean {
    const t = String(contentType ?? '').toLowerCase().split(';')[0].trim();
    return (
        t === 'text/html' || t === 'application/xhtml+xml' || t === 'image/svg+xml' ||
        t === 'text/xml' || t === 'application/xml' || t === 'text/javascript' ||
        t === 'application/javascript' || t === 'application/x-javascript' || t === 'text/css'
    );
}

/** Escapa HTML para incrustar texto no confiable en plantillas de sistema. */
export function escapeHtmlText(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
