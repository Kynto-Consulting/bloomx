/**
 * liquid-catalog.ts — catalogo de filtros, tags y variables de sistema para el editor (autocompletado y ayuda).
 * Es solo datos (sin CodeMirror) para poder verificar con vitest que coincide con el motor (`liquid.ts`).
 */

export interface FilterDoc {
    /** Nombre real del filtro en el motor. */
    name: string;
    /** Texto que se inserta (con argumentos de ejemplo). */
    apply: string;
    detail: string;
    boost?: number;
}

export const FILTER_CATALOG: FilterDoc[] = [
    // Texto
    { name: 'upcase', apply: 'upcase', detail: 'MAYÚSCULAS', boost: 10 },
    { name: 'downcase', apply: 'downcase', detail: 'minúsculas', boost: 10 },
    { name: 'capitalize', apply: 'capitalize', detail: 'Primera en mayúscula, resto en minúscula', boost: 10 },
    { name: 'strip', apply: 'strip', detail: 'Quita espacios de los extremos' },
    { name: 'lstrip', apply: 'lstrip', detail: 'Quita espacios a la izquierda' },
    { name: 'rstrip', apply: 'rstrip', detail: 'Quita espacios a la derecha' },
    { name: 'strip_html', apply: 'strip_html', detail: 'Quita etiquetas HTML' },
    { name: 'strip_newlines', apply: 'strip_newlines', detail: 'Quita saltos de línea' },
    { name: 'newline_to_br', apply: 'newline_to_br', detail: 'Saltos de línea → <br>' },
    { name: 'escape', apply: 'escape', detail: 'Escapa HTML' },
    { name: 'escape_once', apply: 'escape_once', detail: 'Escapa HTML sin doble escape' },
    { name: 'raw', apply: 'raw', detail: 'No escapar (autoescape): solo HTML de confianza', boost: 6 },
    { name: 'url_encode', apply: 'url_encode', detail: 'Codifica para URL' },
    { name: 'url_decode', apply: 'url_decode', detail: 'Decodifica de URL' },
    { name: 'base64_encode', apply: 'base64_encode', detail: 'Base64' },
    { name: 'base64_decode', apply: 'base64_decode', detail: 'Decodifica Base64' },
    { name: 'base64_url_safe_encode', apply: 'base64_url_safe_encode', detail: 'Base64 seguro para URL' },
    { name: 'base64_url_safe_decode', apply: 'base64_url_safe_decode', detail: 'Decodifica Base64 seguro para URL' },
    { name: 'truncate', apply: 'truncate: 50', detail: 'Corta a N caracteres', boost: 6 },
    { name: 'truncatewords', apply: 'truncatewords: 10', detail: 'Corta a N palabras' },
    { name: 'replace', apply: 'replace: "viejo", "nuevo"', detail: 'Reemplaza todas las apariciones' },
    { name: 'replace_first', apply: 'replace_first: "viejo", "nuevo"', detail: 'Reemplaza la primera' },
    { name: 'replace_last', apply: 'replace_last: "viejo", "nuevo"', detail: 'Reemplaza la última' },
    { name: 'remove', apply: 'remove: "texto"', detail: 'Elimina todas las apariciones' },
    { name: 'remove_first', apply: 'remove_first: "texto"', detail: 'Elimina la primera' },
    { name: 'remove_last', apply: 'remove_last: "texto"', detail: 'Elimina la última' },
    { name: 'prepend', apply: 'prepend: ""', detail: 'Añade al inicio', boost: 5 },
    { name: 'append', apply: 'append: ""', detail: 'Añade al final', boost: 5 },
    { name: 'default', apply: 'default: ""', detail: 'Valor alternativo si está vacío', boost: 20 },
    { name: 'json', apply: 'json', detail: 'Serializa a JSON' },
    // Numeros
    { name: 'abs', apply: 'abs', detail: 'Valor absoluto' },
    { name: 'ceil', apply: 'ceil', detail: 'Redondea hacia arriba' },
    { name: 'floor', apply: 'floor', detail: 'Redondea hacia abajo' },
    { name: 'round', apply: 'round: 2', detail: 'Redondea a N decimales' },
    { name: 'fixed', apply: 'fixed: 2', detail: 'Siempre N decimales: 3.10 (no estándar)' },
    { name: 'at_least', apply: 'at_least: 0', detail: 'Mínimo' },
    { name: 'at_most', apply: 'at_most: 100', detail: 'Máximo' },
    { name: 'plus', apply: 'plus: 1', detail: 'Suma' },
    { name: 'minus', apply: 'minus: 1', detail: 'Resta' },
    { name: 'times', apply: 'times: 2', detail: 'Multiplica' },
    { name: 'divided_by', apply: 'divided_by: 2', detail: 'Divide (entera si ambos son enteros)' },
    { name: 'modulo', apply: 'modulo: 2', detail: 'Resto' },
    // Fechas
    { name: 'date', apply: 'date: "%d/%m/%Y"', detail: '15/01/2024 · sin desfase para YYYY-MM-DD', boost: 8 },
    // Listas
    { name: 'size', apply: 'size', detail: 'Largo (texto o lista)' },
    { name: 'first', apply: 'first', detail: 'Primer elemento/carácter' },
    { name: 'last', apply: 'last', detail: 'Último elemento/carácter' },
    { name: 'reverse', apply: 'reverse', detail: 'Invierte' },
    { name: 'split', apply: 'split: ","', detail: 'Texto → lista', boost: 12 },
    { name: 'join', apply: 'join: ", "', detail: 'Lista → texto', boost: 10 },
    { name: 'sort', apply: 'sort', detail: 'Ordena' },
    { name: 'sort_natural', apply: 'sort_natural', detail: 'Ordena sin distinguir mayúsculas' },
    { name: 'uniq', apply: 'uniq', detail: 'Quita duplicados' },
    { name: 'compact', apply: 'compact', detail: 'Quita vacíos' },
    { name: 'flatten', apply: 'flatten', detail: 'Aplana listas anidadas' },
    { name: 'sum', apply: 'sum', detail: 'Suma numérica' },
    { name: 'min', apply: 'min', detail: 'Mínimo de la lista' },
    { name: 'max', apply: 'max', detail: 'Máximo de la lista' },
    { name: 'concat', apply: 'concat: otra_lista', detail: 'Une listas' },
    { name: 'push', apply: 'push: "x"', detail: 'Añade un elemento (no estándar)' },
    { name: 'map', apply: 'map: "propiedad"', detail: 'Extrae una propiedad de cada objeto' },
    { name: 'where', apply: 'where: "propiedad", "valor"', detail: 'Filtra objetos' },
    { name: 'reject', apply: 'reject: "propiedad", "valor"', detail: 'Excluye objetos' },
    { name: 'slice', apply: 'slice: 0, 5', detail: 'Subcadena/sublista' },
];

