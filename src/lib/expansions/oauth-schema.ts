import { regexProblem } from "./settings-schema.ts";

/**
 * Esquema y validador (puro, sin dependencias) del bloque `oauthProviders` de un manifest de extension.
 *
 * FUENTE CANONICA: bloomx-extensions/_shared/oauth-schema.ts
 * Copias identicas (verificadas por tests/contract.test.mjs):
 *   - bloomx-backend/src/lib/extensions/oauth-schema.ts
 *   - bloomx/src/lib/expansions/oauth-schema.ts
 *
 * Una extension DECLARA un proveedor OAuth2/OIDC; el NUCLEO de cada instancia ejecuta el flujo (authorize/callback/refresh/revoke),
 * guarda los tokens cifrados en la tabla de cuentas OAuth y presta ACCIONES a las demas extensiones. Los tokens jamas llegan a
 * una extension. Ver _shared/OAUTH-PROVIDERS.md.
 *
 * Rigor SSRF (se revalida en el nucleo al registrar y en CADA llamada; esto es la primera barrera, al publicar):
 *  - authorizeUrl/tokenUrl/revokeUrl/userinfoUrl: https, sin credenciales, sin puerto distinto de 443, host en `allowedHosts`.
 *  - `allowedHosts`: nombres DNS (o "*.dominio.tld" de >= 2 etiquetas); jamas IP literal, localhost, .local/.internal ni rangos privados.
 */

export type OAuthRisk = "low" | "medium" | "high" | "critical";
export const OAUTH_RISKS: OAuthRisk[] = ["low", "medium", "high", "critical"];

export const OAUTH_PROVIDER_ID_RE = /^[a-z][a-z0-9-]{1,31}$/;
export const OAUTH_LIMITS = { maxProviders: 4, maxScopes: 64, maxHosts: 12, maxExtraParams: 8, maxText: 200, maxUrl: 500, maxScopeId: 300 };

/** Parametros que controla el nucleo: una extension NO puede fijarlos via extraParams. */
export const OAUTH_RESERVED_PARAMS = [
    "client_id", "client_secret", "redirect_uri", "response_type", "state", "nonce", "scope", "code", "code_verifier",
    "code_challenge", "code_challenge_method", "grant_type", "refresh_token", "token", "assertion",
];

export type OAuthScopeDef = { id: string; group: string; es: string; en: string; risk: OAuthRisk };
export const OAUTH_ACTION_ID_RE = /^[a-z][a-zA-Z0-9]{0,31}(?:\.[a-zA-Z][a-zA-Z0-9]{0,31}){0,3}$/;
export const OAUTH_ACTION_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export const OAUTH_ACTION_LIMITS = { maxActions: 120, maxParams: 12, maxPathLength: 300, maxResponseBytes: 2_000_000, defaultResponseBytes: 512_000, maxBodyBytes: 1_000_000, maxStringLength: 900_000, maxFixedQuery: 6 };

/** Identidades que puede usar una accion ademas de la cuenta VINCULADA del usuario: credenciales compartidas del dominio (permiso OAUTH_SHARED). */
export const OAUTH_PRINCIPALS = ["user", "organizer", "service"] as const;
export type OAuthPrincipal = (typeof OAUTH_PRINCIPALS)[number];

/** Parametro de una accion: va en la ruta (`{nombre}`), la query o el cuerpo JSON. El nucleo valida tipo y limites ANTES de llamar al proveedor. */
export type OAuthActionParam = {
    in: "path" | "query" | "body";
    type: "string" | "number" | "integer" | "boolean" | "object" | "array";
    required?: boolean;
    maxLength?: number;
    pattern?: string;
    enum?: Array<string | number>;
    min?: number;
    max?: number;
    /** Nombre REAL del parametro de query cuando no cabe en [A-Za-z][A-Za-z0-9_]* (p. ej. Microsoft Graph: "$top", "$select"). Solo en query. */
    queryName?: string;
    /** Clave de un ajuste NO secreto del settingsSchema con una lista separada por comas: el valor del parametro (string) DEBE estar en ella. Lista vacia = nada permitido (p. ej. canales de Slack). */
    allowedFromSetting?: string;
};

/**
 * ACCION que el proveedor ofrece a las demas extensiones. Las extensiones NO pueden construir peticiones libres: solo invocan acciones
 * declaradas aqui. El nucleo comprueba el grupo de scopes concedido a la cuenta, sustituye los parametros (codificados) y llama a
 * `apiBase + path` con el token del usuario. Nunca se devuelve el token ni cabeceras del proveedor.
 */
export type OAuthActionDef = {
    id: string;
    /** Grupo de scopes (OAuthScopeDef.group) cuyo permiso OAUTH_ACCOUNT:<proveedor>:<grupo> hace falta. */
    group: string;
    method: (typeof OAUTH_ACTION_METHODS)[number];
    /** Ruta relativa a apiBase con `{param}` para parametros de ruta. */
    path: string;
    params?: Record<string, OAuthActionParam>;
    /** Scopes (ids del catalogo) que la cuenta debe tener concedidos para esta accion. */
    requiresScopes?: string[];
    maxResponseBytes?: number;
    /** Base https propia de la accion (host de allowedHosts), p. ej. https://meet.googleapis.com. Por defecto la del proveedor. */
    apiBase?: string;
    /** Parametros de query CONSTANTES de la accion (p. ej. uploadType=multipart). */
    fixedQuery?: Record<string, string>;
    /** Nombre de un parametro `in: "body"` de tipo object que se envia como CUERPO JSON completo (p. ej. el recurso de un evento). */
    bodyFrom?: string;
    /** Subida multipart/related (Drive): nombres de parametros `in: "body"`: metadata (object), content (string base64), mimeType (string, opcional). */
    upload?: { metadata: string; content: string; mimeType?: string };
    /** true = la accion cambia datos (cuenta para cuotas de escritura y auditoria). */
    write?: boolean;
    /** Tope DURO por hora y por usuario+extension de esta accion, aplicado por el nucleo (ademas de la cuota por minuto del intermediario). 1..10000. Requiere oauth.provider.v2. */
    quotaPerHour?: number;
};

