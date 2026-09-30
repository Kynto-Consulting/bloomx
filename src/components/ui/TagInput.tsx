'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { splitAddressList } from '@/lib/email-utils';
import { isValidEmailAddress, extractAddress } from '@/lib/mail-validation';

interface TagInputSuggestion {
    email: string;
    name?: string;
}

interface TagInputProps {
    value: string[];
    onChange: (tags: string[]) => void;
    placeholder?: string;
    label?: string;
    className?: string;
    suggestionEndpoint?: string;
    /** id del <input> (para asociarlo con un <label htmlFor>). */
    inputId?: string;
    /** Nombre accesible cuando no hay <label> visible asociado. */
    ariaLabel?: string;
}

/** Clave de comparacion para no duplicar etiquetas ("Ana <A@x.com>" == "a@x.com"). */
function tagKey(tag: string): string {
    return extractAddress(tag).replace(/^"+|"+$/g, '').toLowerCase();
}

export function isValidTag(tag: string): boolean {
    return isValidEmailAddress(extractAddress(tag));
}

export function TagInput({ value = [], onChange, placeholder, label, className, suggestionEndpoint, inputId, ariaLabel }: TagInputProps) {
    const [inputValue, setInputValue] = React.useState('');
    const [suggestions, setSuggestions] = React.useState<TagInputSuggestion[]>([]);
    const [activeSuggestionIndex, setActiveSuggestionIndex] = React.useState(0);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const lastCommitWasKeyboardRef = React.useRef(false);
    const reactId = React.useId();
    const listboxId = `${reactId}-suggestions`;

    const addTag = React.useCallback((nextValue: string, commitSource: 'keyboard' | 'mouse' | 'blur' = 'keyboard') => {
        const incoming = splitAddressList(nextValue);
        const merged = [...value];
        const seen = new Set(merged.map(tagKey));
        for (const tag of incoming) {
            const key = tagKey(tag);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            merged.push(tag);
        }
        if (merged.length !== value.length) {
            onChange(merged);
        }
        lastCommitWasKeyboardRef.current = commitSource !== 'blur';
        setInputValue('');
        setSuggestions([]);
        setActiveSuggestionIndex(0);
    }, [onChange, value]);

    React.useEffect(() => {
        if (!suggestionEndpoint || inputValue.trim().length < 1) {
            setSuggestions([]);
            setActiveSuggestionIndex(0);
            return;
        }

        let cancelled = false;
        const controller = new AbortController();

        const timeoutId = window.setTimeout(async () => {
            try {
                const response = await fetch(`${suggestionEndpoint}?q=${encodeURIComponent(inputValue.trim())}`, {
                    signal: controller.signal,
                });

                if (!response.ok) {
                    throw new Error('Failed to load suggestions');
                }

                const data = await response.json();
                if (!cancelled) {
                    setSuggestions(Array.isArray(data) ? data : []);
                    setActiveSuggestionIndex(0);
                }
            } catch {
                if (!cancelled) {
                    setSuggestions([]);
                }
            }
        }, 120);

        return () => {
            cancelled = true;
            controller.abort();
            window.clearTimeout(timeoutId);
        };
    }, [inputValue, suggestionEndpoint]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown' && suggestions.length > 0) {
            e.preventDefault();
            setActiveSuggestionIndex((current) => (current + 1) % suggestions.length);
            return;
        }

        if (e.key === 'ArrowUp' && suggestions.length > 0) {
            e.preventDefault();
            setActiveSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
            return;
        }

        if ((e.key === 'Enter' || e.key === 'Tab' || e.key === ',' || e.key === ';') && inputValue.trim()) {
            e.preventDefault();
            e.stopPropagation();
            const activeSuggestion = suggestions[activeSuggestionIndex];
            if (activeSuggestion?.email) {
                addTag(activeSuggestion.email, 'keyboard');
                return;
            }

            addTag(inputValue, 'keyboard');
        } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
            e.preventDefault();
            const newValue = [...value];
            newValue.pop();
            onChange(newValue);
        } else if (e.key === 'Escape' && suggestions.length > 0) {
            // Cierra solo la lista; el Escape no debe llegar al composer (que cerraria la ventana).
            e.preventDefault();
            e.stopPropagation();
            setSuggestions([]);
        }
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
        const text = e.clipboardData.getData('text');
        // Varias direcciones pegadas de golpe ("a@x.com, b@y.com; c@z.com"): se convierten en etiquetas.
        if (splitAddressList(text).length > 1 || /[\n\r\t]/.test(text)) {
            e.preventDefault();
            addTag(text.replace(/[\r\n\t]+/g, ','), 'keyboard');
        }
    };

    const removeTag = (tagToRemove: string) => {
        onChange(value.filter((tag) => tag !== tagToRemove));
        inputRef.current?.focus();
    };

    const activeOptionId = suggestions.length > 0 ? `${listboxId}-${activeSuggestionIndex}` : undefined;

    return (
        <div className={cn("flex flex-wrap items-center gap-1.5 p-2 bg-transparent border-b border-input focus-within:border-ring transition-colors", className)}>
            {label && <span className="text-sm font-medium text-muted-foreground select-none mr-1">{label}</span>}

            {value.map((tag) => {
                const valid = isValidTag(tag);
                return (
                    <div
                        key={tag}
                        className={cn(
                            "inline-flex items-center gap-1 px-2 py-0.5 text-sm rounded-full bg-secondary text-secondary-foreground hover:bg-secondary/80 animate-in fade-in zoom-in-95 duration-200",
                            !valid && "ring-1 ring-destructive text-destructive"
                        )}
                        title={valid ? undefined : 'Direccion de correo no valida'}
                    >
                        <span className="max-w-[200px] truncate">{tag}</span>
                        {!valid && <span className="sr-only"> (direccion no valida)</span>}
                        <button
                            type="button"
                            onClick={() => removeTag(tag)}
                            className="text-muted-foreground hover:text-foreground rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                            aria-label={`Quitar ${tag}`}
                        >
                            <X className="h-3 w-3" aria-hidden="true" />
                        </button>
                    </div>
                );
            })}

            <div className="relative min-w-[120px] flex-1">
                <input
                    ref={inputRef}
                    id={inputId}
                    type="text"
                    role="combobox"
                    aria-label={inputId ? undefined : (ariaLabel || label)}
                    aria-autocomplete="list"
                    aria-expanded={suggestions.length > 0}
                    aria-controls={suggestions.length > 0 ? listboxId : undefined}
                    aria-activedescendant={activeOptionId}
                    autoComplete="off"
                    className="w-full bg-transparent text-sm placeholder:text-muted-foreground outline-none focus-visible:underline focus-visible:decoration-ring"
                    placeholder={value.length === 0 ? placeholder : ''}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    onBlur={() => {
                        window.setTimeout(() => {
                            if (lastCommitWasKeyboardRef.current) {
                                lastCommitWasKeyboardRef.current = false;
                                return;
                            }

                            if (inputValue.trim()) {
                                addTag(inputValue, 'blur');
                            } else {
                                setSuggestions([]);
                            }
                        }, 120);
                    }}
                />

                {suggestions.length > 0 && (
                    <div
                        id={listboxId}
                        role="listbox"
                        aria-label="Sugerencias de contactos"
                        className="absolute left-0 top-full z-20 mt-2 w-full min-w-[240px] overflow-hidden rounded-xl border bg-background shadow-lg"
                    >
                        {suggestions.map((suggestion, index) => (
                            <div
                                key={suggestion.email}
                                id={`${listboxId}-${index}`}
                                role="option"
                                aria-selected={index === activeSuggestionIndex}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    addTag(suggestion.email, 'mouse');
                                }}
                                className={cn(
                                    "flex w-full cursor-pointer flex-col items-start px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
                                    index === activeSuggestionIndex && "bg-muted"
                                )}
                            >
                                <span className="font-medium text-foreground">{suggestion.name || suggestion.email}</span>
                                {suggestion.name && <span className="text-xs text-muted-foreground">{suggestion.email}</span>}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
