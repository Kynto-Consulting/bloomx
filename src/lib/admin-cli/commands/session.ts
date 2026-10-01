import { CmdError, type CommandDef } from '../types';
import { def, done, iso, kv, L, multi, num, text } from './_h';

/**
 * Sesion privilegiada unica (consola web + CLI interactivo): estado, cierre y politica. Ver lib/privileged-session.ts.
 */
export const sessionCommands: CommandDef[] = [
    def({
        name: 'session show', risk: 'read', summary: L('Tu sesión privilegiada vigente (web o CLI): dónde, desde cuándo y cuándo caduca', 'Your current privileged session (web or CLI): where, since when and when it expires'),
        covers: ['GET /api/admin/privileged-session'],
        handler: async ({ ctx }) => {
            const r = (await ctx.callOk({ method: 'GET', path: '/privileged-session' })).data;
            const a = r.active;
            const mine = a && ctx.session.tokenId && a.refShort === ctx.session.tokenId.slice(0, 8);
            return multi(
                a
                    ? kv([['kind', a.kind === 'cli' ? 'CLI' : 'web console'], ['ip', a.ip ?? '-'], ['device', a.device], ['since', iso(a.since)], ['lastActivity', iso(a.lastSeenAt)], ['idleExpires', iso(a.expiresIdleAt)], ['absoluteExpires', iso(a.expiresAbsoluteAt)], ['this session', ctx.session.source === 'token' ? !!mine : ctx.session.source === 'web' && a.kind === 'web']])
                    : text(ctx.t(L('No hay sesión privilegiada abierta.', 'No privileged session is open.')), 'muted'),
                r.locked ? text(ctx.t(L(`Acceso privilegiado BLOQUEADO desde ${iso(r.locked.at)} (${r.locked.replacements} reemplazos). Un superadmin debe ejecutar "perms unlock".`, `Privileged access LOCKED since ${iso(r.locked.at)} (${r.locked.replacements} replacements). A super admin must run "perms unlock".`)), 'danger') : text(''),
                text(ctx.t(L(`Una sola sesión privilegiada por cuenta (web + CLI). Cierre por ${r.policy.idleMinutes} min de inactividad y tope de ${r.policy.absoluteHours} h.`, `Only one privileged session per account (web + CLI). Closed after ${r.policy.idleMinutes} min idle and capped at ${r.policy.absoluteHours} h.`)), 'muted'),
            );
        },
    }),
    def({
        name: 'session close', risk: 'destructive', summary: L('Cierra tu sesión privilegiada vigente (web o CLI) y libera el slot', 'Close your current privileged session (web or CLI) and free the slot'),
        covers: ['DELETE /api/admin/privileged-session'],
        handler: async ({ ctx }) => {
            const r = (await ctx.callOk({ method: 'DELETE', path: '/privileged-session' })).data;
            return r.closed ? done(ctx, `Sesión privilegiada (${r.kind}) cerrada.`, `Privileged session (${r.kind}) closed.`) : text(ctx.t(L('No había sesión privilegiada abierta.', 'There was no privileged session open.')), 'muted');
        },
    }),
    def({
        name: 'session policy', risk: 'read', summary: L('Política de sesiones privilegiadas de la instancia: inactividad, tope y bloqueo por reemplazos', 'Instance privileged session policy: idle timeout, cap and replacement lockout'),
        handler: async ({ ctx }) => {
            const r = (await ctx.callOk({ method: 'GET', path: '/privileged-session' })).data;
            return kv([['idleMinutes', r.policy.idleMinutes], ['absoluteHours', r.policy.absoluteHours], ['lockThreshold (replacements)', r.policy.lockThreshold], ['lockWindowMinutes', r.policy.lockWindowMinutes]]);
        },
    }),
    def({
        name: 'session policy set', risk: 'security', mfaStepUp: true, summary: L('Cambia la política: inactividad (5-60 min), umbral (2-10) y ventana (1-60 min) del bloqueo por pelea de sesiones', 'Change the policy: idle timeout (5-60 min), threshold (2-10) and window (1-60 min) of the session-fight lockout'),
        flags: [num('idle-minutes', 'Inactividad en minutos (5-60)', 'Idle timeout in minutes (5-60)', { min: 5, max: 60 }), num('lock-threshold', 'Reemplazos que bloquean (2-10)', 'Replacements that lock (2-10)', { min: 2, max: 10 }), num('lock-window', 'Ventana en minutos (1-60)', 'Window in minutes (1-60)', { min: 1, max: 60 })],
        covers: ['PUT /api/admin/privileged-session'],
        handler: async ({ args, ctx }) => {
            const body: Record<string, number> = {};
            if (args.flags['idle-minutes'] !== undefined) body.idleMinutes = args.flags['idle-minutes'] as number;
            if (args.flags['lock-threshold'] !== undefined) body.lockThreshold = args.flags['lock-threshold'] as number;
            if (args.flags['lock-window'] !== undefined) body.lockWindowMinutes = args.flags['lock-window'] as number;
            if (Object.keys(body).length === 0) throw new CmdError('nothing_to_change', 'Pass --idle-minutes, --lock-threshold and/or --lock-window', 2);
            const r = (await ctx.callOk({ method: 'PUT', path: '/privileged-session', body })).data;
            return kv([['idleMinutes', r.policy.idleMinutes], ['lockThreshold', r.policy.lockThreshold], ['lockWindowMinutes', r.policy.lockWindowMinutes]]);
        },
    }),
];
