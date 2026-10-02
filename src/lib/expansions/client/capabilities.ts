/**
 * Identidad de ESTE cliente (frontend) ante el backend compartido de extensiones. UNICA fuente de verdad de:
 *   - CLIENT_API_VERSION   version del CONTRATO cliente<->backend de extensiones (entero; NO es la version de la app ni el build).
 *   - CLIENT_CAPABILITIES  funciones que este cliente sabe ejecutar (cadenas estables, ver CAPABILITY_REGISTRY).
 *
 * Se envia en TODAS las llamadas al backend de extensiones (X-BloomX-Client-Api / X-BloomX-Client-Caps) y, con firma Ed25519 activa,
 * forma parte del mensaje firmado (lib/backend-auth.ts, firma V2). El backend sirve a cada instancia la version de cada extension que
 * su cliente entiende (manifest `requires`). Un cliente que no envia nada es la linea base `legacy`.
 *
 * REGLA: cuando el cliente gane una funcion que una extension pueda usar:
 *   1. registrala en CAPABILITY_REGISTRY (client-contract.ts, copia identica en los 3 repos) con `since` = la CLIENT_API_VERSION que la incluye;
 *   2. anade su id a CLIENT_CAPABILITIES aqui (el test falla si falta o sobra);
 *   3. sube CLIENT_API_VERSION si cambia el contrato de forma incompatible o si `since` supera la actual;
 *   4. si una extension va a usarla, anade la regla en bloomx-extensions/_shared/feature-rules.mjs.
 */
import {
    CAPABILITY_REGISTRY,
    LEGACY_BASELINE_CAPABILITIES,
    formatClientHeaders,
    makeClientIdentity,
    type ClientIdentity,
} from '../client-contract';
import { hasValidDomainKey } from '@/lib/domain-key';

// 3 = dependencias entre extensiones (ext.dependencies.v1). 4 = rutas y paginas de extensiones con modos de auth (ext.routes.v1,
// ext.routes.auth.v1, ext.pages.auth.v1). 5 = proveedores OAuth de extensiones + intermediario (oauth.provider.v1, oauth.broker.v1).
// 6 = concesiones de ejecucion firmadas por la instancia (ext.grants.v1): ya no hace falta ninguna clave global del backend.
// 7 = eventos de ciclo de vida v2 + ctx.services.users (lifecycle.events.v2).
// 8 = paginas completas (ui.pages.v1: PAGE_HEADER, CHART, TREE...) y entradas de navegacion de extensiones (nav.entries.v1).
// 9 = proveedores OAuth v2 (oauth.provider.v2): MicrosoftLib, ZoomLib y SlackLib.
// 10 = pagos con PayPal y portal de desarrolladores (billing.paypal.v1, marketplace.developer.v1): los proxies /api/admin/billing y /api/admin/developer firman con la clave de dominio.
// 11 = marketplace de extensiones (market.catalog.v1): metadatos de tienda en el catalogo publico (informativos, nunca en requires).
// 12 = credencial BOT de proveedores OAuth (oauth.provider.v3): DiscordLib 1.1.0 (acciones con token de bot, solo del nucleo) e Interactions por HTTP.
export const CLIENT_API_VERSION = 12;

/** Capacidades que ESTE cliente implementa (ademas de la linea base). Mantener en orden alfabetico. */
export const CLIENT_CAPABILITIES: readonly string[] = [
    'ai.json',
    'ai.v1',
    'billing.paypal.v1',
    'conferencing.picker',
    'ext.dependencies.v1',
    'ext.grants.v1',
    'ext.pages.auth.v1',
    'ext.routes.auth.v1',
    'ext.routes.v1',
    'lifecycle.events.v1',
    'lifecycle.events.v2',
    'market.catalog.v1',
    'marketplace.developer.v1',
    'nav.entries.v1',
    'oauth.broker.v1',
    'oauth.provider.v1',
    'oauth.provider.v2',
    'oauth.provider.v3',
    'services.host.v1',
    'settings.schema.v1',
    'settings.users.v1',
    'toolbar.compact',
    'ui.input.onSubmit',
    'ui.kit.v2',
    'ui.pages.v1',
];

