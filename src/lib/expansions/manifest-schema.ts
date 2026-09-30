/**
 * Schema y normalizador de manifests de extensiones BloomX (sin dependencias).
 *
 * FUENTE CANONICA: bloomx-extensions/_shared/manifest-schema.ts
 * Copias identicas (verificadas por tests/contract.test.mjs):
 *   - bloomx-backend/src/lib/extensions/manifest-schema.ts   (repositorio, admin POST)
 *   - bloomx/src/lib/expansions/manifest-schema.ts           (carga en el frontend)
 *
 * Solo usa sintaxis TypeScript "borrable" (sin enums ni parametros de constructor) para poder ejecutarse con
 * `node --experimental-strip-types`. Unico import permitido: `./ui-schema.ts` (hermano identico en las 3 copias; el catalogo
 * de componentes se DERIVA de ahi, no se duplica). Se importa con extension `.ts` para que Node lo resuelva sin bundler
 * (tsconfig: allowImportingTsExtensions).
 *
 * Politica:
 *  - `errors`: el manifest NO se debe cargar/publicar.
 *  - `warnings`: se carga, pero conviene corregirlo (vocabulario desconocido, version de manifest desconocida).
 */

import { UI_COMPONENT_TYPES, isIconRef } from "./ui-schema.ts";

export type ManifestIssue = { path: string; message: string };
/**
 * Problema localizado en UN elemento del manifest (mount, overlay, slash command, hook o ruta). Solo se produce con
 * `lenientMounts` (CARGA de extensiones ya publicadas): en vez de invalidar la extension entera, el elemento se degrada.
 *   drop=true  -> el elemento se descarta (punto de montaje desconocido, componente/props invalidas, accion desconocida...).
 *   drop=false -> el elemento se CONSERVA: `handler`/`function` no declarado en api.functions. Una version antigua de la extension
 *                 puede exportar esa funcion desde su script; el backend la resuelve por nombre y, si no existe, falla en el CLIC.
 */
export type ScopedIssue = {
    scope: "mount" | "overlay" | "slash" | "hook" | "route";
    /** Indice del mount/slash/hook/route (no aplica a overlays). */
    index?: number;
    /** Id del overlay. */
    id?: string;
    path: string;
    message: string;
    drop: boolean;
};
export type ManifestValidation = { ok: boolean; errors: ManifestIssue[]; warnings: ManifestIssue[]; scoped: ScopedIssue[] };

export const SUPPORTED_MANIFEST_VERSIONS = ["1.0", "2.0"];
export const AUTH_TYPES = ["NONE", "OAUTH2", "API_KEY", "WEBHOOK_SECRET", "BASIC_AUTH"];

/**
 * Puntos de montaje consumidos (o reservados) por el frontend. El contexto que recibe cada uno esta documentado en
 * bloomx/src/lib/expansions/mount-points.ts (MOUNT_POINT_CONTEXT).
 */
export const KNOWN_MOUNT_POINTS = [
    "EMAIL_TOOLBAR", "EMAIL_FOOTER", "EMAIL_HEADER",
    "EMAIL_READER_SIDEBAR", "EMAIL_LIST_ROW_ACTION", "CONTEXT_MENU",
    "SIDEBAR_HEADER", "SIDEBAR_FOOTER", "SIDEBAR_PANEL",
    "COMPOSER_TOOLBAR", "COMPOSER_INIT", "COMPOSER_SIDEBAR",
    "CALENDAR_TOOLBAR", "CALENDAR_EVENT_PANEL",
    "CONTACTS_TOOLBAR", "CONTACT_CARD_PANEL",
    "SETTINGS_PANEL",
    "EVENT_LOCATION_BUILDER",
    "CALENDAR_HEADER", "CALENDAR_SIDEBAR", "CALENDAR_SIDEBAR_BOTTOM", "CALENDAR_ADD_SOURCES",
    "CONTACTS_HEADER", "CONTACTS_SIDEBAR", "CONTACTS_SIDEBAR_BOTTOM",
    "SETTINGS_TAB", "CUSTOM_SETTINGS_TAB", "CUSTOM_ROUTE", "PAGE", "OVERLAY", "SLASH_COMMAND",
    "BEFORE_SEND_HANDLER", "ON_BODY_CHANGE_HANDLER", "ON_SUBJECT_CHANGE_HANDLER", "ON_RECIPIENTS_CHANGE_HANDLER",
];

