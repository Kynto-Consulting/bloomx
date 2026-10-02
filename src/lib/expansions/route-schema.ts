/**
 * Rutas HTTP propias de una extension (`backendRoutes`) y paginas (`PAGE`/`CUSTOM_ROUTE`): esquema, validacion del manifest, emparejado
 * de rutas y validacion de entrada. Puro, sin dependencias de runtime (las comprobaciones con `node:crypto` viven en el backend).
 *
 * FUENTE CANONICA: bloomx-extensions/_shared/route-schema.ts
 * Copias identicas (verificadas por tests/contract.test.mjs):
 *   - bloomx-backend/src/lib/extensions/route-schema.ts   (router /api/ext/[extensionId]/[...path])
 *   - bloomx/src/lib/expansions/route-schema.ts           (validacion de manifest, proxy y paginas)
 *
 * Modos de autenticacion (`auth`). Por defecto `session` (FALLA CERRADO):
 *   session    cualquier usuario con sesion de la instancia (ctx.user disponible)
 *   admin      sesion de administrador con permission_level >= minLevel (1..4); stepUp:true exige step-up reciente
 *   signature  servidor a servidor firmado por la instancia (Ed25519), sin usuario
 *   hmac       tercero con secreto compartido (credencial cifrada del dominio): HMAC en tiempo constante + anti-replay
 *   none       publica; exige el permiso PUBLIC_ROUTE aprobado por el admin del dominio; sin usuario, sin cookies, limites mas estrictos
 */

import { regexProblem } from "./settings-schema.ts";

export const ROUTE_AUTH_MODES = ["session", "admin", "signature", "hmac", "none"] as const;
export type RouteAuthMode = (typeof ROUTE_AUTH_MODES)[number];
export const DEFAULT_ROUTE_AUTH: RouteAuthMode = "session";
export const ROUTE_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type RouteMethod = (typeof ROUTE_METHODS)[number];
export const PUBLIC_ROUTE_PERMISSION = "PUBLIC_ROUTE";

export const ROUTE_LIMITS = {
    maxRoutes: 40,
    maxPathLength: 120,
    maxSegments: 8,
    maxBodyBytes: 1_048_576,
    /** Rutas `none`: cuerpo reducido. */
    maxPublicBodyBytes: 65_536,
    defaultBodyBytes: 262_144,
    maxResponseBytes: 1_048_576,
    maxPublicResponseBytes: 262_144,
    minTimeoutMs: 100,
    maxTimeoutMs: 30_000,
    defaultTimeoutMs: 10_000,
    defaultRatePerMinute: 120,
    maxRatePerMinute: 600,
    /** Rutas `none`: por IP y por ruta. */
    defaultPublicRatePerMinute: 30,
    maxPublicRatePerMinute: 60,
    minToleranceSec: 30,
    maxToleranceSec: 900,
    defaultToleranceSec: 300,
    maxInputFields: 40,
    maxInputDepth: 4,
    maxStringLength: 10_000,
    maxArrayItems: 200,
} as const;

/** Destinos de `dispatch`: punto de hook que reciben las extensiones consumidoras. */
export const ROUTE_DISPATCH_TARGETS = { "discord-interaction": "DISCORD_INTERACTION" } as const;
export type RouteDispatch = keyof typeof ROUTE_DISPATCH_TARGETS;

export type RouteHmac = {
    header: string;
    /** `ed25519` = firma asimetrica (Discord Interactions): `secretCredential` guarda la CLAVE PUBLICA en hexadecimal (64 caracteres). Exige signedPayload "timestamp+body", encoding hex y timestampHeader. */
    algorithm: "sha256" | "sha512" | "ed25519";
    encoding?: "hex" | "base64";
    prefix?: string;
    secretCredential: string;
    timestampHeader?: string;
    /** Acepta repeticiones dentro de la ventana de firma (sin timestamp). Explicito: sin esto, `timestampHeader` es obligatorio. */
    allowReplay?: boolean;
    toleranceSec?: number;
    /** Que firma el tercero: `body` | `timestamp.body` | `v0:timestamp:body` (estilo Slack). */
    signedPayload?: "body" | "timestamp.body" | "v0:timestamp:body" | "timestamp+body";
};

export type InputField = {
    type: "string" | "number" | "integer" | "boolean" | "array" | "object";
    required?: boolean;
    maxLength?: number;
    minLength?: number;
    pattern?: string;
    enum?: Array<string | number>;
    min?: number;
    max?: number;
    maxItems?: number;
    items?: InputField;
    properties?: Record<string, InputField>;
    additionalProperties?: boolean;
};

