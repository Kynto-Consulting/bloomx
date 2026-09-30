'use client';

/**
 * Overlays del kit: Dialog (modal propio), ModalFrame (marco dentro de un contenedor modal ajeno), DrawerPanel,
 * KitPopover y Tooltip. Superficies con bg-card / bg-popover, fondo bg-overlay, foco visible y teclado WAI-ARIA.
 */
import * as React from 'react';
import { X } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { Modal } from '@/components/ui/Modal';
import { useDialog, getFocusable } from '@/components/ui/useDialog';
import { Button, IconButton, type KitA11y } from './Actions';
import { KitIcon } from './Icon';
import { useKitStrings } from './strings';
import { DRAWER_WIDTH_CLASS, MODAL_WIDTH_CLASS, POPOVER_CLASS, buttonClasses, pick } from './tokens';

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

function Header({ titleId, descriptionId, title, description, icon, onClose, closeLabel }: {
    titleId: string; descriptionId: string; title: string; description: string; icon?: string; onClose?: () => void; closeLabel?: string;
}) {
    if (!title && !description && !icon && !onClose) return null;
    return (
        <div className="flex items-start gap-3 border-b border-border p-4">
            {icon && <span className="mt-0.5 text-primary"><KitIcon name={icon} size="lg" /></span>}
            <div className="min-w-0 flex-1">
                {title && <h2 id={titleId} className="text-base font-semibold text-foreground">{title}</h2>}
                {description && <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">{description}</p>}
            </div>
            {onClose && (
                <button type="button" onClick={onClose} aria-label={closeLabel} title={closeLabel} className={buttonClasses({ variant: 'ghost', size: 'sm', icon: true })}>
                    <X size={16} aria-hidden="true" />
                </button>
            )}
        </div>
    );
}

const Footer = ({ children }: { children?: React.ReactNode }) =>
    children ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border p-4">{children}</div> : null;

// ------------------------------------------------------------------ Dialog
export interface DialogProps {
    open?: boolean;
    onClose?: () => void;
    title?: string;
    description?: string;
    icon?: string;
    width?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
    footer?: React.ReactNode;
    children?: React.ReactNode;
}

export function Dialog({ open, onClose, title, description, icon, width, footer, children }: DialogProps) {
    const t = useKitStrings();
    const en = useI18n().locale === 'en';
    const w = MODAL_WIDTH_CLASS[pick(width, ['sm', 'md', 'lg', 'xl', 'full'] as const, 'md')];
    const ttl = str(title);
    const desc = str(description);
    const close = () => onClose?.();
    return (
        <Modal
            open={open === true}
            onClose={close}
            ariaLabel={ttl ? undefined : (en ? 'Dialog' : 'Dialogo')}
            panelClassName={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-lg border border-border shadow-xl ${w}`}
        >
            {({ titleId, descriptionId }) => (
                <>
                    <Header titleId={titleId} descriptionId={descriptionId} title={ttl} description={desc} icon={typeof icon === 'string' ? icon : undefined} onClose={close} closeLabel={t.close} />
                    <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm text-foreground">{children}</div>
                    <Footer>{footer}</Footer>
                </>
            )}
        </Modal>
    );
}

// ------------------------------------------------------------------ ModalFrame
export interface ModalFrameProps {
    title?: string;
    description?: string;
    icon?: string;
    footer?: React.ReactNode;
    children?: React.ReactNode;
}

/** Marco de un overlay que ya vive dentro de un contenedor modal externo: sin backdrop ni posicion fija. */
export function ModalFrame({ title, description, icon, footer, children }: ModalFrameProps) {
    const uid = React.useId();
    const ttl = str(title);
    const desc = str(description);
    return (
        <section aria-labelledby={ttl ? `${uid}-t` : undefined} aria-describedby={desc ? `${uid}-d` : undefined} className="flex w-full flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground">
            <Header titleId={`${uid}-t`} descriptionId={`${uid}-d`} title={ttl} description={desc} icon={typeof icon === 'string' ? icon : undefined} />
            <div className="p-4 text-sm text-foreground">{children}</div>
            <Footer>{footer}</Footer>
        </section>
    );
}

// ------------------------------------------------------------------ DrawerPanel
export interface DrawerPanelProps {
    open?: boolean;
    onClose?: () => void;
    title?: string;
    side?: 'left' | 'right';
    width?: 'sm' | 'md' | 'lg';
    footer?: React.ReactNode;
    children?: React.ReactNode;
}

function DrawerBody({ onClose, title, side, width, footer, children }: Omit<DrawerPanelProps, 'open'>) {
    const t = useKitStrings();
    const en = useI18n().locale === 'en';
    const { ref, titleId, descriptionId } = useDialog<HTMLDivElement>(true, () => onClose?.());
    const ttl = str(title);
    return (
        <div className="fixed inset-0 z-[100]">
            <div aria-hidden="true" className="absolute inset-0 bg-overlay" onMouseDown={() => onClose?.()} />
            <div
                ref={ref}
                role="dialog"
                aria-modal="true"
                aria-label={ttl ? undefined : (en ? 'Panel' : 'Panel')}
                aria-labelledby={ttl ? titleId : undefined}
                tabIndex={-1}
                className={`absolute inset-y-0 flex max-w-full flex-col bg-card text-card-foreground shadow-xl outline-none ${side === 'left' ? 'start-0 border-e' : 'end-0 border-s'} border-border ${DRAWER_WIDTH_CLASS[pick(width, ['sm', 'md', 'lg'] as const, 'md')]}`}
            >
                <Header titleId={titleId} descriptionId={descriptionId} title={ttl} description="" onClose={() => onClose?.()} closeLabel={t.close} />
                <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm text-foreground">{children}</div>
                <Footer>{footer}</Footer>
            </div>
        </div>
    );
}

export function DrawerPanel(props: DrawerPanelProps) {
    if (props.open !== true) return null;
    return <DrawerBody {...props} side={pick(props.side, ['left', 'right'] as const, 'right')} />;
}

// ------------------------------------------------------------------ util: disparadores
/** Clona un disparador inyectando ARIA y accion. Para elementos DOM usa onClick/aria-*; para componentes del kit onPress/a11y. */
function enhanceTrigger(el: React.ReactElement<Record<string, unknown>>, a11y: KitA11y, onPress: () => void, ref?: React.Ref<unknown>) {
    const isDom = typeof el.type === 'string';
    const prevClick = el.props.onClick as ((e: unknown) => void) | undefined;
    const extra: Record<string, unknown> = isDom
        ? {
            onClick: (e: unknown) => { prevClick?.(e); onPress(); },
            'aria-expanded': a11y.expanded, 'aria-controls': a11y.controls, 'aria-haspopup': a11y.haspopup, 'aria-describedby': a11y.describedby,
        }
        : { onPress: () => { (el.props.onPress as (() => void) | undefined)?.(); onPress(); }, a11y };
    if (ref) extra.ref = ref;
    return React.cloneElement(el, extra);
}

// ------------------------------------------------------------------ KitPopover
export interface KitPopoverProps {
    trigger?: React.ReactNode;
    triggerLabel?: string;
    title?: string;
    align?: 'start' | 'end';
    children?: React.ReactNode;
}

export function KitPopover({ trigger, triggerLabel, title, align, children }: KitPopoverProps) {
    const t = useKitStrings();
    const uid = React.useId();
    const panelId = `${uid}-panel`;
    const [open, setOpen] = React.useState(false);
    const rootRef = React.useRef<HTMLDivElement>(null);
    const triggerBox = React.useRef<HTMLSpanElement>(null);
    const panelRef = React.useRef<HTMLDivElement>(null);

    const focusTrigger = () => {
        const box = triggerBox.current;
        if (box) (getFocusable(box)[0] ?? box.querySelector<HTMLElement>('button, [tabindex]'))?.focus();
    };

    React.useEffect(() => {
        if (!open) return;
        const panel = panelRef.current;
        if (panel) (getFocusable(panel)[0] ?? panel).focus({ preventScroll: true });
        const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            setOpen(false);
            focusTrigger();
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
    }, [open]);

    const toggle = () => setOpen((o) => !o);
    const a11y: KitA11y = { expanded: open, controls: open ? panelId : undefined, haspopup: 'dialog' };
    let triggerEl: React.ReactNode;
    if (React.isValidElement(trigger)) triggerEl = enhanceTrigger(trigger as React.ReactElement<Record<string, unknown>>, a11y, toggle);
    else {
        const text = str(trigger) || str(triggerLabel);
        triggerEl = text
            ? <Button label={text} variant="outline" a11y={a11y} onPress={toggle} />
            : <IconButton icon="MoreHorizontal" label={str(title) || t.moreActions} a11y={a11y} onPress={toggle} />;
    }
    return (
        <div ref={rootRef} className="relative inline-block">
            <span ref={triggerBox} className="inline-flex">{triggerEl}</span>
            {open && (
                <div
                    ref={panelRef}
                    id={panelId}
                    role="dialog"
                    aria-label={str(title) || undefined}
                    tabIndex={-1}
                    className={`absolute top-full z-50 mt-2 min-w-[12rem] max-w-[90vw] p-3 text-sm outline-none ${POPOVER_CLASS} ${align === 'end' ? 'end-0' : 'start-0'}`}
                >
                    {children}
                </div>
            )}
        </div>
    );
}

// ------------------------------------------------------------------ Tooltip
export interface TooltipProps {
    text?: string;
    children?: React.ReactNode;
}

const HOVER_DELAY_MS = 150;

export function Tooltip({ text, children }: TooltipProps) {
    const id = React.useId();
    const msg = str(text);
    const [visible, setVisible] = React.useState(false);
    const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
    React.useEffect(() => clear, []);

    React.useEffect(() => {
        if (!visible) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setVisible(false); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [visible]);

    if (!msg) return <>{children}</>;
    const show = (delay: number) => { clear(); if (delay <= 0) setVisible(true); else timer.current = setTimeout(() => setVisible(true), delay); };
    const hide = () => { clear(); setVisible(false); };

    const only = React.isValidElement(children) ? (children as React.ReactElement<Record<string, unknown>>) : null;
    const describedby = msg ? id : undefined;
    const content = only
        ? (typeof only.type === 'string'
            ? React.cloneElement(only, { 'aria-describedby': describedby })
            : React.cloneElement(only, { a11y: { describedby } }))
        : children;
    const wrapperProps = only ? {} : { tabIndex: 0, 'aria-describedby': describedby };
    return (
        <span
            className="relative inline-flex"
            onMouseEnter={() => show(HOVER_DELAY_MS)}
            onMouseLeave={hide}
            onFocus={() => show(0)}
            onBlur={hide}
            {...wrapperProps}
        >
            {content}
            {visible && (
                <span
                    id={id}
                    role="tooltip"
                    className={`pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 w-max max-w-[16rem] -translate-x-1/2 px-2 py-1 text-xs ${POPOVER_CLASS}`}
                >
                    {msg}
                </span>
            )}
        </span>
    );
}