/**
 * Eventos de ciclo de vida (no bloqueantes, contexto minimo). Se disparan desde el servidor del frontend o desde la UI,
 * y solo llegan a extensiones de dominios FIRMADOS. Un handler no puede bloquear ni modificar nada en estos eventos.
 */
export const LIFECYCLE_EVENTS = [
    "EMAIL_OPENED", "EMAIL_SENT", "COMPOSE_OPENED",
    "CALENDAR_EVENT_CREATED", "CALENDAR_EVENT_UPDATED", "CALENDAR_EVENT_CANCELLED",
    "CONTACT_SAVED", "CONTACT_DELETED", "APPOINTMENT_BOOKED",
];

/** Eventos de servidor que ejecuta /api/extension/hooks (manifest `intercepts` o su alias `hooks`). */
export const INTERCEPT_POINTS = ["EMAIL_PRE_SEND", "EMAIL_RECEIVED", "CRON", ...LIFECYCLE_EVENTS];
export const INTERCEPT_PRIORITIES = ["HIGH", "NORMAL", "LOW", "MONITOR"];
export const CRON_SCHEDULES = ["hourly", "daily"];

/**
 * Nombres del formato ANTIGUO de UI que el adaptador (migrateLegacyUi de ui-schema.ts) sigue entendiendo pero que ya no estan
 * en el catalogo actual. Solo existen para no avisar de "componente desconocido" en manifests heredados.
 */
export const LEGACY_COMPONENT_TYPES = [
    "COLUMN", "DATA_TABLE", "FILE_UPLOAD", "BLOCK", "IFRAME", "CODE_EDITOR", "CODE_BLOCK", "FLEX", "BOX", "SEPARATOR", "EMPTY_STATE",
];

/** Componentes que implementa JsonRenderer: el catalogo vigente (DERIVADO de ui-schema.ts) mas los nombres del formato antiguo. */
export const KNOWN_COMPONENT_TYPES: string[] = Array.from(new Set([...UI_COMPONENT_TYPES, ...LEGACY_COMPONENT_TYPES]));

/** Categorias de la pagina /extensions (`manifest.category`) y alias es/en aceptados. */
export const CATEGORY_IDS = ["mail", "composer", "calendar", "contacts", "automation", "ai", "integrations", "settings", "other"];
export const CATEGORY_ALIASES: Record<string, string> = {
    mail: "mail", email: "mail", correo: "mail", communication: "mail", communications: "mail", inbox: "mail",
    composer: "composer", compose: "composer", redactor: "composer", writing: "composer", redaccion: "composer",
    calendar: "calendar", calendario: "calendar", meetings: "calendar", meeting: "calendar", reuniones: "calendar",
    contacts: "contacts", contactos: "contacts", crm: "contacts",
    automation: "automation", automatizacion: "automation", automatizaciones: "automation", workflow: "automation", productivity: "automation", productividad: "automation",
    ai: "ai", ia: "ai", "artificial-intelligence": "ai",
    integrations: "integrations", integration: "integrations", integraciones: "integrations", storage: "integrations",
    settings: "settings", ajustes: "settings", configuracion: "settings",
};