export type RouteInput = {
    query?: Record<string, Pick<InputField, "type" | "required" | "maxLength" | "pattern" | "enum" | "min" | "max">>;
    body?: InputField & { type: "object" };
};

export type ManifestRoute = {
    path: string;
    handler: string;
    method?: RouteMethod;
    methods?: RouteMethod[];
    auth?: RouteAuthMode;
    minLevel?: number;
    stepUp?: boolean;
    /** La ruta (aunque sea GET) cambia estado: se rechaza si llega de otro sitio (Sec-Fetch-Site: cross-site). */
    sideEffects?: boolean;
    hmac?: RouteHmac;
    /** Tras verificar la firma, el router entrega el evento a los hooks de las extensiones instaladas (ver ROUTE_DISPATCH_TARGETS) en lugar de ejecutar `handler`. Solo con hmac ed25519. */
    dispatch?: RouteDispatch;
    input?: RouteInput;
    maxBodyBytes?: number;
    timeoutMs?: number;
    rateLimit?: { limit: number; windowSec?: number };
    /** Origenes https EXACTOS permitidos por CORS (nunca "*", nunca con credenciales). */
    cors?: { origins: string[] };
};

type Sink = (path: string, message: string) => void;

const SEGMENT_RE = /^[A-Za-z0-9._~-]{1,64}$/;
const PARAM_RE = /^:[A-Za-z][A-Za-z0-9_]{0,31}$/;
const HEADER_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const FIELD_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const FORBIDDEN_HMAC_HEADERS = new Set(["authorization", "cookie", "set-cookie", "host", "content-type", "content-length", "x-bloomx-signature", "x-bloomx-timestamp", "x-bloomx-nonce"]);

// `public` es del formato antiguo (nunca se sirvio): se IGNORA; jamas concede auth: none (eso exige auth + PUBLIC_ROUTE).
const LEGACY_ROUTE_KEYS = new Set(["path", "handler", "method", "public"]);
/** true si la ruta usa algo mas que el formato antiguo {path, handler, method}. */
export function usesNewRouteFields(route: unknown): boolean {
    return typeof route === "object" && route !== null && Object.keys(route).some((k) => !LEGACY_ROUTE_KEYS.has(k));
}

export function routeMethods(route: { method?: unknown; methods?: unknown }): RouteMethod[] {
    const out: RouteMethod[] = [];
    const add = (m: unknown) => { if (typeof m === "string" && (ROUTE_METHODS as readonly string[]).includes(m.toUpperCase()) && !out.includes(m.toUpperCase() as RouteMethod)) out.push(m.toUpperCase() as RouteMethod); };
    if (Array.isArray(route.methods)) route.methods.forEach(add);
    if (route.method !== undefined) add(route.method);
    return out.length > 0 ? out : ["GET"];
}

export function routeAuthOf(route: { auth?: unknown } | null | undefined): RouteAuthMode {
    const a = route?.auth;
    return typeof a === "string" && (ROUTE_AUTH_MODES as readonly string[]).includes(a) ? (a as RouteAuthMode) : DEFAULT_ROUTE_AUTH;
}

/** Valida una ruta (`/a/b/:id`). Devuelve el motivo del rechazo o null. Sin comodines, sin `..`, sin segmentos vacios. */
export function checkRoutePath(path: unknown): string | null {
    if (typeof path !== "string" || !path.startsWith("/")) return "Debe empezar con /";
    if (path.length > ROUTE_LIMITS.maxPathLength) return `Maximo ${ROUTE_LIMITS.maxPathLength} caracteres`;
    if (path === "/") return null;
    if (path.endsWith("/")) return "Sin / final";
    const segments = path.slice(1).split("/");
    if (segments.length > ROUTE_LIMITS.maxSegments) return `Maximo ${ROUTE_LIMITS.maxSegments} segmentos`;
    const params = new Set<string>();
    for (const s of segments) {
        if (s === "." || s === "..") return "Sin segmentos . ni ..";
        if (s.startsWith(":")) {
            if (!PARAM_RE.test(s)) return `Parametro invalido: ${s}`;
            if (params.has(s)) return `Parametro repetido: ${s}`;
            params.add(s);
        } else if (!SEGMENT_RE.test(s)) return `Segmento invalido (solo A-Z a-z 0-9 . _ ~ -; sin comodines): ${s.slice(0, 40)}`;
    }
    return null;
}

