// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// --- Mocks de contexto / avisos (la logica bajo prueba es useMailActions) ---
const { toastMock, offline, invalidate } = vi.hoisted(() => {
    const toast: any = vi.fn();
    toast.error = vi.fn();
    toast.success = vi.fn();
    toast.info = vi.fn();
    toast.warning = vi.fn();
    toast.dismiss = vi.fn();
    return {
        toastMock: toast,
        offline: { online: true, addToQueue: vi.fn() },
        invalidate: vi.fn(async () => {}),
    };
});
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/contexts/CacheContext', () => ({
    useCache: () => ({ invalidate, getData: vi.fn(), setData: vi.fn(), subscribe: vi.fn() }),
}));
vi.mock('@/contexts/OfflineContext', () => ({
    useOffline: () => ({ isOnline: offline.online, addToQueue: offline.addToQueue }),
}));

import { useMailActions } from '../mail/useMailActions';
import { mailBus, type MailBusEvent } from '../mail/mail-bus';
import { ORIGIN_STORAGE_KEY, undoStack } from '@/lib/mail-actions';
import { getTranslator } from '@/lib/i18n';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const t = getTranslator('es').t;

let host: HTMLDivElement;
let root: Root;
let api: ReturnType<typeof useMailActions>;
let events: MailBusEvent[];
let unsubscribe: () => void;
let fetchMock: ReturnType<typeof vi.fn>;
let respond: (url: string, init: RequestInit) => { ok: boolean; status: number; body?: unknown };

function Harness() {
    api = useMailActions();
    return api.dialog;
}
/** Cambia el estado de conexion y vuelve a pintar (el hook lo lee al renderizar). */
function setOnline(value: boolean) {
    offline.online = value;
    act(() => { root.render(createElement(Harness)); });
}
function HarnessWith({ openDraft }: { openDraft: (d: any) => void }) {
    api = useMailActions({ openDraft });
    return api.dialog;
}

const mk = (id: string, folder = 'inbox', extra: Record<string, unknown> = {}) => ({
    id, folder, from: 'Ana <ana@x.com>', subject: `S${id}`, createdAt: '2025-01-01T00:00:00.000Z', read: false, starred: false, labels: [], ...extra,
});
const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: (init?.headers as Record<string, string> | undefined)?.Authorization }));
const ofType = <T extends MailBusEvent['type']>(type: T) => events.filter((e): e is Extract<MailBusEvent, { type: T }> => e.type === type);
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(() => {
    toastMock.mockClear(); toastMock.error.mockClear(); toastMock.success.mockClear(); toastMock.info.mockClear(); toastMock.warning.mockClear(); toastMock.dismiss.mockClear();
    offline.online = true;
    offline.addToQueue.mockClear();
    invalidate.mockClear();
    undoStack.clear();
    window.localStorage.clear();
    events = [];
    unsubscribe = mailBus.subscribe((e) => events.push(e));
    respond = () => ({ ok: true, status: 200 });
    fetchMock = vi.fn(async (url: string, init: RequestInit) => {
        const r = respond(String(url), init);
        return { ok: r.ok, status: r.status, json: async () => r.body ?? {} } as Response;
    });
    (globalThis as any).fetch = fetchMock;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => { root.render(createElement(Harness)); });
});
afterEach(() => {
    unsubscribe();
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = '';
});

