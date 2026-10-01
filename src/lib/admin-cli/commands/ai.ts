import { CmdError, type CmdContext, type CommandDef } from '../types';
import { AI_FEATURES, AI_PROVIDERS, GUARDRAIL_MODES } from '@/lib/ai/types';
import { bool, def, done, iso, kv, L, multi, num, pos, str, table } from './_h';

/** IA de la instancia (/admin/ai): estado, uso, pruebas y ajustes. La clave API es write-only y NUNCA se muestra ni se audita. */

const FIELDS_HELP = L(
    'Campo: model | features.<funcion> | limits.<maxOutputTokens|maxInputChars|maxTemperature|timeoutMs> | quotas.<perUser|global>.<requestsDay|requestsMonth|tokensDay|tokensMonth> | retention | guardrails.<redaction|blockedTopics|output|bodyPolicy>.mode',
    'Field: model | features.<feature> | limits.<maxOutputTokens|maxInputChars|maxTemperature|timeoutMs> | quotas.<perUser|global>.<requestsDay|requestsMonth|tokensDay|tokensMonth> | retention | guardrails.<redaction|blockedTopics|output|bodyPolicy>.mode',
);

const LIMIT_KEYS = ['maxOutputTokens', 'maxInputChars', 'maxTemperature', 'timeoutMs'];
const QUOTA_KEYS = ['requestsDay', 'requestsMonth', 'tokensDay', 'tokensMonth'];

function bad(ctx: CmdContext, es: string, en: string): never {
    throw new CmdError('invalid_input', ctx.t(L(es, en)), 2);
}

/** `ai set <campo> <valor>` -> parche de ajustes NO critico. provider/baseUrl/apiKey/enabled tienen su propio comando (nivel 4). */
export function buildSetPatch(ctx: CmdContext, field: string, raw: string): Record<string, unknown> {
    const parts = field.split('.');
    const numeric = (): number => {
        const n = Number(raw);
        if (raw.trim() === '' || !Number.isFinite(n)) bad(ctx, `Valor numérico inválido para ${field}.`, `Invalid numeric value for ${field}.`);
        return n;
    };
    const onOff = (): boolean => {
        if (raw === 'on' || raw === 'true') return true;
        if (raw === 'off' || raw === 'false') return false;
        return bad(ctx, 'Usa on | off.', 'Use on | off.');
    };
    if (['provider', 'baseUrl', 'base-url', 'apiKey', 'enabled'].includes(field)) {
        bad(ctx, 'Es un campo crítico (nivel 4 + step-up): usa "ai connection set", "ai key set", "ai enable" o "ai disable".', 'This is a critical field (level 4 + step-up): use "ai connection set", "ai key set", "ai enable" or "ai disable".');
    }
    if (field === 'model') return { model: raw === '' || raw === 'null' ? null : raw };
    if (field === 'retention') return { config: { retentionDays: numeric() } };
    if (parts[0] === 'features' && parts.length === 2 && (AI_FEATURES as readonly string[]).includes(parts[1])) return { config: { features: { [parts[1]]: onOff() } } };
    if (parts[0] === 'limits' && parts.length === 2 && LIMIT_KEYS.includes(parts[1])) return { config: { limits: { [parts[1]]: numeric() } } };
    if (parts[0] === 'quotas' && parts.length === 3 && ['perUser', 'global'].includes(parts[1]) && QUOTA_KEYS.includes(parts[2])) return { config: { quotas: { [parts[1]]: { [parts[2]]: numeric() } } } };
    if (parts[0] === 'guardrails' && parts.length === 3 && parts[2] === 'mode' && ['redaction', 'blockedTopics', 'output', 'bodyPolicy'].includes(parts[1])) {
        const allowed: readonly string[] = parts[1] === 'bodyPolicy' ? ['full', 'subject-only', 'snippet'] : GUARDRAIL_MODES;
        if (!allowed.includes(raw)) bad(ctx, `Modo inválido (${allowed.join(' | ')}).`, `Invalid mode (${allowed.join(' | ')}).`);
        return { config: { guardrails: { [parts[1]]: { mode: raw } } } };
    }
    return bad(ctx, `Campo desconocido "${field.slice(0, 60)}". ${FIELDS_HELP.es}`, `Unknown field "${field.slice(0, 60)}". ${FIELDS_HELP.en}`);
}

