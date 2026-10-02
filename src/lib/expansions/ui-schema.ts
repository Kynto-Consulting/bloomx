/**
 * Schema, validador y adaptador del UI JSON de extensiones BloomX (sin dependencias).
 *
 * FUENTE CANONICA: bloomx-extensions/_shared/ui-schema.ts
 * Copias identicas (verificadas por tests/ui-schema.test.mjs y por src/lib/expansions/__tests__/ui-schema.test.ts):
 *   - bloomx-backend/src/lib/extensions/ui-schema.ts
 *   - bloomx/src/lib/expansions/ui-schema.ts
 *
 * Solo sintaxis TypeScript "borrable" (sin enums ni parametros de constructor) para correr con
 * `node --experimental-strip-types`. No importar nada aqui.
 *
 * REGLA CLAVE: las extensiones NO eligen colores ni estilos. Solo props semanticas (`tone`, `variant`, `size`,
 * `density`, `align`, `gap` en escala...) que el renderer del frontend mapea a los TOKENS del tema activo
 * (claro/oscuro/empresa). Cualquier `className`, `style`, `color`, HTML, `url()` o hex en props se rechaza
 * (validateUi) o se elimina con aviso (migrateLegacyUi).
 *
 * Que hay aqui:
 *   - UI_COMPONENTS / UI_ACTIONS: catalogo (props permitidas, tipos, documentacion).
 *   - validateUi / validateManifestUi: errores legibles con ruta (`body.children[2].props.tone`).
 *   - coerceProps: sanea props YA resueltas en tiempo de ejecucion (enums fuera de rango, numeros, ...).
 *   - migrateLegacyUi / migrateManifestUi: adaptador del formato antiguo (COLUMN, DATA_TABLE, className, ...).
 */

export type UiIssue = { path: string; message: string; code: string };
export type UiValidation = { ok: boolean; errors: UiIssue[]; warnings: UiIssue[]; nodes: number; depth: number };
export type UiValidateOptions = {
    /** Nombre del nodo raiz en las rutas (p. ej. "body" o "mounts[0].component"). Por defecto "ui". */
    root?: string;
    /** Comprobador de sintaxis de `${...}`: devuelve un mensaje de error o null/undefined si es valida. */
    checkExpression?: (source: string) => string | null | undefined;
};

export const UI_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------------------------------------------
// Vocabulario semantico (lo unico que una extension puede elegir)
// ---------------------------------------------------------------------------------------------------------------

export const TONES = ["neutral", "primary", "success", "warning", "danger", "info"] as const;
export const SIZES = ["xs", "sm", "md", "lg"] as const;
export const SIZES_XL = ["xs", "sm", "md", "lg", "xl"] as const;
export const ALIGNS = ["start", "center", "end", "stretch", "baseline"] as const;
export const JUSTIFIES = ["start", "center", "end", "between", "around"] as const;
export const TEXT_ALIGNS = ["start", "center", "end"] as const;
/** Escala de espacios (unidades de 4px: 0, 4, 8, 12, 16, 20, 24, 32, 40, 48). */
export const GAPS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12] as const;
export const BUTTON_VARIANTS = ["solid", "soft", "outline", "ghost", "link"] as const;
export const SURFACE_VARIANTS = ["solid", "soft", "outline"] as const;
export const DENSITIES = ["compact", "comfortable", "spacious"] as const;
export const WIDTHS = ["sm", "md", "lg", "xl", "full"] as const;
export const TEXT_SIZES = ["xs", "sm", "md", "lg", "xl"] as const;
export const WEIGHTS = ["normal", "medium", "semibold", "bold"] as const;

/** Claves que NUNCA se aceptan en props (estilo crudo, HTML, internos de React/DOM). */
export const FORBIDDEN_PROP_KEYS = [
    "className", "class", "classes", "style", "styles", "css", "sx",
    "color", "colour", "bg", "background", "backgroundColor", "bgColor", "textColor", "borderColor", "fill", "stroke",
    "border", "shadow", "rounded", "radius", "fontFamily", "font", "opacity", "zIndex", "position",
    "dangerouslySetInnerHTML", "innerHTML", "outerHTML", "html", "ref", "key",
];

/** Limites duros: un UI JSON es dato controlado por quien publica la extension. */
export const UI_LIMITS = {
    maxNodes: 600,
    maxDepth: 24,
    maxString: 20000,
    maxArray: 500,
    maxKeys: 200,
    maxBytes: 262144,
    maxPattern: 200,
} as const;

const BLOCKED_KEYS = ["__proto__", "constructor", "prototype"];
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const ICON_RE = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
/**
 * Referencia de icono CON ESQUEMA: `brand:<slug>` (logotipo de una app integrada), `lucide:<Nombre>` (icono funcional) o
 * `initials:<XY>` (1 a 3 letras). El nombre Lucide sin esquema sigue valiendo (compatibilidad). Los slugs de `brand:` los define
 * bloomx/src/lib/expansions/brand-icons.ts; un slug desconocido NO invalida el manifest (se muestra una ficha con la inicial).
 */