describe('mover con deshacer real', () => {
    it('archivar: quita de la lista al instante, llama a la API y muestra un aviso con "Deshacer"', async () => {
        await act(async () => { await api.moveEmails([mk('1'), mk('2')], 'archive', 'inbox'); });
        expect(ofType('remove')[0].ids).toEqual(['1', '2']);
        expect(calls()).toEqual([{ url: '/api/emails/batch', method: 'PATCH', body: { ids: ['1', '2'], updates: { folder: 'archive' } } }]);
        expect(toastMock).toHaveBeenCalledTimes(1);
        const [message, opts] = toastMock.mock.calls[0];
        expect(message).toBe(t('emailList.undo.archivedMany', { n: 2 }));
        expect(opts.action.label).toBe(t('emailList.undo.action'));
        expect(opts.duration).toBeGreaterThanOrEqual(5000);
        expect(opts.duration).toBeLessThanOrEqual(8000);
        expect(invalidate).toHaveBeenCalled(); // listas y contadores se refrescan
        expect(undoStack.size).toBe(1);
    });

    it('"Deshacer" (boton del aviso) repone en la lista y llama a la API inversa', async () => {
        await act(async () => { await api.moveEmails([mk('1', 'inbox'), mk('2', 'archive')], 'trash', 'inbox'); });
        fetchMock.mockClear();
        events.length = 0;
        const opts = toastMock.mock.calls[0][1];
        await act(async () => { opts.action.onClick(); await Promise.resolve(); });
        await flush();
        const upsert = ofType('upsert')[0];
        expect(upsert.emails.map((e) => [e.id, e.folder])).toEqual([['1', 'inbox'], ['2', 'archive']]);
        const c = calls();
        expect(c).toContainEqual({ url: '/api/emails/batch', method: 'PATCH', body: { ids: ['1'], updates: { folder: 'inbox' } } });
        expect(c).toContainEqual({ url: '/api/emails/batch', method: 'PATCH', body: { ids: ['2'], updates: { folder: 'archive' } } });
        expect(toastMock.success).toHaveBeenCalledWith(t('emailList.undo.undone'));
        expect(undoStack.size).toBe(0);
        expect(ofType('focus')[0].id).toBe('1'); // el foco vuelve a la fila restaurada
    });

    it('el atajo z (undo() sin id) deshace la ultima accion; sin nada avisa', async () => {
        await act(async () => { await api.undo(); });
        expect(toastMock.info).toHaveBeenCalledWith(t('emailList.undo.nothing'));
        await act(async () => { await api.moveEmails([mk('1')], 'spam', 'inbox'); });
        fetchMock.mockClear();
        await act(async () => { await api.undo(); });
        expect(calls()).toEqual([{ url: '/api/emails/batch', method: 'PATCH', body: { ids: ['1'], updates: { folder: 'inbox' } } }]);
        expect(toastMock.dismiss).toHaveBeenCalled();
    });

    it('deshacer un correo pospuesto (carpeta fuera del lote) usa PATCH /api/emails/[id]', async () => {
        await act(async () => { await api.moveEmails([mk('7', 'snoozed')], 'archive', 'inbox'); });
        fetchMock.mockClear();
        await act(async () => { await api.undo(); });
        expect(calls()).toEqual([{ url: '/api/emails/7', method: 'PATCH', body: { folder: 'snoozed' } }]);
    });

    it('si la API falla se REVIERTE (se repone en la lista), se avisa y no queda nada por deshacer', async () => {
        respond = () => ({ ok: false, status: 500 });
        await act(async () => { await api.moveEmails([mk('1'), mk('2')], 'archive', 'inbox'); });
        const upsert = ofType('upsert')[0];
        expect(upsert.emails.map((e) => e.id)).toEqual(['1', '2']);
        expect(toastMock.error).toHaveBeenCalledWith(t('emailList.toast.serverFailed'));
        expect(undoStack.size).toBe(0);
        expect(toastMock.dismiss).toHaveBeenCalled(); // el aviso de "Deshacer" desaparece
    });

    it('un 4xx tambien revierte (mensaje de accion fallida)', async () => {
        respond = () => ({ ok: false, status: 400 });
        await act(async () => { await api.moveEmails([mk('1')], 'trash', 'inbox'); });
        expect(toastMock.error).toHaveBeenCalledWith(t('emailList.toast.actionFailed'));
        expect(ofType('upsert')).toHaveLength(1);
    });

    it('sin conexion: cambio optimista + cola offline, sin llamar a la API', async () => {
        offline.online = false;
        act(() => { root.render(createElement(Harness)); });
        await act(async () => { await api.moveEmails([mk('1')], 'archive', 'inbox'); });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(offline.addToQueue).toHaveBeenCalledWith('/api/emails/batch', 'PATCH', { ids: ['1'], updates: { folder: 'archive' } }, expect.any(String));
        expect(ofType('remove')).toHaveLength(1);
    });

    it('error de red: se conserva el cambio y se reintenta desde la cola', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('network'));
        await act(async () => { await api.moveEmails([mk('1')], 'archive', 'inbox'); });
        expect(offline.addToQueue).toHaveBeenCalled();
        expect(toastMock.warning).toHaveBeenCalledWith(t('emailList.toast.retryLater'));
        expect(ofType('upsert')).toHaveLength(0);
    });

    it('no mueve lo que ya esta en el destino ni borradores', async () => {
        expect(await api.moveEmails([mk('1', 'archive')], 'archive', 'archive')).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
        await act(async () => { await api.moveEmails([mk('1', 'drafts')], 'trash', 'drafts'); });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(toastMock.info).toHaveBeenCalledWith(t('emailList.toast.notForDrafts'));
    });

    it('desarchivar: Archivo -> Bandeja con su propio mensaje', async () => {
        await act(async () => { await api.moveEmails([mk('1', 'archive')], 'unarchive', 'archive'); });
        expect(calls()[0].body).toEqual({ ids: ['1'], updates: { folder: 'inbox' } });
        expect(toastMock.mock.calls[0][0]).toBe(t('emailList.undo.unarchivedOne'));
    });

    it('papelera NO escribe la carpeta de origen en el navegador: la registra el servidor (previousFolder)', async () => {
        await act(async () => { await api.moveEmails([mk('1', 'archive'), mk('2', 'inbox')], 'trash', 'archive'); });
        expect(window.localStorage.getItem(ORIGIN_STORAGE_KEY)).toBeNull();
        expect(window.localStorage.length).toBe(0);
        expect(calls()).toEqual([{ url: '/api/emails/batch', method: 'PATCH', body: { ids: ['1', '2'], updates: { folder: 'trash' } } }]);
    });

    it('restaurar: pide al servidor que devuelva cada correo a su carpeta de origen (un solo PATCH restore)', async () => {
        await act(async () => { await api.moveEmails([mk('1', 'trash'), mk('2', 'trash'), mk('3', 'trash')], 'restore', 'trash'); });
        expect(calls()).toEqual([{ url: '/api/emails/batch', method: 'PATCH', body: { ids: ['1', '2', '3'], updates: { restore: true }, fallbacks: {} } }]);
        expect(ofType('remove')[0].ids).toEqual(['1', '2', '3']);
        expect(toastMock.mock.calls.at(-1)![0]).toBe(t('emailList.undo.restoredMany', { n: 3 }));
    });

    it('restaurar usa el mapa LEGADO de localStorage solo como respaldo y lo consume', async () => {
        window.localStorage.setItem(ORIGIN_STORAGE_KEY, JSON.stringify({ '1': { f: 'archive', t: Date.now() }, other: { f: 'spam', t: Date.now() } }));
        await act(async () => { await api.moveEmails([mk('1', 'trash'), mk('2', 'trash')], 'restore', 'trash'); });
        expect(calls()[0].body).toEqual({ ids: ['1', '2'], updates: { restore: true }, fallbacks: { '1': 'archive' } });
        expect(JSON.parse(window.localStorage.getItem(ORIGIN_STORAGE_KEY)!)).toEqual({ other: expect.objectContaining({ f: 'spam' }) });
    });

    it('restaurar sin conexion se encola con la misma peticion y deshacer vuelve a la papelera', async () => {
        setOnline(false);
        await act(async () => { await api.moveEmails([mk('1', 'trash')], 'restore', 'trash'); });
        expect(offline.addToQueue).toHaveBeenCalledWith('/api/emails/batch', 'PATCH', { ids: ['1'], updates: { restore: true }, fallbacks: {} }, expect.any(String));
        setOnline(true);
        fetchMock.mockClear();
        await act(async () => { await api.undo(); });
        expect(calls()).toEqual([{ url: '/api/emails/batch', method: 'PATCH', body: { ids: ['1'], updates: { folder: 'trash' } } }]);
    });

    it('mover a... con destino explicito (Papelera -> Bandeja)', async () => {
        await act(async () => { await api.moveToFolder([mk('1', 'trash')], 'inbox', 'trash'); });
        expect(calls()[0].body).toEqual({ ids: ['1'], updates: { folder: 'inbox' } });
        expect(toastMock.mock.calls[0][0]).toBe(t('emailList.undo.restoredOne'));
    });

    it('lotes grandes se trocean (maximo 200 por peticion)', async () => {
        const many = Array.from({ length: 450 }, (_, i) => mk(`m${i}`));
        await act(async () => { await api.moveEmails(many, 'archive', 'inbox'); });
        expect(calls().map((c) => c.body.ids.length)).toEqual([200, 200, 50]);
    });
});

