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
