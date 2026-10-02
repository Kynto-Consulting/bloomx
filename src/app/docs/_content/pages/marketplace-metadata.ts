import type { Block, DocPageContent } from '../types';
import { CATEGORY_IDS, MANIFEST_LIMITS } from '@/lib/expansions/manifest-schema';

/**
 * Guia «Publicar tus metadatos de catalogo». El manifest de ejemplo es un OBJETO exportado (GUIDE_METADATA): un test lo valida con
 * el MISMO validador que la aplicacion (marketplace-metadata.test.ts), asi la guia no puede mostrar un manifest que el servidor rechazaria.
 */

type Lang = 'es' | 'en';
const T = (lang: Lang, es: string, en: string): string => (lang === 'es' ? es : en);

export function guideMetadata(lang: Lang): Record<string, any> {
    return {
        manifestVersion: '1.0',
        id: 'core-example',
        version: '1.0.1',
        name: T(lang, 'Ejemplo de catálogo', 'Catalog example'),
        description: T(lang, 'Muestra cómo describir una extensión en el marketplace.', 'Shows how to describe an extension in the marketplace.'),
        icon: 'lucide:Puzzle',
        publisher: { id: 'bloomx', name: 'Bloomx', official: true, verified: true },
        suite: { id: 'ejemplos', name: T(lang, 'Ejemplos', 'Examples'), icon: 'lucide:FlaskConical' },
        category: 'mail',
        categories: ['mail', 'automation'],
        tags: [T(lang, 'ejemplo', 'example'), T(lang, 'plantilla', 'template')],
        screenshots: ['https://assets.example.com/core-example/inbox.png'],
        changelog: [
            { version: '1.0.1', date: '2026-10-01', notes: [T(lang, 'Describe la extensión en el marketplace.', 'Describes the extension in the marketplace.')] },
            { version: '1.0.0', date: '2026-09-01', notes: T(lang, 'Primera versión.', 'First version.') },
        ],
        permissions: [],
    };
}

