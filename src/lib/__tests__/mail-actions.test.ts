import { describe, expect, it } from 'vitest';
import { ALLOWED_EMAIL_FOLDERS } from '../batch-validation';
import {
    MAIL_FOLDERS,
    MOVE_TARGET_FOLDERS,
    SCOPE_ACTIONS,
    UndoStack,
    actionTarget,
    archiveShortcutAction,
    buildUndoEntry,
    chunk,
    deleteShortcutAction,
    folderOfEmail,
    forgetOrigins,
    getCommonActions,
    getFolderActions,
    getSurfaceActions,
    inverseCalls,
    isMailFolder,
    legacyFallbacks,
    moveMessageKeyFor,
    moveTargets,
    parseOriginMap,
    resolveSwipeAction,
    restoreTarget,
    snoozeShortcutAction,
    spamShortcutAction,
    UNDO_WINDOW_MS,
} from '../mail-actions';

describe('carpetas de sistema', () => {
    it('coinciden con la lista que valida PATCH /api/emails/batch (paridad)', () => {
        expect([...MAIL_FOLDERS].sort()).toEqual([...ALLOWED_EMAIL_FOLDERS].sort());
    });
    it('todo destino de "mover" es una carpeta valida para la API', () => {
        for (const f of MOVE_TARGET_FOLDERS) expect(ALLOWED_EMAIL_FOLDERS as readonly string[]).toContain(f);
        expect(isMailFolder('snoozed')).toBe(false);
    });
});

describe('acciones por carpeta', () => {
    it('Bandeja: archivar (no desarchivar), papelera, spam, posponer, etiquetar y mover', () => {
        const a = getFolderActions('inbox');
        expect(a).toEqual(expect.arrayContaining(['archive', 'trash', 'spam', 'snooze', 'label', 'move']));
        expect(a).not.toContain('unarchive');
        expect(a).not.toContain('restore');
    });

    it('Archivo: OFRECE "Mover a la bandeja de entrada" (desarchivar) y no "archivar"', () => {
        const a = getFolderActions('archive');
        expect(a[0]).toBe('unarchive');
        expect(a).not.toContain('archive');
        expect(actionTarget('unarchive')).toBe('inbox');
    });

    it('Papelera: restaurar y eliminar definitivamente (y mover); nada de archivar ni spam', () => {
        const a = getFolderActions('trash');
        expect(a).toEqual(expect.arrayContaining(['restore', 'deleteForever', 'move']));
        expect(a).not.toContain('archive');
        expect(a).not.toContain('spam');
        expect(a).not.toContain('trash');
    });

    it('Spam: "No es spam" (a la bandeja) y papelera', () => {
        const a = getFolderActions('spam');
        expect(a[0]).toBe('notSpam');
        expect(a).toContain('trash');
        expect(a).not.toContain('spam');
        expect(actionTarget('notSpam')).toBe('inbox');
    });

    it('Enviados: archivar / papelera / etiquetas; Borradores: solo eliminar borrador; Programados: cancelar envio', () => {
        expect(getFolderActions('sent')).toEqual(expect.arrayContaining(['archive', 'trash', 'label']));
        expect(getFolderActions('drafts')).toEqual(['deleteDraft']);
        // Programados: reprogramar, enviar ahora, editar, eliminar (cancela en el proveedor y va a la papelera) y cancelar envio
        expect(getFolderActions('scheduled').slice(0, 5)).toEqual(['reschedule', 'sendNow', 'editScheduled', 'deleteScheduled', 'cancelSchedule']);
        expect(getFolderActions('scheduled')).not.toContain('trash'); // mover a la papelera no cancelaria el envio en Resend
        expect(getSurfaceActions('scheduled', 'hover')).toEqual(['reschedule', 'sendNow', 'editScheduled', 'deleteScheduled', 'cancelSchedule']);
        expect(resolveSwipeAction('scheduled', 'right')).toBeNull(); // sin gestos en programados
        expect(resolveSwipeAction('scheduled', 'left')).toBeNull();
    });

    it('leido/destacado alternan segun el estado', () => {
        expect(getFolderActions('inbox', { allRead: false })).toContain('markRead');
        expect(getFolderActions('inbox', { allRead: true })).toContain('markUnread');
        expect(getFolderActions('inbox', { allStarred: true })).toContain('unstar');
        expect(getFolderActions('inbox', { allStarred: false })).toContain('star');
    });

    it('carpetas desconocidas (etiqueta/busqueda) se tratan como la bandeja', () => {
        expect(getFolderActions('whatever')).toEqual(getFolderActions('inbox'));
    });

    it('acciones comunes de una seleccion mixta: interseccion, nunca vacia', () => {
        expect(getCommonActions(['inbox', 'inbox'])).toEqual(getFolderActions('inbox'));
        const mixed = getCommonActions(['inbox', 'trash']);
        expect(mixed.length).toBeGreaterThan(0);
        expect(mixed).toContain('move');
        expect(getCommonActions(['archive', 'trash'])).not.toContain('archive');
    });

    it('acciones al pasar el raton: hasta 5 y las mas utiles primero', () => {
        const h = getSurfaceActions('inbox', 'hover');
        expect(h.length).toBeLessThanOrEqual(5);
        expect(h[0]).toBe('archive');
        expect(h).toContain('trash');
        expect(getSurfaceActions('archive', 'hover')[0]).toBe('unarchive');
        expect(getSurfaceActions('trash', 'hover')).toEqual(expect.arrayContaining(['restore', 'deleteForever']));
        expect(getSurfaceActions('drafts', 'hover')).toEqual(['deleteDraft']);
    });
});

