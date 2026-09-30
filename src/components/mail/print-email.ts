// Imprimir un correo (o el hilo) sin imprimir toda la interfaz: se escribe un documento aparte en un iframe oculto.
// El documento lleva una CSP que bloquea scripts y recursos remotos (el HTML ya viene saneado; esto es defensa en profundidad).
import { escapeHtmlText } from '@/lib/mail-validation';

export interface PrintableMessage {
    from: string;
    to: string;
    cc?: string | null;
    date: string;
    subject: string;
    html: string;
    attachments?: string[];
}

export interface PrintLabels { from: string; to: string; cc: string; date: string; attachments: string }

/** Construye el documento HTML de impresion (sin colores fijos: se imprime con los valores por defecto del navegador). */
export function buildPrintDocument(messages: PrintableMessage[], labels: PrintLabels, title: string): string {
    const body = messages.map((m) => `
<article>
  <header>
    <h1>${escapeHtmlText(m.subject)}</h1>
    <table>
      <tr><th>${escapeHtmlText(labels.from)}</th><td>${escapeHtmlText(m.from)}</td></tr>
      <tr><th>${escapeHtmlText(labels.to)}</th><td>${escapeHtmlText(m.to)}</td></tr>
      ${m.cc ? `<tr><th>${escapeHtmlText(labels.cc)}</th><td>${escapeHtmlText(m.cc)}</td></tr>` : ''}
      <tr><th>${escapeHtmlText(labels.date)}</th><td>${escapeHtmlText(m.date)}</td></tr>
      ${m.attachments && m.attachments.length ? `<tr><th>${escapeHtmlText(labels.attachments)}</th><td>${m.attachments.map(escapeHtmlText).join(', ')}</td></tr>` : ''}
    </table>
  </header>
  <section>${m.html}</section>
</article>`).join('\n<hr>\n');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtmlText(title)}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'">
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-size:13px;line-height:1.5;margin:24px}
h1{font-size:18px;margin:0 0 8px}
table{border-collapse:collapse;margin-bottom:12px}
th{text-align:left;font-weight:600;padding:1px 12px 1px 0;vertical-align:top;white-space:nowrap;opacity:.7}
td{padding:1px 0}
hr{margin:24px 0;border:0;border-top:1px solid}
img{max-width:100%;height:auto}
blockquote{margin:.6em 0 .6em .4em;padding:.1em 0 .1em 1em;border-left:3px solid}
blockquote blockquote{opacity:.8}
section{overflow-wrap:break-word}
section table{max-width:100%}
section p{margin:0 0 .8em}
pre{white-space:pre-wrap;overflow-wrap:anywhere}
a{text-decoration:underline}
@media print{body{margin:0}blockquote,pre,img,tr{break-inside:avoid}}
</style></head><body>${body}</body></html>`;
}

/** Abre el dialogo de impresion del navegador con el documento dado. Devuelve false si no se pudo preparar el iframe. */
export function printHtmlDocument(doc: string): boolean {
    if (typeof document === 'undefined') return false;
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0;visibility:hidden';
    // allow-modals: permite print(); sin allow-scripts el contenido no ejecuta nada.
    iframe.setAttribute('sandbox', 'allow-modals allow-same-origin');
    iframe.srcdoc = doc;
    const cleanup = () => setTimeout(() => iframe.remove(), 1000);
    iframe.onload = () => {
        try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
        } finally {
            cleanup();
        }
    };
    document.body.appendChild(iframe);
    return true;
}