/** "/hook/:id" frente a "/hook/42" -> { id: "42" } | null. Coincidencia EXACTA segmento a segmento. */
function safeRoutePattern(pattern: string, value: string): boolean {
    try {
        if (pattern.length > 100 || regexProblem(pattern)) return false;
        return new RegExp(pattern).test(value);
    } catch {
        return false;
    }
}

export function matchRoutePath(pattern: string, actual: string): Record<string, string> | null {
    if (pattern === "/" || actual === "/") return pattern === actual ? {} : null;
    const p = pattern.split("/").slice(1);
    const a = actual.split("/").slice(1);
    if (p.length !== a.length) return null;
    const params: Record<string, string> = {};
    for (let i = 0; i < p.length; i++) {
        if (p[i].startsWith(":")) {
            if (!SEGMENT_RE.test(a[i]) || a[i] === "." || a[i] === "..") return null;
            params[p[i].slice(1)] = a[i];
        } else if (p[i] !== a[i] || a[i] === ".." ) return null;
    }
    return params;
}

/** Forma de un patron (`/a/:x` y `/a/:y` colisionan). */
const shapeOf = (path: string) => path.split("/").map((s) => (s.startsWith(":") ? ":" : s)).join("/");

function validateInputField(raw: unknown, at: string, err: Sink, depth: number, counter: { n: number }): void {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return err(at, "Debe ser un objeto");
    const f = raw as Record<string, unknown>;
    if (++counter.n > ROUTE_LIMITS.maxInputFields) return err(at, `Maximo ${ROUTE_LIMITS.maxInputFields} campos de entrada`);
    if (depth > ROUTE_LIMITS.maxInputDepth) return err(at, `Anidamiento maximo ${ROUTE_LIMITS.maxInputDepth}`);
    if (!["string", "number", "integer", "boolean", "array", "object"].includes(String(f.type))) return err(`${at}.type`, "string | number | integer | boolean | array | object");
    if (f.pattern !== undefined) {
        const problem = typeof f.pattern === "string" && f.pattern.length <= 100 ? regexProblem(f.pattern) : "pattern invalido (max 100)";
        if (problem) err(`${at}.pattern`, problem);
    }
    for (const k of ["maxLength", "minLength", "maxItems", "min", "max"]) if (f[k] !== undefined && (typeof f[k] !== "number" || !Number.isFinite(f[k] as number))) err(`${at}.${k}`, "Debe ser numero");
    if (typeof f.maxLength === "number" && f.maxLength > ROUTE_LIMITS.maxStringLength) err(`${at}.maxLength`, `Maximo ${ROUTE_LIMITS.maxStringLength}`);
    if (f.enum !== undefined && (!Array.isArray(f.enum) || f.enum.length === 0 || f.enum.length > 100 || !f.enum.every((v) => typeof v === "string" || typeof v === "number"))) err(`${at}.enum`, "Arreglo de strings/numeros (max 100)");
    if (f.type === "array") {
        if (f.items === undefined) err(`${at}.items`, "Requerido en arreglos");
        else validateInputField(f.items, `${at}.items`, err, depth + 1, counter);
    }
    if (f.type === "object") {
        if (typeof f.properties !== "object" || f.properties === null || Array.isArray(f.properties)) err(`${at}.properties`, "Requerido en objetos");
        else for (const [name, sub] of Object.entries(f.properties as Record<string, unknown>)) {
            if (!FIELD_NAME_RE.test(name) || name === "__proto__" || name === "constructor" || name === "prototype") err(`${at}.properties.${name}`, "Nombre de campo invalido");
            else validateInputField(sub, `${at}.properties.${name}`, err, depth + 1, counter);
        }
    }
}

export type RouteValidationContext = {
    functionNames: ReadonlySet<string>;
    permissions: readonly string[];
    /** Claves de campos `secret:true` del settingsSchema. */
    secretKeys: readonly string[];
    /** Nombres de ENV_READ:* declarados. */
    envReads: readonly string[];
    capabilities: readonly string[];
};

