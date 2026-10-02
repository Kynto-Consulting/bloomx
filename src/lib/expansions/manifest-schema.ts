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

import { PAGE_UI_CAPABILITY, UI_COMPONENT_TYPES, isIconRef, pageUiReason } from "./ui-schema.ts";
import { normalizeSettingsSchema, validateSettingsSchema } from "./settings-schema.ts";
import { validateOAuthProviders } from "./oauth-schema.ts";
import { validateBackendRoutes, validatePageAuth } from "./route-schema.ts";
import { validateNavEntries } from "./nav-schema.ts";
import { validateRequires } from "./client-contract.ts";

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
export const LIFECYCLE_EVENTS_V1 = [
    "EMAIL_OPENED", "EMAIL_SENT", "COMPOSE_OPENED",
    "CALENDAR_EVENT_CREATED", "CALENDAR_EVENT_UPDATED", "CALENDAR_EVENT_CANCELLED",
    "CONTACT_SAVED", "CONTACT_DELETED", "APPOINTMENT_BOOKED",
];

/**
 * Eventos de ciclo de vida v2 (capacidad `lifecycle.events.v2`, clientApi >= 7): alta/baja de cuentas, correo clasificado como spam y
 * etiqueta aplicada. Cada uno exige un permiso en el manifest (EVENT_PERMISSIONS). No hay USER_DELETED: la plataforma no borra cuentas
 * (solo las deshabilita y rehabilita), asi que no existe un punto de origen que emitir.
 */
export const LIFECYCLE_EVENTS_V2 = ["USER_CREATED", "USER_DISABLED", "USER_ENABLED", "EMAIL_SPAM_DETECTED", "LABEL_APPLIED"];

export const LIFECYCLE_EVENTS = [...LIFECYCLE_EVENTS_V1, ...LIFECYCLE_EVENTS_V2];

/** Permiso que debe declarar un manifest para interceptar el evento (el runtime tambien lo exige: sin permiso no se invoca). */
export const EVENT_PERMISSIONS: Record<string, string> = {
    USER_CREATED: "READ_USERS",
    USER_DISABLED: "READ_USERS",
    USER_ENABLED: "READ_USERS",
    EMAIL_SPAM_DETECTED: "READ_EMAIL",
    LABEL_APPLIED: "READ_EMAIL",
};

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
    maxCategories: 3,
    maxConferencingProviders: 10,
    /** Tope de objetos/arreglos visitados por el recorrido (un manifest es dato controlado por quien lo publica). */
    maxWalkNodes: 50000,
} as const;

/**
 * Metadatos de MARKETPLACE (capacidad de cliente `market.catalog.v1`, clientApi 11). Son OPCIONALES e INFORMATIVOS: el backend los entrega aparte
 * (campo `catalog` del catalogo publico) solo a clientes que declaran la capacidad; el manifest ejecutable no cambia, asi que NINGUNA extension los
 * declara en `requires` (un manifest que pidiera market.catalog.v1 dejaria de servirse a las instancias antiguas: ver feature-rules.mjs).
 *  - `publisher`: { id, name, icon?, url?, verified?, official? }. `official`/`verified` solo se aceptan en extensiones de la plataforma (`core-*`).
 *  - `suite`: { id, name, icon? } agrupa productos de una misma marca (carpeta del marketplace).
 *  - `categories`: hasta 3 ids de CATEGORY_IDS (la primera es la principal). `category` (singular) sigue valiendo.
 */
