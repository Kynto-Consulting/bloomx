import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ConsoleShell } from '@/components/admin/console/ConsoleShell';

export const metadata: Metadata = {
    title: 'Admin',
    robots: { index: false, follow: false },
};

/** Layout de la consola de administracion: todas las secciones (/admin, /admin/users, ...) viven dentro del armazon. */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
    // Suspense: las paginas leen la URL (filtros, ?open=) con useSearchParams.
    return (
        <Suspense fallback={null}>
            <ConsoleShell>{children}</ConsoleShell>
        </Suspense>
    );
}