/** Identidad COMPLETA (instancia con clave de dominio). */
export const CLIENT_IDENTITY: ClientIdentity = makeClientIdentity(CLIENT_API_VERSION, [...LEGACY_BASELINE_CAPABILITIES, ...CLIENT_CAPABILITIES]);

/**
 * CLASIFICACION de capacidades segun lo que necesitan para funcionar (leido del codigo que las respalda):
 *
 *  - `signed-only`: exigen que ESTA instancia firme (BLOOMX_DOMAIN_PRIVATE_KEY) porque dependen de que el backend pueda llamarla de vuelta o de que ella
 *    firme lo que le manda al backend:
 *      ext.grants.v1      la instancia emite la executionGrant (lib/exec-grant.ts: sin clave no se emite).
 *      oauth.broker.v1    el intermediario OAuth lo llama el backend en /api/internal/host/oauth con la executionGrant.
 *      oauth.provider.v1  el registro/flujo OAuth y GoogleLib van de la mano del intermediario (se publican juntos: GoogleLib exige ambas).
 *      oauth.provider.v2  MicrosoftLib/ZoomLib/SlackLib: mismo broker firmado + funciones del flujo que solo conoce este nucleo; sin clave de dominio no se anuncia y no reciben estas extensiones.
 *      lifecycle.events.v2  ctx.services.users viaja por el puente /api/internal/users con la executionGrant y los eventos USER_CREATED, USER_DISABLED, EMAIL_SPAM_DETECTED y LABEL_APPLIED
 *                         solo se ejecutan con usuario firmado: sin clave no hay nada que entregar (se publica con el servicio, que exige firma).
 *      billing.paypal.v1 / marketplace.developer.v1   (since 10) los proxies /api/admin/billing|developer reenvian al backend con la identidad FIRMADA del dueno del dominio; el backend de pagos rechaza el modo legado (403 signature_required), asi que sin clave no hay nada que ofrecer.
 *      ext.routes.v1 / ext.routes.auth.v1   el router /api/ext/* firma `_bx_src=edge`/nivel/IP en la URL y el backend rechaza el modo legado.
 *  - `unsigned-ok`: funcionan sin clave. Cliente puro (ui.kit.v2, ui.input.onSubmit, toolbar.compact, settings.schema.v1, conferencing.picker),
 *    logica del backend independiente de la firma (ext.dependencies.v1, pausa de dependientes) o capacidades que YA anunciaba la version desplegada
 *    en instancias sin clave y que degradan sin romper (ai.v1 / ai.json: sin puente usan el camino heredado; services.host.v1: `services.*` queda
 *    sin disponer y las extensiones lo toleran; lifecycle.events.v1: el backend simplemente no los ejecuta sin usuario firmado; ext.pages.auth.v1:
 *    la guardia de paginas se evalua en la instancia). Cambiar su clasificacion cambiaria las versiones que hoy reciben esas instancias.
 *    ui.pages.v1 / nav.entries.v1 (since 8): UI pura del cliente. Los componentes se pintan y las entradas se muestran sin ninguna llamada firmada; los DATOS
 *    de una pagina (CALL_BACKEND / rutas) y la insignia de una entrada dependen de ext.routes.v1 / server.execute.v1, que ya se declaran por separado en el
 *    `requires` de la extension que los usa, y la insignia degrada sola (sin numero) si la ruta no responde. Criterio: una capacidad es `unsigned-ok` si lo
 *    que ella aporta funciona sin clave; lo que necesite firma lo exige su propia capacidad. Nota: por la regla de announcedIdentity una instancia sin clave
 *    anuncia como maximo clientApi 3, asi que estas capacidades solo se anuncian (y sus versiones solo se sirven) cuando la instancia registra su clave.
 *    market.catalog.v1 (since 11): marketplace. Es `unsigned-ok` porque el catalogo es PUBLICO y sin credenciales: no necesita firma. Como es informativa
 *    (ningun manifest la declara en `requires`; el backend solo anade el campo `market` a la respuesta), la peticion del catalogo la anade a la cabecera de
 *    capacidades incluso sin clave de dominio (catalogClientHeaders), sin tocar la identidad anunciada: las versiones de extensiones que recibe la instancia
 *    no cambian (lo demuestra bloomx-extensions/tests/market-catalog.test.mjs + unsigned-catalog.test.mjs).
 */