/** Credenciales COMPARTIDAS del dominio que el nucleo guarda cifradas (nunca llegan a una extension) para los modos organizador / cuenta de servicio. */
export type OAuthPrincipalsDef = {
    /** Nombre (campo secret:true del settingsSchema) del refresh token del organizador compartido. */
    organizerRefreshToken?: string;
    /** Nombre (campo secret:true) del JSON de la cuenta de servicio con delegacion. */
    serviceAccountJson?: string;
    /** Ajustes NO secretos (claves del settingsSchema): usuario a suplantar con la cuenta de servicio, correo del organizador y modo de autenticacion. */
    impersonateUser?: string;
    organizerEmail?: string;
    authMode?: string;
};

/** Variable de URL del proveedor (p. ej. {tenant} de Microsoft): el valor sale de un ajuste NO secreto, validado por `pattern` Y por un juego de caracteres fijo del nucleo; solo puede ir en la RUTA, nunca en el host. */
export type OAuthVariableDef = { setting: string; default: string; pattern: string };
/** Credenciales de aplicacion "servidor a servidor" (Zoom S2S: grant account_credentials) para la identidad compartida `service`. Los secretos los guarda el nucleo, jamas la extension. */
export type OAuthServiceCredentialsDef = { grant: "account_credentials"; accountIdSetting: string; clientIdSetting: string; clientSecretCredential: string };
export const OAUTH_TOKEN_AUTH = ["post", "basic"] as const;
export const OAUTH_TOKEN_FORMATS = ["standard", "slack-v2"] as const;
export const OAUTH_REVOKE_TOKENS = ["refresh", "access"] as const;

export type OAuthProviderDef = {
    id: string;
    displayName: string;
    icon?: string;
    authorizeUrl: string;
    tokenUrl: string;
    revokeUrl?: string;
    userinfoUrl?: string;
    /** OIDC: emisor esperado del id_token (`iss`) y URL del JWKS (https, host de allowedHosts). Sin ellos no se valida id_token. */
    issuer?: string;
    jwksUri?: string;
    /** Base https de las llamadas de las acciones (host de allowedHosts), p. ej. https://www.googleapis.com. */
    apiBase?: string;
    actions?: OAuthActionDef[];
    principals?: OAuthPrincipalsDef;
    allowedHosts: string[];
    scopes: OAuthScopeDef[];
    defaultScopes?: string[];
    pkce: boolean;
    extraParams?: Record<string, string>;
    /** Clave del ajuste tipado (settingsSchema, NO secreto) con el client id. */
    clientIdSetting: string;
    /** Clave del campo secreto (settingsSchema `secret:true`, nombre en MAYUSCULAS) con el client secret. Opcional si pkce y cliente publico. */
    clientSecretCredential?: string;
    /** Ruta de callback. Por defecto /api/oauth/<id>/callback. Admite ademas el alias legado /api/auth/callback/<id>. */
    redirectPath?: string;
    /** Autenticacion del cliente en token/revoke: "post" (client_secret en el cuerpo, defecto) o "basic" (cabecera Authorization: Basic, p. ej. Zoom). Requiere oauth.provider.v2. */
    tokenAuth?: (typeof OAUTH_TOKEN_AUTH)[number];
    /** Forma de la respuesta del token: "standard" (RFC 6749) o "slack-v2" (bot + authed_user, errores {ok:false}, scope separado por comas, auth.revoke). Requiere oauth.provider.v2. */
    tokenFormat?: (typeof OAUTH_TOKEN_FORMATS)[number];
    /** Que token se envia al endpoint de revocacion: "refresh" (defecto, RFC 7009) o "access" (Zoom revoca por access token). Requiere oauth.provider.v2. */
    revokeToken?: (typeof OAUTH_REVOKE_TOKENS)[number];
    /** Variables {nombre} de las URLs de authorize/token/revoke/userinfo/jwks/issuer (solo en la ruta). Requiere oauth.provider.v2. */
    variables?: Record<string, OAuthVariableDef>;
    /** Credenciales S2S para la identidad compartida `service` (sin cuenta de servicio de Google). Requiere oauth.provider.v2. */
    serviceCredentials?: OAuthServiceCredentialsDef;
};

// ---------------------------------------------------------------------------------------------------------------
// Variables de URL ({tenant}) y emisor con claim ({claim:tid})
// ---------------------------------------------------------------------------------------------------------------

/** Juego de caracteres FIJO de un valor de variable (ademas del patron del manifest): nunca puede salir del segmento de ruta. */
export const OAUTH_VARIABLE_VALUE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const OAUTH_VARIABLE_NAME_RE = /^[a-z][a-z0-9]{0,15}$/;
export const OAUTH_CLAIM_VALUE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const CLAIM_NAME = "[a-z][a-z0-9_]{0,15}";

