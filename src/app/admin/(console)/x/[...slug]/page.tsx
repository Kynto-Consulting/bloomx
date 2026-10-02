'use client';

import React, { Suspense, use } from 'react';
import { ExtensionPageView } from '@/components/expansions/ExtensionPageView';

/**
 * /admin/x/<path>: pagina de una extension con `auth: "admin"` servida DENTRO de la consola de administracion (misma barra lateral, cabecera y
 * puerta de acceso que el resto de /admin). Es la URL de las entradas de navegacion `section: "admin"`. El control de acceso real es el del mount
 * (nivel + MFA + sesion privilegiada, comprobado en el servidor por /api/expansions/page-access); ocultar la entrada no es la defensa.
 */
export default function AdminExtensionPage({ params }: { params: Promise<{ slug: string[] }> }) {
    const { slug } = use(params);
    return (
        <Suspense fallback={null}>
            <ExtensionPageView slug={slug} variant="console" />
        </Suspense>
    );
}
