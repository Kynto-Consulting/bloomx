import { AI_FEATURES, normalizeFeature, type AiBlockState, type AiFeature } from './types';

/**
 * UNICO sitio que decide si una extension esta bloqueada por la IA. Lo usan el cargador del frontend (via /api/expansions), la gestion
 * del admin, el backend (rechaza con `ai_disabled`) y la CLI. Funcion pura: sin red ni BD.
 *
 * Una extension "requiere IA" si su manifest declara el permiso AI / AI_GENERATE, la categoria `ai` o un bloque `ai`.
 * Bloqueo:
 *  - IA global desactivada            -> blocked 'ai_disabled'
 *  - el admin la desactivo (por ext.) -> blocked 'extension_disabled'
 *  - alguna funcion que declara en `ai.features` esta desactivada -> blocked 'feature_disabled'
 * EXCEPCION: `ai.required === false` (la extension degrada sin IA via isAvailable) nunca se bloquea: solo se informa `degraded`.
 */
export type AiBlockReason = 'ai_disabled' | 'feature_disabled' | 'extension_disabled';

export interface AiBlockResult {
    requiresAi: boolean;
    blocked: boolean;
    reason: AiBlockReason | null;
    /** Funciones que declara (canonicas). */
    features: AiFeature[];
    /** Funciones declaradas que estan desactivadas. */
    disabledFeatures: AiFeature[];
    /** La extension sigue activa pero sin IA (required:false). */
    degraded: boolean;
}

function parse(manifest: unknown): any {
    if (typeof manifest === 'string') { try { return JSON.parse(manifest); } catch { return null; } }
    return manifest && typeof manifest === 'object' ? manifest : null;
}

export function declaredAiFeatures(manifest: unknown): AiFeature[] {
    const m = parse(manifest);
    const list = Array.isArray(m?.ai?.features) ? m.ai.features : [];
    const out: AiFeature[] = [];
    for (const f of list) { const n = normalizeFeature(f); if (n && !out.includes(n)) out.push(n); }
    return out;
}

export function extensionRequiresAi(manifest: unknown): boolean {
    const m = parse(manifest);
    if (!m) return false;
    const perms: unknown[] = Array.isArray(m.permissions) ? m.permissions : [];
    if (perms.some((p) => p === 'AI' || p === 'AI_GENERATE')) return true;
    if (typeof m.category === 'string' && m.category.toLowerCase() === 'ai') return true;
    if (Array.isArray(m.categories) && m.categories.some((c: unknown) => typeof c === 'string' && c.toLowerCase() === 'ai')) return true;
    return !!(m.ai && typeof m.ai === 'object');
}

export function manifestExtensionId(manifest: unknown): string {
    const m = parse(manifest);
    return typeof m?.id === 'string' ? m.id : '';
}

export function isExtensionBlockedByAi(manifest: unknown, aiState: AiBlockState): AiBlockResult {
    const requiresAi = extensionRequiresAi(manifest);
    const features = declaredAiFeatures(manifest);
    const none: AiBlockResult = { requiresAi, blocked: false, reason: null, features, disabledFeatures: [], degraded: false };
    if (!requiresAi) return none;
    const m = parse(manifest);
    const optional = m?.ai?.required === false;
    const id = manifestExtensionId(manifest);
    const disabledFeatures = features.filter((f) => aiState.features?.[f] === false);
    let reason: AiBlockReason | null = null;
    if (!aiState.enabled) reason = 'ai_disabled';
    else if (id && aiState.extensions?.[id] === false) reason = 'extension_disabled';
    else if (disabledFeatures.length > 0) reason = 'feature_disabled';
    if (!reason) return { ...none, disabledFeatures };
    if (optional) return { ...none, disabledFeatures, degraded: true };
    return { requiresAi, blocked: true, reason, features, disabledFeatures, degraded: false };
}

/** Estado "todo permitido" para llamadas que aun no conocen la configuracion de la instancia (instancia antigua). */
export const AI_ALL_ENABLED: AiBlockState = {
    enabled: true,
    features: Object.fromEntries(AI_FEATURES.map((f) => [f, true])) as Record<AiFeature, boolean>,
    extensions: {},
};
