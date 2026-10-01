import { computePausedExtensions, manifestDependencies, type DepIssue } from './ext-dependencies';

/**
 * Defensa en profundidad (el backend ya omite las pausadas de /api/config): separa las extensiones activas de /api/config en
 * ejecutables y PAUSADAS por dependencias (misma funcion pura que el backend y el panel de admin). Nunca borra nada.
 */
export function splitPausedConfigExtensions<T extends { id?: unknown; version?: unknown; template?: unknown }>(extensions: readonly T[]): { runnable: T[]; paused: Array<{ id: string; issues: DepIssue[] }> } {
    const list = extensions.map((e) => ({
        id: typeof e?.id === 'string' ? e.id : '',
        version: typeof e?.version === 'string' ? e.version : '0.0.0',
        active: true,
        dependencies: manifestDependencies(e?.template),
    }));
    const map = computePausedExtensions(list.filter((e) => e.id));
    return {
        runnable: extensions.filter((e) => !(typeof e?.id === 'string' && map.has(e.id))),
        paused: Array.from(map, ([id, issues]) => ({ id, issues })),
    };
}
