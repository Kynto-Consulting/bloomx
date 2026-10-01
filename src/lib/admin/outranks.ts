import type { AdminActor, LevelInfo } from '@/lib/admin-auth';
import { refreshPermissions } from '@/lib/permissions';
import { effectiveLevelSync, normalizeEmail } from '@/lib/permissions-core';
import { HttpError } from './http';

/**
 * Regla "nadie modifica a alguien de nivel >= al suyo": toda accion de administracion SOBRE otra cuenta exige que el actor tenga un
 * nivel ESTRICTAMENTE mayor que el de esa cuenta (nivel efectivo = max(entorno, consola)). Excepciones:
 *  - la propia cuenta (las acciones sobre uno mismo tienen sus propias reglas, p. ej. `cannot_target_self`);
 *  - la manager DUENA del dominio (nivel 4 por propiedad del dominio, autenticada contra el backend): no es una cuenta de la app,
 *    es la autoridad raiz de su instancia.
 * Asi un operador (2) no puede deshabilitar a un admin (3), ni un admin a un superadmin, ni un superadmin a otro (salvo la manager).
 */
export async function assertOutranks(actor: AdminActor & LevelInfo, target: { email: string }): Promise<void> {
    if (actor.kind === 'manager') return;
    if (normalizeEmail(actor.email) === normalizeEmail(target.email)) return;
    await refreshPermissions();
    const t = effectiveLevelSync(target.email).level;
    if (t >= actor.level) throw new HttpError(403, 'cannot_modify_peer_or_higher');
}

/** Variante que devuelve el motivo en vez de lanzar (acciones masivas: resultado por id). */
export async function outranks(actor: AdminActor & LevelInfo, targetEmail: string): Promise<boolean> {
    try { await assertOutranks(actor, { email: targetEmail }); return true; } catch { return false; }
}
