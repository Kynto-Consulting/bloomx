/**
 * Resolucion de dependencias entre extensiones (`requires.extensions`). UNICO sitio con la logica (puro, sin dependencias).
 *
 * FUENTE CANONICA: bloomx-extensions/_shared/ext-dependencies.ts
 * Copias identicas (verificadas por tests/contract.test.mjs):
 *   - bloomx-backend/src/lib/extensions/ext-dependencies.ts   (execute/hooks/instalacion/publicacion)
 *   - bloomx/src/lib/expansions/ext-dependencies.ts           (carga, panel de admin)
 *
 * Reglas: una extension ACTIVA cuyas dependencias no estan activas y en rango queda PAUSADA (nunca se borra); la pausa es transitiva;
 * un ciclo se rechaza al publicar. Una dependencia pausada cuenta como inactiva.
 */
import { DEP_EXTENSION_ID_RE, parseVersionRange, readExtensionDependencies, versionSatisfies } from "./client-contract.ts";

export const EXTENSION_DEPENDENCY_MISSING = "EXTENSION_DEPENDENCY_MISSING";

export type DepReason = "missing" | "inactive" | "incompatible" | "paused";
export type DepIssue = { dependency: string; range: string; reason: DepReason; installedVersion?: string };

/** Una extension instalada en el dominio. `active` = instalada y no desactivada (la pausa por dependencias se calcula aqui). */
export type InstalledExtension = { id: string; version: string; active: boolean; dependencies: Record<string, string> };

/** Dependencias declaradas por un manifest (saneadas). */
export function manifestDependencies(manifest: unknown): Record<string, string> {
    let m: any = manifest;
    if (typeof m === "string") { try { m = JSON.parse(m); } catch { m = null; } }
    return readExtensionDependencies(m && typeof m === "object" ? (m as Record<string, unknown>).requires : undefined);
}

/** Pausadas = activas con alguna dependencia no satisfecha. Punto fijo (la pausa se propaga a los dependientes). */
export function computePausedExtensions(extensions: readonly InstalledExtension[]): Map<string, DepIssue[]> {
    const byId = new Map(extensions.map((e) => [e.id, e]));
    const paused = new Map<string, DepIssue[]>();
    for (let guard = 0; guard <= extensions.length + 1; guard++) {
        let changed = false;
        for (const ext of extensions) {
            if (!ext.active || paused.has(ext.id)) continue;
            const issues: DepIssue[] = [];
            for (const [dep, range] of Object.entries(ext.dependencies)) {
                const found = byId.get(dep);
                if (!found) issues.push({ dependency: dep, range, reason: "missing" });
                else if (!found.active) issues.push({ dependency: dep, range, reason: "inactive", installedVersion: found.version });
                else if (paused.has(dep)) issues.push({ dependency: dep, range, reason: "paused", installedVersion: found.version });
                else if (!versionSatisfies(range, found.version)) issues.push({ dependency: dep, range, reason: "incompatible", installedVersion: found.version });
            }
            if (issues.length > 0) { paused.set(ext.id, issues); changed = true; }
        }
        if (!changed) break;
    }
    return paused;
}

/** Problemas de dependencia de UNA extension frente al estado instalado (para execute/hooks: rechazar con EXTENSION_DEPENDENCY_MISSING). */
export function dependencyIssuesFor(id: string, extensions: readonly InstalledExtension[]): DepIssue[] {
    return computePausedExtensions(extensions).get(id) ?? [];
}

/** Dependientes (directos y transitivos) ACTIVOS de `id`: los que quedarian pausados si `id` deja de estar activo. */
export function dependentsOf(id: string, extensions: readonly InstalledExtension[]): string[] {
    const out = new Set<string>();
    const queue = [id];
    while (queue.length) {
        const cur = queue.shift()!;
        for (const e of extensions) if (e.active && e.id !== id && !out.has(e.id) && Object.prototype.hasOwnProperty.call(e.dependencies, cur)) { out.add(e.id); queue.push(e.id); }
    }
    return Array.from(out).sort();
}

/** Que dependientes pasarian a estar pausados si `id` se desactiva/desinstala (excluye los ya pausados). */
export function wouldPause(id: string, extensions: readonly InstalledExtension[]): string[] {
    const before = computePausedExtensions(extensions);
    const after = computePausedExtensions(extensions.map((e) => (e.id === id ? { ...e, active: false } : e)));
    return Array.from(after.keys()).filter((k) => !before.has(k) && k !== id).sort();
}

