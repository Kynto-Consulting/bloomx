/**
 * Evaluador seguro de expresiones de los manifests de extensiones (`${...}`), SIN eval ni new Function.
 *
 * Un manifest es dato controlado por quien publica la extension y se evalua en el navegador del usuario:
 * el lenguaje es deliberadamente pequeno y no puede llamar funciones ni salir del alcance dado.
 *
 * Gramatica (de menor a mayor precedencia):
 *   expr    := ternary ( '|' filtro (':' argumento)* )*
 *   ternary := or ( '?' ternary ':' ternary )?
 *   or      := and ( '||' and )*          -> primer valor "no vacio" (undefined/null/'' son vacios; 0 y false NO)
 *   and     := eq ( '&&' eq )*            -> cortocircuito con veracidad de JS
 *   eq      := rel ( ('=='|'!='|'==='|'!==') rel )*   -> `== null` tambien es cierto para ''
 *   rel     := add ( ('<'|'>'|'<='|'>=') add )*
 *   add     := unary ( ('+'|'-') unary )*
 *   unary   := ('!'|'-') unary | postfix
 *   postfix := primario ( '.' ident | '?.' ident | '[' expr ']' )*
 *   primario:= numero | 'texto' | "texto" | true | false | null | undefined | ident | '(' expr ')'
 * Filtros: truncate:N, upper, lower, trim, capitalize, length, json, join:sep, default:valor.
 *
 * Raices: `context.x`, `state.x`, `env.x`; cualquier otro identificador se busca en el contexto (alias de FOR_EACH,
 * `formData`, `result`, `value`, ...). Se bloquean __proto__/constructor/prototype. Errores de sintaxis => undefined.
 */

export interface ExpressionScope {
    /** Contexto del mount + variables adicionales (result, value, formData, item, ...). */
    ctx: any;
    /** Estado del arbol de extension (SET_STATE). */
    state: any;
}

type Node =
    | { t: 'lit'; v: any }
    | { t: 'id'; name: string }
    | { t: 'member'; obj: Node; key: Node | string; optional: boolean }
    | { t: 'not'; arg: Node }
    | { t: 'neg'; arg: Node }
    | { t: 'bin'; op: string; l: Node; r: Node }
    | { t: 'logic'; op: '&&' | '||'; l: Node; r: Node }
    | { t: 'cond'; test: Node; a: Node; b: Node }
    | { t: 'filter'; arg: Node; name: string; params: Node[] };

type Token = { k: 'num' | 'str' | 'id' | 'op' | 'eof'; v: string };

const MAX_SOURCE = 1000;
const MAX_DEPTH = 50;
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// --------------------------------------------------------------------------------------------------------------
// Tokenizador
// --------------------------------------------------------------------------------------------------------------

const OPERATORS = ['===', '!==', '==', '!=', '<=', '>=', '&&', '||', '?.', '<', '>', '+', '-', '!', '?', ':', '.', '[', ']', '(', ')', '|', ','];

function tokenize(src: string): Token[] {
    const out: Token[] = [];
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (/\s/.test(c)) { i++; continue; }

        if (c === '"' || c === "'") {
            let j = i + 1;
            let value = '';
            while (j < src.length && src[j] !== c) {
                if (src[j] === '\\' && j + 1 < src.length) {
                    const next = src[j + 1];
                    value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
                    j += 2;
                } else {
                    value += src[j++];
                }
            }
            if (j >= src.length) throw new Error('unterminated string');
            out.push({ k: 'str', v: value });
            i = j + 1;
            continue;
        }

        if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
            let j = i;
            while (j < src.length && /[0-9.]/.test(src[j])) j++;
            out.push({ k: 'num', v: src.slice(i, j) });
            i = j;
            continue;
        }

        if (/[A-Za-z_$]/.test(c)) {
            let j = i;
            while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++;
            out.push({ k: 'id', v: src.slice(i, j) });
            i = j;
            continue;
        }

        const op = OPERATORS.find((candidate) => src.startsWith(candidate, i));
        if (!op) throw new Error(`unexpected character ${c}`);
        out.push({ k: 'op', v: op });
        i += op.length;
    }
    out.push({ k: 'eof', v: '' });
    return out;
}

// --------------------------------------------------------------------------------------------------------------
// Parser (descenso recursivo)
// --------------------------------------------------------------------------------------------------------------