export interface TagDoc {
    label: string;
    detail: string;
    /** Plantilla con marcadores `#{nombre}` (sintaxis de `snippet` de CodeMirror). */
    snippet: string;
    boost?: number;
    info?: string;
}

export const TAG_CATALOG: TagDoc[] = [
    { label: 'if', detail: '{% if %}…{% endif %}', boost: 20, snippet: '{% if #{condition} %}\n  #{}\n{% endif %}', info: 'Bloque condicional' },
    { label: 'if/else', detail: '{% if %}…{% else %}…{% endif %}', boost: 18, snippet: '{% if #{condition} %}\n  #{si}\n{% else %}\n  #{no}\n{% endif %}' },
    { label: 'if/elsif', detail: '{% if %}…{% elsif %}…{% endif %}', boost: 15, snippet: '{% if #{cond1} %}\n  #{}\n{% elsif #{cond2} %}\n  #{}\n{% else %}\n  #{}\n{% endif %}' },
    { label: 'unless', detail: '{% unless %}…{% endunless %}', boost: 12, snippet: '{% unless #{condition} %}\n  #{}\n{% endunless %}' },
    { label: 'for', detail: '{% for item in lista %}', boost: 17, snippet: '{% for #{item} in #{lista} %}\n  {{ #{item} }}\n{% endfor %}', info: 'Recorre una lista. Use split para crear listas desde texto.' },
    { label: 'for/else', detail: '{% for %}…{% else %}…{% endfor %}', boost: 14, snippet: '{% for #{item} in #{lista} %}\n  {{ #{item} }}\n{% else %}\n  #{vacio}\n{% endfor %}' },
    { label: 'for (rango)', detail: '{% for i in (1..N) %}', boost: 13, snippet: '{% for #{i} in (#{1}..#{10}) %}\n  {{ #{i} }}\n{% endfor %}' },
    { label: 'for (limit/offset)', detail: '{% for … limit: N offset: M %}', boost: 11, snippet: '{% for #{item} in #{lista} limit: #{5} offset: #{0} %}\n  {{ #{item} }}\n{% endfor %}' },
    { label: 'case/when', detail: '{% case %}{% when %}…{% endcase %}', boost: 16, snippet: '{% case #{variable} %}\n{% when "#{valor1}" %}\n  #{}\n{% when "#{valor2}", "#{valor3}" %}\n  #{}\n{% else %}\n  #{}\n{% endcase %}', info: 'Condicional tipo switch' },
    { label: 'assign', detail: '{% assign var = valor %}', boost: 10, snippet: '{% assign #{nombre} = #{valor} %}' },
    { label: 'assign (split)', detail: '{% assign lista = campo | split: "," %}', boost: 9, snippet: '{% assign #{lista} = #{campo} | split: "#{,}" %}' },
    { label: 'capture', detail: '{% capture %}…{% endcapture %}', snippet: '{% capture #{nombre} %}\n  #{}\n{% endcapture %}' },
    { label: 'echo', detail: '{% echo valor | filtro %}', snippet: '{% echo #{valor} %}' },
    { label: 'cycle', detail: '{% cycle "a", "b" %}', snippet: '{% cycle "#{impar}", "#{par}" %}', info: 'Alterna valores en cada llamada (típico dentro de un for).' },
    { label: 'increment', detail: '{% increment contador %}', snippet: '{% increment #{contador} %}', info: 'Imprime el contador (desde 0) y lo incrementa.' },
    { label: 'decrement', detail: '{% decrement contador %}', snippet: '{% decrement #{contador} %}' },
    { label: 'comment', detail: '{% comment %}…{% endcomment %}', snippet: '{%- comment -%}\n  #{}\n{%- endcomment -%}' },
    { label: 'raw', detail: '{% raw %}…{% endraw %} (no interpretar Liquid)', snippet: '{% raw %}\n  #{}\n{% endraw %}' },
    { label: 'break', detail: '{% break %} — sale del for', snippet: '{% break %}' },
    { label: 'continue', detail: '{% continue %} — siguiente iteración', snippet: '{% continue %}' },
];

