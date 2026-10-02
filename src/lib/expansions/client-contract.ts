/**
 * Contrato de VERSION DEL CLIENTE entre el frontend de una instancia y el backend compartido (sin dependencias, puro).
 *
 * FUENTE CANONICA: bloomx-extensions/_shared/client-contract.ts
 * Copias identicas (verificadas por tests/contract.test.mjs):
 *   - bloomx-backend/src/lib/extensions/client-contract.ts
 *   - bloomx/src/lib/expansions/client-contract.ts
 *
 * Por que existe: el backend es COMPARTIDO por muchas instancias de frontend con versiones distintas y hay una sola copia de
 * cada extension. Una extension nueva puede usar funciones del cliente (settingsSchema, onSubmit, services.ai...) que una
 * instancia antigua no tiene. Cada cliente se identifica con
 *   X-BloomX-Client-Api : entero (version del CONTRATO cliente<->backend de extensiones; no es la version de la app)
 *   X-BloomX-Client-Caps: lista de capacidades separada por comas (cadenas estables, ver CAPABILITY_REGISTRY)
 * y cada manifest declara lo que necesita en `requires: { clientApi?, capabilities? }`. El backend sirve la version MAS ALTA
 * publicada cuyos `requires` cumple el cliente que pregunta.
 *
 * Linea base `legacy`: un cliente que NO envia cabeceras (o las envia mal formadas) es el cliente anterior al versionado:
 * clientApi 1 + las capacidades `since: 1` del registro. Un manifest sin `requires` es compatible con esa linea base.
 *
 * Regla de mantenimiento: toda funcion nueva del cliente que una extension pueda usar DEBE (a) registrarse en
 * CAPABILITY_REGISTRY con su `since`, y (b) si rompe el contrato, subir CLIENT_API_VERSION (frontend). Los tests lo exigen.
 */

/** Cabeceras (minusculas, como las lee el backend). */
export const CLIENT_API_HEADER = "x-bloomx-client-api";
export const CLIENT_CAPS_HEADER = "x-bloomx-client-caps";

export const LEGACY_CLIENT_API = 1;
export const MAX_CAPS_HEADER_LENGTH = 1024;
export const MAX_CLIENT_CAPS = 64;
export const CAPABILITY_ID_RE = /^[a-z][a-z0-9]*(?:[._-][a-zA-Z0-9]+){0,5}$/;

export type CapabilityInfo = {
    /** Primera version de CLIENT_API que la incluye. `since: 1` = linea base legacy (todos los clientes la tienen). */
    since: number;
    es: string;
    en: string;
};

/**
 * Registro de capacidades CONOCIDAS. Anadir una capacidad = anadir una entrada aqui (en las 3 copias), documentarla (es/en) y,
 * si corresponde, una regla en bloomx-extensions/_shared/feature-rules.mjs. Un manifest que pide una capacidad que no esta
 * aqui NO se publica (errata o capacidad futura: registrarla primero).
 */