function parse(src: string): Node {
    const tokens = tokenize(src);
    let pos = 0;
    const peek = () => tokens[pos];
    const isOp = (v: string) => tokens[pos].k === 'op' && tokens[pos].v === v;
    const eat = (v: string) => {
        if (!isOp(v)) throw new Error(`expected ${v}`);
        pos++;
    };
    let depth = 0;
    const guard = () => { if (++depth > MAX_DEPTH) throw new Error('expression too deep'); };

    function parseExpr(): Node {
        guard();
        let node = parseTernary();
        while (isOp('|')) {
            pos++;
            const nameTok = peek();
            if (nameTok.k !== 'id') throw new Error('filter name expected');
            pos++;
            const params: Node[] = [];
            while (isOp(':')) {
                pos++;
                params.push(parseUnary());
            }
            node = { t: 'filter', arg: node, name: nameTok.v, params };
        }
        depth--;
        return node;
    }

    function parseTernary(): Node {
        const test = parseOr();
        if (isOp('?')) {
            pos++;
            const a = parseTernary();
            eat(':');
            const b = parseTernary();
            return { t: 'cond', test, a, b };
        }
        return test;
    }

    function parseOr(): Node {
        let l = parseAnd();
        while (isOp('||')) { pos++; l = { t: 'logic', op: '||', l, r: parseAnd() }; }
        return l;
    }

    function parseAnd(): Node {
        let l = parseEq();
        while (isOp('&&')) { pos++; l = { t: 'logic', op: '&&', l, r: parseEq() }; }
        return l;
    }

    function parseEq(): Node {
        let l = parseRel();
        while (isOp('==') || isOp('!=') || isOp('===') || isOp('!==')) {
            const op = peek().v; pos++;
            l = { t: 'bin', op, l, r: parseRel() };
        }
        return l;
    }

    function parseRel(): Node {
        let l = parseAdd();
        while (isOp('<') || isOp('>') || isOp('<=') || isOp('>=')) {
            const op = peek().v; pos++;
            l = { t: 'bin', op, l, r: parseAdd() };
        }
        return l;
    }

    function parseAdd(): Node {
        let l = parseUnary();
        while (isOp('+') || isOp('-')) {
            const op = peek().v; pos++;
            l = { t: 'bin', op, l, r: parseUnary() };
        }
        return l;
    }

    function parseUnary(): Node {
        guard();
        try {
            if (isOp('!')) { pos++; return { t: 'not', arg: parseUnary() }; }
            if (isOp('-')) { pos++; return { t: 'neg', arg: parseUnary() }; }
            return parsePostfix();
        } finally {
            depth--;
        }
    }

    function parsePostfix(): Node {
        let node = parsePrimary();
        for (;;) {
            if (isOp('.') || isOp('?.')) {
                const optional = peek().v === '?.';
                pos++;
                const key = peek();
                if (key.k !== 'id' && key.k !== 'num') throw new Error('property name expected');
                pos++;
                node = { t: 'member', obj: node, key: key.v, optional };
                continue;
            }
            if (isOp('[')) {
                pos++;
                const key = parseExpr();
                eat(']');
                node = { t: 'member', obj: node, key, optional: false };
                continue;
            }
            return node;
        }
    }

    function parsePrimary(): Node {
        const tok = peek();
        if (tok.k === 'num') { pos++; return { t: 'lit', v: Number(tok.v) }; }
        if (tok.k === 'str') { pos++; return { t: 'lit', v: tok.v }; }
        if (tok.k === 'id') {
            pos++;
            if (tok.v === 'true') return { t: 'lit', v: true };
            if (tok.v === 'false') return { t: 'lit', v: false };
            if (tok.v === 'null') return { t: 'lit', v: null };
            if (tok.v === 'undefined') return { t: 'lit', v: undefined };
            return { t: 'id', name: tok.v };
        }
        if (isOp('(')) {
            pos++;
            const inner = parseExpr();
            eat(')');
            return inner;
        }
        throw new Error(`unexpected token ${tok.v || 'end'}`);
    }

    const ast = parseExpr();
    if (peek().k !== 'eof') throw new Error(`unexpected token ${peek().v}`);
    return ast;
}

const astCache = new Map<string, Node | null>();

