import { CmdError, type CommandDef } from '../types';
import { PAGING, bool, data, def, done, iso, kv, L, multi, num, oneOf, pageNote, pagingQuery, pos, str, table, text, requireManager, instanceDomainId } from './_h';

/** Estado del sistema, correo, auditoria, retencion/almacenamiento, seguridad y claves de firma. */

const RANGES = ['24h', '7d', '30d'] as const;
const AUDIT_FLAGS = [
    str('event', 'Evento (prefijo con * al final)', 'Event (trailing * for prefix)'),
    str('user', 'Id de usuario', 'User id'),
    str('from', 'Desde (ISO)', 'From (ISO)'),
    str('to', 'Hasta (ISO)', 'To (ISO)'),
    str('q', 'Texto libre', 'Free text'),
];
const auditQuery = (f: Record<string, unknown>) => ({ event: f.event as string, user: f.user as string, from: f.from as string, to: f.to as string, q: f.q as string });

/** Claves permitidas de `config get`: nunca secretos; los que existen como secreto solo dicen si estan definidos. */
async function configEntries(): Promise<Array<{ key: string; value: string | number | boolean; kind: 'value' | 'secret-presence' }>> {
    const { ownDomains, loadDomainPrivateKey } = await import('@/lib/backend-auth');
    const { adminEmails } = await import('@/lib/mfa');
    const { getSessionAbsoluteMaxSeconds, getSessionTtlSeconds } = await import('@/lib/jwt');
    const host = (u?: string) => { try { return u ? new URL(u).host : ''; } catch { return ''; } };
    const env = process.env;
    const present = (v?: string) => !!v;
    return [
        { key: 'instance.domain', value: ownDomains()[0] ?? '', kind: 'value' },
        { key: 'instance.appHost', value: host(env.NEXT_PUBLIC_APP_URL), kind: 'value' },
        { key: 'backend.host', value: host(env.NEXT_PUBLIC_BACKEND_URL) || 'backend.bloomx.arubik.dev', kind: 'value' },
        { key: 'admin.emails.count', value: adminEmails().length, kind: 'value' },
        { key: 'mfa.enforceAdmin', value: env.MFA_ENFORCE_ADMIN !== 'false', kind: 'value' },
        { key: 'session.ttlSeconds', value: getSessionTtlSeconds(), kind: 'value' },
        { key: 'session.absoluteMaxSeconds', value: getSessionAbsoluteMaxSeconds(), kind: 'value' },
        { key: 'audit.persistence', value: env.AUDIT_DB !== 'off', kind: 'value' },
        { key: 'audit.retentionDays', value: Number(env.AUDIT_RETENTION_DAYS) || 0, kind: 'value' },
        { key: 'rateLimit.backend', value: env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN ? 'redis' : 'memory', kind: 'value' },
        { key: 'signing.configured', value: loadDomainPrivateKey() !== null, kind: 'secret-presence' },
        { key: 'encryption.dedicatedKey', value: present(env.DATA_ENCRYPTION_KEY), kind: 'secret-presence' },
        { key: 'mail.resendConfigured', value: present(env.RESEND_API_KEY), kind: 'secret-presence' },
        { key: 'mail.webhookSecretConfigured', value: present(env.RESEND_WEBHOOK_SECRET), kind: 'secret-presence' },
        { key: 'cron.secretConfigured', value: present(env.CRON_SECRET), kind: 'secret-presence' },
        { key: 'cli.tokenMaxDays', value: 30, kind: 'value' },
        { key: 'cli.tokenDefaultHours', value: 12, kind: 'value' },
    ];
}