describe('eliminar definitivamente', () => {
    const confirmButton = () => Array.from(document.querySelectorAll('button')).find((b) => b.textContent === t('emailList.confirm.deleteForever'))!;
    const cancelButton = () => Array.from(document.querySelectorAll('button')).find((b) => b.textContent === t('common.cancel'))!;

    it('pide confirmacion (dialogo accesible) y si se cancela no hace nada', async () => {
        let promise!: Promise<boolean>;
        await act(async () => { promise = api.deleteForever([mk('1', 'trash')], 'trash'); await Promise.resolve(); });
        const dialog = document.querySelector('[role="dialog"]')!;
        expect(dialog).toBeTruthy();
        expect(dialog.textContent).toContain(t('emailList.confirmDeleteEmailsOne', { n: 1 }));
        await act(async () => { cancelButton().click(); });
        expect(await promise).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(ofType('remove')).toHaveLength(0);
    });

    it('al confirmar: DELETE por lotes, sin aviso de deshacer', async () => {
        let promise!: Promise<boolean>;
        await act(async () => { promise = api.deleteForever([mk('1', 'trash'), mk('2', 'trash')], 'trash'); await Promise.resolve(); });
        await act(async () => { confirmButton().click(); });
        expect(await promise).toBe(true);
        expect(calls()).toEqual([{ url: '/api/emails/batch', method: 'DELETE', body: { ids: ['1', '2'] } }]);
        expect(ofType('remove')[0].ids).toEqual(['1', '2']);
        expect(undoStack.size).toBe(0);
        expect(toastMock.success).toHaveBeenCalledWith(t('emailList.toast.deletedForeverMany', { n: 2 }));
    });

    it('borradores: usa la API de borradores', async () => {
        let promise!: Promise<boolean>;
        await act(async () => { promise = api.deleteForever([mk('d1', 'drafts')], 'drafts'); await Promise.resolve(); });
        expect(document.querySelector('[role="dialog"]')!.textContent).toContain(t('emailList.confirmDeleteDraftsOne', { n: 1 }));
        await act(async () => { confirmButton().click(); });
        await promise;
        expect(calls()).toEqual([{ url: '/api/drafts/batch', method: 'POST', body: { ids: ['d1'], action: 'delete' } }]);
    });

    it('si falla, se repone en la lista y se avisa', async () => {
        respond = () => ({ ok: false, status: 500 });
        let promise!: Promise<boolean>;
        await act(async () => { promise = api.deleteForever([mk('1', 'trash')], 'trash'); await Promise.resolve(); });
        await act(async () => { confirmButton().click(); });
        expect(await promise).toBe(false);
        expect(ofType('upsert')[0].emails.map((e) => e.id)).toEqual(['1']);
        expect(toastMock.error).toHaveBeenCalled();
    });
});

