/**
 * Registro de errores de ejecucion de extensiones, visible para el autor (no solo consola).
 *
 * Fuentes: validacion de UI (ExtensionLoader), React error boundaries (ExtensionErrorBoundary), acciones que fallan
 * (CALL_BACKEND/CALL_API), expresiones invalidas. Se guarda en memoria (ultimos 100) y en localStorage
 * (clave `bloomx:ext-errors:v1`, ultimos 50) para que sobreviva a una recarga; y se emite el evento de ventana
 * `bloomx:extension-error` para que cualquier panel (p. ej. /extensions) se actualice en vivo.
 * Nunca lanza, nunca guarda secretos: solo id de extension, ruta, mensaje corto y hora.
 */

export type ExtensionErrorKind = 'validation' | 'render' | 'action' | 'expression' | 'manifest';

export interface ExtensionErrorEntry {
    id: string;
    at: number;
    extensionId: string;
    kind: ExtensionErrorKind;
    message: string;
    /** Ruta dentro del manifest/UI (p. ej. mounts[0].component.props.tone). */
    path?: string;
    count: number;
}

const STORAGE_KEY = 'bloomx:ext-errors:v1';
const EVENT = 'bloomx:extension-error';
const MAX_MEMORY = 100;
const MAX_STORED = 50;

let entries: ExtensionErrorEntry[] | null = null;
const listeners = new Set<() => void>();

function load(): ExtensionErrorEntry[] {
    if (entries) return entries;
    entries = [];
    try {
        const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) {
            entries = parsed
                .filter((e) => e && typeof e.extensionId === 'string' && typeof e.message === 'string')
                .map((e) => ({
                    id: String(e.id),
                    at: Number(e.at) || 0,
                    extensionId: e.extensionId,
                    kind: e.kind,
                    message: String(e.message).slice(0, 500),
                    path: typeof e.path === 'string' ? e.path.slice(0, 300) : undefined,
                    count: Number(e.count) || 1,
                }))
                .slice(-MAX_MEMORY);
        }
    } catch { /* almacenamiento bloqueado */ }
    return entries;
}

function persist() {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(load().slice(-MAX_STORED))); } catch { /* cuota / privado */ }
}

function notify() {
    listeners.forEach((listener) => { try { listener(); } catch { /* listener ajeno */ } });
    try { window.dispatchEvent(new CustomEvent(EVENT)); } catch { /* SSR */ }
}

/** Registra un error. Los repetidos (misma extension, tipo, ruta y mensaje) solo incrementan el contador. */
export function reportExtensionError(input: { extensionId: string; kind: ExtensionErrorKind; message: string; path?: string }): void {
    try {
        const list = load();
        const message = String(input.message || 'Error').slice(0, 500);
        const path = input.path ? String(input.path).slice(0, 300) : undefined;
        const signature = `${input.extensionId}|${input.kind}|${path ?? ''}|${message}`;
        const existing = list.find((e) => e.id === signature);
        if (existing) {
            existing.count += 1;
            existing.at = Date.now();
        } else {
            list.push({ id: signature, at: Date.now(), extensionId: input.extensionId || 'desconocida', kind: input.kind, message, path, count: 1 });
        }
        if (list.length > MAX_MEMORY) list.splice(0, list.length - MAX_MEMORY);
        persist();
        notify();
        if (typeof console !== 'undefined') console.warn(`[Extensions] ${input.extensionId}${path ? ` ${path}` : ''}: ${message}`);
    } catch { /* el registro nunca rompe la app */ }
}

export function getExtensionErrors(extensionId?: string): ExtensionErrorEntry[] {
    const list = load().slice().sort((a, b) => b.at - a.at);
    return extensionId ? list.filter((e) => e.extensionId === extensionId) : list;
}

export function clearExtensionErrors(extensionId?: string): void {
    entries = extensionId ? load().filter((e) => e.extensionId !== extensionId) : [];
    persist();
    notify();
}

export function subscribeExtensionErrors(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** Solo para tests. */
export function __resetExtensionErrors(): void {
    entries = [];
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}
