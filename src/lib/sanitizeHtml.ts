import DOMPurify from 'dompurify';

/**
 * Sanitizacion de HTML no confiable (correos entrantes, markdown de extensiones,
 * mensajes seguros). Basada en DOMPurify (allowlist) en el navegador.
 *
 * - En el servidor (sin DOM) NO se intenta "limpiar" con regex: se devuelve texto
 *   escapado sin etiquetas. El HTML real solo se renderiza tras pasar por DOMPurify
 *   en el cliente (y dentro de un iframe sandbox, ver SafeIframe).
 *
 * Controles: NIST SP 800-177r1 sec. 6 / CIS v8 9.x / ISO 27002:2022 8.23, 8.26.
 */

function escapeHtml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const SAFE_URI = /^(?:(?:https?|mailto|tel|cid):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

let hooksInstalled = false;

function installHooks() {
    if (hooksInstalled) return;
    hooksInstalled = true;

    DOMPurify.addHook('afterSanitizeAttributes', (node: Element) => {
        if (node.tagName === 'A' && node.hasAttribute('href')) {
            node.setAttribute('target', '_blank');
            node.setAttribute('rel', 'noopener noreferrer nofollow');
        }
        // No permitimos que el correo controle el destino de formularios.
        if (node.hasAttribute && node.hasAttribute('formaction')) {
            node.removeAttribute('formaction');
        }
    });
}

const PURIFY_CONFIG = {
    USE_PROFILES: { html: true }, // sin SVG / MathML
    FORBID_TAGS: [
        'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
        'base', 'meta', 'link', 'form', 'input', 'button', 'textarea', 'select', 'option',
        'audio', 'video', 'source', 'track', 'portal', 'dialog',
    ],
    FORBID_ATTR: ['srcset', 'ping', 'formaction', 'action', 'background'],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: SAFE_URI,
    FORCE_BODY: true, // conserva <style> inicial
};

export function sanitizeHtml(value: string): string {
    const source = String(value || '');

    if (typeof window === 'undefined' || !DOMPurify.isSupported) {
        // Sin DOM: degradar a texto plano escapado (nunca HTML "medio limpio").
        return escapeHtml(source.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ''));
    }

    installHooks();
    return DOMPurify.sanitize(source, PURIFY_CONFIG) as unknown as string;
}

export function sanitizeInlineMarkdownHtml(value: string) {
    return sanitizeHtml(escapeHtml(value || ''));
}
