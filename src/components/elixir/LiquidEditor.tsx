'use client';

import { useEffect, useRef, useCallback } from 'react';

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
    syntaxHighlighting, defaultHighlightStyle, bracketMatching,
    indentOnInput, foldGutter, foldKeymap,
} from '@codemirror/language';

// ─── Liquid filter catalog ──────────────────────────────────────────────────

const LIQUID_FILTERS: Completion[] = [
    // String
    { label: 'upcase',           detail: '→ "HELLO"',           type: 'function', boost: 10 },
    { label: 'downcase',         detail: '→ "hello"',           type: 'function', boost: 10 },
    { label: 'capitalize',       detail: '→ "Hello"',           type: 'function', boost: 10 },
    { label: 'strip',            detail: 'Remove whitespace',   type: 'function' },
    { label: 'lstrip',           detail: 'Remove leading ws',   type: 'function' },
    { label: 'rstrip',           detail: 'Remove trailing ws',  type: 'function' },
    { label: 'strip_html',       detail: 'Remove HTML tags',    type: 'function' },
    { label: 'newline_to_br',    detail: '\\n → <br>',          type: 'function' },
    { label: 'escape',           detail: 'HTML escape',         type: 'function' },
    { label: 'url_encode',       detail: 'URL encode',          type: 'function' },
    { label: 'size',             detail: 'String length',       type: 'function' },
    { label: 'reverse',          detail: 'Reverse string',      type: 'function' },
    // Truncate
    { label: 'truncate: 50',                   detail: 'Truncate chars',        type: 'function', apply: 'truncate: 50' },
    { label: 'truncate: 50, "…"',              detail: 'Truncate w/ ellipsis',  type: 'function', apply: 'truncate: 50, "…"' },
    { label: 'truncatewords: 10',              detail: 'Truncate words',        type: 'function', apply: 'truncatewords: 10' },
    // Replace / remove
    { label: 'replace: "old", "new"',  detail: 'Replace all',         type: 'function', apply: 'replace: "old", "new"' },
    { label: 'replace_first: "o","n"', detail: 'Replace first',       type: 'function', apply: 'replace_first: "old", "new"' },
    { label: 'remove: "text"',         detail: 'Remove all occurrences', type: 'function', apply: 'remove: "text"' },
    { label: 'prepend: "text"',        detail: 'Add before value',    type: 'function', apply: 'prepend: ""', boost: 5 },
    { label: 'append: "text"',         detail: 'Add after value',     type: 'function', apply: 'append: ""', boost: 5 },
    // Default
    { label: 'default: "text"',        detail: 'Fallback if empty',   type: 'function', apply: 'default: ""', boost: 20 },
    // Numeric
    { label: 'plus: 1',        detail: 'Add',      type: 'function', apply: 'plus: 1' },
    { label: 'minus: 1',       detail: 'Subtract', type: 'function', apply: 'minus: 1' },
    { label: 'times: 2',       detail: 'Multiply', type: 'function', apply: 'times: 2' },
    { label: 'divided_by: 2',  detail: 'Divide',   type: 'function', apply: 'divided_by: 2' },
    { label: 'modulo: 2',      detail: 'Modulo',   type: 'function', apply: 'modulo: 2' },
    { label: 'abs',            detail: 'Absolute', type: 'function' },
    { label: 'ceil',           detail: 'Round up', type: 'function' },
    { label: 'floor',          detail: 'Round down', type: 'function' },
    { label: 'round',          detail: 'Round',    type: 'function' },
    { label: 'round: 2',       detail: 'Round N decimals', type: 'function', apply: 'round: 2' },
    // Date
    { label: 'date: "%B %d, %Y"',  detail: 'Format: January 15, 2024', type: 'function', apply: 'date: "%B %d, %Y"', boost: 8 },
    { label: 'date: "%d/%m/%Y"',   detail: 'Format: 15/01/2024',       type: 'function', apply: 'date: "%d/%m/%Y"' },
    { label: 'date: "%Y-%m-%d"',   detail: 'Format: 2024-01-15',       type: 'function', apply: 'date: "%Y-%m-%d"' },
    { label: 'date: "%H:%M"',      detail: 'Format: 14:30',            type: 'function', apply: 'date: "%H:%M"' },
];