describe('mover: destinos, menu y restaurar', () => {
    it('el menu "Mover a..." lista todas las carpetas de destino salvo la actual', () => {
        expect(moveTargets('inbox')).toEqual(['archive', 'spam', 'trash']);
        expect(moveTargets('archive')).toEqual(['inbox', 'spam', 'trash']);
        expect(moveTargets('trash')).toContain('inbox');
        expect(moveTargets('trash')).not.toContain('trash');
    });

    it('restaurar vuelve a la carpeta original si se conoce y si no, a la bandeja', () => {
        expect(restoreTarget('archive')).toBe('archive');
        expect(restoreTarget('sent')).toBe('sent');
        expect(restoreTarget('spam')).toBe('spam');
        expect(restoreTarget(undefined)).toBe('inbox');
        expect(restoreTarget('trash')).toBe('inbox');
        expect(restoreTarget('drafts')).toBe('inbox');
        expect(actionTarget('restore', 'archive')).toBe('archive');
        expect(actionTarget('markRead')).toBeNull();
    });

    it('mapa LEGADO de localStorage: solo lectura (respaldo de Restaurar), se descartan invalidos y caducados, y se puede olvidar', () => {
        const now = 1_000_000_000_000;
        const parsed = parseOriginMap({ ok: { f: 'archive', t: now }, old: { f: 'archive', t: now - 40 * 24 * 3600 * 1000 }, bad: { f: 'nowhere', t: now }, junk: 5 }, now);
        expect(Object.keys(parsed)).toEqual(['ok']);
        expect(parseOriginMap('nope')).toEqual({});
        expect(legacyFallbacks(parsed, ['ok', 'zzz'])).toEqual({ ok: 'archive' });
        expect(forgetOrigins(parsed, ['ok'])).toEqual({});
        expect(forgetOrigins(parsed, ['nope'])).toBe(parsed);
    });

    it('acciones de "toda la carpeta" (alcance en el servidor): mover, leido/destacado y eliminar; no etiquetar ni posponer', () => {
        for (const a of ['archive', 'trash', 'restore', 'spam', 'markRead', 'star', 'deleteForever', 'move'] as const) expect(SCOPE_ACTIONS).toContain(a);
        for (const a of ['label', 'snooze', 'reschedule', 'sendNow', 'cancelSchedule'] as const) expect(SCOPE_ACTIONS).not.toContain(a);
    });

    it('folderOfEmail cae a la carpeta de la vista (borradores no traen folder)', () => {
        expect(folderOfEmail({ folder: 'archive' }, 'inbox')).toBe('archive');
        expect(folderOfEmail({}, 'drafts')).toBe('drafts');
        expect(folderOfEmail({}, '')).toBe('inbox');
    });

    it('chunk trocea en lotes', () => {
        expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
        expect(chunk([], 3)).toEqual([]);
    });

    it('mensajes del aviso segun origen y destino', () => {
        expect(moveMessageKeyFor('inbox', 'archive')).toBe('emailList.undo.archived');
        expect(moveMessageKeyFor('archive', 'inbox')).toBe('emailList.undo.unarchived');
        expect(moveMessageKeyFor('trash', 'inbox')).toBe('emailList.undo.restored');
        expect(moveMessageKeyFor('spam', 'inbox')).toBe('emailList.undo.notSpam');
        expect(moveMessageKeyFor('inbox', 'trash')).toBe('emailList.undo.trashed');
        expect(moveMessageKeyFor('inbox', 'spam')).toBe('emailList.undo.spammed');
        expect(moveMessageKeyFor('sent', 'inbox')).toBe('emailList.undo.moved');
    });
});

