/**
 * Modelo de contenido de la documentacion (bilingue es/en).
 *
 * Cada pagina es una lista de bloques por idioma. Marcado en linea permitido en los textos:
 *   `codigo`   **negrita**   [etiqueta](/docs/ruta#ancla)   [etiqueta](https://externo)
 * El contenido es dato (sin JSX): un test (docs.test.ts) valida enlaces, anclas, paridad es/en y variables de entorno.
 */

export type Locale = 'es' | 'en';

export type CalloutKind = 'note' | 'tip' | 'warn' | 'danger';

export type Block =
    | { t: 'h2'; id: string; text: string }
    | { t: 'h3'; id: string; text: string }
    | { t: 'p'; text: string }
    | { t: 'ul'; items: string[] }
    | { t: 'ol'; items: string[] }
    | { t: 'code'; lang?: string; title?: string; code: string }
    | { t: 'table'; head: string[]; rows: string[][]; caption?: string }
    | { t: 'callout'; kind: CalloutKind; title?: string; text: string }
    | { t: 'diagram'; id: 'architecture' | 'signing' | 'mail-flow'; caption: string }
    | { t: 'env'; scope?: 'frontend' | 'backend' | 'all'; group?: string }
    /** Indice de componentes del kit (rejilla de tarjetas por categoria, generada de UI_COMPONENTS). */
    | { t: 'kit-index' }
    /** Vista previa interactiva de los campos de ajustes user / users / userMap (datos de ejemplo en memoria). */
    | { t: 'settings-preview' };

export interface DocPageContent {
    es: Block[];
    en: Block[];
}

export type IconName =
    | 'home' | 'layers' | 'rocket' | 'server' | 'key' | 'mail' | 'palette' | 'layout' | 'eye-off'
    | 'sparkles' | 'flask' | 'shield' | 'scale' | 'component' | 'wrench' | 'code' | 'plug'
    | 'zap' | 'database' | 'life-buoy' | 'help' | 'lock' | 'wand' | 'send';

export interface DocNavPage {
    slug: string; // '' = /docs
    icon: IconName;
    title: Record<Locale, string>;
    description: Record<Locale, string>;
    keywords?: string;
}

export interface DocNavSection {
    id: string;
    title: Record<Locale, string>;
    pages: DocNavPage[];
}
