/**
 * Servicio de IA central de la instancia (/admin/ai). Tipos y constantes compartidos por servidor, rutas, CLI y UI.
 * Sin dependencias de servidor: se puede importar desde el cliente.
 */
export const AI_FEATURES = ['composer', 'smart-reply', 'summarize', 'translate', 'organizer', 'other'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/** Acepta alias historicos (smart_reply, smartReply, composer-helper...) y devuelve la funcion canonica o null. */
export function normalizeFeature(raw: unknown): AiFeature | null {
    if (typeof raw !== 'string') return null;
    const k = raw.trim().toLowerCase().replace(/[_\s]+/g, '-');
    const alias: Record<string, AiFeature> = {
        composer: 'composer', 'composer-assist': 'composer', compose: 'composer', 'composer-helper': 'composer',
        'smart-reply': 'smart-reply', smartreply: 'smart-reply', reply: 'smart-reply',
        summarize: 'summarize', summary: 'summarize', summarizer: 'summarize',
        translate: 'translate', translation: 'translate', translator: 'translate',
        organizer: 'organizer', organize: 'organizer', other: 'other',
    };
    return alias[k] ?? null;
}

export const AI_PROVIDERS = ['openai', 'anthropic', 'google', 'azure-openai', 'openrouter', 'compatible', 'cohere'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
/** Proveedores que exigen baseUrl propia. */
export const PROVIDERS_NEED_BASE_URL: readonly AiProvider[] = ['azure-openai', 'compatible'];

export const AI_ERROR_CODES = [
    'ai_disabled', 'feature_disabled', 'quota_exceeded', 'guardrail_blocked', 'not_configured', 'provider_error',
    'schema_validation_failed', 'invalid_args',
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export const AI_ERROR_STATUS: Record<AiErrorCode, number> = {
    ai_disabled: 403, feature_disabled: 403, quota_exceeded: 429, guardrail_blocked: 422, not_configured: 503,
    provider_error: 502, schema_validation_failed: 422, invalid_args: 400,
};

/** Mensajes amables (es/en) para extensiones y UI. Nunca incluyen contenido del usuario ni detalles del proveedor. */
export const AI_ERROR_MESSAGES: Record<AiErrorCode, { es: string; en: string }> = {
    ai_disabled: { es: 'La IA esta desactivada en esta instancia.', en: 'AI is disabled on this instance.' },
    feature_disabled: { es: 'Esta funcion de IA esta desactivada por el administrador.', en: 'This AI feature is disabled by the administrator.' },
    quota_exceeded: { es: 'Has alcanzado el limite de uso de IA. Intentalo mas tarde.', en: 'You reached the AI usage limit. Try again later.' },
    guardrail_blocked: { es: 'La peticion se bloqueo por las politicas de seguridad de IA.', en: 'The request was blocked by AI safety policies.' },
    not_configured: { es: 'La IA aun no esta configurada (proveedor o clave).', en: 'AI is not configured yet (provider or key).' },
    provider_error: { es: 'El proveedor de IA no respondio correctamente.', en: 'The AI provider did not respond correctly.' },
    schema_validation_failed: { es: 'La respuesta de la IA no cumplio el formato esperado.', en: 'The AI response did not match the expected format.' },
    invalid_args: { es: 'Peticion de IA invalida.', en: 'Invalid AI request.' },
};

export class AiError extends Error {
    readonly code: AiErrorCode;
    readonly status: number;
    readonly retryAfter?: number;
    /** Dato corto NO sensible (regla, ruta del esquema, cuota agotada). Nunca contenido del usuario ni del modelo. */
    readonly detail?: string;
    constructor(code: AiErrorCode, detail?: string, retryAfter?: number) {
        super(code);
        this.name = 'AiError';
        this.code = code;
        this.status = AI_ERROR_STATUS[code];
        this.detail = detail;
        this.retryAfter = retryAfter;
    }
}

export type GuardrailMode = 'off' | 'log' | 'warn' | 'enforce';
export const GUARDRAIL_MODES: readonly GuardrailMode[] = ['off', 'log', 'warn', 'enforce'];

export interface QuotaSet {
    /** 0 = sin limite. */
    requestsDay: number; requestsMonth: number; tokensDay: number; tokensMonth: number;
}

export interface RedactionCategories { card: boolean; iban: boolean; nationalId: boolean; secret: boolean; email: boolean; phone: boolean }

export interface AiGuardrails {
    systemPrefix: string;
    redaction: { mode: GuardrailMode; categories: RedactionCategories };
    blockedTopics: { mode: GuardrailMode; patterns: string[] };
    output: { mode: GuardrailMode; maxChars: number; patterns: string[] };
    /** full = todo; subject-only = nunca se envia el cuerpo; snippet = solo los primeros N caracteres del cuerpo. */
    bodyPolicy: { mode: 'full' | 'subject-only' | 'snippet'; snippetChars: number };
}

export interface AiLimits { maxOutputTokens: number; maxInputChars: number; maxTemperature: number; timeoutMs: number }
export interface ModelPrice { inPer1k: number; outPer1k: number }
export interface ExtensionAiPolicy { enabled?: boolean; maxTokens?: number; model?: string }

/** Parte no secreta de la configuracion (columna JSONB `config`). */
export interface AiConfig {
    allowedModels: string[];
    features: Record<AiFeature, boolean>;
    limits: AiLimits;
    quotas: { perUser: QuotaSet; global: QuotaSet };
    retentionDays: number;
    pricing: Record<string, ModelPrice>;
    guardrails: AiGuardrails;
    extensions: Record<string, ExtensionAiPolicy>;
}

export const DEFAULT_CONFIG: AiConfig = {
    allowedModels: [],
    features: { composer: true, 'smart-reply': true, summarize: true, translate: true, organizer: true, other: true },
    limits: { maxOutputTokens: 1024, maxInputChars: 20000, maxTemperature: 1, timeoutMs: 30000 },
    quotas: {
        perUser: { requestsDay: 200, requestsMonth: 3000, tokensDay: 200000, tokensMonth: 3000000 },
        global: { requestsDay: 0, requestsMonth: 0, tokensDay: 0, tokensMonth: 0 },
    },
    retentionDays: 90,
    pricing: {},
    guardrails: {
        systemPrefix: '',
        redaction: { mode: 'enforce', categories: { card: true, iban: true, nationalId: true, secret: true, email: false, phone: false } },
        blockedTopics: { mode: 'enforce', patterns: [] },
        output: { mode: 'enforce', maxChars: 20000, patterns: [] },
        bodyPolicy: { mode: 'full', snippetChars: 500 },
    },
    extensions: {},
};

export type AiConfigSource = 'ui' | 'env' | 'none';

/** Estado publico minimo (sin secretos) que consume el cargador de extensiones y el UI del usuario. */
export interface AiPublicState {
    enabled: boolean;
    configured: boolean;
    source: AiConfigSource;
    features: Record<AiFeature, boolean>;
    /** extensionId -> false si el admin la desactivo para IA. */
    extensions: Record<string, boolean>;
}

/** Estado minimo para decidir el bloqueo de una extension (ver blocking.ts). */
export type AiBlockState = Pick<AiPublicState, 'enabled' | 'features' | 'extensions'>;
