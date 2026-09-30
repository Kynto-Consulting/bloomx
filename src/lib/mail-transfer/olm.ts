/**
 * olm.ts - Outlook para Mac (.olm = ZIP) -> MIME. Puro (sin E/S: el resolvedor de adjuntos lo aporta el motor).
 *
 * IMPORTANTE (honestidad): NO se ha validado contra un .olm real de Outlook. La implementacion se basa en la estructura
 * documentada por las herramientas publicas de extraccion/ingenieria inversa de OLM y en un .olm SINTETICO de prueba.
 * Estructura asumida:
 *   - mensajes:  `<...>/com.microsoft.__Messages/<carpeta>[/<subcarpeta>...]/<nombre>.xml`  (habitualmente message_NNNNN.xml)
 *     (el prefijo puede ser `Local/`, `Accounts/<cuenta>/`...; la carpeta es lo que sigue a `com.microsoft.__Messages`)
 *   - adjuntos:  `<...>/com.microsoft.__Attachments/<id>/<fichero>`, referenciados por OPFAttachmentURL
 *   - XML por mensaje: raiz `<emails><email>` (o `<email>`), con elementos:
 *       OPFMessageCopySubject, OPFMessageCopyBody (texto), OPFMessageCopyHTMLBody, OPFMessageCopySentTime,
 *       OPFMessageCopyReceivedTime (ISO 8601, sin zona = UTC), OPFMessageGetIsRead (0/1),
 *       OPFMessageCopyMessageID / OPFMessageCopyInternetMessageID, OPFMessageCopyInReplyTo, OPFMessageCopyReferences (opcionales),
 *       OPFMessageCopyFromAddresses | OPFMessageCopySenderAddress, OPFMessageCopyToAddresses, OPFMessageCopyCCAddresses,
 *       OPFMessageCopyBCCAddresses, OPFMessageCopyReplyToAddresses: hijos `<emailAddress OPFContactEmailAddressAddress="a@b"
 *         OPFContactEmailAddressName="Nombre"/>` (tambien se aceptan los mismos nombres como elementos hijos con texto),
 *       OPFMessageCopyAttachmentList/messageAttachment con atributos OPFAttachmentName, OPFAttachmentContentType,
 *         OPFAttachmentContentID, OPFAttachmentURL (tambien como elementos hijos con texto).
 *     Bandera de "marcado": no esta bien documentada; se aceptan OPFMessageGetIsFlagged / OPFMessageIsFlagged /
 *     OPFMessageGetHasFlag / OPFMessageGetFlagged (0/1 o true/false); si ninguno existe -> null.
 *   Cualquier elemento ausente se tolera; si el XML es invalido o no hay ni asunto ni remitente ni cuerpo -> null.
 *
 * Seguridad: safe-xml (sin DOCTYPE/entidades), limites de nº/tamano de adjuntos y de cuerpo, y las URL de adjuntos se
 * normalizan con normalizeOlmAttachmentUrl() (sin `..`, sin rutas absolutas ni esquemas) ANTES de llamar al resolvedor.
 */
import { createHash } from 'node:crypto';
import { parseXml, findAll, firstChild, textOf, type XmlElement } from './safe-xml';
import { buildMime, type BuildAddress, type BuildAttachment } from './mime-build';
import { cleanHeaderValue } from './mime-parse';

export interface OlmOptions {
    maxAttachmentBytes: number;
    maxAttachments: number;
    /** Tamano maximo del XML del mensaje (32 MB por defecto). */
    maxXmlBytes?: number;
    /** Suma maxima de adjuntos (120 MB por defecto). */
    maxTotalBytes?: number;
}

export interface OlmMime {
    raw: Buffer;
    date: Date | null;
    from: string | null;
    subject: string;
    read: boolean | null;
    flagged: boolean | null;
    folder?: string[];
    warnings: string[];
}

const MSG_DIR = 'com.microsoft.__Messages';
const ATT_DIR = 'com.microsoft.__Attachments';

function segmentsOf(path: string): string[] | null {
    if (typeof path !== 'string' || path.length === 0 || path.length > 1024 || /[\u0000-\u001f]/.test(path)) return null;
    const p = path.replace(/\\/g, '/');
    if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return null;
    const segs = p.split('/').filter((s) => s !== '' && s !== '.');
    if (segs.some((s) => s === '..')) return null;
    return segs;
}

/** ¿Es el XML de un mensaje? (dentro de `com.microsoft.__Messages/`, extension .xml, sin __MACOSX ni ficheros ocultos). */
export function isOlmMessagePath(path: string): boolean {
    const segs = segmentsOf(path);
    if (!segs || segs.length < 2) return false;
    if (segs.some((s) => s === '__MACOSX' || s.startsWith('._'))) return false;
    const idx = segs.indexOf(MSG_DIR);
    if (idx < 0 || idx === segs.length - 1) return false;
    return /\.xml$/i.test(segs[segs.length - 1]);
}

