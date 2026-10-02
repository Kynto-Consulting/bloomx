/** true si el manifest declara la capacidad solo-de-catalogo en requires (lo que NO debe hacer). */
export function detectCatalogMetadataRequires(manifest: any): boolean {
    return Array.isArray(manifest?.requires?.capabilities) && manifest.requires.capabilities.includes('market.catalog.v1');
}
