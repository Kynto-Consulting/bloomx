'use client';

/**
 * Acceso a las herramientas de extensiones (playground y galeria): SOLO administradores.
 *
 *   - Desarrollo local: si existe NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE (y NODE_ENV != production) se permite sin sesion,
 *     igual que el resto de pruebas locales de tema.
 *   - Resto de casos: GET /api/admin/me (la "puerta" de la consola de admin). 200 = administrador; 401/403 = no.
 */
import { useEffect, useState } from 'react';

/** true en desarrollo con el override de tema local (permite probar sin sesion ni BD). */
export function isLocalToolsOverride(): boolean {
    return process.env.NODE_ENV !== 'production' && Boolean(process.env.NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE);
}

export interface ExtensionToolsAccess { allowed: boolean; loading: boolean }

export function useExtensionTools(): ExtensionToolsAccess {
    const override = isLocalToolsOverride();
    const [state, setState] = useState<ExtensionToolsAccess>({ allowed: false, loading: true });

    useEffect(() => {
        if (override) return;
        let cancelled = false;
        const controller = new AbortController();
        (async () => {
            try {
                const response = await fetch('/api/admin/me', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
                if (!cancelled) setState({ allowed: response.status === 200, loading: false });
            } catch {
                if (!cancelled) setState({ allowed: false, loading: false });
            }
        })();
        return () => { cancelled = true; controller.abort(); };
    }, [override]);

    return override ? { allowed: true, loading: false } : state;
}
