import { NextRequest, NextResponse } from 'next/server';
import { requireLevel } from '@/lib/admin-auth';
import { ownDomains } from '@/lib/backend-auth';
import { refreshPermissions } from '@/lib/permissions';
import { effectiveLevelSync, type PermissionLevel } from '@/lib/permissions-core';
import { verifyManagerCookieOwnsInstance } from '@/lib/manager-auth';
import { deviceLabel } from '@/lib/privileged-notify';
import { enterPrivileged, getEnd, isLocked } from '@/lib/privileged-session';
import { prisma } from '@/lib/prisma';
import { auditLog, getClientIp } from '@/lib/security';
import { getUserState } from '@/lib/admin/user-state';
import type { ExecAuth } from './exec';
import { MACHINE_MAX_LEVEL, verifyCliToken } from './tokens';
import { SCOPES } from './types';

/**
 * Autenticacion de /api/admin/cli/**: DOS vias, nunca mezcladas.
 *  - `Authorization: Bearer bxa_...`  -> token de CLI (hash SHA-256, caducidad, revocacion, ambitos). Se revalida el rol EN CADA peticion:
 *      usuario: sigue existiendo, no esta deshabilitado y su nivel efectivo sigue siendo >= 1 (el nivel del token es el MENOR entre su tope
 *      de emision y el nivel ACTUAL de la cuenta: bajar o quitar el nivel surte efecto de inmediato); manager: la cookie guardada sigue
 *      siendo de un DUENO del dominio de esta instancia (nivel 4). Cualquier fallo o duda => 401/403 (falla cerrado).
 *      Los tokens INTERACTIVOS ocupan el slot de sesion privilegiada unico (con cierre por inactividad y tope de 12 h: 401 `superseded` /
 *      `expired`); los tokens "machine" (automatizacion: solo lectura, nivel <= 3) NO lo ocupan, pero respetan el bloqueo de la cuenta.
 *  - sin Authorization -> la cookie de la consola web (requireLevel) y la cabecera `X-Requested-With: bloomx-console`
 *      (defensa CSRF adicional: un formulario cruzado no puede enviarla sin preflight CORS).
 * Un Authorization con otro formato se rechaza (no se cae a la cookie).
 */

export const CONSOLE_HEADER = 'x-requested-with';
export const CONSOLE_HEADER_VALUE = 'bloomx-console';
const NO_STORE = { 'Cache-Control': 'no-store' };

export type CliAuthResult = { ok: true; auth: ExecAuth } | { ok: false; response: NextResponse };

const reject = (status: 401 | 403, error: string, code: string, extra: Record<string, unknown> = {}) =>
    ({ ok: false as const, response: NextResponse.json({ error, code, ...extra }, { status, headers: { ...NO_STORE, ...(status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {}) } }) });

/** Motivo + cuando/desde donde terminó la sesión (para el mensaje claro del CLI). */
function endedBody(end: Awaited<ReturnType<typeof getEnd>>) {
    return end ? { reason: end.reason, at: end.endedAt, byKind: end.byKind, byIp: end.byIp, byDevice: end.byUserAgent ? deviceLabel(end.byUserAgent) : null } : {};
}

