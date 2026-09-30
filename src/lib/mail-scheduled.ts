// Reglas de los envios programados (puras): ventana de fechas admitida y margenes de "enviar ahora".

/** Antelacion minima al reprogramar (el proveedor necesita margen) y maximo (limite del proveedor: 30 dias). */
export const MIN_SCHEDULE_LEAD_MS = 60_000;
export const MAX_SCHEDULE_DAYS = 30;
/** Si un "Enviar ahora" inmediato es rechazado por el proveedor, el mismo contenido se reprograma a este margen (se avisa al usuario). */
export const SEND_NOW_RESTORE_MS = 120_000;
/** Ultimo recurso (faltan adjuntos/cuerpo en el almacenamiento para reenviar): se adelanta el programado a este margen. */
export const SEND_NOW_FALLBACK_MS = 30_000;

export type ScheduleDateError = 'invalid' | 'too_soon' | 'too_far';

export function validateScheduleDate(value: unknown, now: number = Date.now()): { ok: true; date: Date } | { ok: false; reason: ScheduleDateError } {
    if (typeof value !== 'string' && typeof value !== 'number') return { ok: false, reason: 'invalid' };
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return { ok: false, reason: 'invalid' };
    if (date.getTime() < now + MIN_SCHEDULE_LEAD_MS) return { ok: false, reason: 'too_soon' };
    if (date.getTime() > now + MAX_SCHEDULE_DAYS * 86_400_000) return { ok: false, reason: 'too_far' };
    return { ok: true, date };
}

export const SCHEDULE_ACTIONS = ['reschedule', 'sendNow', 'delete'] as const;
export type ScheduleAction = (typeof SCHEDULE_ACTIONS)[number];
