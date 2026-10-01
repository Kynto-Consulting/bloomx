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

// 3 = dependencias entre extensiones (ext.dependencies.v1). 4 = rutas y paginas de extensiones con modos de auth (ext.routes.v1,
// ext.routes.auth.v1, ext.pages.auth.v1). 5 = proveedores OAuth de extensiones + intermediario (oauth.provider.v1, oauth.broker.v1).
export const CLIENT_API_VERSION = 5;

/** Capacidades que ESTE cliente implementa (ademas de la linea base). Mantener en orden alfabetico. */
export const CLIENT_CAPABILITIES: readonly string[] = [
    'ai.json',
    'ai.v1',
    'conferencing.picker',
    'ext.dependencies.v1',
    'ext.pages.auth.v1',
    'ext.routes.auth.v1',
    'ext.routes.v1',
    'lifecycle.events.v1',
    'oauth.broker.v1',
    'oauth.provider.v1',
    'services.host.v1',
    'settings.schema.v1',
    'toolbar.compact',
    'ui.input.onSubmit',
    'ui.kit.v2',
];

export const CLIENT_IDENTITY: ClientIdentity = makeClientIdentity(CLIENT_API_VERSION, [...LEGACY_BASELINE_CAPABILITIES, ...CLIENT_CAPABILITIES]);

/** Cabeceras de version del cliente (compactas) para cualquier llamada al backend de extensiones. */
export function clientVersionHeaders(): Record<string, string> {
    return { ...formatClientHeaders(CLIENT_IDENTITY) };
}

/** Texto es/en de una capacidad (panel de Estado del admin). */
export function describeCapability(id: string, locale: 'es' | 'en' = 'es'): string {
    const info = CAPABILITY_REGISTRY[id];
    return info ? info[locale] : id;
}

/** Cabecera con la que el backend puede anunciar la version minima de cliente que soporta (ver useClientVersion / PWA). */
export const MIN_CLIENT_API_HEADER = 'x-bloomx-min-client-api';