export async function authenticateCli(req: NextRequest): Promise<CliAuthResult> {
    const ip = getClientIp(req);
    const userAgent = req.headers.get('user-agent');
    const authz = req.headers.get('authorization');

    if (authz !== null) {
        const m = /^Bearer\s+(\S+)$/i.exec(authz.trim());
        if (!m) return reject(401, 'Unauthorized', 'invalid_authorization');
        const v = await verifyCliToken(m[1], { ip, ua: userAgent });
        if (!v.ok) {
            auditLog('admin.cli.token_rejected', { reason: v.reason, ip, path: new URL(req.url).pathname });
            // Un token revocado por una sesion nueva (o cerrado por inactividad) se explica: 401 superseded / expired con cuando y desde donde.
            const end = v.tokenId ? await getEnd(v.tokenId).catch(() => null) : null;
            if (end && end.reason !== 'closed') {
                const code = end.reason === 'superseded' ? 'superseded' : end.reason === 'locked' ? 'locked' : 'expired';
                return reject(401, 'Unauthorized', code, endedBody(end));
            }
            return reject(401, 'Unauthorized', v.reason === 'unavailable' ? 'service_unavailable' : `token_${v.reason}`);
        }
        const rec = v.record;
        const machine = rec.tokenClass === 'machine';
        const instance = ownDomains()[0];
        if (rec.domain && instance && rec.domain.toLowerCase() !== instance.toLowerCase()) {
            auditLog('admin.cli.token_rejected', { reason: 'domain_mismatch', ip, userId: rec.adminId });
            return reject(403, 'Forbidden', 'domain_mismatch');
        }
        const scopes = rec.scopes.filter((s) => (SCOPES as readonly string[]).includes(s)).filter((s) => !machine || s === 'read');
        const session = { source: 'token' as const, scopes, tokenId: rec.id, tokenName: rec.name, expiresAt: rec.expiresAt, domain: rec.domain, levelCap: rec.permissionLevel, tokenClass: rec.tokenClass };

        let actor: ExecAuth['actor'];
        let managerSession: string | null = null;
        if (rec.kind === 'manager') {
            const own = v.managerSession ? await verifyManagerCookieOwnsInstance(v.managerSession).catch(() => ({ ok: false as const, reason: 'backend_unavailable' as const })) : ({ ok: false as const, reason: 'no_session' as const });
            if (!own.ok) {
                auditLog('admin.cli.token_rejected', { reason: `manager_${own.reason}`, ip, userId: rec.adminId });
                return reject(own.reason === 'backend_unavailable' ? 403 : 401, own.reason === 'backend_unavailable' ? 'Forbidden' : 'Unauthorized', `manager_${own.reason}`);
            }
            const level = Math.min(machine ? MACHINE_MAX_LEVEL : 4, rec.permissionLevel) as PermissionLevel; // la manager duena es nivel 4; el token no puede superar su tope
            actor = { kind: 'manager', id: own.managerId ?? rec.adminId, email: own.email ?? rec.adminEmail ?? undefined, level, levelSource: 'manager' };
            managerSession = v.managerSession;
        } else {
            const user = await prisma.user.findUnique({ where: { id: rec.adminId }, select: { id: true, email: true } }).catch(() => null);
            const state = user ? await getUserState(user.id).catch(() => null) : null;
            await refreshPermissions();
            const eff = user ? effectiveLevelSync(user.email) : { level: 0 as PermissionLevel, source: 'none' as const };
            if (!user || !state || state.disabled || eff.level < 1) {
                auditLog('admin.cli.token_rejected', { reason: !user ? 'user_missing' : state?.disabled ? 'user_disabled' : 'not_admin', ip, userId: rec.adminId });
                return reject(403, 'Forbidden', 'not_admin');
            }
            const level = Math.min(eff.level, rec.permissionLevel, machine ? MACHINE_MAX_LEVEL : 4) as PermissionLevel; // tope: nunca mas nivel que la cuenta, ni que el del token
            actor = { kind: 'user', id: user.id, email: user.email, level, levelSource: eff.source };
        }

        // Bloqueo de la cuenta por "pelea de sesiones": vale para TODOS sus tokens (tambien los machine).
        if (await isLocked(rec.adminId, actor.email)) {
            auditLog('admin.cli.token_rejected', { reason: 'account_locked', ip, userId: rec.adminId });
            return reject(403, 'Forbidden', 'locked', { reason: 'locked' });
        }
        // Slot unico de sesion privilegiada (solo tokens interactivos).
        if (!machine) {
            const entered = await enterPrivileged({ userId: rec.adminId, email: actor.email ?? '', level: actor.level, kind: 'cli', ref: rec.id, ip, userAgent });
            if (!entered.ok) {
                const code = entered.reason === 'locked' ? 'locked' : entered.reason === 'superseded' ? 'superseded' : 'expired';
                return reject(entered.reason === 'locked' ? 403 : 401, entered.reason === 'locked' ? 'Forbidden' : 'Unauthorized', code, { reason: entered.reason, ...endedBody(entered.end ?? null) });
            }
        }
        return { ok: true, auth: { actor, session, ip, userAgent, managerSession } };
    }

    // Consola web (cookie)
    if (req.headers.get(CONSOLE_HEADER) !== CONSOLE_HEADER_VALUE) return reject(403, 'Forbidden', 'console_header_required');
    const guard = await requireLevel(1, req); // el nivel de cada comando se comprueba en exec.ts
    if (!guard.ok) return { ok: false, response: guard.response };
    const managerSession = guard.actor.kind === 'manager' ? req.cookies.get('auth_session')?.value ?? null : null;
    return {
        ok: true,
        auth: { actor: guard.actor, session: { source: 'web', scopes: [...SCOPES], domain: ownDomains()[0] ?? null }, ip, userAgent, managerSession },
    };
}

export const noStore = NO_STORE;
