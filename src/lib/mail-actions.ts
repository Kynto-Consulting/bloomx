// Acciones de correo por carpeta y deshacer. Logica pura (sin React ni DOM). La carpeta de origen para "Restaurar" la guarda el SERVIDOR (Email.previousFolder).
//
// Que botones/atajos/gestos existen en cada carpeta se decide AQUI (una sola tabla) para que el lector, la lista,
// la barra de seleccion masiva, las acciones al pasar el raton, el swipe y los atajos nunca se contradigan.

/** Carpetas de sistema que entienden PATCH /api/emails/batch (espejo de ALLOWED_EMAIL_FOLDERS; hay un test de paridad). */
export const MAIL_FOLDERS = ['inbox', 'sent', 'drafts', 'scheduled', 'archive', 'trash', 'spam'] as const;
export type MailFolder = (typeof MAIL_FOLDERS)[number];

export function isMailFolder(value: unknown): value is MailFolder {
    return typeof value === 'string' && (MAIL_FOLDERS as readonly string[]).includes(value);
}

/** Carpetas a las que el usuario puede MOVER un correo (no tiene sentido mover a enviados/borradores/programados). */
export const MOVE_TARGET_FOLDERS = ['inbox', 'archive', 'spam', 'trash'] as const;

export type MailActionId =
    | 'archive'
    | 'unarchive'
    | 'trash'
    | 'restore'
    | 'deleteForever'
    | 'deleteDraft'
    | 'spam'
    | 'notSpam'
    | 'move'
    | 'label'
    | 'markRead'
    | 'markUnread'
    | 'star'
    | 'unstar'
    | 'snooze'
    /** Programados: cancelar y volver a borrador. */
    | 'cancelSchedule'
    /** Programados: elegir otra fecha/hora (con deshacer). */
    | 'reschedule'
    /** Programados: enviar ya (sin deshacer). */
    | 'sendNow'
    /** Programados: cancelar y abrir como borrador en el redactor. */
    | 'editScheduled'
    /** Programados: cancelar y mandar a la papelera. */
    | 'deleteScheduled';

export type ActionSurface = 'reader' | 'bulk' | 'hover' | 'swipe';

/** Acciones que cambian la carpeta (las unicas que generan "Deshacer"). */
export const MOVE_ACTIONS: readonly MailActionId[] = ['archive', 'unarchive', 'trash', 'restore', 'spam', 'notSpam'];

/**
 * Acciones que admite una seleccion de "toda la carpeta" (se aplican en el servidor por alcance carpeta + filtro):
 * mover, leido/destacado y eliminar definitivamente. Etiquetar, posponer y las de programados trabajan sobre ids cargados.
 */
export const SCOPE_ACTIONS: readonly MailActionId[] = ['archive', 'unarchive', 'trash', 'restore', 'spam', 'notSpam', 'move', 'deleteForever', 'markRead', 'markUnread', 'star', 'unstar'];

/** Acciones destructivas e irreversibles: siempre piden confirmacion y no tienen "Deshacer". */
export const PERMANENT_ACTIONS: readonly MailActionId[] = ['deleteForever', 'deleteDraft'];

export interface ActionContext {
    /** Correo(s) sobre los que se actua: si todos estan leidos se ofrece "no leido" y viceversa. */
    allRead?: boolean;
    allStarred?: boolean;
}

const FOLDER_ACTIONS: Record<MailFolder, MailActionId[]> = {
    inbox: ['archive', 'trash', 'spam', 'snooze', 'markRead', 'label', 'move', 'star'],
    archive: ['unarchive', 'trash', 'spam', 'snooze', 'markRead', 'label', 'move', 'star'],
    trash: ['restore', 'deleteForever', 'move', 'markRead'],
    spam: ['notSpam', 'trash', 'deleteForever', 'move', 'markRead'],
    sent: ['archive', 'trash', 'markRead', 'label', 'move', 'star'],
    drafts: ['deleteDraft'],
    scheduled: ['reschedule', 'sendNow', 'editScheduled', 'deleteScheduled', 'cancelSchedule', 'markRead', 'star'],
};

/** Acciones propias de un estado "leido/no leido" y "destacado" se resuelven segun el contexto. */
function resolveToggles(list: MailActionId[], ctx: ActionContext): MailActionId[] {
    return list.map((a) => {
        if (a === 'markRead') return ctx.allRead ? 'markUnread' : 'markRead';
        if (a === 'star') return ctx.allStarred ? 'unstar' : 'star';
        return a;
    });
}

