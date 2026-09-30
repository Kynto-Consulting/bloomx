'use client';

/**
 * Acciones del kit: Button, IconButton, ButtonGroup y Menu. Solo props semanticas (tone/variant/size...):
 * el color sale de los mapas de tokens.ts. No aceptan className/style ni props DOM arbitrarias.
 */
import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { BUTTON_VARIANTS, GAPS, JUSTIFIES, SIZES } from '@/lib/expansions/ui-schema';
import { KitIcon } from './Icon';
import { useKitStrings } from './strings';
import {
    GAP_CLASS, JUSTIFY_CLASS, MENU_ITEM_CLASS, MENU_ITEM_TONE_CLASS, POPOVER_CLASS,
    buttonClasses, defaultButtonTone, pick, toTone,
    type ButtonVariant, type Size, type Tone,
} from './tokens';

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const bool = (v: unknown): boolean => v === true;
const ICON_SIZE_FOR: Record<Size, 'xs' | 'sm' | 'md' | 'lg'> = { xs: 'xs', sm: 'sm', md: 'sm', lg: 'md' };

/** Atributos ARIA internos que un contenedor (Popover, Tooltip) inyecta en su disparador. No vienen del JSON. */
export interface KitA11y {
    expanded?: boolean;
    controls?: string;
    haspopup?: 'menu' | 'dialog' | 'true';
    describedby?: string;
}
const a11yAttrs = (a?: KitA11y) => (a && typeof a === 'object'
    ? { 'aria-expanded': typeof a.expanded === 'boolean' ? a.expanded : undefined, 'aria-controls': typeof a.controls === 'string' ? a.controls : undefined, 'aria-haspopup': a.haspopup, 'aria-describedby': typeof a.describedby === 'string' ? a.describedby : undefined }
    : {});

function Spinner({ size }: { size: Size }) {
    const px = { xs: 12, sm: 14, md: 16, lg: 20 }[size];
    return <Loader2 size={px} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />;
}

// ------------------------------------------------------------------ Button
export interface ButtonProps {
    label?: string;
    icon?: string;
    iconPosition?: 'start' | 'end';
    tone?: Tone;
    variant?: ButtonVariant;
    size?: Size;
    fullWidth?: boolean;
    align?: 'start' | 'center';
    loading?: boolean;
    disabled?: boolean;
    submit?: boolean;
    showLabel?: boolean;
    onPress?: () => void;
    /** Interno: ARIA inyectado por un contenedor (no lo fija el JSON). */
    a11y?: KitA11y;
    children?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
    const variant = pick<ButtonVariant>(props.variant, BUTTON_VARIANTS, 'solid');
    const tone = props.tone === undefined ? defaultButtonTone(variant) : toTone(props.tone, defaultButtonTone(variant));
    const size = pick<Size>(props.size, SIZES, 'md');
    const label = str(props.label);
    const loading = bool(props.loading);
    const iconOnly = props.showLabel === false;
    const end = props.iconPosition === 'end';
    const icon = typeof props.icon === 'string' ? props.icon : undefined;
    const iconEl = loading ? <Spinner size={size} /> : icon ? <KitIcon name={icon} size={ICON_SIZE_FOR[size]} /> : null;
    const cls = buttonClasses({ tone, variant, size, icon: iconOnly, fullWidth: bool(props.fullWidth), alignStart: props.align === 'start' });
    return (
        <button
            ref={ref}
            type={bool(props.submit) ? 'submit' : 'button'}
            className={cls}
            disabled={bool(props.disabled) || loading}
            aria-busy={loading || undefined}
            aria-label={iconOnly && label ? label : undefined}
            title={iconOnly && label ? label : undefined}
            onClick={() => { if (!loading && !props.disabled) props.onPress?.(); }}
            {...a11yAttrs(props.a11y)}
        >
            {!end && iconEl}
            {!iconOnly && label}
            {!iconOnly && props.children}
            {end && iconEl}
        </button>
    );
});

