'use client';

import React, { useState, useEffect, useRef, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

interface PopoverProps {
    trigger: React.RefObject<HTMLElement | null> | HTMLElement | DOMRect;
    children: ReactNode;
    isOpen: boolean;
    onClose: () => void;
    className?: string;
    width?: number | string;
    header?: boolean; // 👈 nuevo
}

export function Popover({
    trigger,
    children,
    isOpen,
    onClose,
    className,
    width = 320,
    header = true, // 👈 default
}: PopoverProps) {
    const [mounted, setMounted] = useState(false);
    const [coords, setCoords] = useState<{ top?: number, bottom?: number, left: number, placement: 'top' | 'bottom' }>({ left: 0, placement: 'top' });
    const popoverRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (!isOpen || !trigger) return;

        const updatePosition = () => {
            let rect: DOMRect | undefined;

            if ('current' in trigger) {
                rect = trigger.current?.getBoundingClientRect();
            } else if (trigger instanceof HTMLElement) {
                rect = trigger.getBoundingClientRect();
            } else {
                rect = trigger as DOMRect;
            }

            if (!rect) return;

            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const isMobile = viewportWidth < 640;

            const popoverHeight = popoverRef.current?.offsetHeight || 40;
            const popoverWidth = isMobile
                ? Math.min(viewportWidth - 20, typeof width === 'number' ? width : 320)
                : (typeof width === 'number' ? width : 320);

            // Determine placement
            let placement: 'top' | 'bottom' = 'top';
            if (rect.top < popoverHeight + 40) {
                placement = 'bottom';
            }

            // Horizontal placement (relative to viewport)
            let left = rect.left;

            // If opening to the right overflows, try opening to the left (anchor to right edge)
            if (left + popoverWidth > viewportWidth - 10) {
                left = rect.right - popoverWidth;
            }

            // Safety check: stay within viewport
            if (left + popoverWidth > viewportWidth - 10) {
                left = viewportWidth - popoverWidth - 10;
            }
            if (left < 10) {
                left = 10;
            }

            // Mobile centering if narrow screen
            if (isMobile && popoverWidth > viewportWidth - 40) {
                left = (viewportWidth - popoverWidth) / 2;
            }

            if (placement === 'top') {
                setCoords({ bottom: viewportHeight - rect.top + 8, left, placement });
            } else {
                setCoords({ top: rect.bottom + 8, left, placement });
            }
        };

        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);

        // Also track size of the popover itself (in case it changes after mount)
        const resizeObserver = new ResizeObserver(() => {
            updatePosition();
        });
        if (popoverRef.current) {
            resizeObserver.observe(popoverRef.current);
        }

        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
            resizeObserver.disconnect();
        };
    }, [isOpen, trigger, width]);

    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (!popoverRef.current?.contains(e.target as Node)) {
                let triggerEl: HTMLElement | null = null;

                if (trigger && 'current' in trigger) {
                    triggerEl = trigger.current;
                } else if (trigger instanceof HTMLElement) {
                    triggerEl = trigger;
                }

                if (triggerEl?.contains(e.target as Node)) return;
                onClose();
            }
        };

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [isOpen, onClose, trigger]);

    if (!isOpen || !mounted) return null;

    return createPortal(
        <div
            ref={popoverRef}
            className={cn(
                'fixed z-[150] bg-popover text-popover-foreground border border-border rounded-lg shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200',
                coords.placement === 'top' ? 'origin-bottom' : 'origin-top',
                className
            )}
            style={{
                top: coords.top,
                bottom: coords.bottom,
                left: coords.left,
                width,
            }}
        >
            {children}
        </div>,
        document.body
    );
}
