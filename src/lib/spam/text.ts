/** Utilidades de texto/URL/dominio del motor de spam (puras). */
import { attrValue, htmlToText, innerTextAfter, scanTags } from './html-scan';

const ZERO_WIDTH = /[​-‏⁠-⁤﻿­᠎]/g;

/** Homoglifos cirilicos/griegos -> latino (para que el lexico no se evada con letras "gemelas"). */
const HOMOGLYPHS: Record<string, string> = {
    'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'к': 'k', 'м': 'm', 'н': 'h', 'т': 't', 'в': 'b', 'і': 'i', 'ј': 'j', 'ѕ': 's',
    'ԁ': 'd', 'ɡ': 'g', 'ӏ': 'l', 'ı': 'i',
    'ο': 'o', 'α': 'a', 'ε': 'e', 'ρ': 'p', 'ν': 'v', 'τ': 't', 'κ': 'k', 'ι': 'i', 'υ': 'u', 'χ': 'x', 'β': 'b', 'η': 'n',
};

const CYRILLIC = /[Ѐ-ӿԀ-ԯ]/;
const GREEK = /[Ͱ-Ͽ]/;
const LATIN = /[A-Za-zÀ-ɏ]/;

export function stripZeroWidth(s: string): string {
    return s.replace(ZERO_WIDTH, '');
}

export function countZeroWidth(s: string): number {
    const m = s.match(ZERO_WIDTH);
    return m ? m.length : 0;
}

/** True si alguna palabra mezcla latino con cirilico/griego (tipico de un homoglifo). */
export function hasMixedScriptWord(s: string): boolean {
    for (const word of s.split(/[\s.,;:!?()<>"'/\\@_-]+/)) {
        if (word.length < 3) continue;
        if (LATIN.test(word) && (CYRILLIC.test(word) || GREEK.test(word))) return true;
    }
    return false;
}

export function foldHomoglyphs(s: string): string {
    let out = '';
    for (const ch of s) out += HOMOGLYPHS[ch] ?? ch;
    return out;
}

/** Minusculas, sin acentos, sin caracteres de ancho cero, homoglifos plegados y espacios colapsados. */
export function normalizeText(s: string): string {
    return foldHomoglyphs(stripZeroWidth(String(s ?? '')).toLowerCase())
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '(c)', euro: 'EUR' };

export function decodeEntities(s: string): string {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
        if (e[0] === '#') {
            const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
        }
        return ENTITIES[e.toLowerCase()] ?? m;
    });
}

/** Texto VISIBLE de un HTML (sin script/style/comentarios/elementos ocultos). Acotado a 200 KB. */
export function visibleText(html: string): string {
    // Escaner lineal (html-scan.ts): sin regex perezosas sobre entrada hostil. El texto oculto se senala aparte (content.hidden_text).
    const h = htmlToText(String(html ?? '').slice(0, 200_000));
    return decodeEntities(h).replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

// ---------------------------------------------------------------------------
// Direcciones
// ---------------------------------------------------------------------------
export function parseAddress(value: unknown): { name: string; email: string } {
    const raw = String(value ?? '').trim();
    const m = raw.match(/^(.*?)<\s*([^<>\s]+)\s*>\s*$/);
    if (m) return { name: m[1].trim().replace(/^"+|"+$/g, '').trim(), email: m[2].trim().toLowerCase() };
    const bare = raw.match(/[^\s<>",;]+@[^\s<>",;]+/);
    return { name: '', email: bare ? bare[0].toLowerCase() : '' };
}

export function domainOf(email: string): string {
    const at = String(email ?? '').lastIndexOf('@');
    return at < 0 ? '' : email.slice(at + 1).trim().toLowerCase().replace(/[>\s.]+$/, '');
}

const SECOND_LEVEL = new Set([
    'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'com.br', 'net.br', 'org.br', 'gov.br', 'com.mx', 'org.mx', 'gob.mx',
    'com.ar', 'gob.ar', 'gov.ar', 'com.pe', 'gob.pe', 'org.pe', 'com.co', 'gov.co', 'com.ve', 'com.ec', 'com.bo', 'com.uy', 'com.py', 'com.cl', 'com.gt', 'com.pa',
    'com.do', 'com.sv', 'com.hn', 'com.ni', 'com.cr', 'com.cu', 'com.es', 'gob.es', 'com.pt', 'com.tr', 'co.za', 'co.in', 'com.sg', 'com.hk', 'com.cn', 'co.kr',
]);

/** Dominio registrable aproximado (eTLD+1) sin lista publica de sufijos: cubre los sufijos de dos niveles habituales. */
export function registrable(host: string): string {
    const h = String(host ?? '').toLowerCase().replace(/\.$/, '');
    if (!h || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) return h;
    const parts = h.split('.');
    if (parts.length <= 2) return h;
    const last2 = parts.slice(-2).join('.');
    if (SECOND_LEVEL.has(last2)) return parts.slice(-3).join('.');
    return last2;
}

export function sameOrg(a: string, b: string): boolean {
    const ra = registrable(a), rb = registrable(b);
    return !!ra && ra === rb;
}

/** `host` es `domain` o un subdominio suyo. */
export function isSubdomainOf(host: string, domain: string): boolean {
    const h = host.toLowerCase(), d = domain.toLowerCase();
    return !!d && (h === d || h.endsWith(`.${d}`));
}

export function tldOf(host: string): string {
    const i = host.lastIndexOf('.');
    return i < 0 ? host : host.slice(i + 1);
}

export function isIpHost(host: string): boolean {
    const h = host.replace(/^\[|\]$/g, '');
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
    if (/^0x[0-9a-f]+$/i.test(h) || /^\d{8,10}$/.test(h)) return true; // formas hexadecimal / decimal de una IPv4
    return h.includes(':') && /^[0-9a-f:]+$/i.test(h);
}

export function levenshtein(a: string, b: string, max = 3): number {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
            const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            cur.push(v);
            if (v < rowMin) rowMin = v;
        }
        if (rowMin > max) return max + 1;
        prev = cur;
    }
    return prev[b.length];
}

