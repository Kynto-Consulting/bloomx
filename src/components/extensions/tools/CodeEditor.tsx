'use client';

/**
 * Editor de texto monoespaciado con numeros de linea y posicion del cursor (Ln/Col). Es un <textarea> accesible
 * (label + aria-describedby + aria-invalid); las lineas con error se resaltan en el margen.
 */
import React, { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useToolStrings } from './strings';

export interface CodeEditorHandle {
    /** Lleva el cursor a una linea/columna (base 1) y enfoca el editor. */
    jumpTo: (line: number, column?: number) => void;
}

export interface CodeEditorProps {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    /** Lineas (base 1) con error: se resaltan en el margen. */
    errorLines?: number[];
    /** Mensaje de error ya formateado (se asocia con aria-describedby). */
    describedBy?: string;
    invalid?: boolean;
    rows?: number;
    className?: string;
    readOnly?: boolean;
}

export const CodeEditor = React.forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
    { id, label, value, onChange, errorLines = [], describedBy, invalid, rows = 16, className = '', readOnly },
    ref,
) {
    const t = useToolStrings();
    const areaRef = useRef<HTMLTextAreaElement>(null);
    const gutterRef = useRef<HTMLDivElement>(null);
    const [cursor, setCursor] = useState({ line: 1, column: 1 });

    const lineCount = useMemo(() => Math.max(1, value.split('\n').length), [value]);
    const errorSet = useMemo(() => new Set(errorLines), [errorLines]);

    const syncCursor = useCallback(() => {
        const el = areaRef.current;
        if (!el) return;
        const before = el.value.slice(0, el.selectionStart ?? 0);
        const lines = before.split('\n');
        setCursor({ line: lines.length, column: lines[lines.length - 1].length + 1 });
    }, []);

    useImperativeHandle(ref, () => ({
        jumpTo(line, column = 1) {
            const el = areaRef.current;
            if (!el) return;
            const lines = el.value.split('\n');
            const targetLine = Math.min(Math.max(line, 1), lines.length);
            let offset = 0;
            for (let i = 0; i < targetLine - 1; i++) offset += lines[i].length + 1;
            const pos = Math.min(offset + Math.max(column - 1, 0), offset + lines[targetLine - 1].length);
            el.focus();
            el.setSelectionRange(pos, pos);
            el.scrollTop = Math.max(0, (targetLine - 4) * 20);
            if (gutterRef.current) gutterRef.current.scrollTop = el.scrollTop;
            syncCursor();
        },
    }), [syncCursor]);

    return (
        <div className={className}>
            <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
            <div className={`flex overflow-hidden rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring ${invalid ? 'border-destructive' : 'border-input'}`}>
                <div
                    ref={gutterRef}
                    aria-hidden="true"
                    className="select-none overflow-hidden border-r border-border bg-muted py-2 text-right font-mono text-xs leading-5 text-muted-foreground"
                    style={{ height: `${rows * 20 + 16}px` }}
                >
                    {Array.from({ length: lineCount }, (_, i) => (
                        <div key={i} className={`px-2 ${errorSet.has(i + 1) ? 'bg-destructive/10 font-semibold text-destructive' : ''}`}>{i + 1}</div>
                    ))}
                </div>
                <textarea
                    ref={areaRef}
                    id={id}
                    value={value}
                    readOnly={readOnly}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    wrap="off"
                    aria-invalid={invalid || undefined}
                    aria-describedby={describedBy ? `${describedBy} ${id}-pos` : `${id}-pos`}
                    onChange={(e) => { onChange(e.target.value); syncCursor(); }}
                    onKeyUp={syncCursor}
                    onClick={syncCursor}
                    onSelect={syncCursor}
                    onScroll={(e) => { if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop; }}
                    className="min-w-0 flex-1 resize-none whitespace-pre bg-transparent px-2 py-2 font-mono text-xs leading-5 text-foreground outline-none"
                    style={{ height: `${rows * 20 + 16}px`, tabSize: 2 }}
                />
            </div>
            <p id={`${id}-pos`} className="mt-1 text-right font-mono text-[11px] text-muted-foreground">{t.cursorPos.replace('{line}', String(cursor.line)).replace('{col}', String(cursor.column))}</p>
        </div>
    );
});
