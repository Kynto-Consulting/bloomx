import { CmdError, type CmdContext, type CommandDef, type Scope } from '../types';
import { bool, data, def, done, iso, kv, L, multi, num, pos, str, table, text, USER_POS, resolveUserId, list } from './_h';
import { MAX_ACTIVE_TOKENS_PER_ADMIN, clampTtlHours, createCliToken, listCliTokens, normalizeScopes, revokeAllCliTokens, revokeCliToken, scopeAllows, scopesAllowedForLevel } from '../tokens';
import { LEVEL_DOCS } from '@/lib/admin-levels';
import { levelName } from '@/lib/permissions-core';

/** Identidad, dominio activo, tokens de CLI, trabajos y perfil. (`help` vive en help.ts: necesita el catalogo completo.) */

const adminKey = (ctx: CmdContext): string => {
    const k = ctx.actor.id || ctx.actor.email;
    if (!k) throw new CmdError('no_admin_identity', 'no_admin_identity', 1, 403);
    return k;
};

const tokenRow = (t: Awaited<ReturnType<typeof listCliTokens>>[number], current?: string | null) => ({
    id: t.id.slice(0, 8), name: t.name + (current && t.id === current ? ' (current)' : ''), class: t.tokenClass, level: t.permissionLevel, scopes: t.scopes.join(','), expires: iso(t.expiresAt), lastUsed: iso(t.lastUsedAt), lastIp: t.lastUsedIp, created: iso(t.createdAt),
});

const levelTable = () => table(['permission_level', 'name', 'can'], ([0, 1, 2, 3, 4] as const).map((l) => ({ permission_level: l, name: LEVEL_DOCS[l].es.name, can: LEVEL_DOCS[l].es.can })));
void levelTable;