/** Valida `backendRoutes` de un manifest. */
export function validateBackendRoutes(raw: unknown, err: Sink, warn: Sink, ctx: RouteValidationContext): void {
    if (raw === undefined) return;
    if (!Array.isArray(raw)) return err("backendRoutes", "Debe ser un arreglo");
    if (raw.length > ROUTE_LIMITS.maxRoutes) err("backendRoutes", `Maximo ${ROUTE_LIMITS.maxRoutes} rutas`);
    const seen = new Map<string, string>();
    let usesAuthFields = false;
    let hasNone = false;
    raw.forEach((r: unknown, index: number) => {
        const at = `backendRoutes[${index}]`;
        if (typeof r !== "object" || r === null || Array.isArray(r)) return err(at, "Debe ser un objeto");
        const route = r as Record<string, unknown>;
        const pathProblem = checkRoutePath(route.path);
        if (pathProblem) err(`${at}.path`, pathProblem);
        if (typeof route.handler !== "string" || !ctx.functionNames.has(route.handler)) err(`${at}.handler`, "Debe ser una funcion declarada en api.functions");
        for (const m of [...(Array.isArray(route.methods) ? route.methods : []), ...(route.method !== undefined ? [route.method] : [])]) {
            if (typeof m !== "string" || !(ROUTE_METHODS as readonly string[]).includes(m.toUpperCase())) err(`${at}.method`, `Metodo no permitido (${ROUTE_METHODS.join(", ")})`);
        }
        const methods = routeMethods(route);
        if (typeof route.path === "string" && !pathProblem) {
            const shape = shapeOf(route.path);
            for (const m of methods) {
                const key = `${m} ${shape}`;
                if (seen.has(key)) err(`${at}.path`, `Ruta duplicada o ambigua: ${m} ${route.path}`);
                seen.set(key, route.path);
            }
        }

        // ---- auth ----
        if (route.auth !== undefined && !(ROUTE_AUTH_MODES as readonly string[]).includes(String(route.auth))) err(`${at}.auth`, `Debe ser uno de ${ROUTE_AUTH_MODES.join(", ")}`);
        const auth = routeAuthOf(route);
        if (route.auth !== undefined || route.minLevel !== undefined || route.hmac !== undefined || route.stepUp !== undefined) usesAuthFields = true;
        if (route.minLevel !== undefined) {
            if (auth !== "admin") err(`${at}.minLevel`, "Solo con auth: \"admin\"");
            else if (!Number.isInteger(route.minLevel) || (route.minLevel as number) < 1 || (route.minLevel as number) > 4) err(`${at}.minLevel`, "Entero 1..4");
        }
        if (route.sideEffects !== undefined && typeof route.sideEffects !== "boolean") err(`${at}.sideEffects`, "Booleano");
        if (route.stepUp !== undefined) {
            if (typeof route.stepUp !== "boolean") err(`${at}.stepUp`, "Debe ser boolean");
            else if (route.stepUp && auth !== "admin") err(`${at}.stepUp`, "Solo con auth: \"admin\"");
        }
        if (auth === "hmac") {
            const h = route.hmac as Record<string, unknown> | undefined;
            if (typeof h !== "object" || h === null || Array.isArray(h)) err(`${at}.hmac`, "Requerido con auth: \"hmac\"");
            else {
                if (typeof h.header !== "string" || !HEADER_RE.test(h.header) || FORBIDDEN_HMAC_HEADERS.has(h.header)) err(`${at}.hmac.header`, "Cabecera en minusculas (no authorization/cookie/host/x-bloomx-*)");
                if (h.algorithm !== "sha256" && h.algorithm !== "sha512" && h.algorithm !== "ed25519") err(`${at}.hmac.algorithm`, "sha256, sha512 o ed25519 (sha1/md5 no se admiten)");
                if (h.encoding !== undefined && h.encoding !== "hex" && h.encoding !== "base64") err(`${at}.hmac.encoding`, "hex o base64");
                if (h.prefix !== undefined && (typeof h.prefix !== "string" || h.prefix.length > 20)) err(`${at}.hmac.prefix`, "String (max 20), p. ej. \"sha256=\"");
                if (typeof h.secretCredential !== "string" || !SECRET_NAME_RE.test(h.secretCredential)) err(`${at}.hmac.secretCredential`, "Nombre en MAYUSCULAS de una credencial del dominio");
                else if (!ctx.secretKeys.includes(h.secretCredential) && !ctx.envReads.includes(h.secretCredential)) err(`${at}.hmac.secretCredential`, `Debe ser un campo secret:true del settingsSchema o un ENV_READ declarado: ${h.secretCredential}`);
                if (h.timestampHeader !== undefined && (typeof h.timestampHeader !== "string" || !HEADER_RE.test(h.timestampHeader) || FORBIDDEN_HMAC_HEADERS.has(h.timestampHeader))) err(`${at}.hmac.timestampHeader`, "Cabecera en minusculas");
                if (h.toleranceSec !== undefined && (!Number.isInteger(h.toleranceSec) || (h.toleranceSec as number) < ROUTE_LIMITS.minToleranceSec || (h.toleranceSec as number) > ROUTE_LIMITS.maxToleranceSec)) err(`${at}.hmac.toleranceSec`, `Entero ${ROUTE_LIMITS.minToleranceSec}..${ROUTE_LIMITS.maxToleranceSec}`);
                if (h.signedPayload !== undefined && !["body", "timestamp.body", "v0:timestamp:body", "timestamp+body"].includes(String(h.signedPayload))) err(`${at}.hmac.signedPayload`, "body | timestamp.body | v0:timestamp:body | timestamp+body");
                if (h.signedPayload !== undefined && h.signedPayload !== "body" && !h.timestampHeader) err(`${at}.hmac.timestampHeader`, "Requerido si el payload firmado incluye el timestamp (anti-replay)");
                if (h.algorithm === "ed25519") {
                    if (h.signedPayload !== "timestamp+body") err(`${at}.hmac.signedPayload`, "ed25519 firma timestamp+body (Discord): declara signedPayload: \"timestamp+body\"");
                    if (h.encoding !== undefined && h.encoding !== "hex") err(`${at}.hmac.encoding`, "ed25519 usa hex");
                    if (h.prefix !== undefined) err(`${at}.hmac.prefix`, "ed25519 no admite prefix");
                    if (!h.timestampHeader) err(`${at}.hmac.timestampHeader`, "ed25519 exige timestampHeader (anti-replay)");
                    if (h.allowReplay === true) err(`${at}.hmac.allowReplay`, "ed25519 no admite allowReplay");
                } else if (h.signedPayload === "timestamp+body") err(`${at}.hmac.signedPayload`, "timestamp+body solo con algorithm ed25519");
                if (h.allowReplay !== undefined && typeof h.allowReplay !== "boolean") err(`${at}.hmac.allowReplay`, "Booleano");
                if (!h.timestampHeader && h.allowReplay !== true) err(`${at}.hmac.timestampHeader`, "Requerido (anti-replay). Si el tercero no envia timestamp, declara allowReplay: true de forma explicita: la deteccion de firma repetida es solo por proceso y NO es una defensa fuerte en serverless");
                else if (!h.timestampHeader) warn(`${at}.hmac.allowReplay`, "Sin timestampHeader no hay proteccion de repeticion fuerte (la deteccion de firma repetida es por proceso y no es fiable en serverless)");
            }
        } else if (route.hmac !== undefined) err(`${at}.hmac`, "Solo con auth: \"hmac\"");
        if (route.dispatch !== undefined) {
            usesAuthFields = true;
            const hm = route.hmac as Record<string, unknown> | undefined;
            if (typeof route.dispatch !== "string" || !Object.prototype.hasOwnProperty.call(ROUTE_DISPATCH_TARGETS, route.dispatch)) err(`${at}.dispatch`, `Debe ser uno de ${Object.keys(ROUTE_DISPATCH_TARGETS).join(", ")}`);
            else if (auth !== "hmac" || !hm || hm.algorithm !== "ed25519") err(`${at}.dispatch`, "Solo con auth: \"hmac\" y algorithm: \"ed25519\"");
            if (route.dispatch !== undefined && !methods.includes("POST")) err(`${at}.dispatch`, "Una ruta con dispatch es POST");
        }
        if (auth === "none") {
            hasNone = true;
            if (!ctx.permissions.includes(PUBLIC_ROUTE_PERMISSION)) err(`${at}.auth`, "auth: \"none\" exige declarar el permiso PUBLIC_ROUTE (riesgo alto, aprobacion explicita del admin)");
        }

        // ---- limites ----
        const bodyCap = auth === "none" ? ROUTE_LIMITS.maxPublicBodyBytes : ROUTE_LIMITS.maxBodyBytes;
        if (route.maxBodyBytes !== undefined && (!Number.isInteger(route.maxBodyBytes) || (route.maxBodyBytes as number) < 0 || (route.maxBodyBytes as number) > bodyCap)) err(`${at}.maxBodyBytes`, `Entero 0..${bodyCap}`);
        if (route.timeoutMs !== undefined && (!Number.isInteger(route.timeoutMs) || (route.timeoutMs as number) < ROUTE_LIMITS.minTimeoutMs || (route.timeoutMs as number) > ROUTE_LIMITS.maxTimeoutMs)) err(`${at}.timeoutMs`, `Entero ${ROUTE_LIMITS.minTimeoutMs}..${ROUTE_LIMITS.maxTimeoutMs}`);
        if (route.rateLimit !== undefined) {
            const rl = route.rateLimit as Record<string, unknown>;
            const cap = auth === "none" ? ROUTE_LIMITS.maxPublicRatePerMinute : ROUTE_LIMITS.maxRatePerMinute;
            if (typeof rl !== "object" || rl === null || !Number.isInteger(rl.limit) || (rl.limit as number) < 1 || (rl.limit as number) > cap) err(`${at}.rateLimit.limit`, `Entero 1..${cap} por minuto`);
            if (rl && rl.windowSec !== undefined && rl.windowSec !== 60) err(`${at}.rateLimit.windowSec`, "Solo 60 (limite por minuto)");
        }
        if (route.cors !== undefined) {
            const c = route.cors as Record<string, unknown>;
            if (typeof c !== "object" || c === null || !Array.isArray(c.origins) || c.origins.length === 0 || c.origins.length > 10) err(`${at}.cors.origins`, "Arreglo de 1..10 origenes https exactos");
            else c.origins.forEach((o: unknown, i: number) => {
                let ok = false;
                try { const u = new URL(String(o)); ok = u.protocol === "https:" && u.origin === o && !u.username && !String(o).includes("*"); } catch { ok = false; }
                if (!ok) err(`${at}.cors.origins[${i}]`, "Origen https exacto (p. ej. https://app.example.com), sin comodines");
            });
        }

        // ---- entrada ----
        if (route.input !== undefined) {
            const input = route.input as Record<string, unknown>;
            if (typeof input !== "object" || input === null || Array.isArray(input)) err(`${at}.input`, "Debe ser un objeto { query?, body? }");
            else {
                const counter = { n: 0 };
                if (input.query !== undefined) {
                    if (typeof input.query !== "object" || input.query === null || Array.isArray(input.query)) err(`${at}.input.query`, "Debe ser un objeto { nombre: campo }");
                    else for (const [name, f] of Object.entries(input.query as Record<string, unknown>)) {
                        if (!FIELD_NAME_RE.test(name)) { err(`${at}.input.query.${name}`, "Nombre invalido"); continue; }
                        validateInputField(f, `${at}.input.query.${name}`, err, ROUTE_LIMITS.maxInputDepth, counter);
                        const t = (f as Record<string, unknown>)?.type;
                        if (t === "array" || t === "object") err(`${at}.input.query.${name}.type`, "En query solo string/number/integer/boolean");
                    }
                }
                if (input.body !== undefined) {
                    if ((input.body as Record<string, unknown>)?.type !== "object") err(`${at}.input.body.type`, "El cuerpo debe ser de tipo object");
                    else validateInputField(input.body, `${at}.input.body`, err, 0, counter);
                }
                if (input.body !== undefined && methods.every((m) => m === "GET" || m === "DELETE")) warn(`${at}.input.body`, "Un metodo GET/DELETE no suele llevar cuerpo");
            }
        }
    });
    if (usesAuthFields && !ctx.capabilities.includes("ext.routes.auth.v1")) err("requires.capabilities", "Rutas con auth/minLevel/hmac exigen declarar la capacidad ext.routes.auth.v1");
    // Las rutas del formato antiguo ({path, handler, method}) siguen siendo validas sin capacidad; lo nuevo exige ext.routes.v1.
    if (raw.some(usesNewRouteFields) && !ctx.capabilities.includes("ext.routes.v1")) err("requires.capabilities", "Las rutas con auth/input/cors/limites/methods exigen declarar la capacidad ext.routes.v1");
    void hasNone;
}

