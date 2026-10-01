/**
 * Extractor TSDoc del SDK de extensiones: lee ficheros .d.ts/.ts con el AST de `typescript` (sin type-checker)
 * y produce un modelo serializable y determinista (sin fechas ni rutas absolutas).
 *
 * Lo usan scripts/gen-sdk-tsdocs.ts (genera el JSON commiteado) y los tests (fixtures y frescura).
 */
import ts from 'typescript';

export type SymbolKind = 'interface' | 'type' | 'enum' | 'function' | 'const' | 'class';
export type SymbolCategory = 'manifest' | 'mount' | 'action' | 'component' | 'expression' | 'host-service' | 'handler' | 'vocabulary' | 'shape' | 'other';

export interface TsDocExample { lang: string; code: string; title?: string }
export interface TsDocParam { name: string; text: string }

export interface TsDoc {
    summary: string;
    remarks?: string;
    params: TsDocParam[];
    returns?: string;
    examples: TsDocExample[];
    deprecated?: string;
    since?: string;
    see: string[];
    default?: string;
}

export interface TsTypeParam { name: string; constraint?: string; default?: string }
export interface TsParam { name: string; type: string; optional: boolean; rest: boolean; doc?: string }

export interface TsMember {
    name: string;
    kind: 'property' | 'method' | 'index' | 'call' | 'enum-member';
    optional: boolean;
    readonly: boolean;
    /** Tipo (propiedad / indice) o tipo de retorno (metodo). */
    type: string;
    /** Firma legible de un metodo. */
    signature?: string;
    params?: TsParam[];
    typeParams?: TsTypeParam[];
    doc: TsDoc;
}

export interface TsSymbol {
    id: string; // module/Name
    name: string;
    module: string;
    kind: SymbolKind;
    category: SymbolCategory;
    signature: string;
    typeParams: TsTypeParam[];
    doc: TsDoc;
    members: TsMember[];
    extends: string[];
    implements: string[];
    /** Valores de una union de literales (type alias) o miembros de un enum. */
    unionValues: string[];
    /** Parametros y retorno (funciones). */
    params: TsParam[];
    returns?: string;
    source: { file: string; line: number };
    /** Nombres de simbolos exportados referenciados por este (ordenado). */
    refs: string[];
    /** Simbolos que lo referencian (ordenado). */
    usedBy: string[];
}

export interface TsSourceFile { module: string; file: string; text: string }

export interface TsDocsData {
    version: 1;
    modules: Array<{ id: string; file: string; count: number }>;
    symbols: TsSymbol[];
}

// ---------------------------------------------------------------------------------------------------------------
// Comentarios TSDoc
// ---------------------------------------------------------------------------------------------------------------

const EMPTY_DOC = (): TsDoc => ({ summary: '', params: [], examples: [], see: [] });

function collapse(s: string): string {
    return s.replace(/\s+/g, ' ').trim();
}

function leadingDoc(sf: ts.SourceFile, node: ts.Node): string | null {
    const ranges = ts.getLeadingCommentRanges(sf.text, node.pos) ?? [];
    for (let i = ranges.length - 1; i >= 0; i--) {
        const t = sf.text.slice(ranges[i].pos, ranges[i].end);
        if (t.startsWith('/**')) return t;
    }
    return null;
}

