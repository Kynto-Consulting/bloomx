'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Estado local de una extension (`state`): un objeto por raiz de renderizado (mount/overlay), con valor inicial
 * declarado en el manifest (`state`). Las claves admiten RUTAS con puntos ("form.email"), tanto al escribir
 * (SET_STATE, `bind` de los inputs) como al leer (`${state.form.email}`).
 *
 * Claves reservadas que escribe el renderer solo:
 *   state.$loading[<clave>]  true mientras una accion CALL_BACKEND/CALL_API (o SET_LOADING) esta en curso
 *   state.$error[<clave>]    mensaje del ultimo error de esa accion (o null)
 */

const BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);

export function getPath(source: any, path: string | undefined | null): any {
    if (!path) return undefined;
    let current = source;
    for (const part of String(path).split('.')) {
        if (BLOCKED.has(part) || current === null || current === undefined || typeof current !== 'object') return undefined;
        current = current[part];
    }
    return current;
}

/** Devuelve una COPIA de `source` con `value` escrito en `path` (no muta). Rutas con claves bloqueadas se ignoran. */
export function setPath(source: Record<string, any>, path: string, value: any): Record<string, any> {
    const parts = String(path).split('.').filter(Boolean);
    if (parts.length === 0 || parts.some((part) => BLOCKED.has(part))) return source;
    const root = { ...source };
    let cursor: Record<string, any> = root;
    for (let i = 0; i < parts.length - 1; i++) {
        const existing = cursor[parts[i]];
        cursor[parts[i]] = existing !== null && typeof existing === 'object' && !Array.isArray(existing) ? { ...existing } : {};
        cursor = cursor[parts[i]];
    }
    cursor[parts[parts.length - 1]] = value;
    return root;
}

export interface ExtensionStateContextType {
    state: Record<string, any>;
    setState: (key: string, value: any) => void;
    /** Estado vigente en este instante (incluye SET_STATE ya ejecutados en la misma cadena de acciones). */
    getState: () => Record<string, any>;
}

export const ExtensionStateContext = createContext<ExtensionStateContextType>({ state: {}, setState: () => { }, getState: () => ({}) });

function cloneSeed(initialState: unknown): Record<string, any> {
    if (!initialState || typeof initialState !== 'object' || Array.isArray(initialState)) return {};
    try { return JSON.parse(JSON.stringify(initialState)); } catch { return {}; }
}

export const ExtensionStateProvider: React.FC<{ children: React.ReactNode; initialState?: Record<string, any>; onStateChange?: (state: Record<string, any>) => void }> = ({ children, initialState, onStateChange }) => {
    const seed = useMemo(() => cloneSeed(initialState), [initialState]);
    const [state, setInternalState] = useState<Record<string, any>>(seed);
    const stateRef = useRef<Record<string, any>>(seed);
    const setState = useCallback((key: string, value: any) => {
        stateRef.current = setPath(stateRef.current, key, value);
        setInternalState(stateRef.current);
    }, []);
    const getState = useCallback(() => stateRef.current, []);
    const notifyRef = useRef(onStateChange);
    notifyRef.current = onStateChange;
    useEffect(() => { notifyRef.current?.(state); }, [state]);
    const value = useMemo(() => ({ state, setState, getState }), [state, setState, getState]);
    return <ExtensionStateContext.Provider value={value}>{children}</ExtensionStateContext.Provider>;
};

export function useExtensionState() {
    return useContext(ExtensionStateContext);
}

/** Enlace bidireccional input <-> state: valor actual + setter; si el estado no tiene valor, aplica `defaultValue` una vez. */
export function useBoundState(bind: string | undefined, defaultValue?: any): [any, (value: any) => void] {
    const { state, setState, getState } = useExtensionState();
    useEffect(() => {
        if (bind && defaultValue !== undefined && getPath(getState(), bind) === undefined) setState(bind, defaultValue);
        // defaultValue solo se aplica al montar / cambiar de clave
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bind]);
    const set = useCallback((value: any) => { if (bind) setState(bind, value); }, [bind, setState]);
    return [bind ? getPath(state, bind) : undefined, set];
}

// --- Wizard (NEXT_STEP / PREV_STEP actuan sobre el WIZARD que contiene al componente) ---
export interface WizardContextType { step: number; total: number; next: () => void; prev: () => void }
export const WizardContext = createContext<WizardContextType | null>(null);
