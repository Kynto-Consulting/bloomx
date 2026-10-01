/** Hay trabajo sin guardar: composers con contenido abiertos o peticiones pendientes en la cola offline. */
export function hasUnsavedWork(
    windows: ReadonlyArray<{ to?: string; subject?: string; body?: string; attachments?: unknown[] }>,
    queueLength: number,
): boolean {
    if (queueLength > 0) return true;
    return windows.some((w) => Boolean((w.to || '').trim() || (w.subject || '').trim() || (w.body || '').replace(/<[^>]*>/g, '').trim() || (w.attachments && w.attachments.length)));
}
