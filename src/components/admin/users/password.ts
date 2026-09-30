/** Utilidades de contrasena del lado cliente (solo para el formulario de alta: la temporal del servidor usa su propio generador). */

const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!#$%&*+-=?@^_';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

function randomIndex(n: number): number {
    const limit = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    do crypto.getRandomValues(buf); while (buf[0] >= limit);
    return buf[0] % n;
}

/** Contrasena aleatoria de `length` caracteres con minuscula, mayuscula, digito y simbolo (crypto.getRandomValues, sin sesgo). */
export function generatePassword(length = 20): string {
    const chars = [LOWER, UPPER, DIGITS, SYMBOLS].map((s) => s[randomIndex(s.length)]);
    while (chars.length < length) chars.push(ALL[randomIndex(ALL.length)]);
    for (let i = chars.length - 1; i > 0; i--) {
        const j = randomIndex(i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
}

export async function copyToClipboard(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}
