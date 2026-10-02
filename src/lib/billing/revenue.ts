import { safeCents } from './money';

/**
 * Reparto y neto estimado de una venta. El porcentaje del desarrollador SALE DEL BACKEND (`shares.developerBps` de /api/developer/overview
 * o `developerShareBps` de /api/payments/status): aqui no hay ningun 70 fijo. bps = puntos base (7000 = 70 %).
 * El neto es una ESTIMACION: la comision de PayPal (si la absorbe el desarrollador) se descuenta al cobrar y no se conoce de antemano.
 */

export const BPS_TOTAL = 10_000;

export const isBps = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= BPS_TOTAL;

export interface Split { grossCents: number; developerCents: number; platformCents: number }

/** developer = floor(bruto * bps / 10000); plataforma = el resto (la suma siempre es exactamente el bruto). */
export function splitCents(grossCents: unknown, developerBps: number): Split {
    const gross = safeCents(grossCents);
    const bps = isBps(developerBps) ? developerBps : 0;
    const developerCents = Math.floor((gross * bps) / BPS_TOTAL);
    return { grossCents: gross, developerCents, platformCents: gross - developerCents };
}

export interface PricingDraft {
    model: 'free' | 'one_time' | 'subscription';
    oneTimeCents: number;
    monthCents: number;
    yearCents: number;
    trialDays: number;
}

export interface NetEstimate {
    /** Neto por cobro: pago unico, mes y ano (null = ese plan no existe en el modelo elegido). */
    oneTime: Split | null;
    month: Split | null;
    year: Split | null;
    /** Proyeccion anual por suscriptor: 12 cobros mensuales o 1 anual (null si no hay ese plan). */
    annualMonthlyPlan: number | null;
    annualYearlyPlan: number | null;
}

export function estimateNet(p: PricingDraft, developerBps: number): NetEstimate {
    const oneTime = p.model === 'one_time' && p.oneTimeCents > 0 ? splitCents(p.oneTimeCents, developerBps) : null;
    const month = p.model === 'subscription' && p.monthCents > 0 ? splitCents(p.monthCents, developerBps) : null;
    const year = p.model === 'subscription' && p.yearCents > 0 ? splitCents(p.yearCents, developerBps) : null;
    return { oneTime, month, year, annualMonthlyPlan: month ? month.developerCents * 12 : null, annualYearlyPlan: year ? year.developerCents : null };
}

/** Texto de porcentaje a partir de bps sin floats: 7000 -> "70", 7250 -> "72,5". */
export function bpsToPercentText(bps: number, decimal = ','): string {
    if (!isBps(bps)) return '0';
    const whole = Math.floor(bps / 100);
    const rest = bps % 100;
    if (rest === 0) return String(whole);
    return `${whole}${decimal}${String(rest).padStart(2, '0').replace(/0+$/, '')}`;
}

export interface PricingIssue { field: 'oneTimeCents' | 'monthCents' | 'yearCents' | 'trialDays' | 'plans'; code: 'min' | 'max' | 'required' | 'trial' }

/** Validacion local espejo de los limites del backend (min/max de `limits` y prueba 0-30 dias). El backend vuelve a validar. */
export function validatePricing(p: PricingDraft, limits: { minPriceCents: number; maxPriceCents: number }, trialMaxDays = 30): PricingIssue[] {
    const out: PricingIssue[] = [];
    const check = (field: 'oneTimeCents' | 'monthCents' | 'yearCents', v: number) => {
        if (v < limits.minPriceCents) out.push({ field, code: 'min' });
        else if (v > limits.maxPriceCents) out.push({ field, code: 'max' });
    };
    if (p.model === 'one_time') check('oneTimeCents', p.oneTimeCents);
    if (p.model === 'subscription') {
        if (p.monthCents <= 0 && p.yearCents <= 0) out.push({ field: 'plans', code: 'required' });
        if (p.monthCents > 0) check('monthCents', p.monthCents);
        if (p.yearCents > 0) check('yearCents', p.yearCents);
        if (!Number.isInteger(p.trialDays) || p.trialDays < 0 || p.trialDays > trialMaxDays) out.push({ field: 'trialDays', code: 'trial' });
    }
    return out;
}

// ---- semver (comprobacion local; la sugerencia oficial viene del backend en `versioning`) ----
const SEMVER = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;
export function parseSemver(v: string): [number, number, number] | null {
    const m = SEMVER.exec(v.trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
export function compareSemver(a: string, b: string): number | null {
    const x = parseSemver(a);
    const y = parseSemver(b);
    if (!x || !y) return null;
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
}
