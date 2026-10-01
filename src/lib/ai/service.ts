import { applyBodyPolicy, applySystemPrefix, runInputGuardrails, runOutputGuardrails, type MailParts } from './guardrails';
import { extractJson, validateAgainstSchema, validateSchemaDefinition, type JsonSchema } from './json-schema';
import { callProvider, estimateTokens, type ChatMessage, type ProviderResult } from './providers';
import { getPublicAiState, isConfigured, resolveAi, type ResolvedAi } from './settings';
import { AiError, normalizeFeature, type AiFeature, type AiProvider } from './types';
import { assertSafeBaseUrl } from './url-guard';
import { checkQuotas, estimateCost, maybePurge, recordUsage, remainingFor } from './usage';

/**
 * Servicio de IA central de la instancia. UNICA puerta al proveedor: la usan la ruta firmada del backend
 * (/api/internal/host/ai, extensiones), el boton "Probar conexion" y la CLI. Orden de la tuberia:
 *   configuracion -> enabled -> configurada -> funcion -> politica de la extension -> limites -> guardarrailes de entrada
 *   (cuerpo, temas, redaccion) -> cuota -> proveedor -> uso -> guardarrailes de salida (-> esquema JSON con reintentos).
 * Los reintentos del modo JSON cuentan en la cuota. Nunca se guarda contenido; los errores son tipados (AiError).
 */
export interface AiChatMessage { role: 'user' | 'assistant' | 'system'; content: string }

export interface AiRequest {
    userId: string;
    extensionId?: string | null;
    feature: unknown;
    system?: string;
    prompt?: string;
    messages?: AiChatMessage[];
    /** Correo estructurado: permite aplicar la politica "no enviar el cuerpo". */
    parts?: MailParts;
    maxTokens?: number;
    temperature?: number;
    responseFormat?: 'text' | 'json';
    schema?: unknown;
    /** 0..2 (solo con schema). */
    retries?: number;
    model?: string;
}

export interface AiResult {
    text?: string;
    data?: unknown;
    usage: { tokensIn: number; tokensOut: number };
    model: string;
    warnings: string[];
}

const MAX_MESSAGES = 40;

function splitMessages(req: AiRequest): { system: string; messages: ChatMessage[] } {
    const sys: string[] = req.system ? [req.system] : [];
    const messages: ChatMessage[] = [];
    for (const m of req.messages ?? []) {
        if (!m || typeof m.content !== 'string' || !['user', 'assistant', 'system'].includes(m.role)) throw new AiError('invalid_args', 'messages');
        if (m.role === 'system') sys.push(m.content); else messages.push({ role: m.role, content: m.content });
    }
    if (typeof req.prompt === 'string' && req.prompt) messages.push({ role: 'user', content: req.prompt });
    if (messages.length === 0 || messages.length > MAX_MESSAGES) throw new AiError('invalid_args', 'messages');
    if (messages[messages.length - 1].role !== 'user') throw new AiError('invalid_args', 'last_not_user');
    return { system: sys.join('\n\n'), messages };
}

export function assertUsable(r: ResolvedAi, feature: AiFeature, extensionId?: string | null): void {
    if (!r.enabled) throw new AiError('ai_disabled');
    if (!isConfigured(r)) throw new AiError('not_configured');
    if (r.config.features[feature] === false) throw new AiError('feature_disabled', feature);
    if (extensionId && r.config.extensions[extensionId]?.enabled === false) throw new AiError('feature_disabled', 'extension');
}

function pickModel(r: ResolvedAi, extensionId: string | null | undefined, requested: string | undefined): string {
    const allowed = new Set([r.model as string, ...r.config.allowedModels]);
    const wanted = requested ?? (extensionId ? r.config.extensions[extensionId]?.model : undefined);
    return wanted && allowed.has(wanted) ? wanted : (r.model as string);
}

