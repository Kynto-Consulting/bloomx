/** Parseo de un bloque de cabeceras pegado por el administrador (puro): desdobla lineas, repite claves como lista. Acotado. */
export const MAX_RAW_HEADERS = 64 * 1024;

export function parseRawHeaders(text: string): Record<string, string | string[]> {
    const out: Record<string, string | string[]> = {};
    const src = String(text ?? '').slice(0, MAX_RAW_HEADERS).replace(/\r\n/g, '\n');
    // Solo la parte de cabeceras: hasta la primera linea en blanco
    const block = src.split(/\n\s*\n/, 1)[0];
    const lines = block.split('\n');
    const unfolded: string[] = [];
    for (const l of lines) {
        if (/^[ \t]/.test(l) && unfolded.length) unfolded[unfolded.length - 1] += ` ${l.trim()}`;
        else unfolded.push(l);
    }
    let n = 0;
    for (const l of unfolded) {
        const m = l.match(/^([A-Za-z][A-Za-z0-9-]{0,60}):\s*(.*)$/);
        if (!m || ++n > 300) continue;
        const key = m[1].toLowerCase();
        const v = m[2].trim().slice(0, 4000);
        const cur = out[key];
        if (cur === undefined) out[key] = v;
        else out[key] = Array.isArray(cur) ? [...cur, v].slice(0, 60) : [cur, v];
    }
    return out;
}
