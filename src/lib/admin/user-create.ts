import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { BCRYPT_COST, validateNewPassword } from '@/lib/security';
import { badRequest, conflict } from './http';
import { setMustChangePassword } from './user-state';
import { generateTemporaryPassword } from './temp-password';
import { userEmailTaken } from './users-store';

/**
 * Alta de usuario de la consola de administracion: UNICA implementacion (la usan POST /api/admin/users y la creacion de
 * buzones faltantes al importar correo). Misma politica: email en minusculas, contrasena 12+ (validateNewPassword), hash bcrypt
 * con BCRYPT_COST, duplicados por email sin distinguir mayusculas y `mustChangePassword` (UserAdminState).
 *
 * La contrasena en claro NUNCA se registra ni se audita; si se genera, se devuelve para que el llamador la muestre una vez.
 */
export interface CreateUserInput {
    email: string;
    name?: string | null;
    /** Sin contrasena => se genera una temporal aleatoria y se devuelve en `temporaryPassword`. */
    password?: string;
    /** Por defecto: true si la contrasena se genero, false si la fijo el admin. */
    mustChangePassword?: boolean;
}

export interface CreatedUser {
    user: { id: string; email: string; name: string | null };
    mustChangePassword: boolean;
    generatedPassword: boolean;
    temporaryPassword?: string;
}

export async function createUserAccount(input: CreateUserInput): Promise<CreatedUser> {
    const email = input.email.trim().toLowerCase();
    let password = input.password;
    const generated = !password;
    if (!password) password = generateTemporaryPassword(email);
    const weak = validateNewPassword(password, email);
    if (weak) throw badRequest('weak_password', weak);

    if (await userEmailTaken(email)) throw conflict('user_exists');

    const hashed = await bcrypt.hash(password, BCRYPT_COST);
    let user;
    try {
        user = await prisma.user.create({ data: { email, name: input.name || undefined, password: hashed } });
    } catch (error) {
        if ((error as { code?: string })?.code === 'P2002') throw conflict('user_exists');
        throw error;
    }

    const mustChange = input.mustChangePassword ?? generated;
    let mustChangeApplied = false;
    if (mustChange) mustChangeApplied = await setMustChangePassword(user.id, true);

    return {
        user: { id: user.id, email: user.email, name: user.name },
        mustChangePassword: mustChangeApplied,
        generatedPassword: generated,
        ...(generated ? { temporaryPassword: password } : {}),
    };
}
