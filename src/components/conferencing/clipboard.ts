/** Copia texto al portapapeles: API moderna y, si no hay permiso o contexto seguro, respaldo con un textarea oculto. */
export async function copyToClipboard(text: string): Promise<boolean> {
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        /* se prueba el respaldo */
    }
    try {
        if (typeof document === 'undefined') return false;
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.setAttribute('aria-hidden', 'true');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        area.style.pointerEvents = 'none';
        document.body.appendChild(area);
        area.select();
        const ok = typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
        area.remove();
        return ok;
    } catch {
        return false;
    }
}
