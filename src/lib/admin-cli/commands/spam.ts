import { CmdError, type CommandDef } from '../types';
import { PAGING, bool, data, def, done, iso, kv, L, multi, num, oneOf, pageNote, pagingQuery, parseInputJson, pos, str, table, INPUT_HINT } from './_h';

/** Spam: configuracion, listas (bloqueo, permitidos, remitentes externos), registro, estadisticas, pruebas y simulacion. */

const KINDS = ['block', 'allow', 'external'] as const;
const KIND_POS = pos('kind', 'block | allow | external', 'block | allow | external', { values: KINDS });
const MATCH = ['email', 'domain', 'address', 'wildcard'] as const;

export const spamCommands: CommandDef[] = [
    def({
        name: 'spam config', risk: 'read', summary: L('Configuración antispam efectiva y presets', 'Effective anti-spam configuration and presets'),
        covers: ['GET /api/admin/spam/config'], handler: async ({ ctx }) => data((await ctx.callOk({ method: 'GET', path: '/spam/config' })).data),
    }),
    def({
        name: 'spam config set', risk: 'write', summary: L('Cambia la configuración antispam (banderas o parche JSON)', 'Change the anti-spam configuration (flags or a JSON patch)'),
        acceptsInput: true,
        flags: [str('level', 'Nivel (ver spam config)', 'Level (see spam config)'), num('threshold', 'Umbral 1..100', 'Threshold 1..100', { min: 1, max: 100 }),
            bool('log-delivered', 'Registrar también lo entregado', 'Also log delivered mail'), num('log-retention-days', 'Días de registro 1..365', 'Log retention days 1..365', { min: 1, max: 365 }),
            bool('allow-user-sensitivity', 'Permitir sensibilidad por usuario', 'Allow per-user sensitivity'), oneOf('external', ['on', 'off'], 'Aviso de remitentes externos', 'External sender banner')],
        covers: ['PUT /api/admin/spam/config'],
        handler: async ({ args, ctx }) => {
            const f = args.flags;
            const body: Record<string, unknown> = ctx.input?.trim() ? (parseInputJson(ctx, INPUT_HINT) as Record<string, unknown>) : {};
            if (f.level !== undefined) body.level = f.level;
            if (f.threshold !== undefined) body.threshold = f.threshold;
            if (f['log-delivered'] !== undefined) body.logDelivered = f['log-delivered'];
            if (f['log-retention-days'] !== undefined) body.logRetentionDays = f['log-retention-days'];
            if (f['allow-user-sensitivity'] !== undefined) body.allowUserSensitivity = f['allow-user-sensitivity'];
            if (f.external !== undefined) body.external = { ...(body.external as object), enabled: f.external === 'on' };
            if (Object.keys(body).length === 0) throw new CmdError('nothing_to_change', 'Nothing to change', 2);
            return data((await ctx.callOk({ method: 'PUT', path: '/spam/config', body })).data);
        },
    }),
    def({
        name: 'spam config reset', risk: 'destructive', summary: L('Restablece la configuración antispam a los valores por defecto', 'Reset the anti-spam configuration to defaults'),
        covers: ['DELETE /api/admin/spam/config'], handler: async ({ ctx }) => data((await ctx.callOk({ method: 'DELETE', path: '/spam/config' })).data),
    }),
    def({
        name: 'spam simulate', risk: 'read', summary: L('Simula un parche de configuración sobre los últimos correos evaluados (no cambia nada)', 'Simulate a config patch on the latest evaluated mail (changes nothing)'),
        acceptsInput: true, flags: [str('level', 'Nivel', 'Level'), num('threshold', 'Umbral', 'Threshold', { min: 1, max: 100 })], covers: ['POST /api/admin/spam/simulate'],
        handler: async ({ args, ctx }) => {
            const config: Record<string, unknown> = ctx.input?.trim() ? (parseInputJson(ctx, INPUT_HINT) as Record<string, unknown>) : {};
            if (args.flags.level) config.level = args.flags.level;
            if (args.flags.threshold) config.threshold = args.flags.threshold;
            return data((await ctx.callOk({ method: 'POST', path: '/spam/simulate', body: { config } })).data);
        },
    }),
    def({
        name: 'spam test', risk: 'read', summary: L('Puntúa un mensaje de prueba por señal (no guarda ni envía nada)', 'Score a test message per signal (stores and sends nothing)'),
        acceptsInput: true, flags: [str('from', 'Remitente', 'From'), str('subject', 'Asunto', 'Subject'), str('text', 'Texto', 'Text'), str('email-id', 'Id de un correo propio', 'Id of one of your own emails')], covers: ['POST /api/admin/spam/test'],
        handler: async ({ args, ctx }) => {
            const f = args.flags;
            const body: Record<string, unknown> = { from: f.from, subject: f.subject, text: f.text ?? (ctx.input?.trim() ? undefined : undefined), emailId: f['email-id'] };
            if (ctx.input?.trim() && !f.text) body.rawHeaders = ctx.input;
            for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
            return data((await ctx.callOk({ method: 'POST', path: '/spam/test', body })).data);
        },
    }),
    def({
        name: 'spam events', risk: 'read', summary: L('Registro de decisiones antispam (sin contenido)', 'Anti-spam decision log (no content)'),
        flags: [str('from', 'Desde (ISO)', 'From (ISO)'), str('to', 'Hasta (ISO)', 'To (ISO)'), str('decision', 'Decisión', 'Decision'), str('sender-domain', 'Dominio del remitente (filtro)', 'Sender domain (filter)'), num('page', 'Página', 'Page', { min: 1 }), num('page-size', 'Filas (máx 200)', 'Rows (max 200)', { min: 1, max: 200 })],
        covers: ['GET /api/admin/spam/events'],
        handler: async ({ args, ctx }) => {
            const f = args.flags;
            const r = (await ctx.callOk({ method: 'GET', path: '/spam/events', query: { from: f.from as string, to: f.to as string, decision: f.decision as string, domain: f['sender-domain'] as string, page: f.page as number, pageSize: f['page-size'] as number } })).data;
            return table(['createdAt', 'decision', 'score', 'sender', 'recipient', 'rule'], (r.rows as any[]).map((e) => ({ createdAt: iso(e.createdAt), decision: e.decision, score: e.score, sender: e.sender ?? e.from, recipient: e.recipient, rule: e.rule })), { total: r.total });
        },
    }),
    def({
        name: 'spam stats', risk: 'read', summary: L('Estadísticas antispam por día y dominios principales', 'Anti-spam statistics per day and top domains'),
        flags: [num('days', 'Días (1..365)', 'Days (1..365)', { min: 1, max: 365 })], covers: ['GET /api/admin/spam/stats'],
        handler: async ({ args, ctx }) => data((await ctx.callOk({ method: 'GET', path: '/spam/stats', query: { days: args.flags.days as number } })).data),
    }),
    def({
        name: 'spam list', risk: 'read', summary: L('Lista una lista del dominio: bloqueo, permitidos o remitentes externos', 'List a domain list: blocklist, allowlist or external senders'),
        positionals: [KIND_POS], flags: [str('q', 'Texto', 'Text'), str('match-type', 'Tipo de coincidencia', 'Match type'), str('status', 'Estado', 'Status'), str('sort', 'Orden', 'Sort'), ...PAGING], covers: ['GET /api/admin/spam/lists/[kind]'],
        handler: async ({ args, ctx }) => {
            const r = (await ctx.callOk({ method: 'GET', path: `/spam/lists/${args.positionals[0]}`, query: { q: args.flags.q as string, matchType: args.flags['match-type'] as string, status: args.flags.status as string, sort: args.flags.sort as string, ...pagingQuery(args.flags) } })).data;
            return table(['id', 'matchType', 'value', 'includeSubdomains', 'reason', 'expiresAt'], r.rows, { total: r.total });
        },
    }),
    def({
        name: 'spam list add', risk: 'write', summary: L('Añade una entrada a una lista del dominio', 'Add an entry to a domain list'),
        positionals: [KIND_POS, pos('value', 'Correo, dominio o patrón', 'Email, domain or pattern')],
        flags: [str('match-type', 'email | domain | ...', 'email | domain | ...'), bool('subdomains', 'Incluir subdominios', 'Include subdomains'), str('reason', 'Motivo', 'Reason'), str('expires', 'Caduca (ISO)', 'Expires (ISO)')],
        covers: ['POST /api/admin/spam/lists/[kind]'],
        handler: async ({ args, ctx }) => {
            const value = args.positionals[1];
            const matchType = (args.flags['match-type'] as string | undefined) ?? (value.includes('@') ? 'email' : 'domain');
            const r = (await ctx.callOk({ method: 'POST', path: `/spam/lists/${args.positionals[0]}`, body: { entries: [{ matchType, value, includeSubdomains: args.flags.subdomains, reason: args.flags.reason, expiresAt: args.flags.expires }] } })).data;
            return kv([['added', r.added], ['duplicates', r.duplicates], ['invalid', (r.invalid ?? []).length], ['limitReached', r.limitReached]]);
        },
    }),
    def({
        name: 'spam list remove', risk: 'destructive', summary: L('Quita entradas por id, o toda la lista con --all', 'Remove entries by id, or the whole list with --all'),
        positionals: [KIND_POS, pos('id', 'Ids de entradas', 'Entry ids', { required: false, variadic: true })], flags: [bool('all', 'Vaciar la lista completa', 'Clear the whole list')], covers: ['DELETE /api/admin/spam/lists/[kind]'],
        handler: async ({ args, ctx }) => {
            const ids = args.positionals.slice(1);
            if (!args.flags.all && ids.length === 0) throw new CmdError('missing_argument', 'Pass entry ids or --all', 2);
            const r = (await ctx.callOk({ method: 'DELETE', path: `/spam/lists/${args.positionals[0]}`, body: args.flags.all ? { all: true, confirm: true } : { ids } })).data;
            return kv([['deleted', r.deleted]]);
        },
    }),
    def({
        name: 'spam list import', risk: 'write', summary: L('Importa una lista desde CSV (por --stdin / --file)', 'Import a list from CSV (via --stdin / --file)'),
        positionals: [KIND_POS], acceptsInput: true, covers: ['POST /api/admin/spam/lists/[kind]/import'],
        handler: async ({ args, ctx }) => {
            if (!ctx.input?.trim()) throw new CmdError('input_required', ctx.t(L('Falta el CSV (--stdin en la web, --file o pipe en la CLI).', 'CSV missing (--stdin on the web, --file or a pipe in the CLI).')), 2);
            const r = (await ctx.callOk({ method: 'POST', path: `/spam/lists/${args.positionals[0]}/import`, body: { csv: ctx.input } })).data;
            return multi(kv([['added', r.added], ['duplicates', r.duplicates], ['invalid', r.invalid], ['limitReached', r.limitReached]]), table(['line', 'error'], r.errors ?? []));
        },
    }),
    def({
        name: 'spam list export', risk: 'read', summary: L('Exporta una lista a CSV', 'Export a list to CSV'),
        positionals: [KIND_POS], covers: ['GET /api/admin/spam/lists/[kind]/export'],
        handler: async ({ args, ctx }) => {
            const r = await ctx.callOk({ method: 'GET', path: `/spam/lists/${args.positionals[0]}/export` });
            return { type: 'csv', filename: `spam-${args.positionals[0]}-${new Date().toISOString().slice(0, 10)}.csv`, text: (r.text ?? '').replace(/^﻿/, '') };
        },
    }),
];

void done; void MATCH;
