'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Minimize2, Maximize2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FloatingWindowProps {
    id: string;
    title: string;
    minimized: boolean;
    onToggleMinimize: () => void;
    onClose: () => void;
    index: number;
    children: React.ReactNode;
    headerIcon?: React.ReactNode;
    headerTools?: React.ReactNode;
}

export function FloatingWindow({
    id,
    title,
    minimized,
    onToggleMinimize,
    onClose,
    index,
    children,
    headerIcon,
    headerTools,
}: FloatingWindowProps) {
    const [maximized, setMaximized] = useState(false);
    const [dimensions, setDimensions] = useState({ width: 500, height: 550 });
    const [isResizing, setIsResizing] = useState(false);
    
    // Fallback for missing icon
    const Icon = headerIcon;

    const resizeRef = useRef<{ startX: number, startY: number, startWidth: number, startHeight: number } | null>(null);

    const handleResizeStart = (e: React.MouseEvent) => {
        if (maximized) return;
        setIsResizing(true);
        resizeRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            startWidth: dimensions.width,
            startHeight: dimensions.height
        };
        e.preventDefault();
    };

    useEffect(() => {
        if (!isResizing) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (!resizeRef.current) return;
            const deltaX = resizeRef.current.startX - e.clientX;
            const deltaY = resizeRef.current.startY - e.clientY;

            setDimensions({
                width: Math.max(400, Math.min(typeof window !== 'undefined' ? window.innerWidth - 40 : 1000, resizeRef.current.startWidth + deltaX)),
                height: Math.max(400, Math.min(typeof window !== 'undefined' ? window.innerHeight - 40 : 1000, resizeRef.current.startHeight + deltaY))
            });
        };

        const handleMouseUp = () => setIsResizing(false);

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing, maximized]);

    const rightOffset = 24 + index * 40;

    if (minimized) {
        return (
            <motion.div
                initial={{ opacity: 0, y: 100, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 100, scale: 0.9 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="fixed bottom-0 z-50 w-64 rounded-t-lg bg-background shadow-lg"
                style={{ right: `${rightOffset}px` }}
            >
                <div
                    className="flex items-center justify-between px-4 py-2 cursor-pointer bg-muted/50 rounded-t-lg hover:bg-muted"
                    onClick={onToggleMinimize}
                >
                    <span className="text-sm font-semibold truncate flex items-center gap-2">
                        {headerIcon && <span className="w-4 h-4">{headerIcon}</span>}
                        {title}
                    </span>
                    <div className="flex items-center">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onClose();
                            }}
                            className="p-1 hover:bg-accent hover:text-accent-foreground rounded-sm transition-colors"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            </motion.div>
        );
    }

    const modalClass = maximized
        ? "fixed inset-0 md:inset-4 z-50 flex flex-col bg-white rounded-none md:rounded-lg shadow-2xl overflow-hidden shadow-md"
        : cn(
            "fixed bottom-0 right-0 md:right-[var(--right-offset)] z-50 flex flex-col bg-white rounded-t-xl shadow-2xl overflow-hidden ring-1 ring-border/10 shadow-md",
            isResizing ? "transition-none select-none" : ""
        );

    const modalStyle = maximized
        ? {}
        : {
            '--right-offset': `${rightOffset}px`,
            width: typeof window !== 'undefined' && window.innerWidth < 768 ? '100%' : `${dimensions.width}px`,
            height: typeof window !== 'undefined' && window.innerWidth < 768 ? '100%' : `${dimensions.height}px`,
        } as React.CSSProperties;

    return (
        <motion.div
            className={modalClass}
            style={modalStyle}
            initial={maximized ? { opacity: 0, scale: 0.98 } : { opacity: 0, y: 50, scale: 0.95 }}
            animate={maximized ? { opacity: 1, scale: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={maximized ? { opacity: 0, scale: 0.95 } : { opacity: 0, y: 50, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
        >
            {!maximized && (
                <div
                    className="absolute -top-1 -left-1 w-4 h-4 cursor-nwse-resize z-50 hidden md:block"
                    onMouseDown={handleResizeStart}
                />
            )}

            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b relative">
                <div className="flex items-center gap-2">
                    {headerIcon && <div className="text-muted-foreground">{headerIcon}</div>}
                    <h3 className="text-sm font-semibold truncate max-w-[200px]">{title}</h3>
                </div>
                <div className="flex items-center gap-1">
                    {headerTools}
                    <button
                        onClick={onToggleMinimize}
                        className="p-1.5 hover:bg-muted rounded-md transition-colors text-muted-foreground hover:text-foreground"
                    >
                        <Minimize2 className="h-4 w-4" />
                    </button>
                    <button
                        onClick={() => setMaximized(!maximized)}
                        className="p-1.5 hover:bg-muted rounded-md transition-colors text-muted-foreground hover:text-foreground hidden md:block"
                    >
                        <Maximize2 className="h-4 w-4" />
                    </button>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-destructive/10 hover:text-destructive rounded-md transition-colors text-muted-foreground ml-1"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 flex flex-col overflow-hidden relative">
                {children}
            </div>
        </motion.div>
    );
}
