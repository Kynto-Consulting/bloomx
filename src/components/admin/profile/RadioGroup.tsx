'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface RadioOption<V extends string> {
    value: V;
    label: string;
    description?: string;
}

/** Grupo de radios accesible: fieldset + legend + input radio nativo (flechas, foco y lectores de pantalla). */
export function RadioGroup<V extends string>({
    legend, help, name, value, onChange, options, className,
}: {
    legend: string;
    help?: string;
    name: string;
    value: V;
    onChange: (value: V) => void;
    options: RadioOption<V>[];
    className?: string;
}) {
    const uid = React.useId();
    return (
        <fieldset className={cn('min-w-0 space-y-2', className)} aria-describedby={help ? `${uid}-help` : undefined}>
            <legend className="text-sm font-medium text-foreground">{legend}</legend>
            {help && <p id={`${uid}-help`} className="text-xs text-muted-foreground">{help}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
                {options.map((o, i) => {
                    const id = `${uid}-${i}`;
                    const checked = o.value === value;
                    return (
                        <label
                            key={o.value}
                            htmlFor={id}
                            className={cn(
                                'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                                checked ? 'border-primary bg-accent/50' : 'border-border hover:bg-accent/30',
                            )}
                        >
                            <input
                                id={id}
                                type="radio"
                                name={`${uid}-${name}`}
                                value={o.value}
                                checked={checked}
                                onChange={() => onChange(o.value)}
                                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                            />
                            <span className="min-w-0">
                                <span className="block font-medium text-foreground">{o.label}</span>
                                {o.description && <span className="block text-xs text-muted-foreground">{o.description}</span>}
                            </span>
                        </label>
                    );
                })}
            </div>
        </fieldset>
    );
}
