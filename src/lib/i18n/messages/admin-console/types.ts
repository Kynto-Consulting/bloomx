/**
 * Utilidad de tipos para los diccionarios de la consola de administracion.
 * Cada seccion define `xxxEs` (as const) y `xxxEn: DeepString<typeof xxxEs>`: el compilador obliga a que ambos idiomas
 * tengan exactamente las mismas claves (ademas de i18n.test.ts).
 */
export type DeepString<T> = { [K in keyof T]: T[K] extends string ? string : DeepString<T[K]> };
