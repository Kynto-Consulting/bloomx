/**
 * Clasificador bayesiano ligero POR USUARIO (puro). Tokens de asunto/cuerpo normalizados -> hash truncado (FNV-1a 32 bits, 8 hex),
 * suavizado de Laplace, combinacion por log-odds de los tokens mas informativos y contribucion acotada al score (+-20).
 * La persistencia (tabla SpamToken, tope 5000 tokens por usuario con expulsion LRU) esta en learning-store.ts.
 */
import { normalizeText } from './text';

export const MAX_TOKENS_PER_USER = 5_000;
export const BAYES_MAX_POINTS = 20;
/** Marcas minimas (spam + no spam) antes de que el modelo cuente, y tokens conocidos minimos en el mensaje. */
export const MIN_TRAINED_MESSAGES = 8;
export const MIN_MATCHED_TOKENS = 3;
export const COUNTER_TOKEN = '__n';
const TOP_K = 15;
const MAX_MESSAGE_TOKENS = 120;

export function fnv1a(s: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

const STOP = new Set([
    'the', 'and', 'for', 'you', 'your', 'with', 'this', 'that', 'are', 'from', 'have', 'has', 'not', 'but', 'was', 'were', 'will', 'can', 'all', 'our', 'out', 'una', 'los', 'las', 'del', 'que', 'por', 'con', 'para', 'como', 'mas', 'sus', 'uma', 'com', 'dos', 'das', 'nao', 'mais', 'voce', 'http', 'https', 'www', 'com',
]);

export interface MessageForTokens { subject: string; body: string; fromDomain: string; linkHosts?: string[] }

/** Tokens unicos del mensaje (hashes), acotados. Prefijos: s= asunto, b= cuerpo, d= dominio del remitente, l= host de enlace. */
export function tokenize(m: MessageForTokens): string[] {
    const out = new Set<string>();
    const add = (prefix: string, text: string, max: number) => {
        let n = 0;
        for (const w of normalizeText(text).split(/[^\p{L}\p{N}$%]+/u)) {
            if (w.length < 3 || w.length > 24 || STOP.has(w) || /^\d+$/.test(w)) continue;
            out.add(fnv1a(`${prefix}:${w}`));
            if (++n >= max) break;
        }
    };
    add('s', m.subject, 30);
    add('b', m.body.slice(0, 4000), MAX_MESSAGE_TOKENS);
    if (m.fromDomain) out.add(fnv1a(`d:${m.fromDomain.toLowerCase()}`));
    for (const h of (m.linkHosts ?? []).slice(0, 10)) out.add(fnv1a(`l:${h.toLowerCase()}`));
    return [...out].slice(0, MAX_MESSAGE_TOKENS + 41);
}

export interface TokenCount { spam: number; ham: number }
export interface Model { spamMessages: number; hamMessages: number; tokens: Map<string, TokenCount> }

export interface BayesResult { points: number; tokens: number; samples: number; probability: number }

/** Probabilidad de spam y puntos (+-20). null si el modelo aun no tiene muestras suficientes. */
export function classify(tokens: string[], model: Model): BayesResult | null {
    const samples = model.spamMessages + model.hamMessages;
    if (samples < MIN_TRAINED_MESSAGES) return null;
    const ns = Math.max(1, model.spamMessages), nh = Math.max(1, model.hamMessages);
    const scored: number[] = [];
    for (const t of tokens) {
        const c = model.tokens.get(t);
        if (!c || c.spam + c.ham === 0) continue;
        const ps = (c.spam + 1) / (ns + 2);
        const ph = (c.ham + 1) / (nh + 2);
        const p = ps / (ps + ph);
        scored.push(Math.log(p / (1 - p)));
    }
    if (scored.length < MIN_MATCHED_TOKENS) return null;
    scored.sort((a, b) => Math.abs(b) - Math.abs(a));
    const top = scored.slice(0, TOP_K);
    const L = top.reduce((a, b) => a + b, 0);
    const probability = 1 / (1 + Math.exp(-L));
    const points = Math.round(Math.tanh(L / 6) * BAYES_MAX_POINTS);
    return { points, tokens: scored.length, samples, probability };
}