/** Limites de los campos de catalogo del manifest (pagina /extensions). */
export const MANIFEST_LIMITS = {
    maxBytes: 1048576,
    maxTags: 12,
    maxTag: 30,
    maxScreenshots: 6,
    maxScreenshotUrl: 2000,
    maxChangelog: 20,
    maxChangelogNotes: 1000,
    maxConferencingProviders: 10,
    /** Tope de objetos/arreglos visitados por el recorrido (un manifest es dato controlado por quien lo publica). */
    maxWalkNodes: 50000,
} as const;

/** Handlers estandar de un proveedor de videollamada (ver _shared/CONFERENCING-CONTRACT.md). */
export const CONFERENCING_HANDLERS = ["status", "testConnection", "createMeeting", "updateMeeting", "deleteMeeting"];
export const EXTENSION_KINDS = ["conferencing-provider", "calendar-provider"];

/**
 * `mandatory: true` en el manifest = extension OBLIGATORIA para todos los usuarios del dominio (DLP, seguridad): el usuario no
 * puede desactivarla y sus hooks de servidor se ejecutan siempre. El dominio tambien puede marcarla (politica del admin).
 */
export function isMandatoryManifest(manifest: unknown): boolean {
    return isObject(manifest) && manifest.mandatory === true;
}

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

export type PermissionRisk = "low" | "medium" | "high";
export type PermissionInfo = { label: string; description: string; risk: PermissionRisk };

/**
 * Catalogo de permisos: lo que ve el admin al instalar una extension (lista legible) y la base de la validacion.
 * Los `services.*` de calendario, contactos, formatos, almacenamiento y avisos solo existen en dominios FIRMADOS.
 */
export const PERMISSION_CATALOG: Record<string, PermissionInfo> = {
    READ_EMAIL: { label: "Leer correo", description: "Lee remitente, asunto y fragmento de los correos de la bandeja del usuario.", risk: "high" },
    MAIL_LABEL: { label: "Etiquetar correo", description: "Aplica o deshace etiquetas de categoria en correos del usuario (no mueve, borra ni envia).", risk: "medium" },
    READ_USER: { label: "Ver datos del usuario", description: "Ve el identificador y el correo del usuario que ejecuta la extension.", risk: "low" },
    READ_USER_NAME: { label: "Ver nombre del usuario", description: "Ve el nombre del usuario.", risk: "low" },
    AI_GENERATE: { label: "Usar IA", description: "Envia texto al proveedor de IA de la plataforma (con limite de llamadas).", risk: "medium" },
    HTTP_REQUEST: { label: "Llamadas HTTP externas", description: "Hace peticiones HTTPS a servicios externos (filtradas contra SSRF).", risk: "high" },
    OAUTH_READ: { label: "Leer tokens OAuth", description: "Usa los tokens de las cuentas conectadas del dominio.", risk: "high" },
    OAUTH_WRITE: { label: "Gestionar conexiones OAuth", description: "Conecta o desconecta cuentas de terceros.", risk: "high" },
    API_ROUTE_CREATE: { label: "Crear rutas de API", description: "Declara rutas de API propias (reservado).", risk: "medium" },
    PAGE_ROUTE_CREATE: { label: "Crear paginas", description: "Declara paginas propias (reservado).", risk: "medium" },
    DB_READ: { label: "Leer base de datos", description: "Lectura de datos de la extension (reservado).", risk: "medium" },
    DB_WRITE: { label: "Escribir base de datos", description: "Escritura de datos de la extension (reservado).", risk: "medium" },
    "local:secure-storage": { label: "Almacenamiento seguro del navegador", description: "Guarda datos cifrados en el navegador del usuario.", risk: "low" },
    CALENDAR_READ: { label: "Leer calendario", description: "Lista y consulta eventos y huecos libres de los calendarios del usuario (sin tokens de Google).", risk: "medium" },
    CALENDAR_WRITE: { label: "Modificar calendario", description: "Crea, edita, cancela eventos e invita asistentes en calendarios del usuario.", risk: "high" },
    CONTACTS_READ: { label: "Leer contactos", description: "Busca y lista los contactos del usuario y sugiere duplicados.", risk: "medium" },
    CONTACTS_WRITE: { label: "Modificar contactos", description: "Crea, edita y fusiona contactos del usuario.", risk: "high" },
    FORMATS: { label: "Formatos", description: "Usa utilidades puras de fechas, numeros, ICS, vCard, plantillas y saneo de HTML (sin acceso a datos).", risk: "low" },
    STORAGE: { label: "Almacenamiento propio", description: "Guarda hasta 256 KB de estado de la extension por usuario en el servidor.", risk: "low" },
    NOTIFY: { label: "Notificaciones", description: "Muestra avisos (toast) al usuario dentro de la aplicacion.", risk: "low" },
};

