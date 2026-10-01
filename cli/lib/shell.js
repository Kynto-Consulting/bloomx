'use strict';

const readline = require('node:readline');
const client = require('./client');
const config = require('./config');
const { paint } = require('./render');
const { runCommand, T, useColor } = require('./run');
const { maskSecrets, tokenStart, tokenize, quoteArg } = require('./tokenize');

/**
 * `bloomx shell` (alias `bloomx ssh`): REPL interactivo sobre HTTPS con autocompletado (Tab), historial persistente (0600, con las
 * banderas secretas enmascaradas), Ctrl+C (cancela el comando en curso) y Ctrl+D / exit. NO es SSH real: ver la documentacion.
 */
async function shell(ctx) {
    const color = useColor(process.stderr, ctx.opts);
    const who = ctx.profile.account || 'admin';
    const dom = ctx.profile.domain || ctx.profile.name || 'instance';
    const prompt = paint(`bloomx ${who}@${dom}> `, 'accent', color);

    process.stderr.write(`${T('Consola de administración de', 'Administration shell for')} ${dom}. ${T('Escribe "help"; Tab autocompleta; Ctrl+D sale.', 'Type "help"; Tab completes; Ctrl+D exits.')}\n`);
    process.stderr.write(`${paint(T('Nota: es un shell sobre HTTPS, no SSH.', 'Note: this is a shell over HTTPS, not SSH.'), 'muted', color)}\n`);

    let running = null;
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: !!process.stdin.isTTY,
        prompt,
        history: config.readHistory(),
        historySize: 500,
        completer: (line, cb) => {
            client.complete(ctx.profile, line, T('es', 'en')).then((r) => {
                const hits = r.candidates.map((c) => c.value);
                const start = tokenStart(line);
                const cur = line.slice(start);
                const q = (v) => (/[\s"'\\]/.test(v) ? quoteArg(v) : v);
                cb(null, [hits.map(q).filter((h) => h.toLowerCase().startsWith(cur.toLowerCase())), cur]);
            }).catch(() => cb(null, [[], line]));
        },
    });

    const done = new Promise((resolve) => rl.on('close', resolve));
    rl.on('SIGINT', () => {
        if (running) { running.abort(); process.stderr.write(`\n${T('Cancelado.', 'Cancelled.')}\n`); return; }
        rl.write(null, { ctrl: true, name: 'u' });
        process.stdout.write('^C\n');
        rl.prompt();
    });

    rl.prompt();
    for await (const raw of rl) {
        const line = raw.trim();
        if (line) {
            if (line === 'exit' || line === 'quit') break;
            if (line === 'clear') { process.stdout.write('\u001b[2J\u001b[H'); rl.prompt(); continue; }
            config.addHistory(maskSecrets(line));
            try {
                const argv = tokenize(line);
                if (argv.includes('--file') || argv.includes('--stdin')) process.stderr.write(`${T('--file/--stdin no se usan dentro del shell: ejecútalo como comando suelto (bloomx <comando> --file ...).', '--file/--stdin are not used inside the shell: run it as a one-shot command (bloomx <command> --file ...).')}\n`);
                else {
                    running = new AbortController();
                    await runCommand(ctx, argv, { signal: running.signal });
                }
            } catch (e) {
                if (!(e instanceof client.ApiError && e.code === 'cancelled')) process.stderr.write(`error: ${e.message}\n`);
                if (e instanceof client.ApiError && (e.status === 401 || e.status === 403) && ['token_expired', 'token_revoked', 'token_unknown', 'superseded', 'expired', 'locked'].includes(e.code)) break;
            } finally { running = null; }
        }
        rl.prompt();
    }
    rl.close();
    await done;
    return 0;
}

module.exports = { shell };
