/**
 * Puente backend compartido -> instancia para `services.ai.*` de las extensiones: POST /api/internal/host/ai.
 * Mismo modelo de confianza que el resto de /api/internal/** (ver lib/expansions/host-services/bridge-route.ts):
 *  - firma Ed25519 del BACKEND verificada con su clave publica (503 sin clave publica, 401 firma invalida / userId distinto del firmado);
 *  - `userId` y `extensionId` los fija el host (el usuario real que invoca la extension); cuerpo estricto (zod);
 *  - toda la politica (enabled, funciones, politica por extension, cuotas, guardarrailes, redaccion) se aplica AQUI, con la clave de la instancia.
 * Errores tipados: { success:false, code, error, message:{es,en}, detail?, retryAfter? } con el estado HTTP de AI_ERROR_STATUS.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { defaultBridgeDeps, extensionIdString, idString, MAX_BODY_BYTES, type BridgeDeps } from '@/lib/expansions/host-services/bridge-route';
import { runAi, statusFor, type AiResult } from './service';
import { getPublicAiState } from './settings';
import { AiError, AI_ERROR_MESSAGES, AI_ERROR_STATUS, type AiErrorCode } from './types';

const NO_STORE = { 'Cache-Control': 'no-store' };
const text = (max: number) => z.string().min(1).max(max);
const feature = z.string().min(1).max(40);

const common = {
    feature, system: z.string().max(40000).optional(), maxTokens: z.number().int().min(16).max(32000).optional(),
    temperature: z.number().min(0).max(2).optional(), model: z.string().max(120).optional(),
    parts: z.strictObject({ subject: z.string().max(2000).optional(), body: z.string().max(200000).optional() }).optional(),
};
const msg = z.strictObject({ role: z.enum(['user', 'assistant', 'system']), content: z.string().max(200000) });

export const aiBridgeRequest = z.discriminatedUnion('op', [
    z.strictObject({ op: z.literal('generate'), userId: idString, extensionId: extensionIdString, args: z.strictObject({ ...common, prompt: text(200000), responseFormat: z.enum(['text', 'json']).optional(), schema: z.unknown().optional(), retries: z.number().int().min(0).max(2).optional() }) }),
    z.strictObject({ op: z.literal('chat'), userId: idString, extensionId: extensionIdString, args: z.strictObject({ ...common, messages: z.array(msg).min(1).max(40), responseFormat: z.enum(['text', 'json']).optional(), schema: z.unknown().optional(), retries: z.number().int().min(0).max(2).optional() }) }),
    z.strictObject({ op: z.literal('json'), userId: idString, extensionId: extensionIdString, args: z.strictObject({ ...common, prompt: text(200000).optional(), messages: z.array(msg).min(1).max(40).optional(), schema: z.unknown(), retries: z.number().int().min(0).max(2).optional() }) }),
    z.strictObject({ op: z.literal('status'), userId: idString, extensionId: extensionIdString, args: z.strictObject({ feature: feature.optional() }).default({}) }),
]);
export type AiBridgeRequest = z.infer<typeof aiBridgeRequest>;

const json = (body: unknown, status: number, extra: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { ...NO_STORE, ...extra } });

export function aiErrorBody(code: AiErrorCode, detail?: string, retryAfter?: number) {
    return { success: false, error: code, code, message: AI_ERROR_MESSAGES[code], ...(detail ? { detail } : {}), ...(retryAfter ? { retryAfter } : {}) };
}

export interface AiBridgeDeps extends BridgeDeps {
    run: typeof runAi;
    status: typeof statusFor;
    state: typeof getPublicAiState;
}
export const defaultAiBridgeDeps: AiBridgeDeps = { ...defaultBridgeDeps, run: runAi, status: statusFor, state: getPublicAiState };

export function createAiBridgeHandler(deps: AiBridgeDeps = defaultAiBridgeDeps) {
    return async function POST(req: NextRequest): Promise<Response> {
        const declared = Number(req.headers.get('content-length') || 0);
        if (declared > MAX_BODY_BYTES * 4) return json({ error: 'Payload too large' }, 413);
        const raw = await req.text();
        if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES * 4) return json({ error: 'Payload too large' }, 413);

        const verified = await deps.verify(req, raw);
        if (!verified.ok) {
            return verified.reason === 'unavailable' ? json({ error: 'Backend key unavailable' }, 503, { 'Retry-After': '30' }) : json({ error: 'Unauthorized' }, 401);
        }
        let body: unknown = null;
        try { body = JSON.parse(raw); } catch { body = null; }
        const parsed = aiBridgeRequest.safeParse(body);
        if (!parsed.success) return json(aiErrorBody('invalid_args'), AI_ERROR_STATUS.invalid_args);
        const data = parsed.data;
        if (!verified.userId || verified.userId !== data.userId) return json({ error: 'Unauthorized' }, 401);

        const rl = await deps.rateLimit(`internal-ai:${data.userId}`, 60, 60_000);
        if (!rl.ok) return json({ error: 'Too many requests', code: 'rate_limited' }, 429, { 'Retry-After': String(rl.retryAfter) });

        try {
            if (!(await deps.userExists(data.userId))) return json({ error: 'Not found', code: 'not_found' }, 404);
            if (data.op === 'status') {
                const [st, state] = await Promise.all([deps.status(data.userId, data.args.feature ?? 'other', data.extensionId), deps.state()]);
                return json({ success: true, data: { ...st, state } }, 200);
            }
            const a = data.args as Record<string, any>;
            const result: AiResult = await deps.run({
                userId: data.userId, extensionId: data.extensionId, feature: a.feature, system: a.system, prompt: a.prompt, messages: a.messages, parts: a.parts,
                maxTokens: a.maxTokens, temperature: a.temperature, model: a.model, schema: a.schema, retries: a.retries,
                responseFormat: data.op === 'json' ? 'json' : a.responseFormat,
            });
            return json({ success: true, data: result }, 200);
        } catch (e) {
            if (e instanceof AiError) return json(aiErrorBody(e.code, e.detail, e.retryAfter), e.status, e.retryAfter ? { 'Retry-After': String(e.retryAfter) } : {});
            console.error('[internal-ai] failed:', data.op, String((e as Error)?.message || 'error').slice(0, 120));
            return json({ error: 'Internal error' }, 500);
        }
    };
}