export const ICON_REF_RE = /^(?:brand:[a-z][a-z0-9]{0,39}|lucide:[A-Za-z][A-Za-z0-9]{0,39}|initials:[A-Za-z0-9]{1,3})$/;
export function isIconRef(value: unknown): value is string {
    return typeof value === "string" && ICON_REF_RE.test(value);
}
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const HTML_RE = /<\s*\/?\s*(?:script|style|iframe|object|embed|link|meta|img|svg|form|input|base|body|html|a\s|on\w+\s*=)/i;
const CSS_FN_RE = /(?:url|expression|var|calc)\s*\(|javascript\s*:|data\s*:\s*text\/html/i;
const COSTLY_PATTERN_RE = /\([^)]*[+*][^)]*\)\s*[+*{]/;

// ---------------------------------------------------------------------------------------------------------------
// Especificacion de props
// ---------------------------------------------------------------------------------------------------------------

export type PropKind =
    | "text" | "string" | "name" | "number" | "boolean" | "enum" | "icon" | "url" | "color" | "regex"
    | "action" | "node" | "nodes" | "any" | "array" | "record" | "object";

export type PropSpec = {
    k: PropKind;
    doc?: string;
    values?: readonly (string | number)[];
    min?: number;
    max?: number;
    def?: unknown;
    of?: PropSpec;
    shape?: Record<string, PropSpec>;
    required?: boolean;
};

export type ComponentSpec = {
    doc: string;
    category: "layout" | "typography" | "action" | "input" | "data" | "feedback" | "overlay" | "navigation" | "chart" | "logic";
    /** Acepta `children` (arreglo de componentes). */
    children?: boolean;
    props: Record<string, PropSpec>;
};

type SpecOpts = { min?: number; max?: number; def?: unknown; required?: boolean };

const S = {
    text: (doc: string, o: SpecOpts = {}): PropSpec => ({ k: "text", doc, ...o }),
    str: (doc: string, o: SpecOpts = {}): PropSpec => ({ k: "string", doc, ...o }),
    name: (doc: string, o: SpecOpts = {}): PropSpec => ({ k: "name", doc, ...o }),
    num: (doc: string, o: SpecOpts = {}): PropSpec => ({ k: "number", doc, ...o }),
    bool: (doc: string, o: SpecOpts = {}): PropSpec => ({ k: "boolean", doc, ...o }),
    en: (values: readonly (string | number)[], doc: string, o: SpecOpts = {}): PropSpec => ({ k: "enum", values, doc, ...o }),
    icon: (doc = "Icono: nombre Lucide (p. ej. \"Mail\"), \"lucide:<Nombre>\", \"brand:<slug>\" (logotipo de una app integrada, p. ej. \"brand:zoom\") o \"initials:<XY>\". Un nombre desconocido se muestra como icono generico."): PropSpec => ({ k: "icon", doc }),
    url: (doc: string, o: SpecOpts = {}): PropSpec => ({ k: "url", doc, ...o }),
    hex: (doc: string): PropSpec => ({ k: "color", doc }),
    regex: (doc: string): PropSpec => ({ k: "regex", doc }),
    action: (doc: string): PropSpec => ({ k: "action", doc }),
    node: (doc: string): PropSpec => ({ k: "node", doc }),
    nodes: (doc: string): PropSpec => ({ k: "nodes", doc }),
    any: (doc: string, o: SpecOpts = {}): PropSpec => ({ k: "any", doc, ...o }),
    arr: (of: PropSpec, doc: string, o: SpecOpts = {}): PropSpec => ({ k: "array", of, doc, ...o }),
    rec: (of: PropSpec, doc: string): PropSpec => ({ k: "record", of, doc }),
    obj: (shape: Record<string, PropSpec>, doc: string): PropSpec => ({ k: "object", shape, doc }),
};

/**
 * Pista para las BARRAS de acciones (EMAIL_TOOLBAR, COMPOSER_TOOLBAR, CALENDAR_TOOLBAR, CONTACTS_TOOLBAR): la app muestra cada accion
 * como un boton de icono compacto y manda el resto al menu "Extensiones". `pinned` = aparece anclada por defecto (el usuario puede
 * anclar/desanclar); `priority` ordena (menor primero); `label` sustituye al texto del tooltip; `description` es la linea corta del menu.
 */
const TOOLBAR_HINT = S.obj({
    pinned: S.bool("Anclada en la barra por defecto."),
    priority: S.num("Orden en la barra y el menu (menor primero).", { min: 0, max: 1000 }),
    label: S.text("Nombre corto para el tooltip y el menu (por defecto, el label del boton)."),
    description: S.text("Descripcion de una linea para el menu de extensiones."),
}, "Como se presenta la accion en las barras.");

const tone = (def = "neutral") => S.en(TONES, "Intencion semantica; el tema decide el color.", { def });
const size = (def = "md") => S.en(SIZES, "Tamano en escala.", { def });
const gap = (def = 2) => S.en(GAPS, "Espacio en escala de 4px (0-12).", { def });
const align = (def = "stretch") => S.en(ALIGNS, "Alineacion en el eje transversal.", { def });
const justify = (def = "start") => S.en(JUSTIFIES, "Distribucion en el eje principal.", { def });

/** Reglas de validacion declarativas (formularios e inputs). */
const RULES = S.obj({
    required: S.bool("El valor no puede estar vacio."),
    minLength: S.num("Longitud minima del texto.", { min: 0, max: 100000 }),
    maxLength: S.num("Longitud maxima del texto.", { min: 0, max: 100000 }),
    min: S.num("Valor minimo (numeros)."),
    max: S.num("Valor maximo (numeros)."),
    minItems: S.num("Minimo de elementos (listas).", { min: 0, max: 1000 }),
    maxItems: S.num("Maximo de elementos (listas).", { min: 0, max: 1000 }),
    pattern: S.regex("Expresion regular (sin delimitadores) que debe cumplir el texto."),
    email: S.bool("Debe ser un correo valido."),
    url: S.bool("Debe ser una URL http(s) valida."),
    message: S.str("Mensaje de error propio (sustituye al generico).", { max: 300 }),
}, "Reglas de validacion declarativas.");

const FIELD_COMMON: Record<string, PropSpec> = {
    name: S.name("Nombre del campo en el formulario."),
    label: S.text("Etiqueta visible."),
    helperText: S.text("Texto de ayuda bajo el control."),
    placeholder: S.text("Texto de ejemplo."),
    bind: S.name("Clave de `state` enlazada (bidireccional). Admite ruta con puntos: \"form.email\"."),
    bindTo: S.name("Obsoleto: usa `bind`."),
    value: S.any("Valor controlado (normalmente una expresion `${state.x}`)."),
    defaultValue: S.any("Valor inicial."),
    required: S.bool("Marca el campo como obligatorio (asterisco + regla required)."),
    disabled: S.bool("Deshabilita el control."),
    readOnly: S.bool("Solo lectura."),
    size: size(),
    rules: RULES,
    onChange: S.action("Accion al cambiar el valor (recibe `value`)."),
};

const OPTION = S.obj({
    value: S.any("Valor que se guarda."),
    label: S.text("Texto visible."),
    disabled: S.bool("Opcion no seleccionable."),
    description: S.text("Texto secundario."),
}, "Opcion");

const MENU_ITEM = S.obj({
    label: S.text("Texto del elemento."),
    icon: S.icon(),
    onClick: S.action("Accion al elegirlo."),
    tone: tone(),
    disabled: S.bool("No seleccionable."),
    separator: S.bool("Dibuja un separador en lugar de un elemento."),
}, "Elemento de menu");

const TABLE_COLUMN = S.obj({
    key: S.name("Clave del dato en cada fila."),
    label: S.text("Cabecera."),
    sortable: S.bool("Permite ordenar por esta columna."),
    align: S.en(TEXT_ALIGNS, "Alineacion del texto."),
    format: S.en(["text", "number", "date", "datetime", "boolean", "badge", "code", "link", "status"], "Formato del valor (link: el valor es el texto y `hrefKey` la URL; status: punto + texto con el tono de `toneMap`).", { def: "text" }),
    tone: tone(),
    toneMap: S.rec(S.en(TONES, "Tono."), "Valor de la celda -> tono (formatos badge y status); lo no listado usa `tone`."),
    hrefKey: S.name("Formato link: clave de la fila con la URL (http, https, mailto, tel o ruta interna); sin ella el propio valor es la URL."),
    filter: S.bool("Anade un filtro desplegable con los valores distintos de la columna (hasta 30)."),
    width: S.en(["xs", "sm", "md", "lg"], "Ancho orientativo."),
}, "Columna");

const ROW_ACTION = S.obj({
    label: S.text("Nombre accesible de la accion."),
    icon: S.icon(),
    tone: tone(),
    onClick: S.action("Accion (recibe `row`)."),
}, "Accion de fila");

const BULK_ACTION = S.obj({
    label: S.text("Nombre de la accion (texto del boton)."),
    icon: S.icon(),
    tone: tone(),
    onClick: S.action("Accion sobre la seleccion (recibe `rows` y `value`: claves seleccionadas)."),
}, "Accion sobre la seleccion");

const BREADCRUMB = S.obj({
    label: S.text("Texto del tramo.", { required: true }),
    url: S.url("Ruta interna (empieza por /) o URL; sin `url` ni `onClick` es el tramo actual."),
    onClick: S.action("Accion en lugar de navegar."),
}, "Tramo de migas de pan");

const CHART_SERIES = S.obj({
    label: S.text("Nombre de la serie (leyenda y tooltip); admite {es,en}.", { required: true }),
    data: S.arr(S.any("Valor numerico (null = hueco)."), "Valores, uno por etiqueta de `labels`."),
    tone: S.en(TONES, "Tono de la serie; por defecto se reparte por orden."),
}, "Serie");

const CHART_POINT = S.obj({
    label: S.text("Etiqueta."),
    value: S.num("Valor."),
    tone: tone("primary"),
}, "Dato");

const STEP = S.obj({
    title: S.text("Titulo del paso."),
    description: S.text("Descripcion corta."),
    content: S.nodes("Componentes del paso."),
}, "Paso");

export const UI_COMPONENTS: Record<string, ComponentSpec> = {
    // ---- Layout -----------------------------------------------------------------------------------------------
    STACK: {
        category: "layout", children: true,
        doc: "Apila hijos en vertical con un espacio de la escala.",
        props: { gap: gap(3), align: align(), justify: justify(), wrap: S.bool("Permite saltar de linea."), padding: S.en(GAPS, "Relleno interior en escala.", { def: 0 }), fullWidth: S.bool("Ocupa todo el ancho.", { def: true }) },
    },
    ROW: {
        category: "layout", children: true,
        doc: "Coloca hijos en horizontal.",
        props: { gap: gap(2), align: align("center"), justify: justify(), wrap: S.bool("Permite saltar de linea."), padding: S.en(GAPS, "Relleno interior en escala.", { def: 0 }) },
    },
    GRID: {
        category: "layout", children: true,
        doc: "Rejilla de columnas iguales; en movil se reduce sola.",
        props: {
            columns: S.en([1, 2, 3, 4, 5, 6], "Numero de columnas (escritorio).", { def: 2 }),
            gap: gap(3),
            maxHeight: S.en(["sm", "md", "lg", "xl"], "Limita la altura y activa el scroll."),
        },
    },
    CARD: {
        category: "layout", children: true,
        doc: "Tarjeta con titulo opcional. Hereda radio y paleta del tema.",
        props: {
            title: S.text("Titulo."), description: S.text("Subtitulo."), icon: S.icon(),
            tone: S.en(TONES, "Acentua el borde con la intencion (neutral = sin acento).", { def: "neutral" }),
            variant: S.en(["outline", "flat", "elevated"], "Aspecto de la superficie.", { def: "outline" }),
            density: S.en(DENSITIES, "Relleno interior.", { def: "comfortable" }),
            footer: S.nodes("Pie (botones, notas)."),
        },
    },
    SECTION: {
        category: "layout", children: true,
        doc: "Seccion con encabezado; puede plegarse.",
        props: {
            title: S.text("Titulo de la seccion."), description: S.text("Texto de apoyo."),
            collapsible: S.bool("El usuario puede plegarla."), defaultOpen: S.bool("Abierta al inicio.", { def: true }),
            gap: gap(3),
        },
    },
    PAGE_HEADER: {
        category: "layout",
        doc: "Cabecera de una pagina completa: migas de pan, titulo (h1), estado, descripcion y acciones; muestra su propio estado de carga y error con Reintentar.",
        props: {
            title: S.text("Titulo de la pagina (h1).", { required: true }), description: S.text("Texto de apoyo bajo el titulo."), icon: S.icon(),
            breadcrumbs: S.arr(BREADCRUMB, "Migas de pan (max 6)."),
            status: S.obj({ label: S.text("Texto del estado.", { required: true }), tone: tone() }, "Estado de la pagina (etiqueta junto al titulo)."),
            actions: S.nodes("Acciones (BUTTON, MENU...) a la derecha; en movil pasan debajo."),
            loading: S.bool("Muestra el esqueleto del titulo."), error: S.text("Mensaje de error: muestra un aviso en lugar del estado."),
            onRetry: S.action("Accion del boton Reintentar (solo con `error`)."),
        },
    },
    SPLIT_PANE: {
        category: "layout",
        doc: "Dos paneles (p. ej. lista y detalle): lado a lado en escritorio y apilados en pantallas estrechas. Redimensionable con raton o teclado si `resizable`.",
        props: {
            startPane: S.nodes("Panel principal (izquierda; arriba en movil)."), endPane: S.nodes("Panel secundario (derecha; debajo en movil)."),
            ratio: S.en(["1:3", "1:2", "1:1", "2:1", "3:1"], "Proporcion de ancho startPane:endPane.", { def: "1:2" }),
            resizable: S.bool("El usuario mueve el divisor (arrastrar o flechas izquierda/derecha, Inicio/Fin)."),
            gap: gap(4), sticky: S.bool("El panel principal (startPane) queda fijo al desplazar la pagina (solo escritorio)."),
            startLabel: S.text("Nombre accesible de startPane."), endLabel: S.text("Nombre accesible de endPane."),
        },
    },
    DIVIDER: {
        category: "layout",
        doc: "Linea separadora, con etiqueta opcional.",
        props: { label: S.text("Texto centrado."), orientation: S.en(["horizontal", "vertical"], "Direccion.", { def: "horizontal" }), spacing: gap(3) },
    },
    SPACER: { category: "layout", doc: "Espacio vacio de la escala.", props: { size: gap(4) } },

    // ---- Tipografia -------------------------------------------------------------------------------------------
    TEXT: {
        category: "typography",
        doc: "Parrafo de texto plano (nunca HTML).",
        props: {
            content: S.text("Texto a mostrar."),
            variant: S.en(["default", "muted", "caption", "label", "quote"], "Estilo de texto (quote = cita en recuadro).", { def: "default" }),
            tone: S.en(TONES, "Intencion (neutral = texto normal).", { def: "neutral" }),
            size: S.en(TEXT_SIZES, "Tamano de letra.", { def: "sm" }),
            weight: S.en(WEIGHTS, "Grosor.", { def: "normal" }),
            align: S.en(TEXT_ALIGNS, "Alineacion.", { def: "start" }),
            truncate: S.bool("Una linea con puntos suspensivos."),
            lines: S.num("Maximo de lineas visibles.", { min: 1, max: 12 }),
            mono: S.bool("Fuente monoespaciada."),
        },
    },
    HEADING: {
        category: "typography",
        doc: "Encabezado semantico (h1-h6).",
        props: { content: S.text("Texto."), level: S.en([1, 2, 3, 4, 5, 6], "Nivel h1-h6.", { def: 3 }), size: S.en(TEXT_SIZES, "Tamano visual (por defecto segun el nivel)."), tone: tone(), align: S.en(TEXT_ALIGNS, "Alineacion.", { def: "start" }) },
    },
    CODE: {
        category: "typography",
        doc: "Codigo en linea o bloque, con boton de copiar opcional.",
        props: { content: S.text("Codigo."), code: S.text("Obsoleto: usa `content`."), block: S.bool("Bloque en vez de en linea."), copyable: S.bool("Boton copiar."), language: S.str("Solo informativo.", { max: 30 }) },
    },
    LINK: {
        category: "typography",
        doc: "Enlace seguro (solo http, https, mailto, tel o ruta interna).",
        props: { label: S.text("Texto del enlace."), url: S.url("Destino."), tone: S.en(["primary", "neutral"], "Aspecto.", { def: "primary" }), onClick: S.action("Accion en lugar de navegar.") },
    },
    MARKDOWN: {
        category: "typography",
        doc: "Markdown seguro (negrita, cursiva, codigo, listas, enlaces). El HTML crudo se muestra como texto.",
        props: { content: S.text("Markdown."), size: S.en(TEXT_SIZES, "Tamano de letra.", { def: "sm" }) },
    },
    ICON: {
        category: "typography",
        doc: "Icono decorativo: Lucide, \"brand:<slug>\" (logotipo de una app integrada) o \"initials:<XY>\".",
        props: { name: S.icon(), size: S.en(SIZES_XL, "Tamano.", { def: "md" }), tone: tone(), label: S.text("Nombre accesible (si no es decorativo).") },
    },

    // ---- Acciones ---------------------------------------------------------------------------------------------
    BUTTON: {
        category: "action",
        doc: "Boton. Color segun `tone` + `variant`; contraste garantizado por el tema.",
        props: {
            label: S.text("Texto del boton."), icon: S.icon(), iconPosition: S.en(["start", "end"], "Lado del icono.", { def: "start" }),
            tone: S.en(TONES, "Intencion. Por defecto primary en solid/link y neutral en soft/outline/ghost."),
            variant: S.en(BUTTON_VARIANTS, "Aspecto.", { def: "solid" }), size: size(),
            fullWidth: S.bool("Ocupa todo el ancho."), align: S.en(["start", "center"], "Alineacion del contenido si ocupa todo el ancho.", { def: "center" }),
            loading: S.bool("Muestra el indicador de carga y bloquea."), disabled: S.bool("Deshabilita."),
            submit: S.bool("Envia el FORM que lo contiene."), showLabel: S.bool("false = solo icono (barras compactas).", { def: true }),
            onClick: S.action("Accion al pulsar."), menuOptions: S.arr(MENU_ITEM, "Obsoleto: usa MENU."),
            toolbar: TOOLBAR_HINT,
        },
    },
    ICON_BUTTON: {
        category: "action",
        doc: "Boton solo con icono; `label` es obligatorio (nombre accesible y tooltip).",
        props: { icon: S.icon(), label: S.text("Nombre accesible.", { required: true }), tone: tone(), variant: S.en(BUTTON_VARIANTS, "Aspecto.", { def: "ghost" }), size: size(), loading: S.bool("Cargando."), disabled: S.bool("Deshabilita."), onClick: S.action("Accion al pulsar."), toolbar: TOOLBAR_HINT },
    },
    BUTTON_GROUP: {
        category: "action", children: true,
        doc: "Agrupa botones; `attached` los une.",
        props: { attached: S.bool("Botones pegados."), gap: gap(2), wrap: S.bool("Permite saltar de linea.", { def: true }), align: justify() },
    },
    MENU: {
        category: "action",
        doc: "Boton que abre un menu de acciones (teclado: flechas, Enter, Escape).",
        props: {
            label: S.text("Texto del boton."), icon: S.icon(), tone: tone(), variant: S.en(BUTTON_VARIANTS, "Aspecto.", { def: "outline" }), size: size(),
            showLabel: S.bool("false = solo icono.", { def: true }), items: S.arr(MENU_ITEM, "Elementos."),
            align: S.en(["start", "end"], "Lado por el que se abre.", { def: "start" }),
            toolbar: TOOLBAR_HINT,
        },
    },
    IMAGE_BUTTON: {
        category: "action",
        doc: "Imagen pulsable (https).",
        props: { src: S.url("URL de la imagen (https)."), alt: S.text("Texto alternativo (obligatorio para accesibilidad)."), onClick: S.action("Accion al pulsar.") },
    },
    SMART_REPLY_CHIPS: {
        category: "action",
        doc: "Fila de sugerencias de respuesta pulsables.",
        props: { suggestions: S.any("Arreglo de textos."), onSelect: S.action("Accion al elegir (recibe `value`).") },
    },

    // ---- Entradas ---------------------------------------------------------------------------------------------
    INPUT: {
        category: "input",
        doc: "Campo de texto de una linea.",
        props: {
            ...FIELD_COMMON,
            type: S.en(["text", "email", "password", "number", "search", "tel", "url", "datetime-local"], "Tipo de entrada.", { def: "text" }),
            maxLength: S.num("Longitud maxima.", { min: 0, max: 100000 }), min: S.num("Minimo (number)."), max: S.num("Maximo (number)."), step: S.num("Paso (number)."),
            autoFocus: S.bool("Enfoca al montar."), multiline: S.bool("Obsoleto: usa TEXTAREA."), rows: S.num("Obsoleto: usa TEXTAREA.", { min: 1, max: 40 }),
            onSubmit: S.action("Accion al pulsar Enter en el campo (p. ej. una busqueda) fuera de un FORM."),
        },
    },
    TEXTAREA: {
        category: "input",
        doc: "Texto de varias lineas.",
        props: { ...FIELD_COMMON, rows: S.num("Filas visibles.", { min: 1, max: 40, def: 4 }), maxLength: S.num("Longitud maxima.", { min: 0, max: 100000 }), mono: S.bool("Fuente monoespaciada.") },
    },
    SELECT: {
        category: "input",
        doc: "Lista desplegable nativa.",
        props: {
            ...FIELD_COMMON, options: S.arr(OPTION, "Opciones."),
            valueKey: S.name("Clave del valor en cada opcion (por defecto value)."), labelKey: S.name("Clave del texto en cada opcion (por defecto label)."),
        },
    },
    CHECKBOX: { category: "input", doc: "Casilla de verificacion.", props: { ...FIELD_COMMON, checked: S.bool("Estado controlado.") } },
    RADIO_GROUP: {
        category: "input",
        doc: "Grupo de opciones excluyentes (flechas para moverse).",
        props: { ...FIELD_COMMON, options: S.arr(OPTION, "Opciones."), orientation: S.en(["vertical", "horizontal"], "Disposicion.", { def: "vertical" }) },
    },
    TOGGLE: { category: "input", doc: "Interruptor (switch) on/off.", props: { ...FIELD_COMMON } },
    SLIDER: {
        category: "input",
        doc: "Control deslizante numerico.",
        props: { ...FIELD_COMMON, min: S.num("Minimo.", { def: 0 }), max: S.num("Maximo.", { def: 100 }), step: S.num("Paso.", { def: 1 }), showValue: S.bool("Muestra el valor.", { def: true }) },
    },
    DATE_PICKER: { category: "input", doc: "Fecha (valor AAAA-MM-DD).", props: { ...FIELD_COMMON, min: S.str("Fecha minima AAAA-MM-DD."), max: S.str("Fecha maxima AAAA-MM-DD.") } },
    TIME_PICKER: { category: "input", doc: "Hora (valor HH:MM).", props: { ...FIELD_COMMON, step: S.num("Paso en segundos.", { min: 60, max: 3600 }) } },
    COLOR_PICKER: {
        category: "input",
        doc: "Selector de color SOLO para datos del usuario (etiquetas, agendas). El valor es un hex en `state`; nunca estiliza la interfaz.",
        props: { ...FIELD_COMMON, value: S.hex("Hex del dato elegido."), defaultValue: S.hex("Hex inicial (dato).") },
    },
    FILE_INPUT: {
        category: "input",
        doc: "Seleccion de archivos con limite de tamano; puede leerlos como base64/texto.",
        props: {
            ...FIELD_COMMON, accept: S.str("Tipos aceptados (p. ej. \"image/*,.pdf\").", { max: 200 }), multiple: S.bool("Varios archivos."),
            maxSizeMb: S.num("Tamano maximo por archivo (MB).", { min: 0.01, max: 25, def: 5 }),
            readAs: S.en(["none", "base64", "text"], "Lee el contenido y lo entrega en `value`.", { def: "none" }),
            onSelect: S.action("Accion al elegir (recibe `value`: [{name,size,type,content?}])."),
            onUpload: S.action("Obsoleto: sube con context.uploadAttachment."), onSuccess: S.action("Tras subir."), onError: S.action("Si falla la subida."),
        },
    },
    TAG_INPUT: {
        category: "input",
        doc: "Lista de etiquetas/valores (Enter o coma anade, Retroceso quita).",
        props: { ...FIELD_COMMON, max: S.num("Maximo de etiquetas.", { min: 1, max: 200 }), validate: S.en(["none", "email"], "Valida cada etiqueta.", { def: "none" }), suggestions: S.any("Arreglo de textos sugeridos.") },
    },
    CONTACT_PICKER: {
        category: "input",
        doc: "Selector de contactos de la libreta (correos). El valor es un arreglo de correos.",
        props: { ...FIELD_COMMON, multiple: S.bool("Varios contactos.", { def: true }), max: S.num("Maximo de contactos.", { min: 1, max: 200 }), contacts: S.any("Contactos propios [{name,email}] en lugar de la libreta.") },
    },
    FORM: {
        category: "input", children: true,
        doc: "Formulario con validacion declarativa y estados (cargando/error/exito) automaticos.",
        props: {
            fields: S.arr(S.obj({
                ...FIELD_COMMON,
                type: S.str("text|email|password|number|textarea|select|checkbox|toggle|date|time|datetime-local|radio|slider|color|tags|contacts|richtext.", { max: 30 }),
                options: S.arr(OPTION, "Opciones (select/radio)."),
                mountPoint: S.str("Punto de montaje de extensiones junto al campo.", { max: 60 }), mountInline: S.bool("Montar en la misma linea."), contextSetter: S.name("Nombre del setter expuesto al mount."),
                min: S.num("Minimo."), max: S.num("Maximo."), step: S.num("Paso."), rows: S.num("Filas (textarea).", { min: 1, max: 40 }),
            }, "Campo"), "Campos declarativos."),
            submitLabel: S.text("Texto del boton enviar.", { def: "Enviar" }),
            cancelLabel: S.text("Texto del boton cancelar (solo si hay onCancel)."),
            onSubmit: S.action("Accion al enviar: recibe `formData`. CALL_BACKEND pone el formulario en estado de carga y muestra el error."),
            onCancel: S.action("Accion del boton cancelar."),
            successMessage: S.text("Mensaje tras un envio correcto."),
            resetOnSuccess: S.bool("Vacia el formulario tras el exito."),
            validateOn: S.en(["submit", "blur", "change"], "Cuando validar.", { def: "blur" }),
            gap: gap(4),
        },
    },

    // ---- Datos ------------------------------------------------------------------------------------------------
    TABLE: {
        category: "data",
        doc: "Tabla con orden, paginacion y seleccion.",
        props: {
            columns: S.arr(TABLE_COLUMN, "Columnas."), data: S.any("Filas (arreglo de objetos)."), rows: S.any("Alias de `data`."),
            rowKey: S.name("Clave unica de fila (por defecto el indice)."),
            selectable: S.en(["none", "single", "multiple"], "Seleccion de filas.", { def: "none" }), bind: S.name("Clave de `state` con las claves seleccionadas."),
            pageSize: S.num("Filas por pagina (0 = sin paginar).", { min: 0, max: 200, def: 0 }),
            density: S.en(DENSITIES, "Altura de fila.", { def: "comfortable" }), emptyText: S.text("Texto si no hay filas."), loading: S.bool("Muestra esqueleto."),
            actions: S.arr(ROW_ACTION, "Acciones por fila."), onRowClick: S.action("Accion al pulsar una fila (recibe `row`)."), onSelect: S.action("Accion al cambiar la seleccion (recibe `value`)."),
            caption: S.text("Titulo accesible de la tabla."),
            searchable: S.bool("Caja de busqueda que filtra por cualquier columna."), searchPlaceholder: S.text("Texto de ejemplo de la busqueda."),
            defaultSort: S.obj({ key: S.name("Clave de la columna.", { required: true }), dir: S.en(["asc", "desc"], "Sentido.", { def: "asc" }) }, "Orden inicial."),
            bulkActions: S.arr(BULK_ACTION, "Acciones sobre las filas seleccionadas (aparecen con seleccion multiple)."),
            error: S.text("Mensaje de error de carga: sustituye a las filas."), onRetry: S.action("Accion del boton Reintentar (solo con `error`)."),
        },
    },
    LIST: {
        category: "data",
        doc: "Lista de elementos: con `itemTemplate` + `items` (una plantilla por dato) o con hijos LIST_ITEM.",
        props: {
            items: S.any("Datos (arreglo)."), itemTemplate: S.node("Plantilla por dato (usa `item`)."), empty: S.node("Que mostrar si no hay datos."),
            columns: S.en([1, 2, 3, 4], "Columnas.", { def: 1 }), gap: gap(2), variant: S.en(["plain", "divided", "cards"], "Aspecto.", { def: "plain" }),
            maxHeight: S.en(["sm", "md", "lg", "xl"], "Limita la altura y activa el scroll."),
        },
        children: true,
    },
    LIST_ITEM: {
        category: "data", children: true,
        doc: "Elemento de lista con titulo, descripcion, icono y acciones finales (hijos).",
        props: { title: S.text("Titulo."), description: S.text("Texto secundario."), meta: S.text("Dato a la derecha (fecha, contador)."), icon: S.icon(), tone: tone(), selected: S.bool("Resaltado."), onClick: S.action("Hace el elemento pulsable.") },
    },
    TIMELINE: {
        category: "data",
        doc: "Linea de tiempo vertical de eventos (fecha, titulo, descripcion, icono y tono).",
        props: {
            items: S.arr(S.obj({
                title: S.text("Titulo del evento.", { required: true }), description: S.text("Detalle."),
                time: S.text("Fecha/hora (ISO, se formatea en el idioma del usuario) o texto libre."), icon: S.icon(), tone: tone(),
                onClick: S.action("Accion al pulsar el evento."),
            }, "Evento"), "Eventos (max 200), en el orden dado."),
            emptyText: S.text("Texto si no hay eventos."), loading: S.bool("Muestra esqueleto."),
        },
    },
    TREE: {
        category: "data",
        doc: "Arbol navegable accesible (WAI-ARIA tree: flechas, Inicio/Fin, Intro). Nodos {id, label, icon?, badge?, children?}.",
        props: {
            items: S.any("Arbol [{id,label,description?,icon?,badge?,children?:[...]}]; max 500 nodos y 8 niveles."),
            bind: S.name("Clave de `state` con el id del nodo elegido."), label: S.text("Nombre accesible del arbol."),
            defaultExpanded: S.num("Niveles abiertos al inicio (0 = todo cerrado).", { min: 0, max: 8, def: 1 }),
            onSelect: S.action("Accion al elegir un nodo (recibe `value`: su id; y `item`)."),
            emptyText: S.text("Texto si no hay nodos."), loading: S.bool("Muestra esqueleto."),
        },
    },
    TABS: {
        category: "navigation", children: true,
        doc: "Pestanas accesibles (flechas, Inicio/Fin).",
        props: {
            tabs: S.arr(S.obj({ label: S.text("Texto."), value: S.name("Identificador."), icon: S.icon(), content: S.nodes("Contenido.") }, "Pestana"), "Pestanas."),
            bind: S.name("Clave de `state` con la pestana activa."), variant: S.en(["underline", "pills"], "Aspecto.", { def: "underline" }), onChange: S.action("Al cambiar (recibe `value`)."),
            value: S.str("Pestana activa (value o label)."), label: S.text("value de este TAB_ITEM (forma heredada)."),
        },
    },
    TAB_ITEM: { category: "navigation", children: true, doc: "Panel de TABS (forma heredada con hijos).", props: { label: S.text("Texto."), value: S.name("Identificador.") } },
    ACCORDION: {
        category: "navigation", children: true,
        doc: "Secciones plegables (Enter/Espacio).",
        props: {
            sections: S.arr(S.obj({ title: S.text("Titulo."), content: S.nodes("Contenido."), defaultOpen: S.bool("Abierta al inicio.") }, "Seccion"), "Secciones."),
            multiple: S.bool("Varias abiertas a la vez.", { def: true }),
        },
    },
    ACCORDION_ITEM: { category: "navigation", children: true, doc: "Seccion de ACCORDION (forma heredada con hijos).", props: { title: S.text("Titulo.") } },
    STEPPER: {
        category: "navigation",
        doc: "Indicador de los pasos de un proceso (completado, actual, pendiente, error). Solo informa; para mostrar contenido por pasos usa WIZARD.",
        props: {
            steps: S.arr(S.obj({
                title: S.text("Titulo del paso.", { required: true }), description: S.text("Descripcion corta."),
                status: S.en(["complete", "current", "upcoming", "error"], "Estado explicito; por defecto se deduce de `current`."),
            }, "Paso"), "Pasos (max 20)."),
            current: S.num("Indice (desde 0) del paso actual.", { min: 0, max: 100, def: 0 }),
            orientation: S.en(["horizontal", "vertical"], "Disposicion (la horizontal pasa a vertical en pantallas estrechas).", { def: "horizontal" }),
            onSelect: S.action("Accion al pulsar un paso completado (recibe `value`: su indice)."),
        },
    },
    WIZARD: {
        category: "navigation",
        doc: "Asistente por pasos con indicador de progreso.",
        props: {
            steps: S.arr(STEP, "Pasos."),
            nav: S.en(["auto", "manual"], "auto: botones Atras/Siguiente integrados; manual: el contenido lleva NEXT_STEP/PREV_STEP.", { def: "auto" }),
            backLabel: S.text("Texto de Atras.", { def: "Atras" }), nextLabel: S.text("Texto de Siguiente.", { def: "Siguiente" }), finishLabel: S.text("Texto del ultimo paso.", { def: "Finalizar" }),
            onFinish: S.action("Accion al finalizar (nav auto)."),
        },
    },

    // ---- Feedback ---------------------------------------------------------------------------------------------
    BADGE: { category: "feedback", children: true, doc: "Etiqueta corta de estado.", props: { label: S.text("Texto."), tone: tone(), variant: S.en(SURFACE_VARIANTS, "Aspecto.", { def: "soft" }), size: S.en(["sm", "md"], "Tamano.", { def: "md" }) } },
    CHIP: {
        category: "feedback",
        doc: "Chip (filtro/valor) opcionalmente pulsable o eliminable.",
        props: { label: S.text("Texto."), tone: tone(), icon: S.icon(), selected: S.bool("Activo."), removable: S.bool("Muestra el boton quitar."), onClick: S.action("Accion al pulsar."), onRemove: S.action("Accion al quitar.") },
    },
    AVATAR: {
        category: "feedback",
        doc: "Avatar con imagen (https) o iniciales.",
        props: { src: S.url("Imagen https."), name: S.text("Nombre: da las iniciales y el texto alternativo."), initials: S.text("Iniciales (2)."), alt: S.text("Texto alternativo."), size: S.en(SIZES_XL, "Tamano.", { def: "md" }), tone: tone() },
    },
    STAT: {
        category: "feedback",
        doc: "Metrica destacada con variacion.",
        props: { label: S.text("Nombre de la metrica."), value: S.text("Valor."), delta: S.text("Variacion (texto)."), trend: S.en(["up", "down", "flat"], "Direccion; up es bueno (success) y down malo (danger).", { def: "flat" }), description: S.text("Texto de apoyo."), icon: S.icon(), tone: tone() },
    },
    PROGRESS: {
        category: "feedback",
        doc: "Barra de progreso (role=progressbar).",
        props: { value: S.num("Valor actual."), max: S.num("Maximo.", { min: 1, def: 100 }), label: S.text("Etiqueta."), tone: tone("primary"), size: S.en(SIZES, "Grosor.", { def: "md" }), showValue: S.bool("Muestra el porcentaje.", { def: true }), indeterminate: S.bool("Progreso desconocido.") },
    },
    KPI_CARD: {
        category: "data",
        doc: "Indicador clave (KPI): valor destacado, variacion, mini-tendencia, estado de carga y error. Pulsable con onClick.",
        props: {
            label: S.text("Nombre del indicador.", { required: true }), value: S.text("Valor ya formateado (texto o numero)."), unit: S.text("Unidad tras el valor (%, ms, usuarios...)."),
            delta: S.text("Variacion (texto)."), trend: S.en(["up", "down", "flat"], "Direccion de la variacion.", { def: "flat" }),
            invertTrend: S.bool("Si bajar es bueno (p. ej. spam): up pasa a malo y down a bueno."),
            description: S.text("Texto de apoyo."), icon: S.icon(), tone: tone(),
            sparkline: S.arr(S.num("Valor."), "Serie de la mini-tendencia (max 60 puntos)."),
            loading: S.bool("Muestra esqueleto."), error: S.text("Mensaje de error en lugar del valor."),
            onClick: S.action("Hace la tarjeta pulsable."),
        },
    },
    SKELETON: {
        category: "feedback",
        doc: "Marcador de carga.",
        props: { variant: S.en(["text", "circle", "rect"], "Forma.", { def: "text" }), lines: S.num("Lineas (text).", { min: 1, max: 12, def: 1 }), size: S.en(SIZES_XL, "Tamano (circle/rect).", { def: "md" }) },
    },
    EMPTY: {
        category: "feedback", children: true,
        doc: "Estado vacio con mensaje y accion.",
        props: { icon: S.icon(), title: S.text("Titulo."), description: S.text("Texto."), action: S.action("Accion del boton."), actionLabel: S.text("Texto del boton.") },
    },
    ALERT: {
        category: "feedback", children: true,
        doc: "Aviso en linea (role=alert para danger/warning).",
        props: { tone: tone("info"), title: S.text("Titulo."), message: S.text("Mensaje."), description: S.text("Alias de message."), icon: S.icon(), dismissible: S.bool("Se puede cerrar.") },
    },
    CALLOUT: {
        category: "feedback", children: true,
        doc: "Nota destacada (consejo, advertencia) con hijos.",
        props: { tone: tone("info"), title: S.text("Titulo."), icon: S.icon() },
    },
    LOADING: { category: "feedback", doc: "Indicador de carga.", props: { label: S.text("Texto."), size: S.en(SIZES, "Tamano.", { def: "md" }) } },

    // ---- Overlays ---------------------------------------------------------------------------------------------
    MODAL: {
        category: "overlay", children: true,
        doc: "Marco de un OVERLAY (titulo + contenido). Con `open`/`bind` se comporta como dialogo propio accesible.",
        props: {
            title: S.text("Titulo."), description: S.text("Subtitulo."), icon: S.icon(), width: S.en(WIDTHS, "Ancho.", { def: "md" }),
            open: S.bool("Abre un dialogo propio (en lugar de un marco)."), bind: S.name("Clave de `state` booleana que lo abre/cierra."),
            footer: S.nodes("Pie (botones)."), onLoad: S.action("Accion al montar."), onLoadWhen: S.any("Condicion de onLoad."), onClose: S.action("Al cerrar."),
        },
    },
    DRAWER: {
        category: "overlay", children: true,
        doc: "Panel lateral accesible.",
        props: { title: S.text("Titulo."), side: S.en(["left", "right"], "Lado.", { def: "right" }), width: S.en(["sm", "md", "lg"], "Ancho.", { def: "md" }), open: S.bool("Visible."), bind: S.name("Clave de `state` booleana."), footer: S.nodes("Pie."), onClose: S.action("Al cerrar.") },
    },
    POPOVER: {
        category: "overlay", children: true,
        doc: "Contenido flotante anclado a un disparador.",
        props: { trigger: S.node("Componente que abre (un BUTTON...)."), triggerLabel: S.text("Texto del boton disparador si no hay `trigger`."), title: S.text("Titulo accesible."), align: S.en(["start", "end"], "Lado.", { def: "start" }) },
    },
    TOOLTIP: { category: "overlay", children: true, doc: "Ayuda al pasar el raton o enfocar (Escape cierra).", props: { text: S.text("Texto de la ayuda.") } },

    // ---- Graficos ---------------------------------------------------------------------------------------------
    BAR_CHART: {
        category: "chart",
        doc: "Barras simples en SVG propio con colores de tema.",
        props: { data: S.arr(CHART_POINT, "Datos [{label,value,tone?}]."), orientation: S.en(["vertical", "horizontal"], "Direccion.", { def: "vertical" }), showValues: S.bool("Escribe el valor sobre cada barra.", { def: true }), height: S.en(["sm", "md", "lg"], "Altura.", { def: "md" }), tone: tone("primary"), title: S.text("Titulo accesible.") },
    },
    CHART: {
        category: "chart",
        doc: "Grafico de lineas, barras, area, sectores o anillo con varias series, leyenda y tooltips accesibles (raton y teclado). SVG propio con colores del tema, sin librerias.",
        props: {
            kind: S.en(["line", "bar", "area", "pie", "donut"], "Tipo de grafico.", { def: "line" }),
            labels: S.arr(S.text("Etiqueta."), "Etiquetas del eje X (line, bar, area): una por valor de cada serie (max 120)."),
            series: S.arr(CHART_SERIES, "Series (max 8) de line, bar y area."),
            data: S.arr(CHART_POINT, "pie y donut: [{label,value,tone?}] (max 60)."),
            stacked: S.bool("Apila las series (bar y area)."), showLegend: S.bool("Muestra la leyenda.", { def: true }), showGrid: S.bool("Lineas guia horizontales.", { def: true }),
            valueFormat: S.en(["number", "compact", "percent"], "Formato de los valores en ejes y tooltips (percent: el valor ya es un porcentaje 0-100).", { def: "number" }),
            unit: S.text("Unidad que se anade al valor en los tooltips (p. ej. correos)."),
            height: S.en(["sm", "md", "lg"], "Altura.", { def: "md" }), centerLabel: S.text("Texto central (donut)."),
            title: S.text("Titulo accesible."), description: S.text("Resumen para lectores de pantalla."),
            emptyText: S.text("Texto si no hay datos."), loading: S.bool("Muestra esqueleto."), error: S.text("Mensaje de error en lugar del grafico."),
        },
    },
    SPARKLINE: {
        category: "chart",
        doc: "Linea de tendencia minima.",
        props: { values: S.arr(S.num("Valor."), "Serie numerica."), tone: tone("primary"), height: S.en(["sm", "md", "lg"], "Altura.", { def: "sm" }), area: S.bool("Area bajo la linea."), label: S.text("Descripcion accesible.") },
    },
    DONUT: {
        category: "chart",
        doc: "Anillo de proporciones con leyenda.",
        props: { data: S.arr(CHART_POINT, "Datos [{label,value,tone?}]."), centerLabel: S.text("Texto central."), size: S.en(SIZES_XL, "Tamano.", { def: "md" }), showLegend: S.bool("Leyenda.", { def: true }), title: S.text("Titulo accesible.") },
    },

    // ---- Logica (sin aspecto propio) ---------------------------------------------------------------------------
    CONDITIONAL: { category: "logic", doc: "Muestra `true` o `false` segun `condition`.", props: { condition: S.any("Expresion."), true: S.nodes("Si es verdadera."), false: S.nodes("Si es falsa.") } },
    CONDITION: { category: "logic", children: true, doc: "Como CONDITIONAL con `if` y `else`.", props: { if: S.any("Expresion."), true: S.nodes("Si es verdadera."), false: S.nodes("Si es falsa."), else: S.nodes("Alias de false.") } },
    FOR_EACH: {
        category: "logic",
        doc: "Repite `template` por cada elemento de `items`.",
        props: { items: S.any("Arreglo."), as: S.name("Nombre del elemento.", { def: "item" }), index: S.name("Nombre del indice.", { def: "index" }), template: S.node("Plantilla."), empty: S.node("Si no hay elementos.") },
    },
    REPEAT: { category: "logic", children: true, doc: "Repite los hijos N veces o por item.", props: { count: S.num("Veces (max 200).", { min: 0, max: 200 }), items: S.any("Arreglo."), as: S.name("Nombre del elemento."), index: S.name("Nombre del indice.") } },
    SWITCH: { category: "logic", children: true, doc: "Elige un caso segun `value` (forma `cases` o hijos CASE/DEFAULT).", props: { value: S.any("Valor."), cases: S.rec(S.nodes("Componente(s)."), "Casos."), default: S.nodes("Por defecto.") } },
    CASE: { category: "logic", children: true, doc: "Caso de SWITCH (forma con hijos).", props: { value: S.any("Valor que activa el caso.") } },
    DEFAULT: { category: "logic", children: true, doc: "Caso por defecto de SWITCH.", props: {} },
    SET_VAR: { category: "logic", doc: "Fija una variable de `state` (no visible).", props: { name: S.name("Clave."), value: S.any("Valor.") } },
    HEADLESS: { category: "logic", doc: "Sin interfaz: solo ejecuta `onLoad`.", props: {} },
    DEBUG: { category: "logic", doc: "Solo desarrollo: muestra contexto y estado.", props: {} },
};

/** Props que admite CUALQUIER componente. */
export const COMMON_PROPS: Record<string, PropSpec> = {
    hidden: S.bool("true oculta el componente (admite expresiones)."),
    onLoad: S.action("Accion que se ejecuta una vez al montar."),
    onLoadWhen: S.any("Condicion: onLoad se ejecuta cuando pasa a verdadera."),
    ariaLabel: S.text("Nombre accesible explicito."),
};

// ---------------------------------------------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------------------------------------------

export type ActionSpec = { doc: string; required?: string[]; props: Record<string, PropSpec> };

const RETRY = S.obj({
    attempts: S.num("Intentos totales (1-5).", { min: 1, max: 5, def: 1 }),
    delayMs: S.num("Espera entre intentos.", { min: 0, max: 10000, def: 500 }),
    backoff: S.en(["none", "linear", "exponential"], "Como crece la espera.", { def: "exponential" }),
}, "Reintento declarativo.");

const CHAIN = S.action("Accion(es) encadenada(s).");

export const UI_ACTIONS: Record<string, ActionSpec> = {
    SET_STATE: { doc: "Guarda `value` en `state[key]` (la clave admite ruta con puntos).", required: ["key"], props: { key: S.name("Clave."), value: S.any("Valor.") } },
    MERGE_STATE: { doc: "Mezcla un objeto en `state[key]`.", required: ["key"], props: { key: S.name("Clave."), value: S.any("Objeto.") } },
    MAP_ARRAY: { doc: "Transforma `state[source]` con `template` (usa `item`).", required: ["source", "template"], props: { source: S.name("Clave origen."), target: S.name("Clave destino."), template: S.any("Plantilla por elemento.") } },
    FILTER_ARRAY: { doc: "Filtra `state[source]` con `condition` (usa `item`).", required: ["source", "condition"], props: { source: S.name("Clave origen."), target: S.name("Clave destino."), condition: S.any("Expresion.") } },
    SET_LOADING: { doc: "Marca una clave como cargando (`state.$loading`).", required: ["key"], props: { key: S.name("Clave."), value: S.bool("true/false.") } },
    OPEN_OVERLAY: { doc: "Abre un OVERLAY del manifest.", required: ["targetId"], props: { targetId: S.name("id del overlay."), extensionId: S.name("Extension duena."), overlays: S.any("Interno."), passArgs: S.bool("Pasa los argumentos del comando con barra (`context.slashArgs`) al overlay."), passResult: S.bool("Obsoleto: `result`/`value` ya llegan siempre al overlay.") } },
    CLOSE_OVERLAY: { doc: "Cierra el overlay actual.", props: {} },
    OPEN_URL: { doc: "Abre una URL http(s)/mailto/tel en pestana nueva.", required: ["url"], props: { url: S.url("Destino.") } },
    NAVIGATE: { doc: "Navega a una ruta INTERNA de la app (empieza por /).", required: ["path"], props: { path: S.str("Ruta interna.", { max: 500 }) } },
    REFRESH: { doc: "Refresca los datos de la pagina.", props: {} },
    DELAY: { doc: "Espera `ms` (max 10000).", props: { ms: S.num("Milisegundos.", { min: 0, max: 10000 }) } },
    CONFIRM: { doc: "Pide confirmacion y encadena onConfirm/onCancel.", props: { message: S.text("Pregunta."), onConfirm: CHAIN, onCancel: CHAIN } },
    CALL_BACKEND: {
        doc: "Llama a una funcion del server.js. Pone `state.$loading[key]`/`state.$error[key]` solos, admite reintento y guarda el resultado con `resultKey`.",
        required: ["function"],
        props: {
            function: S.name("Clave de api.functions."), args: S.any("Argumentos (con FORM, formData se anade solo)."), params: S.any("Alias de args."),
            key: S.name("Clave de carga/error (por defecto el nombre de la funcion)."), resultKey: S.name("Guarda el resultado en `state[resultKey]`."),
            retry: RETRY, toastOnError: S.bool("Muestra un aviso si falla y no hay onError.", { def: true }), onSuccess: CHAIN, onError: CHAIN,
        },
    },
    CALL_API: {
        doc: "Llama a una ruta del propio origen (/api/...).", required: ["url"],
        props: {
            url: S.str("Ruta /api/...", { max: 500 }), method: S.en(["GET", "POST", "PUT", "PATCH", "DELETE"], "Metodo.", { def: "GET" }), headers: S.rec(S.str("Valor."), "Cabeceras."),
            body: S.any("Cuerpo."), args: S.any("Alias de body."), params: S.any("Alias de body."), emitEvent: S.str("Evento de window con el resultado.", { max: 80 }),
            key: S.name("Clave de carga/error."), resultKey: S.name("Guarda el resultado."), retry: RETRY, toastOnError: S.bool("Aviso si falla.", { def: true }), onSuccess: CHAIN, onError: CHAIN,
        },
    },
    TOAST: { doc: "Muestra un aviso breve.", required: ["message"], props: { message: S.text("Texto."), variant: S.en(["info", "success", "error", "warning"], "Tipo."), tone: S.en(TONES, "Alias semantico de variant.") } },
    COPY_TO_CLIPBOARD: { doc: "Copia texto.", required: ["text"], props: { text: S.text("Texto."), successMessage: S.text("Aviso al copiar.") } },
    INSERT_CONTENT: { doc: "Inserta HTML/texto en el editor del composer.", required: ["content"], props: { content: S.any("Contenido."), closeOverlay: S.bool("Cierra el overlay.") } },
    APPEND_BODY: { doc: "Anade contenido al final del cuerpo.", required: ["content"], props: { content: S.any("Contenido."), closeOverlay: S.bool("Cierra el overlay.") } },
    SET_SUBJECT: { doc: "Fija el asunto del correo.", props: { subject: S.text("Asunto."), value: S.text("Alias."), ifEmpty: S.bool("Solo si esta vacio.") } },
    ADD_ATTACHMENT: { doc: "Adjunta un archivo (url o contentBase64).", props: { attachment: S.any("Adjunto."), url: S.url("URL https."), filename: S.str("Nombre.", { max: 200 }), mimeType: S.str("MIME.", { max: 100 }), contentBase64: S.str("Contenido base64.", { max: 20000000 }), size: S.num("Bytes.") } },
    SET_CONTEXT_VALUE: { doc: "Llama a un setter del contexto (p. ej. setLocation).", required: ["key"], props: { key: S.name("Nombre del setter."), value: S.any("Valor.") } },
    NEXT_STEP: { doc: "Avanza el WIZARD que contiene al componente.", props: {} },
    PREV_STEP: { doc: "Retrocede el WIZARD.", props: {} },
    SECURE_SAVE: { doc: "Guarda un dato cifrado en el navegador del usuario.", required: ["key"], props: { key: S.name("Clave."), value: S.any("Valor."), onSuccess: CHAIN, onError: CHAIN } },
    SECURE_READ: { doc: "Lee un dato cifrado local a `state[targetState]`.", required: ["key"], props: { key: S.name("Clave."), targetState: S.name("Clave de state."), onSuccess: CHAIN, onError: CHAIN } },
    OAUTH_CONNECT: { doc: "Inicia la conexion OAuth de un proveedor.", required: ["provider"], props: { provider: S.name("Proveedor (google, slack...)."), url: S.str("Ruta interna alternativa.", { max: 500 }) } },
    OAUTH_DISCONNECT: { doc: "Desconecta el proveedor.", required: ["provider"], props: { provider: S.name("Proveedor."), onSuccess: CHAIN } },
};

export const UI_COMPONENT_TYPES: string[] = Object.keys(UI_COMPONENTS);
export const UI_ACTION_TYPES: string[] = Object.keys(UI_ACTIONS);

// ---------------------------------------------------------------------------------------------------------------
// Capacidad ui.pages.v1 (componentes de pagina completa)
// ---------------------------------------------------------------------------------------------------------------

/** Capacidad que debe declarar (`requires.capabilities`) todo manifest que use los componentes de pagina o las props nuevas de TABLE. */
export const PAGE_UI_CAPABILITY = "ui.pages.v1";
/** Componentes que solo existen en clientes con ui.pages.v1. */
export const PAGE_UI_COMPONENTS: string[] = ["PAGE_HEADER", "SPLIT_PANE", "KPI_CARD", "CHART", "TIMELINE", "TREE", "STEPPER"];
/** Props de TABLE (y de sus columnas) anadidas con ui.pages.v1: un cliente antiguo las ignoraria y mostraria una tabla distinta. */
export const PAGE_UI_TABLE_PROPS: string[] = ["searchable", "searchPlaceholder", "defaultSort", "bulkActions", "error", "onRetry"];
export const PAGE_UI_COLUMN_KEYS: string[] = ["toneMap", "hrefKey", "filter"];
export const PAGE_UI_COLUMN_FORMATS: string[] = ["link", "status"];

/** Motivo por el que un nodo `{type, props}` exige ui.pages.v1, o null si no lo exige. */
export function pageUiReason(node: unknown): string | null {
    if (typeof node !== "object" || node === null || Array.isArray(node)) return null;
    const n = node as { type?: unknown; props?: unknown };
    if (typeof n.type !== "string") return null;
    if (PAGE_UI_COMPONENTS.indexOf(n.type) !== -1) return "componente " + n.type;
    if (n.type === "TABLE" || n.type === "DATA_TABLE") {
        const props = typeof n.props === "object" && n.props !== null && !Array.isArray(n.props) ? (n.props as Record<string, unknown>) : {};
        for (const key of PAGE_UI_TABLE_PROPS) if (props[key] !== undefined) return "TABLE." + key;
        if (Array.isArray(props.columns)) {
            for (const col of props.columns) {
                if (typeof col !== "object" || col === null) continue;
                const c = col as Record<string, unknown>;
                for (const key of PAGE_UI_COLUMN_KEYS) if (c[key] !== undefined) return "TABLE.columns[]." + key;
                if (typeof c.format === "string" && PAGE_UI_COLUMN_FORMATS.indexOf(c.format) !== -1) return "TABLE.columns[].format=" + c.format;
            }
        }
    }
    return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------------------------------------------
// Textos por idioma
// ---------------------------------------------------------------------------------------------------------------
//
// Cualquier prop de TEXTO (label, content, placeholder, title, message...) puede ser un objeto por idioma en lugar de un string:
//   { "label": { "es": "Guardar", "en": "Save" } }
// El renderer (y el frontend al cargar la extension) lo resuelve al idioma del usuario con `localizeUi`; si falta ese idioma cae a
// en, luego es, luego el primero. Un string normal sigue funcionando igual (retrocompatible). Se valida cada variante como texto.

const LANG_KEY_RE = /^[a-z]{2}(?:-[A-Za-z]{2})?$/;

/** `{es: "...", en: "..."}`: objeto no vacio (max 12 idiomas) cuyas claves son codigos de idioma y cuyos valores son texto. */
export function isI18nText(value: unknown): value is Record<string, string> {
    if (!isObject(value)) return false;
    const keys = Object.keys(value);
    if (keys.length === 0 || keys.length > 12) return false;
    for (const key of keys) if (!LANG_KEY_RE.test(key) || typeof value[key] !== "string") return false;
    return true;
}

/** Variante para `lang` (exacta, base "es" de "es-MX", en, es, o la primera). */
export function pickI18nText(value: Record<string, string>, lang: string): string {
    const wanted = String(lang || "").toLowerCase();
    const base = wanted.split("-")[0];
    const byLower: Record<string, string> = {};
    for (const key of Object.keys(value)) byLower[key.toLowerCase()] = value[key];
    const hit = [wanted, base, "en", "es"].find((candidate) => candidate && typeof byLower[candidate] === "string");
    return hit ? byLower[hit] : value[Object.keys(value)[0]];
}

/** Claves cuyo valor es TEXTO segun el catalogo (label, content, message...): solo ahi se interpretan los objetos por idioma. */
let textKeys: Record<string, true> | null = null;
function i18nTextKeys(): Record<string, true> {
    if (textKeys) return textKeys;
    const keys: Record<string, true> = {};
    const not = ["name", "key", "id", "value", "bind", "bindTo", "function", "action", "type", "url", "href", "icon", "provider", "targetState", "targetId"];
    const visit = (name: string | null, spec: PropSpec | undefined, depth: number) => {
        if (!spec || depth > 6) return;
        if (name && (spec.k === "text" || spec.k === "string") && not.indexOf(name) === -1) keys[name] = true;
        if (spec.of) visit(null, spec.of, depth + 1);
        if (spec.shape) for (const child of Object.keys(spec.shape)) visit(child, spec.shape[child], depth + 1);
    };
    for (const type of Object.keys(UI_COMPONENTS)) for (const prop of Object.keys(UI_COMPONENTS[type].props)) visit(prop, UI_COMPONENTS[type].props[prop], 0);
    for (const prop of Object.keys(COMMON_PROPS)) visit(prop, COMMON_PROPS[prop], 0);
    for (const action of Object.keys(UI_ACTIONS)) for (const prop of Object.keys(UI_ACTIONS[action].props)) visit(prop, UI_ACTIONS[action].props[prop], 0);
    textKeys = keys;
    return keys;
}

/**
 * Resuelve los textos por idioma de un UI JSON (o de un manifest entero) al idioma `lang`. No modifica la entrada y devuelve la
 * MISMA referencia si no hay nada que resolver (para no romper caches por identidad).
 */
export function localizeUi<T = any>(ui: T, lang: string): T {
    const keys = i18nTextKeys();
    const walk = (value: any, key: string | null, depth: number): any => {
        if (depth > 60 || value === null || typeof value !== "object") return value;
        if (Array.isArray(value)) {
            let changed = false;
            const out = value.map((item) => {
                const next = walk(item, key, depth + 1);
                if (next !== item) changed = true;
                return next;
            });
            return changed ? out : value;
        }
        if (key !== null && keys[key] === true && isI18nText(value)) return pickI18nText(value, lang);
        let changed = false;
        const out: Record<string, any> = {};
        for (const k of Object.keys(value)) {
            const next = walk(value[k], k, depth + 1);
            if (next !== value[k]) changed = true;
            out[k] = next;
        }
        return changed ? out : value;
    };
    return walk(ui, null, 0) as T;
}

function hasExpression(value: string): boolean {
    return value.indexOf("${") !== -1;
}

/** Tramos `${...}` de un texto. `unclosed`: hay un `${` sin su `}` (el renderer lo deja como texto literal: casi seguro un error del autor). */
function scanExpressions(value: string): { segments: string[]; unclosed: boolean } {
    const out: string[] = [];
    let unclosed = false;
    let i = 0;
    while (i < value.length) {
        if (value[i] === "$" && value[i + 1] === "{") {
            let j = i + 2;
            let braces = 1;
            let quote = "";
            while (j < value.length && braces > 0) {
                const c = value[j];
                if (quote) {
                    if (c === "\\") j++;
                    else if (c === quote) quote = "";
                } else if (c === '"' || c === "'") quote = c;
                else if (c === "{") braces++;
                else if (c === "}") braces--;
                j++;
            }
            if (braces !== 0) { unclosed = true; break; }
            out.push(value.slice(i + 2, j - 1));
            i = j;
        } else i++;
    }
    return { segments: out, unclosed };
}

function expressionSegments(value: string): string[] {
    return scanExpressions(value).segments;
}

function levenshtein(a: string, b: string): number {
    const dp: number[] = [];
    for (let j = 0; j <= b.length; j++) dp[j] = j;
    for (let i = 1; i <= a.length; i++) {
        let prev = dp[0];
        dp[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const tmp = dp[j];
            dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = tmp;
        }
    }
    return dp[b.length];
}

/** "¿Quisiste decir ...?" para nombres de componentes/props mal escritos. */
export function suggest(word: string, candidates: readonly string[]): string | null {
    let best: string | null = null;
    let bestScore = 3;
    const lower = word.toLowerCase();
    for (const candidate of candidates) {
        const score = levenshtein(lower, candidate.toLowerCase());
        if (score < bestScore) { best = candidate; bestScore = score; }
    }
    return best;
}

const PROP_HINTS: Record<string, string> = {
    bindTo: "usa `bind`", className: "las extensiones no eligen estilos: usa `tone`, `variant`, `size`, `gap`...", style: "las extensiones no eligen estilos: usa props semanticas",
    color: "usa `tone` (neutral, primary, success, warning, danger, info)", variant: "revisa los valores permitidos del componente", html: "usa MARKDOWN o componentes; el HTML no esta permitido",
};

// ---------------------------------------------------------------------------------------------------------------
// Validacion
// ---------------------------------------------------------------------------------------------------------------

export function validateUi(input: unknown, options: UiValidateOptions = {}): UiValidation {
    const errors: UiIssue[] = [];
    const warnings: UiIssue[] = [];
    const root = options.root || "ui";
    const checkExpression = options.checkExpression;
    let nodes = 0;
    let maxDepth = 0;

    const err = (path: string, code: string, message: string) => { if (errors.length < 200) errors.push({ path, code, message }); };
    const warn = (path: string, code: string, message: string) => { if (warnings.length < 200) warnings.push({ path, code, message }); };

    let bytes = 0;
    try { bytes = JSON.stringify(input)?.length ?? 0; } catch { err(root, "not-json", "El UI no es JSON serializable (referencias circulares o valores no validos)"); return { ok: false, errors, warnings, nodes, depth: 0 }; }
    if (bytes > UI_LIMITS.maxBytes) err(root, "too-large", `El UI pesa ${Math.round(bytes / 1024)} KB; maximo ${Math.round(UI_LIMITS.maxBytes / 1024)} KB`);

    const checkString = (spec: PropSpec, value: string, path: string) => {
        if (value.length > UI_LIMITS.maxString) return err(path, "too-long", `Texto demasiado largo (${value.length}); maximo ${UI_LIMITS.maxString}`);
        if (hasExpression(value)) {
            if (checkExpression) {
                const scan = scanExpressions(value);
                for (const segment of scan.segments) {
                    const problem = checkExpression(segment);
                    if (problem) err(path, "bad-expression", `Expresion invalida \${${segment.length > 60 ? segment.slice(0, 57) + "..." : segment}}: ${problem}`);
                }
                if (scan.unclosed) err(path, "bad-expression", "Expresion sin cerrar: falta `}` para cerrar un `${`");
            }
            return;
        }
        if (spec.k === "text" || spec.k === "string") {
            if (HTML_RE.test(value)) err(path, "html-not-allowed", "HTML no permitido en props: usa MARKDOWN o componentes (el texto se muestra tal cual)");
            else if (/^\s*(?:url|expression|var|calc)\s*\(/i.test(value)) err(path, "css-not-allowed", "Valores CSS (url(), var(), calc()) no permitidos: usa props semanticas");
        }
    };

    // `depth` = profundidad en NODOS (los helpers de valor la propagan sin cambios); `adepth` = anidamiento de acciones.
    const checkAction = (value: unknown, path: string, depth: number, adepth = 0) => {
        if (adepth > 30) return err(path, "too-deep", "Acciones encadenadas demasiado anidadas (max 30 niveles)");
        if (Array.isArray(value)) {
            if (value.length > 50) err(path, "too-many", "Demasiadas acciones encadenadas (max 50)");
            value.forEach((item, index) => checkAction(item, `${path}[${index}]`, depth, adepth + 1));
            return;
        }
        if (!isObject(value)) return err(path, "type", "Debe ser una accion {action: \"...\"} o un arreglo de acciones");
        if (Array.isArray(value.actions)) return checkAction(value.actions, `${path}.actions`, depth, adepth + 1);
        if (typeof value.action !== "string") return err(`${path}.action`, "required", "Falta el nombre de la accion (action)");
        const spec = UI_ACTIONS[value.action];
        if (!spec) {
            const near = suggest(value.action, UI_ACTION_TYPES);
            return err(`${path}.action`, "unknown-action", `Accion desconocida: ${value.action}${near ? ` (¿quisiste decir ${near}?)` : ""}`);
        }
        for (const req of spec.required || []) {
            if (value[req] === undefined) {
                err(`${path}.${req}`, "required", req === "function" ? "CALL_BACKEND requiere `function` (clave de api.functions)" : `${value.action} requiere \`${req}\``);
            }
        }
        for (const key of Object.keys(value)) {
            if (key === "action" || key === "actions") continue;
            if (BLOCKED_KEYS.indexOf(key) !== -1) { err(`${path}.${key}`, "forbidden-prop", `Clave no permitida: ${key}`); continue; }
            const prop = spec.props[key];
            if (!prop) {
                if (key === "onSuccess" || key === "onError") { checkAction(value[key], `${path}.${key}`, depth, adepth + 1); continue; }
                const near = suggest(key, Object.keys(spec.props));
                warn(`${path}.${key}`, "unknown-prop", `${value.action} no usa \`${key}\`${near ? ` (¿quisiste decir ${near}?)` : ""}`);
                continue;
            }
            if (prop.k === "action") { checkAction(value[key], `${path}.${key}`, depth, adepth + 1); continue; }
            checkValue(prop, value[key], `${path}.${key}`, depth);
        }
    };

    const checkNodes = (value: unknown, path: string, depth: number) => {
        if (typeof value === "string") return err(path, "type", "Debe ser un componente {type, props, children} o un arreglo de componentes (no un texto ni una expresion)");
        if (Array.isArray(value)) {
            if (value.length > UI_LIMITS.maxArray) err(path, "too-many", `Demasiados componentes (${value.length}); maximo ${UI_LIMITS.maxArray}`);
            value.forEach((item, index) => checkNode(item, `${path}[${index}]`, depth));
            return;
        }
        checkNode(value, path, depth);
    };

    const checkValue = (spec: PropSpec, value: unknown, path: string, depth: number) => {
        if (value === undefined || value === null) return;
        const isExpr = typeof value === "string" && hasExpression(value);

        switch (spec.k) {
            case "action": return checkAction(value, path, depth);
            case "node": case "nodes": return checkNodes(value, path, depth);
            case "any": {
                if (typeof value === "string") checkString(spec, value, path);
                else scanData(value, path, 0);
                return;
            }
            case "text": case "string": {
                if (typeof value === "string") return checkString(spec, value, path);
                if (typeof value === "number" || typeof value === "boolean") return;
                if (isI18nText(value)) { for (const lang of Object.keys(value)) checkString(spec, value[lang], `${path}.${lang}`); return; }
                return err(path, "type", `Debe ser texto o un objeto por idioma {es, en} (recibido ${Array.isArray(value) ? "arreglo" : typeof value})`);
            }
            case "name": {
                if (typeof value !== "string") return err(path, "type", "Debe ser un nombre (texto)");
                if (isExpr) return checkString(spec, value, path);
                if (!NAME_RE.test(value) || value.split(".").some((part) => BLOCKED_KEYS.indexOf(part) !== -1)) err(path, "bad-name", `Nombre invalido "${value}": usa letras, numeros, _ . - (max 64), empezando por letra o _`);
                return;
            }
            case "number": {
                if (isExpr) return checkString(spec, value as string, path);
                if (typeof value !== "number" || !isFinite(value)) return err(path, "type", `Debe ser un numero (recibido ${typeof value})`);
                if (spec.min !== undefined && value < spec.min) err(path, "range", `Debe ser >= ${spec.min}`);
                if (spec.max !== undefined && value > spec.max) err(path, "range", `Debe ser <= ${spec.max}`);
                return;
            }
            case "boolean": {
                if (isExpr) return checkString(spec, value as string, path);
                if (typeof value !== "boolean") err(path, "type", `Debe ser true o false (recibido ${typeof value})`);
                return;
            }
            case "enum": {
                if (isExpr) return checkString(spec, value as string, path);
                const values = spec.values || [];
                if (values.indexOf(value as any) === -1 && !(typeof value === "string" && values.indexOf(Number(value)) !== -1 && value.trim() !== "")) {
                    const near = typeof value === "string" ? suggest(value, values.map(String)) : null;
                    err(path, "enum", `Valor no permitido ${JSON.stringify(value)}; permitidos: ${values.join(", ")}${near ? ` (¿quisiste decir ${near}?)` : ""}`);
                }
                return;
            }
            case "icon": {
                if (typeof value !== "string") return err(path, "type", "Debe ser el nombre de un icono (texto)");
                if (isExpr) return checkString(spec, value, path);
                if (!ICON_RE.test(value) && !ICON_REF_RE.test(value) && (value.length > 8 || value.indexOf(":") !== -1)) err(path, "bad-icon", `Icono invalido "${value}": usa un nombre Lucide (p. ej. "Mail"), "brand:<slug>", "lucide:<Nombre>" o "initials:<XY>"`);
                return;
            }
            case "url": {
                if (typeof value !== "string") return err(path, "type", "Debe ser una URL (texto)");
                if (isExpr) return checkString(spec, value, path);
                if (value.length > 2048) return err(path, "too-long", "URL demasiado larga");
                if (CSS_FN_RE.test(value) || /^\s*(?:javascript|data|vbscript|file|blob)\s*:/i.test(value)) return err(path, "unsafe-url", "URL no permitida: usa https, http, mailto, tel o una ruta interna que empiece por /");
                if (!/^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(value.trim())) err(path, "bad-url", "URL no valida: debe empezar por https://, http://, mailto:, tel:, / o #");
                return;
            }
            case "color": {
                if (typeof value !== "string") return err(path, "type", "Debe ser un dato hex (texto)");
                if (isExpr) return checkString(spec, value, path);
                if (value !== "" && !HEX_RE.test(value)) err(path, "bad-color", "El valor de un COLOR_PICKER es un dato hex (#rrggbb)");
                return;
            }
            case "regex": {
                if (typeof value !== "string") return err(path, "type", "Debe ser una expresion regular (texto)");
                if (value.length > UI_LIMITS.maxPattern) return err(path, "too-long", `Patron demasiado largo (max ${UI_LIMITS.maxPattern})`);
                if (COSTLY_PATTERN_RE.test(value)) return err(path, "costly-pattern", "Patron potencialmente costoso (cuantificadores anidados): simplificalo");
                try { new RegExp(value); } catch (e: any) { err(path, "bad-pattern", `Patron invalido: ${String(e && e.message || e).replace(/^Invalid regular expression: /, "")}`); }
                return;
            }
            case "array": {
                if (isExpr) return checkString(spec, value as string, path);
                if (!Array.isArray(value)) return err(path, "type", `Debe ser un arreglo (recibido ${typeof value})`);
                if (value.length > UI_LIMITS.maxArray) return err(path, "too-many", `Demasiados elementos (${value.length}); maximo ${UI_LIMITS.maxArray}`);
                if (spec.of) value.forEach((item, index) => checkValue(spec.of as PropSpec, item, `${path}[${index}]`, depth));
                return;
            }
            case "record": {
                if (!isObject(value)) return err(path, "type", "Debe ser un objeto");
                for (const key of Object.keys(value)) {
                    if (BLOCKED_KEYS.indexOf(key) !== -1) { err(`${path}.${key}`, "forbidden-prop", `Clave no permitida: ${key}`); continue; }
                    if (spec.of) checkValue(spec.of, value[key], `${path}.${key}`, depth);
                }
                return;
            }
            case "object": {
                if (isExpr) return checkString(spec, value as string, path);
                if (!isObject(value)) return err(path, "type", `Debe ser un objeto (recibido ${Array.isArray(value) ? "arreglo" : typeof value})`);
                const shape = spec.shape || {};
                for (const key of Object.keys(value)) {
                    if (BLOCKED_KEYS.indexOf(key) !== -1) { err(`${path}.${key}`, "forbidden-prop", `Clave no permitida: ${key}`); continue; }
                    const child = shape[key];
                    if (!child && FORBIDDEN_PROP_KEYS.indexOf(key) !== -1) { err(`${path}.${key}`, "forbidden-prop", `\`${key}\` no esta permitido: ${PROP_HINTS[key] || "las extensiones no eligen estilos"}`); continue; }
                    if (!child) { warn(`${path}.${key}`, "unknown-prop", `Propiedad desconocida \`${key}\`${suggest(key, Object.keys(shape)) ? ` (¿quisiste decir ${suggest(key, Object.keys(shape))}?)` : ""}`); continue; }
                    checkValue(child, value[key], `${path}.${key}`, depth);
                }
                for (const key of Object.keys(shape)) if (shape[key].required && value[key] === undefined) err(`${path}.${key}`, "required", `Falta \`${key}\``);
                return;
            }
        }
    };

    /** Datos libres (items, data...): solo se vigilan claves bloqueadas, tamano y expresiones. */
    const scanData = (value: unknown, path: string, depth: number) => {
        if (depth > UI_LIMITS.maxDepth * 3) return err(path, "too-deep", "Anidamiento demasiado profundo");
        if (typeof value === "string") {
            if (value.length > UI_LIMITS.maxString) err(path, "too-long", `Texto demasiado largo (${value.length})`);
            else if (hasExpression(value) && checkExpression) {
                const scan = scanExpressions(value);
                for (const segment of scan.segments) {
                    const problem = checkExpression(segment);
                    if (problem) err(path, "bad-expression", `Expresion invalida: ${problem}`);
                }
                if (scan.unclosed) err(path, "bad-expression", "Expresion sin cerrar: falta `}` para cerrar un `${`");
            }
            return;
        }
        if (Array.isArray(value)) {
            if (value.length > UI_LIMITS.maxArray) return err(path, "too-many", `Demasiados elementos (${value.length}); maximo ${UI_LIMITS.maxArray}`);
            value.forEach((item, index) => scanData(item, `${path}[${index}]`, depth + 1));
            return;
        }
        if (isObject(value)) {
            const keys = Object.keys(value);
            if (keys.length > UI_LIMITS.maxKeys) return err(path, "too-many", `Demasiadas claves (${keys.length})`);
            for (const key of keys) {
                if (BLOCKED_KEYS.indexOf(key) !== -1) { err(`${path}.${key}`, "forbidden-prop", `Clave no permitida: ${key}`); continue; }
                scanData(value[key], `${path}.${key}`, depth + 1);
            }
        }
    };

    const checkNode = (node: unknown, path: string, depth: number) => {
        if (depth > UI_LIMITS.maxDepth) return err(path, "too-deep", `Anidamiento demasiado profundo (maximo ${UI_LIMITS.maxDepth} niveles de componentes)`);
        if (!isObject(node)) return err(path, "type", `Cada componente debe ser un objeto {type, props, children} (recibido ${Array.isArray(node) ? "arreglo" : node === null ? "null" : typeof node})`);
        nodes++;
        if (depth > maxDepth) maxDepth = depth;
        if (nodes === UI_LIMITS.maxNodes + 1) err(path, "too-many-nodes", `Demasiados componentes (maximo ${UI_LIMITS.maxNodes})`);
        if (nodes > UI_LIMITS.maxNodes) return;

        if (typeof node.type !== "string" || !node.type) return err(`${path}.type`, "required", "Falta `type` (nombre del componente, p. ej. \"STACK\")");
        const spec = UI_COMPONENTS[node.type];
        if (!spec) {
            const near = suggest(node.type, UI_COMPONENT_TYPES);
            return err(`${path}.type`, "unknown-component", `Componente desconocido: ${node.type}${near ? ` (¿quisiste decir ${near}?)` : ""}`);
        }

        for (const key of Object.keys(node)) {
            if (key === "type" || key === "props" || key === "children") continue;
            warn(`${path}.${key}`, "unknown-node-key", `Clave de nodo desconocida \`${key}\`: un componente solo lleva type, props y children`);
        }

        let props: Record<string, any> = {};
        if (node.props !== undefined) {
            if (!isObject(node.props)) err(`${path}.props`, "type", "`props` debe ser un objeto");
            else props = node.props;
        }

        for (const key of Object.keys(props)) {
            const at = `${path}.props.${key}`;
            if (BLOCKED_KEYS.indexOf(key) !== -1) { err(at, "forbidden-prop", `Clave no permitida: ${key}`); continue; }
            if (FORBIDDEN_PROP_KEYS.indexOf(key) !== -1) {
                err(at, "forbidden-prop", `\`${key}\` no esta permitido: ${PROP_HINTS[key] || "las extensiones no eligen estilos; usa props semanticas (tone, variant, size...)"}`);
                continue;
            }
            if (/^on[a-z]/.test(key)) { err(at, "forbidden-prop", `\`${key}\` (evento DOM) no esta permitido: usa onClick/onChange/onSubmit con acciones`); continue; }
            if (key === "children" && Array.isArray(props.children)) {
                // forma heredada: children dentro de props
                if (!spec.children) warn(at, "unknown-prop", `${node.type} no admite hijos`);
                checkNodes(props.children, at, depth + 1);
                continue;
            }
            const prop = spec.props[key] || COMMON_PROPS[key];
            if (!prop) {
                const near = suggest(key, Object.keys(spec.props));
                warn(at, "unknown-prop", `${node.type} no tiene la prop \`${key}\`${PROP_HINTS[key] ? ` (${PROP_HINTS[key]})` : near ? ` (¿quisiste decir ${near}?)` : ""}`);
                continue;
            }
            checkValue(prop, props[key], at, depth + 1);
        }

        for (const key of Object.keys(spec.props)) {
            if (spec.props[key].required && props[key] === undefined) err(`${path}.props.${key}`, "required", `${node.type} requiere \`${key}\``);
        }
        if (node.type === "IMAGE_BUTTON" && props.alt === undefined) warn(`${path}.props.alt`, "a11y", "IMAGE_BUTTON deberia llevar `alt` (texto alternativo)");

        if (node.children !== undefined) {
            if (!Array.isArray(node.children)) err(`${path}.children`, "type", "`children` debe ser un arreglo de componentes");
            else {
                if (!spec.children) warn(`${path}.children`, "unexpected-children", `${node.type} no admite hijos; se ignoraran`);
                checkNodes(node.children, `${path}.children`, depth + 1);
            }
        }
    };

    if (input === undefined || input === null) {
        err(root, "required", "Falta el componente raiz");
    } else {
        checkNode(input, root, 0);
    }
    return { ok: errors.length === 0, errors, warnings, nodes: Math.min(nodes, UI_LIMITS.maxNodes + 1), depth: maxDepth };
}

/** Valida todo el UI de un manifest: mounts[].component, overlays y slashCommands[].action. */
export function validateManifestUi(manifest: unknown, options: UiValidateOptions = {}): UiValidation {
    const errors: UiIssue[] = [];
    const warnings: UiIssue[] = [];
    let nodes = 0;
    let depth = 0;
    if (!isObject(manifest)) return { ok: false, errors: [{ path: "$", code: "type", message: "El manifest debe ser un objeto" }], warnings, nodes, depth };
    const merge = (result: UiValidation) => {
        errors.push(...result.errors);
        warnings.push(...result.warnings);
        nodes += result.nodes;
        depth = Math.max(depth, result.depth);
    };
    if (Array.isArray(manifest.mounts)) {
        manifest.mounts.forEach((mount: any, index: number) => {
            if (isObject(mount) && isObject(mount.component)) merge(validateUi(mount.component, { ...options, root: `mounts[${index}].component` }));
        });
    }
    if (isObject(manifest.overlays)) {
        for (const id of Object.keys(manifest.overlays)) merge(validateUi(manifest.overlays[id], { ...options, root: `overlays.${id}` }));
    }
    if (Array.isArray(manifest.slashCommands)) {
        // Las acciones de slashCommands no son nodos: se validan como el onClick de un BUTTON sintetico y se reescribe la ruta.
        const prefix = "$cmd.props.onClick";
        manifest.slashCommands.forEach((cmd: any, index: number) => {
            if (!isObject(cmd) || cmd.action === undefined) return;
            const at = `slashCommands[${index}].action`;
            const probe = validateUi({ type: "BUTTON", props: { label: "/", onClick: cmd.action } }, { ...options, root: "$cmd" });
            for (const issue of probe.errors) if (issue.path.startsWith(prefix)) errors.push({ ...issue, path: at + issue.path.slice(prefix.length) });
            for (const issue of probe.warnings) if (issue.path.startsWith(prefix)) warnings.push({ ...issue, path: at + issue.path.slice(prefix.length) });
        });
    }
    return { ok: errors.length === 0, errors, warnings, nodes, depth };
}

/** Texto legible de los problemas (logs, CLI, respuestas 400). */
export function formatUiIssues(issues: UiIssue[], max = 10): string {
    return issues.slice(0, max).map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}

// ---------------------------------------------------------------------------------------------------------------
// Saneado en tiempo de ejecucion (props YA resueltas)
// ---------------------------------------------------------------------------------------------------------------

function coerceValue(spec: PropSpec, value: unknown): { value: unknown; drop?: boolean; note?: string } {
    if (value === undefined || value === null) return { value: undefined, drop: true };
    switch (spec.k) {
        case "enum": {
            const values = spec.values || [];
            if (values.indexOf(value as any) !== -1) return { value };
            const asNumber = typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
            if (!isNaN(asNumber) && values.indexOf(asNumber) !== -1) return { value: asNumber };
            return { value: spec.def, drop: spec.def === undefined, note: `valor no permitido ${JSON.stringify(value)}; ${spec.def === undefined ? "se ignora" : `se usa ${JSON.stringify(spec.def)}`}` };
        }
        case "number": {
            const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
            if (!isFinite(n)) return { value: spec.def, drop: spec.def === undefined, note: "no es un numero" };
            let out = n;
            if (spec.min !== undefined && out < spec.min) out = spec.min;
            if (spec.max !== undefined && out > spec.max) out = spec.max;
            return { value: out };
        }
        case "boolean": {
            if (typeof value === "boolean") return { value };
            if (value === "true" || value === 1) return { value: true };
            if (value === "false" || value === 0 || value === "") return { value: false };
            return { value: Boolean(value) };
        }
        case "text": case "string": {
            if (typeof value === "string") return { value: value.length > UI_LIMITS.maxString ? value.slice(0, UI_LIMITS.maxString) : value };
            if (typeof value === "number" || typeof value === "boolean") return { value: String(value) };
            return { value: undefined, drop: true, note: "debe ser texto" };
        }
        case "name": return typeof value === "string" && NAME_RE.test(value) ? { value } : { value: undefined, drop: true, note: "nombre invalido" };
        case "icon": return typeof value === "string" ? { value: value.slice(0, 40) } : { value: undefined, drop: true };
        case "color": return typeof value === "string" && (value === "" || HEX_RE.test(value)) ? { value } : { value: undefined, drop: true, note: "hex invalido" };
        case "array": return Array.isArray(value) ? { value: value.length > UI_LIMITS.maxArray ? value.slice(0, UI_LIMITS.maxArray) : value } : { value: undefined, drop: true, note: "debe ser un arreglo" };
        default: return { value };
    }
}

/**
 * Sanea props ya resueltas (tras evaluar `${...}`): claves prohibidas fuera, enums/numeros/booleanos coaccionados
 * al dominio permitido y valores por defecto aplicados. Las props de slot/accion pasan intactas (las resuelve el renderer).
 * `onIssue` recibe un aviso legible por cada valor corregido (no lanza nunca).
 */
export function coerceProps(type: string, props: unknown, onIssue?: (path: string, message: string) => void): Record<string, any> {
    const out: Record<string, any> = {};
    if (!isObject(props)) return out;
    const spec = UI_COMPONENTS[type];
    for (const key of Object.keys(props)) {
        if (BLOCKED_KEYS.indexOf(key) !== -1) continue;
        if (FORBIDDEN_PROP_KEYS.indexOf(key) !== -1) { if (onIssue) onIssue(key, `\`${key}\` ignorado: las extensiones no eligen estilos`); continue; }
        if (/^on[a-z]/.test(key)) { if (onIssue) onIssue(key, `\`${key}\` ignorado: evento DOM no permitido`); continue; }
        const propSpec = spec ? (spec.props[key] || COMMON_PROPS[key]) : undefined;
        if (!propSpec) { out[key] = props[key]; continue; }
        if (propSpec.k === "action" || propSpec.k === "node" || propSpec.k === "nodes") { out[key] = props[key]; continue; }
        const result = coerceValue(propSpec, props[key]);
        if (result.note && onIssue) onIssue(key, result.note);
        if (!result.drop) out[key] = result.value;
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Adaptador del formato antiguo
// ---------------------------------------------------------------------------------------------------------------

export type MigrationResult<T> = { ui: T; notices: UiIssue[] };

const LEGACY_RENAMES: Record<string, string> = {
    COLUMN: "STACK", SEPARATOR: "DIVIDER", EMPTY_STATE: "EMPTY", DATA_TABLE: "TABLE", CODE_BLOCK: "CODE", FILE_UPLOAD: "FILE_INPUT", CODE_EDITOR: "TEXTAREA", BLOCK: "STACK", FLEX: "ROW", BOX: "STACK",
};

function nearestGap(n: number): number {
    let best = 0;
    let bestDiff = Infinity;
    for (const g of GAPS) {
        const diff = Math.abs(g - n);
        if (diff < bestDiff) { best = g; bestDiff = diff; }
    }
    return best;
}

function legacyTone(value: unknown): string {
    switch (String(value)) {
        case "primary": case "default": return "primary";
        case "success": return "success";
        case "warning": return "warning";
        case "error": case "destructive": case "danger": return "danger";
        case "info": return "info";
        default: return "neutral";
    }
}

function gapFromPx(px: unknown): number {
    const n = Number(px);
    return isFinite(n) ? nearestGap(n / 4) : 2;
}

const STYLE_KEYS = FORBIDDEN_PROP_KEYS;

/** Convierte UN nodo (sin recorrer hijos) y devuelve el nodo nuevo. */
/**
 * `legacy` = el documento contiene alguna forma heredada (se decide en migrateDocument). Solo entonces se aplican los valores por
 * defecto del formato antiguo que difieren de los del kit nuevo (BUTTON a todo el ancho, LIST en 2 columnas, SPACER en px): un UI
 * ya escrito con el kit nuevo pasa INTACTO.
 */
function migrateNode(node: Record<string, any>, path: string, notices: UiIssue[], legacy: boolean): Record<string, any> {
    const note = (code: string, message: string, at = path) => { notices.push({ path: at, code, message }); };
    const originalType = String(node.type);
    let type = originalType;
    const props: Record<string, any> = isObject(node.props) ? { ...node.props } : {};
    let children: any[] | undefined = Array.isArray(node.children) ? node.children : undefined;

    if (Array.isArray(props.children)) {
        if (!children) children = props.children;
        delete props.children;
        if (originalType === "MODAL" || originalType === "CARD") { /* forma muy usada en los manifests; sin aviso */ } else note("deprecated", "`props.children` es obsoleto: usa `children` en el nodo");
    }

    const className = typeof props.className === "string" ? props.className : "";
    const stripped: string[] = [];
    for (const key of STYLE_KEYS) {
        if (key in props) { stripped.push(key); delete props[key]; }
    }
    for (const key of Object.keys(props)) {
        if (/^on[a-z]/.test(key)) { stripped.push(key); delete props[key]; }
    }
    if (stripped.length) note("style-removed", `${stripped.join(", ")} eliminado${stripped.length > 1 ? "s" : ""}: las extensiones no eligen estilos; usa tone, variant, size, gap...`, `${path}.props`);

    if (originalType === "IFRAME") {
        note("unsupported", "IFRAME ya no esta soportado (el HTML en props esta prohibido): usa MARKDOWN o componentes", `${path}.type`);
        return { type: "ALERT", props: { tone: "warning", message: "Este contenido (IFRAME) ya no esta soportado." } };
    }
    const renamed = LEGACY_RENAMES[originalType];
    if (renamed) { type = renamed; note("deprecated", `${originalType} esta obsoleto: usa ${renamed}`, `${path}.type`); }

    if (props.bindTo !== undefined) {
        if (props.bind === undefined) props.bind = props.bindTo;
        delete props.bindTo;
        note("deprecated", "`bindTo` esta obsoleto: usa `bind`", `${path}.props.bindTo`);
    }

    switch (type) {
        case "BUTTON": {
            const v = props.variant === undefined ? "" : String(props.variant);
            let legacyButton = className !== "";
            if (v && BUTTON_VARIANTS.indexOf(v as any) === -1) {
                legacyButton = true;
                delete props.variant;
                if (v === "primary" || v === "default") { props.variant = "solid"; props.tone = props.tone ?? "primary"; }
                else if (v === "secondary") { props.variant = "soft"; props.tone = props.tone ?? "neutral"; }
                else if (v === "destructive" || v === "error" || v === "danger") { props.variant = "solid"; props.tone = "danger"; }
                else { props.variant = "solid"; props.tone = props.tone ?? "primary"; }
                note("deprecated", `BUTTON variant "${v}" esta obsoleto: usa tone + variant (solid|soft|outline|ghost|link)`, `${path}.props.variant`);
            }
            // Antes el boton ocupaba todo el ancho salvo que className dijera otra cosa (solo en documentos heredados).
            if (props.fullWidth === undefined && (legacy || legacyButton)) props.fullWidth = className === "" ? true : /(^|\s)w-full(\s|$)/.test(className);
            if (/justify-start|text-left/.test(className) && props.align === undefined) props.align = "start";
            if (props.size !== undefined && ["default", "icon"].indexOf(String(props.size)) !== -1) props.size = "md";
            if (Array.isArray(props.menuOptions) && props.menuOptions.length > 0) {
                type = "MENU";
                props.items = props.menuOptions;
                delete props.menuOptions;
                delete props.onClick;
                delete props.fullWidth;
                delete props.align;
                if (props.variant === "solid" && props.tone === "primary") { props.variant = "outline"; delete props.tone; }
                note("deprecated", "BUTTON con `menuOptions` esta obsoleto: usa MENU con `items`", `${path}.props.menuOptions`);
            } else if (props.menuOptions !== undefined) delete props.menuOptions;
            break;
        }
        case "TEXT": {
            const variant = String(props.variant ?? "");
            delete props.variant;
            if (variant === "h4") {
                type = "HEADING"; props.level = 4; props.size = "md";
                note("deprecated", "TEXT variant \"h4\" esta obsoleto: usa HEADING", `${path}.props.variant`);
            } else if (variant === "error" || variant === "success") {
                type = "ALERT"; props.tone = variant === "error" ? "danger" : "success"; props.message = props.content; delete props.content;
                note("deprecated", `TEXT variant "${variant}" esta obsoleto: usa ALERT con tone`, `${path}.props.variant`);
            } else if (variant === "body") {
                props.variant = "quote";
                note("deprecated", "TEXT variant \"body\" esta obsoleto: usa variant \"quote\"", `${path}.props.variant`);
            } else if (variant === "muted" || /text-(gray|slate|zinc|neutral)-[3-6]00|text-muted-foreground/.test(className)) {
                props.variant = "muted";
            } else if (["default", "caption", "label", "quote"].indexOf(variant) !== -1) props.variant = variant;
            if (type === "TEXT" && props.tone === undefined && /(^|\s)(?:text-(?:red|rose)-\d+|text-destructive)(\s|$)/.test(className)) props.tone = "danger";
            break;
        }
        case "ROW": {
            const match = /(?:^|\s)gap-(\d+)(?:\s|$)/.exec(className);
            if (originalType === "ROW" && match && props.gap === undefined) props.gap = nearestGap(Number(match[1]));
            if (originalType === "FLEX") {
                const direction = String(props.direction ?? "row");
                if (direction === "column" || direction === "column-reverse") type = "STACK";
                const a: Record<string, string> = { "flex-start": "start", start: "start", center: "center", "flex-end": "end", end: "end", stretch: "stretch", baseline: "baseline" };
                const j: Record<string, string> = { "flex-start": "start", start: "start", center: "center", "flex-end": "end", end: "end", "space-between": "between", between: "between", "space-around": "around", around: "around" };
                if (props.align !== undefined) props.align = a[String(props.align)] ?? "stretch";
                if (props.justify !== undefined) props.justify = j[String(props.justify)] ?? "start";
                if (props.gap !== undefined) props.gap = gapFromPx(props.gap);
                delete props.direction;
            }
            break;
        }
        case "STACK": {
            if (originalType === "BOX") {
                if (props.p !== undefined) props.padding = nearestGap(Number(props.p));
                delete props.p; delete props.m; delete props.bg; delete props.rounded; delete props.shadow; delete props.border;
            }
            if (originalType === "COLUMN" && props.gap === undefined) props.gap = 2;
            if ((originalType === "BLOCK" || originalType === "BOX") && props.gap === undefined) props.gap = 0;
            break;
        }
        case "GRID": {
            const columns = Number(props.columns);
            if (isFinite(columns)) props.columns = Math.max(1, Math.min(6, Math.round(columns)));
            if (typeof props.gap === "number") props.gap = nearestGap(props.gap);
            if (props.maxHeight !== undefined && ["sm", "md", "lg", "xl"].indexOf(String(props.maxHeight)) === -1 && !(typeof props.maxHeight === "string" && hasExpression(props.maxHeight))) {
                const px = parseInt(String(props.maxHeight), 10);
                props.maxHeight = !isFinite(px) ? "md" : px <= 160 ? "sm" : px <= 260 ? "md" : px <= 400 ? "lg" : "xl";
            }
            break;
        }
        case "SPACER": {
            const raw = props.size;
            const px = typeof raw === "number" ? raw : typeof raw === "string" && /^d+(?:.d+)?(?:px)?$/.test(raw.trim()) ? parseFloat(raw) : NaN;
            // Las expresiones y los valores de la escala nueva se respetan; en px solo si el documento es heredado o el valor no esta en la escala.
            if (isFinite(px) && (legacy || GAPS.indexOf(px as any) === -1)) {
                props.size = nearestGap(px / 4);
                note("deprecated", "SPACER `size` en pixeles esta obsoleto: usa la escala (0-12, unidades de 4px)", `${path}.props.size`);
            }
            break;
        }
        case "DIVIDER": break;
        case "INPUT": {
            if (props.multiline === true) {
                type = "TEXTAREA"; delete props.multiline;
                note("deprecated", "INPUT con `multiline` esta obsoleto: usa TEXTAREA", `${path}.props.multiline`);
            }
            break;
        }
        case "TEXTAREA": {
            if (originalType === "CODE_EDITOR") props.mono = true;
            break;
        }
        case "ALERT": {
            if (props.variant !== undefined) {
                props.tone = legacyTone(props.variant); delete props.variant;
                note("deprecated", "ALERT `variant` esta obsoleto: usa `tone` (info|success|warning|danger)", `${path}.props.variant`);
            }
            if (props.description !== undefined && props.message === undefined) { props.message = props.description; delete props.description; }
            break;
        }
        case "BADGE": {
            if (props.variant !== undefined && SURFACE_VARIANTS.indexOf(props.variant) === -1) {
                const legacy = String(props.variant);
                delete props.variant;
                if (legacy === "outline") { props.tone = "neutral"; props.variant = "outline"; }
                else if (legacy === "secondary") { props.tone = "neutral"; props.variant = "solid"; }
                else { props.tone = legacyTone(legacy); props.variant = "soft"; }
                note("deprecated", `BADGE variant "${legacy}" esta obsoleto: usa tone + variant (solid|soft|outline)`, `${path}.props.variant`);
            }
            break;
        }
        case "AVATAR": {
            if (typeof props.size === "number") {
                const px = props.size;
                props.size = px <= 20 ? "xs" : px <= 28 ? "sm" : px <= 40 ? "md" : px <= 56 ? "lg" : "xl";
            }
            break;
        }
        case "ICON": {
            if (typeof props.size === "number") props.size = props.size <= 12 ? "xs" : props.size <= 16 ? "sm" : props.size <= 22 ? "md" : props.size <= 28 ? "lg" : "xl";
            break;
        }
        case "EMPTY": {
            if (originalType === "EMPTY_STATE" && typeof props.icon === "string" && props.icon.length <= 4) { delete props.icon; }
            break;
        }
        case "TABLE": {
            if (props.actions !== undefined) { /* `actions` ya es el nombre de la prop */ }
            break;
        }
        case "CODE": {
            if (originalType === "CODE_BLOCK") { props.block = true; if (props.code !== undefined && props.content === undefined) props.content = props.code; delete props.code; }
            break;
        }
        case "LIST": {
            if (legacy && props.columns === undefined && props.itemTemplate !== undefined) { props.columns = 2; if (props.maxHeight === undefined) props.maxHeight = "md"; }
            break;
        }
        case "WIZARD": {
            // Antes la navegacion siempre era manual (NEXT_STEP/PREV_STEP en el contenido): se fija en documentos heredados o si el
            // contenido usa esas acciones; un WIZARD del kit nuevo sin `nav` conserva su valor por defecto (auto).
            if (props.nav === undefined) {
                let usesManualNav = false;
                try { usesManualNav = /"(?:NEXT_STEP|PREV_STEP)"/.test(JSON.stringify(props.steps) || ""); } catch { usesManualNav = false; }
                if (legacy || usesManualNav) props.nav = "manual";
            }
            break;
        }
        case "TABS": {
            if (!Array.isArray(props.tabs) && children) {
                const tabs: any[] = [];
                const rest: any[] = [];
                for (const child of children) {
                    if (isObject(child) && child.type === "TAB_ITEM") {
                        const cp = isObject(child.props) ? child.props : {};
                        tabs.push({ label: cp.label, value: cp.value ?? cp.label, content: Array.isArray(child.children) ? child.children : Array.isArray(cp.children) ? cp.children : [] });
                    } else rest.push(child);
                }
                if (tabs.length) { props.tabs = tabs; children = rest.length ? rest : undefined; note("deprecated", "TABS con hijos TAB_ITEM esta obsoleto: usa `tabs` con `content`", path); }
            }
            break;
        }
        case "ACCORDION": {
            if (!Array.isArray(props.sections) && children) {
                const sections: any[] = [];
                const rest: any[] = [];
                for (const child of children) {
                    if (isObject(child) && child.type === "ACCORDION_ITEM") {
                        const cp = isObject(child.props) ? child.props : {};
                        sections.push({ title: cp.title, content: Array.isArray(child.children) ? child.children : Array.isArray(cp.children) ? cp.children : [] });
                    } else rest.push(child);
                }
                if (sections.length) { props.sections = sections; children = rest.length ? rest : undefined; note("deprecated", "ACCORDION con hijos ACCORDION_ITEM esta obsoleto: usa `sections`", path); }
            }
            break;
        }
        case "MODAL": {
            if (props.width !== undefined && WIDTHS.indexOf(props.width) === -1 && !(typeof props.width === "string" && hasExpression(props.width))) {
                const px = parseInt(String(props.width), 10);
                props.width = !isFinite(px) ? "md" : px <= 460 ? "sm" : px <= 620 ? "md" : px <= 800 ? "lg" : px <= 1000 ? "xl" : "full";
                note("deprecated", "MODAL `width` en pixeles esta obsoleto: usa sm|md|lg|xl|full", `${path}.props.width`);
            }
            break;
        }
        default: break;
    }

    const out: Record<string, any> = { type };
    if (Object.keys(props).length > 0 || node.props !== undefined) out.props = props;
    if (children) out.children = children;
    return out;
}

const SLOT_KEYS = ["true", "false", "else", "template", "itemTemplate", "empty", "default", "trigger", "footer", "content"];

function migrateTree(value: any, path: string, notices: UiIssue[], depth: number, legacy: boolean): any {
    if (depth > 80) return value;
    if (Array.isArray(value)) return value.map((item, index) => migrateTree(item, `${path}[${index}]`, notices, depth + 1, legacy));
    if (!isObject(value)) return value;

    const isComponent = typeof value.type === "string" && /^[A-Z][A-Z0-9_]*$/.test(value.type) && ("props" in value || "children" in value || value.type in UI_COMPONENTS || value.type in LEGACY_RENAMES);
    if (!isComponent) {
        const out: Record<string, any> = {};
        for (const key of Object.keys(value)) {
            if (BLOCKED_KEYS.indexOf(key) !== -1) continue;
            out[key] = migrateTree(value[key], `${path}.${key}`, notices, depth + 1, legacy);
        }
        return out;
    }

    const migrated = migrateNode(value, path, notices, legacy);
    if (Array.isArray(migrated.children)) migrated.children = migrated.children.map((child: any, index: number) => migrateTree(child, `${path}.children[${index}]`, notices, depth + 1, legacy));
    if (isObject(migrated.props)) {
        const nextProps: Record<string, any> = {};
        for (const key of Object.keys(migrated.props)) {
            const prop = migrated.props[key];
            if (prop !== null && typeof prop === "object") nextProps[key] = migrateTree(prop, `${path}.props.${key}`, notices, depth + 1, legacy);
            else nextProps[key] = prop;
        }
        migrated.props = nextProps;
    }
    void SLOT_KEYS;
    return migrated;
}

/** Migra un documento: una pasada de sondeo decide si es heredado (algun aviso) y la definitiva aplica los valores por defecto antiguos solo entonces. */
function migrateDocument(value: any, path: string, notices: UiIssue[]): any {
    const probe: UiIssue[] = [];
    migrateTree(value, path, probe, 0, false);
    return migrateTree(value, path, notices, 0, probe.length > 0);
}

/**
 * Adapta un UI JSON del formato antiguo al kit: renombra componentes (COLUMN -> STACK, DATA_TABLE -> TABLE...),
 * traduce `variant`/`bindTo`, mueve `props.children`, y ELIMINA className/style/color... con un aviso.
 * Es idempotente y no modifica la entrada. `notices` son avisos de obsolescencia (no errores).
 */
export function migrateLegacyUi<T = any>(ui: T): MigrationResult<T> {
    const notices: UiIssue[] = [];
    const out = migrateDocument(ui, "ui", notices) as T;
    return { ui: out, notices };
}

/** Forma heredada `component: "MODAL"` + `props` a nivel de mount (mail-groups, signature, sealer). */
function normalizeLegacyMountComponent(mount: Record<string, any>): Record<string, any> {
    if (typeof mount.component !== "string") return mount;
    const mountProps = isObject(mount.props) ? { ...mount.props } : {};
    const children = Array.isArray(mountProps.children) ? mountProps.children : undefined;
    delete mountProps.children;
    const { props: _omit, ...rest } = mount;
    return { ...rest, component: { type: mount.component, props: mountProps, ...(children ? { children } : {}) } };
}

/** Migra mounts[].component, overlays y acciones de slashCommands de un manifest. Devuelve una copia. */
export function migrateManifestUi<T = any>(manifest: T): MigrationResult<T> {
    const notices: UiIssue[] = [];
    if (!isObject(manifest)) return { ui: manifest, notices };
    const out: Record<string, any> = { ...manifest };
    if (Array.isArray(out.mounts)) {
        out.mounts = out.mounts.map((raw: any, index: number) => {
            if (!isObject(raw)) return raw;
            const mount = normalizeLegacyMountComponent(raw);
            if (!isObject(mount.component)) return mount;
            const local: UiIssue[] = [];
            const component = migrateDocument(mount.component, `mounts[${index}].component`, local);
            notices.push(...local);
            return { ...mount, component };
        });
    }
    if (isObject(out.overlays)) {
        const overlays: Record<string, any> = {};
        for (const id of Object.keys(out.overlays)) {
            const raw = out.overlays[id];
            const normalized = isObject(raw) && typeof raw.component === "string" ? normalizeLegacyMountComponent({ component: raw.component, props: raw.props }).component : raw;
            overlays[id] = migrateDocument(normalized, `overlays.${id}`, notices);
        }
        out.overlays = overlays;
    }
    return { ui: out as T, notices };
}
