/**
 * Emision de los eventos de ciclo de vida v2 (capacidad `lifecycle.events.v2`): USER_CREATED, USER_DISABLED, USER_ENABLED, EMAIL_SPAM_DETECTED y LABEL_APPLIED.
 *
 * Garantias (todas las funciones: NUNCA lanzan y NUNCA bloquean la operacion de origen):
 *  - Asincronos: fireLifecycleHook usa after() de next/server (o una promesa suelta con catch), con timeout de 5 s en la llamada al backend y un limite
 *    de 60 eventos/min por usuario+evento. Un fallo (backend caido, extension rota, timeout) solo deja una linea de log sin datos del usuario.
 *  - Idempotentes: cada payload lleva `eventKey` determinista por HECHO (alta de la cuenta, correo clasificado, etiqueta+correo...). Aqui ademas se
 *    descartan repeticiones del mismo hecho durante 10 min por proceso; los consumidores deben deduplicar por `eventKey` (webhooks y mail-groups lo hacen).
 *  - Minimos: sin contrasenas, hashes, tokens, asuntos ni cuerpos (ver build*Context en server-hooks.ts; el backend vuelve a filtrar por lista blanca).
 *  - Solo dominios FIRMADOS y solo llegan a extensiones que declaran el permiso (READ_USERS / READ_EMAIL) y el intercept en su manifest.
 *  - Anti-bucle: lo que hace una extension (servicios mail-label, contacts...) NO re-emite eventos hacia extensiones.
 *  - La importacion de correo (mail-transfer) NO emite EMAIL_SPAM_DETECTED ni LABEL_APPLIED (igual que no emite EMAIL_RECEIVED): es historico, no actividad.
 */
import { loadDomainPrivateKey } from '@/lib/backend-auth';
import {
    buildEmailSpamDetectedContext,
    buildLabelAppliedContext,
    buildUserCreatedContext,
    buildUserDisabledContext,
    buildUserEnabledContext,
    fireLifecycleHook,
    shouldFireOnce,
    type LifecycleEvent,
    type LifecycleOptions,
} from './server-hooks';

const DEDUPE_MS = 10 * 60_000;
const MAX_LABELS_PER_EMAIL = 5;
/** Quitar y volver a poner una etiqueta es un hecho nuevo: ventana corta para absorber solo reintentos/rafagas. */
const LABEL_DEDUPE_MS = 60_000;

function emit(event: LifecycleEvent, userId: string | null | undefined, context: Record<string, unknown>, opts: LifecycleOptions = {}, dedupeMs = DEDUPE_MS): boolean {
    try {
        if (!userId) return false;
        if (!shouldFireOnce(`${event}:${String(context.eventKey || '')}`, dedupeMs)) return false;
        return fireLifecycleHook(event, userId, context, opts);
    } catch {
        return false;
    }
}

export function emitUserCreated(user: { id: string; email: string; createdAt?: Date | string | null }, source: 'register' | 'admin' | 'import', opts?: LifecycleOptions): boolean {
    return emit('USER_CREATED', user.id, buildUserCreatedContext({ userId: user.id, email: user.email, source, createdAt: user.createdAt }), opts);
}

export function emitUserDisabled(user: { id: string; email: string }, opts?: LifecycleOptions): boolean {
    return emit('USER_DISABLED', user.id, buildUserDisabledContext({ userId: user.id, email: user.email }), opts);
}

export function emitUserEnabled(user: { id: string; email: string }, opts?: LifecycleOptions): boolean {
    return emit('USER_ENABLED', user.id, buildUserEnabledContext({ userId: user.id, email: user.email }), opts);
}

/** Veredicto del motor anti-spam (lib/spam/pipeline.ts UserVerdict) -> EMAIL_SPAM_DETECTED. Solo 'spam' y 'warned'; el correo limpio no emite. */
export function emitEmailSpamDetected(
    userId: string,
    mail: { emailId: string; from: string },
    verdict: { decision: string; score: number | null; signals?: Array<{ id: string; family?: string; weight?: number }> },
    opts?: LifecycleOptions,
): boolean {
    try {
        if (verdict.decision !== 'spam' && verdict.decision !== 'warned') return false;
        const signals = Array.isArray(verdict.signals) ? verdict.signals : [];
        const phishing = signals.some((s) => s.family === 'impersonation');
        const reasons = signals
            .filter((s) => typeof s.id === 'string' && (s.weight ?? 0) > 0)
            .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
            .slice(0, 10)
            .map((s) => s.id);
        const ctx = buildEmailSpamDetectedContext({
            emailId: mail.emailId,
            from: mail.from,
            verdict: verdict.decision === 'warned' ? 'suspicious' : phishing ? 'phishing' : 'spam',
            action: verdict.decision === 'warned' ? 'flag' : 'junk',
            score: verdict.score ?? undefined,
            reasons,
        });
        return emit('EMAIL_SPAM_DETECTED', userId, ctx, opts);
    } catch {
        return false;
    }
}

export type LabelLookup = (userId: string, labelIds: string[]) => Promise<Array<{ id: string; name: string }>>;
const defaultLabelLookup: LabelLookup = async (userId, labelIds) => {
    const { prisma } = await import('@/lib/prisma');
    return prisma.label.findMany({ where: { userId, id: { in: labelIds } }, select: { id: true, name: true } });
};

/**
 * LABEL_APPLIED por cada etiqueta recien aplicada a un correo (maximo 5 por correo y llamada). `source`: user (UI), rule (reglas/alias al recibir
 * o "Aplicar ahora"), system. Las etiquetas que aplica una extension no emiten (anti-bucle).
 */
export async function emitLabelApplied(
    userId: string,
    emailId: string,
    labelIds: string[],
    source: 'user' | 'rule' | 'system',
    extra: { ruleId?: string | null; lookup?: LabelLookup; opts?: LifecycleOptions } = {},
): Promise<number> {
    try {
        const ids = Array.from(new Set(labelIds.filter((x) => typeof x === 'string'))).slice(0, MAX_LABELS_PER_EMAIL);
        if (!userId || !emailId || ids.length === 0) return 0;
        // Sin clave de dominio (modo legado) o con los hooks apagados no hay a quien avisar: ni siquiera se consulta la BD.
        if (String(process.env.EXTENSION_HOOKS_DISABLED || '').toLowerCase() === 'true' || !loadDomainPrivateKey()) return 0;
        let names = new Map<string, string>();
        try {
            names = new Map((await (extra.lookup ?? defaultLabelLookup)(userId, ids)).map((l) => [l.id, l.name]));
        } catch {
            /* sin nombres: el evento sigue con el id */
        }
        let sent = 0;
        for (const labelId of ids) {
            const ctx = buildLabelAppliedContext({ emailId, labelId, labelName: names.get(labelId), source, ruleId: extra.ruleId });
            if (emit('LABEL_APPLIED', userId, ctx, extra.opts, LABEL_DEDUPE_MS)) sent++;
        }
        return sent;
    } catch {
        return 0;
    }
}
