/**
 * Salud del manifest de una extension YA publicada (PURO): cuenta lo que la carga tolerante descarto o dejo pendiente, con ruta y
 * motivo, para mostrarlo en /extensions y en la consola de administracion. Nada de esto desactiva la extension salvo `valid: false`.
 */
import { getPreparedManifest } from '@/lib/expansions/prepare-manifest';

export interface ManifestProblem {
    path: string;
    message: string;
    /** true = el elemento (mount/overlay/slash) se descarto; false = se conserva (se resuelve al ejecutar) o se muestra como error aislado. */
    dropped: boolean;
    /** Error de un handler/funcion que no esta en api.functions (tipico de una version antigua): se resuelve por nombre en el script. */
    undeclaredFunction: boolean;
}

export interface ManifestHealth {
    /** false = estructura ilegible: la extension NO se carga. */
    valid: boolean;
    problems: ManifestProblem[];
    /** Numero de elementos descartados. */
    dropped: number;
}

export function manifestHealth(extensionId: string, template: unknown): ManifestHealth {
    if (!template || typeof template !== 'object') return { valid: false, problems: [], dropped: 0 };
    const prepared = getPreparedManifest(extensionId, template);
    const list = prepared.errors.map((e) => ({
        path: e.path && e.path !== '$' ? e.path : e.scope,
        message: e.message,
        dropped: e.dropped === true,
        undeclaredFunction: e.dropped === false,
    }));
    return { valid: prepared.ok, problems: prepared.ok ? list : [], dropped: prepared.droppedCount };
}
