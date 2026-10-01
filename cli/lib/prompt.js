'use strict';

const readline = require('node:readline');

/** Lee una linea visible de la TTY (o de stdin si no es TTY). */
function readLine(question) {
    return new Promise((resolve, reject) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: !!process.stdin.isTTY });
        let answered = false;
        rl.question(question, (a) => { answered = true; rl.close(); resolve(a); });
        rl.on('close', () => { if (!answered) reject(new Error('Input closed')); });
    });
}

/**
 * Lee un secreto SIN ECO (contrasena, codigo MFA). Requiere TTY: no hay forma segura de ocultar la entrada si stdin es un pipe
 * (para automatizar usa --password-stdin o variables de step-up explicitas).
 */
function readSecret(question) {
    return new Promise((resolve, reject) => {
        const stdin = process.stdin;
        if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') { reject(new Error('A terminal is required to type a secret without echo.')); return; }
        process.stderr.write(question);
        let buf = '';
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');
        const finish = (err) => {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.removeListener('data', onData);
            process.stderr.write('\n');
            if (err) reject(err); else resolve(buf);
        };
        const onData = (chunk) => {
            for (const ch of String(chunk)) {
                if (ch === '\r' || ch === '\n') return finish();
                if (ch === '\u0003') return finish(new Error('Cancelled'));
                if (ch === '\u0004' && buf === '') return finish(new Error('Cancelled'));
                if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1);
                else if (ch >= ' ') buf += ch;
            }
        };
        stdin.on('data', onData);
    });
}

/** Lee TODO stdin (para --stdin / pipes). */
function readAllStdin(maxBytes = 512 * 1024) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        process.stdin.on('data', (c) => {
            size += c.length;
            if (size > maxBytes) { reject(new Error(`Input exceeds ${maxBytes} bytes`)); process.stdin.destroy(); return; }
            chunks.push(c);
        });
        process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        process.stdin.on('error', reject);
    });
}

module.exports = { readLine, readSecret, readAllStdin };
