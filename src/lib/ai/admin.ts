import { HttpError, type AdminCtx } from '@/lib/admin/http';
import { assertFreshMfa } from '@/lib/admin/stepup';
import { SettingsError } from './settings';

/** Ayudantes de las rutas /api/admin/ai/**: errores de ajustes -> HttpError y exigencia de nivel 4 + step-up. */

/** SettingsError (400) -> HttpError con codigo corto (sin el motivo tras ':'; el motivo va en el mensaje, nunca un valor). */
export function toHttpError(e: unknown): unknown {
    if (e instanceof SettingsError) return new HttpError(e.status, e.code.split(':')[0], e.code);
    return e;
}

/** Nivel 4 real del actor (adminRoute solo valido el piso de la ruta) y, si `stepUp`, MFA reciente. */
export async function requireCritical(ctx: AdminCtx, stepUp = true): Promise<void> {
    if (ctx.actor.level < 4) throw new HttpError(403, 'insufficient_level', 'insufficient_level');
    if (stepUp) await assertFreshMfa(ctx);
}