// ─── Liquid tag snippets ─────────────────────────────────────────────────────

const LIQUID_TAG_SNIPPETS: Completion[] = [
    {
        label: 'if',
        detail: '{% if %}...{% endif %}',
        type: 'keyword',
        boost: 20,
        apply: snippet('{% if #{condition} %}\n  #{}\n{% endif %}'),
        info: 'Conditional block',
    },
    {
        label: 'if/else',
        detail: '{% if %}...{% else %}...{% endif %}',
        type: 'keyword',
        boost: 18,
        apply: snippet('{% if #{condition} %}\n  #{if_content}\n{% else %}\n  #{else_content}\n{% endif %}'),
    },
    {
        label: 'if/elsif',
        detail: '{% if %}...{% elsif %}...{% endif %}',
        type: 'keyword',
        boost: 15,
        apply: snippet('{% if #{cond1} %}\n  #{}\n{% elsif #{cond2} %}\n  #{}\n{% else %}\n  #{}\n{% endif %}'),
    },
    {
        label: 'unless',
        detail: '{% unless %}...{% endunless %}',
        type: 'keyword',
        boost: 12,
        apply: snippet('{% unless #{condition} %}\n  #{}\n{% endunless %}'),
    },
    {
        label: 'assign',
        detail: '{% assign var = value %}',
        type: 'keyword',
        boost: 10,
        apply: snippet('{% assign #{name} = #{value} %}'),
    },
    {
        label: 'capture',
        detail: '{% capture %}...{% endcapture %}',
        type: 'keyword',
        apply: snippet('{% capture #{name} %}\n  #{}\n{% endcapture %}'),
    },
    {
        label: 'comment',
        detail: '{% comment %}...{% endcomment %}',
        type: 'keyword',
        apply: snippet('{%- comment -%}\n  #{}\n{%- endcomment -%}'),
    },
];

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

