/**
 * Preferencias POR USUARIO de las extensiones instaladas: desactivar sin desinstalar y ordenar botones/paneles.
 *
 *   { disabled: ['core-zoom'], order: ['core-giphy', 'core-notion'] }
 *
 * Se guardan en localStorage (clave por usuario, funciona sin red) y se sincronizan con el servidor dentro de
 * `expansionSettings["system:extension-prefs"]` de /api/settings (el mismo almacen cifrado de los demas ajustes
 * del usuario). El servidor no necesita conocer el formato. Las funciones `apply*` son puras (ver tests).
 */

export interface ExtensionPrefs {
    disabled: string[];
    order: string[];
    /** Acciones de las barras (EMAIL_TOOLBAR...) que el usuario ancla (true) o desancla (false), por clave de accion. Solo se guardan las decisiones explicitas. */
    pins?: Record<string, boolean>;
}

export const EXTENSION_PREFS_SETTINGS_KEY = 'system:extension-prefs';
const STORAGE_PREFIX = 'bloomx:ext-prefs:v1:';
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const MAX_IDS = 200;

const PIN_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const MAX_PINS = 300;

export const EMPTY_PREFS: ExtensionPrefs = Object.freeze({ disabled: [], order: [], pins: Object.freeze({}) }) as unknown as ExtensionPrefs;

function cleanPins(value: unknown): Record<string, boolean> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, boolean> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        if (Object.keys(out).length >= MAX_PINS) break;
        if (PIN_KEY_RE.test(key) && typeof v === 'boolean') out[key] = v;
    }
    return out;
}

function cleanIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    for (const item of value) {
        if (typeof item === 'string' && ID_RE.test(item)) seen.add(item);
        if (seen.size >= MAX_IDS) break;
    }
    return Array.from(seen);
}

/** Sanea lo que llegue de localStorage/servidor (nunca lanza). */
export function normalizePrefs(input: unknown): ExtensionPrefs {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { disabled: [], order: [], pins: {} };
    const source = input as Record<string, unknown>;
    return { disabled: cleanIds(source.disabled), order: cleanIds(source.order), pins: cleanPins(source.pins) };
}

export const isExtensionEnabled = (prefs: ExtensionPrefs, id: string): boolean => !prefs.disabled.includes(id);

/**
 * Extension OBLIGATORIA para todos: el manifest declara `mandatory: true` o el dominio la marco (`mandatory` / `settings.meta.mandatory`
 * que sirve /api/config). Un usuario no puede desactivarla: la UI la muestra bloqueada y el servidor ignora cualquier intento
 * (su lista `disabledExtensions` no la afecta).
 */
export function isMandatoryExtension(extension: unknown): boolean {
    const ext = extension as { mandatory?: unknown; settings?: { meta?: { mandatory?: unknown } } | null; template?: { mandatory?: unknown } | null } | null | undefined;
    if (!ext || typeof ext !== 'object') return false;
    return ext.mandatory === true || ext.template?.mandatory === true || ext.settings?.meta?.mandatory === true;
}

/** Ids que el navegador manda al servidor como `disabledExtensions`: solo las que el usuario apago (el servidor descarta las obligatorias). */
export function disabledIdsForServer(prefs: ExtensionPrefs): string[] {
    return cleanIds(prefs.disabled);
}

/** Devuelve nuevas prefs con la extension activada/desactivada. */
export function withEnabled(prefs: ExtensionPrefs, id: string, enabled: boolean): ExtensionPrefs {
    if (!ID_RE.test(id)) return prefs;
    const without = prefs.disabled.filter((item) => item !== id);
    return { ...prefs, disabled: enabled ? without : [...without, id] };
}

/** Nuevas prefs con la accion anclada/desanclada en las barras (`null` = volver al valor por defecto del manifest). */
export function withPinned(prefs: ExtensionPrefs, key: string, pinned: boolean | null): ExtensionPrefs {
    if (!PIN_KEY_RE.test(key)) return prefs;
    const pins = { ...(prefs.pins ?? {}) };
    if (pinned === null) delete pins[key]; else pins[key] = pinned;
    return { ...prefs, pins };
}

