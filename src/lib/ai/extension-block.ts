import { isExtensionBlockedByAi, type AiBlockReason } from './blocking';
import type { AiBlockState } from './types';

/**
 * Marca por extension para el frontend (derivada SIEMPRE de isExtensionBlockedByAi): `/api/config` la adjunta a cada extension y
 * el cargador ignora las bloqueadas (siguen instaladas; al reactivar la IA vuelven sin reinstalar).
 */
export interface AiBlockInfo {
    requiresAi: boolean;
    blocked: boolean;
    reason: AiBlockReason | null;
    degraded: boolean;
    features: string[];
    disabledFeatures: string[];
    /** ai.required === false: la IA es opcional (insignia informativa). */
    optional: boolean;
}

export function aiBlockInfo(manifest: unknown, state: AiBlockState): AiBlockInfo {
    const r = isExtensionBlockedByAi(manifest, state);
    let m: any = manifest;
    if (typeof m === 'string') { try { m = JSON.parse(m); } catch { m = null; } }
    return {
        requiresAi: r.requiresAi, blocked: r.blocked, reason: r.reason, degraded: r.degraded,
        features: r.features, disabledFeatures: r.disabledFeatures, optional: r.requiresAi && m?.ai?.required === false,
    };
}

/** Ids de las extensiones bloqueadas del ultimo calculo (para filtrar handlers de /api/expansions sin otra consulta). */
let lastBlocked: { at: number; ids: Set<string> } = { at: 0, ids: new Set() };
/** null = el calculo es antiguo (o no existe): quien llama debe refrescarlo. */
export function recentBlockedIds(maxAgeMs = 30_000): Set<string> | null {
    return Date.now() - lastBlocked.at <= maxAgeMs ? lastBlocked.ids : null;
}
export function __resetBlockedIds() { lastBlocked = { at: 0, ids: new Set() }; }

export function annotateExtensionsWithAi<T extends Record<string, any>>(extensions: readonly T[], state: AiBlockState): Array<T & { aiBlock: AiBlockInfo }> {
    const ids = new Set<string>();
    const out = extensions.map((ext) => {
        const manifest = ext?.template ?? ext?.manifest ?? null;
        const aiBlock = aiBlockInfo(manifest, state);
        if (aiBlock.blocked) {
            const id = (typeof manifest === 'object' && manifest && typeof (manifest as any).id === 'string' ? (manifest as any).id : ext?.id);
            if (typeof id === 'string') ids.add(id);
            if (typeof ext?.id === 'string') ids.add(ext.id);
        }
        return { ...ext, aiBlock };
    });
    lastBlocked = { at: Date.now(), ids };
    return out;
}
