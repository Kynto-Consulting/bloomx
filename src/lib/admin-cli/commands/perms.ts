import { CmdError, type CommandDef } from '../types';
import { LEVEL_DOCS } from '@/lib/admin-levels';
import { bool, def, iso, kv, L, multi, num, pos, str, table, text } from './_h';

/**
 * Niveles de permisos (permission_level 0..4). Los cambios pasan por la ruta REAL POST /api/admin/permissions (mismas reglas,
 * auditoria y avisos que la vista "Permisos" de la consola) y exigen step-up con codigo MFA.
 */

const levelRows = (loc: 'es' | 'en') => ([0, 1, 2, 3, 4] as const).map((l) => ({ permission_level: l, name: LEVEL_DOCS[l][loc].name, can: LEVEL_DOCS[l][loc].can }));

export const permsCommands: CommandDef[] = [
    def({
        name: 'perms levels', risk: 'read', summary: L('Escala de permission_level 0..4 y lo que permite cada nivel', 'The permission_level 0..4 scale and what each level allows'),
        handler: async ({ ctx }) => table(['permission_level', 'name', 'can'], levelRows(ctx.locale)),
    }),
    def({
        name: 'perms list', risk: 'read', summary: L('Cuentas con permission_level >= 1: nivel, origen (entorno/consola), quién lo concedió y cuándo', 'Accounts with permission_level >= 1: level, source (environment/console), who granted it and when'),
        covers: ['GET /api/admin/permissions'],
        handler: async ({ ctx }) => {
            const r = (await ctx.callOk({ method: 'GET', path: '/permissions' })).data;
            const rows = (r.accounts as any[]).map((a) => ({
                email: a.email, permission_level: a.level, name: a.levelName, source: a.source === 'env' ? 'env (fixed)' : 'console', grantedBy: a.grantedBy ?? '-', grantedAt: iso(a.grantedAt), mfa: a.mfaEnabled, locked: a.locked, note: a.note ?? '',
            }));
            return multi(
                table(['email', 'permission_level', 'name', 'source', 'grantedBy', 'grantedAt', 'mfa', 'locked', 'note'], rows),
                kv([['you', `${r.me.permission_level} (${r.me.levelSource})`], ['locked (ADMIN_EMAILS_LOCKED)', r.locked, r.locked ? 'warning' : undefined], ['max accounts with level >= 3', r.limits.maxPrivilegedAccounts]]),
            );
        },
    }),
    def({
        name: 'perms set', risk: 'security', mfaStepUp: true, summary: L('Asigna el permission_level (0-4) de una cuenta. Solo niveles menores al propio; el 4 exige --confirm-super; step-up con código MFA', 'Set an account\'s permission_level (0-4). Only levels lower than your own; level 4 needs --confirm-super; step-up with an MFA code'),
        positionals: [pos('email', 'Correo de la cuenta', 'Account email'), pos('permission_level', 'Nivel 0..4', 'Level 0..4', { type: 'number' })],
        flags: [str('note', 'Nota (máx. 300 caracteres)', 'Note (max 300 chars)'), bool('confirm-super', 'Confirma conceder el nivel 4 (superadmin)', 'Confirm granting level 4 (super admin)')],
        covers: ['POST /api/admin/permissions'],
        examples: ['perms set ana@example.com 2 --note "helpdesk"', 'perms set cto@example.com 4 --confirm-super --yes'],
        handler: async ({ args, ctx }) => {
            const level = Number(args.positionals[1]);
            if (!Number.isInteger(level) || level < 0 || level > 4) throw new CmdError('invalid_level', 'permission_level must be an integer 0..4', 2);
            const r = (await ctx.callOk({ method: 'POST', path: '/permissions', body: { email: args.positionals[0], permission_level: level, note: args.flags.note, confirmSuper: args.flags['confirm-super'] === true } })).data;
            return text(ctx.t(L(`${r.email}: nivel ${r.from} → ${r.to}.`, `${r.email}: level ${r.from} → ${r.to}.`)), 'success');
        },
    }),
    def({
        name: 'perms unlock', risk: 'security', mfaStepUp: true, summary: L('Desbloquea el acceso privilegiado de una cuenta bloqueada por pelea de sesiones (solo superadmin; step-up MFA)', 'Unlock the privileged access of an account locked by a session fight (super admin only; MFA step-up)'),
        positionals: [pos('email', 'Correo de la cuenta bloqueada', 'Locked account email')], covers: ['POST /api/admin/permissions/unlock'],
        handler: async ({ args, ctx }) => {
            const r = (await ctx.callOk({ method: 'POST', path: '/permissions/unlock', body: { email: args.positionals[0] } })).data;
            return r.unlocked ? text(ctx.t(L('Cuenta desbloqueada.', 'Account unlocked.')), 'success') : text(ctx.t(L('La cuenta no estaba bloqueada.', 'The account was not locked.')), 'muted');
        },
    }),
    def({
        name: 'perms history', risk: 'read', summary: L('Historial de cambios de nivel (quién, a quién, anterior → nuevo, IP)', 'Level change history (who, whom, previous → new, IP)'),
        flags: [str('email', 'Filtrar por cuenta', 'Filter by account'), num('limit', 'Filas (máx. 200)', 'Rows (max 200)', { min: 1, max: 200 })], covers: ['GET /api/admin/permissions/history'],
        handler: async ({ args, ctx }) => {
            const r = (await ctx.callOk({ method: 'GET', path: '/permissions/history', query: { email: args.flags.email as string, limit: args.flags.limit as number } })).data;
            return table(['changedAt', 'email', 'change', 'changedBy', 'byLevel', 'ip', 'source', 'note'], (r.history as any[]).map((h) => ({ changedAt: iso(h.changedAt), email: h.email, change: `${h.previousLevel} → ${h.newLevel}`, changedBy: h.changedBy, byLevel: h.changedByLevel, ip: h.ip, source: h.source, note: h.note ?? '' })));
        },
    }),
];
