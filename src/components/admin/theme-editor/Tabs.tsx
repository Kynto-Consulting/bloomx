'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface TabDef<T extends string> { id: T; label: string; icon?: ReactNode }

export const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
export const panelId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

/** Pestanas accesibles (patron WAI-ARIA): flechas izquierda/derecha, Inicio/Fin, tabindex itinerante. */
export function Tabs<T extends string>({
    tabs, value, onChange, label, idPrefix,
}: { tabs: readonly TabDef<T>[]; value: T; onChange: (id: T) => void; label: string; idPrefix: string }) {
    const refs = useRef<Record<string, HTMLButtonElement | null>>({});
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const idx = tabs.findIndex((t) => t.id === value);
        let next = -1;
        if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabs.length - 1;
        if (next < 0) return;
        e.preventDefault();
        const id = tabs[next].id;
        onChange(id);
        refs.current[id]?.focus();
    };
    return (
        <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex gap-1 overflow-x-auto border-b border-border pb-px">
            {tabs.map((t) => {
                const active = t.id === value;
                return (
                    <button
                        key={t.id}
                        ref={(el) => { refs.current[t.id] = el; }}
                        id={tabId(idPrefix, t.id)}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        aria-controls={panelId(idPrefix, t.id)}
                        tabIndex={active ? 0 : -1}
                        onClick={() => onChange(t.id)}
                        className={cn(
                            'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
                        )}
                    >
                        {t.icon}{t.label}
                    </button>
                );
            })}
        </div>
    );
}
