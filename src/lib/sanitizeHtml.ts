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
    installSanitizeHooks(DOMPurify);
}

/** Controles de formulario / UI que no funcionan en un iframe sandbox y solo estorban dentro de un correo recibido. */
const CONTROL_TAGS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'OPTGROUP', 'DATALIST', 'OUTPUT', 'DIALOG']);
/** Contenedores de controles: se abren (se conservan sus hijos utiles) pero, si quedan vacios, se eliminan. */
const CONTROL_WRAPPERS = new Set(['FORM', 'FIELDSET']);

/**
 * Restos de overlays/formularios de extensiones del redactor (Zoom, Meet, GIF...) que quedaron serializados en el cuerpo
 * de versiones antiguas: marcadores `data-bx-*` (p.ej. data-bx-ui) o clases con prefijo `bx-`/`bloomx-`.
 * `bx-linkwarn` lo anade el propio lector DESPUES del saneado, no es un resto.
 */
const REMNANT_CLASS = /^(?:bx|bloomx)-(?:ui|ext|extension|overlay|modal|popover|zoom|meet|gif|widget|dialog)(?:-|$)/;

function isExtensionRemnant(el: Element): boolean {
    // data-bx-inline lo pone el constructor de la cita (reply-builder) en imagenes data: para que el servidor las convierta en cid.
    for (const name of el.getAttributeNames()) if (name.startsWith('data-bx-') && name !== 'data-bx-inline') return true;
    return Array.from(el.classList).some((c) => REMNANT_CLASS.test(c));
}

function hasMeaningfulContent(el: Element): boolean {
    if ((el.textContent || '').replace(/[\s\u00a0\u200b-\u200f\u2060\ufeff]/g, '').length > 0) return true;
    return Boolean(el.querySelector('img,video,audio,table,hr,picture'));
}

/** Quita el nodo y, si sus ancestros quedan sin contenido, tambien (bloques cuyo unico contenido eran los controles). */
function removeAndPrune(node: Element) {
    let parent = node.parentElement;
    node.remove();
    while (parent && parent.tagName !== 'BODY' && parent.tagName !== 'HTML' && !hasMeaningfulContent(parent)) {
        const next: HTMLElement | null = parent.parentElement;
        parent.remove();
        parent = next;
    }
}

/** true si el elemento debe eliminarse por completo (con su contenido). */
function shouldDropElement(el: Element): boolean {
    if (isExtensionRemnant(el)) return true;
    const tag = el.tagName;
    if (CONTROL_TAGS.has(tag)) {
        // Un boton dentro de un enlace es contenido del enlace (se conserva su texto); cualquier otro control se elimina.
        return !(tag === 'BUTTON' && el.closest('a[href]'));
    }
    if (tag !== 'A' && (el.getAttribute('role') === 'button' || el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true')) {
        return !el.querySelector('a[href]');
    }
    return false;
}

/**
 * Quita de un arbol DOM (fragmento/elemento) los controles sueltos y restos de overlays de extensiones, con la misma
 * regla que el saneado del lector. Lo usa el redactor para que NUNCA salgan en el cuerpo enviado (ver outgoing-html.ts).
 */
export function stripInteractiveRemnants(root: ParentNode): void {
    Array.from(root.querySelectorAll('*')).forEach((el) => {
        if (!el.parentNode) return; // ya salio con un ancestro
        if (shouldDropElement(el)) removeAndPrune(el);
    });
    root.querySelectorAll('form,fieldset').forEach((el) => {
        el.querySelectorAll('button,input,select,textarea,option,optgroup,datalist,output').forEach((c) => { if (!c.closest('a[href]')) c.remove(); });
        if (!hasMeaningfulContent(el)) removeAndPrune(el);
    });
}

/** Mismos hooks sobre cualquier instancia de DOMPurify (p.ej. isomorphic-dompurify en servidor para services.formats). */
export function installSanitizeHooks(purify: Pick<typeof DOMPurify, 'addHook'>) {
    purify.addHook('beforeSanitizeElements', (node: Node) => {
        if (node.nodeType !== 1) return;
        const el = node as Element;
        if (!el.parentNode) return;
        if (shouldDropElement(el)) { removeAndPrune(el); return; }
        if (CONTROL_WRAPPERS.has(el.tagName)) {
            el.querySelectorAll('button,input,select,textarea,option,optgroup,datalist,output').forEach((c) => { if (!c.closest('a[href]')) c.remove(); });
            if (!hasMeaningfulContent(el)) removeAndPrune(el);
        }
    });
    purify.addHook('afterSanitizeAttributes', (node: Element) => {
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

export const PURIFY_CONFIG = {
    USE_PROFILES: { html: true }, // sin SVG / MathML
    FORBID_TAGS: [
        'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
        'base', 'meta', 'link', 'form', 'fieldset', 'input', 'button', 'textarea', 'select', 'option', 'optgroup', 'datalist', 'output',
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