// ------------------------------------------------------------------ IconButton
export interface IconButtonProps {
    icon?: string;
    label: string;
    tone?: Tone;
    variant?: ButtonVariant;
    size?: Size;
    loading?: boolean;
    disabled?: boolean;
    onPress?: () => void;
    a11y?: KitA11y;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(props, ref) {
    const variant = pick<ButtonVariant>(props.variant, BUTTON_VARIANTS, 'ghost');
    const tone = props.tone === undefined ? defaultButtonTone(variant) : toTone(props.tone, defaultButtonTone(variant));
    const size = pick<Size>(props.size, SIZES, 'md');
    const loading = bool(props.loading);
    const label = str(props.label) || str(props.icon);
    const icon = typeof props.icon === 'string' ? props.icon : undefined;
    return (
        <button
            ref={ref}
            type="button"
            className={buttonClasses({ tone, variant, size, icon: true })}
            aria-label={label || undefined}
            title={label || undefined}
            disabled={bool(props.disabled) || loading}
            aria-busy={loading || undefined}
            onClick={() => { if (!loading && !props.disabled) props.onPress?.(); }}
            {...a11yAttrs(props.a11y)}
        >
            {loading ? <Spinner size={size} /> : <KitIcon name={icon ?? 'Circle'} size={ICON_SIZE_FOR[size]} />}
        </button>
    );
});

// ------------------------------------------------------------------ ButtonGroup
export interface ButtonGroupProps {
    attached?: boolean;
    gap?: number;
    wrap?: boolean;
    align?: 'start' | 'center' | 'end' | 'between' | 'around';
    children?: React.ReactNode;
}

const ATTACHED_CLASS = 'gap-0 [&>*:not(:first-child)]:-ms-px [&>*:not(:first-child)]:rounded-s-none [&>*:not(:last-child)]:rounded-e-none';

export function ButtonGroup({ attached, gap, wrap, align, children }: ButtonGroupProps) {
    const isAttached = attached === true;
    const gapCls = GAP_CLASS[pick<number>(gap, GAPS, 2)];
    const justify = JUSTIFY_CLASS[pick(align, JUSTIFIES, 'start')];
    return (
        <div role="group" className={['inline-flex max-w-full items-center', justify, isAttached ? ATTACHED_CLASS : gapCls, wrap !== false && !isAttached ? 'flex-wrap' : ''].filter(Boolean).join(' ')}>
            {children}
        </div>
    );
}

// ------------------------------------------------------------------ Menu
export interface MenuItemInput {
    label?: string;
    icon?: string;
    tone?: Tone;
    disabled?: boolean;
    separator?: boolean;
    onPress?: () => void;
}
export interface MenuProps {
    label?: string;
    icon?: string;
    tone?: Tone;
    variant?: ButtonVariant;
    size?: Size;
    showLabel?: boolean;
    items?: MenuItemInput[];
    align?: 'start' | 'end';
    /** Se llama con el indice del elemento (en `items`) elegido. */
    onSelect?: (index: number) => void;
}

interface CleanItem { index: number; separator: boolean; label: string; icon?: string; tone: Tone; disabled: boolean; onPress?: () => void }

