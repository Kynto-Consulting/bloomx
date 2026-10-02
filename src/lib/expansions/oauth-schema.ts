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
    /** Solo `in: body` `type: object`: lista CERRADA de claves permitidas (campos del objeto); cualquier otra se rechaza y los valores deben ser escalares (sin objetos anidados). Requiere oauth.provider.v2. */
    objectKeys?: string[];
    /** Con `objectKeys`: clave de un ajuste NO secreto (lista) del admin; las claves del objeto deben estar ADEMAS en ella (vacia = ninguna). El nucleo lo aplica. Requiere oauth.provider.v2. */
    allowedKeysFromSetting?: string;
    /** Con `objectKeys`: longitud maxima de cada valor string (por defecto 4000). */
    maxValueLength?: number;
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
    /**
     * Host de la accion = `<valor guardado en la cuenta del usuario del dato extra X><hostSuffix de X>` (p. ej. Salesforce: la instancia que devolvio el token).
     * El valor se valido al vincular con el patron del proveedor; NUNCA sale de la peticion. Sustituye a `apiBase`. Solo identidad `user`. Requiere oauth.provider.v2.
     */
    apiHostExtra?: string;
    /** Parametros de RUTA que no elige quien llama: `{marcador}` -> dato extra de la cuenta (p. ej. id y token del webhook de Discord). Nunca se devuelven. Requiere oauth.provider.v2. */
    pathExtras?: Record<string, string>;
    /** Campos CONSTANTES del cuerpo JSON (p. ej. allowed_mentions de Discord): se aplican DESPUES de los de la peticion y no se pueden sobrescribir. Requiere oauth.provider.v2. */
    fixedBody?: Record<string, unknown>;
    /** true = la accion NO usa el token OAuth (no envia Authorization ni lo refresca): la credencial va en la ruta (pathExtras), p. ej. el webhook de Discord. Exige pathExtras. Requiere oauth.provider.v2. */
    noAuth?: boolean;
    /**
     * "bot" = la accion usa la credencial BOT del proveedor (`botCredential`): el nucleo inyecta `Authorization: Bot <token>` y no hay cuenta de usuario.
     * Exige un grupo `bot-*` (bot-read | bot-write | bot-mod), el permiso OAUTH_SHARED:<proveedor> y el grupo concedido. Requiere oauth.provider.v3.
     */
    credential?: "bot";
    /** true = accion de MODERACION (kick/ban/roles/borrar mensajes): el nucleo la rechaza salvo que el admin active `botCredential.moderationSetting`. Solo con credential "bot". */
    moderation?: boolean;
    /**
     * Servidor (guild) al que afecta la accion, para aplicar la lista blanca del admin (`allowedGuildsSetting`; vacia = solo el servidor por defecto):
     * `param` = parametro de ruta con el id del servidor; `channelParam` = parametro de ruta con un id de canal/hilo (el nucleo resuelve su servidor con
     * GET /channels/{id}; un canal sin servidor, p. ej. un MD, se rechaza); `filterList` = la respuesta es una lista de servidores y se filtra a los permitidos.
     * Solo con credential "bot".
     */
    guild?: { param?: string; channelParam?: string; filterList?: boolean };
    /** Marcadores de RUTA que salen de un ajuste NO secreto (p. ej. {applicationId}). Valor validado con el juego de caracteres fijo de variables. Solo credential "bot". */
    pathSettings?: Record<string, string>;
};

/**
 * Credencial BOT de un proveedor (Discord): token secreto que SOLO guarda el nucleo (cifrado, anclado a los hosts aprobados) y que se inyecta como
 * `Authorization: Bot <token>`. Jamas llega a una extension. Los demas ajustes son NO secretos. Requiere oauth.provider.v3.
 */
export type OAuthBotDef = {
    /** Campo secret:true del settingsSchema con el token del bot. */
    tokenCredential: string;
    /** Patron ANCLADO que debe cumplir el token al guardarlo (formato, no validez). */
    tokenPattern: string;
    /** Ajuste NO secreto con el id de la aplicacion (Application ID). */
    applicationIdSetting: string;
    /** Ajuste NO secreto con el servidor por defecto. */
    defaultGuildSetting?: string;
    /** Ajuste NO secreto con la lista (comas/espacios) de servidores permitidos; vacia = solo el servidor por defecto. */
    allowedGuildsSetting?: string;
    /** Ajuste NO secreto (boolean) que activa las acciones `moderation`. Desactivado por defecto. */
    moderationSetting?: string;
};
export const OAUTH_BOT_GROUP_RE = /^bot-[a-z][a-z0-9-]{0,26}$/;

