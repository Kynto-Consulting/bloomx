/**
 * Logica pura del visor de correo (MailView): fusion de respuestas de la API con el estado local.
 * Sin dependencias de React ni del DOM para poder probarla con vitest.
 */

type AnyRecord = Record<string, any>;

/**
 * Fusiona la respuesta de PATCH /api/emails/[id] (fila de `Email` con `labels`, sin adjuntos
 * firmados ni `replyTo` resuelto) con el correo que ya teniamos en pantalla. Los campos que la
 * respuesta no trae (adjuntos con URL firmada, replyTo resuelto desde el crudo) se conservan.
 */
export function mergeEmailPatchResponse<T extends AnyRecord>(previous: T, serverEmail: AnyRecord | null | undefined): T {
    if (!serverEmail || typeof serverEmail !== 'object') return previous;
    const merged: AnyRecord = { ...previous, ...serverEmail };

    // PATCH no devuelve adjuntos; nunca pisar los ya firmados que tenemos en pantalla.
    merged.attachments = Array.isArray(previous.attachments)
        ? previous.attachments
        : (Array.isArray(serverEmail.attachments) ? serverEmail.attachments : []);
    merged.replyTo = serverEmail.replyTo || previous.replyTo || null;
    // No exponer/reintroducir campos internos que la API oculta al cliente.
    if (previous.rawMimeUrl === undefined) delete merged.rawMimeUrl;
    return merged as T;
}

/**
 * Aplica `patch` al correo `emailId` dentro de un detalle (correo principal y su entrada en el hilo).
 * Devuelve un objeto nuevo; no muta el original (importante: el original puede vivir en la cache).
 */
export function applyEmailPatch<T extends { email: AnyRecord; thread?: Array<{ email: AnyRecord }> }>(
    data: T,
    emailId: string,
    patch: AnyRecord,
    merge: (prev: AnyRecord, next: AnyRecord) => AnyRecord = (prev, next) => ({ ...prev, ...next }),
): T {
    const next: AnyRecord = { ...data };
    if (data.email?.id === emailId) next.email = merge(data.email, patch);
    if (Array.isArray(data.thread)) {
        next.thread = data.thread.map((item) =>
            item?.email?.id === emailId ? { ...item, email: merge(item.email, patch) } : item,
        );
    }
    return next as T;
}

/** Quita claves de UI ("toggleLabelId", etc.) que no forman parte del correo antes de aplicar un parche optimista. */
export function optimisticEmailPatch(updates: AnyRecord, currentLabels: Array<{ id: string }> = [], allLabels: Array<{ id: string }> = []): AnyRecord {
    const { toggleLabelId, labelIds, ...rest } = updates;
    const patch: AnyRecord = { ...rest };
    if (typeof toggleLabelId === 'string') {
        const has = currentLabels.some((l) => l.id === toggleLabelId);
        if (has) {
            patch.labels = currentLabels.filter((l) => l.id !== toggleLabelId);
        } else {
            const label = allLabels.find((l) => l.id === toggleLabelId);
            patch.labels = label ? [...currentLabels, label] : currentLabels;
        }
    } else if (Array.isArray(labelIds)) {
        patch.labels = allLabels.filter((l) => labelIds.includes(l.id));
    }
    return patch;
}

// ---------------------------------------------------------------------------
// Adjuntos: tipo (icono), tamano y previsualizacion
// ---------------------------------------------------------------------------

export type AttachmentKind = 'image' | 'pdf' | 'doc' | 'sheet' | 'slides' | 'archive' | 'audio' | 'video' | 'text' | 'calendar' | 'other';

const EXT_KIND: Record<string, AttachmentKind> = {
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', svg: 'image', avif: 'image', heic: 'image',
    pdf: 'pdf',
    doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc', pages: 'doc',
    xls: 'sheet', xlsx: 'sheet', ods: 'sheet', csv: 'sheet', numbers: 'sheet',
    ppt: 'slides', pptx: 'slides', odp: 'slides', key: 'slides',
    zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', tgz: 'archive',
    mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio',
    mp4: 'video', mov: 'video', avi: 'video', mkv: 'video', webm: 'video',
    txt: 'text', md: 'text', log: 'text', json: 'text', xml: 'text',
    ics: 'calendar',
};

/** Tipo de adjunto segun el MIME (primero) y la extension (despues). Decide el icono y si se puede previsualizar. */
export function attachmentKind(mimeType?: string | null, filename?: string | null): AttachmentKind {
    const mime = String(mimeType || '').toLowerCase();
    if (mime.startsWith('image/')) return 'image';
    if (mime === 'application/pdf') return 'pdf';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    if (mime.includes('calendar')) return 'calendar';
    if (mime.includes('spreadsheet') || mime.includes('excel') || mime === 'text/csv') return 'sheet';
    if (mime.includes('presentation') || mime.includes('powerpoint')) return 'slides';
    if (mime.includes('wordprocessing') || mime.includes('msword') || mime === 'application/rtf') return 'doc';
    if (mime.includes('zip') || mime.includes('compressed') || mime.includes('tar') || mime.includes('x-7z') || mime.includes('rar')) return 'archive';
    const ext = String(filename || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
    if (ext && EXT_KIND[ext]) return EXT_KIND[ext];
    if (mime.startsWith('text/')) return 'text';
    return 'other';
}

/** Solo imagenes (no SVG: puede llevar scripts) y PDF se previsualizan en linea; el resto se descarga. */
export function isPreviewable(kind: AttachmentKind, mimeType?: string | null, filename?: string | null): boolean {
    if (kind === 'pdf') return true;
    if (kind !== 'image') return false;
    const mime = String(mimeType || '').toLowerCase();
    return !(mime.includes('svg') || /\.svgz?$/i.test(String(filename || '')));
}

/** "1,4 MB" / "820 KB": tamano legible con separador decimal del idioma. */
export function formatBytes(bytes: number | null | undefined, locale = 'es'): string {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = n;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
    const digits = i === 0 || value >= 100 ? 0 : 1;
    try {
        return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value)} ${units[i]}`;
    } catch {
        return `${value.toFixed(digits)} ${units[i]}`;
    }
}

// ---------------------------------------------------------------------------
// Destinatarios
// ---------------------------------------------------------------------------

/** Resumen "Ana, Luis +2" para la cabecera plegada de un mensaje. */
export function summarizeRecipients(names: string[], max = 2): { shown: string[]; extra: number } {
    const clean = names.map((n) => n.trim()).filter(Boolean);
    return { shown: clean.slice(0, max), extra: Math.max(0, clean.length - max) };
}

// ---------------------------------------------------------------------------
// Hilo: mensajes a expandir al abrir
// ---------------------------------------------------------------------------

/**
 * Mensajes expandidos al abrir un hilo: el mas reciente (siempre) y cada mensaje NO leido (se resaltan).
 * `thread` llega del mas nuevo al mas viejo. Sin hilo, el propio correo.
 */
export function initialExpandedIds(thread: Array<{ id: string; read?: boolean }>, openedId?: string): Set<string> {
    const out = new Set<string>();
    if (thread.length === 0) return out;
    out.add(thread[0].id);
    for (const m of thread) if (m.read === false) out.add(m.id);
    if (openedId && thread.some((m) => m.id === openedId) && thread.length === 1) out.add(openedId);
    return out;
}
