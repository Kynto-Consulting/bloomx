'use client';

/**
 * Botones de las barras de acciones de extensiones. UN criterio visual: iconos de 32 px (36 en tactil), variante "ghost" neutra,
 * sin relleno y NUNCA con el color primario (el primario se reserva para la accion principal de la pantalla). Todo el color sale
 * de tokens.
 */
import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { resolveIcon } from '../kit/Icon';
import { toolbarGlyph, type ToolbarGlyph } from '@/lib/expansions/client/toolbar';
import { ExtensionIcon } from '../ExtensionIcon';
import { ToolbarTooltip } from './ToolbarTooltip';

export const TOOLBAR_FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Icono Lucide o insignia de texto contenida (iniciales) segun lo que el manifest declare. */
export function GlyphView({ glyph, size = 16, loading, disabled, mode = 'brand' }: { glyph: ToolbarGlyph; size?: number; loading?: boolean; disabled?: boolean; mode?: 'brand' | 'mono' }) {
    // Logotipo de marca / ficha de iniciales: ficha de 24 px con el color oficial (o monocromo en un boton deshabilitado).
    if (glyph.kind === 'ref') return <ExtensionIcon icon={glyph.icon} size={24} mode={disabled ? 'mono' : mode} loading={loading} disabled={disabled} />;
    if (glyph.kind === 'icon') {
        const Icon = resolveIcon(glyph.name);
        return Icon ? <Icon size={size} aria-hidden={true} /> : null;
    }
    return (
        <span aria-hidden="true" data-toolbar-badge="" className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-current/30 px-0.5 text-[10px] font-semibold leading-none tracking-tight">
            {glyph.text}
        </span>
    );
}

/** Glifo de una accion a partir del icono del manifest (puede no existir) y su nombre. */
export function glyphFor(icon: string | undefined, label: string): ToolbarGlyph {
    return toolbarGlyph(icon, label, (name) => resolveIcon(name) !== null);
}

export interface ToolbarIconButtonProps {
    label: string;
    glyph: ToolbarGlyph;
    /** Linea secundaria del tooltip (atajo o descripcion). */
    hint?: string;
    /** Atajo de teclado de la accion, si lo tiene (se muestra en el tooltip y se anuncia con aria-keyshortcuts). */
    shortcut?: string;
    loading?: boolean;
    disabled?: boolean;
    /** Indicador discreto de "ultima usada". */
    dot?: boolean;
    onPress?: () => void;
    a11y?: { expanded?: boolean; controls?: string; haspopup?: 'menu' | 'dialog' | 'true'; describedby?: string };
}

export const TOOLBAR_ICON_BUTTON_CLASS =
    `relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9 ${TOOLBAR_FOCUS}`;

export const ToolbarIconButton = React.forwardRef<HTMLButtonElement, ToolbarIconButtonProps>(function ToolbarIconButton(props, ref) {
    const { label, glyph, hint, shortcut, loading, disabled, dot, onPress, a11y } = props;
    return (
        <ToolbarTooltip label={label} hint={hint} shortcut={shortcut}>
            {(aria) => (
                <button
                    ref={ref}
                    type="button"
                    className={TOOLBAR_ICON_BUTTON_CLASS}
                    aria-label={label}
                    aria-busy={loading || undefined}
                    disabled={disabled || loading}
                    data-extension-action=""
                    aria-expanded={a11y?.expanded}
                    aria-controls={a11y?.controls}
                    aria-haspopup={a11y?.haspopup}
                    aria-describedby={a11y?.describedby ?? aria['aria-describedby']}
                    aria-keyshortcuts={shortcut}
                    onClick={() => { if (!loading && !disabled) onPress?.(); }}
                >
                    {loading && glyph.kind !== 'ref' ? <Loader2 size={16} aria-hidden={true} className="animate-spin motion-reduce:animate-none" /> : <GlyphView glyph={glyph} loading={loading} disabled={disabled} />}
                    {dot && !loading && <span aria-hidden="true" data-last-used="" className="absolute bottom-1 end-1 h-1.5 w-1.5 rounded-full bg-brand-accent ring-2 ring-background" />}
                </button>
            )}
        </ToolbarTooltip>
    );
});

export interface ToolbarMenuRowProps {
    label: string;
    description?: string;
    glyph: ToolbarGlyph;
    loading?: boolean;
    disabled?: boolean;
    onPress?: () => void;
}

/** Fila de accion dentro del menu "Extensiones" (role="menuitem"): icono + nombre + descripcion de una linea. */
export function ToolbarMenuRow({ label, description, glyph, loading, disabled, onPress }: ToolbarMenuRowProps) {
    return (
        <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            data-toolbar-menu-item=""
            data-extension-action=""
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            onClick={() => { if (!loading && !disabled) onPress?.(); }}
            className={`flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-start text-sm text-card-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground disabled:opacity-50 [@media(pointer:coarse)]:min-h-11`}
        >
            {glyph.kind === 'ref' ? (
                <ExtensionIcon icon={glyph.icon} size={32} loading={loading} disabled={disabled} />
            ) : (
                <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    {loading ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" /> : <GlyphView glyph={glyph} />}
                </span>
            )}
            <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{label}</span>
                {description && <span className="line-clamp-2 break-words text-xs text-muted-foreground">{description}</span>}
            </span>
        </button>
    );
}