/**
 * Dato EXTRA que el nucleo conserva de la respuesta del token (o de un claim del id_token ya verificado) por cuenta conectada, CIFRADO en reposo.
 * `from`: ruta con puntos en el JSON del token ("webhook.id") o "claim:<nombre>" (solo con issuer/jwksUri). Se valida con `pattern` (y `maxLength`) al
 * vincular: si falta o no cumple, la vinculacion falla (salvo required:false). NUNCA llega a una extension, salvo los marcados `public:true` (no
 * sensibles, p. ej. el chat_id verificado) en `accounts().meta`. Los sensibles solo los usa el nucleo para construir la ruta/host de una accion declarada.
 * `hostSuffix` (".my.salesforce.com"): `from` es una URL https y se guarda SOLO la etiqueta que precede al sufijo (la "instancia"), que debe cumplir `pattern`.
 */
export type OAuthExtraDef = { from: string; pattern: string; maxLength?: number; hostSuffix?: string; required?: boolean; public?: boolean };
export const OAUTH_EXTRA_NAME_RE = /^[a-z][a-z0-9_]{0,31}$/;
export const OAUTH_EXTRA_LIMITS = { maxExtras: 6, maxValue: 512 };
const EXTRA_FROM_RE = /^(?:claim:[a-z][a-z0-9_]{0,31}|[A-Za-z_][A-Za-z0-9_]{0,31}(?:\.[A-Za-z_][A-Za-z0-9_]{0,31}){0,3})$/;

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
    /** Datos extra (cifrados por cuenta) que se conservan de la respuesta del token. Requiere oauth.provider.v2. */
    extras?: Record<string, OAuthExtraDef>;
    /** Id de una accion (noAuth, sin parametros obligatorios) que el nucleo ejecuta con los datos extra de la cuenta AL DESCONECTAR, antes de borrarla (p. ej. borrar el webhook de Discord). Mejor esfuerzo. Requiere oauth.provider.v2. */
    onUnlink?: string;
    /** Credencial BOT (token secreto del nucleo + ajustes de servidores permitidos y moderacion). Requiere oauth.provider.v3. */
    botCredential?: OAuthBotDef;
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
    jira: ["core-jiralib"],
    calendly: ["core-calendlylib"],
    gitlab: ["core-gitlablib"],
    facebook: ["core-facebooklib"],
    apple: ["core-applelib"],
    linkedin: ["core-linkedinlib"],
    dropbox: ["core-dropboxlib"],
    notion: ["core-notionlib"],
    hubspot: ["core-hubspotlib"],
    airtable: ["core-airtablelib"],
    asana: ["core-asanalib"],
    todoist: ["core-todoistlib"],
    salesforce: ["core-salesforcelib"],
    "salesforce-sandbox": ["core-salesforcelib"],
    discord: ["core-discordlib"],
    telegram: ["core-telegramlib"],
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

/**
 * Etiqueta de host ("instancia") de una URL https RECIBIDA del proveedor, o null. Estricta: sin userinfo, puerto, ruta, consulta, fragmento, mayusculas,
 * %, unicode ni backslash; el host debe acabar EXACTAMENTE en `hostSuffix` y lo que precede debe cumplir `pattern`.
 */
export function hostLabelFromUrl(raw: unknown, hostSuffix: string, pattern: string): string | null {
    if (typeof raw !== "string" || raw.length > 200 || !hostSuffix.startsWith(".")) return null;
    const m = /^https:\/\/([a-z0-9.-]+)\/?$/.exec(raw);
    if (!m) return null;
    const host = m[1];
    if (!host.endsWith(hostSuffix) || host.length <= hostSuffix.length) return null;
    const label = host.slice(0, host.length - hostSuffix.length);
    if (label.includes("..") || label.startsWith(".") || label.endsWith(".")) return null;
    return safePatternTest(pattern, label) ? label : null;
}

