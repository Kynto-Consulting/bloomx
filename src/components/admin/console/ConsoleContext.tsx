'use client';

import * as React from 'react';

/** Quien administra (respuesta de GET /api/admin/me). */
export interface ConsoleMe {
    kind: 'manager' | 'user';
    /** Id del manager (backend) o del usuario de la app. */
    id: string | null;
    email: string | null;
    /** Solo kind="user": el admin es un usuario de esta app (tiene contrasena, MFA y sesiones propias aqui). */
    userId: string | null;
    /** Dominio activo de la instancia (TOP_DOMAIN / NEXT_PUBLIC_APP_URL). */
    instanceDomain: string | null;
}

export interface ConsoleDomain {
    /** Id del Domain en el backend compartido (necesario para extensiones y clave de firma). */
    id?: string;
    name: string;
    displayName: string;
    logo: string | null;
}

export interface ConsoleContextValue {
    me: ConsoleMe | null;
    domain: ConsoleDomain;
    /** Marca la pantalla con cambios sin guardar: navegar desde el menu pedira confirmacion y el navegador avisara al cerrar. */
    setDirty: (dirty: boolean) => void;
    /** Etiqueta final del breadcrumb para pantallas anidadas (opcional). */
    setCrumbTail: (label: string | null) => void;
}

export const ConsoleContext = React.createContext<ConsoleContextValue>({
    me: null,
    domain: { name: '', displayName: 'BloomX', logo: null },
    setDirty: () => undefined,
    setCrumbTail: () => undefined,
});

export const useConsole = () => React.useContext(ConsoleContext);

/** Atajo para pantallas: avisa de cambios sin guardar mientras `dirty` sea true (y lo limpia al desmontar). */
export function useUnsavedChanges(dirty: boolean) {
    const { setDirty } = useConsole();
    React.useEffect(() => {
        setDirty(dirty);
        return () => setDirty(false);
    }, [dirty, setDirty]);
}
