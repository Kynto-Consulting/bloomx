import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { AppShell } from '@/components/layout/AppShell';
import { SIDEBAR_COOKIE, parseSidebarCookie } from '@/lib/layout/sidebar-width';

/**
 * Layout de grupo de rutas: bandeja, calendario, contactos, citas y Elixir comparten UN shell (barra lateral + ancho
 * persistido), que sobrevive a la navegacion entre ellas. El ancho elegido llega en una cookie para que el primer HTML
 * ya tenga el tamano correcto (sin salto al recargar).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
    const jar = await cookies();
    const initial = parseSidebarCookie(jar.get(SIDEBAR_COOKIE)?.value);
    return <AppShell initialSidebarWidth={initial}>{children}</AppShell>;
}