const KNOWN_PERMISSIONS = Object.keys(PERMISSION_CATALOG);

/** Lista legible de los permisos de un manifest (pantalla de instalacion). Los desconocidos se marcan `known: false`. */
export function describePermissions(permissions: unknown): Array<{ permission: string; label: string; description: string; risk: PermissionRisk; known: boolean }> {
    const list = Array.isArray(permissions) ? permissions.filter((p): p is string => typeof p === "string") : [];
    return list.map((permission) => {
        if (permission.startsWith("ENV_READ:")) {
            const key = permission.slice("ENV_READ:".length).trim();
            const known = ENV_RE.test(key) && !RESERVED_ENV_RE.test(key);
            return { permission, label: `Variable ${key}`, description: `Lee la credencial o variable ${key} configurada para este dominio.`, risk: "high" as PermissionRisk, known };
        }
        const info = PERMISSION_CATALOG[permission];
        return info
            ? { permission, ...info, known: true }
            : { permission, label: permission, description: "Permiso desconocido: la plataforma lo ignora.", risk: "high" as PermissionRisk, known: false };
    });
}

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

export type ValidateManifestOptions = {
    /**
     * true = los problemas de los campos de CATALOGO (category, tags, screenshots, changelog, mandatory) son AVISOS y no errores.
     * Es lo que usa el frontend al CARGAR una extension ya publicada: un enlace de captura malo no debe apagar la extension (la
     * pagina /extensions ya saniza lo que muestra). La publicacion (backend, sync, admin) valida en modo estricto (por defecto).
     */
    lenientCatalog?: boolean;
    /**
     * true = los errores que afectan a UN mount/overlay/slashCommand/hook/ruta NO invalidan la extension: se devuelven en `scoped`
     * (con su ruta y motivo) para que el cargador descarte solo ese elemento. Los errores estructurales (manifest ilegible, sin id,
     * permisos prohibidos, `mounts` que no es un arreglo...) siguen siendo `errors`. Es la politica de CARGA; publicar es estricto.
     */
    lenientMounts?: boolean;
};

