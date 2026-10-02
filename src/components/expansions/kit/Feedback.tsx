'use client';

/**
 * Kit: feedback (Badge, Chip, Avatar, Stat, Progress, Skeleton, Empty, Alert, Callout, Spinner).
 * El color sale siempre de los mapas de tokens.ts (parejas con contraste garantizado); el unico style en linea
 * es el ancho de la barra de progreso.
 */
import * as React from 'react';
import { SIZES, SIZES_XL, SURFACE_VARIANTS } from '@/lib/expansions/ui-schema';
import { safeImageSrc } from '@/lib/expansions/safe-url';
import { useI18n } from '@/components/I18nProvider';
import {
    FOCUS_RING_CLASS, SURFACE_CLASS, TONE_BG, TONE_BORDER_LEFT, TONE_OUTLINE, TONE_SOFT, TONE_SOLID, TONE_TEXT, buttonClasses, pick, toTone,
    type Size, type SizeXl, type SurfaceVariant, type Tone,
} from './tokens';
import { KitIcon } from './Icon';
import { useKitStrings } from './strings';

const txt = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '');
const has = (node: React.ReactNode): boolean => node !== undefined && node !== null && node !== false && node !== '';
/** Textos cortos que el kit no trae en strings.ts (es/en; cualquier otro idioma cae a espanol). */
function useLocal() {
    const { locale } = useI18n();
    return locale === 'en'
        ? { up: 'up', down: 'down', flat: 'unchanged', progress: 'Progress' }
        : { up: 'sube', down: 'baja', flat: 'sin cambios', progress: 'Progreso' };
}

// ------------------------------------------------------------------ Badge
const BADGE_SIZE: Record<'sm' | 'md', string> = { sm: 'px-1.5 py-0 text-[0.6875rem] leading-5', md: 'px-2.5 py-0.5 text-xs leading-5' };
const BADGE_LOOK: Record<SurfaceVariant, Record<Tone, string>> = { solid: TONE_SOLID, soft: TONE_SOFT, outline: TONE_OUTLINE };
export interface BadgeProps { label?: string; tone?: Tone; variant?: SurfaceVariant; size?: 'sm' | 'md'; children?: React.ReactNode }
export function Badge({ label, tone, variant, size, children }: BadgeProps) {
    const look = BADGE_LOOK[pick<SurfaceVariant>(variant, SURFACE_VARIANTS, 'soft')][toTone(tone)];
    const sz = BADGE_SIZE[pick(size, ['sm', 'md'] as const, 'md')];
    return <span className={`inline-flex max-w-full items-center whitespace-nowrap rounded-md font-medium ${look} ${sz}`}>{txt(label) || children}</span>;
}

// ------------------------------------------------------------------ Chip
export interface ChipProps {
    label?: string; tone?: Tone; icon?: string; selected?: boolean; removable?: boolean; onPress?: () => void; onRemove?: () => void; children?: React.ReactNode;
}
export function Chip({ label, tone, icon, selected, removable, onPress, onRemove, children }: ChipProps) {
    const strings = useKitStrings();
    const t = toTone(tone);
    const on = selected === true;
    const look = on ? TONE_SOLID[t === 'neutral' ? 'primary' : t] : TONE_OUTLINE[t];
    const text = txt(label);
    const body = (
        <>
            {icon ? <KitIcon name={txt(icon)} size="xs" /> : null}
            <span className="truncate">{text || children}</span>
        </>
    );
    const press = typeof onPress === 'function';
    const canRemove = removable === true;
    const base = `inline-flex max-w-full items-center gap-1.5 rounded-md text-sm ${look}`;
    const onKey = (e: React.KeyboardEvent) => {
        if (canRemove && (e.key === 'Backspace' || e.key === 'Delete')) { e.preventDefault(); onRemove?.(); }
    };
    if (!canRemove) {
        return press
            ? <button type="button" aria-pressed={on} onClick={() => onPress()} className={`${base} h-8 px-3 ${FOCUS_RING_CLASS}`}>{body}</button>
            : <span className={`${base} h-8 px-3`} data-selected={on || undefined}>{body}</span>;
    }
    return (
        <span className={`${base} h-8 pl-3 pr-1`} data-selected={on || undefined}>
            {press
                ? <button type="button" aria-pressed={on} onClick={() => onPress()} onKeyDown={onKey} className={`inline-flex min-w-0 items-center gap-1.5 rounded-sm ${FOCUS_RING_CLASS}`}>{body}</button>
                : <span className="inline-flex min-w-0 items-center gap-1.5">{body}</span>}
            <button
                type="button"
                aria-label={`${strings.remove} ${text}`.trim()}
                onClick={() => onRemove?.()}
                className={`inline-flex size-6 shrink-0 items-center justify-center rounded-sm hover:bg-foreground/10 ${FOCUS_RING_CLASS}`}
            >
                <KitIcon name="X" size="xs" />
            </button>
        </span>
    );
}