export async function runAi(req: AiRequest): Promise<AiResult> {
    const feature = normalizeFeature(req.feature);
    if (!feature) throw new AiError('invalid_args', 'feature');
    if (!req.userId) throw new AiError('invalid_args', 'user');
    const extensionId = req.extensionId ?? null;
    const r = await resolveAi();
    assertUsable(r, feature, extensionId);
    const cfg = r.config;

    const wantsJson = req.responseFormat === 'json' || req.schema !== undefined;
    let schema: JsonSchema | undefined;
    if (req.schema !== undefined) {
        const v = validateSchemaDefinition(req.schema);
        if (!v.ok) throw new AiError('invalid_args', `schema:${v.error}`.slice(0, 80));
        schema = v.schema;
    }
    const retries = schema ? Math.min(2, Math.max(0, Math.floor(req.retries ?? 0))) : 0;

    // Limites
    const { system: rawSystem, messages } = splitMessages(req);
    const mailPart = req.parts ? applyBodyPolicy(req.parts, cfg.guardrails.bodyPolicy).text : '';
    const inputChars = rawSystem.length + messages.reduce((a, m) => a + m.content.length, 0) + mailPart.length;
    if (inputChars > cfg.limits.maxInputChars) throw new AiError('guardrail_blocked', 'input_too_long');
    const extMax = extensionId ? cfg.extensions[extensionId]?.maxTokens : undefined;
    const maxTokens = Math.max(16, Math.min(req.maxTokens ?? cfg.limits.maxOutputTokens, cfg.limits.maxOutputTokens, extMax ?? Infinity));
    const temperature = Math.min(Math.max(0, req.temperature ?? 0.3), cfg.limits.maxTemperature);
    const model = pickModel(r, extensionId, req.model);
    const provider = r.provider as AiProvider;

    // Guardarrailes de entrada (cuerpo -> temas -> redaccion). El prefijo de system se antepone DESPUES (no se redacta).
    const texts = [rawSystem, ...messages.map((m) => m.content), mailPart];
    const guard = runInputGuardrails(texts, cfg.guardrails);
    const flags = [...guard.flags];
    const warnings = [...guard.warnings];
    const log = (e: { ok: boolean; errorCode?: string; tokensIn?: number; tokensOut?: number }) => recordUsage({
        userId: req.userId, feature, extensionId, provider, model, tokensIn: e.tokensIn ?? 0, tokensOut: e.tokensOut ?? 0, ok: e.ok, errorCode: e.errorCode ?? null, flags,
        costUsd: estimateCost(cfg.pricing[model], e.tokensIn ?? 0, e.tokensOut ?? 0),
    });
    if (guard.blocked) { await log({ ok: false, errorCode: 'guardrail_blocked' }); throw new AiError('guardrail_blocked', guard.blocked); }

    const [sysT, ...rest] = guard.texts;
    const mailT = rest.pop() as string;
    const sent: ChatMessage[] = messages.map((m, i) => ({ role: m.role, content: rest[i] }));
    if (mailT) sent[sent.length - 1] = { role: 'user', content: `${sent[sent.length - 1].content}\n\n${mailT}`.trim() };
    let system = applySystemPrefix(cfg.guardrails.systemPrefix, sysT);
    if (wantsJson && !schema) system = `${system}\n\nRespond ONLY with a valid JSON value, no prose.`.trim();
    if (schema) system = `${system}\n\nRespond ONLY with JSON that matches this JSON Schema, no prose:\n${JSON.stringify(schema)}`.trim();

    let convo = sent;
    let lastTotals = { tokensIn: 0, tokensOut: 0 };
    for (let attempt = 0; attempt <= retries; attempt++) {
        const breach = await checkQuotas(req.userId, cfg, maxTokens);
        if (breach) {
            await log({ ok: false, errorCode: 'quota_exceeded' });
            throw new AiError('quota_exceeded', `${breach.scope}:${breach.metric}`, breach.retryAfter);
        }
        let out: ProviderResult;
        try {
            out = await callProvider({ provider, model, apiKey: r.apiKey as string, baseUrl: r.baseUrl, system, messages: convo, temperature, maxTokens, timeoutMs: cfg.limits.timeoutMs, json: wantsJson ? { schema } : null });
        } catch (e) {
            const err = e instanceof AiError ? e : new AiError('provider_error', 'unknown');
            await log({ ok: false, errorCode: err.code, tokensIn: estimateTokens(system + convo.map((m) => m.content).join('')) });
            throw err;
        }
        lastTotals = { tokensIn: out.tokensIn, tokensOut: out.tokensOut };
        const outG = runOutputGuardrails(out.text, cfg.guardrails);
        flags.push(...outG.flags); warnings.push(...outG.warnings);
        if (outG.blocked) { await log({ ok: false, errorCode: 'guardrail_blocked', ...lastTotals }); throw new AiError('guardrail_blocked', outG.blocked); }

        if (!wantsJson) {
            await log({ ok: true, ...lastTotals });
            void maybePurge(cfg.retentionDays);
            return { text: outG.text, usage: lastTotals, model, warnings: unique(warnings) };
        }
        let data: unknown, problem = 'not_json';
        try { data = extractJson(outG.text); problem = ''; } catch { /* reintento */ }
        if (!problem && schema) {
            const check = validateAgainstSchema(data, schema);
            if (!check.ok) problem = `${check.path}:${check.rule}`;
        }
        if (!problem) {
            await log({ ok: true, ...lastTotals });
            void maybePurge(cfg.retentionDays);
            return { data, usage: lastTotals, model, warnings: unique(warnings) };
        }
        await log({ ok: false, errorCode: 'schema_validation_failed', ...lastTotals });
        if (attempt === retries) throw new AiError('schema_validation_failed', problem.slice(0, 120));
        // Pista de reintento: solo ruta/regla del incumplimiento, nunca el contenido del modelo.
        const last = sent[sent.length - 1];
        convo = [...sent.slice(0, -1), { role: 'user', content: `${last.content}\n\n(Your previous answer was invalid: ${problem}. Return ONLY valid JSON that matches the schema.)` }];
    }
    throw new AiError('provider_error', 'unreachable');
}

