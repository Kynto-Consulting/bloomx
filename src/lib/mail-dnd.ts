// Arrastrar correos de la lista a una carpeta o etiqueta del Sidebar: formato del dato arrastrado y validacion.
// Puro (sin DOM): el dato viaja como JSON en dataTransfer y se valida al soltar (nunca se confia en su forma).
import { MAX_BATCH_LEN, MOVE_TARGET_FOLDERS, isMailFolder } from '@/lib/mail-actions';

/** Tipo MIME propio: solo las filas de la lista lo generan y solo el Sidebar lo acepta. */
export const MAIL_DND_TYPE = 'application/x-bloomx-mail';

export interface DraggedMail {
    id: string;
    folder: string;
    read?: boolean;
    starred?: boolean;
    from?: string;
    subject?: string;
    createdAt?: string;
    labels?: Array<{ id: string; name: string; color?: string | null }>;
}

export interface DragPayload { emails: DraggedMail[]; source: string }

/** Campos minimos de cada correo que viajan en el arrastre (suficientes para mover/etiquetar y deshacer). */
export function buildDragPayload(emails: Array<Record<string, any>>, sourceFolder: string): DragPayload {
    return {
        source: sourceFolder,
        emails: emails.slice(0, MAX_BATCH_LEN).map((e) => ({
            id: String(e.id),
            folder: typeof e.folder === 'string' && e.folder ? e.folder : sourceFolder,
            read: Boolean(e.read),
            starred: Boolean(e.starred),
            from: typeof e.from === 'string' ? e.from : '',
            subject: typeof e.subject === 'string' ? e.subject : '',
            createdAt: typeof e.createdAt === 'string' ? e.createdAt : new Date(0).toISOString(),
            labels: Array.isArray(e.labels)
                ? e.labels.filter((l: any) => l && typeof l.id === 'string' && typeof l.name === 'string').map((l: any) => ({ id: l.id, name: l.name, color: l.color ?? null }))
                : [],
        })),
    };
}

/** Valida el JSON recibido al soltar. null si no es un payload nuestro o es invalido/excesivo. */
export function parseDragPayload(raw: unknown): DragPayload | null {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2_000_000) return null;
    let value: any;
    try { value = JSON.parse(raw); } catch { return null; }
    if (!value || typeof value !== 'object' || !Array.isArray(value.emails)) return null;
    if (value.emails.length === 0 || value.emails.length > MAX_BATCH_LEN) return null;
    const emails: DraggedMail[] = [];
    for (const e of value.emails) {
        if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !e.id || e.id.length > 200) return null;
        emails.push({
            id: e.id,
            folder: typeof e.folder === 'string' ? e.folder : 'inbox',
            read: Boolean(e.read),
            starred: Boolean(e.starred),
            from: typeof e.from === 'string' ? e.from : '',
            subject: typeof e.subject === 'string' ? e.subject : '',
            createdAt: typeof e.createdAt === 'string' ? e.createdAt : new Date(0).toISOString(),
            labels: Array.isArray(e.labels)
                ? e.labels.filter((l: any) => l && typeof l.id === 'string' && typeof l.name === 'string')
                : [],
        });
    }
    return { emails, source: typeof value.source === 'string' ? value.source : 'inbox' };
}

/** Una carpeta admite soltar correos solo si es un destino de "mover" y no es la de origen de todos ellos. */
export function canDropOnFolder(folder: string, payload: Pick<DragPayload, 'emails'> | null): boolean {
    if (!payload || !isMailFolder(folder)) return false;
    if (!(MOVE_TARGET_FOLDERS as readonly string[]).includes(folder)) return false;
    return payload.emails.some((e) => e.folder !== folder);
}

// Durante dragover el navegador NO deja leer dataTransfer.getData (modo protegido): el arrastre en curso se recuerda
// aqui (mismo documento) para saber si un destino lo acepta antes de soltar.
let activeDrag: DragPayload | null = null;
export const dragState = {
    start(payload: DragPayload) { activeDrag = payload; },
    get(): DragPayload | null { return activeDrag; },
    end() { activeDrag = null; },
};
