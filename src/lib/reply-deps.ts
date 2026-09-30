/**
 * Dependencias de reply-builder para el CLIENTE: i18n de la app, locale Intl, DOMPurify y estilo de reenvio guardado.
 * Se mantiene aparte para que reply-builder siga siendo puro y probable sin DOM.
 */
import { sanitizeHtml } from '@/lib/sanitizeHtml';
import { getStoredForwardStyle, type ReplyDeps } from '@/lib/reply-builder';

export function makeReplyDeps(input: {
    t: (key: string, params?: Record<string, string | number>) => string;
    intlLocale: string;
    resolveCid?: ReplyDeps['resolveCid'];
}): ReplyDeps {
    return {
        t: input.t,
        locale: input.intlLocale,
        sanitize: sanitizeHtml,
        resolveCid: input.resolveCid,
        forwardStyle: getStoredForwardStyle(),
    };
}
