/**
 * Schema y normalizador de manifests de extensiones BloomX (sin dependencias).
 *
 * FUENTE CANONICA: bloomx-extensions/_shared/manifest-schema.ts
 * Copias identicas (verificadas por tests/contract.test.mjs):
 *   - bloomx-backend/src/lib/extensions/manifest-schema.ts   (repositorio, admin POST)
 *   - bloomx/src/lib/expansions/manifest-schema.ts           (carga en el frontend)
 *
 * Solo usa sintaxis TypeScript "borrable" (sin enums ni parametros de constructor) para poder ejecutarse con
 * `node --experimental-strip-types`. No importar nada aqui.
 *
 * Politica:
 *  - `errors`: el manifest NO se debe cargar/publicar.
 *  - `warnings`: se carga, pero conviene corregirlo (vocabulario desconocido, version de manifest desconocida).
 */

export type ManifestIssue = { path: string; message: string };
export type ManifestValidation = { ok: boolean; errors: ManifestIssue[]; warnings: ManifestIssue[] };

export const SUPPORTED_MANIFEST_VERSIONS = ["1.0", "2.0"];
export const AUTH_TYPES = ["NONE", "OAUTH2", "API_KEY", "WEBHOOK_SECRET", "BASIC_AUTH"];

/** Puntos de montaje consumidos (o reservados) por el frontend. */
export const KNOWN_MOUNT_POINTS = [
    "EMAIL_TOOLBAR", "EMAIL_FOOTER", "EMAIL_HEADER",
    "SIDEBAR_HEADER", "SIDEBAR_FOOTER",
    "COMPOSER_TOOLBAR", "COMPOSER_INIT",
    "EVENT_LOCATION_BUILDER",
    "CALENDAR_HEADER", "CALENDAR_SIDEBAR", "CALENDAR_SIDEBAR_BOTTOM", "CALENDAR_ADD_SOURCES",
    "CONTACTS_HEADER", "CONTACTS_SIDEBAR", "CONTACTS_SIDEBAR_BOTTOM",
    "SETTINGS_TAB", "CUSTOM_SETTINGS_TAB", "CUSTOM_ROUTE", "PAGE", "OVERLAY", "SLASH_COMMAND",
    "BEFORE_SEND_HANDLER", "ON_BODY_CHANGE_HANDLER", "ON_SUBJECT_CHANGE_HANDLER", "ON_RECIPIENTS_CHANGE_HANDLER",
];

/** Eventos de servidor que ejecuta /api/extension/hooks. */
export const INTERCEPT_POINTS = ["EMAIL_PRE_SEND", "EMAIL_RECEIVED", "CRON"];
export const INTERCEPT_PRIORITIES = ["HIGH", "NORMAL", "LOW", "MONITOR"];
export const CRON_SCHEDULES = ["hourly", "daily"];

/** Componentes que implementa JsonRenderer. */
export const KNOWN_COMPONENT_TYPES = [
    "BUTTON", "TEXT", "INPUT", "CARD", "ROW", "COLUMN", "CONDITIONAL", "LINK", "TABS", "MODAL", "HEADLESS",
    "WIZARD", "SELECT", "FORM", "LIST", "IMAGE_BUTTON", "FOR_EACH", "SWITCH", "CHECKBOX", "TOGGLE", "TEXTAREA",
    "BADGE", "DIVIDER", "SPACER", "PROGRESS", "SMART_REPLY_CHIPS", "LOADING", "ALERT", "ICON", "ACCORDION",
    "GRID", "DATA_TABLE", "MARKDOWN", "FILE_UPLOAD", "BLOCK", "REPEAT", "DEBUG", "CONDITION", "CASE", "DEFAULT",
    "SET_VAR", "DATE_PICKER", "SLIDER", "AVATAR", "TOOLTIP", "EMPTY_STATE", "IFRAME", "CODE_EDITOR",
    "ACCORDION_ITEM", "TAB_ITEM", "CODE_BLOCK", "FLEX", "BOX", "SEPARATOR",
];

/** Acciones que implementa JsonRenderer. */
export const KNOWN_ACTIONS = [
    "SET_STATE", "MERGE_STATE", "MAP_ARRAY", "FILTER_ARRAY", "SET_LOADING",
    "OPEN_OVERLAY", "CLOSE_OVERLAY", "OPEN_URL", "NAVIGATE", "REFRESH", "DELAY", "CONFIRM",
    "CALL_BACKEND", "CALL_API", "TOAST", "COPY_TO_CLIPBOARD",
    "INSERT_CONTENT", "APPEND_BODY", "SET_SUBJECT", "ADD_ATTACHMENT", "SET_CONTEXT_VALUE",
    "NEXT_STEP", "PREV_STEP",
    "SECURE_SAVE", "SECURE_READ",
    "OAUTH_CONNECT", "OAUTH_DISCONNECT",
];

