/** Logica pura de /admin/ai: permisos por nivel, validacion y formato. Sin React ni red (testeable). */

export const LEVEL_VIEW = 1;
export const LEVEL_EDIT = 3;
export const LEVEL_CRITICAL = 4;

export type Capability = 'view' | 'edit' | 'critical';
export interface Caps { view: boolean; edit: boolean; critical: boolean }

export function capsForLevel(level: number | null | undefined): Caps {
    const l = typeof level === 'number' && Number.isFinite(level) ? level : 0;
    return { view: l >= LEVEL_VIEW, edit: l >= LEVEL_EDIT, critical: l >= LEVEL_CRITICAL };
}

/** Clave i18n (bajo admin.ai.reason.*) del motivo por el que un control esta deshabilitado, o null si esta habilitado. */
export function disabledReason(cap: Capability, level: number | null | undefined): 'needEdit' | 'needCritical' | 'needView' | null {
    const c = capsForLevel(level);
    if (cap === 'view') return c.view ? null : 'needView';
    if (cap === 'edit') return c.edit ? null : 'needEdit';
    return c.critical ? null : 'needCritical';
}

/** Un parche es critico si toca enabled/provider/baseUrl/apiKey (espejo de CRITICAL_FIELDS del servidor). */
export const CRITICAL_PATCH_FIELDS = ['enabled', 'provider', 'baseUrl', 'apiKey'] as const;
export function patchNeedsCritical(patch: Record<string, unknown>): boolean {
    return CRITICAL_PATCH_FIELDS.some((f) => patch[f] !== undefined);
}

export function maskedKey(configured: boolean, last4: string | null): string | null {
    if (!configured) return null;
    return `••••${last4 ?? ''}`;
}

/** Entero dentro de [min,max]; devuelve el numero o null si no es valido. */
export function parseIntField(raw: string, min: number, max: number): number | null {
    const s = raw.trim();
    if (!/^\d{1,12}$/.test(s)) return null;
    const n = Number(s);
    return n >= min && n <= max ? n : null;
}

export function parseFloatField(raw: string, min: number, max: number): number | null {
    const s = raw.trim().replace(',', '.');
    if (!/^\d{1,6}(\.\d{1,6})?$/.test(s)) return null;
    const n = Number(s);
    return n >= min && n <= max ? n : null;
}

export type PatternIssue = 'too_long' | 'invalid_regex' | 'too_many' | 'duplicate';
/** Valida una lista de regex (una por linea). El servidor aplica ademas su comprobacion anti-ReDoS (unsafe_regex). */
export function validatePatterns(text: string, max = 50): { patterns: string[]; issues: Array<{ line: number; issue: PatternIssue }> } {
    const lines = text.split(/\r?\n/).map((l) => l.trim());
    const patterns: string[] = [];
    const issues: Array<{ line: number; issue: PatternIssue }> = [];
    const seen = new Set<string>();
    lines.forEach((l, i) => {
        if (!l) return;
        if (l.length > 200) { issues.push({ line: i + 1, issue: 'too_long' }); return; }
        try { new RegExp(l, 'iu'); } catch { issues.push({ line: i + 1, issue: 'invalid_regex' }); return; }
        if (seen.has(l)) { issues.push({ line: i + 1, issue: 'duplicate' }); return; }
        seen.add(l);
        patterns.push(l);
    });
    if (patterns.length > max) issues.push({ line: 0, issue: 'too_many' });
    return { patterns, issues };
}

/** Codigo de error de la API -> clave i18n bajo admin.ai.errors.*; null si no hay una especifica (usar el generico por estado). */
export function aiErrorKey(status: number, code?: string): string | null {
    if (!code) return null;
    if (code === 'reauth_required') return 'reauthRequired';
    if (code.startsWith('unsafe_base_url')) return 'unsafeBaseUrl';
    const known = ['invalid_input', 'invalid_config', 'base_url_required', 'model_not_allowed', 'unsafe_regex', 'apikey_chars', 'forbidden', 'level_required'];
    if (known.includes(code)) return code.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
    return status === 403 ? 'forbidden' : null;
}

export function formatCost(usd: number, locale = 'es'): string {
    const digits = usd > 0 && usd < 0.01 ? 4 : 2;
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(usd || 0);
}

/** Alturas (0..100) de las barras del grafico por dia; el maximo ocupa el 100 %; los valores > 0 tienen al menos 2 %. */
export function barHeights(values: number[]): number[] {
    const max = Math.max(0, ...values);
    if (max <= 0) return values.map(() => 0);
    return values.map((v) => (v <= 0 ? 0 : Math.max(2, Math.round((v / max) * 100))));
}

/** Porcentaje de uso de una cuota (0 = sin limite -> null). */
export function quotaPercent(used: number, limit: number): number | null {
    if (!limit || limit <= 0) return null;
    return Math.min(100, Math.round((used / limit) * 100));
}

/** Extensiones que usan una funcion (por `features`). */
export function extensionsForFeature<E extends { features: string[] }>(exts: E[], feature: string): E[] {
    return exts.filter((e) => e.features.includes(feature));
}

export const USAGE_RANGES = [7, 30, 90] as const;