function pickPath(source: unknown, path: string[]): unknown {
    let cur: unknown = source;
    for (const key of path) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") return undefined;
        if (typeof cur !== "object" || cur === null || Array.isArray(cur) || !Object.prototype.hasOwnProperty.call(cur, key)) return undefined;
        cur = (cur as Record<string, unknown>)[key];
    }
    return cur;
}

/**
 * Extrae y VALIDA los datos extra de la respuesta del token / claims del id_token. null si alguno requerido falta o no cumple (la vinculacion debe fallar).
 * Solo devuelve cadenas que cumplen el patron del proveedor y el juego de caracteres imprimible ASCII.
 */
export function extractOAuthExtras(extras: Record<string, OAuthExtraDef> | undefined, token: unknown, claims: unknown): Record<string, string> | null {
    const out: Record<string, string> = {};
    for (const [name, def] of Object.entries(extras ?? {})) {
        const raw = def.from.startsWith("claim:") ? pickPath(claims, [def.from.slice(6)]) : pickPath(token, def.from.split("."));
        if (raw === undefined || raw === null || raw === "") {
            if (def.required === false) continue;
            return null;
        }
        let value: string | null = null;
        if (def.hostSuffix) value = hostLabelFromUrl(raw, def.hostSuffix, def.pattern);
        else {
            const text = typeof raw === "string" ? raw : typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 ? String(raw) : null;
            if (text !== null && text.length <= Math.min(def.maxLength ?? 256, OAUTH_EXTRA_LIMITS.maxValue) && /^[\x21-\x7e]+$/.test(text) && safePatternTest(def.pattern, text)) value = text;
        }
        if (value === null) return null;
        out[name] = value;
    }
    return out;
}

