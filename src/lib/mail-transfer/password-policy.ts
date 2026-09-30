/**
 * password-policy.ts - espejo PURO (sin node:crypto, usable en el navegador) de validateNewPassword (lib/security.ts) para
 * validar la contrasena generica y mostrar el medidor. La validacion definitiva la hace SIEMPRE el servidor.
 */
const COMMON = new Set([
    'password', 'password1', 'password123', '123456789012', 'qwertyuiopas', 'qwerty123456',
    'administrator', 'letmein12345', 'iloveyou1234', 'welcome12345', 'changeme1234', 'bloomx123456',
]);

export type PasswordIssue = 'length' | 'bytes' | 'common' | 'repeated' | 'email';

export function checkPassword(password: string, email?: string): { ok: boolean; issues: PasswordIssue[]; score: 0 | 1 | 2 | 3 } {
    const issues: PasswordIssue[] = [];
    if (password.length < 12) issues.push('length');
    if (new TextEncoder().encode(password).length > 72) issues.push('bytes');
    const lower = password.toLowerCase();
    if (COMMON.has(lower)) issues.push('common');
    if (password.length > 0 && /^(.)\1+$/.test(password)) issues.push('repeated');
    const local = email ? email.split('@')[0].toLowerCase() : '';
    if (local.length >= 4 && lower.includes(local)) issues.push('email');
    let score: 0 | 1 | 2 | 3 = 0;
    if (issues.length === 0) {
        const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
        score = password.length >= 16 && classes >= 3 ? 3 : password.length >= 14 || classes >= 3 ? 2 : 1;
    }
    return { ok: issues.length === 0, issues, score };
}
