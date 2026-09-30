/**
 * Heuristicas anti-phishing para enlaces de correos entrantes.
 * Puro (sin DOM): se usa desde SafeIframe antes de construir el documento y se prueba con vitest.
 */

export type LinkRisk = {
    /** Host real al que apunta el href (sin "www."), en ASCII/punycode tal como lo resuelve el navegador. */
    host: string;
    reasons: Array<'mismatch' | 'punycode' | 'ip' | 'userinfo' | 'shortener'>;
};

const SHORTENERS = new Set([
    'bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'tiny.cc', 'rb.gy', 's.id',
]);

// Sufijos de dos niveles frecuentes para comparar "dominio registrable" sin la Public Suffix List.
const TWO_LEVEL_SUFFIXES = new Set([
    'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'com.br', 'com.mx',
    'com.ar', 'com.co', 'com.pe', 'com.cl', 'com.ve', 'com.ec', 'com.uy', 'com.bo', 'co.za', 'co.in', 'com.tr', 'com.cn', 'com.hk',
]);

function stripWww(host: string): string {
    return host.replace(/^www\./, '');
}

export function registrableDomain(host: string): string {
    const labels = stripWww(host.toLowerCase()).split('.').filter(Boolean);
    if (labels.length <= 2) return labels.join('.');
    const lastTwo = labels.slice(-2).join('.');
    return TWO_LEVEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

function isIpHost(host: string): boolean {
    return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.startsWith('[') || /^0x[0-9a-f]+$/i.test(host);
}

/** Primer token del texto visible que parezca una URL o un dominio ("https://x.com/a", "x.com"). */
export function extractVisibleDomain(text: string): string | null {
    const t = String(text || '').trim();
    if (!t || t.length > 300) return null;
    const m = t.match(/(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?::\d+)?(?:[/?#]|\s|$)/i);
    if (!m) return null;
    // Sin esquema ni "www." un dominio "desnudo" debe escribirse con TLD en minusculas: evita falsos
    // positivos con "Sr.Perez" o "Dr.Garcia" (los TLD mayusculas tras un punto son casi siempre nombres).
    const hasScheme = /^https?:\/\//i.test(t) || /^www\./i.test(t);
    const tld = m[1].split('.').pop() || '';
    if (!hasScheme && tld !== tld.toLowerCase()) return null;
    return m[1].toLowerCase();
}

/**
 * Analiza un enlace. Devuelve null si parece normal (o no es http/https). Devuelve el riesgo si:
 *  - el texto visible muestra un dominio distinto del destino real,
 *  - el host es punycode (posible homografo), una IP o un acortador,
 *  - la URL incluye credenciales (user@host) que enganan sobre el host real.
 */
export function analyzeLink(text: string, href: string): LinkRisk | null {
    let url: URL;
    try {
        url = new URL(String(href || '').trim());
    } catch {
        return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    const host = stripWww(url.hostname.toLowerCase());
    if (!host) return null;
    const reasons: LinkRisk['reasons'][number][] = [];

    const visible = extractVisibleDomain(text);
    if (visible && registrableDomain(visible) !== registrableDomain(host)) reasons.push('mismatch');
    if (host.split('.').some((l) => l.startsWith('xn--'))) reasons.push('punycode');
    if (isIpHost(host)) reasons.push('ip');
    if (url.username || url.password) reasons.push('userinfo');
    if (SHORTENERS.has(host)) reasons.push('shortener');

    return reasons.length > 0 ? { host, reasons } : null;
}

export function describeLinkRisk(risk: LinkRisk): string {
    const parts: string[] = [];
    if (risk.reasons.includes('mismatch')) parts.push('el texto muestra otro dominio');
    if (risk.reasons.includes('punycode')) parts.push('dominio con caracteres internacionales');
    if (risk.reasons.includes('ip')) parts.push('direccion IP');
    if (risk.reasons.includes('userinfo')) parts.push('incluye credenciales en la URL');
    if (risk.reasons.includes('shortener')) parts.push('acortador de enlaces');
    return parts.join(', ');
}
