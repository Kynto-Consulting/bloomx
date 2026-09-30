'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/I18nProvider';
import type { SlashCommand } from '@/lib/slash-commands';
import { ExtensionIcon } from '@/components/expansions/ExtensionIcon';

export interface SlashMenuProps {
    /** Prefijo de ids (el editor referencia `${id}-listbox` y `${id}-option-N` con aria-controls/activedescendant). */
    id: string;
    commands: readonly SlashCommand[];
    activeIndex: number;
    x: number;
    y: number;
    onSelect: (command: SlashCommand) => void;
    onHover?: (index: number) => void;
}

export const slashOptionId = (id: string, index: number) => `${id}-option-${index}`;
export const slashListboxId = (id: string) => `${id}-listbox`;

const MENU_WIDTH = 320;

/**
 * Menu flotante de comandos "/". El foco se queda en el editor: los clics usan onMouseDown+preventDefault y el
 * lector de pantalla sigue la opcion activa por aria-activedescendant (lo fija el editor). Anuncia la cantidad de
 * resultados en una region role="status".
 */
export function SlashMenu({ id, commands, activeIndex, x, y, onSelect, onHover }: SlashMenuProps) {
    const { t } = useI18n();
    const activeRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        activeRef.current?.scrollIntoView?.({ block: 'nearest' });
    }, [activeIndex, commands]);

    const left = typeof window === 'undefined' ? x : Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8));

    return (
        <div
            className="fixed z-50 flex w-80 max-w-[calc(100vw-1rem)] flex-col rounded-md border border-border bg-card font-sans shadow-xl animate-in fade-in zoom-in-95"
            style={{ left, top: y }}
            data-slash-menu=""
        >
            <div role="status" className="sr-only">
                {commands.length === 0 ? t('compose.slashNone') : t('compose.slashCount', { count: commands.length })}
            </div>
            {commands.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">{t('compose.slashNone')}</div>
            ) : (
                <div
                    role="listbox"
                    id={slashListboxId(id)}
                    aria-label={t('compose.slashLabel')}
                    className="max-h-56 overflow-y-auto p-1"
                >
                    {commands.map((cmd, i) => {
                        const active = i === activeIndex;
                        return (
                            <div
                                key={cmd.key}
                                id={slashOptionId(id, i)}
                                role="option"
                                aria-selected={active}
                                ref={active ? activeRef : undefined}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    onSelect(cmd);
                                }}
                                onMouseMove={() => { if (!active) onHover?.(i); }}
                                className={cn(
                                    'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                                    active ? 'bg-primary/10 text-primary' : 'hover:bg-muted',
                                )}
                            >
                                {cmd.extensionIcon
                                    ? <ExtensionIcon icon={cmd.extensionIcon} size={20} />
                                    : <div aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded bg-secondary/50 text-[10px] font-bold text-muted-foreground">/</div>}
                                <div className="flex min-w-0 flex-col leading-tight">
                                    <span className="truncate text-xs font-semibold">
                                        {cmd.key}
                                        {cmd.arguments && <span className="ml-1 font-normal text-muted-foreground opacity-75">{cmd.arguments}</span>}
                                    </span>
                                    <span className="truncate text-[10px] text-muted-foreground">
                                        {cmd.description}
                                        {cmd.extensionName ? ` · ${t('compose.slashFrom', { name: cmd.extensionName })}` : ''}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
