/**
 * Politica de imagenes remotas (anti tracking pixel). Por defecto se bloquean; el usuario puede
 * permitirlas para un correo concreto o siempre para un remitente. La lista se guarda en
 * localStorage (solo comodidad por navegador; nunca se envia al servidor).
 */

const STORAGE_KEY = 'bloomx:remote-images:v1';
const MAX_ENTRIES = 500;

export type RemoteImagePolicy = { emails: string[]; senders: string[] };

/** True si el HTML referencia recursos remotos que SafeIframe bloqueara (img, background, url(...)). */
export function hasRemoteImages(html: string): boolean {
    const source = String(html || '');
    if (!source) return false;
    if (/<img\b[^>]*\bsrc\s*=\s*["']?\s*(?:https?:)?\/\//i.test(source)) return true;
    if (/\burl\(\s*["']?\s*(?:https?:)?\/\//i.test(source)) return true;
    if (/\b(?:background|poster)\s*=\s*["']?\s*https?:\/\//i.test(source)) return true;
    return false;
}

/** Direccion en minusculas de "Nombre <a@b>" o "a@b". */
export function senderAddress(from: string | null | undefined): string {
    const raw = String(from || '').trim();
    const angled = raw.match(/<([^<>]+)>\s*$/);
    return (angled?.[1] || raw).trim().replace(/^"+|"+$/g, '').toLowerCase();
}

export function emptyPolicy(): RemoteImagePolicy {
    return { emails: [], senders: [] };
}

export function isRemoteImagesAllowed(policy: RemoteImagePolicy, emailId: string, from: string | null | undefined): boolean {
    const sender = senderAddress(from);
    return policy.emails.includes(emailId) || (!!sender && policy.senders.includes(sender));
}

function cap(list: string[]): string[] {
    return list.length > MAX_ENTRIES ? list.slice(list.length - MAX_ENTRIES) : list;
}

export function allowForEmail(policy: RemoteImagePolicy, emailId: string): RemoteImagePolicy {
    if (policy.emails.includes(emailId)) return policy;
    return { ...policy, emails: cap([...policy.emails, emailId]) };
}

export function allowForSender(policy: RemoteImagePolicy, from: string | null | undefined): RemoteImagePolicy {
    const sender = senderAddress(from);
    if (!sender || policy.senders.includes(sender)) return policy;
    return { ...policy, senders: cap([...policy.senders, sender]) };
}

export function loadPolicy(): RemoteImagePolicy {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
        const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
        return { emails: strings(parsed?.emails), senders: strings(parsed?.senders) };
    } catch {
        return emptyPolicy();
    }
}

export function savePolicy(policy: RemoteImagePolicy): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(policy));
    } catch {
        // Modo privado / almacenamiento bloqueado: la decision solo dura la sesion en memoria.
    }
}