// ------------------------------------------------------------------ Avatar
const AVATAR_SIZE: Record<SizeXl, string> = { xs: 'size-6 text-[0.625rem]', sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-lg', xl: 'size-20 text-2xl' };
function initialsOf(name: string, explicit: string): string {
    const source = explicit.trim() || name.trim().split(/\s+/).filter(Boolean).map((w, i, all) => (i === 0 || i === all.length - 1 ? Array.from(w)[0] : '')).join('');
    return Array.from(source).slice(0, 2).join('').toUpperCase();
}
export interface AvatarProps { src?: string; name?: string; initials?: string; alt?: string; size?: SizeXl; tone?: Tone }
export function Avatar({ src, name, initials, alt, size, tone }: AvatarProps) {
    const [failed, setFailed] = React.useState(false);
    const url = safeImageSrc(src);
    const label = txt(alt) || txt(name);
    const box = `relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-medium ${AVATAR_SIZE[pick<SizeXl>(size, SIZES_XL, 'md')]}`;
    if (url && !failed) {
        return (
            <span className={`${box} bg-muted`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={label} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="size-full object-cover" />
            </span>
        );
    }
    const letters = initialsOf(txt(name), txt(initials));
    return (
        <span className={`${box} ${TONE_SOLID[toTone(tone)]}`} role={label ? 'img' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : true}>
            <span aria-hidden="true">{letters}</span>
        </span>
    );
}

// ------------------------------------------------------------------ Stat
const TRENDS = ['up', 'down', 'flat'] as const;
const TREND_TEXT: Record<(typeof TRENDS)[number], string> = { up: 'text-success', down: 'text-destructive', flat: 'text-muted-foreground' };
const TREND_ICON: Record<(typeof TRENDS)[number], string> = { up: 'TrendingUp', down: 'TrendingDown', flat: 'Minus' };
export interface StatProps { label?: string; value?: string | number; delta?: string | number; trend?: 'up' | 'down' | 'flat'; description?: string; icon?: string; tone?: Tone }
export function Stat({ label, value, delta, trend, description, icon, tone }: StatProps) {
    const local = useLocal();
    const tr = pick(trend, TRENDS, 'flat');
    const d = txt(delta);
    const desc = txt(description);
    return (
        <dl className={`${SURFACE_CLASS} flex min-w-0 flex-col gap-1 p-4`}>
            <dt className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                <span>{txt(label)}</span>
                {icon ? <KitIcon name={txt(icon)} size="md" /> : null}
            </dt>
            <dd className={`text-2xl font-semibold tracking-tight ${TONE_TEXT[toTone(tone)]}`}>{txt(value)}</dd>
            {d && (
                <dd className={`flex items-center gap-1 text-sm font-medium ${TREND_TEXT[tr]}`}>
                    <KitIcon name={TREND_ICON[tr]} size="sm" />
                    <span className="sr-only">{local[tr]}: </span>
                    <span>{d}</span>
                </dd>
            )}
            {desc && <dd className="text-xs text-muted-foreground">{desc}</dd>}
        </dl>
    );
}

// ------------------------------------------------------------------ Progress
const PROGRESS_HEIGHT: Record<Size, string> = { xs: 'h-1', sm: 'h-1.5', md: 'h-2.5', lg: 'h-4' };
export interface ProgressProps { value?: number; max?: number; label?: string; tone?: Tone; size?: Size; showValue?: boolean; indeterminate?: boolean }
export function Progress({ value, max, label, tone, size, showValue = true, indeterminate }: ProgressProps) {
    const id = React.useId();
    const local = useLocal();
    const top = typeof max === 'number' && Number.isFinite(max) && max > 0 ? max : 100;
    const current = typeof value === 'number' && Number.isFinite(value) ? Math.min(top, Math.max(0, value)) : 0;
    const pct = Math.round((current / top) * 100);
    const busy = indeterminate === true;
    const text = txt(label);
    return (
        <div className="flex w-full min-w-0 flex-col gap-1.5">
            {(text || (showValue !== false && !busy)) && (
                <div className="flex items-baseline justify-between gap-2 text-sm">
                    {text ? <span id={`${id}-l`} className="text-foreground">{text}</span> : <span />}
                    {showValue !== false && !busy && <span aria-hidden="true" className="tabular-nums text-muted-foreground">{pct}%</span>}
                </div>
            )}
            <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={top}
                aria-valuenow={busy ? undefined : current}
                aria-valuetext={busy ? undefined : `${pct}%`}
                aria-labelledby={text ? `${id}-l` : undefined}
                aria-label={text ? undefined : local.progress}
                className={`w-full overflow-hidden rounded-full bg-muted ${PROGRESS_HEIGHT[pick<Size>(size, SIZES, 'md')]}`}
            >
                <div
                    className={`h-full rounded-full ${TONE_BG[toTone(tone, 'primary')]} ${busy ? 'animate-pulse' : 'transition-[width] duration-300'}`}
                    style={{ width: busy ? '100%' : `${pct}%` }}
                />
            </div>
        </div>
    );
}

// ------------------------------------------------------------------ Skeleton
const SKELETON_CIRCLE: Record<SizeXl, string> = { xs: 'size-6', sm: 'size-8', md: 'size-10', lg: 'size-14', xl: 'size-20' };
const SKELETON_RECT: Record<SizeXl, string> = { xs: 'h-8', sm: 'h-16', md: 'h-24', lg: 'h-40', xl: 'h-64' };
const PULSE = 'animate-pulse bg-muted motion-reduce:animate-none';
export interface SkeletonProps { variant?: 'text' | 'circle' | 'rect'; lines?: number; size?: SizeXl }
export function Skeleton({ variant, lines, size }: SkeletonProps) {
    const v = pick(variant, ['text', 'circle', 'rect'] as const, 'text');
    const sz = pick<SizeXl>(size, SIZES_XL, 'md');
    if (v === 'circle') return <div aria-hidden="true" className={`${PULSE} shrink-0 rounded-full ${SKELETON_CIRCLE[sz]}`} />;
    if (v === 'rect') return <div aria-hidden="true" className={`${PULSE} w-full rounded-md ${SKELETON_RECT[sz]}`} />;
    const n = typeof lines === 'number' && Number.isFinite(lines) ? Math.min(12, Math.max(1, Math.round(lines))) : 1;
    return (
        <div aria-hidden="true" className="flex w-full flex-col gap-2">
            {Array.from({ length: n }, (_, i) => <div key={i} className={`${PULSE} h-4 rounded-md ${n > 1 && i === n - 1 ? 'w-3/4' : 'w-full'}`} />)}
        </div>
    );
}

// ------------------------------------------------------------------ Empty
export interface EmptyProps { icon?: string; title?: string; description?: string; actionLabel?: string; onAction?: () => void; children?: React.ReactNode }
export function Empty({ icon, title, description, actionLabel, onAction, children }: EmptyProps) {
    const heading = txt(title);
    const desc = txt(description);
    const action = txt(actionLabel);
    return (
        <div className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-card p-8 text-center text-card-foreground">
            {icon ? <KitIcon name={txt(icon)} size="xl" className="text-muted-foreground" /> : null}
            {heading && <p className="text-base font-medium text-foreground">{heading}</p>}
            {desc && <p className="max-w-md text-sm text-muted-foreground">{desc}</p>}
            {has(children) && <div className="mt-2 flex flex-col items-center gap-2">{children}</div>}
            {action && typeof onAction === 'function' && (
                <button type="button" onClick={() => onAction()} className={`${buttonClasses({ tone: 'primary', variant: 'solid', size: 'md' })} mt-2`}>{action}</button>
            )}
        </div>
    );
}

// ------------------------------------------------------------------ Alert / Callout
const TONE_ICON: Record<Tone, string> = { neutral: 'Info', primary: 'Info', success: 'CircleCheck', warning: 'TriangleAlert', danger: 'CircleAlert', info: 'Info' };
export interface AlertProps {
    tone?: Tone; title?: string; message?: string; description?: string; icon?: string; dismissible?: boolean; onClose?: () => void; children?: React.ReactNode;
}
export function Alert({ tone, title, message, description, icon, dismissible, onClose, children }: AlertProps) {
    const strings = useKitStrings();
    const [closed, setClosed] = React.useState(false);
    const t = toTone(tone, 'info');
    if (closed) return null;
    const heading = txt(title);
    const body = txt(message) || txt(description);
    return (
        <div role={t === 'danger' || t === 'warning' ? 'alert' : 'status'} className={`flex w-full items-start gap-3 rounded-lg p-4 text-sm ${TONE_SOFT[t]}`}>
            <KitIcon name={txt(icon) || TONE_ICON[t]} size="lg" className={`mt-0.5 ${TONE_TEXT[t]}`} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                {heading && <p className="font-semibold text-foreground">{heading}</p>}
                {body && <p className="whitespace-pre-wrap break-words text-foreground">{body}</p>}
                {has(children) && <div className="flex flex-col gap-2">{children}</div>}
            </div>
            {dismissible === true && (
                <button
                    type="button"
                    aria-label={strings.dismiss}
                    onClick={() => { setClosed(true); onClose?.(); }}
                    className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-foreground/10 ${FOCUS_RING_CLASS}`}
                >
                    <KitIcon name="X" size="sm" />
                </button>
            )}
        </div>
    );
}

export interface CalloutProps { tone?: Tone; title?: string; icon?: string; children?: React.ReactNode }
export function Callout({ tone, title, icon, children }: CalloutProps) {
    const id = React.useId();
    const t = toTone(tone, 'info');
    const heading = txt(title);
    return (
        <div
            role="note"
            aria-labelledby={heading ? `${id}-t` : undefined}
            className={`flex w-full items-start gap-3 rounded-lg border border-border border-l-4 bg-card p-4 text-sm text-card-foreground ${TONE_BORDER_LEFT[t]}`}
        >
            {icon ? <KitIcon name={txt(icon)} size="lg" className={`mt-0.5 ${TONE_TEXT[t]}`} /> : null}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                {heading && <p id={`${id}-t`} className="font-semibold text-foreground">{heading}</p>}
                {has(children) && <div className="flex flex-col gap-2">{children}</div>}
            </div>
        </div>
    );
}

// ------------------------------------------------------------------ Spinner
const SPINNER_SIZE: Record<Size, string> = { xs: 'size-3', sm: 'size-4', md: 'size-6', lg: 'size-8' };
export interface SpinnerProps { label?: string; size?: Size }
export function Spinner({ label, size }: SpinnerProps) {
    const strings = useKitStrings();
    const text = txt(label);
    return (
        <span role="status" className="inline-flex items-center gap-2">
            <span aria-hidden="true" className={`inline-block animate-spin rounded-full border-2 border-muted border-t-primary ${SPINNER_SIZE[pick<Size>(size, SIZES, 'md')]}`} />
            <span className={text ? 'text-sm text-muted-foreground' : 'sr-only'}>{text || strings.loading}</span>
        </span>
    );
}