// ---------------------------------------------------------------------------
// Enlaces
// ---------------------------------------------------------------------------
export interface LinkInfo { href: string; text: string; host: string; port: string; userinfo: boolean; url: URL | null }

function parseUrl(raw: string): URL | null {
    try {
        const u = new URL(raw.trim());
        return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
    } catch { return null; }
}

const MAX_LINKS = 200;

/** Enlaces <a href> del HTML y URLs sueltas del texto. Acotado (200) y sin ejecutar nada. */
export function extractLinks(html: string, text: string): LinkInfo[] {
    const out: LinkInfo[] = [];
    const seen = new Set<string>();
    const push = (href: string, label: string) => {
        if (out.length >= MAX_LINKS) return;
        const decoded = decodeEntities(href).trim();
        const u = parseUrl(decoded);
        if (!u) return;
        const key = `${decoded}|${label}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ href: decoded, text: label, host: u.hostname.toLowerCase(), port: u.port, userinfo: !!(u.username || u.password), url: u });
    };
    const h = String(html ?? '').slice(0, 300_000);
    let examined = 0;
    for (const tag of scanTags(h)) {
        if (out.length >= MAX_LINKS || examined >= 1000) break;
        if (tag.closing || tag.name !== 'a') continue;
        const href = attrValue(tag.attrs, 'href');
        if (href === null) continue;
        examined++;
        push(href, decodeEntities(innerTextAfter(h, tag, 600)));
    }
    const t = String(text ?? '').slice(0, 100_000);
    const urlRe = /https?:\/\/[^\s<>"')\]]+/gi;
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = urlRe.exec(t)) && guard++ < 500) push(m[0].replace(/[.,;:!?]+$/, ''), '');
    return out;
}

/** Si el texto visible del enlace parece un dominio o URL, devuelve ese host. */
export function hostShownInText(label: string): string | null {
    const s = label.trim();
    if (!s || s.length > 120) return null;
    const m = s.match(/^(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9-]+\.)+[a-z]{2,24})(?:[/:?#].*)?$/i);
    return m ? m[1].toLowerCase() : null;
}

/** Decodifica un host punycode (xn--) a Unicode para inspeccion; devuelve el original si no se puede. */
export function decodePunycodeHost(host: string): string {
    try {
        // URL#hostname ya esta en punycode; domainToUnicode viene de node:url, no disponible en navegador -> se evita.
        return host.split('.').map((label) => (label.startsWith('xn--') ? punyDecode(label.slice(4)) : label)).join('.');
    } catch { return host; }
}

// Decodificador punycode (RFC 3492) minimo.
function punyDecode(input: string): string {
    const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
    const out: number[] = [];
    let n = 128, i = 0, bias = 72;
    let basic = input.lastIndexOf('-');
    if (basic < 0) basic = 0;
    for (let j = 0; j < basic; j++) out.push(input.charCodeAt(j));
    const adapt = (delta: number, numPoints: number, first: boolean) => {
        let k = 0;
        delta = first ? Math.floor(delta / damp) : delta >> 1;
        delta += Math.floor(delta / numPoints);
        for (; delta > ((base - tMin) * tMax) >> 1; k += base) delta = Math.floor(delta / (base - tMin));
        return Math.floor(k + ((base - tMin + 1) * delta) / (delta + skew));
    };
    for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length;) {
        const oldi = i;
        for (let w = 1, k = base; ; k += base) {
            if (idx >= input.length) throw new Error('bad');
            const c = input.charCodeAt(idx++);
            const digit = c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : base;
            if (digit >= base) throw new Error('bad');
            i += digit * w;
            const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
            if (digit < t) break;
            w *= base - t;
        }
        const len = out.length + 1;
        bias = adapt(i - oldi, len, oldi === 0);
        n += Math.floor(i / len);
        i %= len;
        out.splice(i++, 0, n);
    }
    return String.fromCodePoint(...out);
}
