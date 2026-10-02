/**
 * Importes de pagos: SIEMPRE centavos enteros (USD). Nunca se usan floats para dinero: ni al formatear ni al leer lo que escribe el usuario.
 * Puro y sin dependencias (lo usan la UI y los proxies).
 */

export const MAX_SAFE_CENTS = 99_999_999_99; // 999.999.999,99: muy por encima de cualquier precio real, evita desbordes

export const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= MAX_SAFE_CENTS;

/** Acepta solo enteros no negativos; todo lo demas (null, NaN, float, string) cuenta como 0 para que la UI nunca muestre "NaN". */
export const safeCents = (v: unknown): number => (isCents(v) ? v : 0);

/** Separadores del idioma, calculados con Intl (sin tocar el importe). */
function separators(locale: string): { group: string; decimal: string } {
    try {
        const parts = new Intl.NumberFormat(locale, { minimumFractionDigits: 1 }).formatToParts(1000.5);
        return { group: parts.find((p) => p.type === 'group')?.value ?? ',', decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.' };
    } catch {
        return { group: ',', decimal: '.' };
    }
}

/** 12345 -> "123,45 USD" / "USD 123.45". Aritmetica entera: la parte entera y los 2 decimales se separan con division entera. */
export function formatCents(cents: unknown, currency = 'USD', locale = 'es'): string {
    const negative = typeof cents === 'number' && Number.isSafeInteger(cents) && cents < 0 && cents >= -MAX_SAFE_CENTS;
    const abs = negative ? -(cents as number) : safeCents(cents);
    const whole = Math.floor(abs / 100);
    const frac = String(abs % 100).padStart(2, '0');
    const { group, decimal } = separators(locale);
    const wholeText = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, group);
    const number = `${negative ? '-' : ''}${wholeText}${decimal}${frac}`;
    return locale.startsWith('en') ? `${currency} ${number}` : `${number} ${currency}`;
}

/** Texto del usuario ("12", "12.5", "12,50") -> centavos enteros, o null si no es un importe valido (max 2 decimales). Sin parseFloat. */
export function parseMoneyToCents(text: string): number | null {
    const m = /^\s*(\d{1,9})(?:[.,](\d{1,2}))?\s*$/.exec(text);
    if (!m) return null;
    const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
    return isCents(cents) ? cents : null;
}

/** Centavos -> texto editable ("12.50") para un input. */
export function centsToInput(cents: unknown): string {
    const c = safeCents(cents);
    return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
}
