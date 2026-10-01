import { CmdError, type CommandDef } from '../types';
import { PAGING, USER_POS, bool, def, done, iso, kv, L, list, multi, num, oneOf, pageNote, pagingQuery, pos, resolveUserId, str, table, text, data } from './_h';

/** Usuarios, sesiones, cuotas, MFA, contrasenas, cuentas vinculadas y datos del usuario (reglas/etiquetas en solo lectura). */

const SORTS = ['createdAt', 'email', 'name', 'lastLogin', 'storage'] as const;

const userQuery = (f: Record<string, unknown>) => ({
    q: f.q as string | undefined, status: f.status as string | undefined, role: f.role as string | undefined, mfa: f.mfa as string | undefined,
    google: f.google as string | undefined, sort: f.sort as string | undefined, dir: f.dir as string | undefined,
});
const USER_FILTER_FLAGS = [
    str('q', 'Texto en correo o nombre', 'Text in email or name'),
    oneOf('status', ['active', 'disabled'], 'Estado', 'Status'),
    oneOf('role', ['admin', 'user'], 'Rol', 'Role'),
    oneOf('mfa', ['yes', 'no'], 'Con MFA', 'Has MFA'),
    oneOf('google', ['yes', 'no'], 'Con Google vinculado', 'Google linked'),
    oneOf('sort', SORTS, 'Orden', 'Sort field'),
    oneOf('dir', ['asc', 'desc'], 'Direccion', 'Direction'),
];

