'use client';

import { createContext, useContext } from 'react';
import type { LandingView } from './types';
import { LandingLink } from './LandingLink';

/** Acciones opcionales que una pagina de acceso aporta. Sin accion, el ajuste de la empresa no muestra nada. */
export interface LandingActions {
    /** Ruta de "olvide mi contrasena" (solo si el flujo existe). */
    forgotHref?: string;
    /** Inicio con Google (solo si el flujo existe). */
    onGoogle?: () => void;
    /** "Recordarme": estado controlado por la pagina. */
    remember?: { checked: boolean; onChange: (checked: boolean) => void };
}

export interface LandingFormContextValue {
    view: LandingView;
    actions: LandingActions;
}

export const LandingFormContext = createContext<LandingFormContextValue | null>(null);

/**
 * Colocar DENTRO del <form> (antes del boton de envio). Muestra "Recordarme" y "Olvide mi contrasena" solo si
 * la empresa los activo (form.showRememberMe / form.showForgotLink) Y la pagina aporta la accion.
 */
export function LandingFormExtras() {
    const ctx = useContext(LandingFormContext);
    if (!ctx) return null;
    const { view, actions } = ctx;
    const form = view.cfg.form;
    const remember = form?.showRememberMe && actions.remember ? actions.remember : null;
    const forgot = form?.showForgotLink && actions.forgotHref ? actions.forgotHref : null;
    if (!remember && !forgot) return null;
    return (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            {remember ? (
                <label className="inline-flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={remember.checked}
                        onChange={(e) => remember.onChange(e.target.checked)}
                        className="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    {view.m('remember')}
                </label>
            ) : <span />}
            {forgot && (
                <LandingLink href={forgot} preview={view.preview} className="rounded-sm text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {view.m('forgot')}
                </LandingLink>
            )}
        </div>
    );
}