export const CAPABILITY_REGISTRY: Record<string, CapabilityInfo> = {
    "core.mounts.v1": { since: 1, es: "Puntos de montaje y manifest basicos (EMAIL_*, COMPOSER_*, CALENDAR_*, SETTINGS_*, EVENT_LOCATION_BUILDER...).", en: "Basic manifest and mount points (EMAIL_*, COMPOSER_*, CALENDAR_*, SETTINGS_*, EVENT_LOCATION_BUILDER...)." },
    "ui.kit.v1": { since: 1, es: "Catalogo de componentes de UI original y acciones declarativas (CALL_BACKEND, TOAST, OPEN_OVERLAY...).", en: "Original UI component catalog and declarative actions (CALL_BACKEND, TOAST, OPEN_OVERLAY...)." },
    "server.execute.v1": { since: 1, es: "Ejecucion de handlers del servidor (/api/extension/execute) con ctx.args, ctx.env y ctx.services.ai.generate(system, prompt).", en: "Server handler execution (/api/extension/execute) with ctx.args, ctx.env and ctx.services.ai.generate(system, prompt)." },
    "server.hooks.v1": { since: 1, es: "Hooks de servidor EMAIL_PRE_SEND / EMAIL_RECEIVED / CRON (intercepts) y handlers de middleware del compositor.", en: "Server hooks EMAIL_PRE_SEND / EMAIL_RECEIVED / CRON (intercepts) and composer middleware handlers." },
    "settings.schema.v1": { since: 2, es: "Ajustes tipados: `settingsSchema` en el manifest, formulario en el panel de la extension y ruta /api/extension/config.", en: "Typed settings: `settingsSchema` in the manifest, the extension panel form and the /api/extension/config route." },
    "ui.input.onSubmit": { since: 2, es: "`onSubmit` (Enter) en INPUT y otros campos de texto.", en: "`onSubmit` (Enter) on INPUT and other text fields." },
    "ui.kit.v2": { since: 2, es: "Componentes STACK, REPEAT, EMPTY, SKELETON y TEXTAREA, y `onCancel` en dialogos.", en: "STACK, REPEAT, EMPTY, SKELETON and TEXTAREA components, and `onCancel` on dialogs." },
    "toolbar.compact": { since: 2, es: "Barras compactas de iconos con acciones ancladas y menu \"Extensiones\" (propiedad `toolbar` de los botones).", en: "Compact icon toolbars with pinned actions and the \"Extensions\" menu (the `toolbar` button prop)." },
    "ai.v1": { since: 2, es: "Servicio de IA de la instancia: bloque `ai` del manifest, ctx.services.ai.chat/status, cuotas y bloqueo si la IA esta apagada.", en: "Instance AI service: manifest `ai` block, ctx.services.ai.chat/status, quotas and blocking when AI is off." },
    "ai.json": { since: 2, es: "ctx.services.ai.json(prompt, schema): respuesta validada contra un esquema JSON.", en: "ctx.services.ai.json(prompt, schema): response validated against a JSON schema." },
    "lifecycle.events.v1": { since: 2, es: "Eventos de ciclo de vida (EMAIL_OPENED, EMAIL_SENT, CONTACT_SAVED, CALENDAR_EVENT_*, APPOINTMENT_BOOKED...).", en: "Lifecycle events (EMAIL_OPENED, EMAIL_SENT, CONTACT_SAVED, CALENDAR_EVENT_*, APPOINTMENT_BOOKED...)." },
    "services.host.v1": { since: 2, es: "Servicios del anfitrion ctx.services.calendar/contacts/storage/notify/formats/mail-label y sus permisos.", en: "Host services ctx.services.calendar/contacts/storage/notify/formats/mail-label and their permissions." },
    "ext.dependencies.v1": { since: 3, es: "Dependencias entre extensiones (`requires.extensions`): instalacion con dependencias, pausa de dependientes y error EXTENSION_DEPENDENCY_MISSING.", en: "Extension dependencies (`requires.extensions`): install with dependencies, pausing dependents and the EXTENSION_DEPENDENCY_MISSING error." },
    "oauth.provider.v1": { since: 5, es: "Proveedores OAuth registrados por extensiones (`oauthProviders`): ajustes/credenciales, rutas /api/oauth/[provider]/* y cuentas vinculadas por proveedor.", en: "OAuth providers registered by extensions (`oauthProviders`): settings/credentials, /api/oauth/[provider]/* routes and per-provider linked accounts." },
    "oauth.provider.v2": { since: 9, es: "Proveedores OAuth v2: variables de URL ({tenant}) y emisor por claim (Microsoft), autenticacion Basic (Zoom), OAuth v2 de Slack (bot + usuario), credenciales S2S, nombres de query con $ y parametros acotados por un ajuste del admin.", en: "OAuth providers v2: URL variables ({tenant}) and claim-based issuer (Microsoft), Basic client authentication (Zoom), Slack OAuth v2 (bot + user), S2S credentials, $-prefixed query names and parameters restricted by an admin setting." },
    "oauth.broker.v1": { since: 5, es: "Intermediario OAuth: las extensiones piden acciones al nucleo (ctx.services.oauth) y NUNCA reciben tokens.", en: "OAuth broker: extensions request actions from the core (ctx.services.oauth) and NEVER receive tokens." },
    "ext.grants.v1": { since: 6, es: "Concesiones de ejecucion: la instancia firma con SU clave de dominio una `executionGrant` de vida corta por ejecucion y el backend la reenvia a los servicios del host (sin clave global del backend).", en: "Execution grants: the instance signs a short-lived `executionGrant` per execution with ITS OWN domain key and the backend forwards it to host services (no global backend key)." },
    "lifecycle.events.v2": { since: 7, es: "Eventos de ciclo de vida v2 (USER_CREATED, USER_DISABLED, EMAIL_SPAM_DETECTED, LABEL_APPLIED) y servicio de solo lectura ctx.services.users (permiso READ_USERS).", en: "Lifecycle events v2 (USER_CREATED, USER_DISABLED, EMAIL_SPAM_DETECTED, LABEL_APPLIED) and the read-only ctx.services.users service (READ_USERS permission)." },
    "ext.routes.v1": { since: 4, es: "Rutas HTTP propias de extensiones (`backendRoutes`) servidas por /api/ext/[extensionId]/[...path] con lista exacta de rutas/metodos, limites y auditoria.", en: "Extension HTTP routes (`backendRoutes`) served at /api/ext/[extensionId]/[...path] with an exact route/method allowlist, limits and auditing." },
    "ext.routes.auth.v1": { since: 4, es: "Modos de autenticacion de rutas (`auth`: session, admin + minLevel/stepUp, signature, hmac, none con PUBLIC_ROUTE).", en: "Route authentication modes (`auth`: session, admin + minLevel/stepUp, signature, hmac, none with PUBLIC_ROUTE)." },
    "ext.pages.auth.v1": { since: 4, es: "`auth`/`minLevel` en paginas de extensiones (mounts PAGE y CUSTOM_ROUTE).", en: "`auth`/`minLevel` on extension pages (PAGE and CUSTOM_ROUTE mounts)." },
    "conferencing.picker": { since: 2, es: "Proveedores de videollamada (`kind: conferencing-provider`, `conferencingProviders`, `authModes`) y selector de ubicacion del evento.", en: "Conferencing providers (`kind: conferencing-provider`, `conferencingProviders`, `authModes`) and the event location picker." },
    "ui.pages.v1": { since: 8, es: "Componentes de pagina completa (PAGE_HEADER, SPLIT_PANE, KPI_CARD, CHART, TIMELINE, TREE, STEPPER) y tabla avanzada (busqueda, filtros por columna, acciones masivas, estado de error).", en: "Full-page components (PAGE_HEADER, SPLIT_PANE, KPI_CARD, CHART, TIMELINE, TREE, STEPPER) and the advanced table (search, per-column filters, bulk actions, error state)." },
    "nav.entries.v1": { since: 8, es: "Entradas de navegacion de extensiones (`navEntries`): enlaces a sus paginas en la barra lateral del correo, el menu movil y el menu de administracion, con insignia opcional y control por nivel.", en: "Extension navigation entries (`navEntries`): links to their pages in the mail sidebar, the mobile menu and the admin menu, with an optional badge and level control." },
    "market.catalog.v1": { since: 11, es: "Marketplace de extensiones: el catalogo publico entrega metadatos de tienda (editor, suite, categorias, etiquetas, capturas, changelog, instalaciones, precio). Solo informativa: ningun manifest la declara en `requires`.", en: "Extension marketplace: the public catalog delivers store metadata (publisher, suite, categories, tags, screenshots, changelog, install count, price). Informational only: no manifest declares it in `requires`." },
    "billing.paypal.v1": { since: 10, es: "Pagos con PayPal: compra de extensiones de pago (pago unico y suscripcion), facturacion, recibos y vinculacion de la cuenta del desarrollador. Exige instancia firmada y step-up reciente; solo informativa para manifests (ninguno la declara en `requires`).", en: "PayPal payments: buying paid extensions (one-time and subscription), billing, receipts and developer account linking. Requires a signed instance and a recent step-up; informational for manifests (none declares it in `requires`)." },
    "marketplace.developer.v1": { since: 10, es: "Portal de desarrolladores: terminos, validacion en vivo, envio a revision, precio y publicacion de extensiones propias del dominio (/admin/developer). Exige instancia firmada; solo informativa para manifests.", en: "Developer portal: terms, live validation, review submission, pricing and publishing of the domain's own extensions (/admin/developer). Requires a signed instance; informational for manifests." },
};

