import { CmdError, type CmdContext, type CommandDef } from '../types';
import { bool, data, def, done, iso, kv, L, list, multi, num, oneOf, pos, str, table, text } from './_h';

/**
 * Importar / exportar correo (buzones y transferencias). Reutiliza el enrutador real de mail-transfer: mismas comprobaciones de
 * re-autenticacion reciente (step-up), confirmacion escribiendo el dominio, limites y trabajos por lotes (MailTransferJob).
 * La subida de archivos grandes por trozos la orquesta la CLI (`bloomx transfer import <archivo>`); un terminal de texto en el
 * navegador no puede leer archivos locales, para eso existe el asistente de /admin/transfer.
 */

const JOB = pos('job', 'Id del trabajo', 'Job id');
const FOLDERS = ['inbox', 'sent', 'archive', 'spam', 'trash', 'scheduled', 'snoozed', 'drafts'] as const;

const jobRow = (j: any) => ({ id: j.id, kind: j.kind, status: j.status, file: j.fileName, progress: j.progress !== undefined ? `${j.progress}%` : '', createdAt: iso(j.createdAt), error: j.error ?? '' });

async function t(ctx: CmdContext, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) {
    return ctx.callOk({ method, path: `/mail-transfer${path}`, body });
}

export const transferCommands: CommandDef[] = [
    def({
        name: 'transfer config', risk: 'read', summary: L('Límites y formatos de importar/exportar, y estado de re-autenticación', 'Import/export limits, formats and re-authentication state'),
        covers: ['ALL /api/admin/mail-transfer/**'], handler: async ({ ctx }) => data((await t(ctx, 'GET', '/config')).data),
    }),
    def({
        name: 'transfer mailboxes', risk: 'read', summary: L('Buzones del dominio (para exportar o mapear al importar)', 'Domain mailboxes (to export or map when importing)'),
        handler: async ({ ctx }) => { const r = (await t(ctx, 'GET', '/mailboxes')).data; return table(['email', 'name', 'id'], r.mailboxes ?? r.items ?? []); },
    }),
    def({
        name: 'transfer jobs', risk: 'read', summary: L('Historial de trabajos de importar/exportar', 'Import/export job history'),
        flags: [oneOf('status', ['uploading', 'uploaded', 'ready', 'running', 'done', 'failed', 'cancelled'], 'Filtrar por estado', 'Filter by status')],
        handler: async ({ args, ctx }) => {
            const r = (await t(ctx, 'GET', '/jobs')).data;
            const rows = (r.jobs as any[]).filter((j) => !args.flags.status || j.status === args.flags.status);
            return table(['id', 'kind', 'status', 'file', 'progress', 'createdAt', 'error'], rows.map(jobRow));
        },
    }),
    def({
        name: 'transfer job', risk: 'read', summary: L('Detalle de un trabajo (para seguirlo: `transfer job <id>` repetido o `--watch` en la CLI)', 'Job detail (follow it by repeating `transfer job <id>` or `--watch` in the CLI)'),
        positionals: [JOB], handler: async ({ args, ctx }) => data((await t(ctx, 'GET', `/jobs/${encodeURIComponent(args.positionals[0])}`)).data),
    }),
    def({
        name: 'transfer report', risk: 'read', summary: L('Informe final de un trabajo', 'Final report of a job'),
        positionals: [JOB], handler: async ({ args, ctx }) => data((await t(ctx, 'GET', `/jobs/${encodeURIComponent(args.positionals[0])}/report`)).data),
    }),
    def({
        name: 'transfer preview', risk: 'read', summary: L('Vista previa de una importación subida (buzones detectados, conteos)', 'Preview of an uploaded import (detected mailboxes, counts)'),
        positionals: [JOB], handler: async ({ args, ctx }) => data((await t(ctx, 'GET', `/jobs/${encodeURIComponent(args.positionals[0])}/preview`)).data),
    }),
    def({
        name: 'transfer cancel', risk: 'destructive', summary: L('Cancela un trabajo en curso', 'Cancel a running job'),
        positionals: [JOB], handler: async ({ args, ctx }) => { await t(ctx, 'POST', `/jobs/${encodeURIComponent(args.positionals[0])}/cancel`); return done(ctx, 'Trabajo cancelado.', 'Job cancelled.'); },
    }),
    def({
        name: 'transfer resume', risk: 'write', summary: L('Reanuda un trabajo interrumpido', 'Resume an interrupted job'),
        positionals: [JOB], handler: async ({ args, ctx }) => { await t(ctx, 'POST', `/jobs/${encodeURIComponent(args.positionals[0])}/resume`); return done(ctx, 'Trabajo reanudado.', 'Job resumed.'); },
    }),
    def({
        name: 'transfer delete', risk: 'destructive', summary: L('Borra un trabajo y sus archivos temporales', 'Delete a job and its temporary files'),
        positionals: [JOB], handler: async ({ args, ctx }) => { await t(ctx, 'DELETE', `/jobs/${encodeURIComponent(args.positionals[0])}`); return done(ctx, 'Trabajo borrado.', 'Job deleted.'); },
    }),
    def({
        name: 'transfer export', risk: 'security', summary: L('Crea una exportación de correo (mbox/eml). Requiere --confirm-domain con el nombre del dominio', 'Create a mail export (mbox/eml). Requires --confirm-domain with the domain name'),
        flags: [
            oneOf('scope', ['domain', 'selected', 'one'], 'Alcance', 'Scope', { required: false }), list('mailboxes', 'Buzones (coma) para selected/one', 'Mailboxes (comma) for selected/one'),
            list('folders', `Carpetas (${FOLDERS.join(',')})`, `Folders (${FOLDERS.join(',')})`), str('from', 'Desde (ISO)', 'From (ISO)'), str('to', 'Hasta (ISO)', 'To (ISO)'),
            bool('attachments', 'Incluir adjuntos (por defecto sí)', 'Include attachments (default yes)'), oneOf('format', ['mbox', 'eml'], 'Formato', 'Format'),
            str('password', 'Contraseña del paquete ZIP', 'Package ZIP password', { secret: true }), bool('notify-users', 'Avisar a los usuarios', 'Notify users'),
            str('confirm-domain', 'Nombre del dominio (confirmación)', 'Domain name (confirmation)'),
        ],
        handler: async ({ args, ctx }) => {
            const f = args.flags;
            const body = {
                scopeMode: f.scope ?? 'domain', mailboxes: f.mailboxes, folders: f.folders ?? [], from: f.from ?? null, to: f.to ?? null,
                includeAttachments: f.attachments !== false, format: f.format ?? 'mbox', password: f.password, notifyUsers: f['notify-users'] === true, confirmDomain: f['confirm-domain'],
            };
            const r = (await t(ctx, 'POST', '/export', body)).data;
            return kv([['job', r.job?.id ?? r.id], ['status', r.job?.status ?? r.status]], ctx.t(L('Exportación creada. Sigue el progreso con `transfer job <id>`.', 'Export created. Follow progress with `transfer job <id>`.')));
        },
    }),
    def({
        name: 'transfer download-link', risk: 'security', summary: L('Emite un enlace de descarga firmado (10 min) de una exportación terminada', 'Issue a signed download link (10 min) for a finished export'),
        positionals: [JOB], handler: async ({ args, ctx }) => { const r = (await t(ctx, 'POST', `/jobs/${encodeURIComponent(args.positionals[0])}/download-link`)).data; return kv([['url', r.url, 'info'], ['expiresAt', iso(r.expiresAt)]]); },
    }),
    def({
        name: 'transfer import-create', risk: 'write', summary: L('Crea un trabajo de importación (la CLI sube el archivo por trozos después)', 'Create an import job (the CLI uploads the file in chunks afterwards)'),
        flags: [str('file-name', 'Nombre del archivo', 'File name', { required: true }), num('size', 'Tamaño en bytes', 'Size in bytes', { required: true, min: 1 })], hidden: false,
        handler: async ({ args, ctx }) => data((await t(ctx, 'POST', '/import', { fileName: args.flags['file-name'], size: args.flags.size })).data),
    }),
    def({
        name: 'transfer import-complete', risk: 'write', summary: L('Marca la subida como completa y analiza el archivo', 'Mark the upload as complete and analyse the file'),
        positionals: [JOB], handler: async ({ args, ctx }) => data((await t(ctx, 'POST', `/jobs/${encodeURIComponent(args.positionals[0])}/complete`)).data),
    }),
    def({
        name: 'transfer import-password', risk: 'security', summary: L('Contraseña de un ZIP cifrado (o --skip)', 'Password of an encrypted ZIP (or --skip)'),
        positionals: [JOB], flags: [str('password', 'Contraseña del ZIP', 'ZIP password', { secret: true }), bool('skip', 'Omitir las entradas cifradas', 'Skip encrypted entries')],
        handler: async ({ args, ctx }) => data((await t(ctx, 'POST', `/jobs/${encodeURIComponent(args.positionals[0])}/zip-password`, { password: args.flags.password, skipEncrypted: args.flags.skip === true })).data),
    }),
    def({
        name: 'transfer mailboxes-create', risk: 'security', summary: L('Crea los buzones faltantes detectados al importar', 'Create the missing mailboxes detected during an import'),
        positionals: [JOB, pos('addresses', 'Direcciones (una o varias)', 'Addresses (one or more)', { variadic: true })],
        flags: [oneOf('password-mode', ['generic', 'random'], 'Modo de contraseña', 'Password mode', { required: true }), str('password', 'Contraseña genérica', 'Generic password', { secret: true }), bool('no-must-change', 'No obligar a cambiarla', 'Do not force a change'), str('confirm-domain', 'Nombre del dominio', 'Domain name', { required: true })],
        handler: async ({ args, ctx }) => {
            const [job, ...addresses] = args.positionals;
            if (!addresses.length) throw new CmdError('missing_argument', 'Missing <addresses>', 2);
            const r = (await t(ctx, 'POST', `/jobs/${encodeURIComponent(job)}/mailboxes`, {
                addresses, passwordMode: args.flags['password-mode'], genericPassword: args.flags.password, mustChange: args.flags['no-must-change'] !== true, confirmDomain: args.flags['confirm-domain'],
            })).data;
            return data(r);
        },
    }),
    def({
        name: 'transfer import-confirm', risk: 'security', summary: L('Confirma e inicia la importación (escribe el dominio para confirmar)', 'Confirm and start the import (type the domain to confirm)'),
        positionals: [JOB], flags: [oneOf('target-mode', ['auto', 'single'], 'auto = por destinatario; single = un solo buzón', 'auto = per recipient; single = one mailbox'), str('single-mailbox', 'Buzón destino (modo single)', 'Target mailbox (single mode)'),
            str('map', 'JSON {origen:destino|null}', 'JSON {source:target|null}'), bool('notify-users', 'Avisar a los usuarios', 'Notify users'), str('confirm-domain', 'Nombre del dominio', 'Domain name')],
        handler: async ({ args, ctx }) => {
            let mailboxMap: unknown;
            if (typeof args.flags.map === 'string') { try { mailboxMap = JSON.parse(args.flags.map); } catch { throw new CmdError('invalid_json', '--map expects JSON', 2); } }
            const r = (await t(ctx, 'POST', `/jobs/${encodeURIComponent(args.positionals[0])}/confirm`, {
                confirmDomain: args.flags['confirm-domain'], targetMode: args.flags['target-mode'] ?? 'auto', singleMailbox: args.flags['single-mailbox'], mailboxMap, notifyUsers: args.flags['notify-users'] === true,
            })).data;
            return multi(text(ctx.t(L('Importación iniciada. Sigue el progreso con `transfer job <id>`.', 'Import started. Follow progress with `transfer job <id>`.')), 'success'), data(r));
        },
    }),
];
