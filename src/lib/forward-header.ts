import { escapeHtmlText } from '@/lib/mail-validation';

/** Cabecera "Forwarded message" en HTML, con los campos escapados ("Nombre <a@b.com>" no debe perder la direccion). */
export function buildForwardHeaderHtml(f: { from: unknown; date: string; subject: unknown; to: unknown }): string {
    return `<p>---------- Forwarded message ---------<br>From: ${escapeHtmlText(f.from)}<br>Date: ${escapeHtmlText(f.date)}<br>Subject: ${escapeHtmlText(f.subject)}<br>To: ${escapeHtmlText(f.to)}</p>`;
}