/** Carpeta del mensaje: segmentos entre `com.microsoft.__Messages` y el fichero (p. ej. ['Inbox','Clientes']). */
export function olmFolderOf(path: string): string[] {
    const segs = segmentsOf(path);
    if (!segs) return [];
    const idx = segs.indexOf(MSG_DIR);
    if (idx < 0) return [];
    return segs.slice(idx + 1, segs.length - 1).map((s) => s.slice(0, 200));
}

/**
 * Normaliza OPFAttachmentURL a una ruta relativa del ZIP con `/`: decodifica %XX una vez, rechaza `..`, rutas absolutas,
 * esquemas (file:, http:), caracteres de control y rutas que no pasen por `com.microsoft.__Attachments`. null si no es segura.
 */
export function normalizeOlmAttachmentUrl(url: string): string | null {
    if (typeof url !== 'string' || url.length === 0 || url.length > 1024) return null;
    let u = url.trim();
    if (/^[a-z][a-z0-9+.-]{1,}:/i.test(u)) return null;
    try {
        if (/%[0-9a-f]{2}/i.test(u)) u = decodeURIComponent(u);
    } catch {
        return null;
    }
    const segs = segmentsOf(u);
    if (!segs || segs.length < 2) return null;
    if (!segs.includes(ATT_DIR)) return null;
    return segs.join('/');
}

// ---------------------------------------------------------------------------------------------------------------------

function el(root: XmlElement, name: string): XmlElement | null {
    return firstChild(root, name) ?? findAll(root, name, 1)[0] ?? null;
}

function txt(root: XmlElement, ...names: string[]): string {
    for (const n of names) {
        const e = el(root, n);
        if (e) {
            const t = textOf(e).trim();
            if (t) return t;
            // Algunos exportes guardan el valor como atributo
            const a = e.attrs['value'] ?? e.attrs[n];
            if (a) return a.trim();
        }
    }
    return '';
}

function boolOf(root: XmlElement, ...names: string[]): boolean | null {
    for (const n of names) {
        const e = el(root, n);
        if (!e) continue;
        const v = (textOf(e).trim() || e.attrs['value'] || '').toLowerCase();
        if (v === '1' || v === 'true' || v === 'yes') return true;
        if (v === '0' || v === 'false' || v === 'no') return false;
    }
    return null;
}

function attrOrChild(e: XmlElement, name: string): string {
    if (e.attrs[name] !== undefined) return e.attrs[name];
    const c = firstChild(e, name);
    return c ? textOf(c).trim() : '';
}

function validEmail(v: string): string | null {
    const s = v.trim().replace(/^mailto:/i, '');
    return /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(s) && s.length <= 320 ? s.toLowerCase() : null;
}

function addressesOf(root: XmlElement, ...containers: string[]): BuildAddress[] {
    const out: BuildAddress[] = [];
    for (const cn of containers) {
        const c = el(root, cn);
        if (!c) continue;
        const items = c.local === 'emailAddress' ? [c] : findAll(c, 'emailAddress', 200);
        for (const it of items) {
            const email = validEmail(attrOrChild(it, 'OPFContactEmailAddressAddress'));
            if (!email) continue;
            const name = attrOrChild(it, 'OPFContactEmailAddressName').slice(0, 200);
            out.push({ name: name.toLowerCase() === email ? '' : name, email });
        }
        if (out.length) break;
    }
    return out.slice(0, 500);
}

function olmDate(s: string): Date | null {
    if (!s) return null;
    const v = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s) ? s : /^\d{4}-\d{2}-\d{2}T/.test(s) ? s + 'Z' : s;
    const d = new Date(v);
    return Number.isFinite(d.getTime()) && d.getUTCFullYear() > 1970 && d.getUTCFullYear() < 2200 ? d : null;
}

