import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { SIDEBAR_COOKIE, parseSidebarCookie } from '@/lib/layout/sidebar-width';
import { getSessionCookie } from '@/lib/session';

/**
 * Layout de grupo de rutas: bandeja, calendario, contactos, citas y Elixir comparten UN shell (barra lateral + ancho
 * persistido), que sobrevive a la navegacion entre ellas. El ancho elegido llega en una cookie para que el primer HTML
 * ya tenga el tamano correcto (sin salto al recargar).
 *
 * Guardia de sesion: el middleware (Edge, sin BD) solo comprueba la firma del JWT; una sesion firmada pero caducada por
 * inactividad, revocada o de un usuario deshabilitado pasaba y dejaba la pantalla colgada con las APIs en 401. Aqui se
 * valida la sesion COMPLETA y, si no vale, se redirige al login (la cookie vieja se borra en /login/expired).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
    let valid = true;
    try {
        valid = Boolean(await getSessionCookie());
    } catch {
        valid = true; // fallo transitorio de BD: no expulsar al usuario (las APIs ya fallaran de forma visible)
    }
    if (!valid) redirect('/login/expired');

    const jar = await cookies();
    const initial = parseSidebarCookie(jar.get(SIDEBAR_COOKIE)?.value);
    return <AppShell initialSidebarWidth={initial}>{children}</AppShell>;
}
