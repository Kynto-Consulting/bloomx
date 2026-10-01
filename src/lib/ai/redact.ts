import type { RedactionCategories } from './types';

/**
 * Redaccion de datos sensibles ANTES de enviar texto al proveedor de IA. Detectores basicos (sin dependencias):
 * tarjetas (Luhn), IBAN (mod 97), DNI/NIE/SSN, claves/tokens/JWT, y opcionalmente emails y telefonos.
 * Devuelve el texto con marcadores [REDACTED:tipo] y el recuento por categoria (nunca los valores).
 */
export type RedactionCounts = Partial<Record<keyof RedactionCategories, number>>;

function luhn(digits: string): boolean {
    let sum = 0, alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
        let n = digits.charCodeAt(i) - 48;
        if (alt) { n *= 2; if (n > 9) n -= 9; }
        sum += n; alt = !alt;
    }
    return sum % 10 === 0;
}

function ibanOk(raw: string): boolean {
    const s = raw.replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
    const rearranged = s.slice(4) + s.slice(0, 4);
    let rem = 0;
    for (const ch of rearranged) {
        const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
        for (const d of v) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
    }
    return rem === 1;
}

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const dniOk = (num: string, letter: string) => DNI_LETTERS[Number(num) % 23] === letter.toUpperCase();

export function redactText(input: string, cats: RedactionCategories): { text: string; counts: RedactionCounts } {
    const counts: RedactionCounts = {};
    const hit = (k: keyof RedactionCategories, marker: string) => { counts[k] = (counts[k] ?? 0) + 1; return `[REDACTED:${marker}]`; };
    let text = input;

    if (cats.secret) {
        text = text
            .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, () => hit('secret', 'secret'))
            .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, () => hit('secret', 'secret'))
            .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bxox[abprs]-[A-Za-z0-9-]{10,}\b|\bAIza[0-9A-Za-z_-]{30,}\b/g, () => hit('secret', 'secret'))
            .replace(/\b((?:api[_-]?key|secret|token|passw(?:or)?d|pwd|authorization)\s*[:=]\s*)(?:Bearer\s+)?["']?[^\s"',;]{8,}/gi, (_m, p) => `${p}${hit('secret', 'secret')}`);
    }
    if (cats.iban) {
        text = text.replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g, (m) => (ibanOk(m) ? hit('iban', 'iban') : m));
    }
    if (cats.card) {
        text = text.replace(/\b\d(?:[ -]?\d){12,18}\b/g, (m) => {
            const digits = m.replace(/[^0-9]/g, '');
            return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? hit('card', 'card') : m;
        });
    }
    if (cats.nationalId) {
        text = text
            .replace(/\b(\d{8})[- ]?([A-Za-z])\b/g, (m, n, l) => (dniOk(n, l) ? hit('nationalId', 'id') : m))
            .replace(/\b[XYZxyz][- ]?(\d{7})[- ]?([A-Za-z])\b/g, (m, n, l) => {
                const prefix = { X: '0', Y: '1', Z: '2' }[m[0].toUpperCase() as 'X' | 'Y' | 'Z'];
                return dniOk(prefix + n, l) ? hit('nationalId', 'id') : m;
            })
            .replace(/\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g, () => hit('nationalId', 'id'));
    }
    if (cats.email) {
        text = text.replace(/\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}\b/g, () => hit('email', 'email'));
    }
    if (cats.phone) {
        text = text.replace(/(?<![\w.])\+?\d[\d\s().-]{7,16}\d(?![\w])/g, (m) => {
            const d = m.replace(/\D/g, '');
            return d.length >= 9 && d.length <= 15 ? hit('phone', 'phone') : m;
        });
    }
    return { text, counts };
}

export const totalRedactions = (c: RedactionCounts) => Object.values(c).reduce((a, b) => a + (b ?? 0), 0);