/** Host efectivo de una accion con `apiHostExtra`: `<instancia><sufijo>` ya validado; null si la cuenta no tiene el dato. */
export function extraHost(def: OAuthExtraDef | undefined, value: unknown): string | null {
    if (!def?.hostSuffix || typeof value !== "string" || !safePatternTest(def.pattern, value) || !/^[a-z0-9.-]+$/.test(value) || value.includes("..")) return null;
    return `${value}${def.hostSuffix}`;
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
        const known = ["id", "displayName", "icon", "authorizeUrl", "tokenUrl", "revokeUrl", "userinfoUrl", "issuer", "jwksUri", "apiBase", "actions", "principals", "allowedHosts", "scopes", "defaultScopes", "pkce", "extraParams", "clientIdSetting", "clientSecretCredential", "redirectPath", "tokenAuth", "tokenFormat", "revokeToken", "variables", "serviceCredentials", "extras", "onUnlink", "botCredential"];
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
        // Datos extra por cuenta (cifrados): ver OAuthExtraDef.
        const extraDefs: Record<string, OAuthExtraDef> = {};
        if (o.extras !== undefined) {
            const ex = o.extras as Record<string, unknown>;
            if (typeof ex !== "object" || ex === null || Array.isArray(ex)) err(`${at}.extras`, "Debe ser un objeto { nombre: { from, pattern, ... } }");
            else {
                const entries = Object.entries(ex);
                if (entries.length > OAUTH_EXTRA_LIMITS.maxExtras) err(`${at}.extras`, `Maximo ${OAUTH_EXTRA_LIMITS.maxExtras}`);
                for (const [name, def] of entries) {
                    const eat = `${at}.extras.${name}`;
                    if (!OAUTH_EXTRA_NAME_RE.test(name)) { err(eat, "Nombre invalido ([a-z][a-z0-9_], max 32)"); continue; }
                    if (typeof def !== "object" || def === null || Array.isArray(def)) { err(eat, "Debe ser un objeto"); continue; }
                    const d = def as Record<string, unknown>;
                    for (const k of Object.keys(d)) if (!["from", "pattern", "maxLength", "hostSuffix", "required", "public"].includes(k)) err(`${eat}.${k}`, "Clave desconocida");
                    let ok = true;
                    if (typeof d.from !== "string" || !EXTRA_FROM_RE.test(d.from)) { err(`${eat}.from`, "Ruta con puntos del JSON del token (p. ej. webhook.id) o claim:<nombre>"); ok = false; }
                    else if (d.from.startsWith("claim:") && (typeof o.issuer !== "string" || typeof o.jwksUri !== "string")) { err(`${eat}.from`, "Un claim exige issuer y jwksUri (el id_token se verifica)"); ok = false; }
                    const problem = typeof d.pattern === "string" && d.pattern.length <= 100 ? regexProblem(d.pattern) : "String (max 100)";
                    if (problem) { err(`${eat}.pattern`, problem); ok = false; }
                    else if (typeof d.pattern === "string" && !(d.pattern.startsWith("^") && d.pattern.endsWith("$"))) { err(`${eat}.pattern`, "El patron debe estar anclado (^...$)"); ok = false; }
                    if (d.maxLength !== undefined && (!Number.isInteger(d.maxLength) || (d.maxLength as number) < 1 || (d.maxLength as number) > OAUTH_EXTRA_LIMITS.maxValue)) { err(`${eat}.maxLength`, `Entero 1..${OAUTH_EXTRA_LIMITS.maxValue}`); ok = false; }
                    for (const k of ["required", "public"] as const) if (d[k] !== undefined && typeof d[k] !== "boolean") { err(`${eat}.${k}`, "Debe ser boolean"); ok = false; }
                    if (d.hostSuffix !== undefined) {
                        const suffix = d.hostSuffix;
                        if (typeof suffix !== "string" || !suffix.startsWith(".") || !isPublicDnsHost(suffix.slice(1)) || suffix.slice(1).startsWith("*")) { err(`${eat}.hostSuffix`, "Sufijo DNS publico que empieza por . (p. ej. .my.salesforce.com)"); ok = false; }
                        else if (!hosts.some((h) => h === `*${suffix}` || h.startsWith("*.") && suffix.endsWith(h.slice(1)))) { err(`${eat}.hostSuffix`, `allowedHosts debe incluir *${suffix}`); ok = false; }
                        if (d.public === true) { err(`${eat}.public`, "Un dato de host no es publico"); ok = false; }
                    }
                    if (ok) extraDefs[name] = d as unknown as OAuthExtraDef;
                }
            }
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
        if (o.botCredential !== undefined) {
            const b = o.botCredential as Record<string, unknown>;
            const bat = `${at}.botCredential`;
            if (typeof b !== "object" || b === null || Array.isArray(b)) err(bat, "Debe ser un objeto");
            else {
                for (const k of Object.keys(b)) if (!["tokenCredential", "tokenPattern", "applicationIdSetting", "defaultGuildSetting", "allowedGuildsSetting", "moderationSetting"].includes(k)) err(`${bat}.${k}`, "Clave desconocida");
                if (typeof b.tokenCredential !== "string" || !/^[A-Z][A-Z0-9_]{1,63}$/.test(b.tokenCredential)) err(`${bat}.tokenCredential`, "Nombre en MAYUSCULAS de un campo secret:true");
                else if (settingsFields && !settingsFields.some((f) => f.key === b.tokenCredential && f.secret)) err(`${bat}.tokenCredential`, `Debe ser un campo secret:true del settingsSchema: ${b.tokenCredential}`);
                const problem = typeof b.tokenPattern === "string" && b.tokenPattern.length <= 160 ? regexProblem(b.tokenPattern) : "String (max 160)";
                if (problem) err(`${bat}.tokenPattern`, problem);
                else if (!(b.tokenPattern as string).startsWith("^") || !(b.tokenPattern as string).endsWith("$")) err(`${bat}.tokenPattern`, "El patron debe estar anclado (^...$)");
                for (const k of ["applicationIdSetting", "defaultGuildSetting", "allowedGuildsSetting", "moderationSetting"] as const) {
                    if (b[k] === undefined && k !== "applicationIdSetting") continue;
                    if (typeof b[k] !== "string" || !b[k]) err(`${bat}.${k}`, "Clave de un ajuste NO secreto del settingsSchema");
                    else if (settingsFields && !settingsFields.some((f) => f.key === b[k] && !f.secret)) err(`${bat}.${k}`, `No existe como ajuste no secreto en settingsSchema: ${b[k]}`);
                }
                if (typeof o.apiBase !== "string") err(bat, "La credencial bot exige apiBase del proveedor");
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

        if (o.actions !== undefined) validateActions(o.actions, `${at}.actions`, err, scopeIds, typeof o.apiBase === "string", hosts, settingsFields, extraDefs, o.botCredential !== undefined);
        if (o.onUnlink !== undefined) {
            const target = Array.isArray(o.actions) ? (o.actions as Array<Record<string, unknown>>).find((a) => a && a.id === o.onUnlink) : undefined;
            const needsParams = target && target.params && typeof target.params === "object" ? Object.values(target.params as Record<string, Record<string, unknown>>).some((d) => d && d.required === true) : false;
            if (!target || target.noAuth !== true || needsParams) err(`${at}.onUnlink`, "Debe ser el id de una accion noAuth sin parametros obligatorios");
        }
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

function validateActions(raw: unknown, at: string, err: Sink, scopeIds: Set<string>, hasApiBase: boolean, hosts: readonly string[], settingsFields?: ReadonlyArray<{ key: string; secret: boolean }>, extraDefs: Record<string, OAuthExtraDef> = {}, hasBot = false): void {
    if (!Array.isArray(raw)) return err(at, "Debe ser un arreglo");
    if (raw.length > OAUTH_ACTION_LIMITS.maxActions) err(at, `Maximo ${OAUTH_ACTION_LIMITS.maxActions} acciones`);
    const everyActionHasBase = raw.every((a) => typeof a === "object" && a !== null && (typeof (a as Record<string, unknown>).apiBase === "string" || typeof (a as Record<string, unknown>).apiHostExtra === "string"));
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
        const pathExtraNames = new Set<string>();
        const pathSettingNames = new Set<string>();
        if (act.pathExtras !== undefined) {
            const pe = act.pathExtras as Record<string, unknown>;
            if (typeof pe !== "object" || pe === null || Array.isArray(pe) || Object.keys(pe).length > 4) err(`${aat}.pathExtras`, "Objeto { marcador: dato extra } (max 4)");
            else for (const [ph, en] of Object.entries(pe)) {
                if (!PARAM_NAME_RE.test(ph) || ph === "__proto__" || ph === "constructor") err(`${aat}.pathExtras.${ph}`, "Marcador invalido");
                else if (typeof en !== "string" || !extraDefs[en] || extraDefs[en].hostSuffix) err(`${aat}.pathExtras.${ph}`, "Debe nombrar un dato extra declarado (no de host) del proveedor");
                else pathExtraNames.add(ph);
            }
        }
        if (act.apiHostExtra !== undefined) {
            if (typeof act.apiHostExtra !== "string" || !extraDefs[act.apiHostExtra]?.hostSuffix) err(`${aat}.apiHostExtra`, "Debe nombrar un dato extra declarado con hostSuffix");
            if (act.apiBase !== undefined) err(`${aat}.apiHostExtra`, "Incompatible con apiBase");
        }
        if (act.noAuth !== undefined && typeof act.noAuth !== "boolean") err(`${aat}.noAuth`, "Debe ser boolean");
        if (act.noAuth === true && pathExtraNames.size === 0) err(`${aat}.noAuth`, "Una accion sin token exige pathExtras (la credencial va en la ruta)");
        if (act.fixedBody !== undefined) {
            let size = 0;
            try { size = JSON.stringify(act.fixedBody).length; } catch { size = Infinity; }
            if (typeof act.fixedBody !== "object" || act.fixedBody === null || Array.isArray(act.fixedBody) || size > 2000 || act.method === "GET") err(`${aat}.fixedBody`, "Objeto JSON de hasta 2000 caracteres (no en GET)");
        }
        if (typeof path !== "string" || !path.startsWith("/") || path.length > OAUTH_ACTION_LIMITS.maxPathLength || /[?#\\\s]|\.\.|\/\//.test(path)) err(`${aat}.path`, "Ruta relativa que empieza por / (sin ?, #, .., // ni espacios)");
        else {
            for (const m of path.matchAll(/\{([^}]*)\}/g)) {
                if (!PARAM_NAME_RE.test(m[1])) err(`${aat}.path`, `Parametro de ruta invalido: {${m[1]}}`);
                pathParams.add(m[1]);
            }
            if (/[{}]/.test(path.replace(/\{[A-Za-z][A-Za-z0-9_]{0,31}\}/g, ""))) err(`${aat}.path`, "Llaves mal formadas");
        }
        if (act.credential !== undefined) {
            if (act.credential !== "bot") err(`${aat}.credential`, "Solo \"bot\"");
            else {
                if (!hasBot) err(`${aat}.credential`, "El proveedor debe declarar botCredential");
                if (typeof act.group !== "string" || !OAUTH_BOT_GROUP_RE.test(act.group)) err(`${aat}.group`, "Una accion bot usa un grupo bot-* (bot-read, bot-write, bot-mod)");
                if (act.noAuth !== undefined || act.pathExtras !== undefined || act.apiHostExtra !== undefined || act.requiresScopes !== undefined) err(`${aat}.credential`, "Incompatible con noAuth, pathExtras, apiHostExtra y requiresScopes");
                if (act.moderation === true && act.group !== "bot-mod") err(`${aat}.moderation`, "Una accion de moderacion usa el grupo bot-mod");
                if (act.group === "bot-mod" && act.moderation !== true) err(`${aat}.moderation`, "El grupo bot-mod exige moderation: true");
                if (act.method !== "GET" && act.write !== true) err(`${aat}.write`, "Las acciones bot que no son GET declaran write: true");
                if (act.method !== "GET" && typeof act.quotaPerHour !== "number") err(`${aat}.quotaPerHour`, "Las acciones bot de escritura exigen quotaPerHour");
            }
        } else {
            for (const k of ["moderation", "guild", "pathSettings"]) if (act[k] !== undefined) err(`${aat}.${k}`, "Solo con credential: \"bot\"");
            if (typeof act.group === "string" && OAUTH_BOT_GROUP_RE.test(act.group)) err(`${aat}.group`, "Los grupos bot-* son solo de acciones con credential: \"bot\"");
        }
        if (act.moderation !== undefined && typeof act.moderation !== "boolean") err(`${aat}.moderation`, "Debe ser boolean");
        if (act.guild !== undefined) {
            const g = act.guild as Record<string, unknown>;
            if (typeof g !== "object" || g === null || Array.isArray(g) || !Object.keys(g).every((k) => ["param", "channelParam", "filterList"].includes(k))) err(`${aat}.guild`, "Objeto { param | channelParam | filterList }");
            else {
                if (["param", "channelParam", "filterList"].filter((k) => g[k] !== undefined).length !== 1) err(`${aat}.guild`, "Exactamente uno de param, channelParam, filterList");
                for (const k of ["param", "channelParam"] as const) if (g[k] !== undefined && (typeof g[k] !== "string" || !pathParams.has(g[k] as string))) err(`${aat}.guild.${k}`, "Debe nombrar un parametro de ruta de la accion");
                if (g.filterList !== undefined && (g.filterList !== true || act.method !== "GET")) err(`${aat}.guild.filterList`, "true, solo en GET");
            }
        }
        if (act.pathSettings !== undefined) {
            const ps = act.pathSettings as Record<string, unknown>;
            if (typeof ps !== "object" || ps === null || Array.isArray(ps) || Object.keys(ps).length > 2) err(`${aat}.pathSettings`, "Objeto { marcador: ajuste } (max 2)");
            else for (const [ph, key] of Object.entries(ps)) {
                if (!PARAM_NAME_RE.test(ph) || ph === "__proto__" || ph === "constructor" || !pathParams.has(ph)) err(`${aat}.pathSettings.${ph}`, "Debe ser un marcador de la ruta");
                else if (typeof key !== "string" || !key || (settingsFields && !settingsFields.some((f) => f.key === key && !f.secret))) err(`${aat}.pathSettings.${ph}`, "Clave de un ajuste NO secreto del settingsSchema");
                else pathSettingNames.add(ph);
            }
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
                    if (pathExtraNames.has(name)) err(pat, "Ya es un pathExtras: no puede ser un parametro de quien llama");
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
                    if (d.objectKeys !== undefined) {
                        if (d.in !== "body" || d.type !== "object") err(`${pat}.objectKeys`, "Solo parametros in: body de tipo object");
                        else if (!Array.isArray(d.objectKeys) || d.objectKeys.length === 0 || d.objectKeys.length > 50 || d.objectKeys.some((k: unknown) => typeof k !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k) || k === "__proto__" || k === "constructor")) err(`${pat}.objectKeys`, "Arreglo de 1..50 nombres de campo simples");
                        if (d.maxValueLength !== undefined && (!Number.isInteger(d.maxValueLength) || (d.maxValueLength as number) < 1 || (d.maxValueLength as number) > 32000)) err(`${pat}.maxValueLength`, "Entero 1..32000");
                    } else if (d.allowedKeysFromSetting !== undefined || d.maxValueLength !== undefined) err(`${pat}.allowedKeysFromSetting`, "Exige objectKeys");
                    if (d.allowedKeysFromSetting !== undefined && d.objectKeys !== undefined) {
                        if (typeof d.allowedKeysFromSetting !== "string" || !d.allowedKeysFromSetting) err(`${pat}.allowedKeysFromSetting`, "Clave de un ajuste NO secreto del settingsSchema");
                        else if (settingsFields && !settingsFields.some((f) => f.key === d.allowedKeysFromSetting && !f.secret)) err(`${pat}.allowedKeysFromSetting`, `No existe como ajuste no secreto en settingsSchema: ${d.allowedKeysFromSetting}`);
                    }
                    if (d.maxLength !== undefined && (!Number.isInteger(d.maxLength) || (d.maxLength as number) < 1 || (d.maxLength as number) > OAUTH_ACTION_LIMITS.maxStringLength)) err(`${pat}.maxLength`, `Entero 1..${OAUTH_ACTION_LIMITS.maxStringLength}`);
                }
            }
        }
        for (const p of pathParams) if (!declared.has(p) && !pathExtraNames.has(p) && !pathSettingNames.has(p)) err(`${aat}.params`, `Falta declarar el parametro de ruta {${p}}`);
        for (const p of pathExtraNames) if (!pathParams.has(p)) err(`${aat}.pathExtras`, `No aparece en path: {${p}}`);
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
        if (def.objectKeys && typeof v === "object" && v !== null) {
            // Objeto con lista cerrada de campos (p. ej. campos de un Lead): claves fuera de la lista y valores no escalares se rechazan.
            const maxValue = def.maxValueLength ?? 4000;
            const bad = Object.entries(v as Record<string, unknown>).some(([k, val]) => !Object.prototype.hasOwnProperty.call(v, k) || !def.objectKeys!.includes(k) || !(val === null || typeof val === "boolean" || (typeof val === "number" && Number.isFinite(val)) || (typeof val === "string" && val.length <= maxValue)));
            if (bad) { issues.push({ param: name, code: "unknown" }); continue; }
        }
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
export const HIGH_RISK_OAUTH_GROUPS: readonly string[] = Object.freeze(["gmail", "mail", "drive", "files", "admin", "directory", "crm"]);
/** Los grupos `bot-*` (credencial bot compartida del dominio) siempre exigen aprobacion explicita del admin. */
export const isHighRiskOAuthGroup = (group: string): boolean => HIGH_RISK_OAUTH_GROUPS.includes(group) || OAUTH_BOT_GROUP_RE.test(group);

/** Aprobaciones que piden los permisos OAuth de un manifest: toda `OAUTH_SHARED:*` y las `OAUTH_ACCOUNT:*` de grupos de riesgo alto. */
export function oauthApprovalKeys(permissions: unknown): string[] {
    const out = new Set<string>();
    if (!Array.isArray(permissions)) return [];
    for (const p of permissions) {
        if (typeof p !== "string") continue;
        if (/^OAUTH_SHARED:[a-z][a-z0-9-]{1,31}$/.test(p)) out.add(p);
        const m = /^OAUTH_ACCOUNT:([a-z][a-z0-9-]{1,31}):([a-z][a-z0-9-]{0,31})$/.exec(p);
        if (m && isHighRiskOAuthGroup(m[2])) out.add(p);
    }
    return Array.from(out).sort();
}
