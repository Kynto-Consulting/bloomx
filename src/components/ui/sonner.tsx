'use client';

import { Toaster as Sonner } from 'sonner';
import { useTheme } from '@/components/ThemeProvider';

export function Toaster() {
    const { scheme } = useTheme();
    return (
        <Sonner
            theme={scheme}
            className="toaster group"
            toastOptions={{
                classNames: {
                    toast:
                        "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
                    description: "group-[.toast]:text-muted-foreground",
                    actionButton:
                        "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
                    cancelButton:
                        "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
                },
            }}
        />
    );
}