export function Menu(props: MenuProps) {
    const t = useKitStrings();
    const uid = React.useId();
    const menuId = `${uid}-menu`;
    const triggerId = `${uid}-trigger`;
    const variant = pick<ButtonVariant>(props.variant, BUTTON_VARIANTS, 'outline');
    const tone = props.tone === undefined ? defaultButtonTone(variant) : toTone(props.tone, defaultButtonTone(variant));
    const size = pick<Size>(props.size, SIZES, 'md');
    const label = str(props.label);
    const iconOnly = props.showLabel === false;
    const items: CleanItem[] = (Array.isArray(props.items) ? props.items.slice(0, 200) : []).map((raw, index) => {
        const it = (raw && typeof raw === 'object' ? raw : {}) as MenuItemInput;
        return {
            index, separator: it.separator === true, label: str(it.label), icon: typeof it.icon === 'string' ? it.icon : undefined,
            tone: toTone(it.tone), disabled: it.disabled === true, onPress: typeof it.onPress === 'function' ? it.onPress : undefined,
        };
    });
    const enabled = items.filter((i) => !i.separator && !i.disabled).map((i) => i.index);

    const [open, setOpen] = React.useState(false);
    const [active, setActive] = React.useState<number>(-1);
    const rootRef = React.useRef<HTMLDivElement>(null);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const itemRefs = React.useRef<Record<number, HTMLButtonElement | null>>({});

    const openMenu = (focus: 'first' | 'last') => {
        setActive(focus === 'first' ? (enabled[0] ?? -1) : (enabled[enabled.length - 1] ?? -1));
        setOpen(true);
    };
    const closeMenu = (returnFocus: boolean) => {
        setOpen(false);
        setActive(-1);
        if (returnFocus) triggerRef.current?.focus();
    };

    React.useEffect(() => {
        if (open && active >= 0) itemRefs.current[active]?.focus();
    }, [open, active]);

    React.useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) closeMenu(false); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    const choose = (item: CleanItem) => {
        if (item.disabled || item.separator) return;
        closeMenu(true);
        item.onPress?.();
        props.onSelect?.(item.index);
    };

    const move = (delta: number) => {
        if (enabled.length === 0) return;
        const pos = enabled.indexOf(active);
        const next = pos < 0 ? (delta > 0 ? 0 : enabled.length - 1) : (pos + delta + enabled.length) % enabled.length;
        setActive(enabled[next]);
    };

    const onTriggerKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); openMenu('first'); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); openMenu('last'); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (open) closeMenu(false); else openMenu('first'); }
        else if (e.key === 'Escape' && open) { e.preventDefault(); closeMenu(true); }
    };

    const onMenuKeyDown = (e: React.KeyboardEvent) => {
        switch (e.key) {
            case 'ArrowDown': e.preventDefault(); move(1); break;
            case 'ArrowUp': e.preventDefault(); move(-1); break;
            case 'Home': e.preventDefault(); setActive(enabled[0] ?? -1); break;
            case 'End': e.preventDefault(); setActive(enabled[enabled.length - 1] ?? -1); break;
            case 'Escape': e.preventDefault(); e.stopPropagation(); closeMenu(true); break;
            case 'Tab': closeMenu(false); break;
            case 'Enter': case ' ': {
                e.preventDefault();
                const item = items.find((i) => i.index === active);
                if (item) choose(item);
                break;
            }
            default: break;
        }
    };

    const triggerLabel = label || t.moreActions;
    const iconName = typeof props.icon === 'string' ? props.icon : iconOnly || !label ? 'MoreHorizontal' : undefined;
    return (
        <div ref={rootRef} className="relative inline-block">
            <button
                ref={triggerRef}
                id={triggerId}
                type="button"
                className={buttonClasses({ tone, variant, size, icon: iconOnly })}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                aria-label={iconOnly ? triggerLabel : undefined}
                title={iconOnly ? triggerLabel : undefined}
                onClick={() => { if (open) closeMenu(false); else openMenu('first'); }}
                onKeyDown={onTriggerKeyDown}
                onKeyUp={(e) => { if (e.key === ' ') e.preventDefault(); }}
            >
                {iconName && <KitIcon name={iconName} size={ICON_SIZE_FOR[size]} />}
                {!iconOnly && label}
            </button>
            {open && (
                <div
                    id={menuId}
                    role="menu"
                    aria-labelledby={triggerId}
                    onKeyDown={onMenuKeyDown}
                    className={`absolute top-full z-50 mt-1 min-w-[10rem] p-1 ${POPOVER_CLASS} ${props.align === 'end' ? 'end-0' : 'start-0'}`}
                >
                    {items.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">{t.empty}</div>}
                    {items.map((item) => item.separator
                        ? <div key={item.index} role="separator" className="my-1 h-px bg-border" />
                        : (
                            <button
                                key={item.index}
                                ref={(el) => { itemRefs.current[item.index] = el; }}
                                type="button"
                                role="menuitem"
                                tabIndex={-1}
                                disabled={item.disabled}
                                aria-disabled={item.disabled || undefined}
                                className={`${MENU_ITEM_CLASS} ${MENU_ITEM_TONE_CLASS[item.tone]}`}
                                onClick={() => choose(item)}
                                onMouseEnter={() => { if (!item.disabled) setActive(item.index); }}
                            >
                                {item.icon && <KitIcon name={item.icon} size="sm" />}
                                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            </button>
                        ))}
                </div>
            )}
        </div>
    );
}