export const PUBLISHER_ID_RE = /^[a-z][a-z0-9-]{1,39}$/;
export const PLATFORM_EXTENSION_PREFIX = "core-";
export const DEFAULT_PUBLISHER = Object.freeze({ id: "bloomx", name: "Bloomx", official: true, verified: true });
export type CatalogPublisher = { id: string; name: string; icon?: string; url?: string; verified: boolean; official: boolean };
export type CatalogSuite = { id: string; name: string; icon: string | null };
export type CatalogMeta = {
    publisher: CatalogPublisher;
    suite: CatalogSuite | null;
    categories: string[];
    tags: string[];
    screenshots: string[];
    changelog: Array<{ version: string; date?: string; notes: string[] }>;
};

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
    READ_USERS: { label: "Ver las cuentas del dominio", description: "Lista y consulta las cuentas de ESTE dominio (id, correo, nombre y fecha de alta; nunca contrasenas ni tokens) con ctx.services.users, y recibe los eventos USER_CREATED / USER_DISABLED / USER_ENABLED. Solo lectura, paginado y con cuota. Requiere aprobacion explicita del administrador.", risk: "high" },
    READ_STATS: { label: "Ver metricas del dominio", description: "Lee metricas AGREGADAS de este dominio con ctx.services.stats: usuarios (total, altas, activos), correos recibidos y enviados por dia y spam bloqueado. Nunca asuntos, remitentes, direcciones ni contenido. Solo lectura; los usuarios que no son administradores no pueden obtenerlas.", risk: "medium" },
    READ_USER_NAME: { label: "Ver nombre del usuario", description: "Ve el nombre del usuario.", risk: "low" },
    AI_GENERATE: { label: "Usar IA", description: "Usa el servicio de IA de esta instancia (services.ai): envia texto al proveedor configurado por el administrador en /admin/ai, con cuotas, guardarrailes y limite de llamadas. Si la IA esta desactivada la extension se bloquea (salvo ai.required=false).", risk: "medium" },
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
    PUBLIC_ROUTE: { label: "Rutas y paginas publicas", description: "Expone rutas o paginas SIN sesion de usuario (auth: none) en el dominio. Cualquiera en Internet puede invocarlas (con limites estrictos y sin datos de usuario). Requiere aprobacion explicita del administrador del dominio.", risk: "high" },
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
        if (permission.startsWith("OAUTH_SHARED:")) {
            const m = /^OAUTH_SHARED:([a-z][a-z0-9-]{1,31})$/.exec(permission);
            return m
                ? { permission, label: `Cuentas compartidas de ${m[1]}`, description: `Usa, a traves del nucleo y sin ver nunca sus credenciales, la identidad COMPARTIDA del dominio en ${m[1]} (organizador o cuenta de servicio con delegacion): actua en nombre de la organizacion, no de un usuario.`, risk: "high" as PermissionRisk, known: true }
                : { permission, label: permission, description: "Permiso desconocido: la plataforma lo ignora.", risk: "high" as PermissionRisk, known: false };
        }
        if (permission.startsWith("OAUTH_ACCOUNT:")) {
            const m = /^OAUTH_ACCOUNT:([a-z][a-z0-9-]{1,31}):([a-z][a-z0-9-]{0,31})$/.exec(permission);
            return m
                ? { permission, label: `Cuenta ${m[1]} (${m[2]})`, description: `Usa, a traves del nucleo y sin ver nunca tus tokens, las cuentas ${m[1]} vinculadas del usuario para el grupo de permisos "${m[2]}".`, risk: "high" as PermissionRisk, known: true }
                : { permission, label: permission, description: "Permiso desconocido: la plataforma lo ignora.", risk: "high" as PermissionRisk, known: false };
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
export const RESERVED_ENV_RE = /^(DATABASE_URL|DIRECT_URL|SHADOW_DATABASE_URL|POSTGRES_.*|PG.*|B2_.*|ADMIN_.*|MP_.*|PAYPAL_.*|PAYMENTS_.*|PLATFORM_.*|NEXTAUTH_.*|AUTH_.*|DATA_ENCRYPTION_KEY|AI_.*|OPENAI_.*|RESEND_.*|VERCEL.*|NEXT_.*|NODE_.*|EXTENSION_.*|INTERNAL_.*|JWT_.*|SESSION_.*|AWS_.*|GITHUB_.*|NPM_.*|PATH|HOME|USER.*)$/i;

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
                // OAUTH_ACCOUNT:<proveedor>:<grupo-de-scopes> (p. ej. OAUTH_ACCOUNT:google:calendar): acceso, via el intermediario del nucleo, a la cuenta del usuario.
                // OAUTH_SHARED:<proveedor>: puede pedir al nucleo las identidades COMPARTIDAS del dominio (organizador / cuenta de servicio) de ese proveedor.
                if (permission.startsWith("OAUTH_SHARED:")) {
                    if (!/^OAUTH_SHARED:[a-z][a-z0-9-]{1,31}$/.test(permission)) err(at, "Formato: OAUTH_SHARED:<proveedor> (minusculas)");
                    return;
                }
                if (permission.startsWith("OAUTH_ACCOUNT:")) {
                    if (!/^OAUTH_ACCOUNT:[a-z][a-z0-9-]{1,31}:[a-z][a-z0-9-]{0,31}$/.test(permission)) err(at, "Formato: OAUTH_ACCOUNT:<proveedor>:<grupo> (minusculas)");
                    return;
                }
                if (!KNOWN_PERMISSIONS.includes(permission)) warn(at, `Permiso desconocido: ${permission}`);
            });
        }
    }

    // --- Bloque `ai` (servicio de IA de la instancia) -----------------------------------------------------------
    validateAiBlock(m, err, warn);

    // --- Requisitos del cliente (`requires`: version del contrato cliente<->backend y capacidades; ver client-contract.ts) ---
    for (const issue of validateRequires(m.requires)) (issue.soft && options.lenientCatalog ? warn : err)(issue.path, issue.message);
    // market.catalog.v1 es solo de catalogo (metadatos informativos): declararla en `requires` ocultaria la extension a las instancias antiguas.
    if (isObject(m.requires) && Array.isArray(m.requires.capabilities) && m.requires.capabilities.includes("market.catalog.v1")) {
        (options.lenientCatalog ? warn : err)("requires.capabilities", "market.catalog.v1 es solo de catalogo: no la declares en requires (las instancias antiguas dejarian de recibir la extension)");
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

    // --- Esquema de ajustes tipados (settingsSchema; las acciones apuntan a api.functions) ---
    for (const issue of validateSettingsSchema(m.settingsSchema, "settingsSchema", functionNames)) err(issue.path, issue.message);

    // --- Proveedores OAuth registrados por la extension (el nucleo ejecuta el flujo; ver oauth-schema.ts) ---
    if (m.oauthProviders !== undefined) {
        validateOAuthProviders(m.oauthProviders, err, warn, normalizeSettingsSchema(m.settingsSchema).fields, m.id);
        const caps = isObject(m.requires) && Array.isArray(m.requires.capabilities) ? m.requires.capabilities : [];
        if (!caps.includes("oauth.provider.v1")) err("requires.capabilities", "oauthProviders exige declarar la capacidad oauth.provider.v1");
    }

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
    const declaredCaps: string[] = isObject(m.requires) && Array.isArray(m.requires.capabilities) ? m.requires.capabilities.filter((c: unknown): c is string => typeof c === "string") : [];
    let pageUiReported = false;
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
            // Componentes de pagina completa: un cliente sin ui.pages.v1 no los pinta; hay que declarar la capacidad para no servirlos a esos clientes.
            const pageUi = pageUiReason(node);
            if (pageUi && !pageUiReported && !declaredCaps.includes(PAGE_UI_CAPABILITY)) {
                pageUiReported = true;
                // Carga de extensiones ya publicadas: aviso (no se apaga la extension); publicar: error.
                (options.lenientMounts ? warn : err)("requires.capabilities", `${pageUi} exige declarar la capacidad ${PAGE_UI_CAPABILITY} (${at})`);
            }
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

                if (mount.auth !== undefined || mount.minLevel !== undefined) {
                    validatePageAuth(mount as Record<string, unknown>, at, err, {
                        permissions: Array.isArray(m.permissions) ? m.permissions.filter((p: unknown): p is string => typeof p === "string") : [],
                        capabilities: isObject(m.requires) && Array.isArray(m.requires.capabilities) ? m.requires.capabilities.filter((c: unknown): c is string => typeof c === "string") : [],
                    });
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
                if (typeof item.point === "string" && EVENT_PERMISSIONS[item.point] && !(Array.isArray(m.permissions) && m.permissions.includes(EVENT_PERMISSIONS[item.point]))) {
                    err(`${at}.point`, `El evento ${item.point} requiere el permiso ${EVENT_PERMISSIONS[item.point]} en permissions`);
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
        const declared = new Set<string>(functionNames);
        const reqCaps: string[] = isObject(m.requires) && Array.isArray(m.requires.capabilities) ? m.requires.capabilities.filter((c: unknown): c is string => typeof c === "string") : [];
        const perms: string[] = Array.isArray(m.permissions) ? m.permissions.filter((p: unknown): p is string => typeof p === "string") : [];
        const secretKeys = normalizeSettingsSchema(m.settingsSchema).fields.filter((f) => f.secret).map((f) => f.key);
        const envReads = perms.filter((p) => p.startsWith("ENV_READ:")).map((p) => p.slice("ENV_READ:".length).trim());
        // Carga tolerante (extensiones ya publicadas): una ruta invalida no invalida la extension, solo avisa; el router la ignora.
        validateBackendRoutes(m.backendRoutes, options.lenientMounts ? warn : err, warn, { functionNames: declared, permissions: perms, secretKeys, envReads, capabilities: reqCaps });
    }

    // --- Entradas de navegacion (barra lateral del correo y menu de administracion; ver nav-schema.ts) ------------------------
    if (m.navEntries !== undefined) {
        // Carga tolerante: una entrada invalida no apaga la extension (readNavEntries la descarta); publicar es estricto.
        validateNavEntries(m.navEntries, options.lenientMounts ? warn : err, warn, {
            mounts: Array.isArray(m.mounts) ? m.mounts : [],
            routes: Array.isArray(m.backendRoutes) ? m.backendRoutes : [],
            capabilities: declaredCaps,
        });
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
/** Funciones de IA que una extension puede declarar en `ai.features` (espejo de AI_FEATURES de la instancia). */
export const AI_MANIFEST_FEATURES = ["composer", "smart-reply", "summarize", "translate", "organizer", "other"] as const;

/**
 * Bloque opcional `ai: { features, required (true por defecto), maxTokens?, purpose: {es, en} }`. Si existe, el permiso AI_GENERATE
 * debe estar declarado (error). AI_GENERATE sin bloque `ai` sigue siendo valido (compat) pero avisa: la extension no podra
 * declarar funciones ni degradar sin IA.
 */
function validateAiBlock(m: Record<string, any>, err: IssueSink, warn: IssueSink) {
    const perms: unknown[] = Array.isArray(m.permissions) ? m.permissions : [];
    const hasPermission = perms.includes("AI_GENERATE");
    if (m.ai === undefined) {
        if (hasPermission) warn("ai", "Declara AI_GENERATE sin bloque \"ai\": anade ai: { features, required, purpose } para que el administrador sepa para que usa la IA");
        return;
    }
    if (!isObject(m.ai)) return err("ai", "Debe ser un objeto { features, required?, maxTokens?, purpose }");
    const ai = m.ai;
    if (!hasPermission) err("ai", "El bloque \"ai\" requiere el permiso AI_GENERATE en permissions");
    for (const key of Object.keys(ai)) if (!["features", "required", "maxTokens", "purpose"].includes(key)) warn(`ai.${key}`, "Clave desconocida en el bloque ai");
    if (!Array.isArray(ai.features) || ai.features.length === 0) err("ai.features", `Requerido: arreglo no vacio con valores de ${AI_MANIFEST_FEATURES.join(", ")}`);
    else {
        if (ai.features.length > AI_MANIFEST_FEATURES.length) err("ai.features", "Demasiadas funciones");
        ai.features.forEach((f: unknown, i: number) => {
            if (typeof f !== "string" || !(AI_MANIFEST_FEATURES as readonly string[]).includes(f)) err(`ai.features[${i}]`, `Debe ser uno de ${AI_MANIFEST_FEATURES.join(", ")}`);
        });
        if (new Set(ai.features).size !== ai.features.length) err("ai.features", "Funciones duplicadas");
    }
    if (ai.required !== undefined && typeof ai.required !== "boolean") err("ai.required", "Debe ser booleano (por defecto true)");
    if (ai.maxTokens !== undefined && (typeof ai.maxTokens !== "number" || !Number.isInteger(ai.maxTokens) || ai.maxTokens < 16 || ai.maxTokens > 32000)) err("ai.maxTokens", "Debe ser un entero entre 16 y 32000");
    if (!isObject(ai.purpose)) err("ai.purpose", "Requerido: { es: texto, en: texto } (para que usa la IA)");
    else for (const lang of ["es", "en"]) {
        const v = ai.purpose[lang];
        if (typeof v !== "string" || !v.trim() || v.length > 300) err(`ai.purpose.${lang}`, "Requerido: texto no vacio (max 300)");
    }
}

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

    // --- Metadatos de marketplace (market.catalog.v1; informativos, ver MANIFEST_LIMITS) ---
    const platform = typeof m.id === "string" && m.id.startsWith(PLATFORM_EXTENSION_PREFIX);
    const okIcon = (v: unknown) => typeof v === "string" && (isIconRef(v) || LEGACY_ICON_RE.test(v));
    const okLabel = (v: unknown) => typeof v === "string" && v.trim().length > 0 && v.length <= 60 && !/[<>\u0000-\u001f]/.test(v);
    if (m.publisher !== undefined) {
        const p = m.publisher;
        if (!isObject(p)) err("publisher", "Debe ser un objeto { id, name, icon?, url?, verified?, official? }");
        else {
            for (const key of Object.keys(p)) if (!["id", "name", "icon", "url", "verified", "official"].includes(key)) warn(`publisher.${key}`, "Clave desconocida en publisher");
            if (typeof p.id !== "string" || !PUBLISHER_ID_RE.test(p.id)) err("publisher.id", "Requerido: [a-z0-9-] (2-40, empieza por letra)");
            if (!okLabel(p.name)) err("publisher.name", "Requerido: texto sin HTML (max 60)");
            if (p.icon !== undefined && !okIcon(p.icon)) err("publisher.icon", "Debe ser brand:/lucide:/initials: o un nombre Lucide (sin URLs)");
            if (p.url !== undefined && !isSafeScreenshotUrl(p.url)) err("publisher.url", "Debe ser una URL absoluta https (max 2000)");
            for (const flag of ["verified", "official"]) {
                if (p[flag] === undefined) continue;
                if (typeof p[flag] !== "boolean") err(`publisher.${flag}`, "Debe ser true o false");
                else if (p[flag] === true && !platform) err(`publisher.${flag}`, `Solo las extensiones de la plataforma (id ${PLATFORM_EXTENSION_PREFIX}*) pueden declararse ${flag === "official" ? "oficiales" : "verificadas"}`);
            }
        }
    }
    if (m.suite !== undefined) {
        const s = m.suite;
        if (!isObject(s)) err("suite", "Debe ser un objeto { id, name, icon? }");
        else {
            for (const key of Object.keys(s)) if (!["id", "name", "icon"].includes(key)) warn(`suite.${key}`, "Clave desconocida en suite");
            if (typeof s.id !== "string" || !PUBLISHER_ID_RE.test(s.id)) err("suite.id", "Requerido: [a-z0-9-] (2-40, empieza por letra)");
            else if (!platform && s.id !== (isObject(m.publisher) && typeof m.publisher.id === "string" ? m.publisher.id : "community")) warn("suite.id", "En extensiones que no son de la plataforma la suite se ignora salvo que coincida con el id del publisher");
            if (!okLabel(s.name)) err("suite.name", "Requerido: texto sin HTML (max 60)");
            if (s.icon !== undefined && !okIcon(s.icon)) err("suite.icon", "Debe ser brand:/lucide:/initials: o un nombre Lucide (sin URLs)");
        }
    }
    if (m.categories !== undefined) {
        if (!Array.isArray(m.categories)) err("categories", `Debe ser un arreglo de ids (${CATEGORY_IDS.join(", ")})`);
        else {
            if (m.categories.length === 0 || m.categories.length > MANIFEST_LIMITS.maxCategories) err("categories", `Entre 1 y ${MANIFEST_LIMITS.maxCategories} categorias`);
            const seen = new Set<string>();
            m.categories.slice(0, MANIFEST_LIMITS.maxCategories + 1).forEach((c: unknown, i: number) => {
                if (typeof c !== "string" || !CATEGORY_IDS.includes(c)) return err(`categories[${i}]`, `Debe ser uno de ${CATEGORY_IDS.join(", ")}`);
                if (seen.has(c)) err(`categories[${i}]`, `Categoria duplicada: ${c}`);
                seen.add(c);
            });
        }
    }

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

/** Lista de textos de una nota de changelog (acepta texto o lista), acotada. */
function noteList(notes: unknown): string[] {
    const list = Array.isArray(notes) ? notes : notes === undefined ? [] : [notes];
    return list.filter((n): n is string => typeof n === "string" && n.trim().length > 0).map((n) => n.trim().slice(0, MANIFEST_LIMITS.maxChangelogNotes)).slice(0, 50);
}

/**
 * Metadatos de marketplace SANEADOS de un manifest (nunca lanza). El backend los entrega en el campo `catalog` del catalogo publico y el
 * frontend los vuelve a sanear. `official`/`verified` NO se toman del manifest tal cual: `official` sale del id (solo `core-*` con publisher `bloomx`).
 * Sin `publisher`, las `core-*` pertenecen a la plataforma (Bloomx oficial) y el resto queda como publicador "community" sin verificar.
 */
export function readCatalogMeta(manifest: unknown): CatalogMeta {
    const m = isObject(manifest) ? manifest : {};
    const id = typeof m.id === "string" ? m.id : "";
    const platform = id.startsWith(PLATFORM_EXTENSION_PREFIX);
    const text = (v: unknown, max: number) => (typeof v === "string" && !/[<>\u0000-\u001f]/.test(v) ? v.trim().slice(0, max) : "");
    const icon = (v: unknown) => (typeof v === "string" && (isIconRef(v) || LEGACY_ICON_RE.test(v)) ? v : undefined);

    let publisher: CatalogPublisher;
    const p = isObject(m.publisher) ? m.publisher : null;
    if (p && typeof p.id === "string" && PUBLISHER_ID_RE.test(p.id) && text(p.name, 60)) {
        const official = platform && p.id === DEFAULT_PUBLISHER.id;
        publisher = {
            id: p.id,
            name: text(p.name, 60),
            ...(icon(p.icon) ? { icon: icon(p.icon) as string } : {}),
            ...(isSafeScreenshotUrl(p.url) ? { url: p.url as string } : {}),
            verified: official || (platform && p.verified === true),
            official,
        };
    } else {
        publisher = platform ? { ...DEFAULT_PUBLISHER } : { id: "community", name: "Community", verified: false, official: false };
    }

    let suite: CatalogSuite | null = null;
    const s = isObject(m.suite) ? m.suite : null;
    // Las suites son marca: una extension de terceros solo puede formar la suite de SU publisher (nunca "bloomx", "google", etc.).
    const suiteAllowed = (sid: string) => platform || (sid === publisher.id && sid !== DEFAULT_PUBLISHER.id);
    if (s && typeof s.id === "string" && PUBLISHER_ID_RE.test(s.id) && suiteAllowed(s.id) && text(s.name, 60)) suite = { id: s.id, name: text(s.name, 60), icon: icon(s.icon) ?? null };

    let categories: string[] = Array.isArray(m.categories) ? m.categories.filter((c: unknown): c is string => typeof c === "string" && CATEGORY_IDS.includes(c)) : [];
    if (categories.length === 0 && typeof m.category === "string") {
        const alias = CATEGORY_ALIASES[strip(m.category)];
        if (alias) categories = [alias];
    }
    categories = Array.from(new Set(categories)).slice(0, MANIFEST_LIMITS.maxCategories);

    const tags = Array.isArray(m.tags) ? Array.from(new Set(m.tags.map((t: unknown) => text(t, MANIFEST_LIMITS.maxTag)).filter(Boolean))).slice(0, MANIFEST_LIMITS.maxTags) : [];
    const screenshots = Array.isArray(m.screenshots) ? (m.screenshots.filter(isSafeScreenshotUrl) as string[]).slice(0, MANIFEST_LIMITS.maxScreenshots) : [];
    const changelog = Array.isArray(m.changelog)
        ? m.changelog.filter((e: unknown) => isObject(e) && typeof e.version === "string" && e.version.trim()).slice(0, MANIFEST_LIMITS.maxChangelog)
            .map((e: Record<string, any>) => ({ version: String(e.version).trim().slice(0, 40), ...(typeof e.date === "string" && e.date.length <= 40 ? { date: e.date } : {}), notes: noteList(e.notes) }))
        : [];
    return { publisher, suite, categories, tags, screenshots, changelog };
}

/** Texto legible de los errores (para logs y respuestas 400). */
export function formatManifestIssues(issues: ManifestIssue[], max = 10): string {
    return issues.slice(0, max).map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}