export const KNOWN_CAPABILITIES: string[] = Object.keys(CAPABILITY_REGISTRY);
/** Capacidades de la linea base legacy (las tiene TODO cliente, enviando cabeceras o no). */
export const LEGACY_BASELINE_CAPABILITIES: string[] = KNOWN_CAPABILITIES.filter((id) => CAPABILITY_REGISTRY[id].since <= LEGACY_CLIENT_API);

export type ClientIdentity = {
    clientApi: number;
    /** Capacidades ordenadas, SIEMPRE incluyen la linea base. */
    capabilities: string[];
    /** true = no declaro nada (cliente anterior al versionado) o la declaracion era invalida. */
    legacy: boolean;
};

export const LEGACY_CLIENT: ClientIdentity = Object.freeze({ clientApi: LEGACY_CLIENT_API, capabilities: LEGACY_BASELINE_CAPABILITIES, legacy: true }) as ClientIdentity;

/** Construye la identidad de un cliente (anade la linea base y descarta lo que no es una capacidad bien formada). */
export function makeClientIdentity(clientApi: number, capabilities: Iterable<string>, legacy = false): ClientIdentity {
    const set = new Set<string>(LEGACY_BASELINE_CAPABILITIES);
    for (const c of capabilities) if (typeof c === "string" && CAPABILITY_ID_RE.test(c) && c.length <= 40) set.add(c);
    return { clientApi, capabilities: Array.from(set).sort().slice(0, MAX_CLIENT_CAPS), legacy };
}