export function validateManifest(input: unknown, options: ValidateManifestOptions = {}): ManifestValidation {
    const errors: ManifestIssue[] = [];
    const warnings: ManifestIssue[] = [];
    const scoped: ScopedIssue[] = [];
    // Elemento que se esta validando (mount, overlay, hook...). Con `lenientMounts`, sus errores se degradan a `scoped`.
    let scope: Omit<ScopedIssue, "path" | "message" | "drop"> | null = null;
    const err = (path: string, message: string, drop = true) => {
        if (options.lenientMounts && scope) scoped.push({ ...scope, path, message, drop });
        else errors.push({ path, message });
    };
    const warn = (path: string, message: string) => { warnings.push({ path, message }); };

    if (!isObject(input)) {
        err("$", "El manifest debe ser un objeto JSON");
        return { ok: false, errors, warnings, scoped };
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

    // Tamano total: un manifest es dato controlado por quien lo publica (se guarda en BD y se sirve en /api/config).
    let manifestBytes = 0;
    try { manifestBytes = JSON.stringify(m)?.length ?? 0; } catch { err("$", "El manifest no es JSON serializable (referencias circulares o valores no validos)"); return { ok: false, errors, warnings, scoped }; }
    if (manifestBytes > MANIFEST_LIMITS.maxBytes) err("$", `El manifest pesa ${Math.round(manifestBytes / 1024)} KB; maximo ${Math.round(MANIFEST_LIMITS.maxBytes / 1024)} KB`);

    // --- Campos de catalogo (pagina /extensions) ---------------------------------------------------------------
    validateCatalogFields(m, options.lenientCatalog ? warn : err, warn);

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
        // drop=false: una version antigua puede exportar la funcion desde su script (el backend la resuelve por nombre).
        if (!functionNames.has(name)) err(at, `"${name}" no esta declarada en api.functions`, false);
    };

    // --- Proveedores de videollamada (kind conferencing-provider) -----------------------------------------------
    if (m.kind !== undefined && !EXTENSION_KINDS.includes(String(m.kind))) warn("kind", `Tipo de extension desconocido; conocidos: ${EXTENSION_KINDS.join(", ")}`);
    if (m.conferencingProviders !== undefined) {
        if (!Array.isArray(m.conferencingProviders)) {
            err("conferencingProviders", "Debe ser un arreglo");
        } else {
            if (m.conferencingProviders.length > MANIFEST_LIMITS.maxConferencingProviders) err("conferencingProviders", `Maximo ${MANIFEST_LIMITS.maxConferencingProviders} proveedores`);
            const seenProviders = new Set<string>();
            m.conferencingProviders.slice(0, MANIFEST_LIMITS.maxConferencingProviders).forEach((provider: unknown, index: number) => {
                const at = `conferencingProviders[${index}]`;
                if (!isObject(provider)) return err(at, "Debe ser un objeto");
                if (typeof provider.id !== "string" || !ID_RE.test(provider.id)) err(`${at}.id`, "Requerido: [A-Za-z0-9._:-] (max 100)");
                else if (seenProviders.has(provider.id)) err(`${at}.id`, `Proveedor duplicado: ${provider.id}`);
                else seenProviders.add(provider.id);
                if (typeof provider.name !== "string" || !provider.name.trim() || provider.name.length > 60) err(`${at}.name`, "Requerido: texto no vacio (max 60)");
                if (provider.icon !== undefined && (typeof provider.icon !== "string" || provider.icon.length > 40)) err(`${at}.icon`, "Debe ser texto (max 40)");
                if (!isObject(provider.handlers)) return err(`${at}.handlers`, "Requerido: objeto {handler estandar: funcion de api.functions}");
                for (const [handlerKey, fn] of Object.entries(provider.handlers)) {
                    if (!CONFERENCING_HANDLERS.includes(handlerKey)) warn(`${at}.handlers.${handlerKey}`, `Handler no estandar; los estandar son ${CONFERENCING_HANDLERS.join(", ")}`);
                    checkFunctionRef(`${at}.handlers.${handlerKey}`, fn);
                }
                if (provider.handlers.createMeeting === undefined) err(`${at}.handlers.createMeeting`, "Un proveedor de videollamada debe implementar createMeeting");
            });
        }
    }

    // --- Recorrido de componentes / acciones -------------------------------------------------------------------
    let walked = 0;
    const walk = (node: unknown, at: string, depth: number) => {
        if (depth > MAX_DEPTH) return err(at, "Anidamiento demasiado profundo");
        if (++walked > MANIFEST_LIMITS.maxWalkNodes) {
            if (walked === MANIFEST_LIMITS.maxWalkNodes + 1) err(at, `Demasiados nodos en el manifest (maximo ${MANIFEST_LIMITS.maxWalkNodes})`);
            return;
        }
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
                scope = { scope: "mount", index };
                if (!isObject(raw)) return err(at, "Debe ser un objeto");
                if (typeof raw.point !== "string" || !raw.point) return err(`${at}.point`, "Requerido");
                if (!KNOWN_MOUNT_POINTS.includes(raw.point)) {
                    // Estricto: aviso (el frontend simplemente no lo consulta). Carga tolerante: el mount se descarta y queda registrado.
                    if (options.lenientMounts) err(`${at}.point`, `Punto de montaje desconocido: ${raw.point}`);
                    else warn(`${at}.point`, `Punto de montaje desconocido: ${raw.point}`);
                }

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
            scope = null;
        }
    }

    if (m.overlays !== undefined) {
        if (!isObject(m.overlays)) err("overlays", "Debe ser un objeto {id: componente}");
        else {
            for (const [id, node] of Object.entries(m.overlays)) {
                scope = { scope: "overlay", id };
                walk(node, `overlays.${id}`, 0);
            }
            scope = null;
        }
    }

    // --- Intercepts (hooks de servidor; `hooks` es un alias con la misma forma) ------------------------------------
    for (const listKey of ["intercepts", "hooks"]) {
        const list = m[listKey];
        if (list === undefined) continue;
        if (!Array.isArray(list)) {
            err(listKey, "Debe ser un arreglo");
        } else {
            list.forEach((item: unknown, index: number) => {
                const at = `${listKey}[${index}]`;
                scope = { scope: "hook", index };
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
                if (typeof item.point === "string" && LIFECYCLE_EVENTS.includes(item.point) && item.onError === "block") {
                    warn(`${at}.onError`, "Los eventos de ciclo de vida no bloquean: onError=block se ignora");
                }
            });
            scope = null;
        }
    }

    // --- Slash commands / backendRoutes ------------------------------------------------------------------------
    if (m.slashCommands !== undefined) {
        if (!Array.isArray(m.slashCommands)) {
            err("slashCommands", "Debe ser un arreglo");
        } else {
            m.slashCommands.forEach((cmd: unknown, index: number) => {
                const at = `slashCommands[${index}]`;
                scope = { scope: "slash", index };
                if (!isObject(cmd)) return err(at, "Debe ser un objeto");
                if (typeof cmd.key !== "string" || !/^[a-zA-Z0-9_-]{1,32}$/.test(cmd.key)) err(`${at}.key`, "Requerido: [a-zA-Z0-9_-]");
                if (typeof cmd.description !== "string") err(`${at}.description`, "Requerido");
                if (!isObject(cmd.action)) err(`${at}.action`, "Requerido: accion");
                else walk(cmd.action, `${at}.action`, 0);
            });
            scope = null;
        }
    }

    if (m.backendRoutes !== undefined) {
        if (!Array.isArray(m.backendRoutes)) {
            err("backendRoutes", "Debe ser un arreglo");
        } else {
            m.backendRoutes.forEach((route: unknown, index: number) => {
                const at = `backendRoutes[${index}]`;
                scope = { scope: "route", index };
                if (!isObject(route)) return err(at, "Debe ser un objeto");
                if (typeof route.path !== "string" || !route.path.startsWith("/")) err(`${at}.path`, "Debe empezar con /");
                checkFunctionRef(`${at}.handler`, route.handler);
                warn(at, "backendRoutes aun no se sirven (no existe router /api/ext/[id]/*); usa CALL_BACKEND");
            });
            scope = null;
        }
    }

    return { ok: errors.length === 0, errors, warnings, scoped };
}

