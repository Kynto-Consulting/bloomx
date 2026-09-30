/**
 * Analisis PURO del texto del playground: JSON (con linea/columna), deteccion manifest / nodo UI, validacion,
 * avisos de obsolescencia (migracion automatica) y objetivos de vista previa. Sin React ni efectos.
 */
import { normalizeMount, validateManifest } from '../manifest-schema';
import { migrateLegacyUi, migrateManifestUi, validateUi, type UiIssue } from '../ui-schema';
import { checkExpression } from '../expressions';

// ------------------------------------------------------------------ JSON con posicion
export interface JsonErrorInfo { message: string; position?: number; line?: number; column?: number }
export type JsonParse = { ok: true; value: unknown } | ({ ok: false } & JsonErrorInfo);

/** Linea y columna (base 1) de una posicion (indice) dentro de un texto. */
export function positionToLineCol(text: string, position: number): { line: number; column: number } {
    const pos = Math.max(0, Math.min(position, text.length));
    let line = 1;
    let last = -1;
    for (let i = 0; i < pos; i++) {
        if (text.charCodeAt(i) === 10) { line++; last = i; }
    }
    return { line, column: pos - last };
}

const NUMBER_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/** Localiza el PRIMER error de sintaxis JSON (independiente del motor). null si el texto es JSON valido. */
export function locateJsonError(text: string): { position: number; message: string } | null {
    let i = 0;
    let fail: { position: number; message: string } | null = null;
    const bad = (position: number, message: string) => { if (!fail) fail = { position, message }; return false; };
    const ws = () => { while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++; };
    const str = (): boolean => {
        const start = i;
        i++;
        while (i < text.length) {
            const c = text[i];
            if (c === '"') { i++; return true; }
            if (c === '\\') {
                const n = text[i + 1];
                if (n === 'u') {
                    if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) return bad(i, 'Secuencia \\u no valida');
                    i += 6;
                } else if (n !== undefined && '"\\/bfnrt'.includes(n)) i += 2;
                else return bad(i, 'Secuencia de escape no valida');
            } else if (c.charCodeAt(0) < 0x20) return bad(i, 'Salto de linea o caracter de control dentro de un texto (usa \\n)');
            else i++;
        }
        return bad(start, 'Texto sin cerrar (falta la comilla final)');
    };
    const value = (depth: number): boolean => {
        if (depth > 200) return bad(i, 'Anidamiento demasiado profundo');
        ws();
        const c = text[i];
        if (c === undefined) return bad(i, 'El JSON termina antes de tiempo (falta un valor)');
        if (c === '{') {
            i++; ws();
            if (text[i] === '}') { i++; return true; }
            for (;;) {
                ws();
                if (text[i] !== '"') return bad(i, text[i] === '}' ? 'Coma sobrante antes de "}"' : 'Se esperaba un nombre de propiedad entre comillas dobles');
                if (!str()) return false;
                ws();
                if (text[i] !== ':') return bad(i, 'Se esperaba ":" despues del nombre de la propiedad');
                i++;
                if (!value(depth + 1)) return false;
                ws();
                if (text[i] === ',') { i++; continue; }
                if (text[i] === '}') { i++; return true; }
                return bad(i, text[i] === undefined ? 'Falta "}" para cerrar el objeto' : 'Se esperaba "," o "}"');
            }
        }
        if (c === '[') {
            i++; ws();
            if (text[i] === ']') { i++; return true; }
            for (;;) {
                ws();
                if (text[i] === ']') return bad(i, 'Coma sobrante antes de "]"');
                if (!value(depth + 1)) return false;
                ws();
                if (text[i] === ',') { i++; continue; }
                if (text[i] === ']') { i++; return true; }
                return bad(i, text[i] === undefined ? 'Falta "]" para cerrar el arreglo' : 'Se esperaba "," o "]"');
            }
        }
        if (c === '"') return str();
        if (c === '-' || (c >= '0' && c <= '9')) {
            NUMBER_RE.lastIndex = i;
            const m = NUMBER_RE.exec(text);
            if (!m) return bad(i, 'Numero no valido');
            i += m[0].length;
            return true;
        }
        for (const lit of ['true', 'false', 'null']) {
            if (text.startsWith(lit, i)) { i += lit.length; return true; }
        }
        return bad(i, `Valor inesperado "${c}" (los textos van entre comillas dobles; no se admiten comentarios ni comillas simples)`);
    };
    if (!value(0)) return fail;
    ws();
    if (i < text.length) return { position: i, message: 'Contenido inesperado despues del JSON' };
    return null;
}