/** Cabeceras que envia un cliente (compactas: entero + lista separada por comas, recortada a MAX_CAPS_HEADER_LENGTH). */
export function formatClientHeaders(identity: { clientApi: number; capabilities: readonly string[] }): { "X-BloomX-Client-Api": string; "X-BloomX-Client-Caps": string } {
    const parts: string[] = [];
    let length = 0;
    for (const cap of identity.capabilities) {
        if (!CAPABILITY_ID_RE.test(cap)) continue;
        const add = cap.length + (parts.length ? 1 : 0);
        if (length + add > MAX_CAPS_HEADER_LENGTH || parts.length >= MAX_CLIENT_CAPS) break;
        parts.push(cap);
        length += add;
    }
    return { "X-BloomX-Client-Api": String(Math.trunc(identity.clientApi)), "X-BloomX-Client-Caps": parts.join(",") };
}

/**
 * Lee la identidad de una peticion. Sin cabeceras (instancias antiguas) o con cabeceras invalidas => LEGACY_CLIENT. Nunca lanza.
 * Las capacidades desconocidas para este backend se conservan (son de un cliente mas nuevo; solo cuentan si un manifest las pide).
 */
export function parseClientIdentity(headers: { get(name: string): string | null } | null | undefined): ClientIdentity {
    try {
        const rawApi = headers?.get(CLIENT_API_HEADER);
        if (rawApi === null || rawApi === undefined || rawApi === "") return LEGACY_CLIENT;
        const api = /^\d{1,6}$/.test(rawApi.trim()) ? Number(rawApi.trim()) : NaN;
        if (!Number.isInteger(api) || api < 1) return LEGACY_CLIENT;
        const rawCaps = headers?.get(CLIENT_CAPS_HEADER) ?? "";
        const capsText = rawCaps.length > MAX_CAPS_HEADER_LENGTH ? rawCaps.slice(0, MAX_CAPS_HEADER_LENGTH) : rawCaps;
        const caps = capsText.split(",").map((c) => c.trim()).filter(Boolean).slice(0, MAX_CLIENT_CAPS);
        return makeClientIdentity(api, caps, false);
    } catch {
        return LEGACY_CLIENT;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// `requires` del manifest
// ---------------------------------------------------------------------------------------------------------------

export type ClientApiComparator = { op: ">=" | ">" | "<=" | "<" | "="; n: number };
export type ManifestRequires = { clientApi?: number | string; capabilities?: string[]; extensions?: Record<string, string> };

const COMPARATOR_RE = /^(>=|<=|>|<|=)?\s*(\d{1,6})$/;

/** "2" | 2 | ">=2" | ">=2 <4" -> comparadores; null si es invalido. Un entero N significa ">=N". */
export function parseClientApiRange(value: unknown): ClientApiComparator[] | null {
    if (typeof value === "number") return Number.isInteger(value) && value >= 1 && value <= 999999 ? [{ op: ">=", n: value }] : null;
    if (typeof value !== "string" || !value.trim() || value.length > 40) return null;
    const out: ClientApiComparator[] = [];
    for (const token of value.trim().split(/\s+/)) {
        const m = COMPARATOR_RE.exec(token);
        if (!m) {
            // "> =2" no se admite; tokens sueltos como ">=" + "2" tampoco.
            return null;
        }
        const n = Number(m[2]);
        if (n < 1) return null;
        out.push({ op: (m[1] as ClientApiComparator["op"] | undefined) ?? ">=", n });
    }
    return out.length > 0 && out.length <= 4 ? out : null;
}

export function clientApiSatisfies(range: ClientApiComparator[], clientApi: number): boolean {
    return range.every(({ op, n }) => (op === ">=" ? clientApi >= n : op === ">" ? clientApi > n : op === "<=" ? clientApi <= n : op === "<" ? clientApi < n : clientApi === n));
}

/** Forma canonica de la expresion de clientApi (la que se guarda en ExtensionVersion.requiresClientApi). null = sin requisito. */
export function normalizeClientApiRange(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    const range = parseClientApiRange(value);
    return range ? range.map((c) => `${c.op}${c.n}`).join(" ") : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Rangos de version semver minimos (dependencias entre extensiones: `requires.extensions`)
// ---------------------------------------------------------------------------------------------------------------

export const DEP_EXTENSION_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
export const MAX_EXTENSION_DEPENDENCIES = 16;
export type SemverComparator = { op: ">=" | ">" | "<=" | "<" | "="; v: [number, number, number] };

/** "1.2.3" -> [1,2,3]; null si no es X.Y.Z (sin prerelease: las extensiones publican versiones estables). */
export function parseSemver(value: unknown): [number, number, number] | null {
    if (typeof value !== "string" || value.length > 32) return null;
    const m = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(value.trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareSemver(a: readonly number[], b: readonly number[]): number {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return 0;
}

/**
 * Rango -> comparadores (AND). Soporta: "*" | "1.2.3" | "^1.2.3" | "~1.2.3" | ">=1.0.0 <2.0.0" (operadores >=, >, <=, <, =).
 * Sin "||", sin prerelease. null = invalido.
 */
export function parseVersionRange(value: unknown): SemverComparator[] | null {
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (!text || text.length > 60) return null;
    if (text === "*" || text.toLowerCase() === "x") return [{ op: ">=", v: [0, 0, 0] }];
    const caret = /^\^(\S+)$/.exec(text);
    const tilde = /^~(\S+)$/.exec(text);
    if (caret || tilde) {
        const v = parseSemver((caret ?? tilde)![1]);
        if (!v) return null;
        let upper: [number, number, number];
        if (tilde) upper = [v[0], v[1] + 1, 0];
        else if (v[0] > 0) upper = [v[0] + 1, 0, 0];
        else if (v[1] > 0) upper = [0, v[1] + 1, 0];
        else upper = [0, 0, v[2] + 1];
        return [{ op: ">=", v }, { op: "<", v: upper }];
    }
    const out: SemverComparator[] = [];
    for (const token of text.split(/\s+/)) {
        const m = /^(>=|<=|>|<|=)?(\d{1,6}\.\d{1,6}\.\d{1,6})$/.exec(token);
        if (!m) return null;
        out.push({ op: (m[1] as SemverComparator["op"] | undefined) ?? "=", v: parseSemver(m[2])! });
    }
    return out.length > 0 && out.length <= 4 ? out : null;
}

export function versionSatisfies(range: string, version: string): boolean {
    const comps = parseVersionRange(range);
    const v = parseSemver(version);
    if (!comps || !v) return false;
    return comps.every(({ op, v: n }) => {
        const c = compareSemver(v, n);
        return op === ">=" ? c >= 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : op === "<" ? c < 0 : c === 0;
    });
}

/** Errores de `requires` (publicacion/sync). Capacidades desconocidas = error: hay que registrarlas antes (decision documentada). */
export function validateRequires(raw: unknown, path = "requires"): Array<{ path: string; message: string; soft?: boolean }> {
    const issues: Array<{ path: string; message: string; soft?: boolean }> = [];
    if (raw === undefined) return issues;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [{ path, message: "Debe ser un objeto { clientApi?, capabilities?, extensions? }" }];
    const r = raw as Record<string, unknown>;
    for (const key of Object.keys(r)) if (key !== "clientApi" && key !== "capabilities" && key !== "extensions") issues.push({ path: `${path}.${key}`, message: "Clave desconocida (solo clientApi, capabilities y extensions)" });
    if (r.clientApi !== undefined && !parseClientApiRange(r.clientApi)) issues.push({ path: `${path}.clientApi`, message: "Debe ser un entero >= 1 o una expresion como \">=2\" / \">=2 <4\"" });
    if (r.capabilities !== undefined) {
        if (!Array.isArray(r.capabilities)) issues.push({ path: `${path}.capabilities`, message: "Debe ser un arreglo de strings" });
        else {
            if (r.capabilities.length > 32) issues.push({ path: `${path}.capabilities`, message: "Maximo 32 capacidades" });
            const seen = new Set<string>();
            r.capabilities.forEach((c: unknown, i: number) => {
                const at = `${path}.capabilities[${i}]`;
                if (typeof c !== "string" || !CAPABILITY_ID_RE.test(c) || c.length > 40) return issues.push({ path: at, message: "Capacidad invalida (minusculas, puntos, guiones)" });
                if (seen.has(c)) issues.push({ path: at, message: `Capacidad duplicada: ${c}` });
                seen.add(c);
                if (!CAPABILITY_REGISTRY[c]) issues.push({ path: at, message: `Capacidad desconocida: ${c}. Registrala en CAPABILITY_REGISTRY (client-contract.ts, las 3 copias) antes de usarla`, soft: true });
            });
        }
    }
    if (r.extensions !== undefined) {
        const ext = r.extensions;
        if (typeof ext !== "object" || ext === null || Array.isArray(ext)) issues.push({ path: `${path}.extensions`, message: "Debe ser un objeto { \"id-extension\": \"^1.0.0\" }" });
        else {
            const entries = Object.entries(ext as Record<string, unknown>);
            if (entries.length > MAX_EXTENSION_DEPENDENCIES) issues.push({ path: `${path}.extensions`, message: `Maximo ${MAX_EXTENSION_DEPENDENCIES} dependencias` });
            for (const [id, range] of entries) {
                if (!DEP_EXTENSION_ID_RE.test(id)) issues.push({ path: `${path}.extensions.${id}`, message: "Id de extension invalido ([a-z0-9-], 2-64)" });
                else if (!parseVersionRange(range)) issues.push({ path: `${path}.extensions.${id}`, message: "Rango semver invalido (ej. \"^1.0.0\", \"~1.2.0\", \">=1.0.0 <2.0.0\", \"*\")" });
            }
            // Un cliente sin ext.dependencies.v1 ignoraria las dependencias y activaria la extension rota.
            const caps = Array.isArray(r.capabilities) ? r.capabilities : [];
            if (entries.length > 0 && !caps.includes("ext.dependencies.v1")) issues.push({ path: `${path}.capabilities`, message: "Si hay requires.extensions, declara tambien la capacidad ext.dependencies.v1" });
        }
    }
    return issues;
}

/** `requires` saneado de un manifest (lo que se guarda en ExtensionVersion). Un manifest sin `requires` valido = linea base. */
export function readRequires(manifest: unknown): { clientApi: string | null; capabilities: string[] } {
    const raw = typeof manifest === "object" && manifest !== null ? (manifest as Record<string, unknown>).requires : undefined;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { clientApi: null, capabilities: [] };
    const r = raw as Record<string, unknown>;
    const caps = Array.isArray(r.capabilities) ? r.capabilities.filter((c): c is string => typeof c === "string" && CAPABILITY_ID_RE.test(c) && c.length <= 40) : [];
    return { clientApi: normalizeClientApiRange(r.clientApi), capabilities: Array.from(new Set(caps)).sort() };
}

/** `requires.extensions` saneado ({ id: rango }); recibe el bloque `requires` del manifest. Va aparte de readRequires para no alterar la forma guardada en ExtensionVersion. entradas invalidas se descartan. Orden estable por id. */
export function readExtensionDependencies(requires: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    const ext = typeof requires === "object" && requires !== null ? (requires as Record<string, unknown>).extensions : undefined;
    if (typeof ext !== "object" || ext === null || Array.isArray(ext)) return out;
    for (const id of Object.keys(ext).sort().slice(0, MAX_EXTENSION_DEPENDENCIES)) {
        const range = (ext as Record<string, unknown>)[id];
        if (DEP_EXTENSION_ID_RE.test(id) && typeof range === "string" && parseVersionRange(range)) out[id] = range.trim();
    }
    return out;
}

export type RequiresEvaluation = {
    ok: boolean;
    /** Capacidades pedidas que el cliente no declara (ordenadas). */
    missingCaps: string[];
    /** Expresion de clientApi que el cliente no cumple (null si la cumple o no se pide). */
    clientApiNeeded: string | null;
};

/** Evalua los requisitos (forma `readRequires`) contra la identidad de un cliente. */
export function evaluateRequires(requires: { clientApi?: string | null; capabilities?: readonly string[] | null } | null | undefined, client: { clientApi: number; capabilities: readonly string[] }): RequiresEvaluation {
    const have = new Set(client.capabilities);
    const missingCaps = (requires?.capabilities ?? []).filter((c) => !have.has(c)).sort();
    const range = requires?.clientApi ? parseClientApiRange(requires.clientApi) : null;
    const apiOk = !range || clientApiSatisfies(range, client.clientApi);
    return { ok: missingCaps.length === 0 && apiOk, missingCaps, clientApiNeeded: apiOk ? null : String(requires?.clientApi) };
}