type IssueSink = (path: string, message: string) => void;

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** URL de captura valida: absoluta, https, sin credenciales embebidas y de longitud acotada. */
export function isSafeScreenshotUrl(value: unknown): boolean {
    if (typeof value !== "string" || value.length === 0 || value.length > MANIFEST_LIMITS.maxScreenshotUrl) return false;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && url.hostname.length > 0 && !url.username && !url.password;
    } catch {
        return false;
    }
}

/** `category`, `tags`, `screenshots`, `changelog` y `mandatory`: campos que lee la pagina /extensions y la politica del dominio. */
function validateCatalogFields(m: Record<string, any>, err: IssueSink, warn: IssueSink) {
    if (m.category !== undefined) {
        if (typeof m.category !== "string" || !m.category.trim() || m.category.length > 40) err("category", "Debe ser texto no vacio (max 40)");
        else if (!Object.prototype.hasOwnProperty.call(CATEGORY_ALIASES, strip(m.category))) warn("category", `Categoria desconocida "${m.category}": se derivara de los mounts/permisos. Validas: ${CATEGORY_IDS.join(", ")}`);
    }

    if (m.tags !== undefined) {
        if (!Array.isArray(m.tags)) err("tags", "Debe ser un arreglo de textos");
        else {
            if (m.tags.length > MANIFEST_LIMITS.maxTags) err("tags", `Maximo ${MANIFEST_LIMITS.maxTags} etiquetas`);
            m.tags.slice(0, MANIFEST_LIMITS.maxTags + 1).forEach((tag: unknown, index: number) => {
                if (typeof tag !== "string" || !tag.trim() || tag.length > MANIFEST_LIMITS.maxTag || /[<>\u0000-\u001f]/.test(tag)) {
                    err(`tags[${index}]`, `Debe ser texto sin HTML ni saltos de linea (1-${MANIFEST_LIMITS.maxTag} caracteres)`);
                }
            });
        }
    }

    if (m.screenshots !== undefined) {
        if (!Array.isArray(m.screenshots)) err("screenshots", "Debe ser un arreglo de URLs https");
        else {
            if (m.screenshots.length > MANIFEST_LIMITS.maxScreenshots) err("screenshots", `Maximo ${MANIFEST_LIMITS.maxScreenshots} capturas`);
            m.screenshots.slice(0, MANIFEST_LIMITS.maxScreenshots + 1).forEach((src: unknown, index: number) => {
                if (!isSafeScreenshotUrl(src)) err(`screenshots[${index}]`, `Debe ser una URL absoluta https (sin usuario/clave, max ${MANIFEST_LIMITS.maxScreenshotUrl} caracteres)`);
            });
        }
    }

    if (m.changelog !== undefined) {
        if (!Array.isArray(m.changelog)) err("changelog", "Debe ser un arreglo [{version, date?, notes?}]");
        else {
            if (m.changelog.length > MANIFEST_LIMITS.maxChangelog) err("changelog", `Maximo ${MANIFEST_LIMITS.maxChangelog} entradas`);
            m.changelog.slice(0, MANIFEST_LIMITS.maxChangelog + 1).forEach((entry: unknown, index: number) => {
                const at = `changelog[${index}]`;
                if (!isObject(entry)) return err(at, "Debe ser un objeto {version, date?, notes?}");
                if (typeof entry.version !== "string" || !entry.version.trim() || entry.version.length > 40) err(`${at}.version`, "Requerido: texto (max 40)");
                if (entry.date !== undefined && (typeof entry.date !== "string" || entry.date.length > 40)) err(`${at}.date`, "Debe ser texto (max 40)");
                if (entry.notes !== undefined) {
                    const notes = Array.isArray(entry.notes) ? entry.notes : [entry.notes];
                    const total = notes.reduce((n: number, item: unknown) => n + (typeof item === "string" ? item.length : MANIFEST_LIMITS.maxChangelogNotes + 1), 0);
                    if (notes.length > 50 || total > MANIFEST_LIMITS.maxChangelogNotes) err(`${at}.notes`, `Debe ser texto (o lista de textos) de hasta ${MANIFEST_LIMITS.maxChangelogNotes} caracteres`);
                }
            });
        }
    }

    if (m.mandatory !== undefined && typeof m.mandatory !== "boolean") err("mandatory", "Debe ser true o false (obligatoria para todos los usuarios del dominio)");

    // Icono de la extension: `brand:<slug>` | `lucide:<Nombre>` | `initials:<XY>` o (compatibilidad) un nombre Lucide sin esquema.
    if (m.icon !== undefined && !(typeof m.icon === "string" && (isIconRef(m.icon) || LEGACY_ICON_RE.test(m.icon)))) {
        err("icon", 'Debe ser "brand:<slug>", "lucide:<Nombre>", "initials:<XY>" o un nombre de icono Lucide (sin URLs ni imagenes remotas)');
    }

    // Textos por idioma del NOMBRE y la DESCRIPCION: `i18n: { es: { name, description }, en: { name, description } }`.
    // Los campos `name` y `description` (texto) siguen siendo obligatorios/validos y son el respaldo de cualquier otro idioma.
    if (m.i18n !== undefined) {
        if (!isObject(m.i18n)) err("i18n", "Debe ser un objeto { es: { name, description }, en: { ... } }");
        else {
            const langs = Object.keys(m.i18n);
            if (langs.length === 0 || langs.length > 12) err("i18n", "Debe declarar entre 1 y 12 idiomas");
            for (const lang of langs.slice(0, 13)) {
                const at = `i18n.${lang}`;
                const entry = m.i18n[lang];
                if (!I18N_LANG_RE.test(lang)) { err(at, 'Codigo de idioma invalido (p. ej. "es", "en", "pt-BR")'); continue; }
                if (!isObject(entry)) { err(at, "Debe ser un objeto { name?, description? }"); continue; }
                if (entry.name !== undefined && (typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 120)) err(`${at}.name`, "Debe ser texto no vacio (max 120)");
                if (entry.description !== undefined && (typeof entry.description !== "string" || entry.description.length > 2000)) err(`${at}.description`, "Debe ser texto (max 2000)");
            }
        }
    }
}

