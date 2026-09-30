/** report.ts - informe CSV de una importacion/exportacion (importados, duplicados omitidos, errores con motivo). */
import { csvCell } from '@/lib/admin/csv';
import { items as itemStore } from './store';

const REASONS: Record<string, { es: string; en: string }> = {
    too_large: { es: 'El mensaje supera el tamano maximo permitido', en: 'Message exceeds the maximum allowed size' },
    parse_failed: { es: 'No se pudo interpretar el mensaje (formato danado)', en: 'The message could not be parsed (damaged)' },
    no_mailbox: { es: 'Sin buzon de destino (descartado o no asignado)', en: 'No destination mailbox (discarded or unmapped)' },
    user_not_found: { es: 'El buzon de destino no existe', en: 'The destination mailbox does not exist' },
    storage_failed: { es: 'Error al guardar el contenido', en: 'Failed to store the content' },
    filter_unmapped: { es: 'Filtro de Gmail no convertible (ver detalle)', en: 'Gmail filter could not be converted (see detail)' },
    no_items: { es: 'El archivo no contenia elementos importables', en: 'The file contained nothing importable' },
    db_failed: { es: 'Error al guardar el mensaje', en: 'Failed to save the message' },
};

export const reasonText = (code: string | null, lang: 'es' | 'en') => (code ? REASONS[code]?.[lang] ?? code : '');

const STATUS: Record<string, { es: string; en: string }> = {
    imported: { es: 'Importado', en: 'Imported' },
    duplicate: { es: 'Duplicado omitido', en: 'Duplicate skipped' },
    skipped: { es: 'Omitido', en: 'Skipped' },
    error: { es: 'Error', en: 'Error' },
    done: { es: 'Completado', en: 'Done' },
    pending: { es: 'Pendiente', en: 'Pending' },
};

const BOM = String.fromCharCode(0xfeff);

/** Genera el CSV por paginas (no carga todos los items en memoria). Devuelve un ReadableStream de bytes. */
export function reportStream(jobId: string, lang: 'es' | 'en'): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    let after = 0;
    let started = false;
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            if (!started) {
                started = true;
                const header = ['status', 'mailbox', 'folder', 'message_id', 'source', 'error_code', 'reason', 'bytes'].map(csvCell).join(',') + '\r\n';
                controller.enqueue(enc.encode(BOM + header));
            }
            const page = await itemStore.page(jobId, after, 2000);
            if (page.length === 0) { controller.close(); return; }
            let chunk = '';
            for (const r of page) {
                after = r.id;
                chunk += [STATUS[r.status]?.[lang] ?? r.status, r.mailbox, r.folder ?? '', r.messageId ?? '', r.sourceKey, r.error ?? '', reasonText(r.error, lang), r.bytes].map(csvCell).join(',') + '\r\n';
            }
            controller.enqueue(enc.encode(chunk));
        },
    });
}

/** CSV de credenciales (lo genera el navegador una sola vez; aqui para pruebas y coherencia de formato). */
export function credentialsCsv(rows: Array<{ email: string; password: string; mustChange: boolean }>): string {
    const lines = [['email', 'password', 'must_change_password'].map(csvCell).join(',')];
    for (const r of rows) lines.push([r.email, r.password, r.mustChange ? 'yes' : 'no'].map(csvCell).join(','));
    return lines.join('\r\n') + '\r\n';
}
