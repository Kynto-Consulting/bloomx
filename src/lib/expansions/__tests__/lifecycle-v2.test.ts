import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateEd25519KeyPair } from '@/lib/bloomx-signature';
import { buildEmailSpamDetectedContext, buildLabelAppliedContext, buildUserCreatedContext, buildUserDisabledContext } from '../server-hooks';
import { emitEmailSpamDetected, emitLabelApplied, emitUserCreated, emitUserDisabled } from '../lifecycle-v2';

const ok = () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }) as any;
const savedEnv = { ...process.env };
const flush = () => new Promise((r) => setTimeout(r, 5));
const withKey = () => { process.env.BLOOMX_DOMAIN_PRIVATE_KEY = generateEd25519KeyPair().privatePem; };
const base = (fetchImpl: any) => ({ fetchImpl, backendUrl: 'https://be', host: 'acme.com', inline: true, loadDisabled: async () => [] });
const bodyOf = (f: any, i = 0) => JSON.parse((f.mock.calls[i] as any)[1].body);

beforeEach(() => {
    delete process.env.EXTENSION_HOOKS_DISABLED;
    delete process.env.BLOOMX_DOMAIN_PRIVATE_KEY;
    vi.spyOn(console, 'error').mockImplementation(() => { });
});
afterEach(() => { process.env = { ...savedEnv }; vi.restoreAllMocks(); });

describe('constructores v2 (payload versionado y minimo)', () => {
    it('USER_CREATED: sin contrasena, hash ni nombre; eventKey determinista', () => {
        const ctx = buildUserCreatedContext({ userId: 'u1', email: 'Ana <ANA@Acme.com>', source: 'register', createdAt: '2026-01-01T00:00:00Z', password: 'x', name: 'Ana' } as any);
        expect(ctx).toEqual({ v: 1, eventKey: 'uc:u1', subjectUserId: 'u1', email: 'ana@acme.com', emailDomain: 'acme.com', source: 'register', createdAt: '2026-01-01T00:00:00.000Z' });
        expect(buildUserCreatedContext({ userId: 'u1', email: 'a@b.com', source: 'hack' }).source).toBe('admin');
    });
    it('USER_DISABLED: eventKey depende de la transicion', () => {
        const a = buildUserDisabledContext({ userId: 'u1', email: 'a@b.com', disabledAt: '2026-01-01T00:00:00Z' });
        const b = buildUserDisabledContext({ userId: 'u1', email: 'a@b.com', disabledAt: '2026-02-01T00:00:00Z' });
        expect(a.eventKey).not.toBe(b.eventKey);
        expect(a).toMatchObject({ v: 1, subjectUserId: 'u1', emailDomain: 'b.com' });
    });
    it('EMAIL_SPAM_DETECTED: sin asunto, cuerpo ni destinatarios; razones acotadas y validadas', () => {
        const ctx = buildEmailSpamDetectedContext({ emailId: 'e1', from: 'Eve <eve@evil.io>', verdict: 'phishing', score: 91.234, action: 'junk', reasons: ['auth.fail', 'bad reason!', ...Array.from({ length: 30 }, (_, i) => `r${i}`)], subject: 'S', text: 'T', html: 'H', to: 'x@y.z' } as any);
        expect(ctx).toMatchObject({ v: 1, eventKey: 'sp:e1', emailId: 'e1', fromEmail: 'eve@evil.io', fromDomain: 'evil.io', verdict: 'phishing', action: 'junk', score: 91.23 });
        expect((ctx.reasons as string[]).length).toBe(10);
        expect(JSON.stringify(ctx)).not.toMatch(/"(subject|text|html|to|body)"/);
    });
    it('LABEL_APPLIED: origen validado, ruleId opcional', () => {
        expect(buildLabelAppliedContext({ emailId: 'e1', labelId: 'l1', labelName: 'Facturas', source: 'rule', ruleId: 'r1' })).toEqual({ v: 1, eventKey: 'lb:e1:l1', emailId: 'e1', labelId: 'l1', source: 'rule', labelName: 'Facturas', ruleId: 'r1' });
        expect(buildLabelAppliedContext({ emailId: 'e1', labelId: 'l1', source: 'zzz' }).source).toBe('user');
    });
});

