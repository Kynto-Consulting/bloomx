/**
 * CSV seguro para exportaciones de la consola.
 *  - Comillas RFC 4180 (campos con coma, comillas, CR o LF).
 *  - Neutraliza la inyeccion de formulas de hoja de calculo (OWASP "CSV injection"): una celda que empieza por
 *    = + - @ TAB o CR se prefija con una comilla simple.
 *  - Nunca incluye secretos: cada ruta decide sus columnas (lista blanca), aqui solo se serializa.
 */

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    let s = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
    // Un numero negativo legitimo no es una formula, pero por simplicidad y seguridad solo se exime a numeros reales.
    if (typeof value !== 'number' && FORMULA_START.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T extends Record<string, unknown>>(rows: readonly T[], columns: readonly { key: keyof T & string; header: string }[]): string {
    const lines = [columns.map((c) => csvCell(c.header)).join(',')];
    for (const row of rows) lines.push(columns.map((c) => csvCell(row[c.key])).join(','));
    return lines.join('\r\n') + '\r\n';
}

export function csvResponse(body: string, filename: string): Response {
    const safe = filename.replace(/[^A-Za-z0-9._-]/g, '_');
    return new Response('﻿' + body, {
        status: 200,
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${safe}"`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
        },
    });
}