// ---------------------------------------------------------------------------------------------------------------
// Validacion de la ENTRADA de una peticion contra `input`
// ---------------------------------------------------------------------------------------------------------------

export type InputIssue = { path: string; code: "required" | "type" | "max" | "min" | "pattern" | "enum" | "unknown" | "length" | "items" };

function coerceQuery(value: string, type: string): unknown {
    if (type === "number") return value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : value;
    if (type === "integer") return /^-?\d{1,15}$/.test(value) ? Number(value) : value;
    if (type === "boolean") return value === "true" ? true : value === "false" ? false : value;
    return value;
}

function checkValue(value: unknown, f: InputField, path: string, issues: InputIssue[], depth: number): unknown {
    if (depth > ROUTE_LIMITS.maxInputDepth + 1) { issues.push({ path, code: "type" }); return undefined; }
    switch (f.type) {
        case "string": {
            if (typeof value !== "string") { issues.push({ path, code: "type" }); return undefined; }
            const max = Math.min(f.maxLength ?? ROUTE_LIMITS.maxStringLength, ROUTE_LIMITS.maxStringLength);
            if (value.length > max) issues.push({ path, code: "max" });
            if (typeof f.minLength === "number" && value.length < f.minLength) issues.push({ path, code: "min" });
            if (f.pattern && !safeRoutePattern(f.pattern, value)) issues.push({ path, code: "pattern" });
            if (f.enum && !f.enum.includes(value)) issues.push({ path, code: "enum" });
            return value;
        }
        case "number":
        case "integer": {
            if (typeof value !== "number" || !Number.isFinite(value) || (f.type === "integer" && !Number.isInteger(value))) { issues.push({ path, code: "type" }); return undefined; }
            if (typeof f.min === "number" && value < f.min) issues.push({ path, code: "min" });
            if (typeof f.max === "number" && value > f.max) issues.push({ path, code: "max" });
            if (f.enum && !f.enum.includes(value)) issues.push({ path, code: "enum" });
            return value;
        }
        case "boolean":
            if (typeof value !== "boolean") { issues.push({ path, code: "type" }); return undefined; }
            return value;
        case "array": {
            if (!Array.isArray(value)) { issues.push({ path, code: "type" }); return undefined; }
            const max = Math.min(f.maxItems ?? ROUTE_LIMITS.maxArrayItems, ROUTE_LIMITS.maxArrayItems);
            if (value.length > max) { issues.push({ path, code: "items" }); return undefined; }
            return f.items ? value.map((v, i) => checkValue(v, f.items as InputField, `${path}[${i}]`, issues, depth + 1)) : value;
        }
        case "object": {
            if (typeof value !== "object" || value === null || Array.isArray(value)) { issues.push({ path, code: "type" }); return undefined; }
            const out: Record<string, unknown> = {};
            const props = f.properties ?? {};
            for (const [name, sub] of Object.entries(props)) {
                const v = (value as Record<string, unknown>)[name];
                if (v === undefined || v === null) { if (sub.required) issues.push({ path: `${path}.${name}`, code: "required" }); continue; }
                const checked = checkValue(v, sub, `${path}.${name}`, issues, depth + 1);
                if (checked !== undefined) out[name] = checked;
            }
            for (const key of Object.keys(value as object)) {
                if (key === "__proto__" || key === "constructor" || key === "prototype") { issues.push({ path: `${path}.${key}`, code: "unknown" }); continue; }
                if (!(key in props) && f.additionalProperties !== true) issues.push({ path: `${path}.${key}`, code: "unknown" });
                else if (!(key in props) && f.additionalProperties === true) out[key] = (value as Record<string, unknown>)[key];
            }
            return out;
        }
        default:
            issues.push({ path, code: "type" });
            return undefined;
    }
}

