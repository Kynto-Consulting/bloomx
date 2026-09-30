'use client';

import * as React from 'react';
import { AlertTriangle, Inbox, Loader2, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/I18nProvider';

/**
 * Primitivas visuales de la consola de administracion. Solo tokens de tema (bg-card, text-muted-foreground, border-border,
 * bg-success/10...), sin colores crudos. Todas accesibles: roles/etiquetas, foco visible, no dependen solo del color.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Clases reutilizables
// ---------------------------------------------------------------------------------------------------------------------
export const inputClass =
    'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive';
export const selectClass = `${inputClass} pr-8`;
export const btnBase =
    'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background disabled:pointer-events-none disabled:opacity-50';
export const btnPrimary = `${btnBase} h-9 px-4 bg-primary text-primary-foreground hover:bg-primary/90`;
export const btnOutline = `${btnBase} h-9 px-3 border border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground`;
export const btnGhost = `${btnBase} h-9 px-3 text-muted-foreground hover:bg-accent hover:text-accent-foreground`;
export const btnDanger = `${btnBase} h-9 px-3 bg-destructive text-destructive-foreground hover:bg-destructive/90`;
export const btnDangerOutline = `${btnBase} h-9 px-3 border border-destructive/40 text-destructive hover:bg-destructive/10`;

// ---------------------------------------------------------------------------------------------------------------------
// Estructura
// ---------------------------------------------------------------------------------------------------------------------
export function PageHeader({ title, description, actions, id }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; id?: string }) {
    return (
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
                <h1 id={id} className="text-2xl font-bold tracking-tight text-foreground" tabIndex={-1}>{title}</h1>
                {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
    );
}

export function Card({
    title, description, actions, children, className, bodyClassName, headingLevel = 2, id,
}: {
    title?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode;
    className?: string; bodyClassName?: string; headingLevel?: 2 | 3; id?: string;
}) {
    const uid = React.useId();
    const H = headingLevel === 2 ? 'h2' : 'h3';
    return (
        <section id={id} aria-labelledby={title ? `${uid}-t` : undefined} className={cn('rounded-xl border border-border bg-card text-card-foreground shadow-sm', className)}>
            {(title || actions) && (
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3 sm:px-5">
                    <div className="min-w-0">
                        {title && <H id={`${uid}-t`} className="text-base font-semibold text-foreground">{title}</H>}
                        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
                    </div>
                    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
                </header>
            )}
            <div className={cn('px-4 py-4 sm:px-5', bodyClassName)}>{children}</div>
        </section>
    );
}

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const TONE_BADGE: Record<Tone, string> = {
    neutral: 'border-border bg-muted text-muted-foreground',
    success: 'border-success/30 bg-success/10 text-success',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    danger: 'border-destructive/30 bg-destructive/10 text-destructive',
    info: 'border-info/30 bg-info/10 text-info',
};
const TONE_TEXT: Record<Tone, string> = {
    neutral: 'text-foreground', success: 'text-success', warning: 'text-warning', danger: 'text-destructive', info: 'text-info',
};

/** Insignia de estado: el significado va en el TEXTO (no solo en el color). */
export function Badge({ tone = 'neutral', children, className, title }: { tone?: Tone; children: React.ReactNode; className?: string; title?: string }) {
    return (
        <span title={title} className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', TONE_BADGE[tone], className)}>
            {children}
        </span>
    );
}

export function StatCard({
    label, value, hint, tone = 'neutral', icon, href, loading, footer,
}: {
    label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: Tone; icon?: React.ReactNode; href?: string; loading?: boolean; footer?: React.ReactNode;
}) {
    const body = (
        <>
            <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-muted-foreground">{label}</p>
                {icon && <span aria-hidden="true" className="text-muted-foreground">{icon}</span>}
            </div>
            <p className={cn('mt-2 text-2xl font-bold tabular-nums', TONE_TEXT[tone])} aria-busy={loading || undefined}>
                {loading ? <span className="inline-block h-7 w-16 animate-pulse rounded bg-muted align-middle" aria-hidden="true" /> : value}
            </p>
            {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
            {footer}
        </>
    );
    const cls = 'block rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm';
    return href ? (
        <a href={href} className={cn(cls, 'transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}>{body}</a>
    ) : (
        <div className={cls}>{body}</div>
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------------------------------------------------
export function LoadingState({ label, className }: { label?: string; className?: string }) {
    const { t } = useI18n();
    const text = label ?? t('admin.console.common.loading');
    return (
        <div role="status" className={cn('flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground', className)}>
            <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
            <span>{text}</span>
        </div>
    );
}

export function ErrorState({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
    const { t } = useI18n();
    return (
        <div role="alert" className={cn('flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive', className)}>
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{message}</span>
            {onRetry && (
                <button type="button" onClick={onRetry} className="rounded-md border border-destructive/40 px-3 py-1 font-medium hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {t('admin.console.common.retry')}
                </button>
            )}
        </div>
    );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
    return (
        <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <span aria-hidden="true" className="text-muted-foreground">{icon ?? <Inbox className="h-10 w-10" />}</span>
            <p className="font-medium text-foreground">{title}</p>
            {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
            {action}
        </div>
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Formularios
// ---------------------------------------------------------------------------------------------------------------------
export function Field({
    label, htmlFor, hint, error, children, className, required,
}: {
    label: React.ReactNode; htmlFor: string; hint?: React.ReactNode; error?: string | null; children: React.ReactNode; className?: string; required?: boolean;
}) {
    return (
        <div className={cn('space-y-1', className)}>
            <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">
                {label}
                {required && <span aria-hidden="true" className="text-destructive"> *</span>}
            </label>
            {children}
            {hint && !error && <p id={`${htmlFor}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
            {error && <p id={`${htmlFor}-err`} role="alert" className="text-xs text-destructive">{error}</p>}
        </div>
    );
}

/** Buscador con icono y boton de limpiar. `label` es el nombre accesible (no solo placeholder). */
export function SearchInput({
    value, onChange, label, placeholder, className, id,
}: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; className?: string; id?: string }) {
    const { t } = useI18n();
    const uid = React.useId();
    return (
        <div className={cn('relative w-full sm:w-72', className)}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
                id={id ?? uid}
                type="search"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                aria-label={label}
                autoComplete="off"
                className={cn(inputClass, 'pl-9 pr-8')}
            />
            {value && (
                <button
                    type="button"
                    onClick={() => onChange('')}
                    aria-label={t('admin.console.common.clear')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
            )}
        </div>
    );
}

export function FilterBar({ children, className, label }: { children: React.ReactNode; className?: string; label?: string }) {
    return (
        <div role="search" aria-label={label} className={cn('flex flex-wrap items-end gap-3', className)}>
            {children}
        </div>
    );
}

/** Select con etiqueta visible (para filtros). */
export function FilterSelect({
    label, value, onChange, options, className,
}: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string }) {
    const uid = React.useId();
    return (
        <div className={cn('min-w-[9rem]', className)}>
            <label htmlFor={uid} className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
            <select id={uid} value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
        </div>
    );
}

/** Interruptor accesible (role="switch"). */
export function Switch({
    checked, onChange, label, disabled, id,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; id?: string }) {
    return (
        <button
            id={id}
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={cn(
                'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-input transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                checked ? 'bg-primary' : 'bg-muted',
            )}
        >
            <span aria-hidden="true" className={cn('inline-block h-4 w-4 rounded-full bg-background shadow transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
        </button>
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Utilidades de hooks
// ---------------------------------------------------------------------------------------------------------------------
export function useDebounced<T>(value: T, ms = 300): T {
    const [v, setV] = React.useState(value);
    React.useEffect(() => {
        const id = setTimeout(() => setV(value), ms);
        return () => clearTimeout(id);
    }, [value, ms]);
    return v;
}

/** Definicion clave-valor (detalle de un elemento). */
export function DefinitionList({ items, className }: { items: { label: string; value: React.ReactNode }[]; className?: string }) {
    return (
        <dl className={cn('grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2', className)}>
            {items.map((it) => (
                <div key={it.label} className="min-w-0">
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{it.label}</dt>
                    <dd className="mt-0.5 break-words text-sm text-foreground">{it.value}</dd>
                </div>
            ))}
        </dl>
    );
}
