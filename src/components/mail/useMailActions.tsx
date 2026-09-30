'use client';

import { useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useI18n } from '@/components/I18nProvider';
import { useCache } from '@/contexts/CacheContext';
import { useOffline } from '@/contexts/OfflineContext';
import { labelDisplayName } from '@/lib/organizer/labels';
import { pluralKey } from '@/lib/i18n/format';
import {
    EMAIL_LISTS_AND_COUNTS_PATTERN,
    applyLabelChange,
    planLabelToggles,
    type LabelRef,
    type ListEmail,
} from '@/lib/mail-list';
import {
    ORIGIN_STORAGE_KEY,
    UNDO_TOAST_MS,
    actionTarget,
    buildUndoEntry,
    chunk,
    folderOfEmail,
    forgetOrigins,
    inverseCalls,
    legacyFallbacks,
    moveMessageKeyFor,
    parseOriginMap,
    undoStack,
    type MailActionId,
    type OriginMap,
} from '@/lib/mail-actions';
import type { MailFilterKey } from '@/lib/mail-query';
import { mailBus } from './mail-bus';
import { useConfirm } from './useConfirm';

type Email = ListEmail;

/** Una peticion de un alcance: sesion por cookie (token null) o Bearer, y opcionalmente la union de buzones (`mailboxes`) que lee esa sesion. */
export interface ScopeGroup { token: string | null; mailboxes: string[] | null }

interface Snapshot { emails: Email[]; pending: Promise<boolean> | null; failed: boolean }
/** Copia en memoria de los correos de cada entrada de "Deshacer" (para reponerlos en la lista al instante). */
const snapshots = new Map<string, Snapshot>();

// La carpeta de origen para "Restaurar" la guarda el SERVIDOR (Email.previousFolder). El mapa antiguo de localStorage solo se
// LEE como respaldo (correos movidos antes de este cambio) y se va vaciando al restaurar; nunca se vuelve a escribir.
function loadLegacyOrigins(): OriginMap {
    try {
        return parseOriginMap(JSON.parse(window.localStorage.getItem(ORIGIN_STORAGE_KEY) || 'null'));
    } catch {
        return {};
    }
}

function forgetLegacyOrigins(ids: string[]) {
    try {
        const map = loadLegacyOrigins();
        const next = forgetOrigins(map, ids);
        if (next === map) return;
        if (Object.keys(next).length === 0) window.localStorage.removeItem(ORIGIN_STORAGE_KEY);
        else window.localStorage.setItem(ORIGIN_STORAGE_KEY, JSON.stringify(next));
    } catch { /* almacenamiento bloqueado */ }
}

interface SendResult { failedIds: string[]; network: boolean; serverError: boolean }

/** Clave i18n del error de una accion sobre programados segun el codigo de la API. */
export function scheduleErrorKey(code: unknown): string {
    switch (code) {
        case 'ALREADY_SENT': return 'emailList.schedule.errors.alreadySent';
        case 'NOT_SCHEDULED': return 'emailList.schedule.errors.notScheduled';
        case 'DATE_TOO_SOON': return 'emailList.schedule.errors.tooSoon';
        case 'DATE_TOO_FAR': return 'emailList.schedule.errors.tooFar';
        case 'PROVIDER_UNAVAILABLE': return 'emailList.schedule.errors.unavailable';
        case 'SEND_PENDING': return 'emailList.schedule.errors.sendPending';
        case 'SEND_IN_PROGRESS': return 'emailList.schedule.errors.sendInProgress';
        case 'SEND_FAILED_RESCHEDULED': return 'emailList.schedule.sendRescheduled';
        default: return 'emailList.toast.actionFailed';
    }
}

interface ScheduleResult { ok: boolean; code: string | null; data: any }

async function postSchedule(url: string, body?: Record<string, unknown>): Promise<ScheduleResult> {
    try {
        const res = await fetch(url, { method: 'POST', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
        const data = await res.json().catch(() => null);
        return { ok: res.ok, code: res.ok ? null : (typeof data?.code === 'string' ? data.code : 'ERROR'), data };
    } catch {
        return { ok: false, code: 'NETWORK', data: null };
    }
}

/** PATCH por lotes troceados. Devuelve los ids que NO se aplicaron (para revertirlos) y si fue un fallo de red. */
async function sendBatched(ids: string[], updates: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<SendResult> {
    const failedIds: string[] = [];
    let network = false;
    let serverError = false;
    for (const part of chunk(ids)) {
        try {
            const res = await fetch('/api/emails/batch', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: part, updates, ...extra }),
            });
            if (!res.ok) {
                failedIds.push(...part);
                if (res.status >= 500) serverError = true;
            }
        } catch {
            failedIds.push(...part);
            network = true;
        }
    }
    return { failedIds, network, serverError };
}

