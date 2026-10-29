import { internalSecretToSend } from '@/lib/internal-auth';

/**
 * Dispara /api/emails/[id]/process-attachments en esta misma instancia.
 *
 * Devuelve la PROMESA del fetch: quien lo llame desde `after()` debe devolverla (`after(() => triggerProcessAttachments(id))`).
 * Si el callback de after() no devuelve la promesa, Vercel congela la funcion apenas responde y el POST nunca sale: el correo
 * queda con adjuntos 'pending' para siempre. El timeout solo corta la ESPERA de la respuesta; la peticion ya llego.
 */
export function triggerProcessAttachments(emailId: string, timeoutMs = 20_000): Promise<void> {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    return fetch(`${appUrl}/api/emails/${emailId}/process-attachments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': internalSecretToSend() },
        signal: AbortSignal.timeout(timeoutMs),
    }).then(
        () => undefined,
        (err) => {
            if ((err as Error)?.name === 'TimeoutError') return;
            console.error(`[attachments] Failed to trigger process-attachments for ${emailId}:`, err);
        },
    );
}

/** true si el correo tiene adjuntos sin contenido todavia (placeholder del webhook) y nunca se completo el proceso. */
export function needsAttachmentProcessing(email: { attachmentsChecked?: boolean | null; attachments?: Array<{ key?: string | null; status?: string | null; size?: number | null }> | null }): boolean {
    if (email.attachmentsChecked) return false;
    return (email.attachments ?? []).some((a) => a.key === 'PENDING' || a.status === 'pending' || a.size === 0);
}