const blocks = (lang: Lang): Block[] => [
    { t: 'p', text: T(lang,
        'Los metadatos de catálogo describen tu extensión en el [marketplace](/docs/marketplace): quién la publica, a qué marca pertenece, en qué categorías aparece, con qué etiquetas se encuentra, cómo se ve y qué cambió en cada versión. Son **opcionales e informativos**: no cambian lo que la extensión hace ni qué versión recibe cada instancia.',
        'Catalog metadata describes your extension in the [marketplace](/docs/marketplace): who publishes it, which brand it belongs to, which categories it appears in, which tags find it, how it looks and what changed in each version. It is **optional and informational**: it does not change what the extension does nor which version each instance receives.') },

    { t: 'h2', id: 'fields', text: T(lang, 'Campos', 'Fields') },
    { t: 'table', head: [T(lang, 'Campo', 'Field'), T(lang, 'Forma', 'Shape'), T(lang, 'Notas', 'Notes')], rows: [
        ['`publisher`', '`{ id, name, icon?, url?, verified?, official? }`', T(lang, 'Sin él, las `core-*` son de **Bloomx** (oficial) y el resto «Comunidad». `id`: `[a-z0-9-]`, 2-40. `url`: https. `official` y `verified` **solo** en extensiones `core-*`.', 'Without it, `core-*` extensions belong to **Bloomx** (official) and the rest to "Community". `id`: `[a-z0-9-]`, 2-40. `url`: https. `official` and `verified` **only** on `core-*` extensions.')],
        ['`suite`', '`{ id, name, icon? }`', T(lang, 'Agrupa productos de una misma marca (carpeta del marketplace). Todas las extensiones con el mismo `suite.id` forman la suite. `icon`: `brand:`, `lucide:` o `initials:`.', 'Groups products of one brand (a marketplace folder). Every extension with the same `suite.id` forms the suite. `icon`: `brand:`, `lucide:` or `initials:`.')],
        ['`categories`', T(lang, '1 a 3 ids', '1 to 3 ids'), T(lang, `La primera es la principal. Valores: ${CATEGORY_IDS.map((c) => `\`${c}\``).join(', ')}. Sin ellas se usa \`category\` (singular).`, `The first is the main one. Values: ${CATEGORY_IDS.map((c) => `\`${c}\``).join(', ')}. Without them \`category\` (singular) is used.`)],
        ['`tags`', T(lang, 'Textos', 'Strings'), T(lang, `Hasta ${MANIFEST_LIMITS.maxTags}, de ${MANIFEST_LIMITS.maxTag} caracteres, sin HTML. La búsqueda las usa.`, `Up to ${MANIFEST_LIMITS.maxTags}, ${MANIFEST_LIMITS.maxTag} characters each, no HTML. Search uses them.`)],
        ['`screenshots`', T(lang, 'URLs https', 'https URLs'), T(lang, `Hasta ${MANIFEST_LIMITS.maxScreenshots}, de hasta ${MANIFEST_LIMITS.maxScreenshotUrl} caracteres, sin usuario ni clave. Se muestran con tamaño fijo y carga diferida. Imágenes de terceros solo se cargan tras aceptar el administrador.`, `Up to ${MANIFEST_LIMITS.maxScreenshots}, up to ${MANIFEST_LIMITS.maxScreenshotUrl} characters, no user or password. Shown at a fixed size with lazy loading. Third-party images load only after the administrator agrees.`)],
        ['`changelog`', '`[{ version, date?, notes? }]`', T(lang, `Hasta ${MANIFEST_LIMITS.maxChangelog} entradas; \`notes\` es texto o lista (hasta ${MANIFEST_LIMITS.maxChangelogNotes} caracteres). Se muestra en la pestaña **Versiones**, emparejado por número de versión.`, `Up to ${MANIFEST_LIMITS.maxChangelog} entries; \`notes\` is text or a list (up to ${MANIFEST_LIMITS.maxChangelogNotes} characters). Shown in the **Versions** tab, matched by version number.`)],
    ] },

    { t: 'h2', id: 'example', text: T(lang, 'Ejemplo', 'Example') },
    { t: 'code', lang: 'json', title: 'manifest.json', code: JSON.stringify(guideMetadata(lang), null, 2) },

    { t: 'h2', id: 'compat', text: T(lang, 'No los declares en `requires`', 'Do not declare them in `requires`') },
    { t: 'p', text: T(lang,
        'El backend entrega estos campos aparte (campo `market` del catálogo) a los clientes que declaran la capacidad `market.catalog.v1`; el manifest ejecutable no cambia. **No la pongas en `requires.capabilities`**: el validador y el backend lo rechazan, porque las instancias antiguas dejarían de recibir tu extensión. Subir de versión (parche) al añadir los metadatos es suficiente.',
        'The backend delivers these fields separately (the `market` catalog field) to clients that declare the `market.catalog.v1` capability; the executable manifest does not change. **Do not put it in `requires.capabilities`**: the validator and the backend reject it, because old instances would stop receiving your extension. Bumping the version (patch) when you add the metadata is enough.') },
    { t: 'callout', kind: 'warn', title: T(lang, 'Oficial y verificado', 'Official and verified'), text: T(lang,
        '`official` y `verified` no son una declaración libre: solo las extensiones `core-*` de la plataforma pueden llevarlos, y el catálogo vuelve a calcular `official` desde el id y el editor `bloomx`. Un tercero que los escriba recibe un error al validar.',
        '`official` and `verified` are not free-form claims: only the platform\'s `core-*` extensions can carry them, and the catalog recomputes `official` from the id and the `bloomx` publisher. A third party writing them gets a validation error.') },

    { t: 'h2', id: 'checklist', text: T(lang, 'Lista de comprobación', 'Checklist') },
    { t: 'ol', items: [
        T(lang, 'Añade `publisher`, `suite` (si hay marca), `categories`, `tags` y, si quieres, `screenshots` y `changelog`.', 'Add `publisher`, `suite` (if there is a brand), `categories`, `tags` and, if you want, `screenshots` and `changelog`.'),
        T(lang, 'Sube la versión (parche) en `manifest.json`: las versiones publicadas son inmutables.', 'Bump the version (patch) in `manifest.json`: published versions are immutable.'),
        T(lang, 'Valida con `npm run validate -- <carpeta>` (o `validate:all`) y `npm run versions:check`.', 'Validate with `npm run validate -- <folder>` (or `validate:all`) and `npm run versions:check`.'),
        T(lang, 'Comprueba el resultado en `/admin/extensions` → Catálogo: tarjeta, suite, página del editor y pestaña Versiones.', 'Check the result in `/admin/extensions` → Catalog: card, suite, publisher page and the Versions tab.'),
    ] },
    { t: 'p', text: T(lang, 'Lecturas relacionadas: [Cómo funciona el marketplace](/docs/marketplace), [Crear una extensión](/docs/create-extension) y [Herramientas de extensiones](/docs/extension-tools).', 'Related reading: [How the marketplace works](/docs/marketplace), [Build an extension](/docs/create-extension) and [Extension tools](/docs/extension-tools).') },
];

const page: DocPageContent = { es: blocks('es'), en: blocks('en') };

export default page;