/**
 * Acciones de correo compartidas por la lista y el lector: mover (archivar/desarchivar/papelera/restaurar/spam) con
 * "Deshacer" real, eliminar definitivamente (con confirmacion), leido/destacado, etiquetas, posponer y cancelar envio.
 * Todas son optimistas (mailBus actualiza la lista al instante) y se revierten si la API falla.
 * Renderiza `dialog` una vez en el componente que use el hook.
 */
export interface MailActionsOptions {
    /** Abre un borrador en el redactor (editar un programado: cancelar + abrir como borrador). */
    openDraft?: (draft: { id: string; from?: string; to?: string; cc?: string; bcc?: string; subject?: string; body?: string; attachments?: unknown[] }) => void;
}

export function useMailActions(options: MailActionsOptions = {}) {
    const { t } = useI18n();
    const { invalidate } = useCache();
    const { isOnline, addToQueue } = useOffline();
    const { confirm, dialog } = useConfirm();
    const latest = useRef({ t, invalidate, isOnline, addToQueue, confirm, openDraft: options.openDraft });
    latest.current = { t, invalidate, isOnline, addToQueue, confirm, openDraft: options.openDraft };

    const refresh = useCallback(() => { void latest.current.invalidate(EMAIL_LISTS_AND_COUNTS_PATTERN); }, []);

    const folderName = (folder: string) => {
        const key = `sidebar.folders.${folder}`;
        const label = latest.current.t(key);
        return label === key ? folder : label;
    };

    // --- Deshacer -----------------------------------------------------------------------------------------------
    const undo = useCallback(async (entryId?: string): Promise<boolean> => {
        const { t: tr } = latest.current;
        const entry = undoStack.take(entryId);
        if (!entry) {
            if (!entryId) toast.info(tr('emailList.undo.nothing'));
            return false;
        }
        toast.dismiss(entry.id);

        // Deshacer una reprogramacion: vuelve a la hora anterior (la API lo rechaza si ya es demasiado tarde).
        if (entry.reschedule) {
            const failedIds: string[] = [];
            mailBus.emit({ type: 'patch', items: entry.reschedule.map((r) => ({ id: r.id, updates: { scheduledAt: r.previousAt } })) });
            for (const r of entry.reschedule) {
                const res = await postSchedule(`/api/emails/${r.id}/schedule`, { action: 'reschedule', scheduledAt: r.previousAt });
                if (!res.ok) failedIds.push(r.id);
            }
            if (failedIds.length > 0) {
                refresh();
                toast.error(tr('emailList.undo.failed'));
                return false;
            }
            toast.success(tr('emailList.undo.undone'));
            refresh();
            return true;
        }
        const snap = snapshots.get(entry.id);

        // Reponer en la lista al instante (estado optimista del deshacer).
        if (snap) {
            const prior = new Map(entry.items.map((i) => [i.id, i.folder]));
            mailBus.emit({ type: 'upsert', emails: snap.emails.map((e) => ({ ...e, folder: prior.get(e.id) ?? e.folder })) });
        }
        // Si la accion original aun esta en vuelo, esperar a que termine antes de invertirla.
        if (snap?.pending) await snap.pending;
        if (snap?.failed) return false; // ya se revirtio sola: no hay nada que deshacer

        const failed: string[] = [];
        let network = false;
        for (const call of inverseCalls(entry)) {
            if (call.batch) {
                const r = await sendBatched(call.ids, { folder: call.folder });
                failed.push(...r.failedIds);
                network = network || r.network;
            } else {
                for (const id of call.ids) {
                    try {
                        const res = await fetch(`/api/emails/${id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ folder: call.folder }),
                        });
                        if (!res.ok) failed.push(id);
                    } catch { failed.push(id); network = true; }
                }
            }
        }

        if (failed.length > 0 && network && !latest.current.isOnline) {
            // Sin red: el cambio optimista se conserva y las inversas van a la cola offline.
            for (const call of inverseCalls(entry)) {
                latest.current.addToQueue('/api/emails/batch', 'PATCH', { ids: call.ids, updates: { folder: call.folder } }, tr('emailList.queue.undo'));
            }
            return true;
        }
        if (failed.length > 0) {
            // No se pudo deshacer: se vuelve a quitar de la lista y se conserva la entrada.
            mailBus.emit({ type: 'remove', ids: failed });
            undoStack.push(entry);
            toast.error(tr('emailList.undo.failed'));
            return false;
        }
        snapshots.delete(entry.id);
        toast.success(tr('emailList.undo.undone'));
        if (entry.items[0]) mailBus.emit({ type: 'focus', id: entry.items[0].id });
        refresh();
        return true;
    }, [refresh]);

    // --- Mover --------------------------------------------------------------------------------------------------
    const runMove = useCallback(async (rawGroups: Array<{ to: string; list: Email[]; restore?: boolean }>, viewFolder: string, messageKey?: string): Promise<boolean> => {
        const { t: tr, isOnline: online, addToQueue: enqueue } = latest.current;
        if (viewFolder === 'drafts') {
            toast.info(tr('emailList.toast.notForDrafts'));
            return false;
        }
        const groups = rawGroups
            .map((g) => ({ ...g, list: g.list.filter((e) => folderOfEmail(e, viewFolder) !== g.to) }))
            .filter((g) => g.list.length > 0);
        if (groups.length === 0) return false;

        const all = groups.flatMap((g) => g.list);
        const entry = buildUndoEntry({
            emails: all,
            viewFolder,
            to: groups[0].to,
            messageKey: messageKey ?? moveMessageKeyFor(folderOfEmail(all[0], viewFolder), groups[0].to),
            params: { n: all.length, folder: folderName(groups[0].to) },
        });
        const snap: Snapshot = { emails: all.map((e) => ({ ...e })), pending: null, failed: false };
        snapshots.set(entry.id, snap);

        // 1) Optimista: fuera de la lista ahora mismo. (La carpeta de origen la registra el servidor al mover.)
        mailBus.emit({ type: 'remove', ids: all.map((e) => e.id) });
        undoStack.push(entry);

        // 2) Aviso con "Deshacer" inmediato (como hace Gmail): el deshacer espera a la peticion original si sigue en curso.
        toast(tr(pluralKey(entry.messageKey, all.length), entry.params), {
            id: entry.id,
            duration: UNDO_TOAST_MS,
            action: { label: tr('emailList.undo.action'), onClick: () => { void undo(entry.id); } },
        });

        // 3) Llamada a la API (o cola offline).
        snap.pending = (async () => {
            const failedIds: string[] = [];
            let queued = false;
            for (const g of groups) {
                const ids = g.list.map((e) => e.id);
                // Restaurar: el servidor decide la carpeta (previousFolder); las copias legadas del navegador van como respaldo.
                const updates = g.restore ? { restore: true } : { folder: g.to };
                const extra = g.restore ? { fallbacks: legacyFallbacks(loadLegacyOrigins(), ids) } : {};
                const queueLabel = g.restore ? tr('emailList.actions.restore') : tr('emailList.queue.moveTo', { folder: folderName(g.to) });
                if (!online) {
                    enqueue('/api/emails/batch', 'PATCH', { ids, updates, ...extra }, queueLabel);
                    queued = true;
                    continue;
                }
                const r = await sendBatched(ids, updates, extra);
                if (r.failedIds.length === 0) { if (g.restore) forgetLegacyOrigins(ids); continue; }
                if (r.network) {
                    // Red inestable: se conserva el cambio y se reintenta desde la cola offline.
                    enqueue('/api/emails/batch', 'PATCH', { ids: r.failedIds, updates, ...extra }, tr('emailList.queue.retry', { label: queueLabel }));
                    toast.warning(tr('emailList.toast.retryLater'));
                    queued = true;
                } else {
                    failedIds.push(...r.failedIds);
                    toast.error(r.serverError ? tr('emailList.toast.serverFailed') : tr('emailList.toast.actionFailed'));
                }
            }
            if (failedIds.length > 0) {
                // Se repone lo que el servidor NO aplico y, si fue todo, se retira del "deshacer".
                mailBus.emit({ type: 'upsert', emails: snap.emails.filter((e) => failedIds.includes(e.id)) });
                if (failedIds.length === all.length) {
                    snap.failed = true;
                    undoStack.take(entry.id);
                    toast.dismiss(entry.id);
                }
            }
            if (!queued || online) refresh();
            return failedIds.length === 0;
        })();
        return snap.pending;
    }, [refresh, undo]);

    /** Acciones con nombre (archivar, desarchivar, papelera, restaurar, spam, no es spam). */
    const moveEmails = useCallback(async (emails: Email[], action: MailActionId, viewFolder: string): Promise<boolean> => {
        if (emails.length === 0) return false;
        if (action === 'restore') {
            // Restaurar: cada correo vuelve a la carpeta de origen que guardo el servidor (o a la bandeja si no hay dato).
            return runMove([{ to: 'inbox', list: emails, restore: true }], viewFolder, 'emailList.undo.restored');
        }
        const to = actionTarget(action);
        if (!to) return false;
        return runMove([{ to, list: emails }], viewFolder);
    }, [runMove]);

    /** "Mover a...": destino explicito elegido en el menu. */
    const moveToFolder = useCallback(
        (emails: Email[], to: string, viewFolder: string) => (emails.length ? runMove([{ to, list: emails }], viewFolder) : Promise.resolve(false)),
        [runMove],
    );

    // --- Eliminar definitivamente (papelera / borradores): confirmacion, sin deshacer ----------------------------
    const deleteForever = useCallback(async (emails: Email[], viewFolder: string): Promise<boolean> => {
        const { t: tr, isOnline: online, addToQueue: enqueue } = latest.current;
        if (emails.length === 0) return false;
        const drafts = viewFolder === 'drafts';
        const n = emails.length;
        const ok = await latest.current.confirm({
            title: tr(pluralKey(drafts ? 'emailList.confirm.titleDrafts' : 'emailList.confirm.titleEmails', n), { n }),
            description: tr(pluralKey(drafts ? 'emailList.confirmDeleteDrafts' : 'emailList.confirmDeleteEmails', n), { n }),
            confirmLabel: tr('emailList.confirm.deleteForever'),
            destructive: true,
        });
        if (!ok) return false;

        const ids = emails.map((e) => e.id);
        const snapshot = emails.map((e) => ({ ...e }));
        mailBus.emit({ type: 'remove', ids });
        const label = drafts ? tr('emailList.queue.deleteDrafts') : tr('emailList.queue.deleteEmails');
        const failed: string[] = [];
        let queued = false;

        for (const part of chunk(ids)) {
            const request = drafts
                ? { url: '/api/drafts/batch', method: 'POST', body: { ids: part, action: 'delete' } }
                : { url: '/api/emails/batch', method: 'DELETE', body: { ids: part } };
            if (!online) {
                enqueue(request.url, request.method, request.body, label);
                queued = true;
                continue;
            }
            try {
                const res = await fetch(request.url, {
                    method: request.method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(request.body),
                });
                if (!res.ok) failed.push(...part);
            } catch {
                enqueue(request.url, request.method, request.body, tr('emailList.queue.retry', { label }));
                queued = true;
            }
        }

        forgetLegacyOrigins(ids.filter((id) => !failed.includes(id)));
        if (failed.length > 0) {
            mailBus.emit({ type: 'upsert', emails: snapshot.filter((e) => failed.includes(e.id)) });
            toast.error(tr('emailList.toast.actionFailed'));
        } else if (queued) {
            toast.warning(tr('emailList.toast.retryLater'));
        } else {
            toast.success(tr(pluralKey('emailList.toast.deletedForever', n), { n }));
        }
        refresh();
        return failed.length === 0;
    }, [refresh]);

    // --- Leido / destacado --------------------------------------------------------------------------------------
    const setFlags = useCallback(async (emails: Email[], updates: { read?: boolean; starred?: boolean }): Promise<boolean> => {
        const { t: tr, isOnline: online, addToQueue: enqueue } = latest.current;
        if (emails.length === 0) return false;
        const snapshot = emails.map((e) => ({ ...e }));
        mailBus.emit({ type: 'patch', items: emails.map((e) => ({ id: e.id, updates })) });
        const revert = (failed: string[]) => mailBus.emit({
            type: 'patch',
            items: snapshot.filter((e) => failed.includes(e.id)).map((e) => ({
                id: e.id,
                updates: Object.fromEntries(Object.keys(updates).map((k) => [k, e[k]])),
            })),
        });
        const ids = emails.map((e) => e.id);
        if (!online) {
            enqueue('/api/emails/batch', 'PATCH', { ids, updates }, tr('emailList.queue.update'));
            return true;
        }
        const r = await sendBatched(ids, updates);
        if (r.failedIds.length > 0) {
            if (r.network) {
                enqueue('/api/emails/batch', 'PATCH', { ids: r.failedIds, updates }, tr('emailList.queue.retry', { label: tr('emailList.queue.update') }));
                toast.warning(tr('emailList.toast.retryLater'));
            } else {
                revert(r.failedIds);
                toast.error(r.serverError ? tr('emailList.toast.serverFailed') : tr('emailList.toast.actionFailed'));
            }
        }
        refresh();
        return r.failedIds.length === 0;
    }, [refresh]);

    // --- Etiquetas ---------------------------------------------------------------------------------------------
    const applyLabel = useCallback(async (emails: Email[], label: LabelRef, opts: { onlyAdd?: boolean } = {}): Promise<boolean> => {
        const { t: tr, isOnline: online } = latest.current;
        if (emails.length === 0) return false;
        if (!online) {
            toast.error(tr('emailList.toast.labelOffline'));
            return false;
        }
        // toggleLabelId ALTERNA: se decide por correo para no quitar la etiqueta a quien ya la tiene.
        const { mode, toggleIds } = planLabelToggles(emails, emails.map((e) => e.id), label.id);
        if (toggleIds.length === 0) return false;
        if (opts.onlyAdd && mode === 'remove') {
            // Arrastrar a una etiqueta que todos ya tienen no debe quitarla.
            toast.info(tr('emailList.toast.labelAlready', { name: labelDisplayName(label.name, tr) }));
            return false;
        }
        const snapshot = emails.filter((e) => toggleIds.includes(e.id)).map((e) => ({ ...e }));
        mailBus.emit({ type: 'patch', items: applyLabelChange(snapshot, toggleIds, label, mode).map((e) => ({ id: e.id, updates: { labels: e.labels } })) });

        const failed: string[] = [];
        const CHUNK = 5;
        for (let i = 0; i < toggleIds.length; i += CHUNK) {
            const part = toggleIds.slice(i, i + CHUNK);
            const results = await Promise.allSettled(part.map((id) => fetch(`/api/emails/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toggleLabelId: label.id }),
            })));
            results.forEach((r, idx) => { if (r.status !== 'fulfilled' || !r.value.ok) failed.push(part[idx]); });
        }
        if (failed.length > 0) {
            mailBus.emit({ type: 'patch', items: snapshot.filter((e) => failed.includes(e.id)).map((e) => ({ id: e.id, updates: { labels: e.labels || [] } })) });
            toast.error(tr('emailList.toast.labelPartial', { failed: failed.length, total: toggleIds.length }));
        } else {
            toast.success(tr(mode === 'add' ? 'emailList.toast.labelApplied' : 'emailList.toast.labelRemoved', { name: labelDisplayName(label.name, tr) }));
        }
        refresh();
        return failed.length === 0;
    }, [refresh]);

    // --- Posponer ----------------------------------------------------------------------------------------------
    const snoozeEmails = useCallback(async (emails: Email[], until: Date, viewFolder: string): Promise<boolean> => {
        const { t: tr, isOnline: online } = latest.current;
        if (emails.length === 0) return false;
        if (!online) {
            toast.error(tr('emailList.toast.snoozeOffline'));
            return false;
        }
        const entry = buildUndoEntry({
            emails, viewFolder, to: 'snoozed', messageKey: 'emailList.undo.snoozed',
            params: { n: emails.length, when: new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(until) },
        });
        const snap: Snapshot = { emails: emails.map((e) => ({ ...e })), pending: null, failed: false };
        snapshots.set(entry.id, snap);
        mailBus.emit({ type: 'remove', ids: emails.map((e) => e.id) });
        undoStack.push(entry);
        toast(tr(pluralKey(entry.messageKey, emails.length), entry.params), {
            id: entry.id,
            duration: UNDO_TOAST_MS,
            action: { label: tr('emailList.undo.action'), onClick: () => { void undo(entry.id); } },
        });
        snap.pending = (async () => {
            const failed: string[] = [];
            for (const e of emails) {
                try {
                    const res = await fetch(`/api/emails/${e.id}/snooze`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ snoozeUntil: until.toISOString() }),
                    });
                    if (!res.ok) failed.push(e.id);
                } catch { failed.push(e.id); }
            }
            if (failed.length > 0) {
                mailBus.emit({ type: 'upsert', emails: snap.emails.filter((e) => failed.includes(e.id)) });
                toast.error(tr('emailList.toast.actionFailed'));
                if (failed.length === emails.length) {
                    snap.failed = true;
                    undoStack.take(entry.id);
                    toast.dismiss(entry.id);
                }
            }
            refresh();
            return failed.length === 0;
        })();
        return snap.pending;
    }, [refresh, undo]);

    // --- Programados: cancelar (vuelve a borrador), editar, reprogramar, enviar ahora, eliminar ------------------------
    /** Cancelar el envio: el correo vuelve a borradores. `open`: ademas abre el borrador en el redactor (editar). */
    const cancelSchedule = useCallback(async (emails: Email[], opts: { open?: boolean } = {}): Promise<boolean> => {
        const { t: tr } = latest.current;
        if (emails.length === 0) return false;
        mailBus.emit({ type: 'remove', ids: emails.map((e) => e.id) });
        const failed: Array<{ id: string; code: string | null }> = [];
        let draft: any = null;
        for (const e of emails) {
            const res = await postSchedule(`/api/emails/${e.id}/cancel`);
            if (!res.ok) failed.push({ id: e.id, code: res.code });
            else if (!draft && res.data?.draft) draft = res.data.draft;
        }
        if (failed.length > 0) {
            const ids = failed.map((f) => f.id);
            mailBus.emit({ type: 'upsert', emails: emails.filter((e) => ids.includes(e.id)) });
            toast.error(tr(scheduleErrorKey(failed[0].code)));
        } else if (opts.open && draft && latest.current.openDraft) {
            latest.current.openDraft({
                id: draft.id, from: draft.from || undefined, to: draft.to || '', cc: draft.cc || '', bcc: draft.bcc || '',
                subject: draft.subject || '', body: draft.body || '', attachments: draft.attachments || [],
            });
        } else {
            toast.success(tr('emailList.toast.scheduleCancelled'));
        }
        refresh();
        return failed.length === 0;
    }, [refresh]);

    /** Reprogramar: nueva fecha/hora (con Deshacer: vuelve a la hora anterior). */
    const reschedule = useCallback(async (emails: Email[], when: Date): Promise<boolean> => {
        const { t: tr, isOnline: online } = latest.current;
        if (emails.length === 0) return false;
        if (!online) {
            toast.error(tr('emailList.schedule.offline'));
            return false;
        }
        const iso = when.toISOString();
        const previous = emails
            .filter((e) => typeof e.scheduledAt === 'string' && e.scheduledAt)
            .map((e) => ({ id: e.id, previousAt: String(e.scheduledAt) }));
        const prevById = new Map(emails.map((e) => [e.id, e.scheduledAt ?? null]));
        mailBus.emit({ type: 'patch', items: emails.map((e) => ({ id: e.id, updates: { scheduledAt: iso } })) });

        const done: string[] = [];
        let failCode: string | null = null;
        for (const e of emails) {
            const res = await postSchedule(`/api/emails/${e.id}/schedule`, { action: 'reschedule', scheduledAt: iso });
            if (res.ok) done.push(e.id); else failCode = failCode ?? res.code;
        }
        const failedIds = emails.map((e) => e.id).filter((id) => !done.includes(id));
        if (failedIds.length > 0) {
            mailBus.emit({ type: 'patch', items: failedIds.map((id) => ({ id, updates: { scheduledAt: prevById.get(id) ?? null } })) });
            toast.error(tr(scheduleErrorKey(failCode)));
        }
        if (done.length > 0) {
            const entry = buildUndoEntry({
                emails: emails.filter((e) => done.includes(e.id)), viewFolder: 'scheduled', to: 'scheduled', messageKey: 'emailList.schedule.rescheduled',
                params: { n: done.length, when: new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(when) },
            });
            entry.reschedule = previous.filter((r) => done.includes(r.id));
            if (entry.reschedule.length > 0) undoStack.push(entry);
            toast(tr(pluralKey(entry.messageKey, done.length), entry.params), {
                id: entry.id,
                duration: UNDO_TOAST_MS,
                ...(entry.reschedule.length > 0 ? { action: { label: tr('emailList.undo.action'), onClick: () => { void undo(entry.id); } } } : {}),
            });
        }
        refresh();
        return failedIds.length === 0;
    }, [refresh, undo]);

    /** Enviar ahora: pide confirmacion (no se puede deshacer), adelanta el envio y mueve el correo a Enviados. */
    const sendNow = useCallback(async (emails: Email[]): Promise<boolean> => {
        const { t: tr, isOnline: online } = latest.current;
        if (emails.length === 0) return false;
        if (!online) {
            toast.error(tr('emailList.schedule.offline'));
            return false;
        }
        const n = emails.length;
        const ok = await latest.current.confirm({
            title: tr(pluralKey('emailList.schedule.confirmSendNowTitle', n), { n }),
            description: tr('emailList.schedule.confirmSendNowBody'),
            confirmLabel: tr('emailList.actions.sendNow'),
            destructive: false,
        });
        if (!ok) return false;
        mailBus.emit({ type: 'remove', ids: emails.map((e) => e.id) });
        const failed: string[] = [];
        let failCode: string | null = null;
        let deferred = false;
        for (const e of emails) {
            const res = await postSchedule(`/api/emails/${e.id}/schedule`, { action: 'sendNow' });
            if (!res.ok) { failed.push(e.id); failCode = failCode ?? res.code; }
            else if (res.data?.deferred) deferred = true;
        }
        if (failed.length > 0) {
            mailBus.emit({ type: 'upsert', emails: emails.filter((e) => failed.includes(e.id)) });
            // Rechazo del envio inmediato: se reprogramo el mismo contenido (aviso, no error generico).
            if (failCode === 'SEND_FAILED_RESCHEDULED') toast.warning(tr(scheduleErrorKey(failCode)));
            else toast.error(tr(scheduleErrorKey(failCode)));
        }
        if (failed.length < n) toast.success(tr(pluralKey('emailList.schedule.sentNow', n - failed.length), { n: n - failed.length }));
        if (deferred) toast.info(tr('emailList.schedule.sentDeferred'));
        refresh();
        return failed.length === 0;
    }, [refresh]);

    /** Eliminar un programado: cancela el envio y lo manda a la papelera (con confirmacion). */
    const deleteScheduled = useCallback(async (emails: Email[]): Promise<boolean> => {
        const { t: tr, isOnline: online } = latest.current;
        if (emails.length === 0) return false;
        if (!online) {
            toast.error(tr('emailList.schedule.offline'));
            return false;
        }
        const n = emails.length;
        const ok = await latest.current.confirm({
            title: tr(pluralKey('emailList.schedule.confirmDeleteTitle', n), { n }),
            description: tr('emailList.schedule.confirmDeleteBody'),
            confirmLabel: tr('emailList.actions.deleteScheduled'),
            destructive: true,
        });
        if (!ok) return false;
        mailBus.emit({ type: 'remove', ids: emails.map((e) => e.id) });
        const failed: string[] = [];
        let failCode: string | null = null;
        for (const e of emails) {
            const res = await postSchedule(`/api/emails/${e.id}/schedule`, { action: 'delete' });
            if (!res.ok) { failed.push(e.id); failCode = failCode ?? res.code; }
        }
        if (failed.length > 0) {
            mailBus.emit({ type: 'upsert', emails: emails.filter((e) => failed.includes(e.id)) });
            toast.error(tr(scheduleErrorKey(failCode)));
        }
        if (failed.length < n) toast.success(tr(pluralKey('emailList.schedule.deleted', n - failed.length), { n: n - failed.length }));
        refresh();
        return failed.length === 0;
    }, [refresh]);

    // --- Accion masiva por ALCANCE (carpeta + filtro) resuelta en el servidor ------------------------------------------
    /**
     * "Toda la carpeta": la accion se aplica en el servidor a los correos de `scope` (hasta el tope por operacion) sin cargar ids.
     * Pide confirmacion con el numero real, actualiza la lista al instante (lo cargado) y muestra el resultado; los movimientos
     * tienen Deshacer con los ids que devolvio el servidor.
     */
    const applyToScope = useCallback(async (
        action: MailActionId,
        scope: { folder: string; filter: MailFilterKey },
        loaded: Email[],
        total: number,
        opts: { to?: string; groups?: ScopeGroup[] } = {},
    ): Promise<boolean> => {
        const { t: tr, isOnline: online } = latest.current;
        if (!online) {
            toast.error(tr('emailList.scope.offline'));
            return false;
        }
        const permanent = action === 'deleteForever';
        const isMove = ['archive', 'unarchive', 'trash', 'restore', 'spam', 'notSpam'].includes(action) || (action === 'move' && Boolean(opts.to));
        const flags: Record<string, { read?: boolean; starred?: boolean }> = {
            markRead: { read: true }, markUnread: { read: false }, star: { starred: true }, unstar: { starred: false },
        };
        if (!isMove && !permanent && !flags[action]) return false;

        const ok = await latest.current.confirm({
            title: tr('emailList.confirm.wholeTitle'),
            description: tr('emailList.confirm.wholeBody', { action: tr(`emailList.actions.${action}`).toLowerCase(), n: total }),
            confirmLabel: tr(permanent ? 'emailList.confirm.deleteForever' : 'emailList.confirm.apply'),
            destructive: action === 'trash' || permanent || action === 'spam',
        });
        if (!ok) return false;

        const target = action === 'restore' ? null : action === 'move' ? (opts.to ?? null) : actionTarget(action);
        const snapshot = loaded.map((e) => ({ ...e }));
        const loadedIds = loaded.map((e) => e.id);
        if (isMove || permanent) mailBus.emit({ type: 'remove', ids: loadedIds });
        else mailBus.emit({ type: 'patch', items: loadedIds.map((id) => ({ id, updates: flags[action] })) });
        const revert = () => {
            if (isMove || permanent) mailBus.emit({ type: 'upsert', emails: snapshot });
            else mailBus.emit({ type: 'patch', items: snapshot.map((e) => ({ id: e.id, updates: Object.fromEntries(Object.keys(flags[action]).map((k) => [k, e[k]])) })) });
        };

        try {
            // Una peticion por sesion: las cuentas que la sesion actual puede leer viajan juntas (`mailboxes`); las de otro login,
            // con su propio token. El servidor actua sobre TODO el alcance de cada una (sin tope) y devuelve los ids para Deshacer.
            const groups: ScopeGroup[] = opts.groups && opts.groups.length > 0 ? opts.groups : [{ token: null, mailboxes: null }];
            const responses = await Promise.all(groups.map(async (g) => {
                const res = await fetch('/api/emails/batch', {
                    method: permanent ? 'DELETE' : 'PATCH',
                    headers: { 'Content-Type': 'application/json', ...(g.token ? { Authorization: `Bearer ${g.token}` } : {}) },
                    body: JSON.stringify({
                        scope: { ...scope, ...(g.mailboxes ? { mailboxes: g.mailboxes } : {}) },
                        ...(permanent ? {} : { updates: action === 'restore' ? { restore: true } : isMove ? { folder: target } : flags[action] }),
                    }),
                });
                return { res, data: await res.json().catch(() => null) };
            }));
            const failed = responses.find((r) => !r.res.ok);
            if (failed) {
                revert();
                toast.error(failed.res.status >= 500 ? tr('emailList.toast.serverFailed') : tr('emailList.toast.actionFailed'));
                if (responses.some((r) => r.res.ok)) refresh(); // alguna cuenta si se aplico: reconciliar con el servidor
                return false;
            }
            const count = responses.reduce((sum, r) => sum + Number(r.data?.count ?? 0), 0);
            const ids: string[] = responses.flatMap((r) => (Array.isArray(r.data?.ids) ? (r.data.ids as string[]) : []));
            if (isMove && count > 0 && ids.length > 0) {
                // Deshacer con los ids reales del alcance (los que no estaban cargados tambien vuelven).
                const entry = buildUndoEntry({
                    emails: ids.map((id) => ({ id, folder: scope.folder })), viewFolder: scope.folder,
                    to: target ?? 'inbox', messageKey: action === 'restore' ? 'emailList.undo.restored' : moveMessageKeyFor(scope.folder, target ?? 'inbox'),
                    params: { n: count, folder: folderName(target ?? 'inbox') },
                });
                snapshots.set(entry.id, { emails: snapshot, pending: null, failed: false });
                undoStack.push(entry);
                toast(tr(pluralKey(entry.messageKey, count), entry.params), {
                    id: entry.id,
                    duration: UNDO_TOAST_MS,
                    action: { label: tr('emailList.undo.action'), onClick: () => { void undo(entry.id); } },
                });
                if (action === 'restore') forgetLegacyOrigins(ids);
            } else {
                toast.success(tr(pluralKey('emailList.scope.done', count), { n: count }));
            }
            refresh();
            return true;
        } catch {
            revert();
            toast.error(tr('emailList.toast.actionFailed'));
            return false;
        }
    }, [refresh, undo]);

    return { moveEmails, moveToFolder, deleteForever, setFlags, applyLabel, snoozeEmails, cancelSchedule, reschedule, sendNow, deleteScheduled, applyToScope, undo, confirm, dialog };
}