function getAst(src: string): Node | null {
    const cached = astCache.get(src);
    if (cached !== undefined) return cached;
    let ast: Node | null = null;
    try {
        ast = src.length <= MAX_SOURCE ? parse(src) : null;
    } catch {
        ast = null;
    }
    if (astCache.size > 500) astCache.clear();
    astCache.set(src, ast);
    return ast;
}

// --------------------------------------------------------------------------------------------------------------
// Evaluacion
// --------------------------------------------------------------------------------------------------------------

export function isEmptyValue(value: unknown): boolean {
    return value === undefined || value === null || value === '';
}

function readKey(obj: any, key: unknown): any {
    if (obj === null || obj === undefined) return undefined;
    const k = String(key);
    if (BLOCKED_KEYS.has(k)) return undefined;
    if (typeof obj === 'string') return k === 'length' ? obj.length : /^\d+$/.test(k) ? obj[Number(k)] : undefined;
    if (typeof obj !== 'object' && typeof obj !== 'function') return undefined;
    return obj[k];
}

function readRoot(name: string, scope: ExpressionScope): any {
    if (BLOCKED_KEYS.has(name)) return undefined;
    if (name === 'context') return scope.ctx;
    if (name === 'state') return scope.state;
    if (name === 'env') return scope.ctx?.env;
    const ctx = scope.ctx;
    if (ctx && typeof ctx === 'object' && name in ctx) return ctx[name];
    return undefined;
}

function applyFilter(name: string, value: any, params: any[]): any {
    switch (name) {
        case 'truncate': {
            const max = Math.max(0, Number(params[0]) || 100);
            const text = String(value ?? '');
            return text.length > max ? `${text.slice(0, max)}...` : text;
        }
        case 'upper': return String(value ?? '').toUpperCase();
        case 'lower': return String(value ?? '').toLowerCase();
        case 'trim': return String(value ?? '').trim();
        case 'capitalize': {
            const text = String(value ?? '');
            return text.charAt(0).toUpperCase() + text.slice(1);
        }
        case 'length': return Array.isArray(value) || typeof value === 'string' ? value.length : 0;
        case 'json': {
            try { return JSON.stringify(value); } catch { return ''; }
        }
        case 'join': return Array.isArray(value) ? value.join(params[0] === undefined ? ', ' : String(params[0])) : '';
        case 'default': return isEmptyValue(value) ? params[0] : value;
        default: return value; // filtro desconocido: no-op (mejor que romper el render)
    }
}

function evalNode(node: Node, scope: ExpressionScope): any {
    switch (node.t) {
        case 'lit': return node.v;
        case 'id': return readRoot(node.name, scope);
        case 'member': {
            const obj = evalNode(node.obj, scope);
            const key = typeof node.key === 'string' ? node.key : evalNode(node.key, scope);
            return readKey(obj, key);
        }
        case 'not': return !evalNode(node.arg, scope);
        case 'neg': return -Number(evalNode(node.arg, scope));
        case 'logic': {
            const left = evalNode(node.l, scope);
            if (node.op === '&&') return left ? evalNode(node.r, scope) : left;
            // '||': primer valor no vacio (compatibilidad: 0 y false son valores validos)
            return isEmptyValue(left) ? evalNode(node.r, scope) : left;
        }
        case 'cond': return evalNode(node.test, scope) ? evalNode(node.a, scope) : evalNode(node.b, scope);
        case 'filter': {
            const params = node.params.map((param) => evalNode(param, scope));
            return applyFilter(node.name, evalNode(node.arg, scope), params);
        }
        case 'bin': {
            const l = evalNode(node.l, scope);
            const r = evalNode(node.r, scope);
            return evalBinary(node.op, l, r);
        }
    }
}

function evalBinary(op: string, l: any, r: any): any {
    switch (op) {
        case '==': return looseEquals(l, r);
        case '!=': return !looseEquals(l, r);
        case '===': return l === r;
        case '!==': return l !== r;
        case '<': return l < r;
        case '>': return l > r;
        case '<=': return l <= r;
        case '>=': return l >= r;
        case '+': return typeof l === 'number' && typeof r === 'number' ? l + r : `${l ?? ''}${r ?? ''}`;
        case '-': return Number(l) - Number(r);
        default: return undefined;
    }
}

