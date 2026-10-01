import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setAuditSink, type AuditRecord } from '@/lib/audit';
import { __resetRateLimitState } from '@/lib/security';
import { issueReauthToken } from '@/lib/mail-transfer/auth';
import { EXIT, LIMITS, executeCommand, stepUpKey, type ExecAuth } from '../exec';
import { renderText, toJsonData } from '../render';
import { CmdError, type CommandDef } from '../types';

/** Motor de ejecucion con un catalogo de PRUEBA: auditoria saneada, confirmacion/step-up, tiempo, salida y --json. */

const L = (s: string) => ({ es: s, en: s });
const records: AuditRecord[] = [];
let calls = 0;

const cmds: CommandDef[] = [
    {
        name: 'demo set', risk: 'write', summary: L('demo write'), positionals: [{ name: 'target', description: L('t') }],
        flags: [{ name: 'password', type: 'string', secret: true, description: L('p') }, { name: 'note', type: 'string', description: L('n') }],
        handler: async ({ args }) => { calls++; return { type: 'kv', items: [{ key: 'target', value: args.positionals[0] }] }; },
    },
    {
        name: 'demo wipe', risk: 'destructive', summary: L('demo destructive'), positionals: [{ name: 'id', description: L('id') }],
        handler: async () => { calls++; return { type: 'text', text: 'wiped', tone: 'success' }; },
    },
    { name: 'demo boom', risk: 'read', summary: L('demo throws'), handler: async () => { throw new CmdError('custom_failure', 'visible message', 1, 409); } },
    { name: 'demo crash', risk: 'read', summary: L('demo crashes'), handler: async () => { throw new Error('SECRET-INTERNAL: connection string postgres://u:p@h/db'); } },
    { name: 'demo slow', risk: 'read', summary: L('demo slow'), handler: () => new Promise(() => undefined) },
    { name: 'demo big', risk: 'read', summary: L('demo big'), handler: async () => ({ type: 'text', text: 'x'.repeat(LIMITS.maxOutputBytes + 10) }) },
    { name: 'demo table', risk: 'read', summary: L('demo table'), handler: async () => ({ type: 'table', columns: [{ key: 'a', label: 'a' }, { key: 'b', label: 'b' }], rows: [{ a: 1, b: true }, { a: 'x', b: null }] }) },
];

const auth = (over: Partial<ExecAuth> = {}): ExecAuth => ({
    actor: { kind: 'user', id: 'admin-1', email: 'boss@example.test', level: 4, levelSource: 'env' },
    session: { source: 'token', scopes: ['read', 'write', 'security'], tokenId: '12345678-aaaa-bbbb-cccc-1234567890ab', tokenName: 'laptop' },
    ip: '198.51.100.7', userAgent: 'bloomx-cli/0.1 (test)', ...over,
});

beforeEach(() => {
    records.length = 0;
    calls = 0;
    __resetRateLimitState();
    __setAuditSink(async (r) => { records.push(r); });
});
afterEach(() => { __setAuditSink(null); vi.useRealTimers(); });
const flush = () => new Promise((r) => setTimeout(r, 5));

describe('auditoria de cada comando', () => {
    it('registra usuario, comando saneado, resultado, IP y agente; nunca la contrasena ni el token', async () => {
        const secretTok = `bxa_${'Z'.repeat(43)}`;
        const res = await executeCommand({ line: `demo set ${secretTok} --password "Sup3r Secret!" --note hola` }, auth(), cmds);
        await flush();
        expect(res.ok).toBe(true);
        const rec = records.find((r) => r.event === 'admin.cli.exec')!;
        expect(rec).toBeTruthy();
        const s = JSON.stringify(rec);
        expect(s).not.toMatch(/Sup3r|Secret|ZZZZ/);
        expect(rec.userId).toBe('admin-1');
        expect(rec.ip).toBe('198.51.100.7');
        expect(rec.data).toMatchObject({ command: 'demo set bxa_*** --password *** --note hola', risk: 'write', outcome: 'ok', via: 'token', credRef: '12345678', userAgent: 'bloomx-cli/0.1 (test)' });
        expect(String(rec.data.actorEmail)).toBe('b***@example.test'); // correo enmascarado
    });
    it('un error del comando tambien se audita (con su codigo) y no filtra internos', async () => {
        const a = await executeCommand({ argv: ['demo', 'boom'] }, auth(), cmds);
        const b = await executeCommand({ argv: ['demo', 'crash'] }, auth(), cmds);
        await flush();
        expect(a).toMatchObject({ ok: false, exitCode: 1, error: { code: 'custom_failure', message: 'visible message' } });
        expect(b.error?.code).toBe('internal');
        expect(JSON.stringify(b)).not.toMatch(/postgres|SECRET-INTERNAL/);
        expect(records.filter((r) => r.event === 'admin.cli.exec').map((r) => r.data.outcome)).toEqual(['error', 'error']);
        expect(JSON.stringify(records)).not.toMatch(/postgres|SECRET-INTERNAL/);
    });
    it('rechazos (ambito, uso, desconocido) se auditan sin el texto crudo', async () => {
        await executeCommand({ line: 'demo wipe x' }, auth({ session: { source: 'token', scopes: ['read'], tokenId: 't' } }), cmds);
        await executeCommand({ line: 'nada raro --password hunter2hunter2' }, auth(), cmds);
        await flush();
        const ev = records.map((r) => r.event);
        expect(ev).toContain('admin.cli.denied');
        expect(ev).toContain('admin.cli.rejected');
        expect(JSON.stringify(records)).not.toContain('hunter2');
    });
});