/** Valida y NORMALIZA query y cuerpo contra `input`. Campos de query no declarados se rechazan (sin parametros ocultos). */
export function validateRouteInput(spec: RouteInput | undefined, input: { query: Record<string, string>; body: unknown }): { ok: boolean; issues: InputIssue[]; query: Record<string, unknown>; body: unknown } {
    const issues: InputIssue[] = [];
    const query: Record<string, unknown> = {};
    if (!spec) return { ok: true, issues, query: { ...input.query }, body: input.body };
    const declared = spec.query ?? {};
    for (const [name, f] of Object.entries(declared)) {
        const raw = input.query[name];
        if (raw === undefined) { if (f.required) issues.push({ path: `query.${name}`, code: "required" }); continue; }
        const checked = checkValue(coerceQuery(raw, f.type), f as InputField, `query.${name}`, issues, 0);
        if (checked !== undefined) query[name] = checked;
    }
    if (spec.query) for (const name of Object.keys(input.query)) if (!(name in declared)) issues.push({ path: `query.${name}`, code: "unknown" });
    let body: unknown = input.body;
    if (spec.body) {
        if (input.body === undefined || input.body === null) issues.push({ path: "body", code: "required" });
        else body = checkValue(input.body, spec.body as InputField, "body", issues, 0);
    }
    return { ok: issues.length === 0, issues: issues.slice(0, 20), query: spec.query ? query : { ...input.query }, body };
}

