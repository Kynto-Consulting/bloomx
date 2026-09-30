'use client';

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_MAIL_PREFS, MAIL_PREFS_KEY, parseMailPrefs, type MailPrefs } from '@/lib/mail-prefs';

const EVENT = 'bloomx:mail-prefs';

function read(): MailPrefs {
    try {
        return parseMailPrefs(window.localStorage.getItem(MAIL_PREFS_KEY));
    } catch {
        return DEFAULT_MAIL_PREFS;
    }
}

/** Preferencias de la bandeja persistidas en localStorage (try/catch: con almacenamiento bloqueado usa los valores por defecto). */
export function useMailPrefs(): [MailPrefs, (patch: Partial<MailPrefs>) => void] {
    // Valor por defecto en el primer render (coincide con el HTML del servidor) y se carga lo guardado al montar.
    const [prefs, setPrefs] = useState<MailPrefs>(DEFAULT_MAIL_PREFS);

    useEffect(() => {
        setPrefs(read());
        const sync = () => setPrefs(read());
        window.addEventListener('storage', sync);
        window.addEventListener(EVENT, sync);
        return () => {
            window.removeEventListener('storage', sync);
            window.removeEventListener(EVENT, sync);
        };
    }, []);

    const update = useCallback((patch: Partial<MailPrefs>) => {
        const next = parseMailPrefs({ ...read(), ...patch });
        setPrefs(next);
        try {
            window.localStorage.setItem(MAIL_PREFS_KEY, JSON.stringify(next));
            window.dispatchEvent(new Event(EVENT));
        } catch { /* sin almacenamiento: el cambio vale solo para esta sesion */ }
    }, []);

    return [prefs, update];
}
