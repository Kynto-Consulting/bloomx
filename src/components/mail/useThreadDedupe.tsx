'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/I18nProvider';
import { sanitizeHtml } from '@/lib/sanitizeHtml';
import { htmlToComparableText, splitQuotedHtml } from './quoted-html';
import { analyzeThreadDuplicates, type DedupeEntry, type DedupeResult } from './thread-dedupe';
import type { EmailDetails } from './reader-types';

/** Preferencia por visor (no viaja al servidor). */
export const HIDE_DUPLICATES_KEY = 'bloomx:thread:hide-duplicates';

function readPref(): boolean {
    try { return window.localStorage.getItem(HIDE_DUPLICATES_KEY) !== '0'; } catch { return true; }
}
function writePref(value: boolean) {
    try { window.localStorage.setItem(HIDE_DUPLICATES_KEY, value ? '1' : '0'); } catch { /* sin almacenamiento: solo dura la sesion */ }
}

export interface ThreadDedupeState {
    /** Ocultar (plegar) el historial que ya esta en otros mensajes del hilo. Activo por defecto. */
    enabled: boolean;
    setEnabled: (value: boolean) => void;
    /** Resultado por mensaje (vacio si el hilo tiene un solo mensaje). */
    results: Map<string, DedupeResult>;
    /** true si el interruptor tiene sentido: hilo con varios mensajes y al menos uno con historial. */
    relevant: boolean;
}

/** Calcula, para cada mensaje del hilo, si su historial citado es repeticion de otros mensajes del mismo hilo. */
export function useThreadDedupe(items: readonly EmailDetails[]): ThreadDedupeState {
    const [enabled, setEnabledState] = useState(true);
    useEffect(() => { setEnabledState(readPref()); }, []);
    const setEnabled = useCallback((value: boolean) => { setEnabledState(value); writePref(value); }, []);

    const results = useMemo(() => {
        if (items.length < 2) return new Map<string, DedupeResult>();
        const entries: DedupeEntry[] = items.map((it) => {
            const clean = sanitizeHtml(it.content || '');
            const split = splitQuotedHtml(clean);
            return split
                ? { id: it.email.id, ownText: split.mainText || '', quotedText: split.quotedText || '' }
                : { id: it.email.id, ownText: htmlToComparableText(clean), quotedText: '' };
        });
        return analyzeThreadDuplicates(entries);
    }, [items]);

    const relevant = useMemo(() => Array.from(results.values()).some((r) => r.status !== 'none'), [results]);
    return { enabled, setEnabled, results, relevant };
}

/** Interruptor accesible "Ocultar historial repetido". */
export function ThreadDedupeToggle({ state, className }: { state: ThreadDedupeState; className?: string }) {
    const { t } = useI18n();
    if (!state.relevant) return null;
    const label = t('mailView.thread.hideDuplicates');
    return (
        <button
            type="button"
            role="switch"
            aria-checked={state.enabled}
            title={t('mailView.thread.hideDuplicatesHint')}
            data-thread-dedupe-toggle
            onClick={() => state.setEnabled(!state.enabled)}
            className={cn(
                'inline-flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                className,
            )}
        >
            <span
                aria-hidden="true"
                className={cn('relative inline-block h-4 w-7 shrink-0 rounded-full border border-border transition-colors', state.enabled ? 'bg-primary' : 'bg-muted')}
            >
                <span className={cn('absolute top-0.5 h-2.5 w-2.5 rounded-full bg-background shadow transition-all', state.enabled ? 'left-3.5' : 'left-0.5')} />
            </span>
            {label}
        </button>
    );
}
