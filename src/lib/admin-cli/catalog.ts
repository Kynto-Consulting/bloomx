import { CmdError, type CommandDef, type L10n, type Locale } from './types';
import { coreCommands } from './commands/core';
import { usersCommands } from './commands/users';
import { platformCommands } from './commands/platform';
import { brandCommands } from './commands/brand';
import { extensionCommands } from './commands/extensions';
import { aiCommands } from './commands/ai';
import { spamCommands } from './commands/spam';
import { transferCommands } from './commands/transfer';
import { paymentsCommands } from './commands/payments';
import { permsCommands } from './commands/perms';
import { sessionCommands } from './commands/session';
import { commandLevel } from '../admin-levels';
import { kv, multi, table, text, def, L, pos } from './commands/_h';
import { matchCommand } from './parser';

/**
 * Catalogo unico de comandos (fuente de verdad para la consola web, la CLI, el autocompletado, `help` y la documentacion).
 * Categorias = primera palabra del comando (mapeadas abajo a un titulo es/en).
 */

export const CATEGORIES: Record<string, L10n> = {
    help: L('Ayuda', 'Help'),
    whoami: L('Sesión y cuenta', 'Session and account'), domains: L('Sesión y cuenta', 'Session and account'), use: L('Sesión y cuenta', 'Session and account'), profile: L('Sesión y cuenta', 'Session and account'), tokens: L('Sesión y cuenta', 'Session and account'), limits: L('Sesión y cuenta', 'Session and account'),
    users: L('Usuarios', 'Users'), accounts: L('Cuentas vinculadas', 'Linked accounts'), search: L('Usuarios', 'Users'),
    overview: L('Sistema', 'System'), system: L('Sistema', 'System'), config: L('Sistema', 'System'),
    mail: L('Correo', 'Mail'), spam: L('Spam y remitentes', 'Spam and senders'), transfer: L('Importar / exportar', 'Import / export'), jobs: L('Importar / exportar', 'Import / export'),
    billing: L('Facturación y desarrollo', 'Billing and development'), developer: L('Facturación y desarrollo', 'Billing and development'),
    retention: L('Retención y cuotas', 'Retention and quotas'), quota: L('Retención y cuotas', 'Retention and quotas'),
    audit: L('Auditoría', 'Audit'), security: L('Seguridad', 'Security'),
    domain: L('Dominio, marca y temas', 'Domain, brand and themes'), theme: L('Dominio, marca y temas', 'Domain, brand and themes'), landing: L('Dominio, marca y temas', 'Domain, brand and themes'),
    extensions: L('Extensiones', 'Extensions'),
    oauth: L('Proveedores OAuth', 'OAuth providers'),
    ai: L('IA de la instancia', 'Instance AI'),
    perms: L('Permisos', 'Permissions'),
    session: L('Sesión privilegiada', 'Privileged session'),
};

export const categoryOf = (c: CommandDef): L10n => CATEGORIES[c.name.split(' ')[0]] ?? L('Otros', 'Other');

/** Comandos que solo existen en el cliente (terminal web / shell de la CLI). */
export const CLIENT_BUILTINS: { name: string; summary: L10n }[] = [
    { name: 'clear', summary: L('Limpia la pantalla (Ctrl+L)', 'Clear the screen (Ctrl+L)') },
    { name: 'exit', summary: L('Cierra la consola / el shell', 'Close the console / the shell') },
];