export async function olmMessageToMime(
    xml: Buffer,
    resolveAttachment: (url: string) => Promise<Buffer | null>,
    opts: OlmOptions & { path?: string },
): Promise<OlmMime | null> {
    const warnings: string[] = [];
    try {
        const maxXml = opts.maxXmlBytes ?? 32 * 1024 * 1024;
        if (xml.length === 0 || xml.length > maxXml) return null;
        let doc: XmlElement;
        try {
            doc = parseXml(xml, { maxBytes: maxXml });
        } catch (e) {
            warnings.push(`olm_xml_invalid:${(e as { code?: string }).code ?? 'error'}`);
            return null;
        }
        const email = doc.local === 'email' ? doc : findAll(doc, 'email', 1)[0] ?? doc;

        const subject = cleanHeaderValue(txt(email, 'OPFMessageCopySubject', 'OPFMessageCopyThreadTopic'), 998);
        let text = txt(email, 'OPFMessageCopyBody');
        let html = txt(email, 'OPFMessageCopyHTMLBody');
        // textOf recorta con trim(); el cuerpo conserva sus saltos internos
        text = text.slice(0, 20 * 1024 * 1024);
        html = html.slice(0, 20 * 1024 * 1024);

        const fromList = addressesOf(email, 'OPFMessageCopyFromAddresses', 'OPFMessageCopySenderAddress');
        const from = fromList[0] ?? null;
        const to = addressesOf(email, 'OPFMessageCopyToAddresses');
        const cc = addressesOf(email, 'OPFMessageCopyCCAddresses');
        const bcc = addressesOf(email, 'OPFMessageCopyBCCAddresses');
        const replyTo = addressesOf(email, 'OPFMessageCopyReplyToAddresses')[0] ?? null;

        if (!subject && !from && !text && !html) return null;
        if (!from) warnings.push('olm_no_sender');

        const date = olmDate(txt(email, 'OPFMessageCopySentTime')) ?? olmDate(txt(email, 'OPFMessageCopyReceivedTime'));
        if (!date) warnings.push('olm_no_date');

        // Adjuntos
        const attachments: BuildAttachment[] = [];
        let total = 0;
        const maxTotal = opts.maxTotalBytes ?? 120 * 1024 * 1024;
        const list = el(email, 'OPFMessageCopyAttachmentList');
        const atts = list ? findAll(list, 'messageAttachment', opts.maxAttachments + 1000) : [];
        if (atts.length > opts.maxAttachments) warnings.push(`olm_attachments_truncated:${atts.length - opts.maxAttachments}`);
        for (const a of atts.slice(0, opts.maxAttachments)) {
            try {
                const url = attrOrChild(a, 'OPFAttachmentURL');
                const norm = normalizeOlmAttachmentUrl(url);
                if (!norm) { warnings.push('olm_attachment_url_rejected'); continue; }
                const content = await resolveAttachment(norm);
                if (!content) { warnings.push('olm_attachment_missing'); continue; }
                if (content.length > opts.maxAttachmentBytes || total + content.length > maxTotal) { warnings.push('olm_attachment_too_large'); continue; }
                total += content.length;
                const declared = attrOrChild(a, 'OPFAttachmentName');
                const name = (declared || norm.split('/').pop() || 'attachment').replace(/[\\/\u0000-\u001f]+/g, '_').slice(0, 200) || 'attachment';
                const type = attrOrChild(a, 'OPFAttachmentContentType').toLowerCase();
                const cid = attrOrChild(a, 'OPFAttachmentContentID').replace(/[<>\s]/g, '').slice(0, 255);
                const inline = !!cid && !!html && html.toLowerCase().includes(`cid:${cid.toLowerCase()}`);
                attachments.push({
                    filename: name,
                    contentType: /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type) ? type : 'application/octet-stream',
                    content,
                    contentId: cid || null,
                    inline,
                });
            } catch {
                warnings.push('olm_attachment_unreadable');
            }
        }

        const mid = txt(email, 'OPFMessageCopyInternetMessageID', 'OPFMessageCopyMessageID').match(/<?([^<>\s]+)>?/)?.[1] ?? null;
        const seed = `${subject}|${date?.getTime() ?? 0}|${from?.email ?? ''}|${to.map((x) => x.email).join(',')}`;
        const messageId = mid && mid.includes('@') ? mid : `olm-${createHash('sha1').update(mid ?? seed).digest('hex').slice(0, 24)}@bloomx.local`;
        const irt = txt(email, 'OPFMessageCopyInReplyTo').match(/<?([^<>\s]+)>?/)?.[1] ?? null;
        const refs = txt(email, 'OPFMessageCopyReferences').match(/<[^<>\s]+>/g)?.map((r) => r.slice(1, -1)) ?? [];

        const read = boolOf(email, 'OPFMessageGetIsRead');
        const flagged = boolOf(email, 'OPFMessageGetIsFlagged', 'OPFMessageIsFlagged', 'OPFMessageGetHasFlag', 'OPFMessageGetFlagged');
        const folder = opts.path ? olmFolderOf(opts.path) : undefined;

        const raw = buildMime({
            from,
            to,
            cc,
            bcc,
            replyTo,
            subject,
            date: date ?? new Date(0),
            messageId,
            inReplyTo: irt,
            references: refs,
            text: text || (html ? null : ''),
            html: html || null,
            attachments,
        });
        return { raw, date, from: from?.email ?? null, subject, read, flagged, folder: folder && folder.length ? folder : undefined, warnings };
    } catch {
        return null;
    }
}
