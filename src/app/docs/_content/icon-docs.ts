import type { Block } from './types';
import { BRAND_ICONS, NEUTRAL_BRANDS } from '@/lib/expansions/brand-icons';
import { FUNCTIONAL_ICONS } from '@/lib/expansions/functional-icons';

/**
 * Seccion "Iconos de extensiones" de la pagina extension-ui. La lista de logotipos y de iconos funcionales se GENERA del registro
 * (brand-icons.ts / functional-icons.ts): la documentacion no puede quedar desfasada.
 */
const MANIFEST_EXAMPLE = `{
  "id": "acme-zoom",
  "name": "Acme Zoom",
  "icon": "brand:zoom",
  "i18n": {
    "es": { "name": "Zoom", "description": "Crea reuniones de Zoom" },
    "en": { "name": "Zoom", "description": "Create Zoom meetings" }
  },
  "mounts": [{ "point": "COMPOSER_TOOLBAR", "component": { "type": "BUTTON", "props": {
    "label": "Zoom", "icon": "brand:zoom",
    "toolbar": {
      "label": { "es": "Reunión de Zoom", "en": "Zoom meeting" },
      "description": { "es": "Crea una reunión de Zoom", "en": "Create a Zoom meeting" }
    },
    "onClick": { "action": "OPEN_OVERLAY", "targetId": "zoom-modal" } } } }]
}`;

const code = (s: string) => '`' + s + '`';

export function iconBlocks(es: boolean): Block[] {
    const brands = Object.values(BRAND_ICONS).map((b) => `${code('brand:' + b.slug)} (${b.name})`).join(', ');
    const neutral = Object.values(NEUTRAL_BRANDS).map((b) => `${code('brand:' + b.slug)} (${b.name})`).join(', ');
    const functional = FUNCTIONAL_ICONS.map((f) => [code('lucide:' + f.lucide), es ? f.name.es : f.name.en]);
    if (es) {
        return [
            { t: 'h2', id: 'icons', text: 'Iconos de extensiones' },
            { t: 'p', text: 'El campo `icon` (en el manifest y en cualquier prop `icon` o `name` de un icono) admite tres formas: **`brand:<slug>`** (logotipo de una app integrada), **`lucide:<Nombre>`** (icono funcional) e **`initials:<XY>`** (1 a 3 letras). El nombre Lucide sin esquema (`"Mail"`) sigue funcionando. **No hay URLs de imagen arbitrarias**: los logotipos se cargan de forma asíncrona desde el backend de BloomX (`/api/extensions/icons/…`, con un marcador de letra instantáneo y sin saltos de maquetación), así que cambiar un logo no exige desplegar ni recargar. El `icon` también puede ser un data URL `data:image/png|webp|svg+xml;base64,…` (máx. 64 KB, validado).' },
            { t: 'code', lang: 'json', title: 'Icono, nombre y descripción por idioma, y tooltip localizado', code: MANIFEST_EXAMPLE },
            { t: 'p', text: 'Los logotipos se pintan con su **color oficial** sobre una ficha neutra. Si ese color no contrasta al menos **3:1** con el tema activo (Notion negro en un tema oscuro, por ejemplo) se usa una variante más clara u oscura del mismo tono; en menús densos y botones deshabilitados se usa el modo monocromo. El icono es decorativo: el nombre accesible lo da el botón. `name` y `description` son el respaldo; `i18n.<idioma>` los localiza, y el tooltip de una acción usa `toolbar.label` y `toolbar.description` por idioma (aparece a los 400 ms, máximo 280 px, el texto envuelve y Esc lo cierra).' },
            { t: 'h3', id: 'icons-brand', text: 'Logotipos de marca disponibles' },
            { t: 'p', text: brands },
            { t: 'p', text: 'Marcas que **no** están en el conjunto de logotipos libres (retiradas a petición del titular): se muestran como una ficha neutra con su inicial y nunca se dibujan a mano. ' + neutral + '.' },
            { t: 'h3', id: 'icons-functional', text: 'Iconos funcionales recomendados' },
            { t: 'table', head: ['Icono', 'Función'], rows: functional },
            { t: 'callout', kind: 'note', title: 'Marcas registradas', text: 'Los logotipos pertenecen a sus titulares y se usan **solo para identificar la integración** con ese servicio; no implican patrocinio ni afiliación. Proceden de simple-icons (CC0-1.0).' },
        ];
    }
    return [
        { t: 'h2', id: 'icons', text: 'Extension icons' },
        { t: 'p', text: 'The `icon` field (in the manifest and in any `icon` or `name` prop of an icon) accepts three forms: **`brand:<slug>`** (logo of an integrated app), **`lucide:<Name>`** (functional icon) and **`initials:<XY>`** (1 to 3 letters). A bare Lucide name (`"Mail"`) keeps working. **There are no arbitrary image URLs**: logos load asynchronously from the BloomX backend (`/api/extensions/icons/…`, with an instant letter placeholder and no layout shift), so changing a logo needs no deploy or reload. `icon` can also be a `data:image/png|webp|svg+xml;base64,…` data URL (max 64 KB, validated).' },
        { t: 'code', lang: 'json', title: 'Icon, localized name and description, and localized tooltip', code: MANIFEST_EXAMPLE },
        { t: 'p', text: 'Logos are drawn in their **official colour** on a neutral tile. If that colour is below **3:1** contrast against the active theme (black Notion on a dark theme, for instance) a lighter or darker variant of the same hue is used; dense menus and disabled buttons use the monochrome mode. The icon is decorative: the accessible name comes from the button. `name` and `description` are the fallback; `i18n.<language>` localizes them, and an action tooltip uses `toolbar.label` and `toolbar.description` per language (shown after 400 ms, 280 px max, the text wraps and Esc closes it).' },
        { t: 'h3', id: 'icons-brand', text: 'Available brand logos' },
        { t: 'p', text: brands },
        { t: 'p', text: 'Brands that are **not** in the free logo set (withdrawn at the owner request) are shown as a neutral tile with their initial and are never hand-drawn. ' + neutral + '.' },
        { t: 'h3', id: 'icons-functional', text: 'Recommended functional icons' },
        { t: 'table', head: ['Icon', 'Function'], rows: functional },
        { t: 'callout', kind: 'note', title: 'Trademarks', text: 'Logos belong to their owners and are used **only to identify the integration** with that service; they imply no sponsorship or affiliation. They come from simple-icons (CC0-1.0).' },
    ];
}
