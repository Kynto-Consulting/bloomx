'use client';

import { useEffect, useState } from 'react';
import { useTheme } from '@/components/ThemeProvider';
import { normalizeHex } from '@/lib/color';
import { getTheme } from '@/lib/themes';

export interface SurfaceColors {
    background: string;
    card: string;
    foreground: string;
}

/**
 * Colores de superficie REALES del tema activo (incluida la marca del dominio), leidos
 * de las variables CSS. Sirven para calcular contraste de colores de usuario (agenda,
 * citas) sobre el fondo en el que se van a pintar. Antes del montaje usa los valores
 * del registro de temas, asi que el primer render es determinista (sin desajuste de hidratacion).
 */
export function useSurfaceColors(): SurfaceColors {
    const { resolvedTheme } = useTheme();
    const [colors, setColors] = useState<SurfaceColors>(() => {
        const t = getTheme(resolvedTheme.id) ?? resolvedTheme;
        return { background: t.tokens.background, card: t.tokens.card, foreground: t.tokens.foreground };
    });

    useEffect(() => {
        const read = () => {
            const cs = getComputedStyle(document.documentElement);
            const pick = (name: string, fallback: string) => normalizeHex(cs.getPropertyValue(name).trim()) ?? fallback;
            const t = getTheme(resolvedTheme.id) ?? resolvedTheme;
            const next: SurfaceColors = {
                background: pick('--color-background', t.tokens.background),
                card: pick('--color-card', t.tokens.card),
                foreground: pick('--color-foreground', t.tokens.foreground),
            };
            setColors((prev) =>
                prev.background === next.background && prev.card === next.card && prev.foreground === next.foreground ? prev : next,
            );
        };
        read();
        // La marca del dominio puede inyectarse despues (bx-brand-live): reintenta tras el siguiente frame.
        const raf = window.requestAnimationFrame(read);
        const mo = new MutationObserver(read);
        mo.observe(document.head, { childList: true, subtree: true, characterData: true });
        return () => { window.cancelAnimationFrame(raf); mo.disconnect(); };
    }, [resolvedTheme]);

    return colors;
}
