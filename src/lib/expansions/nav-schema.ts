/**
 * Entradas de NAVEGACION de una extension (`navEntries`): esquema, validacion del manifest y utilidades puras para filtrarlas.
 * Puro, sin dependencias de runtime.
 *
 * FUENTE CANONICA: bloomx-extensions/_shared/nav-schema.ts
 * Copias identicas (verificadas por tests/nav-schema.test.mjs):
 *   - bloomx-backend/src/lib/extensions/nav-schema.ts   (validacion al publicar)
 *   - bloomx/src/lib/expansions/nav-schema.ts           (validacion al cargar + barra lateral, menu movil, consola de admin)
 *
 * Una entrada pone un enlace en la barra lateral del correo (secciones `main`, `workspace`, `tools`) o en el menu de la consola de administracion
 * (`admin`) que lleva a una PAGINA de la propia extension (mount `PAGE`, servida en `/extensions/<path>`).
 *
 *   {
 *     "id": "metricas",                      // unico dentro de la extension
 *     "section": "workspace",                // main | workspace | tools | admin
 *     "label": { "es": "Metricas", "en": "Metrics" },
 *     "icon": "ChartColumn",                 // Lucide, lucide:<Nombre>, brand:<slug> o initials:<XY>
 *     "order": 50,                           // menor primero (por defecto 100)
 *     "target": "page:metricas",             // page:<path del mount PAGE> o /extensions/<path>
 *     "badge": { "route": "/badge", "refreshSeconds": 120 },   // ruta GET de la extension que devuelve un numero
 *     "minLevel": 1, "auth": "admin",        // por defecto los de la pagina destino (section admin => admin)
 *     "mobile": true                         // false = no aparece en el menu movil
 *   }
 *
 * SEGURIDAD (falla cerrado): ocultar la entrada NO es el control. La pagina destino conserva su propio `auth`/`minLevel` (se comprueba en el servidor
 * en /api/expansions/page-access) y la config que recibe el navegador ya no trae las entradas/paginas `admin` que el nivel del usuario no alcanza. Por
 * eso una entrada debe ser tan restrictiva como su pagina: la validacion rechaza una entrada visible para quien la pagina rechazaria.
 */

import { isI18nText, isIconRef } from "./ui-schema.ts";
import { pageAuthOf, routeAuthOf, routeMethods } from "./route-schema.ts";

export const NAV_SECTIONS = ["main", "workspace", "tools", "admin"] as const;
export type NavSection = (typeof NAV_SECTIONS)[number];
export const NAV_CAPABILITY = "nav.entries.v1";

export const NAV_LIMITS = {
    maxEntries: 12,
    maxLabel: 40,
    maxOrder: 1000,
    defaultOrder: 100,
    minRefreshSeconds: 30,
    maxRefreshSeconds: 3600,
    defaultRefreshSeconds: 120,
    /** Tope del numero que se muestra en la insignia (999 => "999+"). */
    maxBadge: 999,
} as const;

export type NavBadge = { route: string; refreshSeconds?: number };
export type NavEntry = {
    id: string;
    section: NavSection;
    label: string | Record<string, string>;
    icon?: string;
    order?: number;
    target: string;
    badge?: NavBadge;
    auth?: "session" | "admin";
    minLevel?: number;
    mobile?: boolean;
};

export const NAV_ENTRY_KEYS = ["id", "section", "label", "icon", "order", "target", "badge", "auth", "minLevel", "mobile"];

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PAGE_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}(?:\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}){0,3}$/;
const LEGACY_ICON_RE = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f<>]/;
const ROUTE_RE = /^\/[A-Za-z0-9._~-]{1,64}(?:\/[A-Za-z0-9._~-]{1,64}){0,5}$/;

