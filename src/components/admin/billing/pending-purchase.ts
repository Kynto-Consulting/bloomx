/**
 * Ordenes/suscripciones creadas por ESTE navegador (sessionStorage). Los retornos
 * `/admin/billing?order=` y `?subscription=` solo capturan/confirman si el id fue creado aqui;
 * asi un enlace ajeno no dispara pagos ni confirmaciones.
 */
const KEY = 'bx.billing.pending.v1';
const MAX = 20;
export type PendingKind = 'order' | 'subscription';
type Store = Record<PendingKind, string[]>;

function read(): Store {
    try {
        const raw = JSON.parse(window.sessionStorage.getItem(KEY) ?? '{}') as Partial<Store>;
        const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
        return { order: list(raw.order), subscription: list(raw.subscription) };
    } catch { return { order: [], subscription: [] }; }
}
function write(s: Store) { try { window.sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* sin storage */ } }

export function markPending(kind: PendingKind, id: unknown): void {
    if (typeof id !== 'string' || !id) return;
    const s = read();
    s[kind] = [...s[kind].filter((x) => x !== id), id].slice(-MAX);
    write(s);
}
export function isPending(kind: PendingKind, id: string): boolean { return read()[kind].includes(id); }
export function clearPending(kind: PendingKind, id: string): void {
    const s = read();
    s[kind] = s[kind].filter((x) => x !== id);
    write(s);
}