// ---------------------------------------------------------------------------------------------------------------
// Paginas (mounts PAGE / CUSTOM_ROUTE): mismos campos `auth` / `minLevel`
// ---------------------------------------------------------------------------------------------------------------

export const PAGE_AUTH_MODES = ["session", "admin", "none"] as const;
export const PAGE_MOUNT_POINTS = ["PAGE", "CUSTOM_ROUTE"];

/** `auth` de una pagina (mount PAGE/CUSTOM_ROUTE); por defecto `session` (falla cerrado). */
export function pageAuthOf(mount: { auth?: unknown } | null | undefined): "session" | "admin" | "none" {
    const a = mount?.auth;
    return a === "admin" || a === "none" ? a : "session";
}

/** Valida `auth`/`minLevel` de un mount. Solo PAGE y CUSTOM_ROUTE; `none` exige PUBLIC_ROUTE; los campos exigen ext.pages.auth.v1. */
export function validatePageAuth(mount: Record<string, unknown>, at: string, err: Sink, ctx: { permissions: readonly string[]; capabilities: readonly string[] }): void {
    const has = mount.auth !== undefined || mount.minLevel !== undefined;
    if (!has) return;
    if (!PAGE_MOUNT_POINTS.includes(String(mount.point))) return err(`${at}.auth`, "auth/minLevel solo aplican a los mounts PAGE y CUSTOM_ROUTE");
    if (mount.auth !== undefined && !(PAGE_AUTH_MODES as readonly string[]).includes(String(mount.auth))) err(`${at}.auth`, `Debe ser uno de ${PAGE_AUTH_MODES.join(", ")} (las paginas no usan signature/hmac)`);
    if (mount.minLevel !== undefined) {
        if (mount.auth !== "admin") err(`${at}.minLevel`, "Solo con auth: \"admin\"");
        else if (!Number.isInteger(mount.minLevel) || (mount.minLevel as number) < 1 || (mount.minLevel as number) > 4) err(`${at}.minLevel`, "Entero 1..4");
    }
    if (mount.auth === "none" && !ctx.permissions.includes(PUBLIC_ROUTE_PERMISSION)) err(`${at}.auth`, "auth: \"none\" exige declarar el permiso PUBLIC_ROUTE");
    if (!ctx.capabilities.includes("ext.pages.auth.v1")) err("requires.capabilities", "auth/minLevel en paginas exigen declarar la capacidad ext.pages.auth.v1");
}