/** JSON.parse con mensaje en espanol y posicion (linea/columna) del error. */
export function parseJson(text: string): JsonParse {
    if (!text.trim()) return { ok: false, message: 'El texto esta vacio' };
    try {
        return { ok: true, value: JSON.parse(text) };
    } catch (error: any) {
        const found = locateJsonError(text);
        if (found) return { ok: false, message: found.message, position: found.position, ...positionToLineCol(text, found.position) };
        return { ok: false, message: String(error?.message ?? 'JSON no valido') };
    }
}

// ------------------------------------------------------------------ deteccion
export type DocumentKind = 'manifest' | 'node' | 'unknown';

const isObject = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Manifest completo (`mounts`/`overlays`/`state`...) o nodo UI suelto (`type`). */
export function detectKind(value: unknown): DocumentKind {
    if (!isObject(value)) return 'unknown';
    if (Array.isArray(value.mounts) || isObject(value.overlays)) return 'manifest';
    if (typeof value.type === 'string') return 'node';
    if (isObject(value.state) || 'id' in value || 'version' in value || 'api' in value) return 'manifest';
    return 'unknown';
}

// ------------------------------------------------------------------ analisis
export type IssueCategory = 'error' | 'deprecation' | 'warning';

export interface AnalysisIssue {
    /** Categoria original (antes de "Estricto"). */
    category: IssueCategory;
    /** Gravedad efectiva: con "Estricto" los avisos cuentan como errores. */
    severity: 'error' | 'warning';
    source: 'json' | 'manifest' | 'ui';
    path: string;
    message: string;
    code?: string;
    line?: number;
    column?: number;
}

export interface PreviewTarget {
    key: string;
    label: string;
    /** Nodo a pintar: si tiene errores, el mismo `__EXTENSION_ERROR__` que pintaria la app. */
    node: any;
    broken: boolean;
}

export interface Analysis {
    status: 'empty' | 'invalid-json' | 'ok';
    kind: DocumentKind | null;
    value?: any;
    issues: AnalysisIssue[];
    counts: { errors: number; deprecations: number; warnings: number };
    /** Problemas que bloquean (errores + avisos si `strict`). */
    blocking: number;
    targets: PreviewTarget[];
    overlays: Record<string, any>;
    state: Record<string, any>;
    extensionId: string;
    /** JSON migrado al formato nuevo (texto), si se pudo calcular. */
    migratedText?: string;
    /** true si migrar cambia algo. */
    needsMigration: boolean;
}

