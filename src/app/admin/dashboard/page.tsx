import { redirect } from 'next/navigation';

/** Compatibilidad de URL: la antigua pantalla unica del panel ahora es la consola (/admin). */
export default function LegacyAdminDashboard() {
    redirect('/admin');
}
