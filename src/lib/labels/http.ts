import { NextResponse } from 'next/server';
import { LabelError } from './store';

const STATUS: Record<string, number> = { not_found: 404, conflict: 409, invalid: 400, limit: 400, cycle: 400, depth: 400, parent_missing: 400, self: 400 };

/** Errores de etiquetas -> respuesta HTTP (null si no es un LabelError). */
export function labelErrorResponse(e: unknown): NextResponse | null {
    if (e instanceof LabelError) return NextResponse.json({ error: e.message, code: e.code }, { status: STATUS[e.code] ?? 400 });
    return null;
}
