'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, ChevronDown, Search, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/I18nProvider';

export interface AccountSelect {
    /** Mostrar el selector (multicuenta activo, no es borradores y hay cuentas). */
    enabled: boolean;
    options: Array<{ value: string; label: string }>;
    selectedLabel: string;
    /** Valor efectivo ('' = todas las cuentas). */
    value: string;
    onChange: (value: string) => void;
}

interface Props {
    inputRef: RefObject<HTMLInputElement | null>;
    account: AccountSelect;
}

/** Busqueda de correos (Enter), filtros avanzados (de, fechas, con adjunto) y selector de cuenta. Todo vive en la URL. */
export function ListSearch({ inputRef, account }: Props) {
    const { t } = useI18n();
    const router = useRouter();
    const searchParams = useSearchParams();

    const [showFilters, setShowFilters] = useState(false);
    const [filterFrom, setFilterFrom] = useState('');
    const [filterHasAttachment, setFilterHasAttachment] = useState(false);
    const [filterSince, setFilterSince] = useState('');
    const [filterUntil, setFilterUntil] = useState('');
    const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
    const accountMenuRef = useRef<HTMLDivElement | null>(null);

    // Los filtros avanzados se inicializan desde la URL.
    useEffect(() => {
        setFilterFrom(searchParams.get('from') || '');
        setFilterHasAttachment(searchParams.get('hasAttachment') === 'true');
        setFilterSince(searchParams.get('since') || '');
        setFilterUntil(searchParams.get('until') || '');
    }, [searchParams]);

    useEffect(() => {
        if (!isAccountMenuOpen) return;
        const handleOutsideClick = (event: MouseEvent) => {
            if (!accountMenuRef.current?.contains(event.target as Node)) setIsAccountMenuOpen(false);
        };
        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, [isAccountMenuOpen]);

    const applyFilters = () => {
        const params = new URLSearchParams(searchParams);
        if (filterFrom) params.set('from', filterFrom); else params.delete('from');
        if (filterHasAttachment) params.set('hasAttachment', 'true'); else params.delete('hasAttachment');
        if (filterSince) params.set('since', filterSince); else params.delete('since');
        if (filterUntil) params.set('until', filterUntil); else params.delete('until');
        setShowFilters(false);
        router.push(`/?${params.toString()}`);
    };

    const clearFilters = () => {
        setFilterFrom('');
        setFilterHasAttachment(false);
        setFilterSince('');
        setFilterUntil('');
        setShowFilters(false);
        const params = new URLSearchParams(searchParams);
        ['from', 'hasAttachment', 'since', 'until'].forEach((k) => params.delete(k));
        router.push(`/?${params.toString()}`);
    };

    const chooseAccount = (value: string) => {
        setIsAccountMenuOpen(false);
        account.onChange(value);
    };

    return (
        <div className="hidden border-b border-border bg-header px-4 py-2 text-header-foreground md:block">
            <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <input
                    ref={inputRef}
                    aria-label={t('emailList.search.label')}
                    placeholder={t('emailList.search.placeholder')}
                    defaultValue={searchParams.get('q') || ''}
                    className="h-9 w-full rounded-xl border border-input bg-background pl-9 pr-10 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring/50"
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            const val = (e.target as HTMLInputElement).value;
                            const params = new URLSearchParams(searchParams);
                            if (val) params.set('q', val); else params.delete('q');
                            router.push(`/?${params.toString()}`);
                        }
                    }}
                />
                <button
                    type="button"
                    aria-label={t('emailList.search.advancedToggle')}
                    aria-expanded={showFilters}
                    onClick={() => setShowFilters(!showFilters)}
                    className={cn('absolute right-2 top-1.5 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', (filterFrom || filterHasAttachment || filterSince || filterUntil) && 'text-primary')}
                >
                    <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                </button>

                {showFilters && (
                    <div className="absolute right-0 top-11 z-50 flex w-72 flex-col gap-3 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('emailList.search.advancedTitle')}</h3>
                        <div className="space-y-1">
                            <label htmlFor="bx-filter-from" className="text-xs font-medium">{t('emailList.search.from')}</label>
                            <input
                                id="bx-filter-from"
                                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                                placeholder={t('emailList.search.fromPlaceholder')}
                                value={filterFrom}
                                onChange={(e) => setFilterFrom(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                                <label htmlFor="bx-filter-since" className="text-xs font-medium">{t('emailList.search.dateStart')}</label>
                                <input id="bx-filter-since" type="date" className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm" value={filterSince} onChange={(e) => setFilterSince(e.target.value)} />
                            </div>
                            <div className="space-y-1">
                                <label htmlFor="bx-filter-until" className="text-xs font-medium">{t('emailList.search.dateEnd')}</label>
                                <input id="bx-filter-until" type="date" className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm" value={filterUntil} onChange={(e) => setFilterUntil(e.target.value)} />
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <input type="checkbox" id="hasAttachment" className="h-4 w-4 rounded border-input accent-primary" checked={filterHasAttachment} onChange={(e) => setFilterHasAttachment(e.target.checked)} />
                            <label htmlFor="hasAttachment" className="text-sm">{t('emailList.search.hasAttachment')}</label>
                        </div>
                        <div className="mt-1 flex justify-end gap-2">
                            <button type="button" onClick={clearFilters} className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">{t('emailList.search.clear')}</button>
                            <button type="button" onClick={applyFilters} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90">{t('common.search')}</button>
                        </div>
                    </div>
                )}
            </div>

            {account.enabled && (
                <div className="mt-2 flex items-center gap-2">
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">{t('emailList.account')}</span>
                    <div ref={accountMenuRef} className="relative min-w-[220px] max-w-full">
                        <button
                            type="button"
                            aria-haspopup="listbox"
                            aria-expanded={isAccountMenuOpen}
                            aria-label={`${t('emailList.account')}: ${account.selectedLabel}`}
                            onClick={() => setIsAccountMenuOpen((previous) => !previous)}
                            className="group h-9 w-full rounded-xl border border-border bg-background pl-3 pr-9 text-left text-sm shadow-sm transition-all hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <span className="line-clamp-1 pr-1 text-foreground">{account.selectedLabel}</span>
                            <ChevronDown className={cn('pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-transform', isAccountMenuOpen && 'rotate-180 text-foreground')} aria-hidden="true" />
                        </button>
                        {isAccountMenuOpen && (
                            <div className="absolute top-11 z-50 w-full overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl">
                                <div role="listbox" aria-label={t('emailList.account')} className="max-h-64 overflow-y-auto p-1">
                                    {[{ value: '', label: t('emailList.allAccounts') }, ...account.options].map((option) => {
                                        const selected = account.value === option.value;
                                        return (
                                            <button
                                                key={option.value || 'all'}
                                                type="button"
                                                role="option"
                                                aria-selected={selected}
                                                onClick={() => chooseAccount(option.value)}
                                                className={cn(
                                                    'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                                    option.value && 'mt-1',
                                                    selected ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted',
                                                )}
                                            >
                                                <span className="line-clamp-1 text-left">{option.label}</span>
                                                {selected && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