const unique = (a: string[]) => Array.from(new Set(a));

// ------------------------------------------------------------------------------------------------------------------
// Estado para extensiones y prueba de conexion
// ------------------------------------------------------------------------------------------------------------------
export interface AiStatusForUser {
    enabled: boolean;
    available: boolean;
    featureEnabled: boolean | null;
    provider: AiProvider | null;
    model: string | null;
    remaining: { requestsDay: number; requestsMonth: number; tokensDay: number; tokensMonth: number };
    limits: { maxOutputTokens: number; maxInputChars: number; maxTemperature: number };
    /** Codigo por el que no esta disponible (si aplica). */
    reason: 'ai_disabled' | 'not_configured' | 'feature_disabled' | 'quota_exceeded' | null;
}

export async function statusFor(userId: string, feature: unknown, extensionId?: string | null): Promise<AiStatusForUser> {
    const r = await resolveAi();
    const f = normalizeFeature(feature);
    const remaining = await remainingFor(userId, r.config);
    const featureOk = f ? r.config.features[f] !== false && !(extensionId && r.config.extensions[extensionId]?.enabled === false) : null;
    let reason: AiStatusForUser['reason'] = null;
    if (!r.enabled) reason = 'ai_disabled';
    else if (!isConfigured(r)) reason = 'not_configured';
    else if (featureOk === false) reason = 'feature_disabled';
    else if (Object.values(remaining).some((v) => v === 0)) reason = 'quota_exceeded';
    return {
        enabled: r.enabled, available: reason === null, featureEnabled: featureOk,
        provider: r.provider, model: r.model, remaining,
        limits: { maxOutputTokens: r.config.limits.maxOutputTokens, maxInputChars: r.config.limits.maxInputChars, maxTemperature: r.config.limits.maxTemperature },
        reason,
    };
}

export interface TestOverride { provider?: AiProvider; model?: string; baseUrl?: string | null; apiKey?: string }
export interface TestResult { ok: boolean; latencyMs: number; model: string | null; provider: AiProvider | null; error: string | null }

/** "Probar conexion": una llamada minima con la configuracion guardada (o con valores transitorios, nunca persistidos). */
export async function testConnection(override: TestOverride = {}): Promise<TestResult> {
    const r = await resolveAi({ fresh: true });
    const provider = override.provider ?? r.provider;
    const model = override.model ?? r.model;
    const apiKey = override.apiKey ?? r.apiKey;
    const baseUrl = override.baseUrl !== undefined ? override.baseUrl : r.baseUrl;
    const done = (ok: boolean, started: number, error: string | null): TestResult => ({ ok, latencyMs: Date.now() - started, model, provider, error });
    const started = Date.now();
    if (!provider || !model || !apiKey) return done(false, started, 'not_configured');
    try {
        if (baseUrl) await assertSafeBaseUrl(baseUrl);
        await callProvider({ provider, model, apiKey, baseUrl: baseUrl ?? null, system: '', messages: [{ role: 'user', content: 'Reply with the single word: ok' }], temperature: 0, maxTokens: 16, timeoutMs: Math.min(15000, r.config.limits.timeoutMs) });
        return done(true, started, null);
    } catch (e) {
        return done(false, started, e instanceof AiError ? `${e.code}${e.detail ? `:${e.detail}` : ''}` : 'unsafe_base_url');
    }
}

export { getPublicAiState };
