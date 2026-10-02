'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { describePermissions } from '@/lib/expansions/manage/permissions';
import { mountLabel } from '@/lib/expansions/manage/mount-labels';
import type { ExtensionErrorEntry } from '@/lib/expansions/client/error-log';
import type { ExtensionRow } from '@/lib/expansions/manage/model';
import { Alert, Badge } from '@/components/expansions/kit/Feedback';
import { Button } from '@/components/expansions/kit/Actions';
import { ExtensionIcon } from '@/components/expansions/ExtensionIcon';
import { ExtensionSwitch } from './ExtensionItem';
import { ExtensionPreview } from './ExtensionPreview';
import { ErrorsPanel } from './ErrorsPanel';
import { AiRequirementNote } from './AiRequirementNote';
import { fmt, useManageStrings } from './strings';

const LEVEL_TONE = { low: 'neutral', medium: 'warning', high: 'danger' } as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    const id = React.useId();
    return (
        <section aria-labelledby={id} className="space-y-2">
            <h3 id={id} className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
            {children}
        </section>
    );
}

/** Actualizar a la version del catalogo (solo administradores; la ruta del servidor vuelve a comprobar sesion y propiedad). */
export interface DetailUpdater {
    canUpdate: boolean;
    busyId: string | null;
    onUpdate: (row: ExtensionRow) => void;
}

interface ExtensionDetailProps {
    updater?: DetailUpdater;
    row: ExtensionRow | null;
    rows: ExtensionRow[];
    errors: ExtensionErrorEntry[];
    now: number;
    canOpenPlayground: boolean;
    announce: (message: string) => void;
    onToggle: (row: ExtensionRow, enabled: boolean) => void;
    onClose: () => void;
}

/** Panel lateral con el detalle de una extension: foco atrapado, Escape cierra y devuelve el foco (ui/Drawer). */
export function ExtensionDetail({ row, rows, errors, now, canOpenPlayground, announce, onToggle, onClose, updater }: ExtensionDetailProps) {
    const { s } = useManageStrings();
    return (
        <Drawer open={row !== null} onClose={onClose} label={row ? fmt(s.detailOf, { name: row.name }) : ''} side="right" className="flex w-full max-w-xl flex-col overflow-hidden border-l border-border">
            {row && <DetailBody row={row} rows={rows} errors={errors} now={now} canOpenPlayground={canOpenPlayground} announce={announce} onToggle={onToggle} onClose={onClose} updater={updater} />}
        </Drawer>
    );
}