function isObject(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Sink = (path: string, message: string) => void;

/** `page:<path>` o `/extensions/<path>` -> path de la pagina; null si el destino no es valido. */
export function navTargetPagePath(target: unknown): string | null {
    if (typeof target !== "string") return null;
    const t = target.trim();
    const path = t.startsWith("page:") ? t.slice(5) : t.startsWith("/extensions/") ? t.slice("/extensions/".length) : null;
    return path !== null && PAGE_PATH_RE.test(path) ? path : null;
}

/** URL final de la pagina destino (`/extensions/<path>`); null si el destino es invalido. */
export function navEntryHref(target: unknown): string | null {
    const path = navTargetPagePath(target);
    return path === null ? null : `/extensions/${path}`;
}

function labelProblem(label: unknown): string | null {
    const text = (v: unknown) => typeof v === "string" && v.trim().length >= 1 && v.length <= NAV_LIMITS.maxLabel && !CONTROL_RE.test(v);
    if (typeof label === "string") return text(label) ? null : `Texto de 1 a ${NAV_LIMITS.maxLabel} caracteres, sin HTML ni saltos de linea`;
    if (isI18nText(label)) return Object.values(label).every(text) ? null : `Cada idioma: texto de 1 a ${NAV_LIMITS.maxLabel} caracteres, sin HTML ni saltos de linea`;
    return "Debe ser un texto o un objeto por idioma { es, en }";
}

export type NavValidationContext = {
    /** mounts del manifest (para resolver el destino y heredar auth/minLevel). */
    mounts: readonly unknown[];
    /** backendRoutes del manifest (para la ruta de la insignia). */
    routes: readonly unknown[];
    capabilities: readonly string[];
};

/** Valida `navEntries` de un manifest. */
export function validateNavEntries(raw: unknown, err: Sink, warn: Sink, ctx: NavValidationContext): void {
    if (raw === undefined) return;
    if (!Array.isArray(raw)) return err("navEntries", "Debe ser un arreglo");
    if (raw.length > NAV_LIMITS.maxEntries) err("navEntries", `Maximo ${NAV_LIMITS.maxEntries} entradas`);
    if (raw.length > 0 && !ctx.capabilities.includes(NAV_CAPABILITY)) err("requires.capabilities", `navEntries exige declarar la capacidad ${NAV_CAPABILITY}`);
    const pages = new Map<string, Record<string, any>>();
    for (const m of ctx.mounts) if (isObject(m) && m.point === "PAGE" && typeof m.path === "string") pages.set(m.path, m);
    const seen = new Set<string>();

    raw.slice(0, NAV_LIMITS.maxEntries + 1).forEach((r: unknown, index: number) => {
        const at = `navEntries[${index}]`;
        if (!isObject(r)) return err(at, "Debe ser un objeto");
        for (const key of Object.keys(r)) if (!NAV_ENTRY_KEYS.includes(key)) err(`${at}.${key}`, `Clave desconocida (permitidas: ${NAV_ENTRY_KEYS.join(", ")})`);

        if (typeof r.id !== "string" || !ID_RE.test(r.id)) err(`${at}.id`, "Requerido: [a-z0-9-] (max 40), empezando por letra o numero");
        else if (seen.has(r.id)) err(`${at}.id`, `Entrada duplicada: ${r.id}`);
        else seen.add(r.id);

        if (typeof r.section !== "string" || !(NAV_SECTIONS as readonly string[]).includes(r.section)) err(`${at}.section`, `Debe ser uno de ${NAV_SECTIONS.join(", ")}`);
        const problem = r.label === undefined ? "Requerido" : labelProblem(r.label);
        if (problem) err(`${at}.label`, problem);
        if (r.icon !== undefined && !(typeof r.icon === "string" && (isIconRef(r.icon) || LEGACY_ICON_RE.test(r.icon)))) err(`${at}.icon`, 'Debe ser un nombre Lucide, "lucide:<Nombre>", "brand:<slug>" o "initials:<XY>"');
        if (r.order !== undefined && (!Number.isInteger(r.order) || r.order < 0 || r.order > NAV_LIMITS.maxOrder)) err(`${at}.order`, `Entero 0..${NAV_LIMITS.maxOrder}`);
        if (r.mobile !== undefined && typeof r.mobile !== "boolean") err(`${at}.mobile`, "Debe ser true o false");

        // ---- destino: una pagina (mount PAGE) de esta misma extension ----
        const pagePath = navTargetPagePath(r.target);
        let page: Record<string, any> | undefined;
        if (r.target === undefined) err(`${at}.target`, 'Requerido: "page:<path>" (path de un mount PAGE de esta extension)');
        else if (pagePath === null) err(`${at}.target`, 'Debe ser "page:<path>" o "/extensions/<path>" (path de un mount PAGE: letras, numeros, _ y -, hasta 4 segmentos)');
        else {
            page = pages.get(pagePath);
            if (!page) err(`${at}.target`, `La extension no declara un mount PAGE con path "${pagePath}"`);
        }

        // ---- auth / minLevel: tan restrictivas como la pagina (falla cerrado) ----
        if (r.auth !== undefined && r.auth !== "session" && r.auth !== "admin") err(`${at}.auth`, 'Debe ser "session" o "admin" (las entradas no usan "none")');
        const pageAuth = page ? pageAuthOf(page) : null;
        if (pageAuth === "none") err(`${at}.target`, "Las paginas publicas (auth: none) viven en /p/** y no pueden estar en la navegacion");
        const wantsAdmin = r.section === "admin" || r.auth === "admin" || pageAuth === "admin";
        if (r.section === "admin" && r.auth === "session") err(`${at}.auth`, 'Las entradas de la seccion "admin" exigen auth: "admin"');
        if (r.minLevel !== undefined) {
            if (!wantsAdmin && r.auth !== "admin") err(`${at}.minLevel`, 'Solo con auth: "admin" (o seccion "admin")');
            else if (!Number.isInteger(r.minLevel) || r.minLevel < 1 || r.minLevel > 4) err(`${at}.minLevel`, "Entero 1..4");
        }
        if (page && pageAuth && pageAuth !== "none") {
            if (wantsAdmin && pageAuth !== "admin") err(`${at}.target`, `La entrada es de administracion pero la pagina "${pagePath}" no declara auth: "admin": cualquiera podria abrirla`);
            if (pageAuth === "admin" && r.auth === "session") err(`${at}.auth`, `La pagina "${pagePath}" exige auth: "admin": la entrada no puede ser "session"`);
            if (pageAuth === "admin") {
                const pageMin = Number.isInteger(page.minLevel) ? (page.minLevel as number) : 1;
                const entryMin = Number.isInteger(r.minLevel) ? (r.minLevel as number) : pageMin;
                if (entryMin < pageMin) err(`${at}.minLevel`, `La pagina "${pagePath}" exige minLevel ${pageMin}: la entrada se mostraria a niveles que la pagina rechaza`);
            }
        }

        // ---- insignia: ruta GET de la extension que devuelve un numero ----
        if (r.badge !== undefined) {
            if (!isObject(r.badge)) return err(`${at}.badge`, "Debe ser un objeto { route, refreshSeconds? }");
            for (const key of Object.keys(r.badge)) if (key !== "route" && key !== "refreshSeconds") err(`${at}.badge.${key}`, "Clave desconocida (route, refreshSeconds)");
            const route = r.badge.route;
            if (typeof route !== "string" || !ROUTE_RE.test(route)) err(`${at}.badge.route`, "Requerido: ruta de la extension sin parametros (p. ej. /badge)");
            else {
                const def = ctx.routes.find((x) => isObject(x) && x.path === route);
                if (!def) err(`${at}.badge.route`, `La extension no declara la ruta ${route} en backendRoutes`);
                else {
                    if (!routeMethods(def as Record<string, unknown>).includes("GET")) err(`${at}.badge.route`, "La ruta de la insignia debe admitir GET");
                    const routeAuth = routeAuthOf(def as Record<string, unknown>);
                    if (routeAuth !== "session" && routeAuth !== "admin") err(`${at}.badge.route`, "La ruta de la insignia debe usar auth: session o admin (la llama el navegador con la sesion del usuario)");
                    else if (wantsAdmin && routeAuth !== "admin") err(`${at}.badge.route`, "Una entrada de administracion necesita una ruta de insignia con auth: admin");
                    else if (routeAuth === "admin") {
                        const routeMin = Number.isInteger((def as any).minLevel) ? ((def as any).minLevel as number) : 1;
                        const entryMin = Number.isInteger(r.minLevel) ? (r.minLevel as number) : (page && Number.isInteger(page.minLevel) ? (page.minLevel as number) : 1);
                        if (routeMin > entryMin) warn(`${at}.badge.route`, `La ruta exige minLevel ${routeMin} y la entrada se muestra desde ${entryMin}: la insignia no aparecera para los niveles intermedios`);
                    }
                }
            }
            if (r.badge.refreshSeconds !== undefined && (!Number.isInteger(r.badge.refreshSeconds) || r.badge.refreshSeconds < NAV_LIMITS.minRefreshSeconds || r.badge.refreshSeconds > NAV_LIMITS.maxRefreshSeconds)) {
                err(`${at}.badge.refreshSeconds`, `Entero ${NAV_LIMITS.minRefreshSeconds}..${NAV_LIMITS.maxRefreshSeconds} (el refresco esta acotado)`);
            }
        }
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Lectura tolerante y filtrado (frontend)
// ---------------------------------------------------------------------------------------------------------------

export type NormalizedNavEntry = {
    id: string;
    section: NavSection;
    label: string | Record<string, string>;
    icon: string | null;
    order: number;
    href: string;
    /** Path del mount PAGE destino. */
    pagePath: string;
    auth: "session" | "admin";
    /** Nivel minimo de administrador (1..4); 0 si la entrada es para cualquier usuario con sesion. */
    minLevel: number;
    mobile: boolean;
    badge: { route: string; refreshSeconds: number } | null;
};

/**
 * Entradas validas de un manifest con los valores por defecto aplicados (auth/minLevel heredados de la pagina; seccion admin => admin). Las invalidas se
 * DESCARTAN (carga tolerante: una entrada mala no apaga la extension). Orden estable: order, luego orden de declaracion.
 */
export function readNavEntries(manifest: unknown): NormalizedNavEntry[] {
    const m = isObject(manifest) ? manifest : {};
    if (!Array.isArray(m.navEntries)) return [];
    const caps: unknown[] = isObject(m.requires) && Array.isArray(m.requires.capabilities) ? m.requires.capabilities : [];
    if (!caps.includes(NAV_CAPABILITY)) return [];
    const mounts: unknown[] = Array.isArray(m.mounts) ? m.mounts : [];
    const routes: unknown[] = Array.isArray(m.backendRoutes) ? m.backendRoutes : [];
    const out: Array<NormalizedNavEntry & { seq: number }> = [];
    const seen = new Set<string>();
    m.navEntries.slice(0, NAV_LIMITS.maxEntries).forEach((r: unknown, seq: number) => {
        if (!isObject(r) || typeof r.id !== "string" || !ID_RE.test(r.id) || seen.has(r.id)) return;
        if (typeof r.section !== "string" || !(NAV_SECTIONS as readonly string[]).includes(r.section)) return;
        if (labelProblem(r.label)) return;
        const pagePath = navTargetPagePath(r.target);
        if (pagePath === null) return;
        const page = mounts.find((x) => isObject(x) && x.point === "PAGE" && x.path === pagePath) as Record<string, any> | undefined;
        if (!page) return;
        const pageAuth = pageAuthOf(page);
        if (pageAuth === "none") return;
        const admin = r.section === "admin" || r.auth === "admin" || pageAuth === "admin";
        // Falla cerrado: lo que se muestra a menos gente que la pagina esta bien; a mas gente, no.
        if (admin && pageAuth !== "admin") return;
        const pageMin = pageAuth === "admin" ? (Number.isInteger(page.minLevel) ? (page.minLevel as number) : 1) : 0;
        const entryMin = admin ? Math.max(pageMin, Number.isInteger(r.minLevel) && r.minLevel >= 1 && r.minLevel <= 4 ? (r.minLevel as number) : 1) : 0;
        let badge: NormalizedNavEntry["badge"] = null;
        if (isObject(r.badge) && typeof r.badge.route === "string" && ROUTE_RE.test(r.badge.route) && routes.some((x) => isObject(x) && x.path === r.badge.route)) {
            const refresh = Number.isInteger(r.badge.refreshSeconds) ? Math.min(NAV_LIMITS.maxRefreshSeconds, Math.max(NAV_LIMITS.minRefreshSeconds, r.badge.refreshSeconds as number)) : NAV_LIMITS.defaultRefreshSeconds;
            badge = { route: r.badge.route, refreshSeconds: refresh };
        }
        seen.add(r.id);
        out.push({
            id: r.id,
            section: r.section as NavSection,
            label: r.label as string | Record<string, string>,
            icon: typeof r.icon === "string" && (isIconRef(r.icon) || LEGACY_ICON_RE.test(r.icon)) ? r.icon : null,
            order: Number.isInteger(r.order) && r.order >= 0 && r.order <= NAV_LIMITS.maxOrder ? (r.order as number) : NAV_LIMITS.defaultOrder,
            href: `/extensions/${pagePath}`,
            pagePath,
            auth: admin ? "admin" : "session",
            minLevel: entryMin,
            mobile: r.mobile !== false,
            badge,
            seq,
        });
    });
    return out.sort((a, b) => a.order - b.order || a.seq - b.seq).map(({ seq: _seq, ...entry }) => entry);
}

/** true si un usuario ve la entrada: `admin` exige sesion de administrador con nivel >= minLevel. `level` null = no es administrador. */
export function navEntryVisible(entry: Pick<NormalizedNavEntry, "auth" | "minLevel">, who: { signedIn: boolean; level: number | null }): boolean {
    if (!who.signedIn) return false;
    if (entry.auth !== "admin") return true;
    return who.level !== null && who.level >= Math.max(1, entry.minLevel);
}

/** Texto de la etiqueta en `lang` (exacto, base, en, es, primero). */
export function navLabel(label: string | Record<string, string>, lang: string): string {
    if (typeof label === "string") return label;
    const wanted = String(lang || "").toLowerCase();
    const base = wanted.split("-")[0];
    const byLower: Record<string, string> = {};
    for (const key of Object.keys(label)) byLower[key.toLowerCase()] = label[key];
    const hit = [wanted, base, "en", "es"].find((c) => c && typeof byLower[c] === "string");
    return hit ? byLower[hit] : label[Object.keys(label)[0]] ?? "";
}

/**
 * Quita de un manifest las entradas de administracion que `level` no alcanza (defensa en el SERVIDOR: el navegador no las recibe).
 * Devuelve el mismo objeto si no hay nada que quitar. Sin lanzar.
 */
export function stripAdminNavEntries<T extends Record<string, any>>(manifest: T, level: number | null): T {
    if (!isObject(manifest) || !Array.isArray(manifest.navEntries)) return manifest;
    const mounts: unknown[] = Array.isArray(manifest.mounts) ? manifest.mounts : [];
    const kept = manifest.navEntries.filter((e: unknown) => {
        if (!isObject(e)) return false;
        const pagePath = navTargetPagePath(e.target);
        const page = pagePath === null ? undefined : (mounts.find((x) => isObject(x) && x.point === "PAGE" && x.path === pagePath) as Record<string, any> | undefined);
        const admin = e.section === "admin" || e.auth === "admin" || (page ? pageAuthOf(page) === "admin" : false);
        if (!admin) return true;
        const pageMin = page && Number.isInteger(page.minLevel) ? (page.minLevel as number) : 1;
        const min = Math.max(pageMin, Number.isInteger(e.minLevel) ? (e.minLevel as number) : 1);
        return level !== null && level >= min;
    });
    return kept.length === manifest.navEntries.length ? manifest : { ...manifest, navEntries: kept };
}