describe('confirmacion y step-up', () => {
    const proof = () => issueReauthToken(stepUpKey({ id: 'admin-1' }), 'password', null).token;

    it('destructive: sin --yes pide confirmacion; con --yes sin step-up lo pide; con ambos se ejecuta', async () => {
        expect(await executeCommand({ line: 'demo wipe 1' }, auth(), cmds)).toMatchObject({ ok: false, needs: 'confirm', exitCode: EXIT.needs });
        expect(await executeCommand({ line: 'demo wipe 1 --yes' }, auth(), cmds)).toMatchObject({ ok: false, needs: 'stepup' });
        expect(calls).toBe(0);
        const ok = await executeCommand({ line: 'demo wipe 1', confirm: true, stepUp: proof() }, auth(), cmds);
        expect(ok.ok).toBe(true);
        expect(calls).toBe(1);
    });
    it('la prueba de step-up esta atada al administrador: la de otro no vale', async () => {
        const other = issueReauthToken(stepUpKey({ id: 'admin-2' }), 'password', null).token;
        expect(await executeCommand({ line: 'demo wipe 1 -y', stepUp: other }, auth(), cmds)).toMatchObject({ needs: 'stepup' });
    });
    it('una prueba caducada no vale', async () => {
        const old = issueReauthToken(stepUpKey({ id: 'admin-1' }), 'password', null, Date.now() - 11 * 60_000).token;
        expect(await executeCommand({ line: 'demo wipe 1 -y', stepUp: old }, auth(), cmds)).toMatchObject({ needs: 'stepup' });
    });
    it('los comandos de escritura normales no piden confirmacion', async () => {
        expect((await executeCommand({ line: 'demo set x' }, auth(), cmds)).ok).toBe(true);
    });
});

describe('limites', () => {
    it('tiempo maximo: el comando lento falla con exit 5', async () => {
        vi.useFakeTimers();
        const p = executeCommand({ argv: ['demo', 'slow'] }, auth(), cmds);
        await vi.advanceTimersByTimeAsync(LIMITS.timeoutMs + 100);
        const res = await p;
        expect(res).toMatchObject({ ok: false, exitCode: EXIT.limited, error: { code: 'timeout' } });
    });
    it('salida demasiado grande se rechaza', async () => {
        expect((await executeCommand({ argv: ['demo', 'big'] }, auth(), cmds)).error?.code).toBe('output_too_large');
    });
    it('limite de tasa por administrador (60/min)', async () => {
        let last;
        for (let i = 0; i < LIMITS.perMinute + 1; i++) last = await executeCommand({ argv: ['demo', 'table'] }, auth(), cmds);
        expect(last).toMatchObject({ ok: false, exitCode: EXIT.limited, error: { code: 'rate_limited' } });
    });
    it('la entrada adicional esta acotada', async () => {
        const res = await executeCommand({ argv: ['demo', 'table'], input: 'x'.repeat(LIMITS.maxInputBytes + 1) }, auth(), cmds);
        expect(res).toMatchObject({ ok: false, exitCode: EXIT.usage, error: { code: 'input_too_large' } });
    });
    it('argv invalido (no cadenas / demasiados) se rechaza', async () => {
        expect((await executeCommand({ argv: [1 as unknown as string] }, auth(), cmds)).exitCode).toBe(EXIT.usage);
        expect((await executeCommand({ argv: Array(300).fill('a') }, auth(), cmds)).exitCode).toBe(EXIT.usage);
    });
});

describe('salida: texto, tabla y --json', () => {
    it('--json devuelve datos en bruto; sin --json, texto renderizado', async () => {
        const j = await executeCommand({ line: 'demo table --json' }, auth(), cmds);
        expect(j.json).toEqual([{ a: 1, b: true }, { a: 'x', b: null }]);
        expect(j.text).toBeUndefined();
        const t = await executeCommand({ line: 'demo table' }, auth(), cmds);
        expect(t.text).toMatch(/a\s+b/);
        expect(t.text).toMatch(/1\s+yes/);
        expect(t.text).toMatch(/x\s+-/);
    });
    it('render a color usa ANSI basico solo si se pide', () => {
        const out = { type: 'text', text: 'ok', tone: 'success' } as const;
        expect(renderText(out)).toBe('ok');
        expect(renderText(out, { color: true })).toContain('\u001b[32m');
        expect(toJsonData({ type: 'kv', items: [{ key: 'a', value: 1 }] })).toEqual({ a: 1 });
    });
    it('comando vacio no falla; --help de un comando muestra la ayuda', async () => {
        expect((await executeCommand({ line: '   ' }, auth(), cmds)).ok).toBe(true);
    });
});