describe('emision', () => {
    it('sin clave de dominio (legado): no-op', () => {
        const f = vi.fn(ok);
        expect(emitUserCreated({ id: 'u-leg', email: 'a@b.com' }, 'admin', base(f) as any)).toBe(false);
        expect(f).not.toHaveBeenCalled();
    });

    it('USER_CREATED / USER_DISABLED llegan al backend con el sujeto como usuario firmado', async () => {
        withKey();
        const f = vi.fn(async () => ok());
        expect(emitUserCreated({ id: 'u-new1', email: 'n@acme.com' }, 'import', base(f) as any)).toBe(true);
        expect(emitUserDisabled({ id: 'u-dis1', email: 'd@acme.com' }, base(f) as any)).toBe(true);
        await flush();
        const events = f.mock.calls.map((_c, i) => bodyOf(f, i).event).sort();
        expect(events).toEqual(['USER_CREATED', 'USER_DISABLED']);
        const created = bodyOf(f, f.mock.calls.findIndex((c: any) => JSON.parse(c[1].body).event === 'USER_CREATED'));
        expect(created.context).toMatchObject({ v: 1, subjectUserId: 'u-new1', source: 'import' });
        expect(JSON.stringify(created)).not.toMatch(/password|hash/i);
    });

    it('idempotente: el mismo hecho se descarta durante la ventana de dedupe', async () => {
        withKey();
        const f = vi.fn(async () => ok());
        expect(emitUserCreated({ id: 'u-dup', email: 'd@acme.com' }, 'register', base(f) as any)).toBe(true);
        expect(emitUserCreated({ id: 'u-dup', email: 'd@acme.com' }, 'register', base(f) as any)).toBe(false);
        await flush();
        expect(f).toHaveBeenCalledTimes(1);
    });

    it('un fallo del backend (red, 5xx, timeout) no lanza ni afecta a quien emite', async () => {
        withKey();
        const boom = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
        expect(() => emitUserCreated({ id: 'u-f1', email: 'a@acme.com' }, 'admin', base(boom) as any)).not.toThrow();
        const five = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as any);
        expect(() => emitUserDisabled({ id: 'u-f2', email: 'a@acme.com' }, base(five) as any)).not.toThrow();
        const hang = vi.fn((_u: string, init: any) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('abort'), { name: 'AbortError' })))));
        expect(() => emitUserCreated({ id: 'u-f3', email: 'a@acme.com' }, 'admin', { ...base(hang), timeoutMs: 10 } as any)).not.toThrow();
        await new Promise((r) => setTimeout(r, 40));
        expect(boom).toHaveBeenCalled();
        expect(hang).toHaveBeenCalled();
    });

    it('EMAIL_SPAM_DETECTED: solo spam/warned; limpio no emite; phishing si hay suplantacion', async () => {
        withKey();
        const f = vi.fn(async () => ok());
        expect(emitEmailSpamDetected('u-sp', { emailId: 'e-clean', from: 'a@b.com' }, { decision: 'delivered', score: 1 }, base(f) as any)).toBe(false);
        expect(emitEmailSpamDetected('u-sp', { emailId: 'e-spam', from: 'x@evil.io' }, { decision: 'spam', score: 88, signals: [{ id: 'imp.display', family: 'impersonation', weight: 30 }, { id: 'auth.dkim', family: 'auth', weight: 10 }] }, base(f) as any)).toBe(true);
        expect(emitEmailSpamDetected('u-sp', { emailId: 'e-warn', from: 'x@evil.io' }, { decision: 'warned', score: 50 }, base(f) as any)).toBe(true);
        await flush();
        const bodies = f.mock.calls.map((_c, i) => bodyOf(f, i));
        const spam = bodies.find((b) => b.context.emailId === 'e-spam');
        const warn = bodies.find((b) => b.context.emailId === 'e-warn');
        expect(spam.context).toMatchObject({ verdict: 'phishing', action: 'junk', reasons: ['imp.display', 'auth.dkim'] });
        expect(warn.context).toMatchObject({ verdict: 'suspicious', action: 'flag' });
    });

    it('LABEL_APPLIED: una llamada por etiqueta (max 5), con nombre; sin clave no consulta la BD', async () => {
        const lookup = vi.fn(async () => [{ id: 'l1', name: 'Facturas' }]);
        expect(await emitLabelApplied('u-lb', 'e1', ['l1'], 'user', { lookup })).toBe(0);
        expect(lookup).not.toHaveBeenCalled();
        withKey();
        const f = vi.fn(async () => ok());
        const n = await emitLabelApplied('u-lb2', 'e2', ['l1', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'], 'rule', { lookup, opts: base(f) as any });
        await flush();
        expect(n).toBe(5);
        expect(f).toHaveBeenCalledTimes(5);
        expect(bodyOf(f, 0).context).toMatchObject({ labelId: 'l1', labelName: 'Facturas', source: 'rule' });
    });

    it('LABEL_APPLIED: si la consulta de nombres falla, el evento sale igual', async () => {
        withKey();
        const f = vi.fn(async () => ok());
        const n = await emitLabelApplied('u-lb3', 'e3', ['lx'], 'user', { lookup: async () => { throw new Error('db down'); }, opts: base(f) as any });
        await flush();
        expect(n).toBe(1);
        expect(bodyOf(f).context.labelName).toBeUndefined();
    });
});

describe('USER_ENABLED', () => {
    it('constructor y emision', async () => {
        const { buildUserEnabledContext } = await import('../server-hooks');
        const { emitUserEnabled } = await import('../lifecycle-v2');
        const ctx = buildUserEnabledContext({ userId: 'u1', email: 'A@B.com', enabledAt: '2026-01-01T00:00:00Z' });
        expect(ctx).toMatchObject({ v: 1, subjectUserId: 'u1', email: 'a@b.com', emailDomain: 'b.com', enabledAt: '2026-01-01T00:00:00.000Z' });
        withKey();
        const f = vi.fn(async () => ok());
        expect(emitUserEnabled({ id: 'u-en1', email: 'e@acme.com' }, base(f) as any)).toBe(true);
        await flush();
        expect(bodyOf(f).event).toBe('USER_ENABLED');
    });
});
