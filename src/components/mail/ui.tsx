'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { avatarTone, senderInitials } from '@/lib/mail-list-view';

/**
 * Pares fondo/texto de los TOKENS de tema. Cada par cumple el contraste AA en cualquier paleta de empresa
 * (lo exige CONTRAST_REQUIREMENTS), asi que las iniciales siempre se leen y no hay colores fijos.
 */
export const AVATAR_TONE_CLASSES = [
    'bg-primary text-primary-foreground',
    'bg-brand-accent text-brand-accent-foreground',
    'bg-success text-success-foreground',
    'bg-info text-info-foreground',
    'bg-warning text-warning-foreground',
    'bg-secondary text-secondary-foreground border border-border',
] as const;

export function Avatar({ from, className, title }: { from: string | null | undefined; className?: string; title?: string }) {
    const tone = AVATAR_TONE_CLASSES[avatarTone(from) % AVATAR_TONE_CLASSES.length];
    return (
        <span
            aria-hidden="true"
            title={title}
            data-avatar-tone={avatarTone(from)}
            className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold', tone, className)}
        >
            {senderInitials(from)}
        </span>
    );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
    label: string;
    children: ReactNode;
    pressed?: boolean;
    /** Tinte destructivo al pasar el raton/foco. */
    destructive?: boolean;
    /** Sin objetivo tactil ampliado (botones dentro de filas que ya ocupan toda la fila). */
    dense?: boolean;
}

/** Boton de icono accesible: nombre (aria-label + title), foco visible y objetivo tactil >= 44px en pantallas tactiles. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
    { label, children, pressed, destructive, dense, className, type = 'button', ...rest }, ref,
) {
    return (
        <button
            ref={ref}
            type={type}
            title={label}
            aria-label={label}
            aria-pressed={pressed}
            className={cn(
                'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40',
                destructive ? 'hover:bg-destructive/10 hover:text-destructive' : 'hover:bg-accent hover:text-accent-foreground',
                !dense && '[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11',
                className,
            )}
            {...rest}
        >
            {children}
        </button>
    );
});
