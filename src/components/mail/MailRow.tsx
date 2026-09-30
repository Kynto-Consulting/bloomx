'use client';

import { memo, useEffect, useRef, useState, type DragEvent as ReactDragEvent, type FocusEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { motion } from 'framer-motion';
import { Check, Paperclip, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/I18nProvider';
import { labelDisplayName } from '@/lib/organizer/labels';
import { formatMailDate } from '@/lib/i18n/format';
import type { LabelRef, ListEmail } from '@/lib/mail-list';
import { senderName, type AttachmentSummary } from '@/lib/mail-list-view';
import { getSurfaceActions, type MailActionId } from '@/lib/mail-actions';
import { createVelocityTracker, eventTime, resolveSwipe, swipeProgress } from '@/lib/mail-gestures';
import { densityClasses, type MailDensity, type SnippetLines } from '@/lib/mail-prefs';
import { ACTION_META } from './action-meta';
import { Avatar } from './ui';

const LEGACY_NO_SUBJECT = '(No Subject)';

export type RowMenuKind = 'label' | 'snooze' | 'reschedule';

export interface MailRowProps {
    email: ListEmail;
    index: number;
    virtual?: boolean;
    ariaPos?: { 'aria-posinset': number; 'aria-setsize': number };
    threadCount: number;
    participants: { names: string[]; extra: number };
    attachments: AttachmentSummary;
    labels: LabelRef[];
    labelsKey: string;
    folder: string;
    density: MailDensity;
    snippetLines: SnippetLines;
    isSelected: boolean;
    isFocused: boolean;
    isOpen: boolean;
    /** Acciones de swipe ya resueltas segun carpeta y preferencias (null = sin gesto en ese lado). */
    swipeRight: MailActionId | null;
    swipeLeft: MailActionId | null;
    swipeEnabled: boolean;
    /** Arrastrar la fila a una carpeta/etiqueta del Sidebar (escritorio; el movil usa gestos y el menu Mover a...). */
    draggable?: boolean;
    onDragStartRow?: (id: string, e: ReactDragEvent) => void;
    onDragEndRow?: () => void;
    onFocusRow: (id: string) => void;
    onSelect: (id: string) => void;
    onSelectToggle: (e: { stopPropagation?: () => void; shiftKey?: boolean }, id: string) => void;
    onPrefetch: (id: string) => void;
    /** Accion directa sobre el hilo de la fila (archivar, eliminar, leido, destacar...). */
    onAction: (action: MailActionId, id: string) => void;
    /** Abre un menu (etiquetar / posponer) anclado al boton pulsado. */
    onMenu: (kind: RowMenuKind, id: string, anchor: HTMLElement) => void;
}

function swipeTone(action: MailActionId | null): string {
    if (!action) return 'bg-muted text-muted-foreground';
    if (ACTION_META[action].destructive) return 'bg-destructive text-destructive-foreground';
    if (action === 'markRead' || action === 'markUnread') return 'bg-info text-info-foreground';
    if (action === 'star' || action === 'unstar') return 'bg-warning text-warning-foreground';
    return 'bg-success text-success-foreground';
}

function MailRowInner({
    email, index, virtual = false, ariaPos, threadCount, participants, attachments, labels, folder, density, snippetLines,
    isSelected, isFocused, isOpen, swipeRight, swipeLeft, swipeEnabled, draggable = false, onDragStartRow, onDragEndRow,
    onFocusRow, onSelect, onSelectToggle, onPrefetch, onAction, onMenu,
}: MailRowProps) {
    // useI18n (contexto) re-renderiza la fila al cambiar de idioma aunque `memo` bloquee las props.
    const { t, intlLocale } = useI18n();
    const [dragX, setDragX] = useState(0);
    // El navegador puede cancelar el toque (empieza a hacer scroll vertical): en ese caso nunca se ejecuta la accion del swipe.
    const gestureCancelled = useRef(false);
    // Velocidad propia del gesto (con los timeStamp de los eventos): decide el "flick"; la de framer-motion solo es el respaldo.
    const tracker = useRef(createVelocityTracker());
    const stopTracking = useRef<(() => void) | null>(null);
    useEffect(() => () => { stopTracking.current?.(); }, []);
    // Tras arrastrar, el ultimo "click" sintetico no debe abrir el correo.
    const justDragged = useRef(false);
    const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dim = densityClasses(density);
    const compact = density === 'compact';

    const unread = !email.read;
    const legacySubject = email.subject === LEGACY_NO_SUBJECT;
    const subjectText = !email.subject || legacySubject ? t('emailList.noSubject') : email.subject;
    const isOutgoing = folder === 'drafts' || folder === 'sent' || folder === 'scheduled';
    const recipient = email.cleanTo || email.to;
    const senderText = folder === 'drafts'
        ? (email.to ? t('emailList.toPrefix', { to: email.to }) : t('emailList.noRecipients'))
        : isOutgoing && recipient
            ? t('emailList.toPrefix', { to: recipient })
            : senderName(email.from) || email.from;
    const avatarSource = isOutgoing ? (recipient || '') : email.from;
    const showParticipants = threadCount > 1 && !isOutgoing && participants.names.length > 0;
    const participantsText = showParticipants
        ? participants.names.join(', ') + (participants.extra > 0 ? ` +${participants.extra}` : '')
        : senderText;

    const attachmentLabel = attachments.count > 0
        ? `${t(attachments.count === 1 ? 'emailList.row.attachmentOne' : 'emailList.row.attachmentMany', { n: attachments.count })}: ${attachments.names.filter(Boolean).join(', ')}`
        : '';
    const ariaLabel = [
        unread ? `${t('emailList.unread')}. ` : '',
        email.starred ? `${t('emailList.row.starredState')}. ` : '',
        `${participantsText}. ${subjectText}`,
        threadCount > 1 ? `. ${t('emailList.threadMessages', { n: threadCount })}` : '',
        attachmentLabel ? `. ${attachmentLabel}` : '',
    ].join('');

    const hoverActions = getSurfaceActions(folder, 'hover', { allRead: Boolean(email.read) });
    const archiveOpacity = swipeProgress(dragX, 'right');
    const trashOpacity = swipeProgress(dragX, 'left');
    const SwipeRightIcon = swipeRight ? ACTION_META[swipeRight].icon : null;
    const SwipeLeftIcon = swipeLeft ? ACTION_META[swipeLeft].icon : null;

    const handleDragEnd = (_: unknown, info: { offset: { x: number; y: number }; velocity: { x: number } }) => {
        // Con al menos dos muestras la velocidad es la nuestra (una pausa antes de soltar = 0); sin ellas, la de framer-motion.
        const velocityX = tracker.current.count() >= 2 ? tracker.current.velocity() : info.velocity?.x;
        const side = resolveSwipe({ offsetX: info.offset.x, offsetY: info.offset.y, velocityX, cancelled: gestureCancelled.current });
        gestureCancelled.current = false;
        if (side === 'right' && swipeRight) onAction(swipeRight, email.id);
        else if (side === 'left' && swipeLeft) onAction(swipeLeft, email.id);
    };

    const runHover = (action: MailActionId, e: ReactMouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        if (action === 'label' || action === 'snooze' || action === 'reschedule') onMenu(action, email.id, e.currentTarget);
        else onAction(action, email.id);
    };

    // Programados: la fecha que importa es la de ENVIO (scheduledAt), no la de creacion.
    const dateText = formatMailDate(folder === 'scheduled' && email.scheduledAt ? String(email.scheduledAt) : email.createdAt, intlLocale);
    const selectedLook = isSelected || isOpen;

    return (
        <div
            role="listitem"
            {...(ariaPos || {})}
            draggable={draggable || undefined}
            onDragStart={draggable ? (e) => onDragStartRow?.(email.id, e) : undefined}
            onDragEnd={draggable ? onDragEndRow : undefined}
            className="relative overflow-hidden rounded-xl"
        >
            {/* Capas del gesto (solo se ven al arrastrar) */}
            {swipeEnabled && (
                <>
                    <div aria-hidden="true" className={cn('absolute inset-0 flex items-center justify-start gap-2 pl-6', swipeTone(swipeRight))} style={{ opacity: swipeRight ? archiveOpacity : 0 }}>
                        {SwipeRightIcon && <SwipeRightIcon className="h-6 w-6" />}
                        {swipeRight && <span className="text-sm font-medium">{t(ACTION_META[swipeRight].labelKey)}</span>}
                    </div>
                    <div aria-hidden="true" className={cn('absolute inset-0 flex items-center justify-end gap-2 pr-6', swipeTone(swipeLeft))} style={{ opacity: swipeLeft ? trashOpacity : 0 }}>
                        {swipeLeft && <span className="text-sm font-medium">{t(ACTION_META[swipeLeft].labelKey)}</span>}
                        {SwipeLeftIcon && <SwipeLeftIcon className="h-6 w-6" />}
                    </div>
                </>
            )}

            <motion.div
                id={`email-row-${email.id}`}
                data-row-id={email.id}
                tabIndex={0}
                aria-label={ariaLabel}
                aria-current={isOpen ? 'true' : undefined}
                onFocus={(e: FocusEvent) => { if (e.target === e.currentTarget) onFocusRow(email.id); }}
                // En la lista virtualizada las filas viven en posiciones absolutas: `layout` animaria saltos falsos.
                {...(virtual ? {} : { layout: 'position' as const })}
                {...(swipeEnabled && (swipeRight || swipeLeft)
                    ? {
                        // Solo eje X: el eje Y queda para el scroll nativo (touch-action: pan-y). La fila sigue al dedo casi 1:1 hacia los
                        // lados que tienen accion y con mucha resistencia hacia el otro; soltar sin confirmar la devuelve a su sitio.
                        drag: 'x' as const,
                        dragConstraints: { left: 0, right: 0 },
                        dragElastic: { left: swipeLeft ? 0.9 : 0.08, right: swipeRight ? 0.9 : 0.08 },
                        dragMomentum: false,
                        dragSnapToOrigin: true,
                        onPointerDown: (e: ReactPointerEvent) => {
                            gestureCancelled.current = false;
                            stopTracking.current?.();
                            tracker.current.reset(e.clientX, eventTime(e));
                            // El dedo puede salir de la fila mientras arrastra: se siguen sus movimientos en la ventana hasta soltar.
                            const move = (ev: PointerEvent) => tracker.current.push(ev.clientX, eventTime(ev));
                            const end = (ev: PointerEvent) => { tracker.current.push(ev.clientX, eventTime(ev)); stop(); };
                            const stop = () => {
                                window.removeEventListener('pointermove', move);
                                window.removeEventListener('pointerup', end);
                                window.removeEventListener('pointercancel', stop);
                                stopTracking.current = null;
                            };
                            window.addEventListener('pointermove', move, { passive: true });
                            window.addEventListener('pointerup', end);
                            window.addEventListener('pointercancel', stop);
                            stopTracking.current = stop;
                        },
                        onDragStart: () => { justDragged.current = true; },
                        onPointerCancel: () => { gestureCancelled.current = true; },
                        onDrag: (_: unknown, info: { offset: { x: number } }) => setDragX(info.offset.x),
                        onDragEnd: (e: unknown, info: { offset: { x: number; y: number }; velocity: { x: number } }) => { handleDragEnd(e, info); setDragX(0); setTimeout(() => { justDragged.current = false; }, 0); },
                    }
                    : {})}
                initial={virtual ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0, x: 0 }}
                exit={virtual ? { opacity: 0 } : { opacity: 0, height: 0, marginBottom: 0, overflow: 'hidden' }}
                transition={virtual ? { duration: 0.12 } : { duration: 0.18, delay: Math.min(index, 8) * 0.02 }}
                className={cn(
                    'group relative z-10 flex items-start text-left text-sm transition-colors border border-transparent cursor-pointer',
                    dim.gap, dim.row,
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                    isFocused && 'ring-2 ring-ring ring-inset z-20',
                    selectedLook
                        ? 'bg-row-selected text-row-selected-foreground hover:bg-row-selected border-primary/30'
                        : cn('hover:bg-row-hover border-border/60', unread ? 'bg-unread text-unread-foreground' : 'bg-background text-foreground'),
                    unread && !selectedLook && 'border-l-4 border-l-primary',
                )}
                onMouseEnter={() => { hoverTimer.current = setTimeout(() => onPrefetch(email.id), 500); }}
                onMouseLeave={() => { if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; } }}
                onClick={() => { if (justDragged.current) return; onSelect(email.id); }}
            >
                {/* Avatar / casilla: la casilla sustituye al avatar al pasar el raton, con foco o si esta marcada */}
                <div className={cn('relative shrink-0 self-start', 'flex items-center justify-center [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11', compact ? 'h-7 w-7' : dim.avatar.split(' ').filter((c) => c.startsWith('h-') || c.startsWith('w-')).join(' '))}>
                    <Avatar from={avatarSource} className={cn('absolute inset-0 transition-opacity', dim.avatar, isSelected ? 'opacity-0' : 'opacity-100 md:group-hover:opacity-0 md:group-focus-within:opacity-0 [@media(pointer:coarse)]:opacity-100')} />
                    <button
                        type="button"
                        role="checkbox"
                        aria-checked={isSelected}
                        aria-label={isSelected ? t('emailList.row.deselect') : t('emailList.row.select')}
                        className={cn(
                            'absolute inset-0 flex items-center justify-center rounded-full transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            isSelected ? 'opacity-100' : 'opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-0',
                        )}
                        onClick={(e) => onSelectToggle(e, email.id)}
                    >
                        <span className={cn('flex h-5 w-5 items-center justify-center rounded border transition-colors', isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background')}>
                            {isSelected && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />}
                        </span>
                    </button>
                </div>

                <button
                    type="button"
                    aria-pressed={Boolean(email.starred)}
                    aria-label={email.starred ? t('emailList.row.unstar') : t('emailList.row.star')}
                    className={cn(
                        'relative z-20 flex shrink-0 cursor-pointer items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        'h-7 w-7 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11',
                    )}
                    onClick={(e) => { e.stopPropagation(); onAction(email.starred ? 'unstar' : 'star', email.id); }}
                >
                    <Star className={cn('h-[18px] w-[18px] transition-colors', email.starred ? 'fill-warning text-warning' : 'text-muted-foreground hover:text-warning')} aria-hidden="true" />
                </button>

                {compact ? (
                    /* Compacta: una sola linea */
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className={cn('w-28 shrink-0 truncate', unread ? 'font-semibold' : 'font-medium')} title={email.from}>
                            {participantsText}
                            {threadCount > 1 && <ThreadBadge n={threadCount} />}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                            <span className={cn(unread ? 'font-semibold' : 'font-medium')}>{subjectText}</span>
                            {snippetLines > 0 && email.snippet ? <span className="text-muted-foreground"> — {email.snippet}</span> : null}
                        </span>
                        {attachments.count > 0 && <AttachmentChip summary={attachments} label={attachmentLabel} compact />}
                        <span className="relative w-12 shrink-0 text-right text-[11px] text-muted-foreground">
                            <span className="block transition-opacity md:group-hover:opacity-0 md:group-focus-within:opacity-0">{dateText}</span>
                        </span>
                    </div>
                ) : (
                    <div className="min-w-0 flex-1">
                        <div className="flex w-full items-center justify-between gap-2">
                            <div className={cn('min-w-0 truncate', unread ? 'font-semibold' : 'font-medium')} title={email.from}>
                                {participantsText}
                                {threadCount > 1 && <ThreadBadge n={threadCount} />}
                            </div>
                            <div className="relative h-5 w-16 shrink-0 text-right text-[11px] leading-5 text-muted-foreground">
                                <span className="block truncate transition-opacity md:group-hover:opacity-0 md:group-focus-within:opacity-0">{dateText}</span>
                            </div>
                        </div>
                        <div className={cn('mt-0.5 truncate text-[13px]', unread ? 'font-bold' : 'font-medium')}>{subjectText}</div>
                        {snippetLines > 0 && email.snippet ? (
                            <div className={cn('mt-0.5 w-full text-xs text-muted-foreground', snippetLines === 1 ? 'truncate' : 'line-clamp-2')}>{email.snippet}</div>
                        ) : null}
                        {(labels.length > 0 || attachments.count > 0) && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                {attachments.count > 0 && <AttachmentChip summary={attachments} label={attachmentLabel} />}
                                {labels.length > 0 && (
                                    <ul className="flex flex-wrap items-center gap-1.5" aria-label={t('emailList.row.labels')}>
                                        {labels.map((label) => (
                                            <li key={label.id} className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-chip px-1.5 py-0.5 text-[10px] font-medium text-chip-foreground">
                                                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: label.color || undefined }} />
                                                {labelDisplayName(label.name, t)}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Acciones rapidas: superpuestas a la fecha (posicion absoluta = sin saltos de layout) */}
                {hoverActions.length > 0 && (
                    <div
                        role="group"
                        aria-label={t('emailList.row.quickActions')}
                        className={cn(
                            'absolute right-2 z-30 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-0.5 text-popover-foreground shadow-sm',
                            compact ? 'top-1/2 -translate-y-1/2' : 'top-2',
                            'pointer-events-none opacity-0 transition-opacity',
                            'md:group-hover:pointer-events-auto md:group-hover:opacity-100 md:group-focus-within:pointer-events-auto md:group-focus-within:opacity-100',
                            'max-md:hidden [@media(hover:none)]:hidden',
                        )}
                    >
                        {hoverActions.map((action) => {
                            const meta = ACTION_META[action];
                            const Icon = meta.icon;
                            return (
                                <button
                                    key={action}
                                    type="button"
                                    data-row-action={action}
                                    title={t(meta.labelKey)}
                                    aria-label={t(meta.labelKey)}
                                    aria-haspopup={action === 'label' || action === 'snooze' || action === 'reschedule' ? 'menu' : undefined}
                                    onClick={(e) => runHover(action, e)}
                                    className={cn(
                                        'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                        meta.destructive ? 'hover:bg-destructive/10 hover:text-destructive' : 'hover:bg-accent hover:text-accent-foreground',
                                    )}
                                >
                                    <Icon className="h-4 w-4" aria-hidden="true" />
                                </button>
                            );
                        })}
                    </div>
                )}
            </motion.div>
        </div>
    );
}

function ThreadBadge({ n }: { n: number }) {
    return (
        <span
            aria-hidden="true"
            className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full border border-border/50 bg-muted px-1 align-middle text-[10px] font-bold text-muted-foreground"
        >
            {n}
        </span>
    );
}

function AttachmentChip({ summary, label, compact }: { summary: AttachmentSummary; label: string; compact?: boolean }) {
    const first = summary.names.find(Boolean) || '';
    return (
        <span
            title={label}
            className="inline-flex max-w-[11rem] shrink-0 items-center gap-1 rounded-md border border-border/60 bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
        >
            <Paperclip className="h-3 w-3 shrink-0" aria-hidden="true" />
            {compact ? <span>{summary.count}</span> : (
                <>
                    <span className="truncate">{first || summary.count}</span>
                    {summary.count > 1 && <span className="shrink-0">+{summary.count - 1}</span>}
                </>
            )}
        </span>
    );
}

function sameParticipants(a: MailRowProps['participants'], b: MailRowProps['participants']) {
    return a.extra === b.extra && a.names.length === b.names.length && a.names.every((n, i) => n === b.names[i]);
}

export const MailRow = memo(MailRowInner, (prev, next) => {
    const a = prev.email;
    const b = next.email;
    const emailChanged =
        a.id !== b.id || a.read !== b.read || a.starred !== b.starred || a.cleanTo !== b.cleanTo || a.to !== b.to ||
        a.from !== b.from || a.subject !== b.subject || a.snippet !== b.snippet || a.createdAt !== b.createdAt || a.scheduledAt !== b.scheduledAt;
    return !emailChanged
        && prev.labelsKey === next.labelsKey
        && prev.folder === next.folder
        && prev.threadCount === next.threadCount
        && prev.attachments.count === next.attachments.count
        && (prev.attachments.names[0] ?? '') === (next.attachments.names[0] ?? '')
        && sameParticipants(prev.participants, next.participants)
        && prev.isSelected === next.isSelected
        && prev.isFocused === next.isFocused
        && prev.isOpen === next.isOpen
        && prev.density === next.density
        && prev.snippetLines === next.snippetLines
        && prev.swipeRight === next.swipeRight
        && prev.swipeLeft === next.swipeLeft
        && prev.swipeEnabled === next.swipeEnabled
        && prev.draggable === next.draggable
        && prev.virtual === next.virtual
        && prev.ariaPos?.['aria-posinset'] === next.ariaPos?.['aria-posinset']
        && prev.ariaPos?.['aria-setsize'] === next.ariaPos?.['aria-setsize'];
});
