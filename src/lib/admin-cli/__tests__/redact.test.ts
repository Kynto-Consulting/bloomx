import { describe, expect, it } from 'vitest';
import { REDACTED, sanitizeCommand } from '../redact';
import { COMMANDS } from '../catalog';
import { matchCommand, tokenize } from '../parser';
import { redactAuditData } from '@/lib/audit';

const san = (line: string) => {
    const argv = tokenize(line);
    return sanitizeCommand(argv, matchCommand(COMMANDS, argv)?.def ?? null);
};

describe('redaccion de comandos para la auditoria', () => {
    it('oculta el valor de banderas secretas (separado y con =)', () => {
        const a = san('users create a@b.co --password "Sup3r Secret Pass" --name Ana');
        expect(a).not.toMatch(/Sup3r|Secret/);
        expect(a).toContain(`--password ${REDACTED}`);
        expect(a).toContain('--name Ana');
        expect(san('users create a@b.co --password=Sup3rSecretPass')).toBe(`users create a@b.co --password=${REDACTED}`);
    });
    it('oculta valores de credenciales de extensiones y contrasenas ZIP/exportacion', () => {
        expect(san('extensions credentials set core-zoom ZOOM_SECRET --value abcdef123456')).not.toContain('abcdef123456');
        expect(san('transfer export --password hunter2hunter2 --confirm-domain x.com')).not.toContain('hunter2');
        expect(san('transfer import-password job123456 --password zipsecret')).not.toContain('zipsecret');
        expect(san('security keys register --public-key "-----BEGIN PUBLIC KEY-----abc"')).not.toContain('BEGIN');
    });
    it('oculta tokens de CLI y Bearer aunque aparezcan como argumento suelto', () => {
        const tok = `bxa_${'A'.repeat(43)}`;
        expect(san(`tokens revoke ${tok}`)).not.toContain(tok);
        expect(san(`search ${tok}`)).not.toContain(tok);
        expect(san('search "Bearer abcdefghijklmnop"')).not.toContain('abcdefghij');
    });
    it('volcados JSON/CSV solo registran su tamano', () => {
        const out = san(`retention set --values '{"a":"secreto-largo"}'`);
        expect(out).not.toContain('secreto-largo');
        expect(san('spam config set --level strict')).toContain('--level strict');
    });
    it('banderas desconocidas se tratan como secretas (falla cerrado) y comandos desconocidos solo dejan 2 palabras', () => {
        expect(sanitizeCommand(['nope', 'sub', '--mystery', 'valor-secreto', 'otro'], null)).toBe('nope sub [3 args]');
        expect(san('users list --mystery valor-secreto')).not.toContain('valor-secreto');
    });
    it('recorta valores largos', () => {
        expect(san(`users list --q ${'x'.repeat(500)}`).length).toBeLessThan(200);
    });
    it('toda bandera de catalogo cuyo nombre suene a secreto esta marcada o se redacta', () => {
        for (const c of COMMANDS) {
            for (const f of c.flags ?? []) {
                if (/pass|secret|token|key|code|otp|credential|cookie|recovery|private/i.test(f.name) && f.type !== 'boolean') {
                    const out = sanitizeCommand([...c.name.split(' '), ...(c.positionals ?? []).filter((p) => p.required !== false).map(() => 'x'), `--${f.name}`, 'VALOR-SECRETO'], c);
                    expect(out, `${c.name} --${f.name}`).not.toContain('VALOR-SECRETO');
                }
            }
        }
    });
    it('una ejecucion con --password nunca llega al registro de auditoria (redactAuditData tambien lo descarta)', () => {
        const rec = redactAuditData({ command: san('users create a@b.co --password X1234567890abc'), password: 'plain', token: 'bxa_x', code: '123456', cookie: 'c' });
        const s = JSON.stringify(rec);
        expect(s).not.toMatch(/X1234567890abc|"plain"|bxa_x|123456/);
    });
});