/** Mueve una extension una posicion (-1 = antes, +1 = despues) respecto a `allIds` (orden visible actual). */
export function withMoved(prefs: ExtensionPrefs, allIds: string[], id: string, direction: -1 | 1): ExtensionPrefs {
    const current = orderIds(allIds, prefs);
    const index = current.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return prefs;
    const next = current.slice();
    [next[index], next[target]] = [next[target], next[index]];
    return { ...prefs, order: next };
}

/** Orden efectivo: las del usuario primero (en su orden); las demas detras, en el orden original. */
export function orderIds(ids: string[], prefs: ExtensionPrefs): string[] {
    const known = prefs.order.filter((id) => ids.includes(id));
    return [...known, ...ids.filter((id) => !known.includes(id))];
}

/** Filtra las desactivadas y ordena una lista de extensiones `{id}`. */
export function applyPrefsToExtensions<T extends { id: string }>(extensions: T[], prefs: ExtensionPrefs): T[] {
    // Las obligatorias se muestran siempre, aunque el usuario las tenga en su lista de desactivadas (p. ej. se marcaron despues).
    const visible = extensions.filter((extension) => isMandatoryExtension(extension) || isExtensionEnabled(prefs, extension.id));
    const order = orderIds(visible.map((extension) => extension.id), prefs);
    return order.map((id) => visible.find((extension) => extension.id === id)!).filter(Boolean);
}

// ---------------------------------------------------------------------------------------------------------------
// Almacen (navegador)
// ---------------------------------------------------------------------------------------------------------------

let currentUser = 'anon';
let current: ExtensionPrefs = EMPTY_PREFS;
let loadedFor: string | null = null;
const listeners = new Set<() => void>();

function storageKey(user: string) { return `${STORAGE_PREFIX}${user}`; }

function emit() { listeners.forEach((listener) => { try { listener(); } catch { /* listener ajeno */ } }); }

/** Fija el usuario activo y carga sus preferencias locales (sin notificar: se llama durante el render; useSyncExternalStore relee la instantanea). Devuelve true si cambiaron. */
export function activatePrefsUser(userId: string | null | undefined): boolean {
    const user = userId || 'anon';
    if (loadedFor === user) return false;
    currentUser = user;
    loadedFor = user;
    let next = EMPTY_PREFS;
    try {
        const raw = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey(user)) : null;
        if (raw) next = normalizePrefs(JSON.parse(raw));
    } catch { /* almacenamiento bloqueado */ }
    current = next;
    return true;
}

export function getPrefs(): ExtensionPrefs { return current; }

export function subscribePrefs(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;

/** Guarda las preferencias: memoria + localStorage inmediatamente; servidor con un pequeno retardo (se agrupan). */
export function setPrefs(next: ExtensionPrefs, options: { sync?: boolean } = {}): void {
    current = normalizePrefs(next);
    try { window.localStorage.setItem(storageKey(currentUser), JSON.stringify(current)); } catch { /* cuota / privado */ }
    emit();
    if (options.sync === false || currentUser === 'anon' || typeof window === 'undefined') return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { void pushPrefsToServer(current); }, 600);
}

/** Lee el objeto completo de ajustes, cambia solo nuestra clave y lo devuelve (el servidor reemplaza el objeto entero). */
export async function pushPrefsToServer(prefs: ExtensionPrefs, fetchImpl: typeof fetch = fetch): Promise<boolean> {
    try {
        const res = await fetchImpl('/api/settings');
        if (!res.ok) return false;
        const json = await res.json();
        const all = json && typeof json.expansionSettings === 'object' && json.expansionSettings ? json.expansionSettings : {};
        const save = await fetchImpl('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expansionSettings: { ...all, [EXTENSION_PREFS_SETTINGS_KEY]: prefs } }),
        });
        return save.ok;
    } catch {
        return false;
    }
}

/** Trae las preferencias guardadas en el servidor (si existen y el usuario no las cambio mientras tanto). */
export async function pullPrefsFromServer(fetchImpl: typeof fetch = fetch): Promise<ExtensionPrefs | null> {
    try {
        const res = await fetchImpl('/api/settings');
        if (!res.ok) return null;
        const json = await res.json();
        const stored = json?.expansionSettings?.[EXTENSION_PREFS_SETTINGS_KEY];
        return stored ? normalizePrefs(stored) : null;
    } catch {
        return null;
    }
}

/** Solo para tests. */
export function __resetPrefsStore(): void {
    currentUser = 'anon'; current = EMPTY_PREFS; loadedFor = null; listeners.clear();
    if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
}
