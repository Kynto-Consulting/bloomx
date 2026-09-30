/**
 * Mensajes sin cuerpo (p. ej. informes DMARC / TLS-RPT: solo un adjunto .xml.gz/.zip). Puro y testeable.
 */

/** Marcador que el webhook guarda cuando el proveedor no trae cuerpo (sin texto visible, independiente del idioma). */
export const EMPTY_BODY_MARKER_HTML = '<div data-bx-empty-body="1"></div>';

/** Texto en ingles que versiones anteriores guardaban como cuerpo; los correos ya almacenados lo conservan. */
const LEGACY_PLACEHOLDER = /The email provider did not include the message body/i;

export function isLegacyEmptyPlaceholder(html: string | null | undefined): boolean {
    return LEGACY_PLACEHOLDER.test(String(html || ''));
}

const REPORT_SUBJECT = /(report domain:|dmarc aggregate report|aggregate report|tls-?rpt|smtp tls report)/i;
const REPORT_FILE = /\.(xml|gz|zip|json)(\.gz)?$/i;
const REPORT_MIME = /(zip|gzip|xml|tlsrpt)/i;

export interface AttachmentHint { filename?: string | null; mimeType?: string | null }

/** Asunto de informe automatico + al menos un adjunto comprimido/xml. */
export function looksLikeAuthReport(subject: string | null | undefined, attachments: AttachmentHint[] | null | undefined): boolean {
    if (!REPORT_SUBJECT.test(String(subject || ''))) return false;
    return (attachments || []).some((a) => REPORT_FILE.test(String(a.filename || '')) || REPORT_MIME.test(String(a.mimeType || '')));
}