/** Parsea el texto crudo de un comentario `/** ... *\/` a un TsDoc. Exportado para tests. */
export function parseTsDoc(raw: string | null): TsDoc {
    const doc = EMPTY_DOC();
    if (!raw) return doc;
    const lines = raw
        .replace(/\r\n/g, '\n')
        .replace(/^\/\*\*+/, '')
        .replace(/\*+\/\s*$/, '')
        .split('\n')
        .map((l) => l.replace(/^\s*\* ?/, ''));
    type Seg = { tag: string; text: string[] };
    const segs: Seg[] = [{ tag: '', text: [] }];
    let fence = false;
    for (const line of lines) {
        if (/^\s*```/.test(line)) fence = !fence;
        const m = !fence && /^\s*@([A-Za-z]+)\b ?(.*)$/.exec(line);
        if (m && !/^\s*```/.test(line)) segs.push({ tag: m[1], text: [m[2]] });
        else segs[segs.length - 1].text.push(line);
    }
    const trimBlock = (a: string[]) => a.join('\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
    for (const s of segs) {
        const body = trimBlock(s.text);
        switch (s.tag) {
            case '': doc.summary = body.trim(); break;
            case 'remarks': doc.remarks = body.trim(); break;
            case 'param': {
                const m = /^(?:\{[^}]*\}\s*)?(\[?[\w$.]+\]?)\s*(?:-\s*)?([\s\S]*)$/.exec(body);
                if (m) doc.params.push({ name: m[1].replace(/[[\]]/g, ''), text: collapse(m[2]) });
                break;
            }
            case 'returns':
            case 'return': doc.returns = collapse(body); break;
            case 'example': {
                const f = /```([\w-]*)\n([\s\S]*?)```/.exec(body);
                if (f) {
                    const title = collapse(body.slice(0, f.index));
                    doc.examples.push({ lang: f[1] || 'ts', code: f[2].replace(/\s+$/, ''), ...(title ? { title } : {}) });
                } else if (body.trim()) doc.examples.push({ lang: 'ts', code: body });
                break;
            }
            case 'deprecated': doc.deprecated = collapse(body) || 'true'; break;
            case 'since': doc.since = collapse(body); break;
            case 'see': doc.see.push(collapse(body)); break;
            case 'default':
            case 'defaultValue': doc.default = collapse(body); break;
            default: break;
        }
    }
    return doc;
}

// ---------------------------------------------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------------------------------------------

const printer = ts.createPrinter({ removeComments: true });

function typeText(sf: ts.SourceFile, n: ts.Node | undefined): string {
    if (!n) return 'any';
    return collapse(printer.printNode(ts.EmitHint.Unspecified, n, sf));
}

function nameText(sf: ts.SourceFile, n: ts.PropertyName | ts.BindingName | undefined): string {
    if (!n) return '';
    if (ts.isStringLiteral(n)) return n.text;
    return n.getText(sf);
}

function typeParams(sf: ts.SourceFile, tps: ts.NodeArray<ts.TypeParameterDeclaration> | undefined): TsTypeParam[] {
    return (tps ?? []).map((t) => ({
        name: t.name.text,
        ...(t.constraint ? { constraint: typeText(sf, t.constraint) } : {}),
        ...(t.default ? { default: typeText(sf, t.default) } : {}),
    }));
}

function tpHeader(tps: TsTypeParam[]): string {
    if (!tps.length) return '';
    return `<${tps.map((t) => t.name + (t.constraint ? ` extends ${t.constraint}` : '') + (t.default ? ` = ${t.default}` : '')).join(', ')}>`;
}

function params(sf: ts.SourceFile, ps: ts.NodeArray<ts.ParameterDeclaration>, doc: TsDoc): TsParam[] {
    return ps.map((p) => {
        const name = nameText(sf, p.name);
        return {
            name,
            type: typeText(sf, p.type),
            optional: !!p.questionToken || !!p.initializer,
            rest: !!p.dotDotDotToken,
            ...(doc.params.find((d) => d.name === name) ? { doc: doc.params.find((d) => d.name === name)!.text } : {}),
        };
    });
}

