'use client';

import { ProfileView } from '@/components/admin/profile/ProfileView';

/** /admin/profile: mi perfil (contrasena, MFA, sesiones, clave de firma del dominio, preferencias). */
export default function AdminProfilePage() {
    return <ProfileView />;
}