/** Ciclos en un grafo id -> dependencias. Devuelve el primer ciclo encontrado ([a,b,a]) o null. */
export function findDependencyCycle(graph: Record<string, Record<string, string> | readonly string[]>): string[] | null {
    const deps = (id: string): string[] => { const d = graph[id]; return !d ? [] : Array.isArray(d) ? [...d] : Object.keys(d); };
    const state = new Map<string, 1 | 2>();
    const stack: string[] = [];
    const visit = (id: string): string[] | null => {
        if (state.get(id) === 2) return null;
        if (state.get(id) === 1) return [...stack.slice(stack.indexOf(id)), id];
        state.set(id, 1); stack.push(id);
        for (const d of deps(id)) { const c = visit(d); if (c) return c; }
        stack.pop(); state.set(id, 2);
        return null;
    };
    for (const id of Object.keys(graph)) { const c = visit(id); if (c) return c; }
    return null;
}

/** Entrada del catalogo para planificar: la version compatible mas alta publicada y sus dependencias. */
export type CatalogEntry = { id: string; version: string; dependencies: Record<string, string> };
export type InstallPlan = {
    ok: boolean;
    /** Orden de instalacion (dependencias primero, la extension pedida al final). Solo lo que falta o hay que (re)activar. */
    order: string[];
    /** Dependencias que habria que instalar o reactivar (sin la pedida). */
    dependencies: Array<{ id: string; version: string; range: string; action: "install" | "activate" }>;
    errors: Array<{ dependency: string; range: string; reason: "not-in-catalog" | "incompatible-catalog" | "installed-incompatible" | "cycle"; detail?: string }>;
};

/**
 * Plan para instalar `targetId`: recorre dependencias transitivas. Una dependencia ya activa y en rango no se toca; instalada pero
 * desactivada se REACTIVA; ausente se instala si el catalogo tiene una version en rango. Una instalada FUERA de rango es error
 * (no se actualiza sola: es decision del admin).
 */
export function planInstall(targetId: string, catalog: ReadonlyMap<string, CatalogEntry>, installed: readonly InstalledExtension[], opts: { targetFrom?: "catalog" | "installed" } = {}): InstallPlan {
    const inst = new Map(installed.map((e) => [e.id, e]));
    const plan: InstallPlan = { ok: true, order: [], dependencies: [], errors: [] };
    const done = new Set<string>();
    const path: string[] = [];
    const visit = (id: string, range: string | null): void => {
        if (path.includes(id)) { plan.errors.push({ dependency: id, range: range ?? "*", reason: "cycle", detail: [...path, id].join(" -> ") }); return; }
        if (done.has(id)) return;
        const have = inst.get(id);
        const entry = catalog.get(id);
        const isTarget = id === targetId;
        if (!isTarget && range !== null) {
            if (have && have.active && versionSatisfies(range, have.version)) { done.add(id); return; }
            if (have && !versionSatisfies(range, have.version)) { plan.errors.push({ dependency: id, range, reason: "installed-incompatible", detail: have.version }); return; }
            if (!entry) { plan.errors.push({ dependency: id, range, reason: "not-in-catalog" }); return; }
            if (!versionSatisfies(range, entry.version)) { plan.errors.push({ dependency: id, range, reason: "incompatible-catalog", detail: entry.version }); return; }
        } else if (!entry && !have) { plan.errors.push({ dependency: id, range: "*", reason: "not-in-catalog" }); return; }
        path.push(id);
        // Dependencias a recorrer: para dependencias, la version INSTALADA; para la pedida, la del catalogo (instalar/actualizar) o la instalada (reactivar).
        const useInstalled = have && (!isTarget || opts.targetFrom === "installed" || !entry);
        const deps = useInstalled ? have!.dependencies : entry!.dependencies;
        for (const [dep, r] of Object.entries(deps)) visit(dep, r);
        path.pop();
        done.add(id);
        if (!plan.order.includes(id)) plan.order.push(id);
        if (!isTarget) plan.dependencies.push({ id, version: have?.version ?? entry?.version ?? "0.0.0", range: range ?? "*", action: have ? "activate" : "install" });
    };
    visit(targetId, null);
    plan.ok = plan.errors.length === 0;
    return plan;
}

/** Errores de publicacion de una extension: formato y ciclos. `allDeps` = id -> dependencias de las demas extensiones publicadas. */
export function validatePublishedDependencies(id: string, deps: Record<string, string>, allDeps: Record<string, Record<string, string>>): string[] {
    const errors: string[] = [];
    for (const [dep, range] of Object.entries(deps)) {
        if (!DEP_EXTENSION_ID_RE.test(dep)) errors.push(`Dependencia con id invalido: ${dep}`);
        if (!parseVersionRange(range)) errors.push(`Rango invalido para ${dep}: ${range}`);
        if (dep === id) errors.push("Una extension no puede depender de si misma");
    }
    const cycle = findDependencyCycle({ ...allDeps, [id]: deps });
    if (cycle) errors.push(`Ciclo de dependencias: ${cycle.join(" -> ")}`);
    return errors;
}
