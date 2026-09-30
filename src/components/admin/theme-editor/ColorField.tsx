'use client';

import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { RotateCcw } from 'lucide-react';
import { hexToHsl, hslToHex } from '@/lib/color';
import { normalizeThemeHex } from '@/lib/theme-config';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/I18nProvider';

export interface ColorFieldProps {
    /** Etiqueta visible (nombre del token). */
    label: string;
    /** Valor EFECTIVO que se aplicara (derivado, explicito o ya corregido). */
    value: string;
    /** Valor explicito guardado, si lo hay (define el estado "explicito"). */
    explicit?: string;
    /** El valor efectivo difiere del explicito (el motor lo corrige por contraste). */
    corrected?: boolean;
    /** Admite #rrggbbaa (solo overlay). */
    allowAlpha?: boolean;
    onChange: (hex: string) => void;
    /** "Restablecer a derivado". */
    onReset: () => void;
    id?: string;
    /** Sin insignia de estado ni boton de restablecer (campos libres como el generador). */
    plain?: boolean;
}

/** Separa #rrggbb y el canal alfa (#rrggbbaa). */
function splitAlpha(hex: string): { rgb: string; alpha: string } {
    return hex.length === 9 ? { rgb: hex.slice(0, 7), alpha: hex.slice(7) } : { rgb: hex.slice(0, 7), alpha: '' };
}

/**
 * Selector de color: muestra + input nativo + hex + estado (derivado/explicito/corregido) + restablecer a derivado.
 * Teclado: en el campo hex, Flecha arriba/abajo cambian la luminosidad 1 % (Mayus: 10 %).
 */
export function ColorField({ label, value, explicit, corrected, allowAlpha, onChange, onReset, id: idProp, plain }: ColorFieldProps) {
    const { t } = useI18n();
    const uid = useId();
    const id = idProp ?? uid;
    const [draft, setDraft] = useState(value);
    const [focused, setFocused] = useState(false);
    const invalid = draft !== '' && !normalizeThemeHex(draft, !!allowAlpha);
    useEffect(() => { if (!focused) setDraft(value); }, [value, focused]);

    const isExplicit = !!explicit;
    const { rgb, alpha } = splitAlpha(normalizeThemeHex(value, !!allowAlpha) ?? '#000000');

    const commit = (text: string) => {
        setDraft(text);
        const hex = normalizeThemeHex(text, !!allowAlpha);
        if (hex && hex !== value.toLowerCase()) onChange(hex);
    };
    const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        const cur = normalizeThemeHex(draft, !!allowAlpha);
        if (!cur) return;
        e.preventDefault();
        const { rgb: base, alpha: a } = splitAlpha(cur);
        const { h, s, l } = hexToHsl(base);
        const step = (e.shiftKey ? 0.1 : 0.01) * (e.key === 'ArrowUp' ? 1 : -1);
        commit(hslToHex(h, s * 100, Math.max(0, Math.min(1, l + step)) * 100) + a);
    };

    const status = corrected ? 'corrected' : isExplicit ? 'explicit' : 'derived';

    return (
        <div className="min-w-0">
            <label htmlFor={id} className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-foreground">
                <span className="truncate">{label}</span>
                {!plain && <span
                    data-status={status}
                    className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                        status === 'explicit' && 'bg-primary/10 text-primary',
                        status === 'derived' && 'bg-muted text-muted-foreground',
                        status === 'corrected' && 'bg-warning/15 text-warning',
                    )}
                >
                    {t(`themeEditor.colors.status.${status}`)}
                </span>}
            </label>
            <div className="flex items-center gap-1.5">
                <input
                    type="color"
                    value={rgb}
                    onChange={(e) => onChange(e.target.value.toLowerCase() + alpha)}
                    aria-label={t('themeEditor.colors.picker', { name: label })}
                    className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-input bg-background p-0.5"
                />
                <input
                    id={id}
                    type="text"
                    value={draft}
                    onChange={(e) => commit(e.target.value.trim())}
                    onFocus={() => setFocused(true)}
                    onBlur={() => { setFocused(false); setDraft(value); }}
                    onKeyDown={onKey}
                    spellCheck={false}
                    autoComplete="off"
                    maxLength={allowAlpha ? 9 : 7}
                    aria-invalid={invalid || undefined}
                    aria-describedby={invalid ? `${id}-err` : allowAlpha ? `${id}-hint` : undefined}
                    className={cn('min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring', invalid ? 'border-destructive' : 'border-input')}
                />
                {!plain && <button
                    type="button"
                    onClick={onReset}
                    disabled={!isExplicit}
                    aria-label={t('themeEditor.colors.resetToDerived', { name: label })}
                    title={t('themeEditor.colors.resetToDerivedShort')}
                    className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                </button>}
            </div>
            {invalid && <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-destructive">{t('themeEditor.colors.hexInvalid')}</p>}
            {allowAlpha && !invalid && <p id={`${id}-hint`} className="mt-1 text-[11px] text-muted-foreground">{t('themeEditor.colors.alphaHint')}</p>}
        </div>
    );
}
