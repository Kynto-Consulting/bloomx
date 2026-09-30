import { useState, useEffect, useCallback, useRef } from 'react';
import { secureRead, secureWrite } from '@/lib/expansions/client/secure-storage';

/**
 * Estado persistido en almacenamiento seguro del cliente. (Sin usos hoy: se corrigen las carreras del original.)
 *  - `initialValue` solo se usa hasta que termina la lectura; no pisa lo guardado.
 *  - Un valor fijado por el usuario ANTES de terminar la carga gana sobre el leido y se escribe al terminar la carga.
 */
export function useSecureSync<T>(key: string, initialValue: T, userId: string = 'default-user'): [T, (value: T) => void, boolean] {
    const [state, setState] = useState<T>(initialValue);
    const [isLoaded, setIsLoaded] = useState(false);
    const userSetBeforeLoad = useRef<{ value: T } | null>(null);

    // Load from storage on mount
    useEffect(() => {
        let mounted = true;
        setIsLoaded(false);
        userSetBeforeLoad.current = null;
        secureRead(key, userId)
            .then((val) => {
                if (!mounted) return;
                if (userSetBeforeLoad.current) {
                    // El usuario escribio antes de que terminara la lectura: prevalece y se persiste ahora
                    secureWrite(key, userSetBeforeLoad.current.value, userId).catch(console.error);
                } else if (val !== null) {
                    setState(val);
                }
                setIsLoaded(true);
            })
            .catch(() => { if (mounted) setIsLoaded(true); });
        return () => { mounted = false; };
    }, [key, userId]);

    const setSecureState = useCallback((newValue: T) => {
        setState(newValue);
        if (!isLoaded) {
            userSetBeforeLoad.current = { value: newValue };
            return;
        }
        // Fire and forget write
        secureWrite(key, newValue, userId).catch(console.error);
    }, [key, userId, isLoaded]);

    return [state, setSecureState, isLoaded];
}
