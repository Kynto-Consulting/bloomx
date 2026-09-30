// Las extensiones nativas del cliente se registran al importar ./registry (p.ej. core-mail-groups) y las
// pestanas de manifests JSON las publica ./dynamic-settings. Se conserva el nombre por compatibilidad con
// importadores antiguos; no hay nada que cargar de forma imperativa.

export function ensureClientExpansions() {
    // no-op deliberado
}
