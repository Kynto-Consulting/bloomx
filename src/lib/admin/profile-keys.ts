/**
 * Deteccion (pura, sin dependencias de servidor: la usan la ruta y la UI) de material PRIVADO pegado por error donde
 * solo se admite la clave publica. Nunca se envia ni se procesa: se rechaza antes.
 */

// Prefijo base64 del DER PKCS8 de Ed25519 (302e020100300506032b657004220420): una clave privada pegada en base64.
const PKCS8_B64_PREFIX = /^MC4CAQAwBQYDK2VwBCIEI/;

export function looksLikePrivateKey(text: string): boolean {
    const compact = text.replace(/\s+/g, '');
    return /PRIVATE\s*KEY/i.test(text) || /BLOOMX_DOMAIN_PRIVATE_KEY/i.test(text) || PKCS8_B64_PREFIX.test(compact);
}
