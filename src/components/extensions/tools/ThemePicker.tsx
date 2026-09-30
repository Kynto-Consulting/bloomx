'use client';

import React from 'react';
import { useThemeChoices } from './ThemeScope';
import { useToolStrings } from './strings';

/** Selector de tema de la vista previa (genericos, paletas de empresa de prueba y empresa real). */
export function ThemePicker({ value, onChange, id }: { value: string; onChange: (id: string) => void; id: string }) {
    const t = useToolStrings();
    const choices = useThemeChoices();
    const group = (g: string) => choices.filter((c) => c.group === g);
    return (
        <div className="flex min-w-0 max-w-full flex-col gap-1">
            <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{t.theme}</label>
            <select
                id={id}
                value={choices.some((c) => c.id === value) ? value : 'light'}
                onChange={(e) => onChange(e.target.value)}
                className="h-9 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                <optgroup label={t.themeGeneric}>
                    {group('generic').map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </optgroup>
                {group('domain').length > 0 && (
                    <optgroup label={t.themeDomain}>
                        {group('domain').map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </optgroup>
                )}
                <optgroup label={t.themeFixtures}>
                    {group('fixture').map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </optgroup>
            </select>
        </div>
    );
}