const KNOWN_PERMISSIONS = [
    "READ_EMAIL", "READ_USER", "READ_USER_NAME", "AI_GENERATE", "HTTP_REQUEST", "OAUTH_READ", "OAUTH_WRITE",
    "API_ROUTE_CREATE", "PAGE_ROUTE_CREATE", "DB_READ", "DB_WRITE", "local:secure-storage",
];

/**
 * Variables de plataforma que ninguna extension puede pedir con ENV_READ:* (el runtime las deniega tambien).
 * Un manifest es dato controlado por quien sube la extension.
 */
export const RESERVED_ENV_RE = /^(DATABASE_URL|DIRECT_URL|SHADOW_DATABASE_URL|POSTGRES_.*|PG.*|B2_.*|ADMIN_.*|MP_.*|NEXTAUTH_.*|AUTH_.*|DATA_ENCRYPTION_KEY|AI_.*|OPENAI_.*|RESEND_.*|VERCEL.*|NEXT_.*|NODE_.*|EXTENSION_.*|INTERNAL_.*|JWT_.*|SESSION_.*|AWS_.*|GITHUB_.*|NPM_.*|PATH|HOME|USER.*)$/i;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]{1,40})?$/;
const HANDLER_RE = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
const ENV_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const COMPONENT_TYPE_RE = /^[A-Z][A-Z0-9_]*$/;
const MAX_DEPTH = 40;