describe('atajos segun la carpeta', () => {
    it('e: archivar, desarchivar en Archivo, restaurar en papelera, no es spam en spam', () => {
        expect(archiveShortcutAction('inbox')).toBe('archive');
        expect(archiveShortcutAction('sent')).toBe('archive');
        expect(archiveShortcutAction('archive')).toBe('unarchive');
        expect(archiveShortcutAction('trash')).toBe('restore');
        expect(archiveShortcutAction('spam')).toBe('notSpam');
        expect(archiveShortcutAction('drafts')).toBeNull();
        expect(archiveShortcutAction('scheduled')).toBe('editScheduled'); // en programados, "editar"
    });
    it('# / Supr: papelera; en papelera elimina definitivamente; en borradores elimina el borrador', () => {
        expect(deleteShortcutAction('inbox')).toBe('trash');
        expect(deleteShortcutAction('archive')).toBe('trash');
        expect(deleteShortcutAction('spam')).toBe('trash');
        expect(deleteShortcutAction('trash')).toBe('deleteForever');
        expect(deleteShortcutAction('drafts')).toBe('deleteDraft');
        expect(deleteShortcutAction('scheduled')).toBe('deleteScheduled');
    });
    it('b (posponer): posponer; en programados, reprogramar; en borradores nada', () => {
        expect(snoozeShortcutAction('inbox')).toBe('snooze');
        expect(snoozeShortcutAction('archive')).toBe('snooze');
        expect(snoozeShortcutAction('scheduled')).toBe('reschedule');
        expect(snoozeShortcutAction('trash')).toBeNull();
        expect(snoozeShortcutAction('drafts')).toBeNull();
    });
    it('!: spam o "no es spam"', () => {
        expect(spamShortcutAction('inbox')).toBe('spam');
        expect(spamShortcutAction('spam')).toBe('notSpam');
        expect(spamShortcutAction('trash')).toBeNull();
    });
});

