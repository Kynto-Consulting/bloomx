/**
 * Logica PURA de la visualizacion de correos externos en el navegador (sin React): politica publica (GET /api/spam/external),
 * clasificacion con el MISMO motor que el servidor (classifyExternal), etiqueta de asunto solo visual y claves de cierre.
 */
import { CompiledList } from '@/lib/spam/lists-core';
import { EXTERNAL_TAG, EXTERNAL_TAG_EN, classifyExternal, type ExternalVerdict } from '@/lib/spam/external';
import { registrableDomain } from '@/lib/link-safety';
import { domainOf, parseAddress } from '@/lib/spam/text';

export interface ExternalPolicy {
    enabled: boolean;
    style: 'info' | 'warning';
    subjectTag: boolean;
    colleagueSpoof: boolean;
    firstTime: boolean;
    hardenLinks: boolean;
    hardenAttachments: boolean;
    text: { es: string; en: string };
    internalDomains: string[];
    trusted: Array<{ t: string; v: string; s: boolean }>;
}

export interface StoredExternalFlags {
    colleagueSpoof?: boolean;
    firstTime?: boolean;
}

export type DisplayVerdict = ExternalVerdict;

const MATCH = new Set(['email', 'domain', 'wildcard', 'tld']);

/** Lee la respuesta del servidor con tolerancia total: cualquier forma inesperada -> null (nada se muestra). */
export function parseExternalPolicy(raw: unknown): ExternalPolicy | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.enabled !== 'boolean') return null;
    const text = (o.text && typeof o.text === 'object' ? o.text : {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    const trusted = (Array.isArray(o.trusted) ? o.trusted : [])
        .filter((x): x is { t: string; v: string; s?: unknown } => !!x && typeof x === 'object' && typeof (x as any).t === 'string' && typeof (x as any).v === 'string' && MATCH.has((x as any).t))
        .map((x) => ({ t: x.t, v: x.v, s: x.s === true }));
    return {
        enabled: o.enabled,
        style: o.style === 'warning' ? 'warning' : 'info',
        subjectTag: o.subjectTag === true,
        colleagueSpoof: o.colleagueSpoof !== false,
        firstTime: o.firstTime === true,
        hardenLinks: o.hardenLinks === true,
        hardenAttachments: o.hardenAttachments === true,
        text: { es: str(text.es), en: str(text.en) },
        internalDomains: (Array.isArray(o.internalDomains) ? o.internalDomains : []).filter((d): d is string => typeof d === 'string' && d.length > 0),
        trusted,
    };
}

const listCache = new WeakMap<ExternalPolicy, CompiledList>();

/** CompiledList de los confiables de la politica (ids sinteticos). Se memoiza por objeto de politica. */
export function trustedListOf(policy: ExternalPolicy): CompiledList {
    let list = listCache.get(policy);
    if (!list) {
        list = new CompiledList(policy.trusted.map((x, i) => ({
            id: `t${i}`, matchType: x.t as 'email' | 'domain' | 'wildcard' | 'tld', value: x.v, includeSubdomains: x.s, expiresAt: null,
        })));
        listCache.set(policy, list);
    }
    return list;
}

const NONE: DisplayVerdict = { external: false, trusted: false, warn: false, colleagueSpoof: false, firstTime: false };

/**
 * Como se muestra un remitente: interno / externo / confiable / suplantacion de companero. Reutiliza classifyExternal.
 * `storedFlags` son los que calculo el servidor al recibir (nombres de usuarios internos y primera vez, que el navegador no conoce).
 */
export function classifyForDisplay(
    policy: ExternalPolicy | null | undefined,
    fromHeader: string,
    myEmail?: string | null,
    storedFlags?: StoredExternalFlags | null,
): DisplayVerdict {
    if (!policy || !policy.enabled) return NONE;
    const { name, email } = parseAddress(fromHeader);
    if (!email) return NONE;
    const mine = String(myEmail ?? '').trim().toLowerCase();
    if (mine && email === mine) return NONE;
    const internal = Array.from(new Set([...policy.internalDomains, domainOf(mine)].filter(Boolean)));
    const v = classifyExternal({
        fromEmail: email,
        fromName: name,
        internalDomains: internal,
        trusted: trustedListOf(policy),
        colleagueSpoof: policy.colleagueSpoof,
        firstTime: policy.firstTime && storedFlags?.firstTime === true,
    });
    if (!v.external) return v;
    // La suplantacion detectada por el servidor (con nombres de usuarios internos) manda aunque el remitente este en la whitelist.
    if (policy.colleagueSpoof && storedFlags?.colleagueSpoof === true) return { ...v, colleagueSpoof: true, warn: true };
    return v;
}

/** Asunto para MOSTRAR en la lista: antepone la etiqueta. El asunto guardado (y el de responder/buscar) no se toca. */
export function subjectWithTag(subject: string, policy: ExternalPolicy | null | undefined, lang: 'es' | 'en', verdict?: DisplayVerdict | null): string {
    if (!policy || !policy.enabled || !policy.subjectTag) return subject;
    if (verdict && !verdict.warn) return subject;
    const tag = lang === 'en' ? EXTERNAL_TAG_EN : EXTERNAL_TAG;
    if (subject.startsWith(tag)) return subject;
    return subject ? `${tag} ${subject}` : tag;
}

/** Texto del aviso en el idioma (ya viene con el valor por defecto del servidor; se recorta por si llegara vacio). */
export function noticeText(policy: ExternalPolicy, lang: 'es' | 'en'): string {
    return (policy.text[lang] || policy.text[lang === 'es' ? 'en' : 'es'] || '').trim();
}

export function senderAddressOf(fromHeader: string): string {
    return parseAddress(fromHeader).email;
}

/** ¿El destino de un enlace http(s) es de un dominio registrable distinto al del remitente? */
export function linkLeavesSender(href: string, senderDomain: string): boolean {
    let host = '';
    try {
        const u = new URL(String(href).trim());
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
        host = u.hostname.toLowerCase();
    } catch { return false; }
    if (!host) return false;
    return registrableDomain(host) !== registrableDomain(senderDomain);
}

export const DISMISS_PREFIX = 'bloomx:spam:dismissed:';
export const dismissKey = (messageId: string) => `${DISMISS_PREFIX}${messageId}`;

export function readDismissed(messageId: string): boolean {
    try { return window.localStorage.getItem(dismissKey(messageId)) === '1'; } catch { return false; }
}
export function writeDismissed(messageId: string): void {
    try { window.localStorage.setItem(dismissKey(messageId), '1'); } catch { /* almacenamiento bloqueado */ }
}