/** Acciones de una carpeta (todas, en orden de importancia). Carpetas desconocidas se tratan como la bandeja. */
export function getFolderActions(folder: string, ctx: ActionContext = {}): MailActionId[] {
    const base = isMailFolder(folder) ? FOLDER_ACTIONS[folder] : FOLDER_ACTIONS.inbox;
    return resolveToggles([...base], ctx);
}

/**
 * Acciones comunes a varias carpetas (seleccion de correos de carpetas distintas, p. ej. resultados de busqueda):
 * interseccion en el orden de la primera; mover y etiquetar se conservan si aplican a todas.
 */
export function getCommonActions(folders: string[], ctx: ActionContext = {}): MailActionId[] {
    const unique = Array.from(new Set(folders.length ? folders : ['inbox']));
    if (unique.length === 1) return getFolderActions(unique[0], ctx);
    const lists = unique.map((f) => getFolderActions(f, ctx));
    const common = lists[0].filter((a) => lists.every((l) => l.includes(a)));
    // Archivar/desarchivar no coinciden entre carpetas: se ofrece siempre "archivar" como accion generica (mover a Archivo).
    return common.length ? common : ['move', 'markRead'].map((a) => (a === 'markRead' && ctx.allRead ? 'markUnread' : a)) as MailActionId[];
}

const SURFACE_MAX: Record<ActionSurface, number> = { reader: 99, bulk: 99, hover: 5, swipe: 1 };

/** Acciones para una superficie. `hover` muestra como mucho 5 (las mas utiles) para no saltar de layout. */
export function getSurfaceActions(folder: string, surface: ActionSurface, ctx: ActionContext = {}): MailActionId[] {
    const all = getFolderActions(folder, ctx);
    if (surface === 'hover') {
        const order: MailActionId[] = ['archive', 'unarchive', 'restore', 'notSpam', 'reschedule', 'sendNow', 'editScheduled', 'deleteScheduled', 'cancelSchedule', 'trash', 'deleteForever', 'deleteDraft', 'markRead', 'markUnread', 'snooze', 'label'];
        return order.filter((a) => all.includes(a)).slice(0, SURFACE_MAX.hover);
    }
    return all.slice(0, SURFACE_MAX[surface]);
}

/** Carpeta destino de una accion de mover. `origin` = carpeta original recordada (solo para restaurar). */
export function actionTarget(action: MailActionId, origin?: string | null): MailFolder | null {
    switch (action) {
        case 'archive': return 'archive';
        case 'unarchive': return 'inbox';
        case 'trash': return 'trash';
        case 'spam': return 'spam';
        case 'notSpam': return 'inbox';
        case 'restore': return restoreTarget(origin);
        default: return null;
    }
}

/** A donde restaura "Restaurar": la carpeta original si es una a la que se puede volver; si no, la bandeja de entrada. */
export function restoreTarget(origin?: string | null): MailFolder {
    if (origin && (MOVE_TARGET_FOLDERS as readonly string[]).includes(origin) && origin !== 'trash') return origin as MailFolder;
    if (origin === 'sent') return 'sent';
    return 'inbox';
}

/** Destinos del menu "Mover a...": todas las carpetas de destino salvo la actual. */
export function moveTargets(currentFolder: string): MailFolder[] {
    return (MOVE_TARGET_FOLDERS as readonly MailFolder[]).filter((f) => f !== currentFolder);
}

// ---------------------------------------------------------------------------
// Atajos: que accion dispara cada tecla segun la carpeta
// ---------------------------------------------------------------------------

/** `e`: archivar, o desarchivar en Archivo; en papelera restaura; en spam "no es spam"; en programados, editar. null = no aplica. */
export function archiveShortcutAction(folder: string): MailActionId | null {
    const list = getFolderActions(folder);
    if (list.includes('editScheduled')) return 'editScheduled';
    if (list.includes('archive')) return 'archive';
    if (list.includes('unarchive')) return 'unarchive';
    if (list.includes('restore')) return 'restore';
    if (list.includes('notSpam')) return 'notSpam';
    return null;
}

/** `#` / Supr: a la papelera; en papelera o borradores, eliminar definitivamente (con confirmacion). */
export function deleteShortcutAction(folder: string): MailActionId | null {
    const list = getFolderActions(folder);
    if (folder === 'trash') return 'deleteForever';
    if (list.includes('deleteScheduled')) return 'deleteScheduled';
    if (list.includes('trash')) return 'trash';
    if (list.includes('deleteDraft')) return 'deleteDraft';
    if (list.includes('deleteForever')) return 'deleteForever';
    return null;
}

