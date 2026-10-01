import { UI_COMPONENTS } from '@/lib/expansions/ui-schema';

/**
 * Busca, en los manifests REALES de ../bloomx-extensions, un uso de cada componente del kit para citarlo en su pagina.
 * Logica pura (recibe los manifests ya leidos): la usan scripts/gen-ui-usages.ts (genera ui-usages.json, que se
 * versiona porque el build del frontend no tiene acceso al otro repositorio) y ui-kit.test.ts (comprueba que el
 * JSON versionado sigue al dia cuando el otro repositorio esta presente).
 */

export interface ManifestFile { file: string; manifest: any }
export interface Usage { file: string; extensionId: string; point: string; path: string; node: Record<string, any>; alsoIn: string[] }
export interface UsagesDoc { source: string; components: Record<string, Usage> }

const MAX_NODE_CHARS = 1800;
const MIN_NODE_CHARS = 50;

interface Candidate { type: string; file: string; extensionId: string; point: string; path: string; node: Record<string, any>; size: number; score: number }

function walk(value: any, path: string, ctx: { file: string; extensionId: string; point: string }, out: Candidate[], depth = 0) {
    if (depth > 60 || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((v, i) => walk(v, `${path}[${i}]`, ctx, out, depth + 1)); return; }
    if (typeof value.type === 'string' && value.type in UI_COMPONENTS && (value.props !== undefined || value.children !== undefined || Object.keys(value).length === 1)) {
        const size = JSON.stringify(value).length;
        const props = value.props && typeof value.props === 'object' ? Object.keys(value.props).length : 0;
        const hasAction = JSON.stringify(value).includes('"action"');
        // Prefiere nodos con props y, si el componente admite acciones, con una accion; y entre ellos el mas corto.
        out.push({ type: value.type, ...ctx, path, node: value, size, score: (props > 0 ? 2 : 0) + (hasAction ? 1 : 0) });
    }
    for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k, ctx, out, depth + 1);
}

export function collectUsages(files: ManifestFile[]): UsagesDoc {
    const all: Candidate[] = [];
    for (const { file, manifest } of files) {
        const extensionId = typeof manifest?.id === 'string' ? manifest.id : file;
        (Array.isArray(manifest?.mounts) ? manifest.mounts : []).forEach((mount: any, i: number) => {
            walk(mount?.component, `mounts[${i}].component`, { file, extensionId, point: String(mount?.point ?? '?') }, all);
        });
        if (manifest?.overlays && typeof manifest.overlays === 'object') {
            for (const [id, overlay] of Object.entries(manifest.overlays)) walk(overlay, `overlays.${id}`, { file, extensionId, point: `overlay:${id}` }, all);
        }
    }
    const components: Record<string, Usage> = {};
    for (const type of Object.keys(UI_COMPONENTS)) {
        const mine = all.filter((c) => c.type === type);
        if (!mine.length) continue;
        const fit = mine.filter((c) => c.size >= MIN_NODE_CHARS && c.size <= MAX_NODE_CHARS);
        const pool = fit.length ? fit : mine.filter((c) => c.size <= MAX_NODE_CHARS * 3);
        const best = [...(pool.length ? pool : mine)].sort((a, b) => b.score - a.score || a.size - b.size || a.file.localeCompare(b.file) || a.path.localeCompare(b.path))[0];
        const alsoIn = [...new Set(mine.map((c) => c.file))].filter((f) => f !== best.file).sort();
        components[type] = { file: best.file, extensionId: best.extensionId, point: best.point, path: best.path, node: best.node, alsoIn };
    }
    return { source: 'bloomx-extensions', components };
}
