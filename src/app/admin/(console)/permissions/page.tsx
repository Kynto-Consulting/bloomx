'use client';

import { PermissionsView } from '@/components/admin/permissions/PermissionsView';

/** /admin/permissions: niveles de permisos (0-4), cuentas con acceso, asignar nivel, historial y sesion privilegiada unica. */
export default function AdminPermissionsPage() {
    return <PermissionsView />;
}
