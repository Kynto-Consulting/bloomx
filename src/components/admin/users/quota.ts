/**
 * Entrada del campo "Cuota de buzon (MB)" del detalle de usuario: vacio = restablecer a la del dominio (null); si no, un entero
 * de MB entre 0 (sin limite) y `max`. Sin decimales, signos, notacion cientifica ni separadores.
 */
export function parseQuotaInput(text: string, max: number): { ok: true; value: number | null } | { ok: false } {
    const raw = text.trim();
    if (raw === '') return { ok: true, value: null };
    if (!/^[0-9]{1,9}$/.test(raw)) return { ok: false };
    const n = Number(raw);
    return n >= 0 && n <= max ? { ok: true, value: n } : { ok: false };
}
