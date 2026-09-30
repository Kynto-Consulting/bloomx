// Separa el texto citado (respuestas anteriores) del resto de un correo HTML para poder plegarlo tras un "...".
// Trabaja sobre HTML ya saneado; solo en el cliente (usa <template>). Devuelve null si no hay nada que plegar.

const QUOTE_SELECTORS = [
    '.gmail_quote',
    'blockquote[type="cite"]',
    '.yahoo_quoted',
    '#divRplyFwdMsg',
    '#appendonsend',
    '.protonmail_quote',
    'div.moz-cite-prefix',
    '.OutlookMessageHeader',
].join(',');

const ATTRIBUTION_RE = /(wrote|escribi[oó]|a [ée]crit|schrieb|ha scritto)\s*:\s*$|^(on|el)\s.+(wrote|escribi[oó])/i;

export interface QuotedSplit {
    /** HTML sin el bloque citado (ni su linea "El ..., X escribio:"). */
    main: string;
    /** Cantidad de bloques citados plegados. */
    blocks: number;
}

function hasVisibleContent(root: DocumentFragment | HTMLElement): boolean {
    const text = (root.textContent || '').replace(/\s+/g, '');
    return text.length > 0 || Boolean(root.querySelector('img,video,table,iframe'));
}

export function splitQuotedHtml(html: string): QuotedSplit | null {
    if (typeof document === 'undefined' || !html || html.length < 20) return null;
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const frag = tpl.content;

    const quotes = Array.from(frag.querySelectorAll<HTMLElement>(QUOTE_SELECTORS))
        // Solo bloques de primer nivel de cita: los anidados se van con su padre.
        .filter((el, _i, all) => !all.some((other) => other !== el && other.contains(el)));

    // Un <blockquote> suelto al final del mensaje tambien se considera cita.
    if (quotes.length === 0) {
        const last = Array.from(frag.children).reverse().find((c) => c.tagName !== 'STYLE' && c.tagName !== 'SCRIPT');
        if (last?.tagName === 'BLOCKQUOTE') quotes.push(last as HTMLElement);
    }
    if (quotes.length === 0) return null;

    for (const q of quotes) {
        const prev = q.previousElementSibling as HTMLElement | null;
        if (prev && (prev.classList.contains('gmail_attr') || ATTRIBUTION_RE.test((prev.textContent || '').trim()))) prev.remove();
        q.remove();
    }
    if (!hasVisibleContent(frag)) return null; // solo habia cita: se muestra completa

    const holder = document.createElement('div');
    holder.appendChild(frag.cloneNode(true));
    return { main: holder.innerHTML, blocks: quotes.length };
}
