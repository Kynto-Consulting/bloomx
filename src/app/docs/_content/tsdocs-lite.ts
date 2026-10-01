import type { SymbolCategory, SymbolKind } from '@/lib/tsdocs/extract';
import rows from './generated/sdk-tsdocs-search.json';
import type { Locale } from './types';

/** Version ligera (apta para el cliente): solo nombre, modulo, categoria y resumen de cada simbolo. */
export interface SymRef { name: string; module: string }
export interface SearchRow { n: string; m: string; k: SymbolKind; c: SymbolCategory; s: string; d?: 1 }
export const SEARCH_ROWS = rows as unknown as SearchRow[];

/**
 * Datos y utilidades puras (sin React) de la referencia TSDocs del SDK. El JSON se genera con `npm run docs:tsdocs`
 * a partir de los .d.ts reales; un test comprueba que esta al dia, que cada simbolo tiene pagina y que los enlaces resuelven.
 */
export const TSDOCS_BASE = '/docs/extension-tools/tsdocs';

const BY_NAME = new Map<string, SymRef>(SEARCH_ROWS.map((r) => [r.n, { name: r.n, module: r.m }]));

export function tsdocsHref(s: SymRef): string {
    return `${TSDOCS_BASE}/${s.module}/${s.name}`;
}
export function moduleHref(id: string): string {
    return `${TSDOCS_BASE}/${id}`;
}
export function findSymbolByName(name: string): SymRef | undefined {
    return BY_NAME.get(name);
}

export const MODULES: Array<{ id: string; file: string; description: Record<Locale, string> }> = [
    { id: 'sdk', file: 'index.d.ts', description: { es: 'Punto de entrada del SDK: `defineManifest` y reexportaciones.', en: 'SDK entry point: `defineManifest` and re-exports.' } },
    { id: 'manifest', file: 'manifest.d.ts', description: { es: 'Manifest, puntos de montaje, permisos, hooks y rutas.', en: 'Manifest, mount points, permissions, hooks and routes.' } },
    { id: 'ui', file: 'ui.d.ts', description: { es: 'Componentes (`ui.*`), acciones (`act.*`), expresiones (`expr.*`) y su vocabulario.', en: 'Components (`ui.*`), actions (`act.*`), expressions (`expr.*`) and their vocabulary.' } },
    { id: 'host', file: 'ctx.d.ts', description: { es: 'Contexto del handler de `server.js` y servicios del host (`ctx.services`).', en: '`server.js` handler context and host services (`ctx.services`).' } },
];

export const CATEGORY_ORDER: SymbolCategory[] = ['manifest', 'mount', 'handler', 'host-service', 'action', 'expression', 'component', 'shape', 'vocabulary', 'other'];
export const CATEGORY_TITLE: Record<SymbolCategory, Record<Locale, string>> = {
    manifest: { es: 'Manifest', en: 'Manifest' },
    mount: { es: 'Puntos de montaje', en: 'Mount points' },
    handler: { es: 'Handlers de servidor', en: 'Server handlers' },
    'host-service': { es: 'Servicios del host', en: 'Host services' },
    action: { es: 'Acciones', en: 'Actions' },
    expression: { es: 'Expresiones', en: 'Expressions' },
    component: { es: 'Componentes', en: 'Components' },
    shape: { es: 'Formas reutilizadas', en: 'Shared shapes' },
    vocabulary: { es: 'Vocabulario semántico', en: 'Semantic vocabulary' },
    other: { es: 'Otros', en: 'Other' },
};

export const KIND_ORDER: SymbolKind[] = ['interface', 'type', 'enum', 'function', 'const', 'class'];
export const KIND_TITLE: Record<SymbolKind, Record<Locale, string>> = {
    interface: { es: 'Interfaces', en: 'Interfaces' },
    type: { es: 'Tipos', en: 'Types' },
    enum: { es: 'Enumeraciones', en: 'Enums' },
    function: { es: 'Funciones', en: 'Functions' },
    const: { es: 'Constantes', en: 'Constants' },
    class: { es: 'Clases', en: 'Classes' },
};
export const KIND_SINGULAR: Record<SymbolKind, Record<Locale, string>> = {
    interface: { es: 'Interfaz', en: 'Interface' },
    type: { es: 'Tipo', en: 'Type' },
    enum: { es: 'Enum', en: 'Enum' },
    function: { es: 'Función', en: 'Function' },
    const: { es: 'Constante', en: 'Constant' },
    class: { es: 'Clase', en: 'Class' },
};

// ---------------------------------------------------------------------------------------------------------------
// Resaltado de sintaxis y enlaces entre tipos
// ---------------------------------------------------------------------------------------------------------------

export type CodeTokenKind = 'kw' | 'str' | 'num' | 'com' | 'type' | 'plain';
export interface CodeToken { kind: CodeTokenKind; text: string }

const KEYWORDS = new Set(['export', 'declare', 'interface', 'type', 'enum', 'function', 'const', 'let', 'var', 'class', 'extends', 'implements', 'readonly',
    'import', 'from', 'default', 'async', 'await', 'return', 'new', 'typeof', 'keyof', 'infer', 'as', 'void', 'null', 'undefined', 'true', 'false',
    'string', 'number', 'boolean', 'unknown', 'any', 'never', 'object', 'if', 'else', 'throw']);

const TOKEN_RE = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$]*/g;

/**
 * Tokeniza codigo TS/JS para resaltarlo. Los identificadores que son simbolos exportados del SDK salen como `type`
 * (el renderizador los enlaza); palabras clave y literales se colorean con tokens del tema.
 */
export function tokenizeCode(code: string, isKnown: (name: string) => boolean = (n) => BY_NAME.has(n)): CodeToken[] {
    const out: CodeToken[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    TOKEN_RE.lastIndex = 0;
    const push = (kind: CodeTokenKind, text: string) => {
        const prev = out[out.length - 1];
        if (prev && prev.kind === kind && kind === 'plain') prev.text += text;
        else out.push({ kind, text });
    };
    while ((m = TOKEN_RE.exec(code))) {
        if (m.index > last) push('plain', code.slice(last, m.index));
        const t = m[0];
        if (t.startsWith('/*') || t.startsWith('//')) push('com', t);
        else if (t[0] === '"' || t[0] === "'" || t[0] === '`') push('str', t);
        else if (/^\d/.test(t)) push('num', t);
        else if (KEYWORDS.has(t)) push('kw', t);
        else if (isKnown(t) && code[m.index - 1] !== '.') out.push({ kind: 'type', text: t });
        else push('plain', t);
        last = m.index + t.length;
    }
    if (last < code.length) push('plain', code.slice(last));
    return out;
}

export interface TextPart { text: string; name?: string }

/** Parte `{@link Nombre}` / `{@link Nombre | etiqueta}` de un texto TSDoc. `name` solo si el simbolo existe. */
export function splitLinks(text: string): TextPart[] {
    const out: TextPart[] = [];
    const re = /\{@link\s+([A-Za-z_$][\w$]*)(?:\s*\|\s*([^}]+))?\}/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
        if (m.index > last) out.push({ text: text.slice(last, m.index) });
        out.push({ text: (m[2] ?? m[1]).trim(), name: BY_NAME.has(m[1]) ? m[1] : undefined });
        last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
}

export function memberAnchor(name: string): string {
    return `m-${name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'call'}`;
}