function paramsText(ps: TsParam[]): string {
    return ps.map((p) => `${p.rest ? '...' : ''}${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ');
}

function collectRefs(node: ts.Node, out: Set<string>): void {
    const visit = (n: ts.Node) => {
        if (ts.isTypeReferenceNode(n)) out.add(ts.isIdentifier(n.typeName) ? n.typeName.text : n.typeName.right.text);
        else if (ts.isExpressionWithTypeArguments(n) && ts.isIdentifier(n.expression)) out.add(n.expression.text);
        else if (ts.isTypeQueryNode(n) && ts.isIdentifier(n.exprName)) out.add(n.exprName.text);
        ts.forEachChild(n, visit);
    };
    visit(node);
}

function isExported(n: ts.Node): boolean {
    return !!(ts.getCombinedModifierFlags(n as ts.Declaration) & ts.ModifierFlags.Export);
}

function member(sf: ts.SourceFile, m: ts.TypeElement, refs: Set<string>): TsMember | null {
    collectRefs(m, refs);
    const doc = parseTsDoc(leadingDoc(sf, m));
    const readonly = !!m.getChildren(sf).some((c) => c.kind === ts.SyntaxKind.ReadonlyKeyword) ||
        !!(ts.canHaveModifiers(m) && ts.getModifiers(m)?.some((x) => x.kind === ts.SyntaxKind.ReadonlyKeyword));
    if (ts.isPropertySignature(m)) {
        return { name: nameText(sf, m.name), kind: 'property', optional: !!m.questionToken, readonly, type: typeText(sf, m.type), doc };
    }
    if (ts.isMethodSignature(m)) {
        const tps = typeParams(sf, m.typeParameters);
        const ps = params(sf, m.parameters, doc);
        const name = nameText(sf, m.name);
        const ret = typeText(sf, m.type);
        return { name, kind: 'method', optional: !!m.questionToken, readonly: false, type: ret, params: ps, typeParams: tps, signature: `${name}${m.questionToken ? '?' : ''}${tpHeader(tps)}(${paramsText(ps)}): ${ret}`, doc };
    }
    if (ts.isIndexSignatureDeclaration(m)) {
        const key = m.parameters[0];
        return { name: `[${nameText(sf, key.name)}: ${typeText(sf, key.type)}]`, kind: 'index', optional: false, readonly, type: typeText(sf, m.type), doc };
    }
    if (ts.isCallSignatureDeclaration(m)) {
        const ps = params(sf, m.parameters, doc);
        return { name: '(call)', kind: 'call', optional: false, readonly: false, type: typeText(sf, m.type), params: ps, signature: `(${paramsText(ps)}): ${typeText(sf, m.type)}`, doc };
    }
    return null;
}

function wrapUnion(text: string): string {
    if (text.length <= 110) return text;
    const parts = splitTopLevel(text, '|');
    if (parts.length < 2) return text;
    return '\n    | ' + parts.join('\n    | ');
}

function splitTopLevel(text: string, sep: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    let q: string | null = null;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) {
            cur += c;
            if (c === '\\') { cur += text[++i] ?? ''; continue; }
            if (c === q) q = null;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
        if ('<([{'.includes(c)) depth++;
        if (')]}>'.includes(c) && !(c === '>' && text[i - 1] === '=')) depth--;
        if (c === sep && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
        cur += c;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
}

function unionLiterals(sf: ts.SourceFile, t: ts.TypeNode): string[] {
    if (!ts.isUnionTypeNode(t)) return [];
    const out: string[] = [];
    for (const m of t.types) {
        if (ts.isLiteralTypeNode(m)) out.push(typeText(sf, m));
        else if (ts.isTemplateLiteralTypeNode(m)) out.push(typeText(sf, m));
    }
    return out;
}

/** Categoria funcional (para el indice): por convencion de nombres del SDK. */
export function categorize(name: string, module: string, kind: SymbolKind): SymbolCategory {
    if (module === 'host') {
        if (/Service$/.test(name) || name === 'HandlerServices') return 'host-service';
        return 'handler';
    }
    if (module === 'manifest') return /^Manifest|^Mount|^Intercept|^Permission|^Lifecycle|^Cron|^Auth/.test(name) ? (/^MountPoint$/.test(name) ? 'mount' : 'manifest') : 'manifest';
    if (module === 'sdk') return 'manifest';
    if (/Shape$/.test(name)) return 'shape';
    if (/^(Expr|I18nText)$|ExprHelpers|^expr$/.test(name)) return 'expression';
    if (/Action/.test(name) || name === 'act' || name === 'actions' || name === 'ACTION_TYPES') return 'action';
    if (/Props$|Node$|Helpers$|^UiNode|^UiComponent|Component|^ui$|^COMPONENT_TYPES$/.test(name)) return 'component';
    if (kind === 'type') return 'vocabulary';
    return 'other';
}

export interface ExtractResult { symbols: TsSymbol[] }

export function extractFile(src: TsSourceFile): TsSymbol[] {
    const sf = ts.createSourceFile(src.file, src.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const out: TsSymbol[] = [];
    const base = (name: string, kind: SymbolKind, node: ts.Node, doc: TsDoc): TsSymbol => ({
        id: `${src.module}/${name}`,
        name,
        module: src.module,
        kind,
        category: categorize(name, src.module, kind),
        signature: '',
        typeParams: [],
        doc,
        members: [],
        extends: [],
        implements: [],
        unionValues: [],
        params: [],
        source: { file: src.file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 },
        refs: [],
        usedBy: [],
    });
    const finishRefs = (s: TsSymbol, refs: Set<string>) => { refs.delete(s.name); s.refs = [...refs].sort(); };

    for (const st of sf.statements) {
        if (ts.isInterfaceDeclaration(st) && isExported(st)) {
            const doc = parseTsDoc(leadingDoc(sf, st));
            const s = base(st.name.text, 'interface', st, doc);
            const refs = new Set<string>();
            s.typeParams = typeParams(sf, st.typeParameters);
            for (const h of st.heritageClauses ?? []) {
                for (const t of h.types) {
                    collectRefs(t, refs);
                    (h.token === ts.SyntaxKind.ExtendsKeyword ? s.extends : s.implements).push(typeText(sf, t));
                }
            }
            for (const m of st.members) { const mm = member(sf, m, refs); if (mm) s.members.push(mm); }
            for (const tp of st.typeParameters ?? []) collectRefs(tp, refs);
            const head = `export interface ${s.name}${tpHeader(s.typeParams)}${s.extends.length ? ` extends ${s.extends.join(', ')}` : ''}`;
            s.signature = s.members.length <= 24
                ? `${head} {\n${s.members.map((m) => `    ${m.readonly ? 'readonly ' : ''}${m.kind === 'method' ? m.signature : m.kind === 'call' ? m.signature : `${m.name}${m.optional ? '?' : ''}: ${m.type}`};`).join('\n')}\n}`
                : `${head} {\n    // ${s.members.length} miembros: ver la tabla\n}`;
            finishRefs(s, refs);
            out.push(s);
        } else if (ts.isTypeAliasDeclaration(st) && isExported(st)) {
            const doc = parseTsDoc(leadingDoc(sf, st));
            const s = base(st.name.text, 'type', st, doc);
            const refs = new Set<string>();
            s.typeParams = typeParams(sf, st.typeParameters);
            collectRefs(st.type, refs);
            for (const tp of st.typeParameters ?? []) collectRefs(tp, refs);
            const tt = typeText(sf, st.type);
            s.unionValues = unionLiterals(sf, st.type);
            if (ts.isTypeLiteralNode(st.type)) {
                for (const m of st.type.members) { const mm = member(sf, m, refs); if (mm) s.members.push(mm); }
                s.signature = `export type ${s.name}${tpHeader(s.typeParams)} = {\n${s.members.map((m) => `    ${m.name}${m.optional ? '?' : ''}: ${m.type};`).join('\n')}\n}`;
            } else {
                s.signature = `export type ${s.name}${tpHeader(s.typeParams)} =${wrapUnion(tt).startsWith('\n') ? '' : ' '}${wrapUnion(tt)}`;
            }
            finishRefs(s, refs);
            out.push(s);
        } else if (ts.isEnumDeclaration(st) && isExported(st)) {
            const doc = parseTsDoc(leadingDoc(sf, st));
            const s = base(st.name.text, 'enum', st, doc);
            for (const m of st.members) {
                const md = parseTsDoc(leadingDoc(sf, m));
                const init = m.initializer ? typeText(sf, m.initializer) : '';
                s.members.push({ name: nameText(sf, m.name), kind: 'enum-member', optional: false, readonly: true, type: init, doc: md });
                s.unionValues.push(init || nameText(sf, m.name));
            }
            s.signature = `export enum ${s.name} {\n${s.members.map((m) => `    ${m.name}${m.type ? ` = ${m.type}` : ''},`).join('\n')}\n}`;
            out.push(s);
        } else if (ts.isFunctionDeclaration(st) && isExported(st) && st.name) {
            const doc = parseTsDoc(leadingDoc(sf, st));
            const s = base(st.name.text, 'function', st, doc);
            const refs = new Set<string>();
            collectRefs(st, refs);
            s.typeParams = typeParams(sf, st.typeParameters);
            s.params = params(sf, st.parameters, doc);
            s.returns = typeText(sf, st.type);
            s.signature = `export function ${s.name}${tpHeader(s.typeParams)}(${paramsText(s.params)}): ${s.returns};`;
            finishRefs(s, refs);
            out.push(s);
        } else if (ts.isVariableStatement(st) && isExported(st)) {
            const stDoc = leadingDoc(sf, st);
            for (const d of st.declarationList.declarations) {
                const doc = parseTsDoc(stDoc);
                const name = nameText(sf, d.name);
                const s = base(name, 'const', st, doc);
                const refs = new Set<string>();
                if (d.type) collectRefs(d.type, refs);
                const t = typeText(sf, d.type);
                s.returns = t;
                s.signature = `export const ${name}: ${t};`;
                finishRefs(s, refs);
                out.push(s);
            }
        } else if (ts.isClassDeclaration(st) && isExported(st) && st.name) {
            const doc = parseTsDoc(leadingDoc(sf, st));
            const s = base(st.name.text, 'class', st, doc);
            s.signature = `export class ${s.name} { ... }`;
            out.push(s);
        }
    }
    return out;
}

