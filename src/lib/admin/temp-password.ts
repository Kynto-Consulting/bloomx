import { randomInt } from 'node:crypto';
import { validateNewPassword } from '@/lib/security';

/**
 * Contrasena temporal aleatoria (crypto.randomInt, sin sesgo de modulo). Sin caracteres ambiguos (0/O, 1/l/I) para que sea
 * facil de dictar. Cumple la politica de `validateNewPassword` (12+ caracteres, sin el nombre del correo, no comun...).
 * Nunca se registra ni se audita: solo se devuelve UNA vez al admin que la genero.
 */
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!#$%&*+-=?@^_';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;
export const TEMP_PASSWORD_LENGTH = 20;

const pick = (set: string) => set[randomInt(set.length)];

function shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
}

export function generateTemporaryPassword(email?: string): string {
    for (let attempt = 0; attempt < 10; attempt++) {
        const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
        while (chars.length < TEMP_PASSWORD_LENGTH) chars.push(pick(ALL));
        const candidate = shuffle(chars).join('');
        if (validateNewPassword(candidate, email) === null) return candidate;
    }
    // Probabilidad practicamente nula: prefiere fallar a devolver una contrasena que incumpla la politica.
    throw new Error('temp_password_generation_failed');
}