async function put(ctx: CmdContext, patch: Record<string, unknown>) {
    return (await ctx.callOk({ method: 'PUT', path: '/ai/settings', body: patch })).data;
}

function viewKv(v: any) {
    return kv([
        ['source', v.source], ['enabled', v.enabled, v.enabled ? 'success' : 'warning'], ['configured', v.configured, v.configured ? 'success' : 'warning'],
        ['provider', v.provider ?? '-'], ['model', v.model ?? '-'], ['baseUrl', v.baseUrl ?? '-'],
        ['key', v.keyConfigured ? `****${v.keyLast4 ?? ''}` : '-'], ['updatedAt', iso(v.updatedAt)], ['updatedBy', v.updatedBy ?? '-'],
    ]);
}

export const aiCommands: CommandDef[] = [
    def({
        name: 'ai status', risk: 'read', summary: L('Estado del servicio de IA de la instancia (nunca muestra la clave)', 'Instance AI service status (never shows the key)'),
        covers: ['GET /api/admin/ai/settings', 'GET /api/admin/ai/state'],
        handler: async ({ ctx }) => {
            const v = (await ctx.callOk({ method: 'GET', path: '/ai/settings' })).data;
            const s = (await ctx.callOk({ method: 'GET', path: '/ai/state' })).data;
            const off = Object.keys(s.extensions ?? {});
            return multi(
                viewKv(v),
                table(['feature', 'enabled'], Object.entries(s.features ?? {}).map(([feature, enabled]) => ({ feature, enabled: enabled as boolean }))),
                kv([['extensionsDisabledForAi', off.join(', ') || '-']]),
            );
        },
    }),
    def({
        name: 'ai usage', risk: 'read', summary: L('Uso de IA de los últimos N días (por función y, con --user, por usuario)', 'AI usage over the last N days (by feature and, with --user, by user)'),
        flags: [num('days', 'Días (1-366, defecto 30)', 'Days (1-366, default 30)', { min: 1, max: 366 }), bool('user', 'Desglose por usuario', 'Per-user breakdown'), bool('csv', 'Exporta a CSV', 'Export to CSV')],
        covers: ['GET /api/admin/ai/usage', 'GET /api/admin/ai/usage/csv'],
        handler: async ({ args, ctx }) => {
            const days = (args.flags.days as number | undefined) ?? 30;
            if (args.flags.csv) {
                const r = await ctx.callOk({ method: 'GET', path: '/ai/usage/csv', query: { days } });
                return { type: 'csv', filename: `ai-usage-${new Date().toISOString().slice(0, 10)}.csv`, text: (r.text ?? '').replace(/^﻿/, '') };
            }
            const u = (await ctx.callOk({ method: 'GET', path: '/ai/usage', query: { days } })).data;
            const parts = [
                kv([['from', iso(u.from)], ['to', iso(u.to)], ['requests', u.totals.requests], ['errors', u.totals.errors], ['tokensIn', u.totals.tokensIn], ['tokensOut', u.totals.tokensOut], ['costUsd', u.totals.costUsd]]),
                table(['feature', 'requests', 'tokens', 'costUsd'], u.byFeature),
            ];
            if (args.flags.user) parts.push(table(['userId', 'email', 'requests', 'tokens', 'costUsd'], u.byUser));
            return multi(...parts);
        },
    }),
    def({
        name: 'ai audit', risk: 'read', summary: L('Historial de cambios de ajustes de IA (solo nombres de campos)', 'AI settings change history (field names only)'),
        covers: ['GET /api/admin/ai/audit'],
        handler: async ({ ctx }) => {
            const r = (await ctx.callOk({ method: 'GET', path: '/ai/audit' })).data;
            return table(['ts', 'actor', 'action', 'fields'], (r.entries as any[]).map((e) => ({ ts: iso(e.ts), actor: e.actor, action: e.action, fields: (e.fields as string[]).join(' ') })));
        },
    }),
    def({
        name: 'ai test', risk: 'write', summary: L('Prueba la conexión con el proveedor usando la configuración guardada', 'Test the provider connection using the saved configuration'),
        covers: ['POST /api/admin/ai/test'],
        handler: async ({ ctx }) => {
            const r = await ctx.call({ method: 'POST', path: '/ai/test', body: {} });
            if (r.status >= 400) throw new CmdError(r.data?.code ?? 'failed', r.data?.error ?? 'failed', 1, r.status);
            return kv([['ok', r.data.ok, r.data.ok ? 'success' : 'danger'], ['provider', r.data.provider ?? '-'], ['model', r.data.model ?? '-'], ['latencyMs', r.data.latencyMs], ['error', r.data.error ?? '-']]);
        },
    }),
    def({
        name: 'ai set', risk: 'write', summary: L('Cambia un ajuste no crítico: ai set <campo> <valor>', 'Change a non-critical setting: ai set <field> <value>'),
        positionals: [pos('field', FIELDS_HELP.es, FIELDS_HELP.en), pos('value', 'Valor (on|off, número, modo o texto)', 'Value (on|off, number, mode or text)')],
        examples: ['ai set model gpt-4o-mini', 'ai set features.translate off', 'ai set quotas.perUser.requestsDay 100', 'ai set guardrails.redaction.mode enforce'],
        covers: ['PUT /api/admin/ai/settings'],
        handler: async ({ args, ctx }) => viewKv(await put(ctx, buildSetPatch(ctx, args.positionals[0], args.positionals[1]))),
    }),
    def({
        name: 'ai connection set', risk: 'security', summary: L('Fija proveedor y URL base (nivel 4, step-up)', 'Set provider and base URL (level 4, step-up)'),
        positionals: [pos('provider', 'Proveedor', 'Provider', { values: AI_PROVIDERS })],
        flags: [str('base-url', 'URL base (obligatoria en azure-openai y compatible)', 'Base URL (required for azure-openai and compatible)')],
        examples: ['ai connection set openai', 'ai connection set compatible --base-url https://llm.example.com/v1'],
        handler: async ({ args, ctx }) => {
            const body: Record<string, unknown> = { provider: args.positionals[0] };
            if (args.flags['base-url'] !== undefined) body.baseUrl = args.flags['base-url'] === '' ? null : args.flags['base-url'];
            return viewKv(await put(ctx, body));
        },
    }),
    def({
        name: 'ai enable', risk: 'security', summary: L('Activa el servicio de IA de la instancia', 'Enable the instance AI service'),
        handler: async ({ ctx }) => { await put(ctx, { enabled: true }); return done(ctx, 'IA activada.', 'AI enabled.'); },
    }),
    def({
        name: 'ai disable', risk: 'security', summary: L('Kill switch: desactiva la IA y bloquea las extensiones que la requieren (≤ 30 s)', 'Kill switch: disable AI and block extensions that require it (<= 30 s)'),
        handler: async ({ ctx }) => { await put(ctx, { enabled: false }); return done(ctx, 'IA desactivada.', 'AI disabled.'); },
    }),
    def({
        name: 'ai key set', risk: 'security', summary: L('Guarda la clave API (se lee de stdin o aviso oculto; nunca por argumento, nunca se muestra ni se audita)', 'Store the API key (read from stdin or a hidden prompt; never an argument, never shown or audited)'),
        acceptsInput: true,
        handler: async ({ ctx }) => {
            const key = ctx.input?.replace(/\r?\n$/, '');
            if (!key) throw new CmdError('input_required', ctx.t(L('Falta la clave (usa --stdin o el aviso oculto).', 'Missing the key (use --stdin or the hidden prompt).')), 2);
            const v = await put(ctx, { apiKey: key });
            return kv([['key', v.keyConfigured ? `****${v.keyLast4 ?? ''}` : '-'], ['configured', v.configured]]);
        },
    }),
    def({
        name: 'ai key clear', risk: 'destructive', summary: L('Borra la clave API guardada', 'Delete the stored API key'),
        handler: async ({ ctx }) => { await put(ctx, { apiKey: null }); return done(ctx, 'Clave borrada.', 'Key deleted.'); },
    }),
    def({
        name: 'ai purge', risk: 'destructive', summary: L('Borra el registro de uso anterior a la retención (o a --days)', 'Delete usage records older than the retention (or --days)'),
        flags: [num('days', 'Días a conservar (defecto: retención configurada)', 'Days to keep (default: configured retention)', { min: 1, max: 3650 })],
        covers: ['POST /api/admin/ai/purge'],
        handler: async ({ args, ctx }) => {
            const r = (await ctx.callOk({ method: 'POST', path: '/ai/purge', body: args.flags.days ? { retentionDays: args.flags.days } : {} })).data;
            return kv([['purged', r.purged], ['retentionDays', r.retentionDays]]);
        },
    }),
];