describe('leido, destacado y etiquetas', () => {
    it('marcar leido: parche optimista + PATCH; si falla revierte SOLO los campos cambiados', async () => {
        await act(async () => { await api.setFlags([mk('1', 'inbox', { read: false })], { read: true }); });
        expect(ofType('patch')[0].items).toEqual([{ id: '1', updates: { read: true } }]);
        expect(calls()[0].body).toEqual({ ids: ['1'], updates: { read: true } });

        events.length = 0;
        respond = () => ({ ok: false, status: 500 });
        await act(async () => { await api.setFlags([mk('2', 'inbox', { starred: false })], { starred: true }); });
        const patches = ofType('patch');
        expect(patches[0].items[0].updates).toEqual({ starred: true });
        expect(patches[1].items[0].updates).toEqual({ starred: false }); // reversion
        expect(toastMock.error).toHaveBeenCalled();
    });

    it('etiquetar desde un arrastre solo AGREGA: si todos ya la tienen no la quita', async () => {
        const label = { id: 'l1', name: 'Clientes', color: null };
        const tagged = mk('1', 'inbox', { labels: [label] });
        await act(async () => { await api.applyLabel([tagged], label, { onlyAdd: true }); });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(toastMock.info).toHaveBeenCalledWith(t('emailList.toast.labelAlready', { name: 'Clientes' }));
        // sin onlyAdd (menu) si alterna: la quita
        await act(async () => { await api.applyLabel([tagged], label); });
        expect(calls()[0]).toEqual({ url: '/api/emails/1', method: 'PATCH', body: { toggleLabelId: 'l1' } });
        expect(toastMock.success).toHaveBeenCalledWith(t('emailList.toast.labelRemoved', { name: 'Clientes' }));
    });

    it('etiquetar solo alterna en los que no la tienen', async () => {
        const label = { id: 'l1', name: 'Clientes', color: null };
        await act(async () => { await api.applyLabel([mk('1', 'inbox', { labels: [label] }), mk('2')], label); });
        expect(calls().map((c) => c.url)).toEqual(['/api/emails/2']);
        expect(ofType('patch')[0].items.map((i) => i.id)).toEqual(['2']);
    });

    it('sin conexion no se puede etiquetar ni posponer', async () => {
        offline.online = false;
        act(() => { root.render(createElement(Harness)); });
        await act(async () => { await api.applyLabel([mk('1')], { id: 'l', name: 'L' }); });
        await act(async () => { await api.snoozeEmails([mk('1')], new Date(Date.now() + 3_600_000), 'inbox'); });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(toastMock.error).toHaveBeenCalledTimes(2);
    });
});