const LEGACY_ICON_RE = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const I18N_LANG_RE = /^[a-z]{2}(?:-[A-Za-z]{2})?$/;

/**
 * Nombre y descripcion de una extension en el idioma `lang`: `manifest.i18n[lang]` (exacto, base "es" de "es-MX", en, es) y, si falta,
 * los campos `name`/`description` del manifest. Nunca devuelve undefined en `name` si el manifest lo tiene.
 */
export function manifestTexts(manifest: unknown, lang: string): { name: string; description: string } {
    const m = isObject(manifest) ? manifest : {};
    const fallbackName = typeof m.name === "string" ? m.name.trim() : "";
    const fallbackDescription = typeof m.description === "string" ? m.description.trim() : "";
    const table = isObject(m.i18n) ? m.i18n : null;
    if (!table) return { name: fallbackName, description: fallbackDescription };
    const wanted = String(lang || "").toLowerCase();
    const base = wanted.split("-")[0];
    const byLower: Record<string, any> = {};
    for (const key of Object.keys(table)) byLower[key.toLowerCase()] = table[key];
    const pick = (field: "name" | "description"): string | undefined => {
        for (const candidate of [wanted, base, "en", "es"]) {
            const entry = candidate ? byLower[candidate] : undefined;
            if (isObject(entry) && typeof entry[field] === "string" && entry[field].trim()) return entry[field].trim();
        }
        return undefined;
    };
    return { name: pick("name") ?? fallbackName, description: pick("description") ?? fallbackDescription };
}

/** Icono declarado por la extension (`manifest.icon`) o null. No comprueba que el slug exista (lo hace el registro del frontend). */
export function manifestIcon(manifest: unknown): string | null {
    const icon = isObject(manifest) ? manifest.icon : undefined;
    return typeof icon === "string" && (isIconRef(icon) || LEGACY_ICON_RE.test(icon)) ? icon : null;
}

/** Texto legible de los errores (para logs y respuestas 400). */
export function formatManifestIssues(issues: ManifestIssue[], max = 10): string {
    return issues.slice(0, max).map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}
