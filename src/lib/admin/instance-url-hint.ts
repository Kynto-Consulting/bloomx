/**
 * Las descripciones de ajustes pueden citar una URL de la INSTANCIA con un marcador (`https://<tu-instancia>/api/ext/...`).
 * Aqui se sustituye por el origen real de la instancia que ve el admin (la URL que debe pegar en un portal externo, p. ej. la
 * "Interactions Endpoint URL" de Discord) y se extrae para ofrecer un boton de copiar. Funcion pura (se prueba sin DOM).
 */
const PLACEHOLDER_RE = /https:\/\/<(?:tu-instancia|your-instance)>(\/[A-Za-z0-9._~\-/]*[A-Za-z0-9._~\-])/;

export function resolveInstanceUrl(description: string, origin: string): { text: string; url: string | null } {
    if (!description || !/^https?:\/\/[^/\s]+$/.test(origin)) return { text: description, url: null };
    const m = PLACEHOLDER_RE.exec(description);
    if (!m) return { text: description, url: null };
    const url = `${origin}${m[1]}`;
    return { text: description.replace(m[0], url), url };
}