const helpCommand: CommandDef = def({
    name: 'help', risk: 'read', summary: L('Lista los comandos o explica uno (help <comando>)', 'List commands or explain one (help <command>)'),
    positionals: [pos('command', 'Comando (varias palabras)', 'Command (several words)', { required: false, variadic: true, complete: 'command' })],
    handler: async ({ args, ctx }) => {
        const loc = ctx.t === undefined ? 'es' : (ctx.t(L('es', 'en')) as Locale);
        const words = args.positionals;
        if (words.length === 0) {
            const mine = ctx.actor.level;
            const rows = COMMANDS.filter((c) => !c.hidden && commandLevel(c.name) <= mine).map((c) => ({ category: categoryOf(c)[loc], command: c.name, level: commandLevel(c.name), risk: c.risk, summary: c.summary[loc] }));
            return multi(
                table(['category', 'command', 'level', 'risk', 'summary'], rows),
                text(ctx.t(L(`Tu permission_level es ${mine}: solo se listan los comandos que puedes ejecutar ("perms levels" explica la escala 0-4).`, `Your permission_level is ${mine}: only the commands you can run are listed ("perms levels" explains the 0-4 scale).`)), 'muted'),
                text(ctx.t(L(
                    'Globales: --json (salida JSON), --yes/-y (confirma acciones destructivas), --help. En el cliente: clear, exit. Tab autocompleta; ↑/↓ historial; Ctrl+C cancela; Ctrl+L limpia.',
                    'Globals: --json (JSON output), --yes/-y (confirm destructive actions), --help. Client-side: clear, exit. Tab completes; ↑/↓ history; Ctrl+C cancels; Ctrl+L clears.',
                )), 'muted'),
            );
        }
        const m = matchCommand(COMMANDS, words);
        if (!m || m.rest.length) {
            const prefix = words.join(' ');
            const subs = COMMANDS.filter((c) => c.name === prefix || c.name.startsWith(`${prefix} `));
            if (!subs.length) throw new CmdError('unknown_command', ctx.t(L(`No existe el comando "${prefix}".`, `Unknown command "${prefix}".`)), 127);
            return table(['command', 'risk', 'summary'], subs.map((c) => ({ command: c.name, risk: c.risk, summary: c.summary[loc] })));
        }
        const c = m.def;
        const subs = COMMANDS.filter((x) => x.name.startsWith(`${c.name} `));
        return multi(
            kv([['command', c.name], ['permission_level', `>= ${commandLevel(c.name)}`], ['risk', c.risk, c.risk === 'read' ? 'success' : c.risk === 'write' ? 'info' : 'warning'], ['summary', c.summary[loc]], ['scope', c.risk === 'security' ? 'security' : c.risk === 'read' ? 'read' : 'write'],
                ['confirmation', c.risk === 'destructive' || c.risk === 'security' ? `required (--yes) + step-up${c.mfaStepUp ? ' with MFA code' : ''}` : 'not required'], ['manager only', c.managerOnly === true]]),
            (c.positionals?.length ?? 0) > 0 ? table(['argument', 'required', 'description'], c.positionals!.map((p) => ({ argument: p.variadic ? `<${p.name}...>` : `<${p.name}>`, required: p.required !== false, description: p.description[loc] })), { caption: 'arguments' }) : text(''),
            (c.flags?.length ?? 0) > 0 ? table(['flag', 'type', 'description'], c.flags!.map((f) => ({ flag: `--${f.name}${f.alias ? `, -${f.alias}` : ''}`, type: f.type === 'enum' ? (f.values ?? []).join('|') : f.type, description: f.description[loc] + (f.required ? ' *' : '') })), { caption: 'flags' }) : text(''),
            c.examples?.length ? { type: 'list', title: 'examples', items: c.examples } : text(''),
            subs.length ? table(['subcommand', 'summary'], subs.map((x) => ({ subcommand: x.name, summary: x.summary[loc] })), { caption: 'subcommands' }) : text(''),
        );
    },
});

export const COMMANDS: readonly CommandDef[] = [
    helpCommand, ...coreCommands, ...usersCommands, ...platformCommands, ...brandCommands, ...extensionCommands, ...aiCommands, ...spamCommands, ...transferCommands, ...paymentsCommands, ...permsCommands, ...sessionCommands,
];

/** Catalogo serializable (sin handlers) para GET /api/admin/cli/commands, la UI y la documentacion. */
export interface CatalogEntry {
    name: string; category: L10n; risk: CommandDef['risk']; /** permission_level minimo (0..4). */ minLevel: number; mfaStepUp: boolean; summary: L10n; managerOnly: boolean; acceptsInput: boolean; examples: string[];
    positionals: { name: string; description: L10n; required: boolean; variadic: boolean; complete?: string; values?: readonly string[] }[];
    flags: { name: string; alias?: string; type: string; values?: readonly string[]; description: L10n; required: boolean; secret: boolean }[];
}

export function publicCatalog(): CatalogEntry[] {
    return COMMANDS.filter((c) => !c.hidden).map((c) => ({
        name: c.name, category: categoryOf(c), risk: c.risk, minLevel: commandLevel(c.name), mfaStepUp: !!c.mfaStepUp, summary: c.summary, managerOnly: !!c.managerOnly, acceptsInput: !!c.acceptsInput, examples: c.examples ?? [],
        positionals: (c.positionals ?? []).map((p) => ({ name: p.name, description: p.description, required: p.required !== false, variadic: !!p.variadic, complete: p.complete, values: p.values })),
        flags: (c.flags ?? []).map((f) => ({ name: f.name, alias: f.alias, type: f.type, values: f.values, description: f.description, required: !!f.required, secret: !!f.secret })),
    }));
}