/** `x == null` es cierto para undefined, null y '' (compatibilidad con los manifests); el resto usa == de JS. */
function looseEquals(l: any, r: any): boolean {
    if (r === null || l === null) {
        return isEmptyValue(l) && isEmptyValue(r);
    }
    // eslint-disable-next-line eqeqeq
    return l == r;
}

/** Evalua una expresion (sin las llaves de `${}`). Devuelve undefined si es invalida. */
export function evaluateExpression(source: string, scope: ExpressionScope): any {
    const ast = getAst(String(source).trim());
    if (!ast) return undefined;
    try {
        return evalNode(ast, scope);
    } catch {
        return undefined;
    }
}

// --------------------------------------------------------------------------------------------------------------
// Plantillas
// --------------------------------------------------------------------------------------------------------------

/** Extrae los tramos ${...} respetando comillas y llaves anidadas. Devuelve null si la cadena no tiene expresiones. */
function splitTemplate(input: string): Array<{ text?: string; expr?: string }> | null {
    if (!input.includes('${')) return null;
    const parts: Array<{ text?: string; expr?: string }> = [];
    let i = 0;
    let literal = '';
    while (i < input.length) {
        if (input[i] === '$' && input[i + 1] === '{') {
            let j = i + 2;
            let braces = 1;
            let quote = '';
            while (j < input.length && braces > 0) {
                const c = input[j];
                if (quote) {
                    if (c === '\\') j++;
                    else if (c === quote) quote = '';
                } else if (c === '"' || c === "'") quote = c;
                else if (c === '{') braces++;
                else if (c === '}') braces--;
                j++;
            }
            if (braces !== 0) { literal += input.slice(i); i = input.length; break; }
            if (literal) { parts.push({ text: literal }); literal = ''; }
            parts.push({ expr: input.slice(i + 2, j - 1) });
            i = j;
        } else {
            literal += input[i++];
        }
    }
    if (literal) parts.push({ text: literal });
    return parts;
}

/**
 * Resuelve un string del manifest: si es UNA sola expresion devuelve el valor tal cual (objeto, array, numero...);
 * si mezcla texto y expresiones devuelve un string (undefined/null => '').
 */
export function resolveTemplate(input: string, scope: ExpressionScope): any {
    const parts = splitTemplate(input);
    if (!parts) return input;
    if (parts.length === 1 && parts[0].expr !== undefined) {
        return evaluateExpression(parts[0].expr, scope);
    }
    return parts
        .map((part) => {
            if (part.expr === undefined) return part.text;
            const value = evaluateExpression(part.expr, scope);
            return value !== undefined && value !== null ? String(value) : '';
        })
        .join('');
}

/**
 * Claves cuyo valor NO string (componentes, acciones) se deja intacto al resolver props: se resuelven mas tarde,
 * con el alcance correcto (item de LIST/FOR_EACH, result/value/formData de una accion, estado fresco).
 * Resolverlas antes las evaluaria con variables aun inexistentes y las dejaria vacias.
 */
export const LAZY_KEYS: ReadonlySet<string> = new Set([
    'children', 'template', 'itemTemplate', 'empty', 'true', 'false', 'else', 'content', 'cases', 'default',
    'onLoad', 'onClick', 'onChange', 'onSubmit', 'onSelect', 'onSuccess', 'onError', 'onConfirm', 'onCancel',
    'onUpload', 'actions', 'action',
]);

/** Resuelve recursivamente strings, arreglos y objetos planos. Con `lazy`, las claves indicadas quedan sin resolver. */
export function resolveDeep(value: any, scope: ExpressionScope, lazy?: ReadonlySet<string>, depth = 0): any {
    if (depth > 60) return value;
    if (typeof value === 'string') return resolveTemplate(value, scope);
    if (Array.isArray(value)) return value.map((item) => resolveDeep(item, scope, lazy, depth + 1));
    if (value !== null && typeof value === 'object') {
        const out: Record<string, any> = {};
        for (const key of Object.keys(value)) {
            if (BLOCKED_KEYS.has(key)) continue;
            const child = value[key];
            out[key] = lazy && lazy.has(key) && typeof child !== 'string' ? child : resolveDeep(child, scope, lazy, depth + 1);
        }
        return out;
    }
    return value;
}
