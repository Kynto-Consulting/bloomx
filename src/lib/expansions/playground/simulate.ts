/**
 * Simulacion PURA del entorno de una extension en el playground: backend ficticio y funciones del composer.
 * Nunca se llama al backend real: `createBackendSimulator().callBackend` sustituye a `executeExtensionAction`.
 *
 * Guion del backend (JSON):
 *   { "nombreFuncion": { "result": <cualquiera>, "delayMs": 300 },
 *     "otra":          { "error": "texto", "times": 1, "result": <valor tras los fallos> } }
 *   - `delayMs` (0-10000): espera antes de responder.
 *   - `error` sin `times`: siempre falla. Con `times: N`: falla las N primeras llamadas y despues responde con `result`.
 */
import { parseJson } from './analyze';

export const MAX_DELAY_MS = 10000;

export interface BackendEntry { result?: any; error?: string; times?: number; delayMs?: number }
export type BackendScript = Record<string, BackendEntry>;

export interface ScriptParse { ok: boolean; script: BackendScript; errors: Array<{ path: string; message: string; line?: number; column?: number }> }

const isObject = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value);
const BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);

/** Lee y valida el guion de respuestas simuladas. Las entradas invalidas se descartan con un error con ruta. */
export function parseBackendScript(text: string): ScriptParse {
    const errors: ScriptParse['errors'] = [];
    if (!text.trim()) return { ok: true, script: {}, errors };
    const parsed = parseJson(text);
    if (!parsed.ok) return { ok: false, script: {}, errors: [{ path: '$', message: parsed.message, line: parsed.line, column: parsed.column }] };
    if (!isObject(parsed.value)) return { ok: false, script: {}, errors: [{ path: '$', message: 'Debe ser un objeto {"funcion": {...}}' }] };
    const script: BackendScript = Object.create(null);
    for (const [name, raw] of Object.entries(parsed.value)) {
        if (BLOCKED.has(name)) { errors.push({ path: name, message: 'Nombre de funcion no permitido' }); continue; }
        if (!isObject(raw)) { errors.push({ path: name, message: 'Debe ser un objeto con `result` o `error`' }); continue; }
        const entry: BackendEntry = {};
        let valid = true;
        if ('result' in raw) entry.result = raw.result;
        if ('error' in raw) {
            if (typeof raw.error !== 'string') { errors.push({ path: `${name}.error`, message: 'Debe ser un texto' }); valid = false; } else entry.error = raw.error;
        }
        if ('times' in raw) {
            if (typeof raw.times !== 'number' || !Number.isInteger(raw.times) || raw.times < 1 || raw.times > 100) { errors.push({ path: `${name}.times`, message: 'Debe ser un entero entre 1 y 100' }); valid = false; } else entry.times = raw.times;
        }
        if ('delayMs' in raw) {
            if (typeof raw.delayMs !== 'number' || !Number.isFinite(raw.delayMs) || raw.delayMs < 0 || raw.delayMs > MAX_DELAY_MS) { errors.push({ path: `${name}.delayMs`, message: `Debe ser un numero entre 0 y ${MAX_DELAY_MS}` }); valid = false; } else entry.delayMs = raw.delayMs;
        }
        if (!('result' in raw) && !('error' in raw)) { errors.push({ path: name, message: 'Falta `result` o `error`' }); valid = false; }
        if (entry.times !== undefined && entry.error === undefined) { errors.push({ path: `${name}.times`, message: '`times` solo tiene sentido junto a `error`' }); valid = false; }
        if (valid) script[name] = entry;
    }
    return { ok: errors.length === 0, script, errors };
}

// ------------------------------------------------------------------ eventos
export type PlaygroundEventKind = 'backend' | 'composer';
export interface PlaygroundEvent {
    id: number;
    /** Hora local HH:MM:SS. */
    time: string;
    kind: PlaygroundEventKind;
    name: string;
    payload?: unknown;
    outcome?: 'ok' | 'error';
}
export type EventSink = (event: Omit<PlaygroundEvent, 'id' | 'time'>) => void;

export function formatTime(date: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

/** Crea un registro de eventos con id y hora; `push` devuelve la lista nueva (inmutable) acotada a `max`. */
export function createEventLog(max = 200, now: () => Date = () => new Date()) {
    let counter = 0;
    return {
        make(event: Omit<PlaygroundEvent, 'id' | 'time'>): PlaygroundEvent { return { ...event, id: ++counter, time: formatTime(now()) }; },
        append(list: PlaygroundEvent[], event: PlaygroundEvent): PlaygroundEvent[] { const next = [...list, event]; return next.length > max ? next.slice(next.length - max) : next; },
    };
}

// ------------------------------------------------------------------ backend simulado
export type BackendResponse = { success: boolean; result?: any; error?: string };

export interface BackendSimulator {
    callBackend: (extensionId: string, fn: string, params: any, context: Record<string, any>) => Promise<BackendResponse>;
    /** Vuelve a contar las llamadas (`times`). */
    reset: () => void;
    /** Llamadas recibidas por funcion. */
    counts: () => Record<string, number>;
}

export function createBackendSimulator(getScript: () => BackendScript, onEvent?: EventSink): BackendSimulator {
    const counts: Record<string, number> = Object.create(null);
    return {
        reset() { for (const key of Object.keys(counts)) delete counts[key]; },
        counts: () => ({ ...counts }),
        async callBackend(_extensionId, fn, params) {
            counts[fn] = (counts[fn] ?? 0) + 1;
            const call = counts[fn];
            const entry = getScript()[fn];
            const respond = (response: BackendResponse): BackendResponse => {
                onEvent?.({ kind: 'backend', name: fn, payload: { params, call, ...(response.success ? { result: response.result } : { error: response.error }) }, outcome: response.success ? 'ok' : 'error' });
                return response;
            };
            if (!entry) return respond({ success: false, error: `Funcion simulada no definida: "${fn}". Anadela al guion de respuestas.` });
            const delay = Math.min(Math.max(entry.delayMs ?? 0, 0), MAX_DELAY_MS);
            if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
            if (entry.error !== undefined && (entry.times === undefined || call <= entry.times)) return respond({ success: false, error: entry.error });
            return respond({ success: true, result: entry.result });
        },
    };
}

// ------------------------------------------------------------------ composer simulado
export const COMPOSER_FUNCTIONS = ['insertBody', 'appendBody', 'setSubject', 'addAttachment', 'uploadAttachment'] as const;

/**
 * Funciones del composer que recibe el contexto de los mounts COMPOSER_*: cada llamada se registra como evento.
 * `uploadAttachment` devuelve un adjunto ficticio (no sube nada).
 */
export function createComposerFunctions(onEvent: EventSink) {
    const log = (name: string, payload: unknown) => onEvent({ kind: 'composer', name, payload, outcome: 'ok' });
    return {
        insertBody: (content: unknown) => { log('insertBody', content); },
        appendBody: (content: unknown) => { log('appendBody', content); },
        setSubject: async (subject: unknown) => { log('setSubject', subject); },
        addAttachment: (attachment: unknown) => { log('addAttachment', attachment); },
        uploadAttachment: async (file: any) => {
            const name = typeof file?.name === 'string' ? file.name : 'archivo.bin';
            const size = typeof file?.size === 'number' ? file.size : 0;
            log('uploadAttachment', { name, size });
            return { filename: name, size, url: `https://example.invalid/simulado/${encodeURIComponent(name)}` };
        },
    };
}