export interface SystemVarDoc { name: string; detail: string }

/** Variables que el sistema inyecta en cada fila (las de fecha y `unsubscribe_url` las calcula el servidor). */
export const SYSTEM_VARIABLES: SystemVarDoc[] = [
    { name: 'brand_name', detail: 'Nombre de la marca' },
    { name: 'brand_color', detail: 'Color primario' },
    { name: 'brand_logo', detail: 'URL del logo' },
    { name: 'current_date', detail: 'Fecha de hoy (15 de enero de 2025)' },
    { name: 'current_day', detail: 'Día de la semana' },
    { name: 'current_month', detail: 'Mes actual' },
    { name: 'current_year', detail: 'Año actual' },
    { name: 'unsubscribe_url', detail: 'Enlace de baja firmado (por destinatario)' },
    { name: 'now', detail: 'Ahora; úselo con | date: "…"' },
    { name: 'today', detail: 'Hoy; úselo con | date: "…"' },
];

export const FORLOOP_PROPS = ['index', 'index0', 'rindex', 'rindex0', 'first', 'last', 'length', 'parentloop'];

export const CONDITION_OPERATORS = ['==', '!=', '>', '<', '>=', '<=', 'contains', 'and', 'or'];

/** Variables que existen sin estar en los datos (no advertir en el lint). */
export const BUILTIN_VARIABLE_NAMES = SYSTEM_VARIABLES.map(v => v.name);

/** Expresion segura para referenciar una columna en Liquid (usa row["…"] si tiene simbolos). */
export function variableExpression(name: string): string {
    return /^[\p{L}\p{N}_][\p{L}\p{N}_ -]*$/u.test(name) && !/\s(and|or|contains|in)\s/.test(name) && !/^(true|false|nil|null|blank|empty)$/.test(name)
        ? name.trim()
        : `row["${name.replace(/\\/g, '').replace(/"/g, '')}"]`;
}

/** Variables definidas dentro de la propia plantilla (assign / capture / for). */
export function extractDefinedVariables(source: string): string[] {
    const out = new Set<string>();
    const re = /\{%-?\s*(?:assign|capture)\s+([\p{L}\p{N}_-]+)|\{%-?\s*for\s+([\p{L}\p{N}_-]+)\s+in\b/gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) out.add(m[1] ?? m[2]);
    return [...out];
}
