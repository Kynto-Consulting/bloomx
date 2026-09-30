'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Search as SearchIcon, Maximize2, Minimize2 } from 'lucide-react';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { linter, lintGutter, forceLinting, type Diagnostic } from '@codemirror/lint';

// ─── CodeMirror 6 imports ───────────────────────────────────────────────────
import {
    EditorView, ViewPlugin, Decoration, DecorationSet,
    ViewUpdate, keymap, lineNumbers, drawSelection,
    highlightActiveLine, highlightActiveLineGutter,
    rectangularSelection, crosshairCursor, dropCursor,
} from '@codemirror/view';
import { EditorState, RangeSetBuilder, Extension, Compartment } from '@codemirror/state';
import {
    history, defaultKeymap, historyKeymap, indentWithTab,
    undo, redo,
} from '@codemirror/commands';
import {
    autocompletion, CompletionContext, CompletionResult,
    snippet, Completion, closeBrackets, closeBracketsKeymap,
    completionKeymap,
} from '@codemirror/autocomplete';
import { html } from '@codemirror/lang-html';
import {
    syntaxHighlighting, HighlightStyle, bracketMatching,
    indentOnInput, foldGutter, foldKeymap,
} from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { useTheme } from '@/components/ThemeProvider';
import { validateTemplate } from '@/lib/liquid';
import {
    FILTER_CATALOG, TAG_CATALOG, SYSTEM_VARIABLES, FORLOOP_PROPS, CONDITION_OPERATORS, BUILTIN_VARIABLE_NAMES,
    variableExpression, extractDefinedVariables,
} from '@/lib/liquid-catalog';

// ─── Catalogos (fuente unica en src/lib/liquid-catalog.ts, verificada contra el motor en los tests) ───

const LIQUID_FILTERS: Completion[] = FILTER_CATALOG.map(f => ({
    label: f.name,
    detail: f.detail,
    type: 'function',
    apply: f.apply,
    boost: f.boost,
}));

const LIQUID_TAG_SNIPPETS: Completion[] = TAG_CATALOG.map(t => ({
    label: t.label,
    detail: t.detail,
    type: 'keyword',
    boost: t.boost,
    info: t.info,
    apply: snippet(t.snippet),
}));

const OPERATOR_OPTIONS: Completion[] = CONDITION_OPERATORS.map(o => ({ label: o, type: 'keyword', apply: `${o} ` }));
const FORLOOP_OPTIONS: Completion[] = FORLOOP_PROPS.map(p => ({ label: p, type: 'property' }));

// ─── Liquid syntax highlight plugin ─────────────────────────────────────────

const liquidHighlightPlugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;
        constructor(view: EditorView) { this.decorations = buildDecorations(view); }
        update(u: ViewUpdate) {
            if (u.docChanged || u.viewportChanged) this.decorations = buildDecorations(u.view);
        }
    },
    { decorations: v => v.decorations }
);

function buildDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const entries: { from: number; to: number; cls: string }[] = [];

    for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        // Match {{ expr }} and {%- tag -%}
        const re = /(\{\{-?)([\s\S]*?)(-?\}\})|(\{%-?)([\s\S]*?)(-?%\})/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            const start = from + m.index;
            const end = start + m[0].length;
            const isExpr = m[0].startsWith('{{');
            entries.push({ from: start, to: end, cls: isExpr ? 'liq-expr' : 'liq-tag' });
        }
    }

    // Sort by from (builder requires sorted order)
    entries.sort((a, b) => a.from - b.from);
    // Remove overlapping ranges
    let lastTo = -1;
    for (const e of entries) {
        if (e.from >= lastTo) {
            builder.add(e.from, e.to, Decoration.mark({ class: e.cls }));
            lastTo = e.to;
        }
    }
    return builder.finish();
}

// ─── Autocomplete source ─────────────────────────────────────────────────────

interface VarSources {
    columns: string[];
    system: string[];
}

function variableOptions(src: VarSources, doc: string): Completion[] {
    const opts: Completion[] = [];
    const seen = new Set<string>();
    const add = (name: string, detail: string, boost: number, apply?: string) => {
        if (seen.has(name)) return;
        seen.add(name);
        opts.push({ label: name, type: 'variable', detail, boost, apply: apply ?? name });
    };
    for (const c of src.columns) add(c, 'columna', 15, variableExpression(c));
    for (const d of extractDefinedVariables(doc)) add(d, 'plantilla', 13);
    for (const s of src.system) {
        const doc2 = SYSTEM_VARIABLES.find(v => v.name === s);
        add(s, doc2?.detail ?? 'sistema', 8);
    }
    add('forloop', 'dentro de un for', 6);
    add('row', 'fila completa: row["Columna (x)"]', 2);
    return opts;
}