export const CAPABILITY_CLASS: Readonly<Record<string, 'signed-only' | 'unsigned-ok'>> = Object.freeze(
    Object.fromEntries(CLIENT_CAPABILITIES.map((c): [string, 'signed-only' | 'unsigned-ok'] => [c, (['ext.grants.v1', 'oauth.broker.v1', 'oauth.provider.v1', 'oauth.provider.v2', 'oauth.provider.v3', 'ext.routes.v1', 'ext.routes.auth.v1', 'lifecycle.events.v2', 'billing.paypal.v1', 'marketplace.developer.v1'] as readonly string[]).includes(c) ? 'signed-only' : 'unsigned-ok'])),
);
export const SIGNED_ONLY_CAPABILITIES: readonly string[] = CLIENT_CAPABILITIES.filter((c) => CAPABILITY_CLASS[c] === 'signed-only');

/**
 * Identidad que se ANUNCIA al backend. Con clave de dominio valida: la completa. Sin clave: solo las `unsigned-ok` y un clientApi igual a la mayor
 * version cuyo conjunto completo de capacidades (las del registro con `since` <= version) es anunciable, es decir, justo antes de la primera `signed-only`.
 * Asi una instancia sin clave recibe de la version de cada extension lo mismo que antes y, al registrar su clave, pasa sola a las nuevas.
 */
export function announcedIdentity(signed: boolean): ClientIdentity {
    if (signed) return CLIENT_IDENTITY;
    const firstSignedSince = Math.min(...SIGNED_ONLY_CAPABILITIES.map((c) => CAPABILITY_REGISTRY[c]?.since ?? Infinity));
    const api = Math.min(CLIENT_API_VERSION, firstSignedSince - 1);
    const caps = CLIENT_CAPABILITIES.filter((c) => CAPABILITY_CLASS[c] === 'unsigned-ok' && (CAPABILITY_REGISTRY[c]?.since ?? Infinity) <= api);
    return makeClientIdentity(api, [...LEGACY_BASELINE_CAPABILITIES, ...caps]);
}
export const UNSIGNED_CLIENT_IDENTITY: ClientIdentity = announcedIdentity(false);

/** Identidad efectiva de ESTA instancia (servidor): completa solo con BLOOMX_DOMAIN_PRIVATE_KEY valida. */
export function currentClientIdentity(env: Record<string, string | undefined> = process.env): ClientIdentity {
    return announcedIdentity(hasValidDomainKey(env));
}

/** Cabeceras de version del cliente (compactas) para cualquier llamada al backend de extensiones (segun la clave de dominio de la instancia). */
export function clientVersionHeaders(signed: boolean = hasValidDomainKey()): Record<string, string> {
    return { ...formatClientHeaders(announcedIdentity(signed)) };
}

export const MARKET_CATALOG_CAPABILITY = 'market.catalog.v1';

/**
 * Cabeceras de la peticion del CATALOGO PUBLICO: las de siempre (segun la clave de dominio) + `market.catalog.v1` en la lista de capacidades,
 * con o sin clave. La capacidad solo hace que el backend anada el campo `market`; no cambia la version de ninguna extension que se resuelve.
 */
export function catalogClientHeaders(signed: boolean = hasValidDomainKey()): Record<string, string> {
    const identity = announcedIdentity(signed);
    const caps = identity.capabilities.includes(MARKET_CATALOG_CAPABILITY) ? identity.capabilities : [...identity.capabilities, MARKET_CATALOG_CAPABILITY];
    return { ...formatClientHeaders({ clientApi: identity.clientApi, capabilities: caps }) };
}

/** Texto es/en de una capacidad (panel de Estado del admin). */
export function describeCapability(id: string, locale: 'es' | 'en' = 'es'): string {
    const info = CAPABILITY_REGISTRY[id];
    return info ? info[locale] : id;
}

/** Cabecera con la que el backend puede anunciar la version minima de cliente que soporta (ver useClientVersion / PWA). */
export const MIN_CLIENT_API_HEADER = 'x-bloomx-min-client-api';