/** `b` (posponer): posponer; en programados, reprogramar. null = no aplica. */
export function snoozeShortcutAction(folder: string): MailActionId | null {
    const list = getFolderActions(folder);
    if (list.includes('snooze')) return 'snooze';
    if (list.includes('reschedule')) return 'reschedule';
    return null;
}

/** `!`: spam; en spam, "no es spam". */
export function spamShortcutAction(folder: string): MailActionId | null {
    const list = getFolderActions(folder);
    if (list.includes('spam')) return 'spam';
    if (list.includes('notSpam')) return 'notSpam';
    return null;
}

// ---------------------------------------------------------------------------
// Swipe (movil)
// ---------------------------------------------------------------------------

export type SwipePref = 'auto' | 'read' | 'star' | 'none';
export const SWIPE_PREFS: readonly SwipePref[] = ['auto', 'read', 'star', 'none'];

/**
 * Accion de un gesto. `auto`: derecha = archivar/desarchivar/restaurar/no es spam (la accion "constructiva" de la carpeta);
 * izquierda = papelera (o eliminar definitivamente en papelera/borradores). Las preferencias cambian `auto` por
 * marcar leido/no leido, destacar o nada. En programados no hay gestos.
 */
export function resolveSwipeAction(folder: string, side: 'left' | 'right', pref: SwipePref = 'auto', ctx: ActionContext = {}): MailActionId | null {
    if (pref === 'none') return null;
    if (pref === 'read') return ctx.allRead ? 'markUnread' : 'markRead';
    if (pref === 'star') return ctx.allStarred ? 'unstar' : 'star';
    if (folder === 'scheduled') return null;
    if (side === 'right') {
        if (folder === 'drafts') return null;
        return archiveShortcutAction(folder);
    }
    return deleteShortcutAction(folder);
}

// ---------------------------------------------------------------------------
// Peticiones a la API
// ---------------------------------------------------------------------------

export interface MailRef {
    id: string;
    folder?: string;
    read?: boolean;
    starred?: boolean;
    [key: string]: any;
}

/** Maximo de ids por peticion que admite la API de lotes. */
export const MAX_BATCH_LEN = 500;

/** Tamano maximo de cada PATCH por lote (la API admite hasta 500; se trocea por prudencia). */
export const BATCH_CHUNK = 200;

export function chunk<T>(list: T[], size = BATCH_CHUNK): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

/** Carpeta real de un correo: la suya, o la de la vista si no la trae (borradores). */
export function folderOfEmail(email: { [key: string]: any }, viewFolder: string): string {
    return (typeof email.folder === 'string' && email.folder) || viewFolder || 'inbox';
}

// ---------------------------------------------------------------------------
// Carpeta de origen LEGADA (solo lectura)
// ---------------------------------------------------------------------------
// Antes la carpeta original se recordaba en localStorage. Ahora la guarda el servidor (Email.previousFolder) y "Restaurar" la
// usa. El mapa antiguo solo se lee como RESPALDO (se envia como `fallbacks` al restaurar correos movidos antes del cambio) y
// se borra del navegador al restaurar; nunca se vuelve a escribir.

export interface OriginEntry { f: string; t: number }
export type OriginMap = Record<string, OriginEntry>;

export const ORIGIN_STORAGE_KEY = 'bloomx:mail:origins:v1';
export const ORIGIN_MAX_AGE_MS = 35 * 24 * 60 * 60 * 1000;

export function parseOriginMap(raw: unknown, now = Date.now()): OriginMap {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: OriginMap = {};
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
        const v = value as Partial<OriginEntry> | null;
        if (!v || typeof v.f !== 'string' || typeof v.t !== 'number') continue;
        if (!isMailFolder(v.f) || now - v.t > ORIGIN_MAX_AGE_MS) continue;
        out[id] = { f: v.f, t: v.t };
    }
    return out;
}

/** `{ id: carpeta }` del mapa legado para los ids dados (respaldo de "Restaurar"). */
export function legacyFallbacks(map: OriginMap, ids: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const id of ids) if (map[id]) out[id] = map[id].f;
    return out;
}

export function forgetOrigins(map: OriginMap, ids: string[]): OriginMap {
    if (!ids.some((id) => id in map)) return map;
    const next = { ...map };
    for (const id of ids) delete next[id];
    return next;
}

// ---------------------------------------------------------------------------
// Deshacer
// ---------------------------------------------------------------------------

