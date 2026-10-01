import { pageAuthOf } from './route-schema';

/**
 * Acceso a una pagina de extension (mount PAGE / CUSTOM_ROUTE) segun su `auth` (por defecto `session`, falla cerrado):
 *  - session: usuario con sesion (el middleware ya la exige en /extensions/**);
 *  - admin:   sesion de administrador con permission_level >= minLevel (misma guardia que /api/admin: MFA y sesion privilegiada);
 *  - none:    publica; SOLO se sirve en /p/<path> (sin sesion, sin datos de usuario) y exige PUBLIC_ROUTE aprobado por el admin del dominio.
 * Funcion PURA (la usan el endpoint de acceso y los tests).
 */
export type PageAccess = 'allow' | 'login' | 'forbidden' | 'not_found';

export interface PageWho {
    signedIn: boolean;
    /** Nivel de admin efectivo (1..4) o null. */
    level: number | null;
}

export function evaluatePageAccess(
    mount: { auth?: unknown; minLevel?: unknown } | null | undefined,
    who: PageWho,
    ctx: { publicRoute: boolean; where: 'app' | 'public'; publicApproved: boolean },
): PageAccess {
    if (!mount) return 'not_found';
    const auth = pageAuthOf(mount);
    if (auth === 'none') {
        // Una pagina publica solo existe en /p/**, con PUBLIC_ROUTE declarado Y aprobado por el admin del dominio.
        return ctx.where === 'public' && ctx.publicRoute && ctx.publicApproved ? 'allow' : 'not_found';
    }
    if (ctx.where === 'public') return 'not_found'; // /p/** nunca sirve paginas con sesion
    if (!who.signedIn) return 'login';
    if (auth === 'session') return 'allow';
    const min = Number.isInteger(mount.minLevel) ? (mount.minLevel as number) : 1;
    return who.level !== null && who.level >= min ? 'allow' : 'forbidden';
}

// ---------------------------------------------------------------------------------------------------------------
// auth: "admin" aplicado EN EL SERVIDOR (no solo ocultar la pagina)
// ---------------------------------------------------------------------------------------------------------------

type AnyTemplate = { mounts?: unknown; api?: { functions?: Record<string, { handler?: unknown }> }; state?: unknown } & Record<string, unknown>;
const isAdminPageMount = (m: any): boolean => !!m && typeof m === 'object' && ['PAGE', 'CUSTOM_ROUTE'].includes(String(m.point)) && pageAuthOf(m) === 'admin';
const mountMinLevel = (m: any): number => (Number.isInteger(m?.minLevel) ? (m.minLevel as number) : 1);

/** Todos los valores string bajo la clave `function` de un arbol de UI (acciones `call`). */
function collectFunctionRefs(node: unknown, out: Set<string>, depth = 0): void {
    if (depth > 40 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) collectFunctionRefs(n, out, depth + 1); return; }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === 'function' && typeof v === 'string') out.add(v);
        else collectFunctionRefs(v, out, depth + 1);
    }
}

/**
 * Acciones (claves de `api.functions` y sus handlers) invocadas desde paginas/mounts `auth: "admin"` => nivel minimo exigido.
 * Una accion usada tambien por una pagina normal queda igualmente protegida (el minimo mas alto manda: falla cerrado).
 */
export function adminProtectedActions(template: AnyTemplate | null | undefined): Map<string, number> {
    const out = new Map<string, number>();
    const mounts = Array.isArray(template?.mounts) ? (template!.mounts as unknown[]) : [];
    const fns = template?.api?.functions && typeof template.api.functions === 'object' ? template.api.functions : {};
    for (const m of mounts) {
        if (!isAdminPageMount(m)) continue;
        const refs = new Set<string>();
        collectFunctionRefs(m, refs);
        for (const name of refs) {
            const level = mountMinLevel(m);
            out.set(name, Math.max(out.get(name) ?? 0, level));
            const handler = fns[name]?.handler;
            if (typeof handler === 'string') out.set(handler, Math.max(out.get(handler) ?? 0, level));
        }
    }
    return out;
}

/** true si el usuario puede invocar `action` (null/undefined = no esta restringida). */
export function mayInvokeAction(protectedActions: Map<string, number>, action: unknown, level: number | null): boolean {
    if (typeof action !== 'string') return true;
    const min = protectedActions.get(action);
    return min === undefined || (level !== null && level >= min);
}

/**
 * Quita de la configuracion que recibe el navegador los mounts de pagina `admin` que ese usuario NO puede ver (arbol de componentes incluido)
 * y, si ya no queda ningun mount con componente, tambien el `state` inicial de la plantilla. `templates` puede venir como objeto o string JSON.
 */
export function stripAdminMounts<T extends { template?: unknown }>(extensions: T[], level: number | null): T[] {
    return extensions.map((ext) => {
        let template: any = ext.template;
        const wasString = typeof template === 'string';
        if (wasString) { try { template = JSON.parse(template); } catch { return ext; } }
        if (!template || typeof template !== 'object' || !Array.isArray(template.mounts)) return ext;
        const kept = template.mounts.filter((m: any) => !isAdminPageMount(m) || (level !== null && level >= mountMinLevel(m)));
        if (kept.length === template.mounts.length) return ext;
        const next = { ...template, mounts: kept };
        if (!kept.some((m: any) => m && typeof m === 'object' && m.component !== undefined)) delete next.state;
        return { ...ext, template: wasString ? JSON.stringify(next) : next };
    });
}