export const platformCommands: CommandDef[] = [
    def({
        name: 'overview', risk: 'read', summary: L('Resumen de la instancia (usuarios, correo, almacenamiento)', 'Instance overview (users, mail, storage)'),
        covers: ['GET /api/admin/overview'],
        handler: async ({ ctx }) => {
            const r = (await ctx.callOk({ method: 'GET', path: '/overview' })).data;
            return multi(
                kv([['users', r.users.total], ['active30d', r.users.active30d], ['disabled', r.users.disabled], ['new7d', r.users.new7d]], 'users'),
                kv([['sent24h', r.mail.sent24h], ['received24h', r.mail.received24h], ['bounces7d', r.mail.bounces7d], ['complaints7d', r.mail.complaints7d], ['scheduled', r.mail.scheduledPending]], 'mail'),
                kv([['attachments', r.storage.attachmentCount], ['attachmentBytes', r.storage.attachmentBytes], ['emails', r.storage.emailCount], ['extensionErrors24h', r.extensions.errors24h], ['adminMfa', `${r.adminMfa.withMfa}/${r.adminMfa.total}`]], 'platform'),
            );
        },
    }),
    def({
        name: 'system status', risk: 'read', summary: L('Salud del sistema: base de datos, backend, límite de tasa', 'System health: database, backend, rate limiter'),
        covers: ['GET /api/admin/system'],
        handler: async ({ ctx }) => {
            const r = (await ctx.callOk({ method: 'GET', path: '/system' })).data;
            const tone = r.status === 'ok' ? 'success' : r.status === 'degraded' ? 'warning' : 'danger';
            return kv([
                ['status', r.status, tone], ['database', `${r.db.ok ? 'ok' : 'down'} (${r.db.ms} ms)`, r.db.ok ? 'success' : 'danger'],
                ['backend', `${r.backend.ok ? 'ok' : 'down'} (${r.backend.ms} ms)`, r.backend.ok ? 'success' : 'warning'],
                ['rateLimit', r.rateLimit], ['legacyUnsigned', r.legacy, r.legacy ? 'warning' : undefined], ['checkedAt', iso(r.checkedAt)],
            ]);
        },
    }),
    def({
        name: 'system version', risk: 'read', summary: L('Versión de la aplicación y del entorno', 'Application and runtime version'),
        handler: async ({ ctx }) => {
            const pkg = (await import('../../../../package.json')).default as { name: string; version: string };
            const sha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || '';
            const { ownDomains } = await import('@/lib/backend-auth');
            return kv([
                ['app', `${pkg.name} ${pkg.version}`], ['commit', sha ? sha.slice(0, 12) : '-'], ['node', process.version],
                ['environment', process.env.VERCEL_ENV || process.env.NODE_ENV || '-'], ['region', process.env.VERCEL_REGION || '-'], ['instance', ownDomains()[0] ?? '-'], ['cli', ctx.t(L('motor de comandos v1', 'command engine v1'))],
            ]);
        },
    }),
    def({
        name: 'system schema', risk: 'read', summary: L('Estado del esquema de la base de datos (tablas esperadas vs. presentes)', 'Database schema state (expected vs. present tables)'),
        handler: async () => {
            const { expectedSchemaTables } = await import('@/lib/db/schema');
            const { query } = await import('@/lib/admin/sql');
            const rows = await query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`);
            const have = new Set(rows.map((r) => r.table_name.toLowerCase()));
            const expected = expectedSchemaTables();
            const missing = expected.filter((t) => !have.has(t.toLowerCase()));
            return multi(
                kv([['expectedTables', expected.length], ['present', expected.length - missing.length], ['missing', missing.length, missing.length ? 'danger' : 'success']]),
                missing.length ? { type: 'list', title: 'missing (run: npm run db:ensure)', items: missing } : text('schema ok', 'success'),
            );
        },
    }),
    def({
        name: 'system queues', risk: 'read', summary: L('Colas: correos programados y trabajos de importar/exportar', 'Queues: scheduled mail and import/export jobs'),
        covers: [],
        handler: async ({ ctx }) => {
            const { getScheduledQueue } = await import('@/lib/admin/mail-store');
            const q = await getScheduledQueue();
            const jobs = await ctx.call({ method: 'GET', path: '/mail-transfer/jobs' });
            const list: any[] = Array.isArray(jobs.data?.jobs) ? jobs.data.jobs : [];
            const count = (s: string) => list.filter((j) => j.status === s).length;
            return multi(
                kv([['scheduledPending', q.pending], ['scheduledOverdue', q.overdue, q.overdue ? 'warning' : undefined], ['oldest', iso(q.oldest)]], 'mail'),
                kv([['running', count('running')], ['queued', count('queued')], ['failed', count('failed')], ['total', list.length]], 'transfer jobs'),
            );
        },
    }),
    def({
        name: 'config list', risk: 'read', summary: L('Claves de configuración visibles (lista blanca; los secretos solo indican si existen)', 'Visible configuration keys (allow-list; secrets only report presence)'),
        covers: [],
        handler: async () => table(['key', 'value', 'kind'], (await configEntries()).map((e) => ({ key: e.key, value: e.kind === 'secret-presence' ? (e.value ? 'set' : 'unset') : e.value, kind: e.kind }))),
    }),
    def({
        name: 'config get', risk: 'read', summary: L('Valor de una clave de configuración permitida', 'Value of an allowed configuration key'),
        positionals: [pos('key', 'Clave (ver config list)', 'Key (see config list)')],
        handler: async ({ args }) => {
            const e = (await configEntries()).find((x) => x.key === args.positionals[0]);
            if (!e) throw new CmdError('unknown_key', 'unknown_key: use `config list`', 1, 404);
            return kv([[e.key, e.kind === 'secret-presence' ? (e.value ? 'set' : 'unset') : e.value]]);
        },
    }),

    // ---- Correo ----
    def({
        name: 'mail metrics', risk: 'read', summary: L('Métricas agregadas de correo', 'Aggregated mail metrics'),
        flags: [oneOf('range', RANGES, 'Rango', 'Range')], covers: ['GET /api/admin/mail/metrics'],
        handler: async ({ args, ctx }) => {
            const r = (await ctx.callOk({ method: 'GET', path: '/mail/metrics', query: { range: args.flags.range as string } })).data;
            return multi(
                kv(Object.entries(r.totals as Record<string, number>).map(([k, v]) => [k, v] as [string, number]), `${r.range} (${r.domain ?? '-'})`),
                table(['bucket', 'sent', 'received', 'bounces', 'complaints', 'spam', 'blocked'], r.series),
                table(['email', 'sentLastHour', 'limit', 'percent'], r.quota.topLastHour, { caption: 'top senders (last hour)' }),
            );
        },
    }),
    def({
        name: 'mail dns', risk: 'read', summary: L('Salud DNS del dominio: SPF, DKIM, DMARC, MX', 'Domain DNS health: SPF, DKIM, DMARC, MX'),
        flags: [str('selector', 'Selector DKIM', 'DKIM selector'), bool('fresh', 'Saltar la cache', 'Bypass the cache')], covers: ['GET /api/admin/mail/dns'],
        handler: async ({ args, ctx }) => data((await ctx.callOk({ method: 'GET', path: '/mail/dns', query: { selector: args.flags.selector as string, fresh: args.flags.fresh ? '1' : undefined } })).data),
    }),
    def({
        name: 'mail webhooks', risk: 'read', summary: L('Estado de los webhooks del proveedor de correo (sin secretos)', 'Mail provider webhook status (no secrets)'),
        covers: ['GET /api/admin/mail/webhooks'], handler: async ({ ctx }) => data((await ctx.callOk({ method: 'GET', path: '/mail/webhooks' })).data),
    }),
    def({
        name: 'mail queue', risk: 'read', summary: L('Cola de correos programados', 'Scheduled mail queue'),
        handler: async () => { const { getScheduledQueue } = await import('@/lib/admin/mail-store'); const q = await getScheduledQueue(); return kv([['pending', q.pending], ['overdue', q.overdue], ['oldest', iso(q.oldest)]]); },
    }),
    def({
        name: 'mail config', risk: 'read', summary: L('Configuración de correo: cuotas, límites de envío, webhooks, DNS', 'Mail configuration: quotas, send limits, webhooks, DNS'),
        handler: async ({ ctx }) => {
            const [quota, hooks, dns] = await Promise.all([
                ctx.callOk({ method: 'GET', path: '/retention/quota' }), ctx.callOk({ method: 'GET', path: '/mail/webhooks' }), ctx.callOk({ method: 'GET', path: '/mail/dns' }),
            ]);
            const { MAX_SENDS_PER_HOUR } = await import('@/lib/admin/mail-store');
            return multi(kv([['sendsPerHourPerUser', MAX_SENDS_PER_HOUR], ['quotaMb', quota.data.effectiveMb ?? 'unlimited'], ['quotaSource', quota.data.source], ['enforceQuota', quota.data.enforceMailQuota]], 'limits'), data({ webhooks: hooks.data, dns: dns.data }));
        },
    }),
    def({
        name: 'mail suppressions', risk: 'read', summary: L('Lista de supresiones (bajas, rebotes, quejas)', 'Suppression list (unsubscribes, bounces, complaints)'),
        flags: [str('q', 'Texto', 'Text'), oneOf('reason', ['unsubscribe', 'bounce', 'complaint'], 'Motivo', 'Reason'), ...PAGING], covers: ['GET /api/admin/mail/suppressions'],
        handler: async ({ args, ctx }) => {
            const r = (await ctx.callOk({ method: 'GET', path: '/mail/suppressions', query: { q: args.flags.q as string, reason: args.flags.reason as string, ...pagingQuery(args.flags) } })).data;
            return table(['id', 'recipient', 'reason', 'createdAt', 'senderEmail'], r.items, pageNote(r));
        },
    }),
    def({
        name: 'mail suppressions remove', risk: 'destructive', summary: L('Quita una o varias supresiones (máx. 100)', 'Remove one or more suppressions (max 100)'),
        positionals: [pos('id', 'Id(s) de supresión', 'Suppression id(s)', { variadic: true })], covers: ['DELETE /api/admin/mail/suppressions/[id]', 'POST /api/admin/mail/suppressions/bulk-delete'],
        handler: async ({ args, ctx }) => {
            const ids = args.positionals;
            const r = ids.length === 1
                ? await ctx.callOk({ method: 'DELETE', path: `/mail/suppressions/${encodeURIComponent(ids[0])}` })
                : await ctx.callOk({ method: 'POST', path: '/mail/suppressions/bulk-delete', body: { ids } });
            return kv([['removed', r.data.removed]]);
        },
    }),

    // ---- Auditoria ----
    def({
        name: 'audit', risk: 'read', summary: L('Consulta la auditoría (enmascarada) con filtros', 'Query the (masked) audit log with filters'),
        flags: [...AUDIT_FLAGS, ...PAGING, num('limit', 'Atajo de --page-size', 'Shortcut for --page-size', { min: 1, max: 100 })], covers: ['GET /api/admin/audit'],
        examples: ['audit --event "admin.users.*" --from 2026-01-01', 'audit --q login --json'],
        handler: async ({ args, ctx }) => {
            const r = (await ctx.callOk({ method: 'GET', path: '/audit', query: { ...auditQuery(args.flags), ...pagingQuery(args.flags), ...(args.flags.limit ? { pageSize: args.flags.limit as number } : {}) } })).data;
            if (!r.available) return text(ctx.t(L('La auditoría persistente no está disponible (falta la tabla).', 'Persistent audit is not available (table missing).')), 'warning');
            return table(['ts', 'event', 'userId', 'ip', 'data'], (r.items as any[]).map((e) => ({ ts: iso(e.ts), event: e.event, userId: e.userId, ip: e.ip, data: JSON.stringify(e.data) })), { total: r.total });
        },
    }),
    def({
        name: 'audit export', risk: 'read', summary: L('Exporta la auditoría a CSV (hasta 10 000 filas)', 'Export the audit log to CSV (up to 10,000 rows)'),
        flags: AUDIT_FLAGS, covers: ['GET /api/admin/audit/export'],
        handler: async ({ args, ctx }) => {
            const r = await ctx.callOk({ method: 'GET', path: '/audit/export', query: auditQuery(args.flags) });
            return { type: 'csv', filename: `audit-${new Date().toISOString().slice(0, 10)}.csv`, text: (r.text ?? '').replace(/^﻿/, '') };
        },
    }),
    def({
        name: 'audit events', risk: 'read', summary: L('Tipos de evento recientes (para filtrar)', 'Recent event types (to filter on)'),
        handler: async ({ ctx }) => {
            const r = (await ctx.callOk({ method: 'GET', path: '/audit', query: { pageSize: 1 } })).data;
            return { type: 'list', items: r.eventTypes ?? [] };
        },
    }),

    // ---- Retencion / almacenamiento / cuotas ----
    def({
        name: 'retention show', risk: 'read', summary: L('Políticas de retención efectivas', 'Effective retention policies'),
        covers: ['GET /api/admin/retention/settings'], handler: async ({ ctx }) => data((await ctx.callOk({ method: 'GET', path: '/retention/settings' })).data),
    }),
    def({
        name: 'retention set', risk: 'write', summary: L('Cambia retenciones en días ("null" vuelve al valor del entorno)', 'Change retention in days ("null" falls back to the environment value)'),
        flags: [str('spam-days', 'Dias en spam (n | null)', 'Days in spam (n | null)'), str('trash-days', 'Dias en papelera (n | null)', 'Days in trash (n | null)'), str('audit-days', 'Dias de auditoria, 0 o >= 30 (n | null)', 'Audit days, 0 or >= 30 (n | null)'),
            str('raw-days', 'Dias del correo en bruto (n | null)', 'Raw mail days (n | null)'), str('secure-days', 'Dias de mensajes sellados (n | null)', 'Sealed message days (n | null)'), str('batch', 'Tamano de lote 1..1000 (n | null)', 'Batch size 1..1000 (n | null)')],
        covers: ['PUT /api/admin/retention/settings'],
        handler: async ({ args, ctx }) => {
            const conv = (v: unknown) => (v === 'null' ? null : Number(v));
            const body: Record<string, unknown> = {};
            const map: Record<string, string> = { 'spam-days': 'spamDays', 'trash-days': 'trashDays', 'audit-days': 'auditDays', 'raw-days': 'rawDays', 'secure-days': 'secureMessageDays', batch: 'batch' };
            for (const [flag, key] of Object.entries(map)) if (args.flags[flag] !== undefined) body[key] = conv(args.flags[flag]);
            if (Object.keys(body).length === 0) throw new CmdError('nothing_to_change', 'Nothing to change: pass --spam-days, --trash-days, --audit-days, --raw-days, --secure-days or --batch', 2);
            return data((await ctx.callOk({ method: 'PUT', path: '/retention/settings', body })).data);
        },
    }),
    def({
        name: 'retention storage', risk: 'read', summary: L('Uso de almacenamiento y lo que se purgaría hoy', 'Storage usage and what would be purged today'),
        covers: ['GET /api/admin/retention/storage'], handler: async ({ ctx }) => data((await ctx.callOk({ method: 'GET', path: '/retention/storage' })).data),
    }),
    def({
        name: 'retention run', risk: 'destructive', summary: L('Ejecuta la purga de retención (por defecto simulacro; --apply borra de verdad)', 'Run the retention purge (dry run by default; --apply really deletes)'),
        flags: [bool('apply', 'Aplicar de verdad (borra datos)', 'Apply for real (deletes data)')], covers: ['POST /api/admin/retention/run'],
        handler: async ({ args, ctx }) => data((await ctx.callOk({ method: 'POST', path: '/retention/run', body: { dryRun: args.flags.apply !== true } })).data),
    }),
    def({
        name: 'quota show', risk: 'read', summary: L('Cuota por usuario del dominio', 'Domain per-user quota'),
        covers: ['GET /api/admin/retention/quota'], handler: async ({ ctx }) => data((await ctx.callOk({ method: 'GET', path: '/retention/quota' })).data),
    }),
    def({
        name: 'quota set', risk: 'write', summary: L('Fija la cuota del dominio (MB, 0 = sin límite, "null" = entorno) y el bloqueo de envío al 100 %', 'Set the domain quota (MB, 0 = unlimited, "null" = environment) and block-at-100% sending'),
        flags: [str('mb', 'MB | null', 'MB | null'), str('enforce', 'true | false | null', 'true | false | null')], covers: ['PUT /api/admin/retention/quota'],
        handler: async ({ args, ctx }) => {
            const body: Record<string, unknown> = {};
            if (args.flags.mb !== undefined) body.mailQuotaMb = args.flags.mb === 'null' ? null : Number(args.flags.mb);
            if (args.flags.enforce !== undefined) body.enforceMailQuota = args.flags.enforce === 'null' ? null : args.flags.enforce === 'true';
            if (Object.keys(body).length === 0) throw new CmdError('nothing_to_change', 'Pass --mb and/or --enforce', 2);
            return data((await ctx.callOk({ method: 'PUT', path: '/retention/quota', body })).data);
        },
    }),

    // ---- Seguridad ----
    def({
        name: 'security status', risk: 'read', summary: L('Estado de seguridad y hardening de la instancia', 'Instance security and hardening status'),
        flags: [oneOf('group', ['admins', 'session', 'config', 'events'], 'Grupo de comprobaciones', 'Check group'), bool('failing', 'Solo avisos y fallos', 'Only warnings and failures')],
        covers: ['GET /api/admin/security/status'],
        handler: async ({ args, ctx }) => {
            const r = (await ctx.callOk({ method: 'GET', path: '/security/status' })).data;
            let checks = r.checks as any[];
            if (args.flags.group) checks = checks.filter((c) => c.group === args.flags.group);
            if (args.flags.failing) checks = checks.filter((c) => c.status === 'warn' || c.status === 'fail');
            return multi(table(['status', 'group', 'code', 'params'], checks.map((c) => ({ status: c.status, group: c.group, code: c.code, params: c.params ? JSON.stringify(c.params) : '' }))), kv([['mfaEnforceAdmin', r.mfaPolicy.enforceAdmin], ['sessionTtlSeconds', r.session.ttlSeconds], ['sessionAbsoluteMaxSeconds', r.session.absoluteMaxSeconds], ['rateLimit', r.config.rateLimitBackend], ['domainSigning', r.config.domainSigning]], 'policy'));
        },
    }),
    def({
        name: 'security admins', risk: 'read', summary: L('Administradores y estado de su MFA', 'Administrators and their MFA state'),
        handler: async ({ ctx }) => { const r = (await ctx.callOk({ method: 'GET', path: '/security/status' })).data; return table(['email', 'mfaEnabled', 'userId'], r.admins); },
    }),
    def({
        name: 'security events', risk: 'read', summary: L('Eventos de seguridad recientes (inicios fallidos, accesos denegados)', 'Recent security events (failed logins, denied access)'),
        handler: async ({ ctx }) => {
            const r = (await ctx.callOk({ method: 'GET', path: '/security/status' })).data;
            return multi(kv(Object.entries(r.events.last24h as Record<string, number>).map(([k, v]) => [k, v] as [string, number]), 'last 24h'), table(['ts', 'event', 'userId', 'ip', 'reason'], (r.events.recent as any[]).map((e) => ({ ...e, ts: iso(e.ts) }))));
        },
    }),
    def({
        name: 'security policies', risk: 'read', summary: L('Políticas vigentes: MFA, sesión, límites de tasa y de tokens de CLI', 'Active policies: MFA, session, rate limits and CLI tokens'),
        handler: async () => {
            const e = await configEntries();
            const g = (k: string) => e.find((x) => x.key === k)?.value;
            return kv([['mfa.enforceAdmin', g('mfa.enforceAdmin')], ['session.ttlSeconds', g('session.ttlSeconds')], ['session.absoluteMaxSeconds', g('session.absoluteMaxSeconds')],
                ['rateLimit.backend', g('rateLimit.backend')], ['password.minLength', 12], ['cli.tokenDefaultHours', 12], ['cli.tokenMaxDays', 30], ['cli.stepUpWindowMinutes', 10], ['cli.maxActiveTokensPerAdmin', 10]]);
        },
    }),
    def({
        name: 'security keys', risk: 'read', summary: L('Estado de la clave de firma del dominio (solo manager)', 'Domain signing key state (manager only)'),
        managerOnly: true, covers: ['GET /api/admin/domain-key'],
        handler: async ({ ctx }) => { requireManager(ctx); return data((await ctx.callOk({ method: 'GET', path: '/domain-key', query: { domainId: await instanceDomainId() } })).data); },
    }),
    def({
        name: 'security keys register', risk: 'security', summary: L('Registra o rota la clave PÚBLICA de firma Ed25519 (nunca una privada)', 'Register or rotate the Ed25519 PUBLIC signing key (never a private one)'),
        managerOnly: true, acceptsInput: true, flags: [str('public-key', 'Clave pública PEM (o usa --stdin / --file)', 'Public key PEM (or use --stdin / --file)', { secret: true })], covers: ['POST /api/admin/domain-key'],
        handler: async ({ args, ctx }) => {
            requireManager(ctx);
            const key = (args.flags['public-key'] as string | undefined) ?? ctx.input;
            if (!key?.trim()) throw new CmdError('input_required', 'Provide the PEM with --public-key, --stdin or --file', 2);
            return data((await ctx.callOk({ method: 'POST', path: '/domain-key', body: { domainId: await instanceDomainId(), signingPublicKey: key } })).data);
        },
    }),
    def({
        name: 'security keys require-signature', risk: 'security', summary: L('Activa o desactiva "exigir firma" (on | off)', 'Turn "require signature" on or off (on | off)'),
        managerOnly: true, positionals: [pos('state', 'on | off', 'on | off', { values: ['on', 'off'] })], covers: [],
        handler: async ({ args, ctx }) => { requireManager(ctx); return data((await ctx.callOk({ method: 'POST', path: '/domain-key', body: { domainId: await instanceDomainId(), requireSignature: args.positionals[0] === 'on' } })).data); },
    }),
];

void done;
