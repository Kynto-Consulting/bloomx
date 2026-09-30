/**
 * Ayudantes del composer para "Enviar sellado": cifra en el navegador, sube el sobre y construye el cuerpo del correo
 * con el enlace (el correo lleva el ENLACE, nunca el texto en claro).
 */
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH, SealedCryptoError, sealMessage } from './crypto';
import { SECURE_ID_RE } from './schema';

export interface SealOptionsUi {
    password?: string;
    /** null / undefined = sin limite de vistas */
    maxViews?: number | null;
}

export class SealedSendError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SealedSendError';
    }
}

export function validateSealOptions(options: SealOptionsUi): string | null {
    if (options.password) {
        if (options.password.length < MIN_PASSWORD_LENGTH) return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`;
        if (options.password.length > MAX_PASSWORD_LENGTH) return 'La contraseña es demasiado larga';
    }
    if (options.maxViews != null && (!Number.isInteger(options.maxViews) || options.maxViews < 1 || options.maxViews > 100)) {
        return 'Limite de vistas no valido';
    }
    return null;
}

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Comprueba que la URL devuelta por el servidor es de un mensaje sellado (no un destino arbitrario). */
export function isSealedViewUrl(url: string): boolean {
    try {
        const u = new URL(url);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
        const m = /^\/secure\/([^/]+)$/.exec(u.pathname);
        return !!m && SECURE_ID_RE.test(m[1]) && !u.search && !u.hash;
    } catch {
        return false;
    }
}

/** Cifra, sube y devuelve el enlace `/secure/<id>#k=<clave>` (la clave solo existe en este navegador y en el enlace). */
export async function createSealedLink(
    input: { subject: string; html: string },
    options: SealOptionsUi = {},
    fetchImpl: typeof fetch = fetch,
): Promise<{ url: string; expiresAt: string; hasPassword: boolean; maxViews: number | null }> {
    const invalid = validateSealOptions(options);
    if (invalid) throw new SealedSendError(invalid);

    let sealed;
    try {
        sealed = await sealMessage({ subject: input.subject, html: input.html }, { password: options.password || undefined });
    } catch (e) {
        if (e instanceof SealedCryptoError && e.code === 'PAYLOAD_TOO_LARGE') throw new SealedSendError('El mensaje es demasiado grande para enviarlo sellado');
        if (e instanceof SealedCryptoError && e.code === 'WEBCRYPTO_UNAVAILABLE') throw new SealedSendError('Este navegador no soporta cifrado (WebCrypto); usa HTTPS y un navegador actual');
        throw new SealedSendError('No se pudo cifrar el mensaje');
    }

    const maxViews = options.maxViews ?? null;
    const res = await fetchImpl('/api/secure-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Solo el sobre cifrado: la clave NO se envia al servidor.
        body: JSON.stringify({ v: 1, envelope: sealed.envelope, ...(maxViews ? { maxViews } : {}) }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.viewUrl || !isSealedViewUrl(String(data.viewUrl))) {
        throw new SealedSendError(res.status === 403 ? 'El envio sellado esta desactivado por el administrador' : (data?.error && typeof data.error === 'string' ? data.error : 'No se pudo crear el mensaje sellado'));
    }
    return {
        url: `${data.viewUrl}#${sealed.fragment}`,
        expiresAt: String(data.expiresAt || ''),
        hasPassword: !!options.password,
        maxViews,
    };
}

/** Cuerpo del correo saliente: solo el enlace y avisos (HTML escapado; `url` ya validada por isSealedViewUrl + fragmento base64url). */
export function buildSealedEmailBody(link: { url: string; hasPassword: boolean; expiresAt: string; maxViews: number | null }): { html: string; text: string } {
    const expires = link.expiresAt ? new Date(link.expiresAt) : null;
    const expiresLabel = expires && !Number.isNaN(expires.getTime()) ? expires.toLocaleDateString() : '';
    const notes = [
        link.hasPassword ? 'Necesitaras la contrasena que te comparta el remitente por otro medio / You will need the password the sender shares separately.' : '',
        link.maxViews ? `El enlace se puede abrir ${link.maxViews} vez/veces / The link can be opened ${link.maxViews} time(s).` : '',
        expiresLabel ? `Caduca el / Expires: ${expiresLabel}` : '',
    ].filter(Boolean);

    const safeUrl = escapeHtml(link.url);
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;line-height:1.5">`
        + `<p><strong>Mensaje sellado / Sealed message</strong></p>`
        + `<p>Este mensaje esta cifrado de extremo a extremo. Abrelo aqui / This message is end-to-end encrypted. Open it here:</p>`
        + `<p><a href="${safeUrl}" rel="noopener noreferrer nofollow">Abrir mensaje sellado / Open sealed message</a></p>`
        + (notes.length ? `<p style="color:#555">${notes.map(escapeHtml).join('<br>')}</p>` : '')
        + `</div>`;
    const text = `Mensaje sellado / Sealed message\n\n${link.url}\n\n${notes.join('\n')}`.trim();
    return { html, text };
}
