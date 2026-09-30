'use client';

import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const fieldClass =
    'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

export const btnClass =
    'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

export const btnPrimaryClass =
    'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50';

export function Section({ title, help, children, className }: { title: string; help?: ReactNode; children: ReactNode; className?: string }) {
    const id = useId();
    return (
        <section aria-labelledby={id} className={cn('rounded-xl border border-border bg-card p-4 sm:p-5', className)}>
            <h3 id={id} className="text-base font-semibold text-foreground">{title}</h3>
            {help && <p className="mt-1 text-sm text-muted-foreground">{help}</p>}
            <div className="mt-4 space-y-4">{children}</div>
        </section>
    );
}

/** Conmutador accesible (role="switch"). */
export function Switch({ checked, onChange, label, help }: { checked: boolean; onChange: (v: boolean) => void; label: string; help?: string }) {
    const id = useId();
    return (
        <div className="flex items-start gap-3">
            <button
                type="button"
                role="switch"
                id={id}
                aria-checked={checked}
                aria-describedby={help ? `${id}-help` : undefined}
                onClick={() => onChange(!checked)}
                className={cn(
                    'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-input transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    checked ? 'bg-primary' : 'bg-muted',
                )}
            >
                <span
                    aria-hidden="true"
                    className={cn('inline-block h-4 w-4 rounded-full shadow transition-transform', checked ? 'translate-x-6 bg-primary-foreground' : 'translate-x-1 bg-muted-foreground')}
                />
            </button>
            <div className="min-w-0">
                <label htmlFor={id} className="cursor-pointer text-sm font-medium text-foreground">{label}</label>
                {help && <p id={`${id}-help`} className="text-xs text-muted-foreground">{help}</p>}
            </div>
        </div>
    );
}

/** Grupo de opciones excluyentes (botones con aria-pressed). */
export function Segmented<T extends string>({
    value, options, onChange, label,
}: { value: T; options: readonly { id: T; label: string; icon?: ReactNode }[]; onChange: (v: T) => void; label: string }) {
    return (
        <div role="group" aria-label={label} className="inline-flex flex-wrap rounded-lg border border-border bg-card p-1">
            {options.map((o) => (
                <button
                    key={o.id}
                    type="button"
                    aria-pressed={value === o.id}
                    onClick={() => onChange(o.id)}
                    className={cn(
                        'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        value === o.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                >
                    {o.icon}{o.label}
                </button>
            ))}
        </div>
    );
}

export function FieldError({ id, children }: { id: string; children: ReactNode }) {
    return <p id={id} role="alert" className="mt-1 text-xs text-destructive">{children}</p>;
}