function makeLiquidCompletions(getSources: () => VarSources) {
    return function liquidCompletions(context: CompletionContext): CompletionResult | null {
        const { state, pos } = context;
        const line = state.doc.lineAt(pos);
        const before = line.text.slice(0, pos - line.from);
        const doc = state.doc.toString();

        // Propiedades de forloop:  {{ forloop.  /  {% if forloop.
        const forloop = before.match(/(?:\{\{-?|\{%-?)[^}%]*\bforloop\.(\w*)$/);
        if (forloop) return { from: pos - forloop[1].length, options: FORLOOP_OPTIONS, validFor: /^\w*$/ };

        // Filtros: tras CUALQUIER "|" dentro de {{ }} o de assign/echo, tambien en cadenas (a | upcase | tr...)
        const afterPipe = before.match(/(?:\{\{-?|\{%-?\s*(?:assign|echo)\b)[^}%]*\|\s*(\w*)$/);
        if (afterPipe) {
            const typed = afterPipe[1];
            return { from: pos - typed.length, options: LIQUID_FILTERS, validFor: /^\w*$/ };
        }

        // Operadores de comparacion tras "{% if variable "
        const afterOperand = before.match(/\{%-?\s*(?:if|unless|elsif)\s+(?:[^%]*?\s)?[\p{L}\p{N}_.\]"]+\s+(\w*)$/u);
        if (afterOperand && !/\b(contains|and|or|==|!=|<|>)\s+\w*$/.test(before)) {
            const typed = afterOperand[1];
            return { from: pos - typed.length, options: OPERATOR_OPTIONS, validFor: /^\w*$/ };
        }

        // Variables tras {{ o en {% if / unless / elsif / case / when / for ... in / assign x = / echo
        const varCtx =
            before.match(/\{\{-?\s*([\p{L}\p{N}_.]*)$/u) ||
            before.match(/\{%-?\s*(?:if|unless|elsif|case|when|echo)\s+(?:.*?\b(?:and|or|contains|==|!=|<=|>=|<|>)\s+|)([\p{L}\p{N}_.]*)$/u) ||
            before.match(/\{%-?\s*for\s+\w+\s+in\s+([\p{L}\p{N}_.]*)$/u) ||
            before.match(/\{%-?\s*assign\s+[\p{L}\p{N}_-]+\s*=\s*([\p{L}\p{N}_.]*)$/u);
        if (varCtx) {
            const typed = varCtx[1];
            return {
                from: pos - typed.length,
                options: variableOptions(getSources(), doc),
                validFor: /^[\p{L}\p{N}_.]*$/u,
            };
        }

        // Tags tras {%
        const afterTagBrace = before.match(/\{%-?\s*(\w*)$/);
        if (afterTagBrace) {
            const typed = afterTagBrace[1];
            return { from: pos - typed.length, options: LIQUID_TAG_SNIPPETS, validFor: /^\w*$/ };
        }

        return null;
    };
}

// ─── Auto-pair {{ y {% ────────────────────────────────────────────────────────

/**
 * closeBrackets ya inserta "}" al teclear "{". Al teclear el segundo "{" (o "%") completamos hasta
 * `{{ | }}` / `{% | %}` reutilizando ese "}" para no dejar llaves de mas.
 */
function makeLiquidPairs(): Extension {
    return EditorView.inputHandler.of((view, from, to, text) => {
        if (text !== '{' && text !== '%') return false;
        if (from !== to) return false;
        const doc = view.state.doc;
        const charBefore = doc.sliceString(Math.max(0, from - 1), from);
        if (charBefore !== '{') return false;
        const charAfter = doc.sliceString(from, from + 1);
        const open = text === '{' ? '{' : '%';
        const close = text === '{' ? '}' : '%';
        // Con "}" autocerrado: "{|}" -> "{{ | }}" ; sin el: "{|" -> "{{ | }}"
        const insert = charAfter === '}' ? `${open}  ${close}` : `${open}  ${close}}`;
        view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + 2 },
            userEvent: 'input.type',
        });
        return true;
    });
}

// ─── Lint ────────────────────────────────────────────────────────────────────

function makeLiquidLinter(getKnown: () => string[] | undefined, onStatus: (errors: number, warnings: number) => void) {
    return linter((view: EditorView): Diagnostic[] => {
        const src = view.state.doc.toString();
        const found = validateTemplate(src, { knownVariables: getKnown() });
        const len = src.length;
        onStatus(found.filter(d => d.severity === 'error').length, found.filter(d => d.severity === 'warning').length);
        return found.map(d => ({
            from: Math.min(d.from, len),
            to: Math.min(Math.max(d.to, d.from + 1), len),
            severity: d.severity,
            message: d.message,
            source: 'liquid',
        }));
    }, { delay: 250 });
}

// ─── Theme ───────────────────────────────────────────────────────────────────

/**
 * Resaltado de sintaxis basado en TOKENS del tema (no en colores fijos): asi se lee en claro y en
 * cualquier tema oscuro. defaultHighlightStyle usa azules/verdes oscuros pensados para fondo blanco y
 * quedaba ilegible en oscuro. Todos estos tokens cumplen AA sobre `background` (npm run check:themes).
 */
const liquidHighlight = HighlightStyle.define([
    { tag: [t.tagName, t.standard(t.tagName)], color: 'var(--color-info)' },
    { tag: [t.attributeName, t.propertyName], color: 'var(--color-brand-accent)' },
    { tag: [t.attributeValue, t.string], color: 'var(--color-success)' },
    { tag: [t.number, t.bool, t.atom, t.null], color: 'var(--color-warning)' },
    { tag: [t.keyword, t.operatorKeyword, t.controlKeyword], color: 'var(--color-destructive)' },
    { tag: [t.comment, t.blockComment, t.lineComment], color: 'var(--color-muted-foreground)', fontStyle: 'italic' },
    { tag: [t.angleBracket, t.bracket, t.punctuation, t.separator, t.operator], color: 'var(--color-muted-foreground)' },
    { tag: [t.processingInstruction, t.documentMeta, t.meta], color: 'var(--color-muted-foreground)' },
    { tag: [t.heading, t.strong], fontWeight: '700' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.link, color: 'var(--color-primary)', textDecoration: 'underline' },
    { tag: t.invalid, color: 'var(--color-destructive)', textDecoration: 'underline wavy' },
]);

/** `dark` le dice a CodeMirror que estilos base usar (seleccion, cursor, paneles...). */
function buildLiquidTheme(dark: boolean): Extension {
  return EditorView.theme({
    '&': {
        backgroundColor: 'var(--color-background)',
        color: 'var(--color-foreground)',
        height: '100%',
        fontSize: '12.5px',
        fontFamily: '"Fira Code", "JetBrains Mono", ui-monospace, monospace',
    },
    '.cm-scroller': { overflow: 'auto' },
    '.cm-content': { padding: '12px 0', minHeight: '100%' },
    '.cm-line': { padding: '0 16px' },
    '.cm-gutters': {
        backgroundColor: 'var(--color-muted)',
        borderRight: '1px solid var(--color-border)',
        color: 'var(--color-muted-foreground)',
        fontSize: '11px',
    },
    '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--color-muted) 70%, transparent)' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--color-muted) 30%, transparent)' },
    '.cm-cursor': { borderLeftColor: 'var(--color-foreground)' },
    '.cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--color-primary) 28%, transparent) !important' },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--color-primary) 38%, transparent) !important' },
    // Liquid highlight classes
    '.liq-expr': { color: 'var(--color-primary)', fontWeight: '600' },
    '.liq-tag': { color: 'var(--color-warning)', fontWeight: '600' },
    // Autocomplete popup
    '.cm-tooltip.cm-tooltip-autocomplete': {
        border: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-popover)',
        borderRadius: '10px',
        boxShadow: '0 8px 24px color-mix(in srgb, var(--color-foreground) 14%, transparent)',
        overflow: 'hidden',
        minWidth: '260px',
        maxWidth: '380px',
    },
    '.cm-tooltip-autocomplete > ul': { maxHeight: '240px' },
    '.cm-tooltip-autocomplete > ul > li': {
        padding: '5px 12px',
        lineHeight: '1.5',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'var(--color-accent)',
        color: 'var(--color-accent-foreground)',
    },
    '.cm-completionLabel': { fontFamily: '"Fira Code", monospace', fontSize: '12px' },
    '.cm-completionDetail': {
        marginLeft: '8px',
        fontSize: '11px',
        color: 'var(--color-muted-foreground)',
        fontStyle: 'normal',
        opacity: 0.8,
    },
    '.cm-completionIcon': { fontSize: '14px', width: '16px', textAlign: 'center' },
    '.cm-completionIcon-variable::after': { content: '"⬡"', color: 'var(--color-primary)' },
    '.cm-completionIcon-function::after': { content: '"ƒ"', color: 'var(--color-info)' },
    '.cm-completionIcon-keyword::after': { content: '"%"', color: 'var(--color-warning)' },
    // Search panel
    '.cm-panels': { backgroundColor: 'var(--color-muted)', borderTop: '1px solid var(--color-border)' },
    '.cm-search': { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px', padding: '6px 8px', fontSize: '12px' },
    '.cm-search input': { borderRadius: '6px', border: '1px solid var(--color-border)', padding: '2px 6px', fontSize: '12px', backgroundColor: 'var(--color-background)' },
    '.cm-search button': { borderRadius: '6px', border: '1px solid var(--color-border)', padding: '2px 8px', fontSize: '11px', cursor: 'pointer', backgroundColor: 'var(--color-background)' },
    '.cm-search label': { fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px' },
    // Tooltip / info panel
    '.cm-tooltip': {
        border: '1px solid var(--color-border)',
        borderRadius: '8px',
        backgroundColor: 'var(--color-popover)',
        padding: '6px 10px',
        fontSize: '12px',
        color: 'var(--color-popover-foreground)',
    },
    '.cm-diagnostic': { padding: '3px 6px 3px 8px', fontSize: '12px' },
    '.cm-diagnostic-error': { borderLeft: '4px solid var(--color-destructive)' },
    '.cm-diagnostic-warning': { borderLeft: '4px solid var(--color-warning)' },
    '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--color-destructive)', textUnderlineOffset: '3px' },
    '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--color-warning)', textUnderlineOffset: '3px' },
    '&.cm-focused': { outline: '2px solid var(--color-ring)', outlineOffset: '-2px' },
    '.cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--color-primary) 25%, transparent)', outline: '1px solid var(--color-input)' },
    '.cm-nonmatchingBracket': { color: 'var(--color-destructive)' },
    '.cm-foldPlaceholder': { backgroundColor: 'var(--color-muted)', border: '1px solid var(--color-border)', color: 'var(--color-muted-foreground)' },
    '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--color-warning) 30%, transparent)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--color-warning) 55%, transparent)' },
  }, { dark });
}

// ─── Editor Component ─────────────────────────────────────────────────────────

export interface LiquidEditorHandle {
    /** Inserta texto en la posicion del cursor (reemplaza la seleccion) y devuelve el foco al editor. */
    insertAtCursor: (text: string) => void;
    focus: () => void;
}

export interface LiquidEditorProps {
    value: string;
    onChange: (value: string) => void;
    /** Columnas del archivo. */
    variables: string[];
    /** Variables de sistema disponibles (default: catalogo). */
    systemVariables?: string[];
    className?: string;
    isFullscreen?: boolean;
    onToggleFullscreen?: () => void;
    /** Notifica (errores, advertencias) del lint en vivo. */
    onLintStatus?: (errors: number, warnings: number) => void;
}

const DEFAULT_SYSTEM_VARS = SYSTEM_VARIABLES.map(v => v.name);

export const LiquidEditor = forwardRef<LiquidEditorHandle, LiquidEditorProps>(function LiquidEditor(
    { value, onChange, variables, systemVariables, className, isFullscreen, onToggleFullscreen, onLintStatus }, ref,
) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const lastValueRef = useRef<string>(value);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const onLintStatusRef = useRef(onLintStatus);
    onLintStatusRef.current = onLintStatus;
    // Refs "vivas": el editor se monta una sola vez, pero siempre lee los ultimos valores.
    const sourcesRef = useRef<VarSources>({ columns: variables, system: systemVariables ?? DEFAULT_SYSTEM_VARS });
    sourcesRef.current = { columns: variables, system: systemVariables ?? DEFAULT_SYSTEM_VARS };
    const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
    const [lint, setLint] = useState({ errors: 0, warnings: 0 });
    const { scheme } = useTheme();
    const themeCompartment = useRef(new Compartment());
    const schemeRef = useRef(scheme);
    schemeRef.current = scheme;

    useImperativeHandle(ref, () => ({
        insertAtCursor(text: string) {
            const view = viewRef.current;
            if (!view) return;
            const { from, to } = view.state.selection.main;
            view.dispatch({
                changes: { from, to, insert: text },
                selection: { anchor: from + text.length },
                scrollIntoView: true,
                userEvent: 'input.paste',
            });
            view.focus();
        },
        focus() { viewRef.current?.focus(); },
    }), []);

    useEffect(() => {
        if (!containerRef.current) return;

        const extensions: Extension[] = [
            // Language
            html(),
            syntaxHighlighting(liquidHighlight),

            // Editor features
            lineNumbers(),
            foldGutter(),
            lintGutter(),
            drawSelection(),
            dropCursor(),
            highlightActiveLine(),
            highlightActiveLineGutter(),
            rectangularSelection(),
            crosshairCursor(),
            bracketMatching(),
            indentOnInput(),
            history(),

            // Liquid-specific (antes de closeBrackets para que el input handler tenga prioridad)
            liquidHighlightPlugin,
            makeLiquidPairs(),
            makeLiquidLinter(
                () => [...sourcesRef.current.columns, ...sourcesRef.current.system, ...BUILTIN_VARIABLE_NAMES],
                (errors, warnings) => {
                    setLint(prev => (prev.errors === errors && prev.warnings === warnings ? prev : { errors, warnings }));
                    onLintStatusRef.current?.(errors, warnings);
                },
            ),

            // Autocomplete
            closeBrackets(),
            autocompletion({
                override: [makeLiquidCompletions(() => sourcesRef.current)],
                activateOnTyping: true,
                maxRenderedOptions: 30,
            }),

            // Search
            search({ top: false }),

            // Keymaps
            keymap.of([
                ...closeBracketsKeymap,
                ...defaultKeymap,
                ...historyKeymap,
                ...foldKeymap,
                ...completionKeymap,
                ...searchKeymap,
                indentWithTab,
            ]),

            // Theme (compartment: se reconfigura al cambiar entre tema claro y oscuro sin recrear el editor)
            themeCompartment.current.of(buildLiquidTheme(schemeRef.current === 'dark')),

            // Update listener
            EditorView.updateListener.of((update) => {
                if (update.docChanged) {
                    const newValue = update.state.doc.toString();
                    lastValueRef.current = newValue;
                    onChangeRef.current(newValue);
                }
                if (update.docChanged || update.selectionSet) {
                    const pos = update.state.selection.main.head;
                    const line = update.state.doc.lineAt(pos);
                    setCursorPos({ line: line.number, col: pos - line.from + 1 });
                }
            }),

            EditorView.lineWrapping,
        ];

        const state = EditorState.create({ doc: value, extensions });
        const view = new EditorView({ state, parent: containerRef.current });
        viewRef.current = view;

        return () => {
            view.destroy();
            viewRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Only on mount

    // Sync external value changes (e.g. template import)
    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        const current = view.state.doc.toString();
        if (value !== current && value !== lastValueRef.current) {
            view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
            lastValueRef.current = value;
        }
    }, [value]);

    // Si cambian las columnas, revalidar (variables desconocidas) sin tocar el documento.
    const columnsKey = variables.join('\u0000');
    useEffect(() => {
        if (viewRef.current) forceLinting(viewRef.current);
    }, [columnsKey]);

    // Tema claro/oscuro real
    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({ effects: themeCompartment.current.reconfigure(buildLiquidTheme(scheme === 'dark')) });
    }, [scheme]);

    return (
        <div className={`flex flex-col ${className ?? ''}`} style={{ height: '100%', minHeight: 0 }}>
            {/* Editor toolbar */}
            <div className="flex items-center gap-2 px-2 py-1 border-b border-border bg-muted/30 shrink-0">
                <span className="text-[11px] text-muted-foreground font-mono select-none">
                    Ln {cursorPos.line}, Col {cursorPos.col}
                </span>
                <span
                    role="status"
                    aria-live="polite"
                    className={`text-[11px] select-none ${lint.errors ? 'text-destructive font-semibold' : lint.warnings ? 'text-warning' : 'text-success'}`}
                    title="Validación de sintaxis Liquid en vivo"
                >
                    {lint.errors
                        ? `${lint.errors} error${lint.errors > 1 ? 'es' : ''} de sintaxis`
                        : lint.warnings
                            ? `${lint.warnings} advertencia${lint.warnings > 1 ? 's' : ''}`
                            : 'Sintaxis correcta'}
                </span>
                <div className="ml-auto flex items-center gap-0.5">
                    <button
                        type="button"
                        onClick={() => viewRef.current && openSearchPanel(viewRef.current)}
                        title="Buscar / reemplazar (Ctrl+F)"
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <SearchIcon className="h-3.5 w-3.5" />
                    </button>
                    {onToggleFullscreen && (
                        <button
                            type="button"
                            onClick={onToggleFullscreen}
                            title={isFullscreen ? 'Salir de pantalla completa (Esc)' : 'Pantalla completa'}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        >
                            {isFullscreen
                                ? <Minimize2 className="h-3.5 w-3.5" />
                                : <Maximize2 className="h-3.5 w-3.5" />}
                        </button>
                    )}
                </div>
            </div>
            <div
                ref={containerRef}
                className="flex-1 min-h-0"
                style={{ minHeight: 0 }}
            />
        </div>
    );
});
