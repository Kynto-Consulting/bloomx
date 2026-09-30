'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { search } from '../_content/search';
import { ui } from '../_content/ui';

/** Buscador de la documentacion (filtrado en el cliente, sin dependencias). Patron combobox accesible. */
export function DocsSearch({ className }: { className?: string }) {
    const { locale } = useI18n();
    const [q, setQ] = useState('');
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const boxRef = useRef<HTMLDivElement>(null);
    const listId = useId();
    const results = useMemo(() => search(locale, q), [locale, q]);

    useEffect(() => { setActive(0); }, [q]);
    useEffect(() => {
        const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, []);
    // Atajo "/" para enfocar el buscador (fuera de campos de texto).
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const el = e.target as HTMLElement | null;
            const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
            if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); inputRef.current?.focus(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const show = open && q.trim().length > 0;
    const tooShort = q.trim().length < 2;

    return (
        <div ref={boxRef} className={className} role="search">
            <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                    ref={inputRef}
                    type="search"
                    role="combobox"
                    aria-expanded={show}
                    aria-controls={listId}
                    aria-autocomplete="list"
                    aria-activedescendant={show && results[active] ? `${listId}-${active}` : undefined}
                    aria-label={ui(locale, 'search')}
                    placeholder={ui(locale, 'searchPlaceholder')}
                    value={q}
                    autoComplete="off"
                    onChange={(e) => { setQ(e.target.value); setOpen(true); }}
                    onFocus={() => setOpen(true)}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') { setOpen(false); (e.target as HTMLInputElement).blur(); }
                        else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, Math.max(results.length - 1, 0))); }
                        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                        else if (e.key === 'Enter' && results[active]) { e.preventDefault(); window.location.assign(results[active].href); }
                    }}
                    className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
            </div>
            {show && (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg">
                    {tooShort ? (
                        <p className="px-3 py-2 text-sm text-muted-foreground">{ui(locale, 'searchHint')}</p>
                    ) : results.length === 0 ? (
                        <p className="px-3 py-2 text-sm text-muted-foreground" role="status">{ui(locale, 'searchNoResults', { q })}</p>
                    ) : (
                        <ul id={listId} role="listbox" aria-label={ui(locale, 'searchResults', { n: results.length })}>
                            {results.map((r, i) => (
                                <li key={r.href + i} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                                    <Link
                                        href={r.href}
                                        onClick={() => setOpen(false)}
                                        onMouseEnter={() => setActive(i)}
                                        className={`block rounded px-3 py-2 text-sm ${i === active ? 'bg-accent text-accent-foreground' : ''}`}
                                    >
                                        <span className="block font-medium">{r.heading}</span>
                                        <span className="block text-xs text-muted-foreground">{r.page}</span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