/** Sustituye `{nombre}` por `values[nombre]`. Los `{claim:x}` se dejan intactos. */
export function substituteOAuthVariables(template: string, values: Record<string, string>): string {
    return template.replace(/\{([a-z][a-z0-9]{0,15})\}/g, (m, name: string) => (Object.prototype.hasOwnProperty.call(values, name) ? values[name] : m));
}
/** true si la plantilla solo tiene llaves en la RUTA (nunca en esquema/host/puerto). */
export function placeholdersOnlyInPath(template: string): boolean {
    const m = /^https:\/\/[^/{}?#]+\//.exec(template);
    return !!m;
}
/** Valor efectivo de una variable: el ajuste si cumple patron Y juego de caracteres, si no el valor por defecto. */
export function resolveOAuthVariable(def: OAuthVariableDef, configured: unknown): string {
    const v = typeof configured === "string" ? configured.trim() : "";
    return v && OAUTH_VARIABLE_VALUE_RE.test(v) && !v.includes("..") && safePatternTest(def.pattern, v) ? v : def.default;
}
/** Nombres de claims (`{claim:tid}`) que usa una plantilla de emisor. */
export function issuerClaimNames(issuer: string): string[] {
    return Array.from(issuer.matchAll(new RegExp(`\{claim:(${CLAIM_NAME})\}`, "g"))).map((m) => m[1]);
}
/**
 * Compara un emisor recibido con una plantilla que puede llevar `{claim:x}` (p. ej. Microsoft en tenants multi-organizacion:
 * https://login.microsoftonline.com/{claim:tid}/v2.0). `claims` = claims del id_token YA verificado. Cada claim usado debe ser un segmento seguro
 * y, si hay `pins` (tenant fijo), igual al valor fijado. Comparacion EXACTA de la cadena resultante.
 */
export function issuerMatches(template: string, received: unknown, claims: Record<string, unknown>, pins: Record<string, string> = {}): boolean {
    if (typeof received !== "string" || !received) return false;
    let expected = template;
    for (const name of issuerClaimNames(template)) {
        const v = claims[name];
        if (typeof v !== "string" || !OAUTH_CLAIM_VALUE_RE.test(v)) return false;
        if (pins[name] !== undefined && pins[name] !== v) return false;
        expected = expected.split(`{claim:${name}}`).join(v);
    }
    return expected === received;
}
/** Para el parametro `iss` de la respuesta de autorizacion (RFC 9207) cuando aun no hay claims: cada claim es un segmento seguro. */
export function issuerParamMatches(template: string, received: unknown, pins: Record<string, string> = {}): boolean {
    if (typeof received !== "string" || !received) return false;
    const parts = template.split(new RegExp(`\{claim:(${CLAIM_NAME})\}`));
    // parts alterna literal, nombre de claim, literal...
    let pos = 0;
    for (let i = 0; i < parts.length; i += 2) {
        const literal = parts[i];
        if (!received.startsWith(literal, pos)) return false;
        pos += literal.length;
        if (i + 1 < parts.length) {
            const next = parts[i + 2] ?? "";
            const end = next ? received.indexOf(next, pos) : received.length;
            if (end < 0) return false;
            const value = received.slice(pos, end);
            if (!OAUTH_CLAIM_VALUE_RE.test(value)) return false;
            const pin = pins[parts[i + 1]];
            if (pin !== undefined && pin !== value) return false;
            pos = end;
        }
    }
    return pos === received.length;
}

const HOST_RE = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const FORBIDDEN_TLD_RE = /\.(?:local|localhost|internal|intranet|lan|home|corp|test|invalid|example)$/;

/** true si es un host DNS publico bien formado (no IP literal, no localhost/.local/.internal). */
export function isPublicDnsHost(host: string): boolean {
    const h = host.toLowerCase();
    if (!HOST_RE.test(h) || FORBIDDEN_TLD_RE.test(h)) return false;
    if (/^[\d.]+$/.test(h) || h.includes(":")) return false;
    if (h.startsWith("*.") && h.slice(2).split(".").length < 2) return false;
    return true;
}

export function hostAllowed(host: string, allowedHosts: readonly string[]): boolean {
    const h = host.toLowerCase();
    return allowedHosts.some((a) => (a.startsWith("*.") ? h.endsWith(a.slice(1)) && h.length > a.length - 1 : h === a));
}

/** Valida una URL de endpoint contra `allowedHosts`. Devuelve el motivo del rechazo o null si es valida. */
export function checkOAuthEndpointUrl(value: unknown, allowedHosts: readonly string[]): string | null {
    if (typeof value !== "string" || !value || value.length > OAUTH_LIMITS.maxUrl) return "Debe ser una URL https de hasta 500 caracteres";
    let url: URL;
    try { url = new URL(value); } catch { return "URL no valida"; }
    if (url.protocol !== "https:") return "Solo https";
    if (url.username || url.password) return "Sin credenciales embebidas en la URL";
    if (url.port && url.port !== "443") return "Solo el puerto 443";
    if (url.hash) return "Sin fragmento (#)";
    if (!isPublicDnsHost(url.hostname)) return "El host debe ser un nombre DNS publico (no IP, localhost ni red interna)";
    if (!hostAllowed(url.hostname, allowedHosts)) return `El host ${url.hostname} no esta en allowedHosts`;
    return null;
}

type Sink = (path: string, message: string) => void;

/**
 * Valida `oauthProviders`. `settingsFields` (opcional) = campos del settingsSchema ya normalizados ({key, secret}) para verificar que
 * clientIdSetting / clientSecretCredential existen; sin ellos solo se valida la forma.
 */
/**
 * IDs de proveedor RESERVADOS: solo los puede registrar su extension oficial (lista cerrada). Evita que una extension cualquiera declare
 * `google` y suplante el login, el broker o la entrega de credenciales. Tambien lo exige la instancia al leer el registro.
 */
export const RESERVED_OAUTH_PROVIDERS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    google: ["core-googlelib"],
    microsoft: ["core-microsoftlib"],
    zoom: ["core-zoomlib"],
    slack: ["core-slacklib"],
    github: ["core-githublib"],
    gitlab: ["core-gitlablib"],
    facebook: ["core-facebooklib"],
    apple: ["core-applelib"],
    linkedin: ["core-linkedinlib"],
    dropbox: ["core-dropboxlib"],
    notion: ["core-notionlib"],
    hubspot: ["core-hubspotlib"],
});
/** true si `extensionId` puede registrar el proveedor `providerId` (los no reservados los puede registrar cualquiera, con aprobacion del admin en la instancia). */
export function mayRegisterOAuthProvider(providerId: string, extensionId: unknown): boolean {
    const owners = RESERVED_OAUTH_PROVIDERS[providerId];
    return !owners || (typeof extensionId === "string" && owners.includes(extensionId));
}

/** Prueba un patron declarado por una extension SIN riesgo de ReDoS: heuristica de regexProblem + try/catch (devuelve false si es peligroso o invalido). */
export function safePatternTest(pattern: string, value: string): boolean {
    try {
        if (typeof pattern !== "string" || pattern.length > 100 || regexProblem(pattern)) return false;
        return new RegExp(pattern).test(value);
    } catch {
        return false;
    }
}

