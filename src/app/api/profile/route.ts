import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getSessionCookie, revokeAllSessions, setSessionCookie } from "@/lib/session";
import { auditLog, BCRYPT_COST, validateNewPassword } from "@/lib/security";
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

export async function PUT(req: NextRequest) {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser || !currentUser.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { name, avatar, currentPassword, newPassword } = await req.json();

        // Get current user to check password
        const user = await prisma.user.findUnique({
            where: { email: currentUser.email }
        });

        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const updateData: any = {
            name,
            avatar
        };

        // Handle password change
        if (newPassword) {
            if (!currentPassword) {
                return NextResponse.json({ error: 'Current password is required to set a new password' }, { status: 400 });
            }

            const isValid = await bcrypt.compare(currentPassword, user.password);
            if (!isValid) {
                return NextResponse.json({ error: 'Incorrect current password' }, { status: 400 });
            }

            // Politica NIST 800-63B (longitud, lista de comunes) y mismo coste bcrypt que el registro
            const passwordError = validateNewPassword(newPassword, user.email);
            if (passwordError) {
                return NextResponse.json({ error: passwordError }, { status: 400 });
            }

            const hashed = await bcrypt.hash(newPassword, BCRYPT_COST);
            updateData.password = hashed;
        }

        const updatedUser = await prisma.user.update({
            where: { email: user.email },
            data: updateData
        });

        // Cambio de contrasena => se cierran TODAS las sesiones (NIST IA-5(1) / AC-12) y se emite una nueva para este
        // dispositivo (conservando el estado de MFA de la sesion actual).
        let newToken: string | undefined;
        if (updateData.password) {
            const currentSession = await getSessionCookie();
            await revokeAllSessions(user.id);
            newToken = await setSessionCookie(
                { sub: user.id, email: user.email, name: updatedUser.name },
                { mfa: currentSession?.mfa === true }
            );
            auditLog('auth.password.changed', { userId: user.id });
            // Un cambio de contrasena cumple el "cambio forzado" pedido por un administrador (best-effort).
            void import('@/lib/admin/user-state').then((m) => m.setMustChangePassword(user.id, false)).catch(() => undefined);
        }

        // Omit password from response
        const { password: _, ...userWithoutPassword } = updatedUser;

        // `token` (solo si se cambio la contrasena): el cliente debe actualizar el de la boveda multicuenta
        return NextResponse.json({ user: userWithoutPassword, ...(newToken ? { token: newToken } : {}) });

    } catch (error) {
        console.error('Profile update error:', error);
        return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
    }
}
