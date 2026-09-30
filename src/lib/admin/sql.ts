import { prisma } from '@/lib/prisma';

/**
 * Utilidades de SQL crudo para la consola de administracion.
 *
 * Reglas:
 *  - SIEMPRE parametrizado ($1, $2...). Nunca se interpola texto del usuario en la consulta; lo unico que se concatena son
 *    fragmentos FIJOS del codigo (nombres de columna de una lista blanca, ver `pickOrder`).
 *  - Tolerante a tablas/columnas ausentes (despliegue sin `db:ensure`): `tolerant()` devuelve el valor de respaldo.
 */

export const MISSING_RE = /does not exist|42P01|42703|no such (table|column)/i;

export function isMissingRelation(error: unknown): boolean {
    const e = error as { code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown } } | null;
    return MISSING_RE.test(`${e?.code ?? ''} ${e?.meta?.code ?? ''} ${e?.message ?? ''} ${e?.meta?.message ?? ''}`);
}

/** Ejecuta `fn`; si falla porque falta una tabla o columna devuelve `fallback`. Otros errores se propagan. */
export async function tolerant<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
        return await fn();
    } catch (error) {
        if (isMissingRelation(error)) return fallback;
        throw error;
    }
}

/** Consulta parametrizada con resultado tipado. */
export async function query<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
    return (await prisma.$queryRawUnsafe(sql, ...params)) as T[];
}

export async function execute(sql: string, ...params: unknown[]): Promise<number> {
    return Number(await prisma.$executeRawUnsafe(sql, ...params));
}

/** COUNT(*) llega como bigint: lo convierte a number seguro. */
export function num(value: unknown): number {
    if (typeof value === 'bigint') return Number(value);
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
}

/** Escapa %, _ y \ para usarlo dentro de un ILIKE ... ESCAPE '\'. */
export function likeContains(input: string): string {
    return `%${input.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Elige una columna de ORDER BY de una lista blanca (nunca texto libre). */
export function pickOrder<K extends string>(allowed: Record<K, string>, key: unknown, fallback: K): string {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(allowed, key) ? allowed[key as K] : allowed[fallback];
}

export function toIso(value: unknown): string | null {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