const ERROR_TYPE = '__EXTENSION_ERROR__';
const errorNode = (extensionId: string, issues: UiIssue[]) => ({ type: ERROR_TYPE, props: { extensionId, issues: issues.slice(0, 12).map((i) => ({ path: i.path, message: i.message })) } });
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export function analyze(text: string, options: { strict?: boolean } = {}): Analysis {
    const strict = Boolean(options.strict);
    const base: Analysis = { status: 'ok', kind: null, issues: [], counts: { errors: 0, deprecations: 0, warnings: 0 }, blocking: 0, targets: [], overlays: {}, state: {}, extensionId: 'playground', needsMigration: false };
    const raw: Array<Omit<AnalysisIssue, 'severity'>> = [];
    const finish = (): Analysis => {
        const issues: AnalysisIssue[] = raw.map((issue) => ({ ...issue, severity: issue.category === 'error' || strict ? 'error' : 'warning' }));
        const counts = {
            errors: raw.filter((i) => i.category === 'error').length,
            deprecations: raw.filter((i) => i.category === 'deprecation').length,
            warnings: raw.filter((i) => i.category === 'warning').length,
        };
        return { ...base, issues, counts, blocking: issues.filter((i) => i.severity === 'error').length };
    };

    const parsed = parseJson(text);
    if (!parsed.ok) {
        const empty = !text.trim();
        base.status = empty ? 'empty' : 'invalid-json';
        if (!empty) raw.push({ category: 'error', source: 'json', path: '$', message: parsed.message, line: parsed.line, column: parsed.column });
        return finish();
    }

    const value = parsed.value as any;
    base.value = value;
    const kind = detectKind(value);
    base.kind = kind;
    if (kind === 'unknown') {
        raw.push({ category: 'error', source: 'manifest', path: '$', message: Array.isArray(value) ? 'Se esperaba un objeto, no un arreglo: pega un manifest (con `mounts`) o un nodo {type, props, children}' : 'No parece un manifest ni un nodo de UI: falta `mounts`/`overlays` o `type`' });
        return finish();
    }

    const pushUi = (issues: UiIssue[], category: IssueCategory) => { for (const i of issues) raw.push({ category, source: 'ui', path: i.path, message: i.message, code: i.code }); };

    if (kind === 'node') {
        const { ui, notices } = migrateLegacyUi(value);
        pushUi(notices, 'deprecation');
        const verdict = validateUi(ui, { root: 'ui', checkExpression });
        pushUi(verdict.errors, 'error');
        pushUi(verdict.warnings, 'warning');
        base.targets = [{ key: 'node', label: typeof (ui as any)?.type === 'string' ? String((ui as any).type) : 'ui', node: verdict.ok ? ui : errorNode('playground', verdict.errors), broken: !verdict.ok }];
        const migratedText = pretty(ui);
        base.migratedText = migratedText;
        base.needsMigration = migratedText !== pretty(value);
        return finish();
    }

    // ---- manifest
    const extensionId = typeof value.id === 'string' && value.id ? value.id : 'playground';
    base.extensionId = extensionId;
    const verdict = validateManifest(value);
    for (const e of verdict.errors) raw.push({ category: 'error', source: 'manifest', path: e.path, message: e.message });
    for (const w of verdict.warnings) {
        if (/Componente desconocido/.test(w.message)) continue; // el schema de UI es mas preciso
        raw.push({ category: 'warning', source: 'manifest', path: w.path, message: w.message });
    }

    const normalized = { ...value, mounts: Array.isArray(value.mounts) ? value.mounts.map(normalizeMount) : value.mounts };
    const { ui: migrated, notices } = migrateManifestUi(normalized);
    pushUi(notices, 'deprecation');
    const migratedText = pretty(migrated);
    base.migratedText = migratedText;
    base.needsMigration = migratedText !== pretty(value);
    base.state = isObject(value.state) ? value.state : {};

    const check = (node: any, root: string): { ok: boolean; node: any } => {
        const result = validateUi(node, { root, checkExpression });
        pushUi(result.errors, 'error');
        pushUi(result.warnings, 'warning');
        return { ok: result.ok, node: result.ok ? node : errorNode(extensionId, result.errors) };
    };

    if (Array.isArray(migrated.mounts)) {
        migrated.mounts.forEach((mount: any, index: number) => {
            if (!isObject(mount) || !isObject(mount.component)) return;
            const result = check(mount.component, `mounts[${index}].component`);
            const point = typeof mount.point === 'string' ? mount.point : '?';
            base.targets.push({ key: `mount:${index}`, label: `mounts[${index}] - ${point}${mount.path ? ` (${mount.path})` : ''}`, node: result.node, broken: !result.ok });
        });
    }
    if (isObject(migrated.overlays)) {
        for (const id of Object.keys(migrated.overlays)) {
            const result = check(migrated.overlays[id], `overlays.${id}`);
            base.overlays[id] = result.node;
            base.targets.push({ key: `overlay:${id}`, label: `overlays.${id}`, node: result.node, broken: !result.ok });
        }
    }
    if (base.targets.length === 0 && verdict.ok) {
        raw.push({ category: 'warning', source: 'manifest', path: 'mounts', message: 'El manifest no tiene ningun mount ni overlay con `component`: no hay nada que previsualizar' });
    }
    return finish();
}

/** Agrupa problemas por origen para el panel (json / manifest / ui). */
export function groupIssues(issues: AnalysisIssue[], category: IssueCategory): Array<{ source: AnalysisIssue['source']; issues: AnalysisIssue[] }> {
    const order: AnalysisIssue['source'][] = ['json', 'manifest', 'ui'];
    return order
        .map((source) => ({ source, issues: issues.filter((i) => i.source === source && i.category === category) }))
        .filter((g) => g.issues.length > 0);
}
