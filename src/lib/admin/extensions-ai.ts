import { getPublicAiState } from '@/lib/ai/settings';
import { aiBlockInfo, type AiBlockInfo } from '@/lib/ai/extension-block';
import type { AiBlockState } from '@/lib/ai/types';
import { HttpError } from '@/lib/admin/http';
import { fetchCatalog } from '@/lib/admin/extensions-catalog';

/** Estado de IA que acompana a la lista de instaladas (sin secretos): lo justo para decidir el bloqueo en el navegador. */
export interface AiStateDto { enabled: boolean; features: AiBlockState['features']; extensions: Record<string, boolean> }

export async function loadAiStateDto(): Promise<AiStateDto | null> {
    try {
        const s = await getPublicAiState();
        return { enabled: s.enabled, features: s.features, extensions: s.extensions };
    } catch { return null; }
}

/**
 * Instalar o ACTIVAR una extension que requiere IA con la IA (o una funcion suya) desactivada se rechaza con 409 `ai_disabled` /
 * `feature_disabled` / `extension_disabled`. Desactivar y desinstalar siempre se permiten. Excepcion `ai.required === false`.
 * El manifest sale del catalogo (cache 60 s); si el catalogo no responde o la extension no esta en el, no se bloquea aqui
 * (el backend y el cargador siguen aplicando el bloqueo).
 */
export async function assertAiAllowsEnable(extensionId: string): Promise<void> {
    let info: AiBlockInfo | null = null;
    try {
        const entry = (await fetchCatalog()).find((e) => e.id === extensionId);
        if (!entry?.template) return;
        info = aiBlockInfo(entry.template, await getPublicAiState());
    } catch { return; }
    if (info.blocked) throw new HttpError(409, info.reason ?? 'ai_disabled');
}
