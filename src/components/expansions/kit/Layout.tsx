'use client';

/**
 * Kit: componentes de maquetacion (Stack, Row, Grid, Card, Section, Divider, Spacer).
 * Solo props semanticas; toda clase sale de tokens.ts (o de los mapas literales de este fichero, sin colores).
 */
import * as React from 'react';
import { GAPS, DENSITIES, ALIGNS, JUSTIFIES } from '@/lib/expansions/ui-schema';
import {
    ALIGN_CLASS, DENSITY_PADDING_CLASS, GAP_CLASS, GRID_COLUMNS_CLASS, JUSTIFY_CLASS, MARGIN_Y_CLASS, MAX_HEIGHT_CLASS, PADDING_CLASS,
    SURFACE_CLASS, SURFACE_ELEVATED_CLASS, SURFACE_FLAT_CLASS, TONE_BORDER_LEFT, FOCUS_RING_CLASS, pick, toTone,
    type Align, type Density, type Justify,
} from './tokens';
import { KitIcon } from './Icon';

/** Texto seguro: solo strings y numeros finitos; cualquier otra cosa (objetos, null...) se ignora. */
const txt = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '');
/** Numero de escala: acepta "3" ademas de 3; lo demas cae al defecto. */
const scale = (value: unknown, fallback: number): number => {
    const n = typeof value === 'string' && /^\d{1,2}$/.test(value) ? Number(value) : value;
    return pick<number>(n, GAPS, fallback);
};

const MARGIN_X_CLASS: Record<number, string> = { 0: 'mx-0', 1: 'mx-1', 2: 'mx-2', 3: 'mx-3', 4: 'mx-4', 5: 'mx-5', 6: 'mx-6', 8: 'mx-8', 10: 'mx-10', 12: 'mx-12' };
const SPACER_BOX_CLASS: Record<number, string> = { 0: 'size-0', 1: 'size-1', 2: 'size-2', 3: 'size-3', 4: 'size-4', 5: 'size-5', 6: 'size-6', 8: 'size-8', 10: 'size-10', 12: 'size-12' };

// ------------------------------------------------------------------ Stack / Row
export interface StackProps {
    gap?: number; align?: Align; justify?: Justify; wrap?: boolean; padding?: number; fullWidth?: boolean; children?: React.ReactNode;
}
export function Stack({ gap, align, justify, wrap, padding, fullWidth = true, children }: StackProps) {
    const cls = [
        'flex flex-col', GAP_CLASS[scale(gap, 3)], PADDING_CLASS[scale(padding, 0)],
        align === undefined ? '' : ALIGN_CLASS[pick<Align>(align, ALIGNS, 'stretch')],
        justify === undefined ? '' : JUSTIFY_CLASS[pick<Justify>(justify, JUSTIFIES, 'start')],
        wrap === true ? 'flex-wrap' : '', fullWidth !== false ? 'w-full' : '', 'min-w-0',
    ].filter(Boolean).join(' ');
    return <div className={cls}>{children}</div>;
}

export interface RowProps {
    gap?: number; align?: Align; justify?: Justify; wrap?: boolean; padding?: number; children?: React.ReactNode;
}
export function Row({ gap, align, justify, wrap, padding, children }: RowProps) {
    const cls = [
        'flex flex-row', GAP_CLASS[scale(gap, 2)], PADDING_CLASS[scale(padding, 0)],
        ALIGN_CLASS[pick<Align>(align, ALIGNS, 'center')],
        justify === undefined ? '' : JUSTIFY_CLASS[pick<Justify>(justify, JUSTIFIES, 'start')],
        wrap === true ? 'flex-wrap' : '', 'min-w-0',
    ].filter(Boolean).join(' ');
    return <div className={cls}>{children}</div>;
}

// ------------------------------------------------------------------ Grid
export interface GridProps { columns?: 1 | 2 | 3 | 4 | 5 | 6; gap?: number; maxHeight?: 'sm' | 'md' | 'lg' | 'xl'; children?: React.ReactNode }
export function Grid({ columns, gap, maxHeight, children }: GridProps) {
    const cols = pick<number>(typeof columns === 'string' ? Number(columns) : columns, [1, 2, 3, 4, 5, 6], 2);
    const mh = typeof maxHeight === 'string' && Object.prototype.hasOwnProperty.call(MAX_HEIGHT_CLASS, maxHeight) ? MAX_HEIGHT_CLASS[maxHeight] : '';
    return <div className={['grid w-full', GRID_COLUMNS_CLASS[cols], GAP_CLASS[scale(gap, 3)], mh].filter(Boolean).join(' ')}>{children}</div>;
}

