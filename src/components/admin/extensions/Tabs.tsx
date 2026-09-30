'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TabDef<T extends string> {
    id: T;
    label: string;
}

export const tabDomId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
export const panelDomId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

/**
 * Lista de pestanas accesible (patron WAI-ARIA "tabs" con activacion automatica): role=tablist/tab, aria-selected,
 * aria-controls, tabIndex itinerante y flechas izquierda/derecha + Inicio/Fin. El panel lo pinta quien la usa con
 * `role="tabpanel"` y `aria-labelledby={tabDomId(prefix, id)}`.
 */
export function TabList<T extends string>({
    tabs, active, onChange, label, idPrefix,
}: { tabs: readonly TabDef<T>[]; active: T; onChange: (id: T) => void; label: string; idPrefix: string }) {
    const refs = React.useRef(new Map<string, HTMLButtonElement>());

    const move = (index: number) => {
        const next = tabs[(index + tabs.length) % tabs.length];
        onChange(next.id);
        refs.current.get(next.id)?.focus();
    };

    const onKeyDown = (event: React.KeyboardEvent, index: number) => {
        switch (event.key) {
            case 'ArrowRight': event.preventDefault(); move(index + 1); break;
            case 'ArrowLeft': event.preventDefault(); move(index - 1); break;
            case 'Home': event.preventDefault(); move(0); break;
            case 'End': event.preventDefault(); move(tabs.length - 1); break;
            default: break;
        }
    };

    return (
        <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-border">
            {tabs.map((tab, index) => {
                const selected = tab.id === active;
                return (
                    <button
                        key={tab.id}
                        ref={(el) => {
                            if (el) refs.current.set(tab.id, el);
                            else refs.current.delete(tab.id);
                        }}
                        id={tabDomId(idPrefix, tab.id)}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        aria-controls={panelDomId(idPrefix, tab.id)}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => onChange(tab.id)}
                        onKeyDown={(e) => onKeyDown(e, index)}
                        className={cn(
                            '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            selected ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                        )}
                    >
                        {tab.label}
                    </button>
                );
            })}
        </div>
    );
}
