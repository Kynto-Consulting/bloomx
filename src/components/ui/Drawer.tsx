'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useDialog } from './useDialog';

export interface DrawerProps {
    open: boolean;
    onClose: () => void;
    /** Nombre accesible del panel (obligatorio: no hay titulo visible). */
    label: string;
    side?: 'left' | 'right';
    /** Clases del panel (ancho, fondo, z-index...). */
    className?: string;
    children: React.ReactNode;
}

function DrawerPanel({ onClose, label, side = 'left', className, children }: Omit<DrawerProps, 'open'>) {
    const { ref } = useDialog<HTMLDivElement>(true, onClose);
    const offscreen = side === 'left' ? '-100%' : '100%';
    return (
        <>
            <motion.div
                aria-hidden="true"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onMouseDown={onClose}
                className="fixed inset-0 z-[60] bg-overlay backdrop-blur-sm"
            />
            <motion.div
                ref={ref}
                role="dialog"
                aria-modal="true"
                aria-label={label}
                tabIndex={-1}
                initial={{ x: offscreen }}
                animate={{ x: 0 }}
                exit={{ x: offscreen }}
                className={cn('fixed inset-y-0 z-[70] bg-card text-card-foreground shadow-2xl outline-none', side === 'left' ? 'left-0' : 'right-0', className)}
            >
                {children}
            </motion.div>
        </>
    );
}

/**
 * Cajon lateral accesible (menu movil): role="dialog", aria-modal, foco atrapado, Escape y
 * restauracion de foco. El fondo no es un boton enfocable.
 */
export function Drawer({ open, ...rest }: DrawerProps) {
    return <AnimatePresence>{open && <DrawerPanel {...rest} />}</AnimatePresence>;
}