function isObject(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------------------------------------------
// Normalizacion de formas heredadas
// ---------------------------------------------------------------------------------------------------------------

/**
 * Convierte las formas heredadas de un mount a `component: {type, props, children}`:
 *  - `component: "MODAL"` + `props` a nivel de mount (mail-groups, signature, sealer).
 *  - `COMPOSER_INIT` con `config.action = APPEND_BODY` + `config.storageKey` (firma) => componente HEADLESS.
 * Devuelve el mismo objeto si no requiere cambios.
 */
export function normalizeMount(mount: any): any {
    if (!isObject(mount)) return mount;

    if (typeof mount.component === "string") {
        const { children, ...props } = isObject(mount.props) ? mount.props : ({} as Record<string, any>);
        const { props: _omit, ...rest } = mount;
        return { ...rest, component: { type: mount.component, props, ...(Array.isArray(children) ? { children } : {}) } };
    }

    if (isObject(mount.component)) return mount;

    if (
        mount.point === "COMPOSER_INIT" &&
        isObject(mount.config) &&
        mount.config.action === "APPEND_BODY" &&
        typeof mount.config.storageKey === "string"
    ) {
        return {
            ...mount,
            component: {
                type: "HEADLESS",
                props: {
                    onLoad: {
                        action: "SECURE_READ",
                        key: mount.config.storageKey,
                        onSuccess: { action: "APPEND_BODY", content: "${value}" },
                    },
                },
            },
        };
    }

    return mount;
}

// ---------------------------------------------------------------------------------------------------------------
// Validacion
// ---------------------------------------------------------------------------------------------------------------

export function validateManifest(input: unknown): ManifestValidation {
    const errors: ManifestIssue[] = [];
    const warnings: ManifestIssue[] = [];
    const err = (path: string, message: string) => { errors.push({ path, message }); };
    const warn = (path: string, message: string) => { warnings.push({ path, message }); };

    if (!isObject(input)) {
        err("$", "El manifest debe ser un objeto JSON");
        return { ok: false, errors, warnings };
    }
    const m = input;

    // --- Identidad ---------------------------------------------------------------------------------------------
    if (typeof m.id !== "string" || !ID_RE.test(m.id)) err("id", "Requerido: string [A-Za-z0-9._:-] (max 100)");
    if (typeof m.name !== "string" || !m.name.trim() || m.name.length > 120) err("name", "Requerido: string no vacio (max 120)");
    if (typeof m.version !== "string" || !VERSION_RE.test(m.version)) err("version", "Requerido: semver (p.ej. 1.0.0)");
    if (m.description !== undefined && (typeof m.description !== "string" || m.description.length > 2000)) {
        err("description", "Debe ser string (max 2000)");
    }
    if (m.manifestVersion !== undefined && !SUPPORTED_MANIFEST_VERSIONS.includes(String(m.manifestVersion))) {
        warn("manifestVersion", `Version desconocida; soportadas: ${SUPPORTED_MANIFEST_VERSIONS.join(", ")}`);
    }
    if (m.status !== undefined && m.status !== "active" && m.status !== "disabled") {
        err("status", 'Debe ser "active" o "disabled"');
    }

    // --- Permisos ----------------------------------------------------------------------------------------------
    if (m.permissions !== undefined) {
        if (!Array.isArray(m.permissions)) {
            err("permissions", "Debe ser un arreglo de strings");
        } else {
            m.permissions.forEach((permission: unknown, index: number) => {
                const at = `permissions[${index}]`;
                if (typeof permission !== "string") return err(at, "Debe ser string");
                if (permission.startsWith("ENV_READ:")) {
                    const key = permission.slice("ENV_READ:".length).trim();
                    if (!ENV_RE.test(key)) return err(at, "ENV_READ requiere un nombre de variable en MAYUSCULAS");
                    if (RESERVED_ENV_RE.test(key)) return err(at, `ENV_READ:${key} esta reservada por la plataforma`);
                    return;
                }
                if (!KNOWN_PERMISSIONS.includes(permission)) warn(at, `Permiso desconocido: ${permission}`);
            });
        }
    }

    // --- Auth --------------------------------------------------------------------------------------------------
    if (m.auth !== undefined) {
        if (!isObject(m.auth)) {
            err("auth", "Debe ser un objeto");
        } else if (m.auth.type !== undefined && !AUTH_TYPES.includes(String(m.auth.type).toUpperCase())) {
            err("auth.type", `Debe ser uno de ${AUTH_TYPES.join(", ")}`);
        }
    }

    // --- API / funciones ---------------------------------------------------------------------------------------
    const functionNames = new Set<string>();
    let hasApi = false;
    if (m.api !== undefined) {
        if (!isObject(m.api)) {
            err("api", "Debe ser un objeto");
        } else {
            hasApi = true;
            if (m.api.runtime !== undefined && m.api.runtime !== "nodejs") err("api.runtime", 'Solo se soporta "nodejs"');
            if (m.api.entry !== undefined && (typeof m.api.entry !== "string" || !/^[\w./-]{1,100}$/.test(m.api.entry) || m.api.entry.includes(".."))) {
                err("api.entry", "Ruta relativa invalida");
            }
            if (m.api.functions !== undefined) {
                if (!isObject(m.api.functions)) {
                    err("api.functions", "Debe ser un objeto {nombre: {handler}}");
                } else {
                    for (const [name, def] of Object.entries(m.api.functions)) {
                        const at = `api.functions.${name}`;
                        if (!HANDLER_RE.test(name)) err(at, "Nombre de funcion invalido");
                        if (!isObject(def) || typeof def.handler !== "string" || !HANDLER_RE.test(def.handler)) {
                            err(`${at}.handler`, "Requerido: nombre de la funcion exportada por server.js");
                        }
                        if (isObject(def) && def.timeout !== undefined && (typeof def.timeout !== "number" || def.timeout < 100 || def.timeout > 60000)) {
                            err(`${at}.timeout`, "Debe ser un numero entre 100 y 60000 ms");
                        }
                        functionNames.add(name);
                    }
                }
            }
        }
    }

    const checkFunctionRef = (at: string, name: unknown) => {
        if (typeof name !== "string" || !name) return err(at, "Debe indicar el nombre de una funcion");
        if (!hasApi) return err(at, `"${name}" no existe: la extension no declara "api" (no tiene server.js)`);
        if (!functionNames.has(name)) err(at, `"${name}" no esta declarada en api.functions`);
    };

    // --- Recorrido de componentes / acciones -------------------------------------------------------------------
    const walk = (node: unknown, at: string, depth: number) => {
        if (depth > MAX_DEPTH) return err(at, "Anidamiento demasiado profundo");
        if (Array.isArray(node)) {
            node.forEach((item, index) => walk(item, `${at}[${index}]`, depth + 1));
            return;
        }
        if (!isObject(node)) return;

        if (typeof node.action === "string") {
            if (!KNOWN_ACTIONS.includes(node.action)) {
                err(`${at}.action`, `Accion desconocida: ${node.action}`);
            } else if (node.action === "CALL_BACKEND") {
                checkFunctionRef(`${at}.function`, node.function);
            }
        }

        if (typeof node.type === "string" && COMPONENT_TYPE_RE.test(node.type) && ("props" in node || "children" in node)) {
            if (!KNOWN_COMPONENT_TYPES.includes(node.type)) warn(`${at}.type`, `Componente desconocido: ${node.type}`);
        }

        for (const [key, value] of Object.entries(node)) {
            if (value !== null && typeof value === "object") walk(value, `${at}.${key}`, depth + 1);
        }
    };

    // --- Mounts ------------------------------------------------------------------------------------------------
    if (m.mounts !== undefined) {
        if (!Array.isArray(m.mounts)) {
            err("mounts", "Debe ser un arreglo");
        } else {
            m.mounts.forEach((raw: unknown, index: number) => {
                const at = `mounts[${index}]`;
                if (!isObject(raw)) return err(at, "Debe ser un objeto");
                if (typeof raw.point !== "string" || !raw.point) return err(`${at}.point`, "Requerido");
                if (!KNOWN_MOUNT_POINTS.includes(raw.point)) warn(`${at}.point`, `Punto de montaje desconocido: ${raw.point}`);

                const mount = normalizeMount(raw);
                if (mount.point === "OVERLAY" && (typeof mount.id !== "string" || !mount.id)) err(`${at}.id`, "Los OVERLAY requieren id");

                if (mount.component !== undefined) {
                    if (!isObject(mount.component) || typeof mount.component.type !== "string") {
                        err(`${at}.component`, "Debe ser un componente {type, props, children}");
                    } else {
                        walk(mount.component, `${at}.component`, 0);
                    }
                } else if (mount.handler === undefined && mount.point !== "COMPOSER_INIT") {
                    err(at, "Debe declarar 'component' o 'handler'");
                }

                if (mount.handler !== undefined) checkFunctionRef(`${at}.handler`, mount.handler);
                if (mount.priority !== undefined && typeof mount.priority !== "string" && typeof mount.priority !== "number") {
                    err(`${at}.priority`, "Debe ser string o numero");
                }
            });
        }
    }

    if (m.overlays !== undefined) {
        if (!isObject(m.overlays)) err("overlays", "Debe ser un objeto {id: componente}");
        else walk(m.overlays, "overlays", 0);
    }

    // --- Intercepts (hooks de servidor) ---------------------------------------------------------------------------
    if (m.intercepts !== undefined) {
        if (!Array.isArray(m.intercepts)) {
            err("intercepts", "Debe ser un arreglo");
        } else {
            m.intercepts.forEach((item: unknown, index: number) => {
                const at = `intercepts[${index}]`;
                if (!isObject(item)) return err(at, "Debe ser un objeto");
                if (typeof item.point !== "string" || !INTERCEPT_POINTS.includes(item.point)) {
                    err(`${at}.point`, `Debe ser uno de ${INTERCEPT_POINTS.join(", ")}`);
                }
                checkFunctionRef(`${at}.handler`, item.handler);
                if (item.priority !== undefined && !(typeof item.priority === "number" || INTERCEPT_PRIORITIES.includes(String(item.priority)))) {
                    err(`${at}.priority`, `Debe ser numero o ${INTERCEPT_PRIORITIES.join("/")}`);
                }
                if (item.onError !== undefined && item.onError !== "block" && item.onError !== "continue") {
                    err(`${at}.onError`, 'Debe ser "block" o "continue"');
                }
                if (item.schedule !== undefined && !CRON_SCHEDULES.includes(String(item.schedule))) {
                    err(`${at}.schedule`, `Debe ser ${CRON_SCHEDULES.join(" o ")}`);
                }
            });
        }
    }

    // --- Slash commands / backendRoutes ------------------------------------------------------------------------
    if (m.slashCommands !== undefined) {
        if (!Array.isArray(m.slashCommands)) {
            err("slashCommands", "Debe ser un arreglo");
        } else {
            m.slashCommands.forEach((cmd: unknown, index: number) => {
                const at = `slashCommands[${index}]`;
                if (!isObject(cmd)) return err(at, "Debe ser un objeto");
                if (typeof cmd.key !== "string" || !/^[a-zA-Z0-9_-]{1,32}$/.test(cmd.key)) err(`${at}.key`, "Requerido: [a-zA-Z0-9_-]");
                if (typeof cmd.description !== "string") err(`${at}.description`, "Requerido");
                if (!isObject(cmd.action)) err(`${at}.action`, "Requerido: accion");
                else walk(cmd.action, `${at}.action`, 0);
            });
        }
    }

    if (m.backendRoutes !== undefined) {
        if (!Array.isArray(m.backendRoutes)) {
            err("backendRoutes", "Debe ser un arreglo");
        } else {
            m.backendRoutes.forEach((route: unknown, index: number) => {
                const at = `backendRoutes[${index}]`;
                if (!isObject(route)) return err(at, "Debe ser un objeto");
                if (typeof route.path !== "string" || !route.path.startsWith("/")) err(`${at}.path`, "Debe empezar con /");
                checkFunctionRef(`${at}.handler`, route.handler);
                warn(at, "backendRoutes aun no se sirven (no existe router /api/ext/[id]/*); usa CALL_BACKEND");
            });
        }
    }

    return { ok: errors.length === 0, errors, warnings };
}

/** Texto legible de los errores (para logs y respuestas 400). */
export function formatManifestIssues(issues: ManifestIssue[], max = 10): string {
    return issues.slice(0, max).map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}
