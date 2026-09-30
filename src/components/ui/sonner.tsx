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
                // Estilos en linea con TOKENS de tema: el CSS propio de sonner se inyecta despues y pisaba las clases
                // (avisos blancos sobre un tema oscuro, boton "Deshacer" sin el color de la empresa).
                style: { background: 'var(--color-popover)', color: 'var(--color-popover-foreground)', borderColor: 'var(--color-border)' },
                actionButtonStyle: { background: 'var(--color-primary)', color: 'var(--color-primary-foreground)' },
                cancelButtonStyle: { background: 'var(--color-muted)', color: 'var(--color-muted-foreground)' },
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
