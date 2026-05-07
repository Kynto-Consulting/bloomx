'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

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
}

export function TagInput({ value = [], onChange, placeholder, label, className, suggestionEndpoint }: TagInputProps) {
    const [inputValue, setInputValue] = React.useState('');
    const [suggestions, setSuggestions] = React.useState<TagInputSuggestion[]>([]);
    const [activeSuggestionIndex, setActiveSuggestionIndex] = React.useState(0);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const lastCommitWasKeyboardRef = React.useRef(false);

    const addTag = React.useCallback((nextValue: string, commitSource: 'keyboard' | 'mouse' | 'blur' = 'keyboard') => {
        const newTag = nextValue.trim().replace(',', '');
        if (newTag && !value.includes(newTag)) {
            onChange([...value, newTag]);
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

        if ((e.key === 'Enter' || e.key === 'Tab' || e.key === ',') && inputValue.trim()) {
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
        } else if (e.key === 'Escape') {
            setSuggestions([]);
        }
    };

    const removeTag = (tagToRemove: string) => {
        onChange(value.filter((tag) => tag !== tagToRemove));
    };

    return (
        <div className={cn("flex flex-wrap items-center gap-1.5 p-2 bg-transparent border-b border-input focus-within:border-ring transition-colors", className)}>
            {label && <span className="text-sm font-medium text-muted-foreground select-none mr-1">{label}</span>}

            {value.map((tag) => (
                <div
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-sm rounded-full bg-secondary text-secondary-foreground hover:bg-secondary/80 animate-in fade-in zoom-in-95 duration-200"
                >
                    <span className="max-w-[200px] truncate">{tag}</span>
                    <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="text-muted-foreground hover:text-foreground outline-none"
                    >
                        <X className="h-3 w-3" />
                    </button>
                </div>
            ))}

            <div className="relative min-w-[120px] flex-1">
                <input
                    ref={inputRef}
                    type="text"
                    className="w-full bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                    placeholder={value.length === 0 ? placeholder : ''}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
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
                    <div className="absolute left-0 top-full z-20 mt-2 w-full min-w-[240px] overflow-hidden rounded-xl border bg-background shadow-lg">
                        {suggestions.map((suggestion, index) => (
                            <button
                                key={suggestion.email}
                                type="button"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    addTag(suggestion.email, 'mouse');
                                }}
                                className={cn(
                                    "flex w-full flex-col items-start px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
                                    index === activeSuggestionIndex && "bg-muted"
                                )}
                            >
                                <span className="font-medium text-foreground">{suggestion.name || suggestion.email}</span>
                                {suggestion.name && <span className="text-xs text-muted-foreground">{suggestion.email}</span>}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