describe('posponer y cancelar envio', () => {
    it('posponer: quita de la lista, POST al endpoint de snooze y aviso con Deshacer', async () => {
        const until = new Date(Date.now() + 3_600_000);
        await act(async () => { await api.snoozeEmails([mk('1')], until, 'inbox'); });
        expect(calls()).toEqual([{ url: '/api/emails/1/snooze', method: 'POST', body: { snoozeUntil: until.toISOString() } }]);
        expect(toastMock.mock.calls[0][1].action.label).toBe(t('emailList.undo.action'));
        expect(ofType('remove')[0].ids).toEqual(['1']);
        fetchMock.mockClear();
        await act(async () => { await api.undo(); });
        expect(calls()).toEqual([{ url: '/api/emails/batch', method: 'PATCH', body: { ids: ['1'], updates: { folder: 'inbox' } } }]);
    });

    it('cancelar envio programado: POST /cancel y aviso', async () => {
        await act(async () => { await api.cancelSchedule([mk('9', 'scheduled')]); });
        expect(calls()).toEqual([{ url: '/api/emails/9/cancel', method: 'POST', body: undefined }]);
        expect(toastMock.success).toHaveBeenCalledWith(t('emailList.toast.scheduleCancelled'));
    });
});


describe('programados: reprogramar, enviar ahora, editar y eliminar', () => {
    const sched = (id: string) => mk(id, 'scheduled', { scheduledAt: '2030-01-01T10:00:00.000Z' });
    const button = (label: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent === label)!;

    it('reprogramar: parche optimista, POST /schedule y aviso con Deshacer que vuelve a la hora anterior', async () => {
        const when = new Date('2030-02-01T10:00:00.000Z');
        await act(async () => { await api.reschedule([sched('9')], when); });
        expect(calls()).toEqual([{ url: '/api/emails/9/schedule', method: 'POST', body: { action: 'reschedule', scheduledAt: when.toISOString() } }]);
        expect(ofType('patch')[0].items).toEqual([{ id: '9', updates: { scheduledAt: when.toISOString() } }]);
        const [message, opts] = toastMock.mock.calls[0];
        expect(message).toContain('1');
        expect(opts.action.label).toBe(t('emailList.undo.action'));
        expect(undoStack.size).toBe(1);

        fetchMock.mockClear();
        events.length = 0;
        await act(async () => { await api.undo(); });
        expect(calls()).toEqual([{ url: '/api/emails/9/schedule', method: 'POST', body: { action: 'reschedule', scheduledAt: '2030-01-01T10:00:00.000Z' } }]);
        expect(ofType('patch')[0].items).toEqual([{ id: '9', updates: { scheduledAt: '2030-01-01T10:00:00.000Z' } }]);
        expect(toastMock.success).toHaveBeenCalledWith(t('emailList.undo.undone'));
    });

    it('reprogramar cuando ya salio: revierte la hora y muestra el error claro (sin Deshacer)', async () => {
        respond = () => ({ ok: false, status: 409, body: { code: 'ALREADY_SENT' } });
        await act(async () => { await api.reschedule([sched('9')], new Date('2030-02-01T10:00:00.000Z')); });
        expect(ofType('patch')[1].items).toEqual([{ id: '9', updates: { scheduledAt: '2030-01-01T10:00:00.000Z' } }]);
        expect(toastMock.error).toHaveBeenCalledWith(t('emailList.schedule.errors.alreadySent'));
        expect(undoStack.size).toBe(0);
    });

    it('reprogramar sin conexion: avisa y no llama a la API', async () => {
        setOnline(false);
        expect(await api.reschedule([sched('9')], new Date('2030-02-01T10:00:00.000Z'))).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(toastMock.error).toHaveBeenCalledWith(t('emailList.schedule.offline'));
    });

    it('enviar ahora: pide confirmacion, no tiene Deshacer y quita el correo de Programados', async () => {
        let promise!: Promise<boolean>;
        await act(async () => { promise = api.sendNow([sched('9')]); await Promise.resolve(); });
        expect(document.querySelector('[role="dialog"]')!.textContent).toContain(t('emailList.schedule.confirmSendNowTitleOne'));
        await act(async () => { button(t('emailList.actions.sendNow')).click(); });
        expect(await promise).toBe(true);
        expect(calls()).toEqual([{ url: '/api/emails/9/schedule', method: 'POST', body: { action: 'sendNow' } }]);
        expect(ofType('remove')[0].ids).toEqual(['9']);
        expect(undoStack.size).toBe(0);
        expect(toastMock.success).toHaveBeenCalledWith(t('emailList.schedule.sentNowOne'));
    });

    it('enviar ahora cancelado en el dialogo: no hace nada; si el servidor dice que ya no esta programado, repone y avisa', async () => {
        let promise!: Promise<boolean>;
        await act(async () => { promise = api.sendNow([sched('9')]); await Promise.resolve(); });
        await act(async () => { button(t('common.cancel')).click(); });
        expect(await promise).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();

        respond = () => ({ ok: false, status: 409, body: { code: 'NOT_SCHEDULED' } });
        await act(async () => { promise = api.sendNow([sched('9')]); await Promise.resolve(); });
        await act(async () => { button(t('emailList.actions.sendNow')).click(); });
        expect(await promise).toBe(false);
        expect(ofType('upsert')[0].emails.map((e) => e.id)).toEqual(['9']);
        expect(toastMock.error).toHaveBeenCalledWith(t('emailList.schedule.errors.notScheduled'));
    });

    it('editar (cancelar + abrir como borrador): abre el borrador que devuelve la ruta cancel', async () => {
        const openDraft = vi.fn();
        act(() => { root.render(createElement(HarnessWith, { openDraft })); });
        respond = () => ({ ok: true, status: 200, body: { success: true, draftId: 'd1', draft: { id: 'd1', to: 'x@y.com', subject: 'Hola', body: '<p>hi</p>', cc: '', bcc: '', from: 'me@x.com', attachments: [] } } });
        await act(async () => { await api.cancelSchedule([sched('9'), sched('10')], { open: true }); });
        expect(calls()[0]).toEqual({ url: '/api/emails/9/cancel', method: 'POST', body: undefined });
        expect(openDraft).toHaveBeenCalledTimes(1);
        expect(openDraft.mock.calls[0][0]).toMatchObject({ id: 'd1', to: 'x@y.com', subject: 'Hola', body: '<p>hi</p>' });
    });

    it('cancelar cuando el proveedor dice que ya salio: repone y explica', async () => {
        respond = () => ({ ok: false, status: 409, body: { code: 'ALREADY_SENT' } });
        await act(async () => { await api.cancelSchedule([sched('9')]); });
        expect(ofType('upsert')[0].emails.map((e) => e.id)).toEqual(['9']);
        expect(toastMock.error).toHaveBeenCalledWith(t('emailList.schedule.errors.alreadySent'));
    });

    it('eliminar programado: confirmacion destructiva, POST delete y aviso', async () => {
        let promise!: Promise<boolean>;
        await act(async () => { promise = api.deleteScheduled([sched('9')]); await Promise.resolve(); });
        expect(document.querySelector('[role="dialog"]')!.textContent).toContain(t('emailList.schedule.confirmDeleteTitleOne'));
        await act(async () => { button(t('emailList.actions.deleteScheduled')).click(); });
        expect(await promise).toBe(true);
        expect(calls()).toEqual([{ url: '/api/emails/9/schedule', method: 'POST', body: { action: 'delete' } }]);
        expect(toastMock.success).toHaveBeenCalledWith(t('emailList.schedule.deletedOne'));
    });
});