function DetailBody({ row, rows, errors, now, canOpenPlayground, announce, onToggle, onClose, updater }: Omit<ExtensionDetailProps, 'row'> & { row: ExtensionRow }) {
    const { s, lang, categoryLabel, levelLabel } = useManageStrings();
    const permissions = React.useMemo(() => describePermissions(row.permissions, lang), [row.permissions, lang]);
    const mounts = React.useMemo(() => row.mountPoints.map((point) => ({ point, label: mountLabel(point, lang) })), [row.mountPoints, lang]);
    const initialState = React.useMemo(() => {
        const state = row.template?.state;
        if (!state || typeof state !== 'object' || Array.isArray(state)) return undefined;
        try { return JSON.stringify(state).length <= 50_000 ? state : undefined; } catch { return undefined; }
    }, [row.template]);

    return (
        <div className="flex h-full min-h-0 flex-col" data-testid="extension-detail">
            <header className="flex items-start justify-between gap-3 border-b border-border p-4">
                <div className="flex min-w-0 items-start gap-3">
                    <ExtensionIcon icon={row.icon} label={row.name} size={32} className="mt-0.5" />
                    <div className="min-w-0 space-y-1">
                        <h2 className="break-words text-xl font-semibold text-foreground">{row.name}</h2>
                        <p className="text-xs text-muted-foreground">{s.idLabel}: <code className="break-all">{row.id}</code></p>
                    </div>
                </div>
                <button
                    type="button" onClick={onClose} aria-label={s.closeDetail} title={s.closeDetail}
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                ><X size={18} aria-hidden="true" /></button>
            </header>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
                {!row.valid && (
                    <Alert tone="danger" title={s.invalidTitle}>
                        <p>{s.invalidHelp}</p>
                        <ul className="list-disc space-y-0.5 pl-4">{row.invalidReasons.map((reason, i) => <li key={i} className="break-words">{reason}</li>)}</ul>
                        {row.updateAvailable && <p className="font-medium">{fmt(s.invalidUpdateHint, { installed: row.version ?? s.unknownVersion, catalog: row.catalogVersion ?? '' })}</p>}
                    </Alert>
                )}
                {row.valid && row.problems.length > 0 && (
                    <Alert tone="warning" title={row.droppedCount > 0 ? fmt(s.degradedTitle, { n: row.droppedCount }) : s.problemsTitle}>
                        {row.updateAvailable && <p className="font-medium">{fmt(s.invalidUpdateHint, { installed: row.version ?? s.unknownVersion, catalog: row.catalogVersion ?? '' })}</p>}
                        <ul className="list-disc space-y-0.5 pl-4" data-testid="manifest-problems">{row.problems.slice(0, 10).map((problem, i) => <li key={i} className="break-words"><code>{problem.path}</code>: {problem.message}</li>)}</ul>
                    </Alert>
                )}
                {row.valid && row.orgDisabled && <Alert tone="warning" title={s.noEffect} message={s.noEffectHelp} />}
                {row.updateAvailable && (
                    <Alert tone="info" message={fmt(s.updateAvailable, { catalog: row.catalogVersion ?? '', installed: row.version ?? s.unknownVersion })}>
                        {updater?.canUpdate && (
                            <Button
                                label={updater.busyId === row.id ? s.updating : s.updateAction}
                                size="sm"
                                loading={updater.busyId === row.id}
                                disabled={updater.busyId !== null}
                                onPress={() => updater.onUpdate(row)}
                            ><span className="sr-only">{fmt(s.updateAria, { name: row.name, catalog: row.catalogVersion ?? '' })}</span></Button>
                        )}
                    </Alert>
                )}

                <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
                    <dt className="text-muted-foreground">{s.installedVersion}</dt><dd className="text-foreground">{row.version ?? s.unknownVersion}</dd>
                    {row.catalogVersion && <><dt className="text-muted-foreground">{s.catalogVersion}</dt><dd className="text-foreground">{row.catalogVersion}</dd></>}
                    {row.valid && <><dt className="text-muted-foreground">{s.category}</dt><dd className="text-foreground">{categoryLabel(row.category)}</dd></>}
                    {row.isPaid !== null && <><dt className="text-muted-foreground">{s.price}</dt><dd className="text-foreground">{row.isPaid ? `${row.price ?? ''} ${row.currency ?? ''}`.trim() || s.badgePaid : s.free}</dd></>}
                    {row.tags.length > 0 && <><dt className="text-muted-foreground">{s.tags}</dt><dd className="flex flex-wrap gap-1">{row.tags.map((t) => <Badge key={t} label={t} size="sm" />)}</dd></>}
                </dl>

                {row.valid && !row.orgDisabled && (
                    <div className="flex items-center gap-3 text-sm text-foreground">
                        <ExtensionSwitch checked={row.userEnabled} locked={row.mandatory} label={row.mandatory ? fmt(s.mandatorySwitch, { name: row.name }) : fmt(s.enableSwitch, { name: row.name })} describedBy={row.mandatory ? 'mandatory-detail-note' : undefined} onChange={(next) => onToggle(row, next)} />
                        <span aria-hidden="true">{row.mandatory ? s.mandatoryFor : row.userEnabled ? s.enabledFor : s.disabledFor}</span>
                        {row.mandatory && <span id="mandatory-detail-note" className="basis-full text-xs text-muted-foreground">{s.mandatoryLocked}</span>}
                    </div>
                )}

                <Section title={s.description}>
                    <p className="whitespace-pre-wrap break-words text-sm text-foreground">{row.description || s.noDescription}</p>
                </Section>

                <Section title={s.permissions}>
                    {permissions.length === 0 ? <p className="text-sm text-muted-foreground">{s.noPermissions}</p> : (
                        <ul className="space-y-2" data-testid="permission-list">
                            {permissions.map((p) => (
                                <li key={p.permission} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border bg-card p-3 text-sm text-card-foreground">
                                    <div className="min-w-0">
                                        <p className="break-words text-foreground">{p.known ? p.text : <code>{p.permission}</code>}</p>
                                        {!p.known && <p className="text-xs text-muted-foreground">{s.undocumentedPermission}</p>}
                                    </div>
                                    <Badge tone={LEVEL_TONE[p.level]} variant="soft" size="sm" label={fmt(s.sensitivityShort, { level: levelLabel(p.level) })} />
                                </li>
                            ))}
                        </ul>
                    )}
                </Section>

                <AiRequirementNote row={row} />

                <Section title={s.whereAppears}>
                    {mounts.length === 0 ? <p className="text-sm text-muted-foreground">{s.noMounts}</p> : (
                        <ul className="flex flex-wrap gap-1.5">{mounts.map((m) => <li key={m.point}><Badge tone="neutral" variant="outline" label={m.label} size="md" /></li>)}</ul>
                    )}
                </Section>

                {row.valid && (
                    <Section title={s.preview}>
                        <ExtensionPreview extensionId={row.id} template={row.template} initialState={initialState} />
                    </Section>
                )}

                {row.screenshots.length > 0 && (
                    <Section title={s.screenshots}>
                        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {row.screenshots.map((src, i) => (
                                <li key={src}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={src} alt={fmt(s.screenshotAlt, { n: i + 1, name: row.name })} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-auto max-h-56 w-full rounded-lg border border-border object-contain" />
                                </li>
                            ))}
                        </ul>
                    </Section>
                )}

                <Section title={s.changelog}>
                    {row.changelog.length === 0 ? <p className="text-sm text-muted-foreground">{s.noChangelog}</p> : (
                        <ol className="space-y-3">
                            {row.changelog.map((entry, i) => (
                                <li key={`${entry.version}-${i}`} className="text-sm">
                                    <p className="font-medium text-foreground">v{entry.version}{entry.date && <span className="ml-2 font-normal text-muted-foreground">{entry.date}</span>}</p>
                                    {entry.notes && <p className="whitespace-pre-wrap break-words text-muted-foreground">{entry.notes}</p>}
                                </li>
                            ))}
                        </ol>
                    )}
                </Section>

                <ErrorsPanel errors={errors} rows={rows} now={now} scopeId={row.id} canOpenPlayground={canOpenPlayground} announce={announce} headingLevel={3} />
            </div>
        </div>
    );
}
