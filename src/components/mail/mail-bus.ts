// Bus en memoria entre la lista, el lector y las acciones: permite que una accion hecha en el lector
// (o un "Deshacer" desde un aviso) actualice al instante la lista abierta sin recargarla.
import type { ListEmail } from '@/lib/mail-list';

export type MailBusEvent =
    /** Quita correos de la lista (mover de carpeta / borrar) de forma optimista. */
    | { type: 'remove'; ids: string[] }
    /** Cambia campos de correos que YA estan en la lista (leido, destacado, etiquetas). No anade correos nuevos. */
    | { type: 'patch'; items: Array<{ id: string; updates: Record<string, unknown> }> }
    /** Combina (o repone si faltan) correos completos por id: deshacer y reversiones de quitar/mover. */
    | { type: 'upsert'; emails: ListEmail[] }
    /** Pide enfocar la fila de un correo (p. ej. tras deshacer). */
    | { type: 'focus'; id: string };

type Listener = (event: MailBusEvent) => void;

const listeners = new Set<Listener>();

export const mailBus = {
    emit(event: MailBusEvent) {
        listeners.forEach((l) => {
            try { l(event); } catch (e) { console.error('mailBus listener error', e); }
        });
    },
    subscribe(listener: Listener) {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    },
};

// ---------------------------------------------------------------------------
// Orden de la lista visible (para "anterior/siguiente" en el lector)
// ---------------------------------------------------------------------------

let navIds: string[] = [];
const navListeners = new Set<() => void>();

export const mailNav = {
    set(ids: string[]) {
        if (ids.length === navIds.length && ids.every((v, i) => v === navIds[i])) return;
        navIds = ids;
        navListeners.forEach((l) => l());
    },
    get() { return navIds; },
    subscribe(listener: () => void) {
        navListeners.add(listener);
        return () => { navListeners.delete(listener); };
    },
};

/** Vecinos de `id` en el orden de la lista: { prev: mas arriba, next: mas abajo }. */
export function neighbours(ids: string[], id: string | null | undefined): { prev: string | null; next: string | null; index: number } {
    const index = id ? ids.indexOf(id) : -1;
    if (index < 0) return { prev: null, next: null, index: -1 };
    return { prev: index > 0 ? ids[index - 1] : null, next: index < ids.length - 1 ? ids[index + 1] : null, index };
}