export function validateOAuthProviders(raw: unknown, err: Sink, warn: Sink, settingsFields?: ReadonlyArray<{ key: string; secret: boolean }>, extensionId?: unknown): void {
    if (raw === undefined) return;
    if (!Array.isArray(raw)) return err("oauthProviders", "Debe ser un arreglo");
    if (raw.length > OAUTH_LIMITS.maxProviders) err("oauthProviders", `Maximo ${OAUTH_LIMITS.maxProviders} proveedores por extension`);
    const seen = new Set<string>();
    raw.forEach((p: unknown, index: number) => {
        const at = `oauthProviders[${index}]`;
        if (typeof p !== "object" || p === null || Array.isArray(p)) return err(at, "Debe ser un objeto");
        const o = p as Record<string, unknown>;
        const known = ["id", "displayName", "icon", "authorizeUrl", "tokenUrl", "revokeUrl", "userinfoUrl", "issuer", "jwksUri", "apiBase", "actions", "principals", "allowedHosts", "scopes", "defaultScopes", "pkce", "extraParams", "clientIdSetting", "clientSecretCredential", "redirectPath", "tokenAuth", "tokenFormat", "revokeToken", "variables", "serviceCredentials"];
        for (const k of Object.keys(o)) if (!known.includes(k)) warn(`${at}.${k}`, "Clave desconocida (se ignora)");

        if (typeof o.id !== "string" || !OAUTH_PROVIDER_ID_RE.test(o.id)) err(`${at}.id`, "Requerido: [a-z][a-z0-9-] (2-32)");
        else if (seen.has(o.id)) err(`${at}.id`, `Proveedor duplicado: ${o.id}`);
        else {
            seen.add(o.id);
            if (!mayRegisterOAuthProvider(o.id, extensionId)) err(`${at}.id`, `El id "${o.id}" esta reservado para su extension oficial (${RESERVED_OAUTH_PROVIDERS[o.id].join(", ")})`);
        }
        if (typeof o.displayName !== "string" || !o.displayName.trim() || o.displayName.length > 60) err(`${at}.displayName`, "Requerido (max 60)");
        if (o.icon !== undefined && (typeof o.icon !== "string" || o.icon.length > 80)) err(`${at}.icon`, "Debe ser una referencia de icono (p. ej. brand:google)");

        // Hosts permitidos
        const hosts: string[] = [];
        if (!Array.isArray(o.allowedHosts) || o.allowedHosts.length === 0) err(`${at}.allowedHosts`, "Requerido: arreglo no vacio de hosts https permitidos");
        else {
            if (o.allowedHosts.length > OAUTH_LIMITS.maxHosts) err(`${at}.allowedHosts`, `Maximo ${OAUTH_LIMITS.maxHosts} hosts`);
            o.allowedHosts.forEach((h: unknown, i: number) => {
                if (typeof h !== "string" || !isPublicDnsHost(h)) return err(`${at}.allowedHosts[${i}]`, "Host DNS publico (sin IP, localhost ni red interna; \"*.dominio.tld\" permitido)");
                hosts.push(h.toLowerCase());
            });
        }
        // Variables de URL ({tenant}): declaradas en `variables`, solo en la RUTA; se validan con su valor por defecto.
        const varDefaults: Record<string, string> = {};
        if (o.variables !== undefined) {
            const vr = o.variables as Record<string, unknown>;
            if (typeof vr !== "object" || vr === null || Array.isArray(vr)) err(`${at}.variables`, "Debe ser un objeto { nombre: { setting, default, pattern } }");
            else {
                const entries = Object.entries(vr);
                if (entries.length > 2) err(`${at}.variables`, "Maximo 2 variables");
                for (const [name, def] of entries) {
                    const vat = `${at}.variables.${name}`;
                    if (!OAUTH_VARIABLE_NAME_RE.test(name) || name === "claim") { err(vat, "Nombre invalido ([a-z][a-z0-9], max 16; claim esta reservado)"); continue; }
                    if (typeof def !== "object" || def === null || Array.isArray(def)) { err(vat, "Debe ser un objeto"); continue; }
                    const d = def as Record<string, unknown>;
                    if (typeof d.setting !== "string" || !d.setting) err(`${vat}.setting`, "Clave de un ajuste NO secreto del settingsSchema");
                    else if (settingsFields && !settingsFields.some((f) => f.key === d.setting && !f.secret)) err(`${vat}.setting`, `No existe como ajuste no secreto en settingsSchema: ${d.setting}`);
                    const problem = typeof d.pattern === "string" && d.pattern.length <= 100 ? regexProblem(d.pattern) : "String (max 100)";
                    if (problem) err(`${vat}.pattern`, problem);
                    if (typeof d.default !== "string" || !OAUTH_VARIABLE_VALUE_RE.test(d.default) || d.default.includes("..")) err(`${vat}.default`, "Segmento simple [A-Za-z0-9._-] (max 64)");
                    else if (!problem && typeof d.pattern === "string" && !safePatternTest(d.pattern, d.default)) err(`${vat}.default`, "El valor por defecto debe cumplir el patron");
                    else varDefaults[name] = d.default;
                }
            }
        }
        const concrete = (key: string, value: unknown): unknown => {
            if (typeof value !== "string" || !/[{}]/.test(value)) return value;
            if (!placeholdersOnlyInPath(value)) { err(`${at}.${key}`, "Las variables solo pueden ir en la ruta, nunca en el host"); return ""; }
            let r = substituteOAuthVariables(value, varDefaults);
            if (key === "issuer") r = r.replace(new RegExp("\\{claim:" + CLAIM_NAME + "\\}", "g"), "x");
            if (/[{}]/.test(r)) { err(`${at}.${key}`, "Variable no declarada en variables o llaves mal formadas"); return ""; }
            return r;
        };
        for (const key of ["authorizeUrl", "tokenUrl"] as const) {
            const why = checkOAuthEndpointUrl(concrete(key, o[key]), hosts);
            if (why) err(`${at}.${key}`, why);
        }
        for (const key of ["revokeUrl", "userinfoUrl"] as const) {
            if (o[key] === undefined) continue;
            const why = checkOAuthEndpointUrl(concrete(key, o[key]), hosts);
            if (why) err(`${at}.${key}`, why);
        }

        if (o.jwksUri !== undefined) {
            const why = checkOAuthEndpointUrl(concrete("jwksUri", o.jwksUri), hosts);
            if (why) err(`${at}.jwksUri`, why);
        }
        if (o.issuer !== undefined && (typeof o.issuer !== "string" || !o.issuer || o.issuer.length > 200 || /[\s"]/.test(o.issuer))) err(`${at}.issuer`, "String sin espacios (max 200)");
        else if (typeof o.issuer === "string" && /[{}]/.test(o.issuer)) {
            concrete("issuer", o.issuer);
            if (issuerClaimNames(o.issuer).length > 1) err(`${at}.issuer`, "Maximo un {claim:x} en el emisor");
        }
        if (typeof o.apiBase === "string" && /[{}]/.test(o.apiBase)) err(`${at}.apiBase`, "apiBase no admite variables");
        if (o.tokenAuth !== undefined && !(OAUTH_TOKEN_AUTH as readonly unknown[]).includes(o.tokenAuth)) err(`${at}.tokenAuth`, `Debe ser uno de ${OAUTH_TOKEN_AUTH.join(", ")}`);
        if (o.revokeToken !== undefined && !(OAUTH_REVOKE_TOKENS as readonly unknown[]).includes(o.revokeToken)) err(`${at}.revokeToken`, `Debe ser uno de ${OAUTH_REVOKE_TOKENS.join(", ")}`);
        if (o.tokenFormat !== undefined && !(OAUTH_TOKEN_FORMATS as readonly unknown[]).includes(o.tokenFormat)) err(`${at}.tokenFormat`, `Debe ser uno de ${OAUTH_TOKEN_FORMATS.join(", ")}`);
        if (o.serviceCredentials !== undefined) {
            const sc = o.serviceCredentials as Record<string, unknown>;
            const sat = `${at}.serviceCredentials`;
            if (typeof sc !== "object" || sc === null || Array.isArray(sc)) err(sat, "Debe ser un objeto");
            else {
                for (const k of Object.keys(sc)) if (!["grant", "accountIdSetting", "clientIdSetting", "clientSecretCredential"].includes(k)) err(`${sat}.${k}`, "Clave desconocida");
                if (sc.grant !== "account_credentials") err(`${sat}.grant`, "Solo account_credentials");
                for (const k of ["accountIdSetting", "clientIdSetting"] as const) {
                    if (typeof sc[k] !== "string" || !sc[k]) err(`${sat}.${k}`, "Clave de un ajuste NO secreto del settingsSchema");
                    else if (settingsFields && !settingsFields.some((f) => f.key === sc[k] && !f.secret)) err(`${sat}.${k}`, `No existe como ajuste no secreto en settingsSchema: ${sc[k]}`);
                }
                if (typeof sc.clientSecretCredential !== "string" || !/^[A-Z][A-Z0-9_]{1,63}$/.test(sc.clientSecretCredential)) err(`${sat}.clientSecretCredential`, "Nombre en MAYUSCULAS de un campo secret:true");
                else if (settingsFields && !settingsFields.some((f) => f.key === sc.clientSecretCredential && f.secret)) err(`${sat}.clientSecretCredential`, `Debe ser un campo secret:true del settingsSchema: ${sc.clientSecretCredential}`);
            }
        }
        if (o.apiBase !== undefined) {
            const why = checkOAuthEndpointUrl(o.apiBase, hosts);
            if (why) err(`${at}.apiBase`, why);
            else if (String(o.apiBase).includes("?")) err(`${at}.apiBase`, "Sin query");
        }

        // Catalogo de scopes
        const scopeIds = new Set<string>();
        if (!Array.isArray(o.scopes) || o.scopes.length === 0) err(`${at}.scopes`, "Requerido: catalogo de scopes");
        else {
            if (o.scopes.length > OAUTH_LIMITS.maxScopes) err(`${at}.scopes`, `Maximo ${OAUTH_LIMITS.maxScopes} scopes`);
            o.scopes.forEach((s: unknown, i: number) => {
                const sat = `${at}.scopes[${i}]`;
                if (typeof s !== "object" || s === null || Array.isArray(s)) return err(sat, "Debe ser un objeto");
                const sc = s as Record<string, unknown>;
                if (typeof sc.id !== "string" || !/^[\x21-\x7e]{1,300}$/.test(sc.id) || sc.id.includes('"')) return err(`${sat}.id`, "Scope invalido (ASCII imprimible, sin espacios ni comillas)");
                if (scopeIds.has(sc.id)) err(`${sat}.id`, `Scope duplicado: ${sc.id}`);
                scopeIds.add(sc.id);
                if (typeof sc.group !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(sc.group)) err(`${sat}.group`, "Requerido: [a-z][a-z0-9-] (grupo, p. ej. calendar)");
                for (const lang of ["es", "en"] as const) if (typeof sc[lang] !== "string" || !(sc[lang] as string).trim() || (sc[lang] as string).length > OAUTH_LIMITS.maxText) err(`${sat}.${lang}`, "Requerido: descripcion legible (max 200)");
                if (!OAUTH_RISKS.includes(sc.risk as OAuthRisk)) err(`${sat}.risk`, `Debe ser uno de ${OAUTH_RISKS.join(", ")}`);
            });
        }
        if (o.defaultScopes !== undefined) {
            if (!Array.isArray(o.defaultScopes)) err(`${at}.defaultScopes`, "Debe ser un arreglo");
            else o.defaultScopes.forEach((s: unknown, i: number) => { if (typeof s !== "string" || !scopeIds.has(s)) err(`${at}.defaultScopes[${i}]`, "Debe ser un scope del catalogo"); });
        }

        if (o.actions !== undefined) validateActions(o.actions, `${at}.actions`, err, scopeIds, typeof o.apiBase === "string", hosts, settingsFields);
        if (o.principals !== undefined) {
            const pr = o.principals as Record<string, unknown>;
            if (typeof pr !== "object" || pr === null || Array.isArray(pr)) err(`${at}.principals`, "Debe ser un objeto");
            else {
                for (const k of Object.keys(pr)) if (!["organizerRefreshToken", "serviceAccountJson", "impersonateUser", "organizerEmail", "authMode"].includes(k)) err(`${at}.principals.${k}`, "Clave desconocida");
                for (const k of ["organizerRefreshToken", "serviceAccountJson"] as const) {
                    if (pr[k] === undefined) continue;
                    if (typeof pr[k] !== "string" || !/^[A-Z][A-Z0-9_]{1,63}$/.test(pr[k] as string)) err(`${at}.principals.${k}`, "Nombre en MAYUSCULAS de un campo secret:true");
                    else if (settingsFields && !settingsFields.some((f) => f.key === pr[k] && f.secret)) err(`${at}.principals.${k}`, `Debe ser un campo secret:true del settingsSchema: ${pr[k]}`);
                }
                for (const k of ["impersonateUser", "organizerEmail", "authMode"] as const) {
                    if (pr[k] === undefined) continue;
                    if (typeof pr[k] !== "string" || !pr[k]) err(`${at}.principals.${k}`, "Clave de un ajuste NO secreto del settingsSchema");
                    else if (settingsFields && !settingsFields.some((f) => f.key === pr[k] && !f.secret)) err(`${at}.principals.${k}`, `No existe como ajuste no secreto en settingsSchema: ${pr[k]}`);
                }
            }
        }

        if (typeof o.pkce !== "boolean") err(`${at}.pkce`, "Requerido: boolean (usa true salvo que el proveedor no lo soporte)");
        else if (!o.pkce) warn(`${at}.pkce`, "Sin PKCE: solo con clientSecret; el nucleo seguira usando state firmado + nonce");

        if (o.extraParams !== undefined) {
            if (typeof o.extraParams !== "object" || o.extraParams === null || Array.isArray(o.extraParams)) err(`${at}.extraParams`, "Debe ser un objeto { nombre: valor }");
            else {
                const entries = Object.entries(o.extraParams as Record<string, unknown>);
                if (entries.length > OAUTH_LIMITS.maxExtraParams) err(`${at}.extraParams`, `Maximo ${OAUTH_LIMITS.maxExtraParams}`);
                for (const [k, v] of entries) {
                    if (!/^[a-z_][a-z0-9_]{0,39}$/.test(k)) err(`${at}.extraParams.${k}`, "Nombre invalido");
                    else if (OAUTH_RESERVED_PARAMS.includes(k)) err(`${at}.extraParams.${k}`, "Parametro reservado por el nucleo");
                    if (typeof v !== "string" || v.length > 100) err(`${at}.extraParams.${k}`, "El valor debe ser string (max 100)");
                }
            }
        }

        if (typeof o.clientIdSetting !== "string" || !o.clientIdSetting) err(`${at}.clientIdSetting`, "Requerido: clave del ajuste tipado con el client id");
        else if (settingsFields) {
            const f = settingsFields.find((x) => x.key === o.clientIdSetting);
            if (!f) err(`${at}.clientIdSetting`, `No existe en settingsSchema: ${o.clientIdSetting}`);
            else if (f.secret) err(`${at}.clientIdSetting`, "El client id es un ajuste NO secreto");
        }
        if (o.clientSecretCredential !== undefined) {
            if (typeof o.clientSecretCredential !== "string" || !/^[A-Z][A-Z0-9_]{1,63}$/.test(o.clientSecretCredential)) err(`${at}.clientSecretCredential`, "Nombre en MAYUSCULAS del campo secreto");
            else if (settingsFields) {
                const f = settingsFields.find((x) => x.key === o.clientSecretCredential);
                if (!f || !f.secret) err(`${at}.clientSecretCredential`, `Debe ser un campo secret:true del settingsSchema: ${o.clientSecretCredential}`);
            }
        } else if (o.pkce === false) err(`${at}.clientSecretCredential`, "Obligatorio cuando pkce es false");

        if (o.redirectPath !== undefined) {
            const id = typeof o.id === "string" ? o.id : "";
            const ok = o.redirectPath === `/api/oauth/${id}/callback` || o.redirectPath === `/api/auth/callback/${id}`;
            if (!ok) err(`${at}.redirectPath`, `Solo /api/oauth/${id}/callback o el alias legado /api/auth/callback/${id}`);
        }
    });
}

const PARAM_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const QUERY_NAME_RE = /^\$?[A-Za-z][A-Za-z0-9_.-]{0,39}$/;

function validateActions(raw: unknown, at: string, err: Sink, scopeIds: Set<string>, hasApiBase: boolean, hosts: readonly string[], settingsFields?: ReadonlyArray<{ key: string; secret: boolean }>): void {
    if (!Array.isArray(raw)) return err(at, "Debe ser un arreglo");
    if (raw.length > OAUTH_ACTION_LIMITS.maxActions) err(at, `Maximo ${OAUTH_ACTION_LIMITS.maxActions} acciones`);
    const everyActionHasBase = raw.every((a) => typeof a === "object" && a !== null && typeof (a as Record<string, unknown>).apiBase === "string");
    if (raw.length > 0 && !hasApiBase && !everyActionHasBase) err(at, "Las acciones exigen apiBase (del proveedor o de cada accion)");
    const groups = new Set<string>();
    const seen = new Set<string>();
    raw.forEach((a: unknown, i: number) => {
        const aat = `${at}[${i}]`;
        if (typeof a !== "object" || a === null || Array.isArray(a)) return err(aat, "Debe ser un objeto");
        const act = a as Record<string, unknown>;
        if (typeof act.id !== "string" || !OAUTH_ACTION_ID_RE.test(act.id)) err(`${aat}.id`, "Identificador tipo calendar.events.list");
        else if (seen.has(act.id)) err(`${aat}.id`, `Accion duplicada: ${act.id}`);
        else seen.add(act.id);
        if (typeof act.group !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(act.group)) err(`${aat}.group`, "Grupo de scopes del catalogo");
        else groups.add(act.group);
        if (!(OAUTH_ACTION_METHODS as readonly string[]).includes(String(act.method))) err(`${aat}.method`, `Debe ser uno de ${OAUTH_ACTION_METHODS.join(", ")}`);
        const path = act.path;
        const pathParams = new Set<string>();
        if (typeof path !== "string" || !path.startsWith("/") || path.length > OAUTH_ACTION_LIMITS.maxPathLength || /[?#\\\s]|\.\.|\/\//.test(path)) err(`${aat}.path`, "Ruta relativa que empieza por / (sin ?, #, .., // ni espacios)");
        else {
            for (const m of path.matchAll(/\{([^}]*)\}/g)) {
                if (!PARAM_NAME_RE.test(m[1])) err(`${aat}.path`, `Parametro de ruta invalido: {${m[1]}}`);
                pathParams.add(m[1]);
            }
            if (/[{}]/.test(path.replace(/\{[A-Za-z][A-Za-z0-9_]{0,31}\}/g, ""))) err(`${aat}.path`, "Llaves mal formadas");
        }
        const params = act.params;
        const declared = new Set<string>();
        if (params !== undefined) {
            if (typeof params !== "object" || params === null || Array.isArray(params)) err(`${aat}.params`, "Debe ser un objeto");
            else {
                const entries = Object.entries(params as Record<string, unknown>);
                if (entries.length > OAUTH_ACTION_LIMITS.maxParams) err(`${aat}.params`, `Maximo ${OAUTH_ACTION_LIMITS.maxParams}`);
                for (const [name, def] of entries) {
                    const pat = `${aat}.params.${name}`;
                    if (!PARAM_NAME_RE.test(name) || name === "__proto__" || name === "constructor") { err(pat, "Nombre invalido"); continue; }
                    declared.add(name);
                    if (typeof def !== "object" || def === null) { err(pat, "Debe ser un objeto"); continue; }
                    const d = def as Record<string, unknown>;
                    if (!["path", "query", "body"].includes(String(d.in))) err(`${pat}.in`, "path | query | body");
                    if (!["string", "number", "integer", "boolean", "object", "array"].includes(String(d.type))) err(`${pat}.type`, "string | number | integer | boolean | object | array");
                    if (d.in === "path" && (d.type !== "string" && d.type !== "integer")) err(`${pat}.type`, "Un parametro de ruta es string o integer");
                    if (d.in === "path" && d.required !== true) err(`${pat}.required`, "Un parametro de ruta es obligatorio");
                    if (d.in === "query" && (d.type === "object" || d.type === "array")) err(`${pat}.type`, "En query solo escalares");
                    if (d.in === "path" && !pathParams.has(name)) err(pat, `No aparece en path: {${name}}`);
                    if (d.pattern !== undefined) {
                        const problem = typeof d.pattern === "string" && d.pattern.length <= 100 ? regexProblem(d.pattern) : "String (max 100)";
                        if (problem) err(`${pat}.pattern`, problem);
                    }
                    if (d.in === "path" && d.pattern === undefined && d.type === "string" && d.enum === undefined) err(`${pat}.pattern`, "Un parametro de ruta string exige pattern o enum (evita inyectar segmentos)");
                    if (d.queryName !== undefined) {
                        if (d.in !== "query") err(`${pat}.queryName`, "Solo en parametros de query");
                        else if (typeof d.queryName !== "string" || !QUERY_NAME_RE.test(d.queryName)) err(`${pat}.queryName`, "Nombre de query simple, opcionalmente con $ inicial (p. ej. $top)");
                    }
                    if (d.allowedFromSetting !== undefined) {
                        if (d.type !== "string" || d.in === "path") err(`${pat}.allowedFromSetting`, "Solo parametros string de query o cuerpo");
                        else if (typeof d.allowedFromSetting !== "string" || !d.allowedFromSetting) err(`${pat}.allowedFromSetting`, "Clave de un ajuste NO secreto del settingsSchema");
                        else if (settingsFields && !settingsFields.some((f) => f.key === d.allowedFromSetting && !f.secret)) err(`${pat}.allowedFromSetting`, `No existe como ajuste no secreto en settingsSchema: ${d.allowedFromSetting}`);
                    }
                    if (d.maxLength !== undefined && (!Number.isInteger(d.maxLength) || (d.maxLength as number) < 1 || (d.maxLength as number) > OAUTH_ACTION_LIMITS.maxStringLength)) err(`${pat}.maxLength`, `Entero 1..${OAUTH_ACTION_LIMITS.maxStringLength}`);
                }
            }
        }
        for (const p of pathParams) if (!declared.has(p)) err(`${aat}.params`, `Falta declarar el parametro de ruta {${p}}`);
        if (act.requiresScopes !== undefined) {
            if (!Array.isArray(act.requiresScopes)) err(`${aat}.requiresScopes`, "Debe ser un arreglo");
            else act.requiresScopes.forEach((sc: unknown, j: number) => { if (typeof sc !== "string" || !scopeIds.has(sc)) err(`${aat}.requiresScopes[${j}]`, "Debe ser un scope del catalogo"); });
        }
        if (act.maxResponseBytes !== undefined && (!Number.isInteger(act.maxResponseBytes) || (act.maxResponseBytes as number) < 1 || (act.maxResponseBytes as number) > OAUTH_ACTION_LIMITS.maxResponseBytes)) err(`${aat}.maxResponseBytes`, `Entero 1..${OAUTH_ACTION_LIMITS.maxResponseBytes}`);
        if (act.write !== undefined && typeof act.write !== "boolean") err(`${aat}.write`, "Debe ser boolean");
        if (act.quotaPerHour !== undefined && (!Number.isInteger(act.quotaPerHour) || (act.quotaPerHour as number) < 1 || (act.quotaPerHour as number) > 10000)) err(`${aat}.quotaPerHour`, "Entero 1..10000");
        if (act.apiBase !== undefined) {
            const why = checkOAuthEndpointUrl(act.apiBase, hosts);
            if (why) err(`${aat}.apiBase`, why);
            else if (String(act.apiBase).includes("?")) err(`${aat}.apiBase`, "Sin query");
        }
        if (act.fixedQuery !== undefined) {
            const fq = act.fixedQuery as Record<string, unknown>;
            if (typeof fq !== "object" || fq === null || Array.isArray(fq) || Object.keys(fq).length > OAUTH_ACTION_LIMITS.maxFixedQuery) err(`${aat}.fixedQuery`, `Objeto con hasta ${OAUTH_ACTION_LIMITS.maxFixedQuery} parametros`);
            else for (const [k, v] of Object.entries(fq)) {
                if (!QUERY_NAME_RE.test(k) || typeof v !== "string" || v.length > 100 || /[\r\n]/.test(v)) err(`${aat}.fixedQuery.${k}`, "Nombre simple y valor string (max 100)");
                else if (declared.has(k) || Object.values((params as Record<string, Record<string, unknown>>) ?? {}).some((p) => p && p.queryName === k)) err(`${aat}.fixedQuery.${k}`, "No puede repetir un parametro declarado");
            }
        }
        const paramDef = (name: unknown) => (typeof name === "string" && params && typeof params === "object" ? (params as Record<string, Record<string, unknown>>)[name] : undefined);
        if (act.bodyFrom !== undefined) {
            const d = paramDef(act.bodyFrom);
            if (!d || d.in !== "body" || d.type !== "object") err(`${aat}.bodyFrom`, "Debe nombrar un parametro in: body de tipo object");
            else if (act.method === "GET") err(`${aat}.bodyFrom`, "Un GET no lleva cuerpo");
        }
        if (act.upload !== undefined) {
            const u = act.upload as Record<string, unknown>;
            if (typeof u !== "object" || u === null || Array.isArray(u)) err(`${aat}.upload`, "Debe ser un objeto { metadata, content, mimeType? }");
            else {
                const meta = paramDef(u.metadata), content = paramDef(u.content), mime = u.mimeType === undefined ? undefined : paramDef(u.mimeType);
                if (!meta || meta.in !== "body" || meta.type !== "object") err(`${aat}.upload.metadata`, "Parametro in: body de tipo object");
                if (!content || content.in !== "body" || content.type !== "string" || typeof content.maxLength !== "number") err(`${aat}.upload.content`, "Parametro in: body string con maxLength");
                if (u.mimeType !== undefined && (!mime || mime.in !== "body" || mime.type !== "string")) err(`${aat}.upload.mimeType`, "Parametro in: body string");
                if (act.method !== "POST" && act.method !== "PUT" && act.method !== "PATCH") err(`${aat}.upload`, "Solo POST/PUT/PATCH");
                if (act.bodyFrom !== undefined) err(`${aat}.upload`, "Incompatible con bodyFrom");
            }
        }
        if (act.method === "GET" && act.write === true) err(`${aat}.write`, "Un GET no escribe");
        if (act.method !== "GET" && act.write === undefined) err(`${aat}.write`, "Las acciones que no son GET deben declarar write (true/false) para las cuotas");
    });
}

/** Sustituye `{param}` en la ruta de una accion con valores YA validados, codificados como segmento de ruta. */
export function buildActionPath(path: string, values: Record<string, string | number>): string {
    return path.replace(/\{([A-Za-z][A-Za-z0-9_]{0,31})\}/g, (_m, name: string) => encodeURIComponent(String(values[name] ?? "")));
}

export type ActionInputIssue = { param: string; code: "required" | "type" | "max" | "min" | "pattern" | "enum" | "unknown" };

/** Valida los parametros recibidos contra `params` de la accion (campos no declarados se rechazan). */
export function validateActionInput(action: Pick<OAuthActionDef, "params"> & { bodyFrom?: string }, input: unknown): { ok: boolean; issues: ActionInputIssue[]; path: Record<string, string | number>; query: Record<string, string>; body: Record<string, unknown> } {
    const issues: ActionInputIssue[] = [];
    const path: Record<string, string | number> = {};
    const query: Record<string, string> = {};
    const body: Record<string, unknown> = {};
    const src = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    const params = action.params ?? {};
    for (const key of Object.keys(src)) if (!(key in params) || key === "__proto__") issues.push({ param: key, code: "unknown" });
    for (const [name, def] of Object.entries(params)) {
        const v = src[name];
        if (v === undefined || v === null) { if (def.required) issues.push({ param: name, code: "required" }); continue; }
        let ok = true;
        switch (def.type) {
            case "string": ok = typeof v === "string"; break;
            case "number": ok = typeof v === "number" && Number.isFinite(v); break;
            case "integer": ok = typeof v === "number" && Number.isInteger(v); break;
            case "boolean": ok = typeof v === "boolean"; break;
            case "array": ok = Array.isArray(v) && v.length <= 500; break;
            case "object": ok = typeof v === "object" && !Array.isArray(v); break;
        }
        if (!ok) { issues.push({ param: name, code: "type" }); continue; }
        if (typeof v === "string") {
            if (v.length > Math.min(def.maxLength ?? 2000, OAUTH_ACTION_LIMITS.maxStringLength)) { issues.push({ param: name, code: "max" }); continue; }
            if (def.pattern && !safePatternTest(def.pattern, v)) { issues.push({ param: name, code: "pattern" }); continue; }
        }
        if (typeof v === "number") {
            if (typeof def.min === "number" && v < def.min) { issues.push({ param: name, code: "min" }); continue; }
            if (typeof def.max === "number" && v > def.max) { issues.push({ param: name, code: "max" }); continue; }
        }
        if (def.enum && !(def.enum as Array<string | number>).includes(v as string | number)) { issues.push({ param: name, code: "enum" }); continue; }
        // Un segmento de ruta "." o ".." (que encodeURIComponent deja intacto) saldria de la ruta de la accion al normalizar la URL: jamas se admite.
        if (def.in === "path" && typeof v === "string" && /^\.{1,2}$/.test(v)) { issues.push({ param: name, code: "pattern" }); continue; }
        if (def.in === "path") path[name] = v as string | number;
        else if (def.in === "query") query[def.queryName ?? name] = String(v);
        else body[name] = v;
    }
    // bodyFrom: el objeto completo de ese parametro ES el cuerpo JSON (recursos tipo "evento"); acotado por maxBodyBytes.
    let bodyOut: Record<string, unknown> = body;
    const from = (action as { bodyFrom?: string }).bodyFrom;
    if (from && body[from] && typeof body[from] === "object") {
        bodyOut = body[from] as Record<string, unknown>;
        try { if (JSON.stringify(bodyOut).length > OAUTH_ACTION_LIMITS.maxBodyBytes) issues.push({ param: from, code: "max" }); } catch { issues.push({ param: from, code: "type" }); }
    }
    return { ok: issues.length === 0, issues, path, query, body: bodyOut };
}

// ---------------------------------------------------------------------------------------------------------------
// Aprobaciones de permisos OAuth sensibles por el admin del dominio
// ---------------------------------------------------------------------------------------------------------------

/** Grupos de scopes de riesgo alto/critico: pedirlos con `OAUTH_ACCOUNT:<proveedor>:<grupo>` exige aprobacion explicita del admin. */
export const HIGH_RISK_OAUTH_GROUPS: readonly string[] = Object.freeze(["gmail", "mail", "drive", "files", "admin", "directory"]);

/** Aprobaciones que piden los permisos OAuth de un manifest: toda `OAUTH_SHARED:*` y las `OAUTH_ACCOUNT:*` de grupos de riesgo alto. */
export function oauthApprovalKeys(permissions: unknown): string[] {
    const out = new Set<string>();
    if (!Array.isArray(permissions)) return [];
    for (const p of permissions) {
        if (typeof p !== "string") continue;
        if (/^OAUTH_SHARED:[a-z][a-z0-9-]{1,31}$/.test(p)) out.add(p);
        const m = /^OAUTH_ACCOUNT:([a-z][a-z0-9-]{1,31}):([a-z][a-z0-9-]{0,31})$/.exec(p);
        if (m && HIGH_RISK_OAUTH_GROUPS.includes(m[2])) out.add(p);
    }
    return Array.from(out).sort();
}
