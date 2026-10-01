import { toGeminiSchema, type JsonSchema } from './json-schema';
import { AiError, type AiProvider } from './types';
import { httpsTransport, parseSafeBaseUrl, type AiTransport } from './url-guard';

/**
 * Adaptadores de proveedor por HTTPS (sin SDKs): openai, openrouter, azure-openai, compatible (OpenAI), anthropic, google (Gemini), cohere.
 * Todas las llamadas salen por el transporte con proteccion SSRF (url-guard). Los errores NUNCA incluyen el cuerpo del proveedor
 * ni la clave: solo el estado HTTP.
 */
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface ProviderCall {
    provider: AiProvider; model: string; apiKey: string; baseUrl: string | null;
    system: string; messages: ChatMessage[]; temperature: number; maxTokens: number; timeoutMs: number;
    /** 'json' pide JSON nativo; con `schema` usa salida estructurada si el proveedor la soporta. */
    json?: { schema?: JsonSchema } | null;
}
export interface ProviderResult { text: string; tokensIn: number; tokensOut: number }

let transport: AiTransport = httpsTransport;
/** Solo pruebas. */
export function __setTransport(t: AiTransport | null) { transport = t ?? httpsTransport; }

export const AZURE_API_VERSION = '2024-10-21';

export function buildRequest(c: ProviderCall): { url: string; headers: Record<string, string>; body: unknown } {
    const json = { 'Content-Type': 'application/json' };
    const openaiBody = () => {
        const body: Record<string, unknown> = {
            model: c.model, temperature: c.temperature, max_tokens: c.maxTokens,
            messages: [...(c.system ? [{ role: 'system', content: c.system }] : []), ...c.messages],
        };
        if (c.json) body.response_format = c.json.schema && (c.provider === 'openai' || c.provider === 'azure-openai')
            ? { type: 'json_schema', json_schema: { name: 'response', schema: c.json.schema, strict: false } }
            : { type: 'json_object' };
        return body;
    };
    switch (c.provider) {
        case 'openai': return { url: 'https://api.openai.com/v1/chat/completions', headers: { ...json, Authorization: `Bearer ${c.apiKey}` }, body: openaiBody() };
        case 'openrouter': return { url: 'https://openrouter.ai/api/v1/chat/completions', headers: { ...json, Authorization: `Bearer ${c.apiKey}` }, body: openaiBody() };
        case 'compatible': {
            const base = parseSafeBaseUrl(c.baseUrl).toString().replace(/\/+$/, '');
            return { url: `${base}/chat/completions`, headers: { ...json, Authorization: `Bearer ${c.apiKey}` }, body: openaiBody() };
        }
        case 'azure-openai': {
            const base = parseSafeBaseUrl(c.baseUrl).toString().replace(/\/+$/, '');
            const body = openaiBody(); delete body.model;
            return { url: `${base}/openai/deployments/${encodeURIComponent(c.model)}/chat/completions?api-version=${AZURE_API_VERSION}`, headers: { ...json, 'api-key': c.apiKey }, body };
        }
        case 'anthropic': {
            const body: Record<string, unknown> = { model: c.model, max_tokens: c.maxTokens, temperature: Math.min(1, c.temperature), messages: c.messages };
            if (c.system) body.system = c.system;
            if (c.json?.schema) {
                body.tools = [{ name: 'respond', description: 'Return the structured answer.', input_schema: c.json.schema.type ? c.json.schema : { ...c.json.schema, type: 'object' } }];
                body.tool_choice = { type: 'tool', name: 'respond' };
            }
            return { url: 'https://api.anthropic.com/v1/messages', headers: { ...json, 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01' }, body };
        }
        case 'google': {
            const gen: Record<string, unknown> = { temperature: c.temperature, maxOutputTokens: c.maxTokens };
            if (c.json) { gen.responseMimeType = 'application/json'; if (c.json.schema) gen.responseSchema = toGeminiSchema(c.json.schema); }
            const body: Record<string, unknown> = { contents: c.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })), generationConfig: gen };
            if (c.system) body.systemInstruction = { parts: [{ text: c.system }] };
            return { url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model)}:generateContent`, headers: { ...json, 'x-goog-api-key': c.apiKey }, body };
        }
        case 'cohere': {
            const last = c.messages[c.messages.length - 1];
            const body: Record<string, unknown> = {
                model: c.model, message: last?.content ?? '', temperature: c.temperature, max_tokens: c.maxTokens,
                chat_history: c.messages.slice(0, -1).map((m) => ({ role: m.role === 'assistant' ? 'CHATBOT' : 'USER', message: m.content })),
            };
            if (c.system) body.preamble = c.system;
            return { url: 'https://api.cohere.com/v1/chat', headers: { ...json, Authorization: `Bearer ${c.apiKey}` }, body };
        }
    }
}

function parseResponse(provider: AiProvider, data: any): ProviderResult {
    switch (provider) {
        case 'anthropic': {
            const blocks: any[] = Array.isArray(data?.content) ? data.content : [];
            const tool = blocks.find((b) => b?.type === 'tool_use');
            const text = tool ? JSON.stringify(tool.input ?? {}) : blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('');
            return { text, tokensIn: Number(data?.usage?.input_tokens) || 0, tokensOut: Number(data?.usage?.output_tokens) || 0 };
        }
        case 'google':
            return {
                text: (data?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join(''),
                tokensIn: Number(data?.usageMetadata?.promptTokenCount) || 0, tokensOut: Number(data?.usageMetadata?.candidatesTokenCount) || 0,
            };
        case 'cohere':
            return { text: String(data?.text ?? ''), tokensIn: Number(data?.meta?.tokens?.input_tokens) || 0, tokensOut: Number(data?.meta?.tokens?.output_tokens) || 0 };
        default:
            return { text: String(data?.choices?.[0]?.message?.content ?? ''), tokensIn: Number(data?.usage?.prompt_tokens) || 0, tokensOut: Number(data?.usage?.completion_tokens) || 0 };
    }
}

/** Estimacion cuando el proveedor no informa uso (~4 caracteres por token). */
export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

export async function callProvider(c: ProviderCall): Promise<ProviderResult> {
    let req: ReturnType<typeof buildRequest>;
    try { req = buildRequest(c); } catch { throw new AiError('not_configured', 'base_url'); }
    let res;
    try {
        res = await transport({ url: req.url, headers: req.headers, body: JSON.stringify(req.body), timeoutMs: c.timeoutMs });
    } catch (e) {
        const msg = String((e as Error)?.message || '');
        throw new AiError('provider_error', /timeout/i.test(msg) ? 'timeout' : /private_ip|not_https|dns/i.test(msg) ? 'blocked_host' : 'network');
    }
    if (res.status < 200 || res.status >= 300) throw new AiError('provider_error', `http_${res.status}`);
    let data: unknown;
    try { data = JSON.parse(res.body); } catch { throw new AiError('provider_error', 'bad_response'); }
    const out = parseResponse(c.provider, data);
    if (!out.text) throw new AiError('provider_error', 'empty');
    if (!out.tokensIn) out.tokensIn = estimateTokens(c.system + c.messages.map((m) => m.content).join(' '));
    if (!out.tokensOut) out.tokensOut = estimateTokens(out.text);
    return out;
}
