#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const pkg = require('../package.json');
const client = require('../lib/client');
const config = require('../lib/config');
const commands = require('../lib/commands');
const { readAllStdin } = require('../lib/prompt');
const { runCommand, T } = require('../lib/run');
const { shell } = require('../lib/shell');

/**
 * bloomx - CLI de administracion de BloomX por HTTPS (mismo motor que la consola web de /admin/profile/console).
 *
 * Codigos de salida: 0 ok · 1 error del comando · 2 uso incorrecto · 3 sin permiso/sesion · 4 falta confirmacion o step-up ·
 *                    5 limite de tasa/tiempo · 6 red · 127 comando desconocido.
 */

const VALUE_FLAGS = new Set(['--profile', '-p', '--url', '--token', '--file', '--out']);
const BOOL_FLAGS = new Set(['--stdin', '--no-color', '--version', '-v']);

function parseGlobal(argv) {
    const opts = { rest: [] };
    const rest = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--') { rest.push(...argv.slice(i)); break; }
        const eq = a.startsWith('--') ? a.indexOf('=') : -1;
        const key = eq > 0 ? a.slice(0, eq) : a;
        if (VALUE_FLAGS.has(key)) {
            const v = eq > 0 ? a.slice(eq + 1) : argv[++i];
            if (v === undefined) throw new client.ApiError(`${key} needs a value`, { code: 'usage' });
            if (key === '--profile' || key === '-p') opts.profile = v;
            else if (key === '--url') opts.url = v;
            else if (key === '--token') opts.token = v;
            else if (key === '--file') opts.file = v;
            else if (key === '--out') opts.out = v;
        } else if (BOOL_FLAGS.has(a)) {
            if (a === '--stdin') opts.stdin = true;
            else if (a === '--no-color') opts.noColor = true;
            else opts.version = true;
        } else rest.push(a);
    }
    opts.rest = rest;
    return { opts, rest };
}

const USAGE = () => T(`bloomx ${pkg.version} - CLI de administración de BloomX (por HTTPS)

Uso:
  bloomx login <url> [--email e] [--scopes read,write,security] [--ttl horas]   inicia sesión (o --token <t>)
  bloomx logout [--all]                          cierra sesión y revoca el token
  bloomx whoami | domains | profiles | use <dominio>
  bloomx shell                                   shell interactivo (alias: bloomx ssh)
  bloomx <comando...> [--json] [--yes]           ejecuta un comando y sale con un código útil
  bloomx help                                    catálogo completo de comandos
  bloomx transfer import <archivo> | transfer download <job> --out <archivo>
  bloomx completion <bash|zsh>

Opciones globales: --profile <n>  --url <u> --token <t>  --file <ruta>  --stdin  --out <ruta>  --no-color
Entorno: BLOOMX_URL, BLOOMX_TOKEN, BLOOMX_PROFILE, BLOOMX_STEPUP_PASSWORD, BLOOMX_STEPUP_CODE, BLOOMX_CONFIG_DIR
Códigos de salida: 0 ok · 1 error · 2 uso · 3 sin permiso · 4 falta confirmación/step-up · 5 límite · 6 red · 127 desconocido
Nota: "ssh" es un shell equivalente sobre HTTPS (SSH real, puerto 22, no está disponible en Vercel).
`, `bloomx ${pkg.version} - BloomX administration CLI (over HTTPS)

Usage:
  bloomx login <url> [--email e] [--scopes read,write,security] [--ttl hours]    sign in (or --token <t>)
  bloomx logout [--all]                          sign out and revoke the token
  bloomx whoami | domains | profiles | use <domain>
  bloomx shell                                   interactive shell (alias: bloomx ssh)
  bloomx <command...> [--json] [--yes]           run a command and exit with a useful code
  bloomx help                                    full command catalogue
  bloomx transfer import <file> | transfer download <job> --out <file>
  bloomx completion <bash|zsh>

Global options: --profile <n>  --url <u> --token <t>  --file <path>  --stdin  --out <path>  --no-color
Environment: BLOOMX_URL, BLOOMX_TOKEN, BLOOMX_PROFILE, BLOOMX_STEPUP_PASSWORD, BLOOMX_STEPUP_CODE, BLOOMX_CONFIG_DIR
Exit codes: 0 ok · 1 error · 2 usage · 3 denied · 4 needs confirmation/step-up · 5 limit · 6 network · 127 unknown
Note: "ssh" is an equivalent shell over HTTPS (real SSH on port 22 is not available on Vercel).
`);

async function main(argv) {
    const { opts, rest } = parseGlobal(argv);
    if (opts.version) { process.stdout.write(`${pkg.version}\n`); return 0; }
    const [cmd, ...args] = rest;

    if (!cmd || cmd === '--help' || cmd === '-h') { process.stdout.write(USAGE()); return cmd || rest.length === 0 ? 0 : 2; }
    if (cmd === 'login') return commands.login(args, opts);
    if (cmd === 'logout') return commands.logout(opts);
    if (cmd === 'profiles') return commands.profiles();
    if (cmd === 'use') return commands.use(args, opts);
    if (cmd === 'completion') { process.stdout.write(commands.completionScript(args[0])); return 0; }

    const profile = config.resolveProfile(opts);
    const ctx = { profile, opts, session: { stepUp: null, stepUpUntil: 0 } };

    if (cmd === '__complete') { const hits = await commands.completeLine(profile, args.join(' ')); process.stdout.write(hits.join('\n') + (hits.length ? '\n' : '')); return 0; }
    if (cmd === 'shell' || cmd === 'ssh') return shell(ctx);
    if (cmd === 'transfer' && args[0] === 'import') return commands.transferImport(args.slice(1), ctx);
    if (cmd === 'transfer' && args[0] === 'download') return commands.transferDownload(args.slice(1), ctx);

    let input;
    if (opts.file) {
        const st = fs.statSync(opts.file);
        if (!st.isFile() || st.size > 512 * 1024) throw new client.ApiError('--file must be a regular file of at most 512 KB', { code: 'usage' });
        input = fs.readFileSync(opts.file, 'utf8');
    } else if (opts.stdin) input = await readAllStdin();

    const ac = new AbortController();
    process.once('SIGINT', () => ac.abort());
    return runCommand(ctx, rest, { input, signal: ac.signal });
}

main(process.argv.slice(2)).then(
    (code) => { process.exitCode = typeof code === 'number' ? code : 0; },
    (e) => {
        const msg = e && e.message ? e.message : String(e);
        process.stderr.write(`error: ${msg}\n`);
        process.exitCode = e instanceof client.ApiError ? (e.code === 'network' ? 6 : e.status === 401 || e.status === 403 ? 3 : e.code === 'usage' || e.code === 'cancelled' ? 2 : e.code === 'stepup_required' ? 4 : 1) : 1;
    },
);