export const coreCommands: CommandDef[] = [
    def({
        name: 'whoami', risk: 'read', summary: L('Cuenta, rol, dominio de la instancia y ámbitos de la sesión o token', 'Account, role, instance domain and session/token scopes'),
        covers: ['GET /api/admin/me'],
        handler: async ({ ctx }) => {
            const me = (await ctx.callOk({ method: 'GET', path: '/me' })).data.me;
            const s = ctx.session;
            return kv([
                ['account', me.email ?? '-'], ['role', me.kind === 'manager' ? 'manager (domain owner)' : 'app admin'], ['permission_level', `${me.permission_level} · ${levelName(me.permission_level)} (${me.levelSource})`], ['domain', me.instanceDomain ?? '-'],
                ['via', s.source === 'token' ? `token ${s.tokenName ?? ''}`.trim() : 'web session'], ['scopes', s.scopes.join(', ')], ['expires', s.expiresAt ? iso(s.expiresAt) : 'session'],
            ]);
        },
    }),
    def({
        name: 'domains', risk: 'read', summary: L('Dominios de la cuenta y cuál administra esta instancia', 'Domains of the account and which one this instance manages'),
        handler: async ({ ctx }) => {
            const { ownDomains } = await import('@/lib/backend-auth');
            const instance = ownDomains()[0] ?? '';
            if (ctx.actor.kind !== 'manager') return table(['domain', 'instance', 'via'], [{ domain: instance, instance: true, via: 'ADMIN_EMAILS' }]);
            const r = await ctx.backend('/api/manager/domains');
            const { isInstanceOwned } = await import('@/lib/manager-auth');
            const owned: string[] = Array.isArray(r.data?.domains) ? r.data.domains.map((d: any) => String(d?.name ?? '').split(':')[0].toLowerCase()).filter(Boolean) : [];
            const set = new Set(owned);
            return table(['domain', 'instance', 'via'], (owned.length ? owned : [instance]).map((d) => ({ domain: d, instance: isInstanceOwned([d], set) && ownDomains().some((o) => o.toLowerCase() === d || o.toLowerCase().endsWith(`.${d}`)), via: 'manager' })));
        },
    }),
    def({
        name: 'use', risk: 'read', summary: L('Comprueba que un dominio es el de esta sesión (la CLI cambia de perfil localmente)', 'Check a domain is this session\'s (the CLI switches profile locally)'),
        positionals: [pos('domain', 'Dominio', 'Domain')],
        handler: async ({ args, ctx }) => {
            const { ownDomains } = await import('@/lib/backend-auth');
            const want = args.positionals[0].trim().toLowerCase();
            const ok = ownDomains().some((d) => d.toLowerCase() === want);
            if (!ok) throw new CmdError('domain_mismatch', ctx.t(L(`Esta sesión solo opera sobre ${ownDomains()[0] ?? 'su dominio'}. Inicia sesión en la instancia de ${want}.`, `This session only operates on ${ownDomains()[0] ?? 'its domain'}. Log in to the ${want} instance.`)), 1, 403);
            return text(ctx.t(L(`Dominio activo: ${want}`, `Active domain: ${want}`)), 'success');
        },
    }),
    def({
        name: 'profile', risk: 'read', summary: L('Perfil del administrador actual (identidad, MFA, sesiones activas)', 'Current administrator profile (identity, MFA, active sessions)'),
        handler: async ({ ctx }) => {
            if (ctx.actor.kind === 'manager') return kv([['kind', 'manager'], ['email', ctx.actor.email ?? '-'], ['note', ctx.t(L('MFA, contraseña y sesiones de un manager viven en el backend compartido.', 'A manager\'s MFA, password and sessions live on the shared backend.'))]]);
            const r = (await ctx.callOk({ method: 'GET', path: `/users/${encodeURIComponent(ctx.actor.id!)}` })).data;
            return kv([['email', r.user.email], ['name', r.user.name], ['mfa', r.mfa.enabled ? 'enabled' : 'off'], ['recoveryCodesLeft', r.mfa.recoveryCodesLeft], ['activeSessions', (r.sessions as unknown[]).length], ['lastLogin', iso(r.state?.lastLoginAt)]]);
        },
    }),
    def({
        name: 'tokens list', risk: 'read', summary: L('Tus tokens de CLI activos (nunca se muestra el valor)', 'Your active CLI tokens (the value is never shown)'),
        flags: [bool('all', 'Incluir caducados y revocados', 'Include expired and revoked')],
        handler: async ({ args, ctx }) => {
            const rows = await listCliTokens(adminKey(ctx), { includeInactive: args.flags.all === true });
            return table(['id', 'name', 'class', 'level', 'scopes', 'expires', 'lastUsed', 'lastIp', 'created'], rows.map((t) => tokenRow(t, ctx.session.tokenId)));
        },
    }),
    def({
        name: 'tokens create', risk: 'security', mfaStepUp: true, summary: L('Crea un token de CLI (se muestra UNA vez; defecto 12 h, máx. 30 d)', 'Create a CLI token (shown ONCE; default 12 h, max 30 d)'),
        flags: [bool('machine', 'Token de automatización (cron/CI): solo lectura, 24 h por defecto (máx. 7 d), nivel <= 3, NO ocupa la sesión privilegiada', 'Automation token (cron/CI): read-only, 24 h by default (max 7 d), level <= 3, does NOT take the privileged session slot'), str('name', 'Nombre del token', 'Token name', { required: true }), list('scopes', 'Ámbitos: read,write,security (defecto read)', 'Scopes: read,write,security (default read)'), num('ttl', 'Horas de vida (interactivo 0.1 .. 720; machine hasta 168)', 'Lifetime in hours (interactive 0.1 .. 720; machine up to 168)', { min: 0.05, max: 720 })],
        handler: async ({ args, ctx }) => {
            const machine = args.flags.machine === true;
            const scopes: Scope[] = machine ? ['read'] : normalizeScopes(args.flags.scopes);
            for (const s of scopes) if (!scopesAllowedForLevel(ctx.actor.level).includes(s)) throw new CmdError('scope_exceeds_level', ctx.t(L(`Tu nivel (${ctx.actor.level}) no permite el ámbito "${s}" en un token.`, `Your level (${ctx.actor.level}) does not allow the "${s}" scope on a token.`)), 1, 403);
            for (const s of scopes) if (!scopeAllows(ctx.session.scopes, s)) throw new CmdError('scope_exceeds_session', ctx.t(L(`Tu sesión no tiene el ámbito "${s}", no puede emitir un token con él.`, `Your session lacks the "${s}" scope, so it cannot mint a token with it.`)), 1, 403);
            const { ownDomains } = await import('@/lib/backend-auth');
            const { token, record } = await createCliToken({
                kind: ctx.actor.kind, adminId: adminKey(ctx), adminEmail: ctx.actor.email ?? null, name: String(args.flags.name), scopes,
                ttlHours: clampTtlHours(args.flags.ttl, machine ? 'machine' : 'interactive'), tokenClass: machine ? 'machine' : 'interactive', ip: ctx.ip, domain: ownDomains()[0] ?? null, permissionLevel: ctx.actor.level,
                managerSession: ctx.actor.kind === 'manager' ? ctx.managerSession ?? null : null,
            });
            return kv([['token', token, 'warning'], ['id', record.id.slice(0, 8)], ['scopes', record.scopes.join(',')], ['class', record.tokenClass], ['permission_level cap', record.permissionLevel], ['expires', iso(record.expiresAt)]], ctx.t(L('Guárdalo ahora: no se vuelve a mostrar.', 'Store it now: it will not be shown again.')));
        },
    }),
    def({
        name: 'tokens revoke', risk: 'destructive', summary: L('Revoca uno de tus tokens por id (o prefijo de 6+ caracteres)', 'Revoke one of your tokens by id (or a 6+ character prefix)'),
        positionals: [pos('id', 'Id del token', 'Token id')],
        handler: async ({ args, ctx }) => {
            const r = await revokeCliToken(adminKey(ctx), args.positionals[0]);
            if (!r) throw new CmdError('token_not_found', ctx.t(L('Token no encontrado (o el prefijo no es único).', 'Token not found (or the prefix is ambiguous).')), 1, 404);
            return done(ctx, `Token "${r.name}" revocado.`, `Token "${r.name}" revoked.`);
        },
    }),
    def({
        name: 'tokens revoke-all', risk: 'destructive', summary: L('Revoca todos tus tokens (menos el actual con --keep-current)', 'Revoke all your tokens (except the current one with --keep-current)'),
        flags: [bool('keep-current', 'Conservar el token que ejecuta el comando', 'Keep the token running this command')],
        handler: async ({ args, ctx }) => {
            const n = await revokeAllCliTokens(adminKey(ctx), args.flags['keep-current'] ? ctx.session.tokenId : null);
            return done(ctx, `${n} token(s) revocado(s).`, `${n} token(s) revoked.`);
        },
    }),
    def({
        name: 'jobs', risk: 'read', summary: L('Trabajos por lotes: importar/exportar correo (MailTransferJob)', 'Batch jobs: mail import/export (MailTransferJob)'),
        handler: async ({ ctx }) => {
            const r = (await ctx.callOk({ method: 'GET', path: '/mail-transfer/jobs' })).data;
            return table(['id', 'kind', 'status', 'file', 'createdAt'], (r.jobs as any[]).map((j) => ({ id: j.id, kind: j.kind, status: j.status, file: j.fileName, createdAt: iso(j.createdAt) })));
        },
    }),
    def({
        name: 'jobs show', risk: 'read', summary: L('Estado de un trabajo', 'Status of a job'), positionals: [pos('job', 'Id del trabajo', 'Job id')],
        handler: async ({ args, ctx }) => data((await ctx.callOk({ method: 'GET', path: `/mail-transfer/jobs/${encodeURIComponent(args.positionals[0])}` })).data),
    }),
    def({
        name: 'jobs watch', risk: 'read', summary: L('Sigue un trabajo hasta que termine (el cliente repite la consulta cada 2 s)', 'Follow a job until it finishes (the client polls every 2 s)'),
        positionals: [pos('job', 'Id del trabajo', 'Job id')],
        handler: async ({ args, ctx }) => {
            const r = (await ctx.callOk({ method: 'GET', path: `/mail-transfer/jobs/${encodeURIComponent(args.positionals[0])}` })).data;
            const job = r.job ?? r;
            const terminal = ['done', 'failed', 'cancelled', 'expired', 'completed'].includes(String(job.status));
            return { type: 'json', data: { watch: true, terminal, job } };
        },
    }),
    def({
        name: 'jobs rules', risk: 'read', summary: L('Lotes de "aplicar reglas a existentes" de un usuario (con deshacer)', 'A user\'s "apply rules to existing" batches (undoable)'),
        positionals: [USER_POS],
        handler: async ({ args, ctx }) => {
            const id = await resolveUserId(ctx, args.positionals[0]);
            await ctx.callOk({ method: 'GET', path: `/users/${encodeURIComponent(id)}` });
            const { query, tolerant } = await import('@/lib/admin/sql');
            const rows = await tolerant(() => query<any>(`SELECT "id","ruleId","status","processed","changed","createdAt","undoneAt" FROM "RuleBatch" WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 50`, id), []);
            return table(['id', 'ruleId', 'status', 'processed', 'changed', 'createdAt', 'undoneAt'], rows.map((r) => ({ ...r, createdAt: iso(r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt), undoneAt: r.undoneAt ? iso(r.undoneAt instanceof Date ? r.undoneAt.toISOString() : r.undoneAt) : '' })));
        },
    }),
    def({
        name: 'limits', risk: 'read', summary: L('Límites del motor: línea, salida, tiempo, tasa, tokens', 'Engine limits: line, output, time, rate, tokens'),
        handler: async () => {
            const { LIMITS } = await import('../exec');
            return kv([['maxLineBytes', LIMITS.maxLineBytes], ['maxOutputBytes', LIMITS.maxOutputBytes], ['syncTimeoutMs', LIMITS.timeoutMs], ['commandsPerMinute', LIMITS.perMinute], ['maxActiveTokens', MAX_ACTIVE_TOKENS_PER_ADMIN], ['maxInputBytes', LIMITS.maxInputBytes]]);
        },
    }),
];

void multi;
