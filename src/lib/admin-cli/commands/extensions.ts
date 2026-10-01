import { CmdError, type CmdContext, type CommandDef } from '../types';
import { bool, data, def, done, instanceDomainId, iso, kv, L, multi, pos, requireManager, str, table, text } from './_h';

/** Extensiones del dominio: catalogo, instalacion, activacion, obligatoriedad, orden, pruebas y credenciales (sin valores). */

const EXT = pos('extension', 'Id de la extensión', 'Extension id', { complete: 'extension' });

async function managerCall(ctx: CmdContext, a: Parameters<CmdContext['callOk']>[0]) {
    requireManager(ctx);
    return ctx.callOk(a);
}

export const extensionCommands: CommandDef[] = [
    def({
        name: 'extensions catalog', risk: 'read', summary: L('Catálogo de extensiones disponibles', 'Available extensions catalog'),
        flags: [bool('fresh', 'Saltar la caché', 'Bypass the cache')], covers: ['GET /api/admin/extensions/catalog'],
        handler: async ({ args, ctx }) => {
            const r = (await ctx.callOk({ method: 'GET', path: '/extensions/catalog', query: { fresh: args.flags.fresh ? '1' : undefined } })).data;
            return table(['id', 'name', 'version', 'category', 'price'], (r.extensions as any[]).map((e) => ({ id: e.id, name: e.name, version: e.version, category: e.category, price: e.price ?? e.priceCents ?? '' })));
        },
    }),
    def({
        name: 'extensions list', risk: 'read', summary: L('Extensiones instaladas del dominio con su estado', 'Installed extensions of the domain with their state'),
        managerOnly: true, covers: ['GET /api/admin/extensions/installed'],
        handler: async ({ ctx }) => {
            const r = (await ctx.callOk({ method: 'GET', path: '/extensions/installed', query: { domainId: await instanceDomainId() } })).data;
            if (r.managerSessionRequired) throw new CmdError('manager_session_required', ctx.t(L('Requiere una cuenta manager dueña del dominio.', 'Requires a manager account that owns the domain.')), 1, 403);
            const bad = new Set<string>(r.errorExtensionIds ?? []);
            return table(['id', 'enabled', 'mandatory', 'version', 'errors24h'], (r.extensions as any[]).map((e) => ({ id: e.id ?? e.extensionId, enabled: e.enabled, mandatory: e.mandatory ?? e.effectiveMandatory, version: e.version ?? e.installedVersion, errors24h: bad.has(e.id ?? e.extensionId) ? 'yes' : '' })));
        },
    }),
    def({
        name: 'extensions install', risk: 'write', summary: L('Instala (o actualiza, es idempotente) una extensión', 'Install (or update; idempotent) an extension'),
        managerOnly: true, positionals: [EXT], covers: ['POST /api/admin/extensions/install'],
        handler: async ({ args, ctx }) => { await managerCall(ctx, { method: 'POST', path: '/extensions/install', body: { domainId: await instanceDomainId(), extensionId: args.positionals[0] } }); return done(ctx, 'Extensión instalada.', 'Extension installed.'); },
    }),
    def({
        name: 'extensions update', risk: 'write', summary: L('Actualiza una extensión instalada a la versión del catálogo', 'Update an installed extension to the catalog version'),
        managerOnly: true, positionals: [EXT], covers: ['POST /api/admin/extensions/update'],
        handler: async ({ args, ctx }) => { const r = await managerCall(ctx, { method: 'POST', path: '/extensions/update', body: { domainId: await instanceDomainId(), extensionId: args.positionals[0] } }); return kv([['updated', r.data.updated], ['from', r.data.from], ['to', r.data.to]]); },
    }),
    def({
        name: 'extensions uninstall', risk: 'destructive', summary: L('Desinstala una extensión y BORRA sus credenciales y tokens', 'Uninstall an extension and WIPE its credentials and tokens'),
        managerOnly: true, positionals: [EXT], covers: ['POST /api/admin/extensions/uninstall'],
        handler: async ({ args, ctx }) => { await managerCall(ctx, { method: 'POST', path: '/extensions/uninstall', body: { domainId: await instanceDomainId(), extensionId: args.positionals[0] } }); return done(ctx, 'Extensión desinstalada.', 'Extension uninstalled.'); },
    }),
    def({
        name: 'extensions enable', risk: 'write', summary: L('Activa una extensión instalada', 'Enable an installed extension'),
        managerOnly: true, positionals: [EXT], covers: ['POST /api/admin/extensions/toggle'],
        handler: async ({ args, ctx }) => { await managerCall(ctx, { method: 'POST', path: '/extensions/toggle', body: { domainId: await instanceDomainId(), extensionId: args.positionals[0], enabled: true } }); return done(ctx, 'Extensión activada.', 'Extension enabled.'); },
    }),
    def({
        name: 'extensions disable', risk: 'write', summary: L('Desactiva una extensión sin desinstalarla', 'Disable an extension without uninstalling'),
        managerOnly: true, positionals: [EXT], covers: [],
        handler: async ({ args, ctx }) => { await managerCall(ctx, { method: 'POST', path: '/extensions/toggle', body: { domainId: await instanceDomainId(), extensionId: args.positionals[0], enabled: false } }); return done(ctx, 'Extensión desactivada.', 'Extension disabled.'); },
    }),
    def({
        name: 'extensions mandatory', risk: 'security', summary: L('Marca una extensión como obligatoria para todos (on | off)', 'Mark an extension mandatory for everyone (on | off)'),
        managerOnly: true, positionals: [EXT, pos('state', 'on | off', 'on | off', { values: ['on', 'off'] })], covers: ['POST /api/admin/extensions/mandatory'],
        handler: async ({ args, ctx }) => {
            const r = await managerCall(ctx, { method: 'POST', path: '/extensions/mandatory', body: { domainId: await instanceDomainId(), extensionId: args.positionals[0], mandatory: args.positionals[1] === 'on' } });
            return kv([['mandatory', r.data.mandatory], ['effective', r.data.effective]]);
        },
    }),
    def({
        name: 'extensions order', risk: 'write', summary: L('Fija el orden de paneles/botones: id=orden ...', 'Set panel/button order: id=order ...'),
        managerOnly: true, positionals: [pos('pairs', 'id=orden (uno o varios)', 'id=order (one or more)', { variadic: true })], covers: ['POST /api/admin/extensions/order'],
        handler: async ({ args, ctx }) => {
            const items = args.positionals.map((p) => { const [extensionId, o] = p.split('='); if (!extensionId || !/^\d+$/.test(o ?? '')) throw new CmdError('invalid_input', `Expected id=number, got "${p.slice(0, 40)}"`, 2); return { extensionId, order: Number(o) }; });
            const r = await managerCall(ctx, { method: 'POST', path: '/extensions/order', body: { domainId: await instanceDomainId(), items } });
            return kv([['updated', r.data.updated]]);
        },
    }),
    def({
        name: 'extensions test', risk: 'write', summary: L('Prueba la conexión de una extensión (si declara testConnection)', 'Test an extension connection (if it declares testConnection)'),
        positionals: [EXT], covers: ['POST /api/admin/extensions/test'],
        handler: async ({ args, ctx }) => {
            const r = await ctx.call({ method: 'POST', path: '/extensions/test', body: { extensionId: args.positionals[0] } });
            if (r.status === 501) return text(ctx.t(L(`No disponible aquí: ${r.data?.reason ?? 'not_supported'}. Usa la consola web (sesión de usuario).`, `Not available here: ${r.data?.reason ?? 'not_supported'}. Use the web console (user session).`)), 'warning');
            if (r.status >= 400) throw new CmdError(r.data?.code ?? 'failed', r.data?.error ?? 'failed', 1, r.status);
            return kv([['ok', r.data.ok, r.data.ok ? 'success' : 'danger'], ['message', r.data.message]]);
        },
    }),
    def({
        name: 'extensions status', risk: 'read', summary: L('Estado y errores recientes de una extensión (24 h)', 'Recent status and errors of an extension (24 h)'),
        positionals: [EXT], covers: ['GET /api/admin/extensions/[id]/status'],
        handler: async ({ args, ctx }) => {
            const r = (await ctx.callOk({ method: 'GET', path: `/extensions/${encodeURIComponent(args.positionals[0])}/status` })).data;
            return multi(kv([['errors24h', r.errors24h], ['lastEvent', iso(r.lastEvent?.ts ?? r.lastEvent)], ['lastError', iso(r.lastError?.ts ?? r.lastError)]]), table(['ts', 'event', 'outcome', 'status'], (r.entries as any[]).map((e) => ({ ts: iso(e.ts), event: e.event, outcome: e.outcome, status: e.status }))));
        },
    }),
    def({
        name: 'extensions credentials', risk: 'read', summary: L('Credenciales de una extensión: nombres y fuente (NUNCA valores)', 'An extension\'s credentials: names and source (NEVER values)'),
        managerOnly: true, positionals: [EXT], covers: ['GET /api/admin/extensions/settings'],
        handler: async ({ args, ctx }) => {
            const r = await managerCall(ctx, { method: 'GET', path: '/extensions/settings', query: { domainId: await instanceDomainId(), extensionId: args.positionals[0] } });
            return table(['name', 'configured', 'source', 'movable'], r.data.keys);
        },
    }),
    def({
        name: 'extensions credentials set', risk: 'security', summary: L('Fija una credencial (el valor se lee con --value, --stdin o aviso interactivo; nunca se audita)', 'Set a credential (value via --value, --stdin or a hidden prompt; never audited)'),
        managerOnly: true, acceptsInput: true, positionals: [EXT, pos('name', 'Nombre de la variable (MAYÚSCULAS)', 'Variable name (UPPERCASE)')],
        flags: [str('value', 'Valor de la credencial', 'Credential value', { secret: true })], covers: ['PUT /api/admin/extensions/settings'],
        handler: async ({ args, ctx }) => {
            const value = (args.flags.value as string | undefined) ?? ctx.input?.replace(/\r?\n$/, '');
            if (!value) throw new CmdError('input_required', ctx.t(L('Falta el valor (--value o --stdin).', 'Missing the value (--value or --stdin).')), 2);
            const r = await managerCall(ctx, { method: 'PUT', path: '/extensions/settings', body: { domainId: await instanceDomainId(), extensionId: args.positionals[0], credentials: { [args.positionals[1]]: value } } });
            return table(['name', 'configured', 'source'], r.data.keys);
        },
    }),
    def({
        name: 'extensions credentials unset', risk: 'destructive', summary: L('Borra una credencial', 'Delete a credential'),
        managerOnly: true, positionals: [EXT, pos('name', 'Nombre de la variable', 'Variable name')], covers: [],
        handler: async ({ args, ctx }) => {
            const r = await managerCall(ctx, { method: 'PUT', path: '/extensions/settings', body: { domainId: await instanceDomainId(), extensionId: args.positionals[0], credentials: { [args.positionals[1]]: null } } });
            return table(['name', 'configured', 'source'], r.data.keys);
        },
    }),
    def({
        name: 'extensions credentials migrate', risk: 'security', summary: L('Copia al dominio las credenciales heredadas (cifradas en el backend)', 'Copy legacy credentials to the domain (encrypted on the backend)'),
        managerOnly: true, positionals: [EXT], covers: ['POST /api/admin/extensions/settings'],
        handler: async ({ args, ctx }) => {
            const r = await managerCall(ctx, { method: 'POST', path: '/extensions/settings', body: { domainId: await instanceDomainId(), extensionId: args.positionals[0], action: 'migrate-legacy' } });
            return multi(kv([['migrated', (r.data.migrated ?? []).join(', ') || '-'], ['serverEnv', (r.data.serverEnv ?? []).join(', ') || '-']]), table(['name', 'configured', 'source'], r.data.keys ?? []));
        },
    }),
    def({
        name: 'extensions conferencing', risk: 'read', summary: L('Estado de las extensiones de conferencias (Zoom, Meet, Calendar)', 'Conferencing extensions state (Zoom, Meet, Calendar)'),
        managerOnly: true, covers: ['GET /api/admin/conferencing'],
        handler: async ({ ctx }) => data((await managerCall(ctx, { method: 'GET', path: '/conferencing' })).data),
    }),
];
