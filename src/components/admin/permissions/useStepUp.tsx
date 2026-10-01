'use client';

import * as React from 'react';
import { ReauthDialog } from '@/components/admin/mail-transfer/ReauthDialog';
import { ApiError, useConsole } from '@/components/admin/console';

/**
 * Step-up de las acciones criticas (cambiar niveles, desbloquear, politica de sesion): ejecuta `fn`; si el servidor responde 403
 * `reauth_required` abre el dialogo de re-autenticacion (codigo MFA; la manager del dominio puede usar su contrasena) y reintenta.
 * La prueba es la misma cookie de 10 minutos que usa importar/exportar correo.
 */
export function useStepUp() {
    const { me } = useConsole();
    const [open, setOpen] = React.useState(false);
    const retry = React.useRef<null | (() => Promise<void>)>(null);
    const isManager = me?.kind === 'manager';

    const guard = React.useCallback(async (fn: () => Promise<void>) => {
        try {
            await fn();
        } catch (error) {
            if (error instanceof ApiError && error.status === 403 && error.code === 'reauth_required') {
                retry.current = fn;
                setOpen(true);
                return;
            }
            throw error;
        }
    }, []);

    const dialog = (
        <ReauthDialog
            open={open}
            base="/api/admin/mail-transfer"
            mfaEnrolled
            canUsePassword={isManager}
            isAdmin
            onVerified={() => {
                setOpen(false);
                const fn = retry.current;
                retry.current = null;
                if (fn) void fn().catch(() => undefined);
            }}
            onClose={() => { setOpen(false); retry.current = null; }}
        />
    );
    return { guard, dialog };
}