export const usersCommands: CommandDef[] = [
    def({
        name: 'users list', risk: 'read', summary: L('Lista usuarios con filtros', 'List users with filters'),
        flags: [...USER_FILTER_FLAGS, ...PAGING], covers: ['GET /api/admin/users'],
        examples: ['users list --status disabled', 'users list --q ana --json'],
        handler: async ({ args, ctx }) => {
            const r = await ctx.callOk({ method: 'GET', path: '/users', query: { ...userQuery(args.flags), ...pagingQuery(args.flags) } });
            return table(
                ['email', 'name', 'status', 'role', 'mfa', 'quota', 'lastLogin', 'id'],
                (r.data.users as any[]).map((u) => ({
                    id: u.id, email: u.email, name: u.name, status: u.disabled ? 'disabled' : 'active', role: u.isAdmin ? 'admin' : 'user',
                    mfa: u.mfaEnabled, quota: u.quotaMb === null ? '-' : `${u.quotaMb} MB`, lastLogin: iso(u.lastLoginAt),
                })),
                pageNote(r.data.page),
            );
        },
    }),
    def({
        name: 'users show', risk: 'read', summary: L('Detalle de un usuario (estado, MFA, cuentas, sesiones, cuota)', 'User detail (state, MFA, accounts, sessions, quota)'),
        positionals: [USER_POS], covers: ['GET /api/admin/users/[id]'],
        handler: async ({ args, ctx }) => {
            const id = await resolveUserId(ctx, args.positionals[0]);
            const r = (await ctx.callOk({ method: 'GET', path: `/users/${encodeURIComponent(id)}` })).data;
            return multi(
                kv([
                    ['id', r.user.id], ['email', r.user.email], ['name', r.user.name], ['admin', r.user.isAdmin], ['permission_level', `${r.user.permission_level} · ${r.user.levelName} (${r.user.levelSource})`], ['disabled', r.state?.disabled, r.state?.disabled ? 'danger' : undefined],
                    ['mustChangePassword', r.state?.mustChangePassword], ['lastLogin', iso(r.state?.lastLoginAt)],
                    ['mfa', r.mfa?.enabled ? 'enabled' : 'off', r.mfa?.enabled ? 'success' : 'warning'], ['recoveryCodesLeft', r.mfa?.recoveryCodesLeft],
                    ['quota', r.quota ? `${r.quota.effectiveMb ?? '-'} MB (${r.quota.source})` : '-'],
                    ['storage', r.storage ? JSON.stringify(r.storage) : '-'],
                ]),
                table(['provider', 'status', 'scopes'], (r.accounts as any[]).map((a) => ({ provider: a.provider, status: a.status, scopes: Array.isArray(a.scopes) ? a.scopes.length : '' })), { caption: 'accounts' }),
                table(['jti', 'ip', 'mfa', 'createdAt', 'expiresAt'], (r.sessions as any[]).map((s) => ({ jti: s.jti, ip: s.ip, mfa: s.mfa, createdAt: iso(s.createdAt), expiresAt: iso(s.expiresAt) })), { caption: 'sessions' }),
            );
        },
    }),
    def({
        name: 'users create', risk: 'security', summary: L('Crea un usuario (si no hay contrasena se genera una temporal, se muestra una vez)', 'Create a user (a temporary password is generated if none is given, shown once)'),
        positionals: [pos('email', 'Correo del nuevo usuario', 'New user email')],
        flags: [str('name', 'Nombre', 'Display name'), str('password', 'Contrasena (12+); mejor omitirla', 'Password (12+); better omitted', { secret: true }), bool('must-change', 'Obligar a cambiarla al entrar', 'Force a change at next login')],
        covers: ['POST /api/admin/users'],
        handler: async ({ args, ctx }) => {
            const r = (await ctx.callOk({
                method: 'POST', path: '/users',
                body: { email: args.positionals[0], name: args.flags.name, password: args.flags.password, mustChangePassword: args.flags['must-change'] },
            })).data;
            return kv([['id', r.user.id], ['email', r.user.email], ['mustChangePassword', r.mustChangePassword], ...(r.temporaryPassword ? [['temporaryPassword', r.temporaryPassword, 'warning'] as [string, string, 'warning']] : [])],
                ctx.t(L('Usuario creado. La contraseña temporal solo se muestra ahora.', 'User created. The temporary password is shown only now.')));
        },
    }),
    def({
        name: 'users rename', risk: 'write', summary: L('Cambia el nombre de un usuario', 'Rename a user'),
        positionals: [USER_POS, pos('name', 'Nuevo nombre', 'New name')], covers: ['PATCH /api/admin/users/[id]'],
        handler: async ({ args, ctx }) => {
            const id = await resolveUserId(ctx, args.positionals[0]);
            await ctx.callOk({ method: 'PATCH', path: `/users/${encodeURIComponent(id)}`, body: { name: args.positionals[1] } });
            return done(ctx, 'Nombre actualizado.', 'Name updated.');
        },
    }),
    def({
        name: 'users disable', risk: 'destructive', summary: L('Deshabilita un usuario y cierra sus sesiones', 'Disable a user and sign them out'),
        positionals: [USER_POS], covers: [],
        handler: async ({ args, ctx }) => {
            const id = await resolveUserId(ctx, args.positionals[0]);
            await ctx.callOk({ method: 'PATCH', path: `/users/${encodeURIComponent(id)}`, body: { disabled: true } });
            return done(ctx, 'Usuario deshabilitado.', 'User disabled.');
        },
    }),
    def({
        name: 'users enable', risk: 'write', summary: L('Habilita un usuario', 'Enable a user'),
        positionals: [USER_POS], covers: [],
        handler: async ({ args, ctx }) => {
            const id = await resolveUserId(ctx, args.positionals[0]);
            await ctx.callOk({ method: 'PATCH', path: `/users/${encodeURIComponent(id)}`, body: { disabled: false } });
            return done(ctx, 'Usuario habilitado.', 'User enabled.');
        },
    }),
    def({
        name: 'users bulk', risk: 'destructive', summary: L('Acción masiva (hasta 100): disable, enable o revoke-sessions', 'Bulk action (up to 100): disable, enable or revoke-sessions'),
        positionals: [pos('action', 'disable | enable | revoke-sessions', 'disable | enable | revoke-sessions', { values: ['disable', 'enable', 'revoke-sessions'] }), pos('users', 'Ids o correos', 'Ids or emails', { variadic: true, complete: 'user' })],
        covers: ['POST /api/admin/users/bulk'],
        handler: async ({ args, ctx }) => {
            const [action, ...refs] = args.positionals;
            if (refs.length === 0) throw new CmdError('missing_argument', 'Missing <users>', 2);
            const ids = await Promise.all(refs.map((r) => resolveUserId(ctx, r)));
            const r = (await ctx.callOk({ method: 'POST', path: '/users/bulk', body: { ids, action: action === 'revoke-sessions' ? 'revokeSessions' : action } })).data;
            return multi(table(['id', 'result'], r.results), kv(Object.entries(r.summary as Record<string, number>).map(([k, v]) => [k, v] as [string, number])));
        },
    }),
    def({
        name: 'users export', risk: 'read', summary: L('Exporta usuarios a CSV (mismos filtros que la lista)', 'Export users to CSV (same filters as the list)'),
        flags: USER_FILTER_FLAGS, covers: ['GET /api/admin/users/export'],
        handler: async ({ args, ctx }) => {
            const r = await ctx.callOk({ method: 'GET', path: '/users/export', query: userQuery(args.flags) });
            return { type: 'csv', filename: `users-${new Date().toISOString().slice(0, 10)}.csv`, text: (r.text ?? '').replace(/^﻿/, '') };
        },
    }),
    def({
        name: 'users sessions', risk: 'read', summary: L('Lista las sesiones activas de un usuario', 'List a user\'s active sessions'),
        positionals: [USER_POS], covers: [],
        handler: async ({ args, ctx }) => {
            const id = await resolveUserId(ctx, args.positionals[0]);
            const r = (await ctx.callOk({ method: 'GET', path: `/users/${encodeURIComponent(id)}` })).data;
            return table(['jti', 'ip', 'mfa', 'createdAt', 'expiresAt'], (r.sessions as any[]).map((s) => ({ jti: s.jti, ip: s.ip, mfa: s.mfa, createdAt: iso(s.createdAt), expiresAt: iso(s.expiresAt) })));
        },
    }),
    def({
        name: 'users sessions revoke', risk: 'destructive', summary: L('Cierra TODAS las sesiones de un usuario, o una con --jti', 'Sign out all of a user\'s sessions, or one with --jti'),
        positionals: [USER_POS], flags: [str('jti', 'Id de una sesion concreta', 'A single session id')],
        covers: ['DELETE /api/admin/users/[id]/sessions', 'DELETE /api/admin/users/[id]/sessions/[jti]'],
        handler: async ({ args, ctx }) => {
            const id = await resolveUserId(ctx, args.positionals[0]);
            const jti = args.flags.jti as string | undefined;
            await ctx.callOk({ method: 'DELETE', path: jti ? `/users/${encodeURIComponent(id)}/sessions/${encodeURIComponent(jti)}` : `/users/${encodeURIComponent(id)}/sessions` });
            return done(ctx, jti ? 'Sesión revocada.' : 'Sesiones revocadas.', jti ? 'Session revoked.' : 'Sessions revoked.');
        },
    }),
    def({
        name: 'users mfa-reset', risk: 'security', summary: L('Restablece el MFA de un usuario y cierra sus sesiones', 'Reset a user\'s MFA and sign them out'),
        positionals: [USER_POS], covers: ['POST /api/admin/users/[id]/mfa-reset'],
        handler: async ({ args, ctx }) => {
            const id = await resolveUserId(ctx, args.positionals[0]);
            await ctx.callOk({ method: 'POST', path: `/users/${encodeURIComponent(id)}/mfa-reset` });
            return done(ctx, 'MFA restablecido.', 'MFA reset.');
        },
    }),
    def({
        name: 'users password-reset', risk: 'security', summary: L('Genera una contraseña temporal (se muestra una vez) y cierra sesiones', 'Generate a temporary password (shown once) and sign the user out'),
        positionals: [USER_POS], covers: ['POST /api/admin/users/[id]/password'],
        handler: async ({ args, ctx }) => {
            const id = await resolveUserId(ctx, args.positionals[0]);
            const r = (await ctx.callOk({ method: 'POST', path: `/users/${encodeURIComponent(id)}/password`, body: { mode: 'temporary' } })).data;
            return kv([['temporaryPassword', r.temporaryPassword, 'warning'], ['mustChangePassword', r.mustChangePassword]], ctx.t(L('Entrégala por un canal seguro; no se vuelve a mostrar.', 'Hand it over through a secure channel; it will not be shown again.')));
        },
    }),
    def({
        name: 'users force-password-change', risk: 'security', summary: L('Obliga a cambiar la contraseña en el próximo acceso', 'Require a password change at next login'),
        positionals: [USER_POS], flags: [bool('revoke-sessions', 'Cerrar también las sesiones', 'Also sign the user out')],
        covers: ['POST /api/admin/users/[id]/force-password-change'],
        handler: async ({ args, ctx }) => {
            const id = await resolveUserId(ctx, args.positionals[0]);
            await ctx.callOk({ method: 'POST', path: `/users/${encodeURIComponent(id)}/force-password-change`, body: { revokeSessions: args.flags['revoke-sessions'] === true } });
            return done(ctx, 'Cambio de contraseña requerido.', 'Password change required.');
        },
    }),
    def({
        name: 'users quota', risk: 'read', summary: L('Cuota efectiva de un usuario y su origen', 'A user\'s effective quota and its source'),
        positionals: [USER_POS], covers: ['GET /api/admin/users/[id]/quota'],
        handler: async ({ args, ctx }) => {
            const id = await resolveUserId(ctx, args.positionals[0]);
            return data((await ctx.callOk({ method: 'GET', path: `/users/${encodeURIComponent(id)}/quota` })).data);
        },
    }),
    def({
        name: 'users quota set', risk: 'write', summary: L('Fija la cuota de un usuario en MB (0 = sin límite); --reset vuelve a la del dominio', 'Set a user\'s quota in MB (0 = unlimited); --reset falls back to the domain quota'),
        positionals: [USER_POS, pos('mb', 'Megabytes', 'Megabytes', { required: false, type: 'number' })], flags: [bool('reset', 'Quitar la cuota propia', 'Remove the user quota')],
        covers: ['PUT /api/admin/users/[id]/quota'],
        handler: async ({ args, ctx }) => {
            const id = await resolveUserId(ctx, args.positionals[0]);
            const reset = args.flags.reset === true;
            if (!reset && args.positionals[1] === undefined) throw new CmdError('missing_argument', 'Missing <mb> or --reset', 2);
            const r = await ctx.callOk({ method: 'PUT', path: `/users/${encodeURIComponent(id)}/quota`, body: { mailQuotaMb: reset ? null : Number(args.positionals[1]) } });
            return data(r.data);
        },
    }),
    def({
        name: 'users rules', risk: 'read', summary: L('Reglas de correo de un usuario (solo lectura, sin contenido)', 'A user\'s mail rules (read only, no mail content)'),
        positionals: [USER_POS],
        handler: async ({ args, ctx }) => {
            const id = await resolveUserId(ctx, args.positionals[0]);
            await ctx.callOk({ method: 'GET', path: `/users/${encodeURIComponent(id)}` }); // 404 si no existe
            const { loadRules } = await import('@/lib/rules/store');
            const rules = await loadRules(id);
            return table(['name', 'enabled', 'priority', 'matched', 'id'], rules.map((r: any) => ({ id: r.id, name: r.name, enabled: r.enabled, priority: r.priority, matched: r.matchedCount ?? 0 })));
        },
    }),
    def({
        name: 'users labels', risk: 'read', summary: L('Etiquetas de un usuario (solo lectura)', 'A user\'s labels (read only)'),
        positionals: [USER_POS],
        handler: async ({ args, ctx }) => {
            const id = await resolveUserId(ctx, args.positionals[0]);
            await ctx.callOk({ method: 'GET', path: `/users/${encodeURIComponent(id)}` });
            const { listLabels } = await import('@/lib/labels/store');
            const labels = await listLabels(id);
            return table(['path', 'behavior', 'color', 'id'], (labels as any[]).map((l) => ({ id: l.id, path: l.fullPath ?? l.name, behavior: l.behavior ?? 'tag', color: l.color })));
        },
    }),
    def({
        name: 'accounts list', risk: 'read', summary: L('Lista cuentas OAuth vinculadas (sin tokens)', 'List linked OAuth accounts (no tokens)'),
        flags: [str('q', 'Texto', 'Text'), str('provider', 'Proveedor (google, zoom...)', 'Provider'), str('status', 'Estado', 'Status'), ...PAGING], covers: ['GET /api/admin/accounts'],
        handler: async ({ args, ctx }) => {
            const r = await ctx.callOk({ method: 'GET', path: '/accounts', query: { q: args.flags.q as string, provider: args.flags.provider as string, status: args.flags.status as string, ...pagingQuery(args.flags) } });
            return table(['id', 'provider', 'user', 'status', 'expires'], (r.data.accounts as any[]).map((a) => ({ id: a.id, provider: a.provider, user: a.userEmail ?? a.email ?? a.userId, status: a.status, expires: iso(a.expiresAt) })), pageNote(r.data.page));
        },
    }),
    def({
        name: 'accounts unlink', risk: 'destructive', summary: L('Desvincula una cuenta OAuth', 'Unlink an OAuth account'),
        positionals: [pos('id', 'Id de la cuenta vinculada', 'Linked account id')], covers: ['DELETE /api/admin/accounts/[id]'],
        handler: async ({ args, ctx }) => {
            await ctx.callOk({ method: 'DELETE', path: `/accounts/${encodeURIComponent(args.positionals[0])}` });
            return done(ctx, 'Cuenta desvinculada.', 'Account unlinked.');
        },
    }),
    def({
        name: 'accounts reconnect', risk: 'write', summary: L('Pide al usuario reconectar (o refrescar) una cuenta', 'Ask the user to reconnect (or refresh) an account'),
        positionals: [pos('id', 'Id de la cuenta vinculada', 'Linked account id')], flags: [oneOf('mode', ['reconnect', 'refresh'], 'Modo', 'Mode')],
        covers: ['POST /api/admin/accounts/[id]/reconnect'],
        handler: async ({ args, ctx }) => {
            await ctx.callOk({ method: 'POST', path: `/accounts/${encodeURIComponent(args.positionals[0])}/reconnect`, body: { mode: args.flags.mode ?? 'reconnect' } });
            return done(ctx, 'Reconexión solicitada.', 'Reconnect requested.');
        },
    }),
    def({
        name: 'search', risk: 'read', summary: L('Busca usuarios por correo o nombre (máx. 8)', 'Search users by email or name (max 8)'),
        positionals: [pos('query', 'Texto (2+ caracteres)', 'Text (2+ chars)')], covers: ['GET /api/admin/search'],
        handler: async ({ args, ctx }) => {
            const r = await ctx.callOk({ method: 'GET', path: '/search', query: { q: args.positionals[0] } });
            return table(['id', 'email', 'name'], r.data.users);
        },
    }),
];

void text; void list; void num;