describe('accion por alcance (toda la carpeta) en el servidor', () => {
    const scope = { folder: 'inbox', filter: 'unread' as const };
    const button = (label: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent === label)!;
    const loaded = [mk('1'), mk('2')];

    it('confirma con el numero real, envia scope (sin ids), y permite deshacer con los ids que devolvio el servidor', async () => {
        respond = () => ({ ok: true, status: 200, body: { count: 130, ids: ['1', '2', '3'], capped: false } });
        let promise!: Promise<boolean>;
        await act(async () => { promise = api.applyToScope('archive', scope, loaded, 130); await Promise.resolve(); });
        expect(document.querySelector('[role="dialog"]')!.textContent).toContain('130');
        await act(async () => { button(t('emailList.confirm.apply')).click(); });
        expect(await promise).toBe(true);
        expect(calls()).toEqual([{ url: '/api/emails/batch', method: 'PATCH', body: { scope, updates: { folder: 'archive' } } }]);
        expect(ofType('remove')[0].ids).toEqual(['1', '2']); // solo lo cargado se quita al instante
        expect(toastMock.mock.calls[0][0]).toBe(t('emailList.undo.archivedMany', { n: 130 }));
        expect(undoStack.size).toBe(1);

        fetchMock.mockClear();
        await act(async () => { await api.undo(); });
        expect(calls()).toEqual([{ url: '/api/emails/batch', method: 'PATCH', body: { ids: ['1', '2', '3'], updates: { folder: 'inbox' } } }]);
    });

    it('marcar como leido por alcance: parche optimista y resultado; sin Deshacer', async () => {
        respond = () => ({ ok: true, status: 200, body: { count: 40, ids: [], capped: false } });
        let promise!: Promise<boolean>;
        await act(async () => { promise = api.applyToScope('markRead', scope, loaded, 40); await Promise.resolve(); });
        await act(async () => { button(t('emailList.confirm.apply')).click(); });
        await promise;
        expect(calls()[0].body).toEqual({ scope, updates: { read: true } });
        expect(ofType('patch')[0].items).toEqual([{ id: '1', updates: { read: true } }, { id: '2', updates: { read: true } }]);
        expect(toastMock.success).toHaveBeenCalledWith(t('emailList.scope.doneMany', { n: 40 }));
        expect(undoStack.size).toBe(0);
    });

    it('sin tope: 12.000 correos en una sola operacion; si el servidor falla, repone lo cargado', async () => {
        respond = () => ({ ok: true, status: 200, body: { count: 12000, ids: ['1'], capped: false } });
        let promise!: Promise<boolean>;
        await act(async () => { promise = api.applyToScope('trash', { folder: 'inbox', filter: 'all' }, loaded, 12000); await Promise.resolve(); });
        expect(document.querySelector('[role="dialog"]')!.textContent).toContain('12000');
        await act(async () => { button(t('emailList.confirm.apply')).click(); });
        await promise;
        expect(toastMock.mock.calls.at(-1)![0]).toBe(t('emailList.undo.trashedMany', { n: 12000 }));
        expect(toastMock.warning).not.toHaveBeenCalled();

        events.length = 0;
        respond = () => ({ ok: false, status: 500 });
        await act(async () => { promise = api.applyToScope('trash', { folder: 'inbox', filter: 'all' }, loaded, 10); await Promise.resolve(); });
        await act(async () => { button(t('emailList.confirm.apply')).click(); });
        expect(await promise).toBe(false);
        expect(ofType('upsert')[0].emails.map((e) => e.id)).toEqual(['1', '2']);
        expect(toastMock.error).toHaveBeenCalledWith(t('emailList.toast.serverFailed'));
    });

    it('varias cuentas: una peticion por sesion (union de buzones + token propio), cuentas sumadas y ids juntos para Deshacer', async () => {
        respond = (_url, init) => {
            const body = JSON.parse(String(init.body));
            return body.scope.mailboxes
                ? { ok: true, status: 200, body: { count: 30, ids: ['a1', 'a2'], capped: false } }
                : { ok: true, status: 200, body: { count: 12, ids: ['b1'], capped: false } };
        };
        const groups = [{ token: null, mailboxes: ['u1', 'u2'] }, { token: 'tok-otra', mailboxes: null }];
        let promise!: Promise<boolean>;
        await act(async () => { promise = api.applyToScope('archive', scope, loaded, 42, { groups }); await Promise.resolve(); });
        await act(async () => { button(t('emailList.confirm.apply')).click(); });
        expect(await promise).toBe(true);
        expect(calls()).toEqual([
            { url: '/api/emails/batch', method: 'PATCH', body: { scope: { ...scope, mailboxes: ['u1', 'u2'] }, updates: { folder: 'archive' } } },
            { url: '/api/emails/batch', method: 'PATCH', body: { scope, updates: { folder: 'archive' } }, auth: 'Bearer tok-otra' },
        ]);
        expect(toastMock.mock.calls[0][0]).toBe(t('emailList.undo.archivedMany', { n: 42 }));
        fetchMock.mockClear();
        await act(async () => { await api.undo(); });
        expect(calls()[0].body).toEqual({ ids: ['a1', 'a2', 'b1'], updates: { folder: 'inbox' } });
    });

    it('varias cuentas: si una sesion falla se repone lo cargado y se avisa', async () => {
        respond = (_url, init) => (JSON.parse(String(init.body)).scope.mailboxes ? { ok: true, status: 200, body: { count: 3, ids: ['a'] } } : { ok: false, status: 500 });
        let promise!: Promise<boolean>;
        await act(async () => { promise = api.applyToScope('markRead', scope, loaded, 5, { groups: [{ token: null, mailboxes: ['u1', 'u2'] }, { token: 'x', mailboxes: null }] }); await Promise.resolve(); });
        await act(async () => { button(t('emailList.confirm.apply')).click(); });
        expect(await promise).toBe(false);
        expect(toastMock.error).toHaveBeenCalledWith(t('emailList.toast.serverFailed'));
    });

    it('eliminar definitivamente por alcance usa DELETE con scope; mover usa el destino elegido; sin conexion no hace nada', async () => {
        respond = () => ({ ok: true, status: 200, body: { count: 3 } });
        let promise!: Promise<boolean>;
        await act(async () => { promise = api.applyToScope('deleteForever', { folder: 'trash', filter: 'all' }, loaded, 3); await Promise.resolve(); });
        await act(async () => { button(t('emailList.confirm.deleteForever')).click(); });
        await promise;
        expect(calls()[0]).toEqual({ url: '/api/emails/batch', method: 'DELETE', body: { scope: { folder: 'trash', filter: 'all' } } });

        fetchMock.mockClear();
        respond = () => ({ ok: true, status: 200, body: { count: 2, ids: ['1', '2'] } });
        await act(async () => { promise = api.applyToScope('move', scope, loaded, 2, { to: 'spam' }); await Promise.resolve(); });
        await act(async () => { button(t('emailList.confirm.apply')).click(); });
        await promise;
        expect(calls()[0].body).toEqual({ scope, updates: { folder: 'spam' } });

        fetchMock.mockClear();
        setOnline(false);
        expect(await api.applyToScope('archive', scope, loaded, 5)).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(toastMock.error).toHaveBeenCalledWith(t('emailList.scope.offline'));
    });
});