export const UNDO_TOAST_MS = 7000;
/** El atajo `z` deshace la ultima accion hasta este tiempo despues (el aviso ya se habra ido). */
export const UNDO_WINDOW_MS = 30_000;

export interface UndoEntry {
    id: string;
    /** Clave i18n + parametros del mensaje (se traduce al mostrar). */
    messageKey: string;
    params: Record<string, string | number>;
    /** Estado ANTERIOR de cada correo: carpeta original (y leido/destacado por si cambian). */
    items: Array<{ id: string; folder: string }>;
    /** Carpeta a la que se movieron. */
    to: string;
    createdAt: number;
    /** Deshacer de una reprogramacion: hora anterior de cada programado (en vez de volver de carpeta). */
    reschedule?: Array<{ id: string; previousAt: string }>;
}

export function buildUndoEntry(opts: {
    emails: MailRef[];
    viewFolder: string;
    to: string;
    messageKey: string;
    params?: Record<string, string | number>;
    now?: number;
    id?: string;
}): UndoEntry {
    const now = opts.now ?? Date.now();
    return {
        id: opts.id ?? `${now}-${Math.random().toString(16).slice(2)}`,
        messageKey: opts.messageKey,
        params: opts.params ?? {},
        items: opts.emails.map((e) => ({ id: e.id, folder: folderOfEmail(e, opts.viewFolder) })),
        to: opts.to,
        createdAt: now,
    };
}

export interface InverseCall {
    /** Carpeta a la que hay que devolver este grupo. */
    folder: string;
    ids: string[];
    /** true = PATCH /api/emails/batch; false = PATCH /api/emails/[id] uno a uno (carpeta fuera de la lista del lote, p. ej. snoozed). */
    batch: boolean;
}

/** Llamadas inversas para deshacer: un grupo por carpeta original. */
export function inverseCalls(entry: UndoEntry): InverseCall[] {
    const byFolder = new Map<string, string[]>();
    for (const item of entry.items) {
        const list = byFolder.get(item.folder) ?? [];
        list.push(item.id);
        byFolder.set(item.folder, list);
    }
    return Array.from(byFolder, ([folder, ids]) => ({ folder, ids, batch: isMailFolder(folder) }));
}

type UndoListener = () => void;

/** Pila de deshacer compartida por toda la app (un unico objeto en memoria). */
export class UndoStack {
    private entries: UndoEntry[] = [];
    private listeners = new Set<UndoListener>();
    constructor(private readonly max = 20, private readonly windowMs = UNDO_WINDOW_MS) {}

    push(entry: UndoEntry) {
        this.entries.push(entry);
        if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);
        this.emit();
    }

    /** Ultima entrada aun vigente (sin sacarla). */
    peek(now = Date.now()): UndoEntry | undefined {
        for (let i = this.entries.length - 1; i >= 0; i--) {
            if (now - this.entries[i].createdAt <= this.windowMs) return this.entries[i];
            break; // las anteriores son aun mas viejas
        }
        return undefined;
    }

    /** Saca la entrada `id` (o la ultima vigente si no se indica). */
    take(id?: string, now = Date.now()): UndoEntry | undefined {
        const index = id
            ? this.entries.findIndex((e) => e.id === id)
            : this.entries.length - 1;
        if (index < 0) return undefined;
        const entry = this.entries[index];
        if (!id && now - entry.createdAt > this.windowMs) return undefined;
        this.entries.splice(index, 1);
        this.emit();
        return entry;
    }

    get size() { return this.entries.length; }
    clear() { this.entries = []; this.emit(); }
    subscribe(listener: UndoListener) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
    private emit() { this.listeners.forEach((l) => l()); }
}

export const undoStack = new UndoStack();

// ---------------------------------------------------------------------------
// Mensajes
// ---------------------------------------------------------------------------

/** Clave i18n (base de plural) del aviso tras mover correos de `from` a `to`. */
export function moveMessageKeyFor(from: string, to: string): string {
    switch (to) {
        case 'archive': return 'emailList.undo.archived';
        case 'trash': return 'emailList.undo.trashed';
        case 'spam': return 'emailList.undo.spammed';
        case 'inbox':
            if (from === 'archive') return 'emailList.undo.unarchived';
            if (from === 'spam') return 'emailList.undo.notSpam';
            if (from === 'trash') return 'emailList.undo.restored';
            return 'emailList.undo.moved';
        default: return 'emailList.undo.moved';
    }
}
