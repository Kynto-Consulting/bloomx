/**
 * Guardado automatico de borradores, sin dependencias de React (probable con vitest).
 *
 * Garantias:
 *  - Un solo guardado en vuelo a la vez (cola serializada): el `draftId` devuelto por el primer POST se usa
 *    en los siguientes, asi que no se crean borradores duplicados.
 *  - `flush()` guarda ya (sin esperar al debounce); se usa al cerrar la ventana del composer.
 *  - `discard()` (tras enviar/eliminar) cancela el debounce, espera al guardado en vuelo y borra el borrador
 *    resultante: un POST tardio no puede "resucitar" un borrador ya enviado o eliminado.
 *  - `flushOnUnload()` usa fetch con keepalive para no perder los ultimos segundos al cerrar la pestana.
 *  - No se guarda un composer que no ha cambiado desde su estado inicial (respuestas sin editar, etc.).
 */

export type DraftAttachmentRef = { filename: string; mimeType?: string; size?: number; key: string };

export type DraftPayload = {
    from?: string;
    to: string;
    cc: string;
    bcc: string;
    subject: string;
    body: string;
    attachments: DraftAttachmentRef[];
};

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type DraftSaverOptions = {
    fetchImpl?: typeof fetch;
    getHeaders?: () => Record<string, string>;
    debounceMs?: number;
    initialDraftId?: string;
    onStatus?: (status: SaveStatus) => void;
    onDraftId?: (id: string | undefined) => void;
};

/** Solo adjuntos ya subidos (con `key`); los inline/base64 no se pueden referenciar desde un borrador. */
export function toDraftAttachments(list: unknown): DraftAttachmentRef[] {
    if (!Array.isArray(list)) return [];
    const out: DraftAttachmentRef[] = [];
    for (const att of list) {
        const key = typeof att?.key === 'string' ? att.key : '';
        const filename = String(att?.filename || att?.name || '').trim();
        if (!key || key === 'PENDING' || !filename) continue;
        out.push({
            filename,
            mimeType: att?.mimeType ? String(att.mimeType) : undefined,
            size: Number.isFinite(Number(att?.size)) ? Number(att.size) : undefined,
            key,
        });
    }
    return out;
}

function htmlToText(html: string): string {
    return String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

export function isDraftEmpty(p: DraftPayload): boolean {
    return !p.to.trim() && !p.cc.trim() && !p.bcc.trim() && !p.subject.trim() && !htmlToText(p.body) && p.attachments.length === 0;
}

const KEEPALIVE_LIMIT = 60 * 1024;

export class DraftSaver {
    private draftId: string | undefined;
    private pending: DraftPayload | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private chain: Promise<void> = Promise.resolve();
    private discarded = false;
    private lastSavedJson: string | null = null;
    private readonly opts: Required<Pick<DraftSaverOptions, 'debounceMs'>> & DraftSaverOptions;

    constructor(options: DraftSaverOptions = {}) {
        this.opts = { debounceMs: 2000, ...options };
        this.draftId = options.initialDraftId;
    }

    private get doFetch(): typeof fetch {
        return this.opts.fetchImpl ?? ((...args) => fetch(...args));
    }

    getDraftId() { return this.draftId; }
    hasPending() { return this.pending !== null; }
    isDiscarded() { return this.discarded; }

    private setDraftId(id: string | undefined) {
        if (this.draftId === id) return;
        this.draftId = id;
        this.opts.onDraftId?.(id);
    }

    private status(s: SaveStatus) { this.opts.onStatus?.(s); }

    /** Estado inicial del composer: si el contenido no cambia respecto a esto, no se guarda. */
    setBaseline(payload: DraftPayload) {
        this.lastSavedJson = JSON.stringify(payload);
    }

    schedule(payload: DraftPayload) {
        if (this.discarded) return;
        if (JSON.stringify(payload) === this.lastSavedJson && this.pending === null) return;
        this.pending = payload;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.opts.debounceMs);
    }

    /** Guarda ahora lo pendiente y resuelve cuando termina (tambien espera al guardado en vuelo). */
    flush(): Promise<void> {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        if (this.discarded) return this.chain;
        this.chain = this.chain.then(() => this.saveOnce()).catch(() => undefined);
        return this.chain;
    }

    private async saveOnce(retried = false): Promise<void> {
        if (this.discarded || !this.pending) return;
        const payload = this.pending;
        const json = JSON.stringify(payload);
        if (json === this.lastSavedJson) { this.pending = null; return; }
        this.pending = null;

        try {
            if (isDraftEmpty(payload)) {
                // El usuario vacio todo: no dejar un borrador en blanco.
                if (this.draftId) await this.remove(this.draftId);
                this.setDraftId(undefined);
                this.lastSavedJson = json;
                this.status('idle');
                return;
            }

            this.status('saving');
            const res = await this.doFetch('/api/drafts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(this.opts.getHeaders?.() ?? {}) },
                body: JSON.stringify({ id: this.draftId, ...payload }),
            });

            if (res.status === 404 && this.draftId && !retried) {
                // Alguien borro el borrador (otra pestana/lista): recrearlo en vez de fallar para siempre.
                this.setDraftId(undefined);
                this.pending = this.pending ?? payload;
                return this.saveOnce(true);
            }
            if (!res.ok) throw new Error(`draft save failed: ${res.status}`);

            const data = await res.json().catch(() => null);
            const id = data?.draft?.id;
            if (typeof id === 'string') this.setDraftId(id);
            this.lastSavedJson = json;

            if (this.discarded) {
                // Se descarto mientras el POST estaba en vuelo: eliminar lo que acaba de crearse.
                if (this.draftId) {
                    const created = this.draftId;
                    await this.remove(created);
                    this.setDraftId(undefined);
                }
                return;
            }
            this.status('saved');
        } catch (err) {
            // Conservar el contenido para reintentar en el siguiente flush/cambio.
            this.pending = this.pending ?? payload;
            this.status('error');
            throw err;
        }
    }

    private async remove(id: string): Promise<void> {
        try {
            await this.doFetch(`/api/drafts/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: { ...(this.opts.getHeaders?.() ?? {}) },
            });
        } catch {
            // Best effort: el borrado tambien se reintenta desde la lista de borradores.
        }
    }

    /**
     * Tras enviar o eliminar: cancela lo pendiente, espera al guardado en vuelo y borra el borrador.
     * Despues de esto el saver queda inerte (schedule/flush no hacen nada).
     */
    async discard(): Promise<void> {
        this.discarded = true;
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        this.pending = null;
        try { await this.chain; } catch { /* ignorado */ }
        if (this.draftId) {
            const id = this.draftId;
            await this.remove(id);
            this.setDraftId(undefined);
        }
        this.status('idle');
    }

    /** Cierre de pestana/ventana: dispara el guardado con keepalive; no espera resultado. */
    flushOnUnload(): void {
        if (this.discarded || !this.pending) return;
        const payload = this.pending;
        if (isDraftEmpty(payload) || JSON.stringify(payload) === this.lastSavedJson) return;
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        this.pending = null;
        const body = JSON.stringify({ id: this.draftId, ...payload });
        try {
            void this.doFetch('/api/drafts', {
                method: 'POST',
                keepalive: body.length < KEEPALIVE_LIMIT,
                headers: { 'Content-Type': 'application/json', ...(this.opts.getHeaders?.() ?? {}) },
                body,
            }).catch(() => undefined);
            this.lastSavedJson = JSON.stringify(payload);
        } catch {
            /* nada mas que hacer al descargar la pagina */
        }
    }
}
