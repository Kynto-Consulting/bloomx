import { z } from 'zod';

/** Esquema del cambio de contrasena propio. Nunca se registran ni se devuelven estos valores. */
export const passwordChangeSchema = z.object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(1).max(200),
});

/**
 * Traduce el mensaje de `validateNewPassword` (ingles, politica 12+) a un codigo estable para que la UI lo traduzca.
 * Cualquier mensaje desconocido cae en `password_policy`.
 */
export function passwordPolicyCode(message: string): string {
    if (/at least 12/i.test(message)) return 'password_too_short';
    if (/at most 72/i.test(message)) return 'password_too_long';
    if (/too common/i.test(message)) return 'password_common';
    if (/too weak/i.test(message)) return 'password_weak';
    if (/email name/i.test(message)) return 'password_contains_email';
    return 'password_policy';
}
