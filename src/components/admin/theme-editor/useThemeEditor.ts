'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { mutate as mutateSWR } from 'swr';
import { EMPTY_DOC, checkForSave, docFromDomain, historyReducer, initHistory, isDirty, type EditorDoc, type FieldErrors, type SaveCheck } from './model';

export type EditorStatus = 'loading' | 'ready' | 'error';
export type SaveResult = { ok: true } | { ok: false; reason: 'invalid' | 'server' | 'network'; message?: string };

export interface ThemeEditorApi {
    status: EditorStatus;
    /** Nombre tecnico del dominio (solo lectura). */
    domainName: string;
    doc: EditorDoc;
    baseline: EditorDoc;
    dirty: boolean;
    saving: boolean;
    canUndo: boolean;
    canRedo: boolean;
    /** Errores por campo (locales del saneador + los que devuelve el servidor). */
    errors: FieldErrors;
    warnings: FieldErrors;
    /** Mensaje general del ultimo intento de guardado (servidor o red). */
    formError: string | null;
    check: SaveCheck;
    set: (doc: EditorDoc, key?: string) => void;
    undo: () => void;
    redo: () => void;
    reload: () => Promise<void>;
    save: () => Promise<SaveResult>;
    /** Marca el documento actual como guardado (sin enviar). */
    discard: () => void;
}

const ENDPOINT = '/api/admin/domain';

/** Traduce el error de texto que devuelve el backend a un campo (Invalid logo..., Invalid displayName). */
export function serverErrorToField(message: string): { field?: string; message: string } {
    if (/logo/i.test(message)) return { field: 'logo', message };
    if (/displayName/i.test(message)) return { field: 'displayName', message };
    if (/theme/i.test(message)) return { field: 'theme', message };
    return { message };
}

/**
 * Estado del editor: carga (GET), historial deshacer/rehacer, sucio (contra lo ultimo guardado), guardado (PUT) y errores.
 * Tras guardar revalida /api/config (SWR): ThemeProvider aplica el tema en la sesion sin recargar.
 */
export function useThemeEditor(): ThemeEditorApi {
    const [status, setStatus] = useState<EditorStatus>('loading');
    const [domainName, setDomainName] = useState('');
    const [history, dispatch] = useReducer(historyReducer, EMPTY_DOC, initHistory);
    const [baseline, setBaseline] = useState<EditorDoc>(EMPTY_DOC);
    const [saving, setSaving] = useState(false);
    const [serverErrors, setServerErrors] = useState<FieldErrors>({});
    const [formError, setFormError] = useState<string | null>(null);
    const alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

    const doc = history.present;
    const check = useMemo(() => checkForSave(doc), [doc]);
    const dirty = useMemo(() => isDirty(doc, baseline), [doc, baseline]);

    const load = useCallback(async () => {
        setStatus('loading');
        try {
            const res = await fetch(ENDPOINT, { cache: 'no-store' });
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            if (!alive.current) return;
            const next = docFromDomain(data);
            setDomainName(typeof data?.name === 'string' ? data.name : '');
            setBaseline(next);
            dispatch({ type: 'load', doc: next });
            setServerErrors({});
            setFormError(null);
            setStatus('ready');
        } catch {
            if (alive.current) setStatus('error');
        }
    }, []);
    useEffect(() => { void load(); }, [load]);

    const set = useCallback((next: EditorDoc, key?: string) => {
        dispatch({ type: 'set', doc: next, key });
        setServerErrors((prev) => (Object.keys(prev).length ? {} : prev));
    }, []);

    const save = useCallback(async (): Promise<SaveResult> => {
        const c = checkForSave(doc);
        if (c.blocked) return { ok: false, reason: 'invalid' };
        setSaving(true);
        setFormError(null);
        try {
            const res = await fetch(ENDPOINT, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(c.payload),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                const message = typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`;
                const mapped = serverErrorToField(message);
                if (alive.current) {
                    if (mapped.field) setServerErrors({ [mapped.field]: 'server' });
                    setFormError(mapped.message);
                }
                return { ok: false, reason: 'server', message: mapped.message };
            }
            if (alive.current) { setBaseline(doc); setServerErrors({}); }
            // El tema se aplica en esta sesion sin recargar: ThemeProvider (useDomainConfig) reacciona a /api/config.
            await mutateSWR('/api/config');
            return { ok: true };
        } catch {
            if (alive.current) setFormError('network');
            return { ok: false, reason: 'network' };
        } finally {
            if (alive.current) setSaving(false);
        }
    }, [doc]);

    const discard = useCallback(() => setBaseline(doc), [doc]);

    return {
        status, domainName, doc, baseline, dirty, saving,
        canUndo: history.past.length > 0,
        canRedo: history.future.length > 0,
        errors: { ...check.errors, ...serverErrors },
        warnings: check.warnings,
        formError, check, set,
        undo: useCallback(() => dispatch({ type: 'undo' }), []),
        redo: useCallback(() => dispatch({ type: 'redo' }), []),
        reload: load,
        save,
        discard,
    };
}
