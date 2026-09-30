/**
 * Motor de spam v2: tipos compartidos (puros, sin BD ni red).
 *
 * El score 0-100 es la suma ponderada de SENALES. Cada senal tiene un id estable, una familia, un peso (ya multiplicado por el
 * multiplicador de su familia) y parametros; el motivo legible se genera desde `reasons.ts` en es/en (nunca se guarda texto).
 */

export type SignalFamily = 'combo' | 'auth' | 'headers' | 'content' | 'links' | 'attachments' | 'impersonation' | 'context' | 'learning' | 'origin';

/** Familias cuyo peso ajusta el administrador (multiplicador 0-2). El resto (contexto, aprendizaje, origen) es fijo. */
export const TUNABLE_FAMILIES = ['auth', 'headers', 'content', 'links', 'attachments', 'impersonation'] as const;
export type TunableFamily = (typeof TUNABLE_FAMILIES)[number];

export interface Signal {
    id: string;
    family: SignalFamily;
    /** Puntos con signo (ya ponderados por familia). Negativo = reduce sospecha. */
    weight: number;
    /** Senal grave: recorta las reducciones de contexto (una cuenta conocida comprometida sigue siendo peligrosa). */
    critical?: boolean;
    params?: Record<string, string | number>;
}

export type Band = 'clean' | 'suspicious' | 'spam';
export type BandAction = 'deliver' | 'warn' | 'spam';
export type Decision = 'delivered' | 'warned' | 'spam' | 'blocked';

export interface Mailbox { name: string; email: string }

export interface AttachmentInfo {
    filename: string;
    mimeType?: string;
    size?: number;
    /** El validador de contenido (file-type.ts) lo marco como ejecutable/peligroso. */
    dangerous?: boolean;
    /** Tipo real distinto del declarado. */
    mismatch?: boolean;
}

export interface SpamInput {
    headers: Record<string, unknown>;
    from: Mailbox;
    /** Remitente del sobre (Return-Path / MAIL FROM), si el llamador ya lo conoce. */
    envelopeFrom?: string | null;
    replyTo?: string | null;
    subject: string;
    text: string;
    html: string;
    attachments: AttachmentInfo[];
    /** Direcciones de destino (To + Cc) para el conteo de destinatarios. */
    recipients?: string[];
    now?: Date;
}

/** Datos del destinatario/buzon (los aporta la capa de servidor; el motor es puro). */
export interface RecipientContext {
    senderInContacts?: boolean;
    userRepliedBefore?: boolean;
    /** In-Reply-To/References apuntan a un mensaje enviado por el propio usuario. */
    inReplyToOwn?: boolean;
    hamFromSender?: number;
    spamFromSender?: number;
    hamFromDomain?: number;
    spamFromDomain?: number;
    /** Primera vez que este usuario recibe de este remitente. */
    firstTime?: boolean;
    /** Contribucion ya calculada del clasificador bayesiano (-20..+20) y muestras usadas. */
    bayes?: { points: number; tokens: number; samples: number } | null;
}

export interface EngineConfig {
    /** Multiplicador 0..2 por familia ajustable (1 = normal). */
    familyWeights: Record<TunableFamily, number>;
    /** Dominios propios / internos: no se consideran suplantables por si mismos. */
    ownDomains: string[];
    /** Hay lexico activo (interruptor del motor). */
    contentEnabled: boolean;
    linksEnabled: boolean;
    learningEnabled: boolean;
    contextEnabled: boolean;
}

export interface EngineResult {
    /** 0..100 (entero). */
    score: number;
    signals: Signal[];
    /** 'promotional' si trae List-Unsubscribe / Precedence bulk sin otras banderas graves. */
    category: 'personal' | 'promotional' | 'unknown';
    /** Auth del remitente fallo en alineacion (para "permitido pero suplantado"). */
    authFailed: boolean;
    /** Ejecutable/peligroso detectado. */
    dangerousAttachment: boolean;
    /** Si el remitente dice ser una marca y el dominio no le corresponde. */
    impersonation: boolean;
    /** Senales base (sin ponderar) para re-simular con otra configuracion sin volver a leer el correo. */
    raw: Signal[];
}