// ---------------------------------------------------------------------------------------------------------------
// Aprobaciones de permisos de riesgo por el admin del dominio (PUBLIC_ROUTE POR RUTA)
// ---------------------------------------------------------------------------------------------------------------

/** Clave de aprobacion de una ruta/pagina publica: `PUBLIC_ROUTE:<METODO> <ruta>` o `PUBLIC_ROUTE:PAGE <ruta>`. */
export function publicRouteApprovalKey(kind: string, path: string): string {
    return `${PUBLIC_ROUTE_PERMISSION}:${kind.toUpperCase()} ${path}`;
}

/** Aprobaciones PUBLIC_ROUTE que un manifest necesita (una por metodo+ruta `none` y una por pagina `none`). Orden estable. */
export function publicRouteApprovalKeys(manifest: unknown): string[] {
    const m = (typeof manifest === "object" && manifest !== null ? manifest : {}) as { backendRoutes?: unknown; mounts?: unknown };
    const keys = new Set<string>();
    if (Array.isArray(m.backendRoutes)) {
        for (const r of m.backendRoutes as ManifestRoute[]) {
            if (!r || typeof r.path !== "string" || routeAuthOf(r) !== "none") continue;
            for (const method of routeMethods(r)) keys.add(publicRouteApprovalKey(method, r.path));
        }
    }
    if (Array.isArray(m.mounts)) {
        for (const mt of m.mounts as Array<{ point?: unknown; path?: unknown; auth?: unknown }>) {
            if (mt && PAGE_MOUNT_POINTS.includes(String(mt.point)) && typeof mt.path === "string" && pageAuthOf(mt) === "none") keys.add(publicRouteApprovalKey("PAGE", mt.path));
        }
    }
    return Array.from(keys).sort();
}
