import { describe, it, expect } from 'vitest';
import { consume, createSealed, getMeta, type StoreDeps } from '../store';
import { createSealedSchema, effectiveTtlDays } from '../schema';
import { sealMessage } from '../crypto';

function makeDeps(now = { t: Date.parse('2026-09-29T12:00:00Z') }) {
    const files = new Map<string, string>();
    let n = 0;
    const deps: StoreDeps = {
        get: async (k) => files.get(k) ?? null,
        put: async (k, b) => { files.set(k, b); },
        del: async (k) => { files.delete(k); },
        wrap: (p) => `enc:${Buffer.from(p).toString('base64')}`,
        unwrap: (c) => Buffer.from(c.replace(/^enc:/, ''), 'base64').toString('utf8'),
        now: () => now.t,
        newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    };
    return { deps, files, now };
}

const env = async () => (await sealMessage({ subject: 's', html: '<p>x</p>' })).envelope;

describe('almacen de mensajes sellados', () => {
    it('guarda solo el sobre (y metadatos) y nunca la clave', async () => {
        const { deps, files } = makeDeps();
        const sealed = await sealMessage({ subject: 'secreto', html: '<p>cuerpo</p>' });
        const { id } = await createSealed(deps, { envelope: sealed.envelope, sender: 'a@x.com', ttlDays: 7, maxViews: null });
        const stored = deps.unwrap(files.get(`secure/${id}.sealed`)!);
        expect(stored).not.toContain(sealed.key);
        expect(stored).not.toContain('cuerpo');
        expect(stored).not.toContain('secreto');
    });

    it('TTL: caduca y se borra; el meta no cuenta vistas', async () => {
        const { deps, files, now } = makeDeps();
        const { id } = await createSealed(deps, { envelope: await env(), sender: 'a@x.com', ttlDays: 1, maxViews: 2 });
        expect((await getMeta(deps, id))?.remainingViews).toBe(2);
        expect((await getMeta(deps, id))?.remainingViews).toBe(2); // sigue igual: no cuenta
        now.t += 25 * 3600 * 1000;
        expect(await getMeta(deps, id)).toBeNull();
        expect(files.has(`secure/${id}.sealed`)).toBe(false);
        expect(await consume(deps, id)).toBeNull();
    });

    it('limite de vistas: la ultima entrega borra el objeto', async () => {
        const { deps, files } = makeDeps();
        const { id } = await createSealed(deps, { envelope: await env(), sender: 'a@x.com', ttlDays: 7, maxViews: 2 });
        const first = await consume(deps, id);
        expect(first && first.format === 'sealed' && first.remainingViews).toBe(1);
        const second = await consume(deps, id);
        expect(second && second.format === 'sealed' && second.remainingViews).toBe(0);
        expect(files.has(`secure/${id}.sealed`)).toBe(false);
        expect(await consume(deps, id)).toBeNull();
        expect(await getMeta(deps, id)).toBeNull();
    });

    it('con 5 lecturas simultaneas y maxViews=1 solo una obtiene el contenido', async () => {
        const { deps } = makeDeps();
        const { id } = await createSealed(deps, { envelope: await env(), sender: 'a@x.com', ttlDays: 7, maxViews: 1 });
        const results = await Promise.all(Array.from({ length: 5 }, () => consume(deps, id)));
        expect(results.filter(Boolean)).toHaveLength(1);
    });

    it('sin limite de vistas no reescribe el objeto', async () => {
        const { deps } = makeDeps();
        let puts = 0;
        const original = deps.put;
        deps.put = async (k, b) => { puts++; return original(k, b); };
        const { id } = await createSealed(deps, { envelope: await env(), sender: 'a@x.com', ttlDays: 7, maxViews: null });
        expect(puts).toBe(1);
        await consume(deps, id);
        await consume(deps, id);
        expect(puts).toBe(1);
    });

    it('ids invalidos (path traversal) no tocan el almacenamiento', async () => {
        const { deps } = makeDeps();
        let reads = 0;
        deps.get = async () => { reads++; return null; };
        expect(await getMeta(deps, '../../etc/passwd')).toBeNull();
        expect(await consume(deps, 'secure/../x')).toBeNull();
        expect(reads).toBe(0);
    });

    it('mensajes legados (.msg) siguen legibles y caducan', async () => {
        const { deps, files, now } = makeDeps();
        const id = '11111111-1111-4111-8111-111111111111';
        files.set(`secure/${id}.msg`, deps.wrap(JSON.stringify({ subject: 'viejo', content: '<p>hola</p>', sender: 'a@x.com', createdAt: '2026-09-01T00:00:00Z', expiresAt: '2026-10-30T00:00:00Z' })));
        expect((await getMeta(deps, id))?.format).toBe('legacy');
        const r = await consume(deps, id);
        expect(r && r.format === 'legacy' && r.subject).toBe('viejo');
        now.t = Date.parse('2026-11-05T00:00:00Z');
        expect(await consume(deps, id)).toBeNull();
    });
});

describe('validacion zod de la creacion', () => {
    const base = { iv: 'AAAAAAAAAAAAAAAA', ct: 'A'.repeat(40) };
    it('acepta sobres validos y rechaza campos extra o formas invalidas', () => {
        expect(createSealedSchema.safeParse({ v: 1, envelope: { v: 1, alg: 'A256GCM', pw: false, ...base } }).success).toBe(true);
        expect(createSealedSchema.safeParse({ v: 1, envelope: { v: 1, alg: 'A256GCM', pw: false, ...base, key: 'x' } }).success).toBe(false);
        expect(createSealedSchema.safeParse({ v: 1, envelope: { v: 1, alg: 'A256GCM', pw: false, ...base }, key: 'x' }).success).toBe(false);
        expect(createSealedSchema.safeParse({ v: 1, envelope: { v: 1, alg: 'A256GCM', pw: false, iv: 'corto', ct: base.ct } }).success).toBe(false);
        expect(createSealedSchema.safeParse({ v: 1, envelope: { v: 1, alg: 'A256GCM', pw: true, kdf: 'PBKDF2-SHA256', iter: 10, salt: 'A'.repeat(22), ...base } }).success).toBe(false);
        expect(createSealedSchema.safeParse({ v: 1, envelope: { v: 1, alg: 'A256GCM', pw: false, ...base }, maxViews: 0 }).success).toBe(false);
        expect(createSealedSchema.safeParse({ v: 1, envelope: { v: 1, alg: 'A256GCM', pw: false, ...base }, maxViews: 1000 }).success).toBe(false);
    });

    it('el TTL pedido nunca supera SECURE_MESSAGE_TTL_DAYS', () => {
        const prev = process.env.SECURE_MESSAGE_TTL_DAYS;
        process.env.SECURE_MESSAGE_TTL_DAYS = '10';
        expect(effectiveTtlDays(undefined)).toBe(10);
        expect(effectiveTtlDays(3)).toBe(3);
        expect(effectiveTtlDays(365)).toBe(10);
        if (prev === undefined) delete process.env.SECURE_MESSAGE_TTL_DAYS; else process.env.SECURE_MESSAGE_TTL_DAYS = prev;
    });
});
