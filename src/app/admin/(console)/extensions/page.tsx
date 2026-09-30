'use client';

import { Suspense } from 'react';
import { LoadingState } from '@/components/admin/console';
import { ExtensionsScreen } from '@/components/admin/extensions/ExtensionsScreen';

/** /admin/extensions — catalogo, instalacion, permisos, orden y estado de las extensiones del dominio. */
export default function AdminExtensionsPage() {
    // useSearchParams (?open=<id> desde la busqueda global) exige Suspense en el render estatico.
    return (
        <Suspense fallback={<LoadingState />}>
            <ExtensionsScreen />
        </Suspense>
    );
}
