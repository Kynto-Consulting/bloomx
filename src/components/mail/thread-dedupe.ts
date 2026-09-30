// Deduplicado del historial citado dentro de una conversacion (puro, sin DOM).
//
// Cada mensaje de un hilo suele citar los anteriores. Si ese historial coincide con mensajes que YA estan en el hilo, se puede
// plegar sin perder nada (sigue disponible tras el "..."). Si no coincide con nada (p.ej. el hilo esta incompleto), NO se oculta
// y se marca, porque ese historial es informacion que no existe en otro sitio.
import { foldText, headerKindOfLine, isAttributionLine, isMobileSignatureLine, isSeparatorLine, isSignatureDelimiter } from './quoted-text';

export type DuplicateStatus = 'duplicate' | 'unmatched' | 'none';

export interface DedupeEntry {
    id: string;
    /** Texto del contenido propio del mensaje (sin su historial). */
    ownText: string;
    /** Texto del historial citado ('' si el mensaje no cita nada). */
    quotedText: string;
}

export interface DedupeResult {
    status: DuplicateStatus;
    /** Mensajes del hilo cuyo contenido aparece en este historial. */
    matchedIds: string[];
    /** Fraccion (0..1) del historial explicada por mensajes del hilo. */
    coverage: number;
}

/** Longitud minima (normalizada) para que un mensaje cuente como coincidencia: "ok"/"gracias" aparecerian en cualquier historial. */
export const MIN_SIGNIFICANT = 12;
/** Caracteres significativos comparados en cabeza y cola de cada mensaje. */
export const EDGE_CHARS = 48;
/** Fraccion minima del historial que debe quedar explicada por mensajes del hilo. */
export const MIN_COVERAGE = 0.5;

/**
 * Normaliza para comparar: sin atribuciones, cabeceras De:/From:, separadores, marcas '>' ni firmas; minusculas, sin acentos,
 * y solo letras/numeros (los espacios y la puntuacion cambian entre clientes al reenvolver lineas).
 */
export function normalizeForCompare(text: string): string {
    const kept: string[] = [];
    for (const raw of (text || '').replace(/\r\n?/g, '\n').split('\n')) {
        const line = raw.replace(/^[\s>]+/, '').trim();
        if (!line) continue;
        if (isSignatureDelimiter(line) || isSeparatorLine(line) || isMobileSignatureLine(line) || isAttributionLine(line)) continue;
        if (/^[_\-=*\s]{6,}$/.test(line)) continue;
        if (headerKindOfLine(line) && line.length < 200) continue;
        kept.push(line);
    }
    return foldText(kept.join(' ')).replace(/[^\p{L}\p{N}]+/gu, '');
}

/** true si `hay` contiene el mensaje `needle` (entero si es corto; su cabeza y su cola si es largo). */
function containsMessage(hay: string, needle: string): boolean {
    if (needle.length <= EDGE_CHARS * 2) return hay.includes(needle);
    return hay.includes(needle.slice(0, EDGE_CHARS)) && hay.includes(needle.slice(-EDGE_CHARS));
}

export function analyzeThreadDuplicates(entries: readonly DedupeEntry[]): Map<string, DedupeResult> {
    const out = new Map<string, DedupeResult>();
    const own = entries.map((e) => normalizeForCompare(e.ownText));
    entries.forEach((entry, i) => {
        const quoted = normalizeForCompare(entry.quotedText);
        if (!quoted || entries.length < 2) {
            out.set(entry.id, { status: 'none', matchedIds: [], coverage: 0 });
            return;
        }
        const matchedIds: string[] = [];
        let covered = 0;
        entries.forEach((other, j) => {
            if (j === i || own[j].length < MIN_SIGNIFICANT) return;
            if (containsMessage(quoted, own[j])) { matchedIds.push(other.id); covered += own[j].length; }
        });
        const coverage = Math.min(1, covered / quoted.length);
        out.set(entry.id, { status: matchedIds.length > 0 && coverage >= MIN_COVERAGE ? 'duplicate' : 'unmatched', matchedIds, coverage });
    });
    return out;
}