// ------------------------------------------------------------------ Card
const CARD_VARIANTS = ['outline', 'flat', 'elevated'] as const;
const CARD_SURFACE = { outline: SURFACE_CLASS, flat: SURFACE_FLAT_CLASS, elevated: SURFACE_ELEVATED_CLASS } as const;
export interface CardProps {
    title?: string; description?: string; icon?: string;
    tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
    variant?: 'outline' | 'flat' | 'elevated'; density?: Density; footer?: React.ReactNode; children?: React.ReactNode;
}
export function Card({ title, description, icon, tone, variant, density, footer, children }: CardProps) {
    const id = React.useId();
    const t = toTone(tone);
    const v = pick(variant, CARD_VARIANTS, 'outline');
    const pad = DENSITY_PADDING_CLASS[pick<Density>(density, DENSITIES, 'comfortable')];
    const heading = txt(title);
    const sub = txt(description);
    const hasFooter = footer !== undefined && footer !== null && footer !== false;
    const accent = t === 'neutral' ? '' : `border-l-4 ${TONE_BORDER_LEFT[t]}`;
    return (
        <div
            role={heading ? 'group' : undefined}
            aria-labelledby={heading ? `${id}-t` : undefined}
            aria-describedby={sub ? `${id}-d` : undefined}
            className={[CARD_SURFACE[v], accent, 'flex min-w-0 flex-col overflow-hidden'].filter(Boolean).join(' ')}
        >
            <div className={`${pad} flex flex-col gap-3`}>
                {(heading || sub || icon) && (
                    <div className="flex items-start gap-3">
                        {icon ? <KitIcon name={txt(icon)} size="lg" className="mt-0.5 text-muted-foreground" /> : null}
                        <div className="min-w-0 flex-1">
                            {heading && <h4 id={`${id}-t`} className="text-base font-semibold leading-tight text-foreground">{heading}</h4>}
                            {sub && <p id={`${id}-d`} className="mt-1 text-sm text-muted-foreground">{sub}</p>}
                        </div>
                    </div>
                )}
                {children !== undefined && children !== null && <div className="flex min-w-0 flex-col gap-3">{children}</div>}
            </div>
            {hasFooter && <div className={`flex flex-wrap items-center gap-2 border-t border-border ${pad}`}>{footer}</div>}
        </div>
    );
}

// ------------------------------------------------------------------ Section
export interface SectionProps {
    title?: string; description?: string; collapsible?: boolean; defaultOpen?: boolean; gap?: number; children?: React.ReactNode;
}
export function Section({ title, description, collapsible, defaultOpen = true, gap, children }: SectionProps) {
    const id = React.useId();
    const heading = txt(title);
    const sub = txt(description);
    const canFold = collapsible === true && !!heading;
    const [open, setOpen] = React.useState(defaultOpen !== false);
    const expanded = canFold ? open : true;
    return (
        <section aria-labelledby={heading ? `${id}-t` : undefined} className="flex w-full min-w-0 flex-col gap-3">
            {(heading || sub) && (
                <header className="flex flex-col gap-1">
                    {heading && (
                        <h3 id={`${id}-t`} className="text-lg font-semibold text-foreground">
                            {canFold ? (
                                <button
                                    type="button"
                                    aria-expanded={expanded}
                                    aria-controls={`${id}-c`}
                                    onClick={() => setOpen((o) => !o)}
                                    className={`flex w-full items-center gap-2 rounded-md text-left ${FOCUS_RING_CLASS}`}
                                >
                                    <KitIcon name={expanded ? 'ChevronDown' : 'ChevronRight'} size="md" className="text-muted-foreground" />
                                    <span>{heading}</span>
                                </button>
                            ) : heading}
                        </h3>
                    )}
                    {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
                </header>
            )}
            <div id={`${id}-c`} hidden={!expanded} className={`flex min-w-0 flex-col ${GAP_CLASS[scale(gap, 3)]}`}>{children}</div>
        </section>
    );
}

// ------------------------------------------------------------------ Divider / Spacer
export interface DividerProps { label?: string; orientation?: 'horizontal' | 'vertical'; spacing?: number }
export function Divider({ label, orientation, spacing }: DividerProps) {
    const vertical = orientation === 'vertical';
    const sp = scale(spacing, 3);
    const text = txt(label);
    if (vertical) {
        return <div role="separator" aria-orientation="vertical" aria-label={text || undefined} className={`w-px self-stretch bg-border ${MARGIN_X_CLASS[sp]}`} />;
    }
    if (text) {
        return (
            <div role="separator" aria-orientation="horizontal" aria-label={text} className={`flex w-full items-center gap-3 ${MARGIN_Y_CLASS[sp]}`}>
                <span aria-hidden="true" className="h-px flex-1 bg-border" />
                <span aria-hidden="true" className="text-xs text-muted-foreground">{text}</span>
                <span aria-hidden="true" className="h-px flex-1 bg-border" />
            </div>
        );
    }
    return <div role="separator" aria-orientation="horizontal" className={`h-px w-full bg-border ${MARGIN_Y_CLASS[sp]}`} />;
}

export interface SpacerProps { size?: number }
export function Spacer({ size }: SpacerProps) {
    return <div aria-hidden="true" className={`shrink-0 ${SPACER_BOX_CLASS[scale(size, 4)]}`} />;
}