const MODULE_ORDER = ['sdk', 'manifest', 'ui', 'host'];

/** Extrae todos los ficheros, resuelve `usedBy` y ordena de forma estable (modulo y orden de aparicion). */
export function extractSdk(files: TsSourceFile[]): TsDocsData {
    const symbols: TsSymbol[] = [];
    const modules: TsDocsData['modules'] = [];
    const ordered = [...files].sort((a, b) => (MODULE_ORDER.indexOf(a.module) - MODULE_ORDER.indexOf(b.module)) || a.module.localeCompare(b.module));
    const seen = new Map<string, string>();
    for (const f of ordered) {
        const syms = extractFile(f);
        for (const s of syms) {
            if (seen.has(s.name)) throw new Error(`Simbolo duplicado "${s.name}" en ${seen.get(s.name)} y ${f.module}: los nombres deben ser unicos para poder enlazarlos.`);
            seen.set(s.name, f.module);
        }
        symbols.push(...syms);
        modules.push({ id: f.module, file: f.file, count: syms.length });
    }
    const byName = new Map(symbols.map((s) => [s.name, s]));
    for (const s of symbols) s.refs = s.refs.filter((r) => byName.has(r));
    for (const s of symbols) for (const r of s.refs) byName.get(r)!.usedBy.push(s.name);
    for (const s of symbols) s.usedBy = [...new Set(s.usedBy)].sort();
    return { version: 1, modules, symbols };
}