describe('gestos (swipe)', () => {
    it('por defecto: derecha = accion constructiva de la carpeta, izquierda = eliminar', () => {
        expect(resolveSwipeAction('inbox', 'right')).toBe('archive');
        expect(resolveSwipeAction('inbox', 'left')).toBe('trash');
        expect(resolveSwipeAction('archive', 'right')).toBe('unarchive');
        expect(resolveSwipeAction('archive', 'left')).toBe('trash');
        expect(resolveSwipeAction('trash', 'right')).toBe('restore');
        expect(resolveSwipeAction('trash', 'left')).toBe('deleteForever');
        expect(resolveSwipeAction('spam', 'right')).toBe('notSpam');
        expect(resolveSwipeAction('drafts', 'right')).toBeNull();
        expect(resolveSwipeAction('drafts', 'left')).toBe('deleteDraft');
        expect(resolveSwipeAction('scheduled', 'left')).toBeNull();
    });
    it('las preferencias cambian el gesto (leido, destacar, nada)', () => {
        expect(resolveSwipeAction('inbox', 'right', 'read', { allRead: false })).toBe('markRead');
        expect(resolveSwipeAction('inbox', 'right', 'read', { allRead: true })).toBe('markUnread');
        expect(resolveSwipeAction('inbox', 'left', 'star', { allStarred: true })).toBe('unstar');
        expect(resolveSwipeAction('inbox', 'left', 'none')).toBeNull();
    });
});

describe('deshacer', () => {
    const emails = [
        { id: '1', folder: 'inbox' },
        { id: '2', folder: 'archive' },
        { id: '3', folder: 'inbox' },
        { id: '4', folder: 'snoozed' },
    ];

    it('la entrada recuerda la carpeta original de cada correo', () => {
        const e = buildUndoEntry({ emails, viewFolder: 'inbox', to: 'trash', messageKey: 'emailList.undo.trashed', now: 10, id: 'u1' });
        expect(e.items).toEqual([{ id: '1', folder: 'inbox' }, { id: '2', folder: 'archive' }, { id: '3', folder: 'inbox' }, { id: '4', folder: 'snoozed' }]);
        expect(e.to).toBe('trash');
    });

    it('las llamadas inversas agrupan por carpeta original; las carpetas fuera del lote van una a una', () => {
        const e = buildUndoEntry({ emails, viewFolder: 'inbox', to: 'trash', messageKey: 'k' });
        const calls = inverseCalls(e);
        const inbox = calls.find((c) => c.folder === 'inbox')!;
        expect(inbox).toEqual({ folder: 'inbox', ids: ['1', '3'], batch: true });
        expect(calls.find((c) => c.folder === 'archive')).toEqual({ folder: 'archive', ids: ['2'], batch: true });
        expect(calls.find((c) => c.folder === 'snoozed')).toEqual({ folder: 'snoozed', ids: ['4'], batch: false });
    });

    it('la pila devuelve primero lo ultimo, respeta la ventana de tiempo y notifica', () => {
        const stack = new UndoStack(3, 1000);
        let notified = 0;
        stack.subscribe(() => { notified++; });
        const mk = (id: string, createdAt: number) => ({ id, messageKey: 'k', params: {}, items: [], to: 'trash', createdAt });
        stack.push(mk('a', 0));
        stack.push(mk('b', 100));
        expect(stack.peek(500)?.id).toBe('b');
        expect(stack.take(undefined, 500)?.id).toBe('b');
        expect(stack.take(undefined, 500)?.id).toBe('a');
        expect(stack.take(undefined, 500)).toBeUndefined();
        stack.push(mk('c', 0));
        expect(stack.take(undefined, 5000)).toBeUndefined(); // ventana vencida para el atajo z
        expect(stack.take('c', 5000)?.id).toBe('c'); // pero el boton del aviso (por id) siempre funciona
        expect(notified).toBeGreaterThan(3);
    });

    it('la pila acota su tamano y la ventana por defecto es de 30 s', () => {
        const stack = new UndoStack(2);
        for (let i = 0; i < 5; i++) stack.push({ id: `e${i}`, messageKey: 'k', params: {}, items: [], to: 'x', createdAt: Date.now() });
        expect(stack.size).toBe(2);
        expect(UNDO_WINDOW_MS).toBe(30_000);
    });
});
