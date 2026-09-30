/**
 * Contrato (zod) del servicio interno de correo que usa el sandbox de extensiones (`services.mail.*`).
 *
 * Principio de minimo privilegio:
 *  - `userId` lo fija el BACKEND a partir de la identidad verificada (JWT o webhook interno); la extension nunca lo elige.
 *  - La extension no elige nombres de etiqueta ni colores: solo una CATEGORIA de una lista cerrada; el servidor la
 *    traduce a la etiqueta del propio usuario.
 *  - Todos los objetos son estrictos: claves desconocidas => 400.
 */
import { z } from 'zod';

export const ORGANIZER_CATEGORIES = ['work', 'personal', 'newsletter', 'notification', 'finance', 'social', 'spam'] as const;
export type OrganizerCategory = (typeof ORGANIZER_CATEGORIES)[number];

/** `none` = "examinado, sin categoria": deja constancia para que el correo no reaparezca en cada corrida. */
export const ITEM_CATEGORIES = [...ORGANIZER_CATEGORIES, 'none'] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const ORGANIZER_METHODS =['ai', 'heuristic'] as const;
export const ORGANIZER_SOURCES = ['manual', 'hook'] as const;

/** Etiqueta que crea/usa el organizer por categoria. `spam` nunca etiqueta (solo se propone). */
export const CATEGORY_LABELS: Record<OrganizerCategory, { name: string; color: string } | null> = {
    work: { name: 'Work', color: '#2563eb' },
    personal: { name: 'Personal', color: '#16a34a' },
    newsletter: { name: 'Newsletters', color: '#9333ea' },
    notification: { name: 'Notifications', color: '#64748b' },
    finance: { name: 'Finance', color: '#ca8a04' },
    social: { name: 'Social', color: '#db2777' },
    spam: null,
};

export const MIN_CONFIDENCE_FLOOR = 0.5;
export const DEFAULT_MIN_CONFIDENCE = 0.7;
export const MAX_LIST_LIMIT = 100;
export const MAX_BATCH_ITEMS = 50;

const idString = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const runId = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const listRecentArgs = z.strictObject({
    limit: z.number().int().min(1).max(MAX_LIST_LIMIT).default(50),
    maxAgeDays: z.number().int().min(1).max(90).default(30),
});

export const getEmailArgs = z.strictObject({ emailId: idString });

export const applyBatchArgs = z.strictObject({
    source: z.enum(ORGANIZER_SOURCES).default('manual'),
    minConfidence: z.number().min(MIN_CONFIDENCE_FLOOR).max(0.99).default(DEFAULT_MIN_CONFIDENCE),
    runId: runId.optional(),
    items: z.array(z.strictObject({
        emailId: idString,
        category: z.enum(ITEM_CATEGORIES),
        confidence: z.number().min(0).max(1),
        method: z.enum(ORGANIZER_METHODS),
    })).min(1).max(MAX_BATCH_ITEMS),
});

export const undoRunArgs = z.strictObject({ runId: runId.optional() });

export const internalMailRequest = z.discriminatedUnion('op', [
    z.strictObject({ op: z.literal('listRecent'), userId: idString, args: listRecentArgs.default({ limit: 50, maxAgeDays: 30 }) }),
    z.strictObject({ op: z.literal('getEmail'), userId: idString, args: getEmailArgs }),
    z.strictObject({ op: z.literal('applyBatch'), userId: idString, args: applyBatchArgs }),
    z.strictObject({ op: z.literal('undoRun'), userId: idString, args: undoRunArgs.default({}) }),
]);

export type InternalMailRequest = z.infer<typeof internalMailRequest>;
