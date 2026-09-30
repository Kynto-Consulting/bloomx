'use client';

import * as React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { ExtensionIcon } from '@/components/expansions/ExtensionIcon';
import type { ExtensionRow } from '@/lib/expansions/manage/model';
import { Button } from '@/components/expansions/kit/Actions';
import { Badge } from '@/components/expansions/kit/Feedback';
import { buttonClasses } from '@/components/expansions/kit/tokens';
import { fmt, useManageStrings } from './strings';

export type ViewMode = 'cards' | 'list';

interface ExtensionItemProps {
    row: ExtensionRow;
    /** Posicion (1..total) en el orden efectivo; null si no es ordenable (manifest invalido). */
    position: number | null;
    total: number;
    view: ViewMode;
    onToggle: (row: ExtensionRow, enabled: boolean) => void;
    onMove: (row: ExtensionRow, direction: -1 | 1) => void;
    onOpen: (row: ExtensionRow) => void;
}

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background';

export function ExtensionSwitch({ checked, label, describedBy, onChange, locked }: { checked: boolean; label: string; describedBy?: string; onChange: (next: boolean) => void; locked?: boolean }) {
    return (
        <button
            type="button" role="switch" aria-checked={checked} aria-label={label} aria-describedby={describedBy}
            aria-disabled={locked || undefined}
            onClick={() => { if (!locked) onChange(!checked); }}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent transition-colors ${checked ? 'bg-primary' : 'bg-input'} ${locked ? 'cursor-not-allowed opacity-60' : ''} ${FOCUS}`}
        >
            <span aria-hidden="true" className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow transition-transform motion-reduce:transition-none ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
    );
}

export const ExtensionItem = React.memo(function ExtensionItem({ row, position, total, view, onToggle, onMove, onOpen }: ExtensionItemProps) {
    const { s, categoryLabel } = useManageStrings();
    const uid = React.useId();
    const titleId = `${uid}-t`;
    const noteId = `${uid}-n`;
    const lockId = `${uid}-l`;
    const list = view === 'list';

    const stateBadge = !row.valid
        ? <Badge tone="danger" label={s.badgeInvalid} size="sm" />
        : row.orgDisabled ? <Badge tone="warning" label={s.badgeOrgDisabled} size="sm" />
            : !row.userEnabled ? <Badge tone="neutral" label={s.badgeUserDisabled} size="sm" />
                : <Badge tone="success" label={s.badgeActive} size="sm" />;

    const moveButton = (direction: -1 | 1) => {
        const disabled = position === null || (direction === -1 ? position <= 1 : position >= total);
        const Icon = direction === -1 ? ChevronUp : ChevronDown;
        return (
            <button
                type="button"
                aria-label={fmt(direction === -1 ? s.moveUp : s.moveDown, { name: row.name })}
                title={fmt(direction === -1 ? s.moveUp : s.moveDown, { name: row.name })}
                aria-disabled={disabled || undefined}
                onClick={() => { onMove(row, direction); }}
                className={`${buttonClasses({ tone: 'neutral', variant: 'outline', size: 'sm', icon: true })} ${disabled ? 'opacity-50' : ''}`}
            >
                <Icon size={16} aria-hidden="true" />
            </button>
        );
    };

    return (
        <li className="min-w-0">
            <article
                aria-labelledby={titleId}
                data-extension-id={row.id}
                data-state={!row.valid ? 'invalid' : row.orgDisabled ? 'org-disabled' : row.userEnabled ? 'active' : 'user-disabled'}
                className={`flex h-full min-w-0 gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground ${list ? 'flex-col sm:flex-row sm:items-center' : 'flex-col'}`}
            >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                    <ExtensionIcon icon={row.icon} label={row.name} size={32} className="mt-0.5" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            {position !== null && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-muted px-1 text-xs font-medium tabular-nums text-muted-foreground" title={fmt(s.orderPosition, { n: position })}><span aria-hidden="true">{position}</span><span className="sr-only">{fmt(s.orderPosition, { n: position })}</span></span>}
                            <h3 id={titleId} className="min-w-0 break-words text-base font-semibold text-foreground">{row.name}</h3>
                            {row.version && <span className="text-xs text-muted-foreground">v{row.version}</span>}
                        </div>
                        {row.description && <p className={`break-words text-sm text-muted-foreground ${list ? 'line-clamp-1' : 'line-clamp-2'}`}>{row.description}</p>}
                        <div className="flex flex-wrap items-center gap-1.5">
                            {stateBadge}
                            {row.valid && <Badge tone="neutral" variant="outline" label={categoryLabel(row.category)} size="sm" />}
                            {row.mandatory && <Badge tone="warning" label={s.badgeMandatory} size="sm" />}
                            {row.updateAvailable && <Badge tone="info" label={s.badgeUpdate} size="sm" />}
                            {row.isPaid === true && <Badge tone="primary" variant="outline" label={row.price && row.price !== '0' ? `${s.badgePaid} ${row.price}${row.currency ? ` ${row.currency}` : ''}` : s.badgePaid} size="sm" />}
                            {row.isPaid === false && <Badge tone="neutral" variant="outline" label={s.badgeFree} size="sm" />}
                            {row.errorCount > 0 && <Badge tone="danger" label={row.errorCount === 1 ? s.errorCountOne : fmt(s.errorCount, { n: row.errorCount })} size="sm" />}
                            {row.tags.slice(0, list ? 3 : 5).map((tag) => <Badge key={tag} tone="neutral" label={tag} size="sm" />)}
                        </div>
                        {!row.valid && (
                            <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-foreground">
                                <p className="font-medium">{s.invalidTitle}</p>
                                <p className="text-muted-foreground">{s.invalidHelp} {row.invalidReasons[0] ?? ''}</p>
                                {row.updateAvailable && <p className="mt-1 font-medium text-foreground">{fmt(s.invalidUpdateHint, { installed: row.version ?? s.unknownVersion, catalog: row.catalogVersion ?? '' })}</p>}
                            </div>
                        )}
                        {row.valid && row.droppedCount > 0 && <p data-testid="degraded-note" className="text-xs text-muted-foreground">{fmt(s.degradedTitle, { n: row.droppedCount })}</p>}
                        {row.valid && row.mandatory && <p id={lockId} data-testid="mandatory-note" className="text-xs text-muted-foreground">{s.mandatoryLocked}</p>}
                        {row.valid && row.orgDisabled && <p id={noteId} className="text-xs text-muted-foreground">{s.noEffect}. {s.noEffectHelp}</p>}
                    </div>
                </div>

                <div className={`flex shrink-0 flex-wrap items-center gap-2 ${list ? 'sm:justify-end' : 'justify-between border-t border-border pt-3'}`}>
                    {row.valid && (
                        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                            <ExtensionSwitch checked={row.userEnabled} locked={row.mandatory} label={row.mandatory ? fmt(s.mandatorySwitch, { name: row.name }) : fmt(s.enableSwitch, { name: row.name })} describedBy={row.mandatory ? lockId : row.orgDisabled ? noteId : undefined} onChange={(next) => onToggle(row, next)} />
                            <span aria-hidden="true">{row.mandatory ? s.mandatoryFor : row.userEnabled ? s.enabledFor : s.disabledFor}</span>
                        </span>
                    )}
                    <span className="inline-flex items-center gap-1.5">
                        {position !== null && <>{moveButton(-1)}{moveButton(1)}</>}
                        <Button label={s.details} variant="soft" size="sm" onPress={() => onOpen(row)}><span className="sr-only">{row.name}</span></Button>
                    </span>
                </div>
            </article>
        </li>
    );
});