function makeLiquidCompletions(getVariables: () => string[]) {
    return function liquidCompletions(context: CompletionContext): CompletionResult | null {
        const { state, pos } = context;
        const line = state.doc.lineAt(pos);
        const before = line.text.slice(0, pos - line.from);

        // ── Context: inside {{ ... | (after pipe) → filter completions ──────
        // e.g.  "{{ nombre | " or "{{ nombre | up"
        const afterPipe = before.match(/\{\{-?\s*[\w\s.]+\|\s*([\w_]*)$/);
        if (afterPipe) {
            const typed = afterPipe[1];
            return {
                from: pos - typed.length,
                options: LIQUID_FILTERS,
                validFor: /^[\w_]*$/,
            };
        }

        // ── Context: inside {{ (variable expression start) ───────────────────
        // e.g.  "{{ no" or "{{no"
        const afterDblBrace = before.match(/\{\{-?\s*([\w.]*)$/);
        if (afterDblBrace) {
            const typed = afterDblBrace[1];
            const variables = getVariables();
            const varOptions: Completion[] = variables.map(v => ({
                label: v,
                type: 'variable',
                boost: 15,
                apply: (view, _c, from2, to2) => {
                    // Insert: varname | default: "" }}
                    view.dispatch({
                        changes: { from: from2, to: to2, insert: `${v} }}` },
                        selection: { anchor: from2 + v.length + 4 },
                    });
                },
                info: `Column: ${v}`,
            }));

            // Also offer "varname | filter" variants for common combos
            const quickOptions: Completion[] = variables.flatMap(v => [
                {
                    label: `${v} | default: ""`,
                    type: 'variable',
                    boost: 12,
                    apply: (view: EditorView, _c: Completion, from2: number, to2: number) => {
                        view.dispatch({ changes: { from: from2, to: to2, insert: `${v} | default: "" }}` }, selection: { anchor: from2 + v.length + 13 } });
                    },
                } as Completion,
                {
                    label: `${v} | upcase`,
                    type: 'variable',
                    boost: 5,
                    apply: (view: EditorView, _c: Completion, from2: number, to2: number) => {
                        view.dispatch({ changes: { from: from2, to: to2, insert: `${v} | upcase }}` } });
                    },
                } as Completion,
            ]);

            return {
                from: pos - typed.length,
                options: [...varOptions, ...quickOptions],
                validFor: /^[\w. |]*$/,
            };
        }

        // ── Context: inside {% (tag) ─────────────────────────────────────────
        const afterTagBrace = before.match(/\{%-?\s*([\w]*)$/);
        if (afterTagBrace) {
            const typed = afterTagBrace[1];
            return {
                from: pos - typed.length,
                options: LIQUID_TAG_SNIPPETS,
                validFor: /^[\w]*$/,
            };
        }

        // ── Context: inside {% if | unless condition → suggest variables ──────
        const afterIfCond = before.match(/\{%-?\s*(?:if|unless|elsif)\s+([\w.]*)$/);
        if (afterIfCond) {
            const typed = afterIfCond[1];
            const variables = getVariables();
            const condOptions: Completion[] = variables.flatMap(v => [
                { label: v,                           type: 'variable', boost: 15 } as Completion,
                { label: `${v} == ""`,                type: 'variable', boost: 10, apply: `${v} == ""` } as Completion,
                { label: `${v} != ""`,                type: 'variable', boost: 9,  apply: `${v} != ""` } as Completion,
                { label: `${v} contains ""`,          type: 'variable', boost: 8,  apply: `${v} contains ""` } as Completion,
                { label: `${v} > 0`,                  type: 'variable', boost: 6,  apply: `${v} > 0` } as Completion,
            ]);
            return {
                from: pos - typed.length,
                options: condOptions,
                validFor: /^[\w.!= <>"']*$/,
            };
        }

        // ── Context: inside {% assign varname = → suggest variables ───────────
        const afterAssignEq = before.match(/\{%-?\s*assign\s+\w+\s*=\s*([\w.]*)$/);
        if (afterAssignEq) {
            const typed = afterAssignEq[1];
            const variables = getVariables();
            return {
                from: pos - typed.length,
                options: variables.map(v => ({ label: v, type: 'variable' } as Completion)),
                validFor: /^[\w.]*$/,
            };
        }

        return null;
    };
}

// ─── Auto-pair {{ and {% ─────────────────────────────────────────────────────

function makeLiquidPairs(): Extension {
    return keymap.of([
        {
            key: '{',
            run(view) {
                const { from, to } = view.state.selection.main;
                const charBefore = view.state.doc.sliceString(Math.max(0, from - 1), from);
                if (charBefore === '{') {
                    // Second { typed → insert space + closing }}
                    view.dispatch({
                        changes: { from, to, insert: '  }}' },
                        selection: { anchor: from + 1 },
                    });
                    return true;
                }
                if (charBefore === '%') {
                    // {% typed → insert space + %}
                    view.dispatch({
                        changes: { from, to, insert: '  %}' },
                        selection: { anchor: from + 1 },
                    });
                    return true;
                }
                return false;
            },
        },
    ]);
}

// ─── Theme ───────────────────────────────────────────────────────────────────

const liquidTheme = EditorView.theme({
    '&': {
        height: '100%',
        fontSize: '12.5px',
        fontFamily: '"Fira Code", "JetBrains Mono", ui-monospace, monospace',
    },
    '.cm-scroller': { overflow: 'auto' },
    '.cm-content': { padding: '12px 0', minHeight: '100%' },
    '.cm-line': { padding: '0 16px' },
    '.cm-gutters': {
        backgroundColor: 'hsl(var(--muted))',
        borderRight: '1px solid hsl(var(--border))',
        color: 'hsl(var(--muted-foreground))',
        fontSize: '11px',
    },
    '.cm-activeLineGutter': { backgroundColor: 'hsl(var(--muted) / 0.7)' },
    '.cm-activeLine': { backgroundColor: 'hsl(var(--muted) / 0.3)' },
    '.cm-cursor': { borderLeftColor: 'hsl(var(--foreground))' },
    '.cm-selectionBackground': { backgroundColor: 'hsl(var(--primary) / 0.2) !important' },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: 'hsl(var(--primary) / 0.25) !important' },
    // Liquid highlight classes
    '.liq-expr': { color: '#7c3aed', fontWeight: '600' },
    '.liq-tag': { color: '#d97706', fontWeight: '600' },
    // Autocomplete popup
    '.cm-tooltip.cm-tooltip-autocomplete': {
        border: '1px solid hsl(var(--border))',
        backgroundColor: 'hsl(var(--popover))',
        borderRadius: '10px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
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
        backgroundColor: 'hsl(var(--accent))',
        color: 'hsl(var(--accent-foreground))',
    },
    '.cm-completionLabel': { fontFamily: '"Fira Code", monospace', fontSize: '12px' },
    '.cm-completionDetail': {
        marginLeft: '8px',
        fontSize: '11px',
        color: 'hsl(var(--muted-foreground))',
        fontStyle: 'normal',
        opacity: 0.8,
    },
    '.cm-completionIcon': { fontSize: '14px', width: '16px', textAlign: 'center' },
    '.cm-completionIcon-variable::after': { content: '"⬡"', color: '#7c3aed' },
    '.cm-completionIcon-function::after': { content: '"ƒ"', color: '#0891b2' },
    '.cm-completionIcon-keyword::after': { content: '"%"', color: '#d97706' },
    // Tooltip / info panel
    '.cm-tooltip': {
        border: '1px solid hsl(var(--border))',
        borderRadius: '8px',
        backgroundColor: 'hsl(var(--popover))',
        padding: '6px 10px',
        fontSize: '12px',
        color: 'hsl(var(--popover-foreground))',
    },
});

// ─── Editor Component ─────────────────────────────────────────────────────────

export interface LiquidEditorProps {
    value: string;
    onChange: (value: string) => void;
    variables: string[];
    className?: string;
}

export function LiquidEditor({ value, onChange, variables, className }: LiquidEditorProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const lastValueRef = useRef<string>(value);
    const getVariables = useCallback(() => variables, [variables]);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useEffect(() => {
        if (!containerRef.current) return;

        const extensions: Extension[] = [
            // Language
            html(),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),

            // Editor features
            lineNumbers(),
            foldGutter(),
            drawSelection(),
            dropCursor(),
            highlightActiveLine(),
            highlightActiveLineGutter(),
            rectangularSelection(),
            crosshairCursor(),
            bracketMatching(),
            indentOnInput(),
            history(),

            // Liquid-specific
            liquidHighlightPlugin,
            makeLiquidPairs(),

            // Autocomplete
            closeBrackets(),
            autocompletion({
                override: [makeLiquidCompletions(() => getVariables())],
                activateOnTyping: true,
                maxRenderedOptions: 20,
            }),

            // Keymaps
            keymap.of([
                ...closeBracketsKeymap,
                ...defaultKeymap,
                ...historyKeymap,
                ...foldKeymap,
                ...completionKeymap,
                indentWithTab,
            ]),

            // Theme
            liquidTheme,

            // Update listener
            EditorView.updateListener.of((update) => {
                if (update.docChanged) {
                    const newValue = update.state.doc.toString();
                    lastValueRef.current = newValue;
                    onChangeRef.current(newValue);
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
            // External update
            view.dispatch({
                changes: { from: 0, to: current.length, insert: value },
            });
            lastValueRef.current = value;
        }
    }, [value]);

    // Sync variables for autocomplete (no remount needed — closure reads latest via getVariables)
    // Already handled via useCallback ref pattern above.

    return (
        <div
            ref={containerRef}
            className={className}
            style={{ height: '100%', minHeight: 0 }}
        />
    );
}
