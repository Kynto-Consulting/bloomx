/**
 * Validacion y evaluacion "razonablemente segura" de regex definidas por el usuario.
 *
 * JavaScript no permite interrumpir un RegExp en curso (no hay timeout), y no
 * incluimos RE2. La defensa es por capas:
 *  1. Limite de longitud del patron.
 *  2. Rechazo estatico de construcciones que causan backtracking exponencial o
 *     polinomico alto: cuantificadores anidados `(a+)+`, alternancia dentro de un
 *     grupo cuantificado `(a|a)*`, referencias hacia atras y lookarounds.
 *  3. Limite de tamano del texto evaluado.
 *
 * Es una heuristica conservadora: puede rechazar patrones inofensivos, pero no
 * deberia aceptar los clasicos patrones catastroficos.
 */

export const MAX_REGEX_LENGTH = 200;
export const MAX_REGEX_INPUT = 20_000;

export type RegexValidation = { ok: true } | { ok: false; error: string };

function quantifierAt(src: string, i: number): { len: number; repeats: boolean } | null {
    const c = src[i];
    if (c === '*' || c === '+') return { len: 1 + (src[i + 1] === '?' ? 1 : 0), repeats: true };
    if (c === '?') return { len: 1 + (src[i + 1] === '?' ? 1 : 0), repeats: false };
    if (c === '{') {
        const m = /^\{(\d+)(?:,(\d*))?\}/.exec(src.slice(i, i + 24));
        if (!m) return null;
        const min = Number(m[1]);
        const hasComma = m[0].includes(',');
        const max = hasComma ? (m[2] === '' ? Infinity : Number(m[2])) : min;
        return { len: m[0].length + (src[i + m[0].length] === '?' ? 1 : 0), repeats: max > 1 };
    }
    return null;
}

interface Frame { hasQuant: boolean; hasAlt: boolean }

export function validateUserRegex(pattern: unknown): RegexValidation {
    if (typeof pattern !== 'string' || pattern.length === 0) {
        return { ok: false, error: 'El patron esta vacio' };
    }
    if (pattern.length > MAX_REGEX_LENGTH) {
        return { ok: false, error: `El patron supera ${MAX_REGEX_LENGTH} caracteres` };
    }
    if (/\\[1-9]|\\k</.test(pattern)) {
        return { ok: false, error: 'No se permiten referencias hacia atras' };
    }
    if (/\(\?<?[=!]/.test(pattern)) {
        return { ok: false, error: 'No se permiten lookahead/lookbehind' };
    }

    const stack: Frame[] = [];
    let inClass = false;
    let lastGroup: Frame | null = null;
    let quantCount = 0;
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i];
        if (c === '\\') { i++; lastGroup = null; continue; }
        if (inClass) {
            if (c === ']') inClass = false;
            continue;
        }
        if (c === '[') { inClass = true; lastGroup = null; continue; }
        if (c === '(') {
            stack.push({ hasQuant: false, hasAlt: false });
            lastGroup = null;
            continue;
        }
        if (c === ')') {
            const frame = stack.pop();
            if (!frame) return { ok: false, error: 'Parentesis sin abrir' };
            lastGroup = frame;
            const parent = stack[stack.length - 1];
            if (parent) {
                parent.hasQuant ||= frame.hasQuant;
                parent.hasAlt ||= frame.hasAlt;
            }
            continue;
        }
        if (c === '|') {
            const top = stack[stack.length - 1];
            if (top) top.hasAlt = true;
            lastGroup = null;
            continue;
        }
        const q = quantifierAt(pattern, i);
        if (q) {
            if (q.repeats) {
                quantCount++;
                if (lastGroup && (lastGroup.hasQuant || lastGroup.hasAlt)) {
                    return { ok: false, error: 'Patron potencialmente peligroso (cuantificador anidado)' };
                }
                const top = stack[stack.length - 1];
                if (top) top.hasQuant = true;
            }
            i += q.len - 1;
            lastGroup = null;
            continue;
        }
        lastGroup = null;
    }
    if (stack.length > 0) return { ok: false, error: 'Parentesis sin cerrar' };
    if (quantCount > 12) return { ok: false, error: 'Demasiados cuantificadores' };

    try {
        new RegExp(pattern, 'i');
    } catch {
        return { ok: false, error: 'Expresion regular invalida' };
    }
    return { ok: true };
}

const cache = new Map<string, RegExp | null>();
const CACHE_MAX = 500;

export function compileSafeRegex(pattern: string, flags: '' | 'i' = 'i'): RegExp | null {
    const key = `${flags}/${pattern}`;
    if (cache.has(key)) return cache.get(key)!;
    let compiled: RegExp | null = null;
    if (validateUserRegex(pattern).ok) {
        try { compiled = new RegExp(pattern, flags); } catch { compiled = null; }
    }
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, compiled);
    return compiled;
}

/** Evalua el patron sobre el texto truncado. Devuelve false si el patron no es seguro. */
export function safeRegexTest(pattern: string, text: string, maxInput = MAX_REGEX_INPUT): boolean {
    const re = compileSafeRegex(pattern);
    if (!re) return false;
    return re.test(String(text ?? '').slice(0, maxInput));
}
