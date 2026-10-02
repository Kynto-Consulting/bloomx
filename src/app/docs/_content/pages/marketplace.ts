import type { Block, DocPageContent } from '../types';
import { MARKET_CATEGORIES } from '@/lib/admin/marketplace/market-meta';
import { MARKET_SECTIONS } from '@/lib/admin/marketplace/market-model';

/** Guia «Como funciona el marketplace» (pestana Catalogo de /admin/extensions). Bilingue; un test valida enlaces, anclas y paridad es/en. */

type Lang = 'es' | 'en';
const T = (lang: Lang, es: string, en: string): string => (lang === 'es' ? es : en);

const blocks = (lang: Lang): Block[] => [
    { t: 'p', text: T(lang,
        'La pestaña **Catálogo** de `/admin/extensions` es un **marketplace** de extensiones con la experiencia de una tienda de aplicaciones, pero sobria y con el tema de tu instancia: navegación lateral, búsqueda, filtros, favoritas, suites de marca, páginas de editor y una ficha completa por extensión.',
        'The **Catalog** tab of `/admin/extensions` is an extension **marketplace** with an app-store feel, kept sober and in your instance theme: side navigation, search, filters, favorites, brand suites, publisher pages and a full page per extension.') },

    { t: 'h2', id: 'navigation', text: T(lang, 'Navegación', 'Navigation') },
    { t: 'table', head: [T(lang, 'Sección', 'Section'), T(lang, 'Qué muestra', 'What it shows'), '?sec='], rows: [
        [T(lang, 'Descubrir', 'Discover'), T(lang, 'Destacadas (oficiales), novedades (última versión publicada), populares (dominios con la extensión activa) y recomendadas según lo que ya tienes instalado.', 'Featured (official), new (latest published version), popular (domains with the extension active) and recommendations based on what you already have installed.'), '`discover`'],
        [T(lang, 'Instaladas', 'Installed'), T(lang, 'Las de este dominio, activas o no.', 'The ones in this domain, active or not.'), '`installed`'],
        [T(lang, 'Favoritas ★', 'Starred ★'), T(lang, 'Las que marcaste con la estrella (solo tuyas).', 'The ones you starred (yours only).'), '`starred`'],
        [T(lang, 'Categorías', 'Categories'), T(lang, 'Todas, o una categoría concreta.', 'All, or a single category.'), '`categories` + `cat`'],
        [T(lang, 'Marcas y suites', 'Brands and suites'), T(lang, 'Carpetas por marca (Google, Zoom, Microsoft, Slack, Seguridad y cumplimiento, IA…). Al abrir una ves sus extensiones y puedes instalarla entera.', 'Folders per brand (Google, Zoom, Microsoft, Slack, Security and compliance, AI…). Open one to see its extensions and install it whole.'), '`suites` + `suite`'],
        [T(lang, 'Del proveedor', 'From the platform'), T(lang, 'Las extensiones oficiales de la plataforma (insignia «Oficial»).', 'The platform\'s official extensions ("Official" badge).'), '`official`'],
        [T(lang, 'Comunidad', 'Community'), T(lang, 'Preparada para extensiones de terceros. Hoy está vacía y lo explica.', 'Ready for third-party extensions. Empty today, and it says so.'), '`community`'],
        [T(lang, 'Editor', 'Publisher'), T(lang, 'Página de un editor o marca con su lista y descripción (se llega desde «de Bloomx» en cualquier tarjeta).', 'A publisher or brand page with its list and description (reached from "by Bloomx" on any card).'), '`publisher` + `publisher=<id>`'],
    ] },
    { t: 'p', text: T(lang,
        `En pantallas estrechas la columna lateral se sustituye por un selector de **Sección**. Valores de \`?sec=\`: ${MARKET_SECTIONS.map((s) => `\`${s}\``).join(', ')}.`,
        `On narrow screens the side column is replaced by a **Section** selector. \`?sec=\` values: ${MARKET_SECTIONS.map((s) => `\`${s}\``).join(', ')}.`) },

    { t: 'h2', id: 'search', text: T(lang, 'Búsqueda, filtros y orden', 'Search, filters and sorting') },
    { t: 'ul', items: [
        T(lang, 'Pulsa **/** en cualquier punto de la pantalla (fuera de un campo de texto) para ir a la búsqueda. Busca en nombre, descripción, **etiquetas**, editor y suite, sin distinguir acentos, y todas las palabras deben aparecer.', 'Press **/** anywhere on the screen (outside a text field) to jump to the search. It looks in name, description, **tags**, publisher and suite, ignoring accents, and every word must appear.'),
        T(lang, 'Filtros combinables: categoría, estado (instaladas, disponibles, desactivadas, con errores, de pago, gratis) y, en «Más filtros», origen (oficial/comunidad), riesgo máximo de permisos, si requiere IA y si es compatible con tu instancia.', 'Combinable filters: category, status (installed, available, disabled, with errors, paid, free) and, under "More filters", origin (official/community), maximum permission risk, whether it needs AI and whether it is compatible with your instance.'),
        T(lang, 'Orden: relevancia, más populares, más recientes o nombre. Tus favoritas aparecen **primero** (salvo al ordenar por nombre).', 'Sorting: relevance, most popular, most recent or name. Your starred extensions come **first** (except when sorting by name).'),
        T(lang, 'Vista de cuadrícula o lista. Las listas se **paginan** de 24 en 24 con «Mostrar más» (nada de listas gigantes en el DOM) y el recuento se anuncia a los lectores de pantalla.', 'Grid or list view. Lists are **paginated** 24 at a time with "Show more" (no giant lists in the DOM) and the count is announced to screen readers.'),
    ] },
    { t: 'h3', id: 'urls', text: T(lang, 'URLs compartibles', 'Shareable URLs') },
    { t: 'p', text: T(lang, 'Todo el estado vive en la URL, así que puedes compartir o guardar una vista. Los parámetros desconocidos o inválidos se ignoran, y las URLs de antes (`?open=<id>` de la búsqueda global) siguen funcionando.', 'All the state lives in the URL, so you can share or bookmark a view. Unknown or invalid parameters are ignored, and the older URLs (`?open=<id>` from the global search) keep working.') },
    { t: 'table', head: [T(lang, 'Parámetro', 'Parameter'), T(lang, 'Valores', 'Values')], rows: [
        ['`q`', T(lang, 'Texto de búsqueda (máx. 100).', 'Search text (max 100).')],
        ['`cat`', MARKET_CATEGORIES.map((c) => `\`${c}\``).join(', ')],
        ['`suite`, `publisher`', T(lang, 'Id de la suite o del editor (abren su página).', 'Suite or publisher id (opens its page).')],
        ['`status`', '`installed`, `available`, `disabled`, `errors`, `paid`, `free`'],
        ['`origin`, `risk`, `ai`, `compat`', '`official|community`, `low|medium`, `yes|no`, `yes`'],
        ['`sort`, `view`, `page`', '`relevance|popular|recent|name`, `grid|list`, `1…20`'],
        ['`ext`', T(lang, 'Abre la ficha de esa extensión.', 'Opens that extension\'s page.')],
    ] },

    { t: 'h2', id: 'stars', text: T(lang, 'Favoritas', 'Starred') },
    { t: 'p', text: T(lang, 'La estrella ★ de cada tarjeta y de la ficha marca la extensión como favorita **para ti**: se guarda por administrador en la base de datos de la instancia (tabla `ExtensionStar`, ruta `/api/admin/extensions/stars`, nivel 1), nunca es global y ningún otro administrador la ve. El cambio es **optimista**: la estrella responde al instante y, si el servidor la rechaza, vuelve atrás y lo avisa. Hay un tope de 200 favoritas por administrador.', 'The star ★ on each card and on the page marks the extension as a favorite **for you**: it is stored per administrator in the instance database (`ExtensionStar` table, `/api/admin/extensions/stars` route, level 1), it is never global and no other administrator sees it. The change is **optimistic**: the star reacts at once and, if the server rejects it, it rolls back and says so. There is a cap of 200 stars per administrator.') },

    { t: 'h2', id: 'suites', text: T(lang, 'Suites e «Instalar la suite»', 'Suites and "Install the suite"') },
    { t: 'p', text: T(lang, 'Una **suite** agrupa los productos de una misma marca (por ejemplo «Google»: GoogleLib, Calendar, Meet, Drive y Sync). Al abrirla, **Instalar la suite** calcula un plan **antes de tocar nada** y te lo enseña:', 'A **suite** groups the products of one brand (for example "Google": GoogleLib, Calendar, Meet, Drive and Sync). When you open it, **Install the suite** computes a plan **before touching anything** and shows it:') },
    { t: 'ol', items: [
        T(lang, 'El **orden de instalación**, con las dependencias primero (GoogleLib antes de Calendar) y sin repetir ninguna.', 'The **install order**, dependencies first (GoogleLib before Calendar) and no repeats.'),
        T(lang, 'Los **permisos de todo el conjunto**, de mayor a menor riesgo, sin duplicados.', 'The **permissions of the whole set**, highest risk first, without duplicates.'),
        T(lang, 'Las **aprobaciones explícitas** que exigen algunas extensiones (rutas públicas y cuentas compartidas de proveedor): hay que marcar la casilla para poder confirmar.', 'The **explicit approvals** some extensions require (public routes and shared provider accounts): you must tick the box to confirm.'),
        T(lang, 'Lo que **no se instalará** y por qué: ya activa, de pago (se compra desde su ficha), incompatible con tu instancia, pausada por la IA, dependencia fuera del catálogo o dependencias circulares.', 'What **will not be installed** and why: already active, paid (buy it from its page), incompatible with your instance, paused by AI, dependency outside the catalog or circular dependencies.'),
    ] },
    { t: 'p', text: T(lang, 'Al confirmar se ejecutan, **una por una y en ese orden**, las mismas acciones de siempre (instalar o activar). Si una falla, se detiene ahí y lo anterior queda instalado.', 'On confirm, the usual actions (install or activate) run **one by one in that order**. If one fails it stops there and what came before stays installed.') },

    { t: 'h2', id: 'detail', text: T(lang, 'La ficha de la extensión', 'The extension page') },
    { t: 'ul', items: [
        T(lang, '**Cabecera**: icono, editor con insignia (Oficial / Verificado / Comunidad), suite, versión, instalaciones, categorías, precio y la estrella. Debajo, el estado del botón principal: «Se instalará con GoogleLib», «Requiere GoogleLib», «Requiere actualizar el cliente», «Requiere la clave de dominio», «Pausada por la IA» o «De pago».', '**Header**: icon, publisher with badge (Official / Verified / Community), suite, version, installs, categories, price and the star. Below, the state of the main button: "Will be installed with GoogleLib", "Requires GoogleLib", "Requires updating the client", "Requires the domain key", "Paused by AI" or "Paid".'),
        T(lang, '**Resumen**: descripción, capturas, etiquetas, «Otras de esta suite» y «Relacionadas». **Permisos**: en lenguaje claro con nivel de riesgo.', '**Summary**: description, screenshots, tags, "More in this suite" and "Related". **Permissions**: in plain language with a risk level.'),
        T(lang, '**Versiones**: historial con el changelog de cada versión, cuál tienes instalada, cuál es la última y si cada una es compatible con tu cliente. **Dependencias**: árbol con el estado de cada una y quién depende de esta. **Información**: editor, enlace, licencia, id, suite y categorías.', '**Versions**: history with each version\'s changelog, which one you have installed, which is the latest and whether each is compatible with your client. **Dependencies**: a tree with each one\'s state and who depends on this one. **Information**: publisher, link, license, id, suite and categories.'),
        T(lang, 'Ajustes, credenciales, estado y registro, aprobaciones y los avisos de IA, compatibilidad y clave de dominio siguen donde estaban.', 'Settings, credentials, status and log, approvals and the AI, compatibility and domain-key notices stay where they were.'),
        T(lang, 'Las **capturas** son URLs https. Las de extensiones oficiales se cargan siempre; las de terceros solo tras pulsar «Cargar las capturas» (el servidor del editor vería tu IP).', '**Screenshots** are https URLs. Official extensions\' screenshots always load; third-party ones only after pressing "Load the screenshots" (the publisher\'s server would see your IP).'),
    ] },

    { t: 'h2', id: 'installs', text: T(lang, 'Instalaciones', 'Install count') },
    { t: 'p', text: T(lang, 'El número de instalaciones es la cantidad de **dominios con la extensión activa**, calculada por el backend compartido como un agregado: no sale ningún identificador de dominio y se **cachea unos 5 minutos**. Alimenta «Populares» y el orden «Más populares».', 'The install count is the number of **domains with the extension active**, computed by the shared backend as an aggregate: no domain identifier ever leaves it and it is **cached for about 5 minutes**. It feeds "Popular" and the "Most popular" sort.') },

    { t: 'h2', id: 'compat', text: T(lang, 'Compatibilidad con instancias antiguas', 'Compatibility with old instances') },
    { t: 'p', text: T(lang, 'El marketplace usa la capacidad de cliente **`market.catalog.v1`** (`clientApi` 11, clasificación `unsigned-ok`: el catálogo es público y funciona **también sin clave de dominio**). Es **solo informativa**: el backend añade un campo `market` a la respuesta del catálogo solo si el cliente la declara, y **ninguna extensión la declara en `requires`**. Por eso:', 'The marketplace uses the client capability **`market.catalog.v1`** (`clientApi` 11, `unsigned-ok` classification: the catalog is public and works **even without a domain key**). It is **informational only**: the backend adds a `market` field to the catalog response only when the client declares it, and **no extension declares it in `requires`**. Therefore:') },
    { t: 'ul', items: [
        T(lang, 'Las instancias antiguas reciben **exactamente** la misma respuesta de antes y **las mismas versiones** de cada extensión.', 'Old instances receive **exactly** the same response as before and **the same versions** of every extension.'),
        T(lang, 'Un backend antiguo sin `market` no rompe la pantalla: el editor sale del id (`core-*` = Bloomx oficial) y la categoría de la categoría clásica.', 'An old backend without `market` does not break the screen: the publisher comes from the id (`core-*` = official Bloomx) and the category from the classic category.'),
        T(lang, 'Un manifest que declare `market.catalog.v1` en `requires` se **rechaza** al publicar: ocultaría la extensión a las instancias antiguas.', 'A manifest declaring `market.catalog.v1` in `requires` is **rejected** on publish: it would hide the extension from old instances.'),
    ] },
    { t: 'callout', kind: 'note', text: T(lang, 'La insignia **Oficial** no se toma del manifest tal cual: solo la reciben las extensiones `core-*` cuyo editor es `bloomx`. Un tercero que escriba `official: true` es rechazado al publicar y se ignora al mostrar.', 'The **Official** badge is not taken from the manifest as-is: only `core-*` extensions whose publisher is `bloomx` get it. A third party writing `official: true` is rejected on publish and ignored on display.') },

    { t: 'h2', id: 'future', text: T(lang, 'Dónde conectará el «extension market» futuro', 'Where the future "extension market" will plug in') },
    { t: 'p', text: T(lang, 'Las extensiones de terceros (gratuitas o de pago) las construye el portal de desarrollador (`/admin/developer`). El marketplace ya deja los puntos de conexión:', 'Third-party extensions (free or paid) are built by the developer portal (`/admin/developer`). The marketplace already leaves the connection points:') },
    { t: 'ul', items: [
        T(lang, '**Sección Comunidad** y filtro de origen: hoy vacíos; una extensión de un editor que no sea `bloomx` aparece ahí sin cambiar la interfaz.', '**Community section** and origin filter: empty today; an extension from a publisher other than `bloomx` appears there with no UI change.'),
        T(lang, '**Páginas de editor** (`?publisher=<id>`): ya existen; la verificación de editores externos (insignia «Verificado») será un registro del backend, no un campo del manifest.', '**Publisher pages** (`?publisher=<id>`): already exist; verification of external publishers ("Verified" badge) will be a backend registry, not a manifest field.'),
        T(lang, '**Precio**: `isPaid`, `price` y `currency` ya viajan en el catálogo; el botón de compra lo conecta el módulo de pagos desde la ficha.', '**Price**: `isPaid`, `price` and `currency` already travel in the catalog; the purchase button is wired by the payments module from the page.'),
        T(lang, '**Backend**: el campo `market` de `/api/extensions` y `/api/admin/extensions/public-list` es la costura; añadir ahí datos del editor (valoraciones, verificación) no obliga a cambiar los manifests.', '**Backend**: the `market` field of `/api/extensions` and `/api/admin/extensions/public-list` is the seam; adding publisher data there (ratings, verification) does not require changing manifests.'),
    ] },
    { t: 'p', text: T(lang, 'Para describir tu extensión en el catálogo, lee [Publicar tus metadatos de catálogo](/docs/marketplace-metadata). Para el contrato general, [Extensiones](/docs/expansions) y [Crear una extensión](/docs/create-extension).', 'To describe your extension in the catalog, read [Publish your catalog metadata](/docs/marketplace-metadata). For the general contract, [Extensions](/docs/expansions) and [Build an extension](/docs/create-extension).') },
];

const page: DocPageContent = { es: blocks('es'), en: blocks('en') };

export default page;
