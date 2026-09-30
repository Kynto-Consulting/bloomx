/**
 * Errores tipados de extensiones: el sandbox solo transporta el MENSAJE de un Error, asi que el contrato
 * (bloomx-extensions/_shared/CONFERENCING-CONTRACT.md) codifica el tipo como prefijo: "codigo: mensaje [retryAfter=N]".
 */
import { CONFERENCING_ERROR_CODES, ConferencingError, type ConferencingErrorCode } from './types';

const PREFIX_RE = /^\s*([a-z_]{3,32}):\s*([\s\S]*)$/;
const RETRY_RE = /\s*\[retryAfter=(\d{1,5})\]\s*$/;

/** Convierte el mensaje de un error de extension en un ConferencingError (provider_error si no lleva prefijo valido). */
export function parseExtensionError(message: unknown, fallback: ConferencingErrorCode = 'provider_error'): ConferencingError {
    const text = typeof message === 'string' ? message : '';
    const m = PREFIX_RE.exec(text);
    if (m && (CONFERENCING_ERROR_CODES as readonly string[]).includes(m[1])) {
        let body = m[2].trim();
        let retryAfter: number | undefined;
        const r = RETRY_RE.exec(body);
        if (r) {
            retryAfter = Number(r[1]);
            body = body.slice(0, r.index).trim();
        }
        return new ConferencingError(m[1] as ConferencingErrorCode, safeMessage(body), { retryAfter });
    }
    return new ConferencingError(fallback, safeMessage(text) || undefined);
}

/** Mensaje apto para el navegador: una linea, acotado y sin posibles tokens largos. */
export function safeMessage(text: string): string {
    return String(text || '')
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\b[A-Za-z0-9_\-]{40,}\b/g, '[redacted]')
        .trim()
        .slice(0, 300);
}

/** Cuerpo JSON de error de la API (forma estable para el cliente). */
export function errorBody(error: ConferencingError, extra: Record<string, unknown> = {}) {
    return {
        error: {
            code: error.code,
            message: error.message,
            ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
        },
        ...extra,
    };
}
