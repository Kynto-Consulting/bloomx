import { describe, expect, it, vi } from 'vitest';
import { BridgeError } from '../host-services/bridge-route';
import { STORAGE_MAX_VALUE_BYTES, STORAGE_QUOTA_BYTES, handleStorage, storageRequest, type StorageRequest, type StorageStore } from '../host-services/storage';
import { NOTIFY_MAX_PENDING, handleNotify, notifyRequest, type NotifyDeps, type NotifyRequest } from '../host-services/notify';
import { safeToastUrl } from '../host-services/notify-url';
import { formatsRequest, handleFormats, defaultFormatsDeps, type FormatsRequest } from '../host-services/formats';
import { showExtensionToast } from '../client/use-extension-notifications';

const code = async (p: Promise<unknown>) => { try { await p; return 'no-error'; } catch (e) { return e instanceof BridgeError ? e.code : `other:${(e as Error).message}`; } };
const base = { userId: 'u1', extensionId: 'ext.one' };

// ---- storage ---------------------------------------------------------------------------------------------------
function memoryStore(): StorageStore & { data: Map<string, { value: string; bytes: number }> } {
    const data = new Map<string, { value: string; bytes: number }>();
    const k = (u: string, e: string, key: string) => `${u}|${e}|${key}`;
    const used = (u: string, e: string) => [...data].filter(([id]) => id.startsWith(`${u}|${e}|`)).reduce((s, [, v]) => s + v.bytes, 0);
    return {
        data,
        get: async (u, e, key) => data.get(k(u, e, key))?.value ?? null,
        set: async (u, e, key, value, bytes) => {
            const old = data.get(k(u, e, key))?.bytes ?? 0;
            const next = used(u, e) - old + bytes;
            if (next > STORAGE_QUOTA_BYTES) return { ok: false, reason: 'quota' };
            data.set(k(u, e, key), { value, bytes });
            return { ok: true, usedBytes: next };
        },
        delete: async (u, e, key) => data.delete(k(u, e, key)),
        list: async (u, e, prefix, limit) => ({
            keys: [...data.keys()].filter((id) => id.startsWith(`${u}|${e}|${prefix}`)).map((id) => id.split('|').slice(2).join('|')).sort().slice(0, limit),
            usedBytes: used(u, e),
        }),
    };
}
const st = (store: StorageStore, body: Record<string, unknown>, who = base) =>
    handleStorage(store, storageRequest.parse({ ...who, ...body }) as StorageRequest) as Promise<any>;

describe('services.storage', () => {
    it('esquema: clave valida, claves desconocidas, value obligatorio', () => {
        for (const key of ['', 'a b', 'a$', 'x'.repeat(129), '../../etc']) {
            expect(storageRequest.safeParse({ ...base, op: 'get', args: { key: key === '../../etc' ? 'a\\b' : key } }).success, key).toBe(false);
        }
        expect(storageRequest.safeParse({ ...base, op: 'get', args: { key: 'a/b:c.d-e_f' } }).success).toBe(true);
        expect(storageRequest.safeParse({ ...base, op: 'get', args: { key: 'a', x: 1 } }).success).toBe(false);
        expect(storageRequest.safeParse({ ...base, op: 'set', args: { key: 'a' } }).success).toBe(false);
        expect(storageRequest.safeParse({ ...base, op: 'set', args: { key: 'a', value: null } }).success).toBe(true);
        expect(storageRequest.safeParse({ ...base, op: 'list', args: { limit: 101 } }).success).toBe(false);
    });
    it('set/get/list/delete con valores JSON y bytes exactos', async () => {
        const s = memoryStore();
        const r = await st(s, { op: 'set', args: { key: 'k1', value: { a: [1, 'é'] } } });
        expect(r).toEqual({ ok: true, usedBytes: 2 + Buffer.byteLength('{"a":[1,"é"]}'), quotaBytes: STORAGE_QUOTA_BYTES });
        expect((await st(s, { op: 'get', args: { key: 'k1' } })).value).toEqual({ a: [1, 'é'] });
        expect((await st(s, { op: 'get', args: { key: 'nope' } })).value).toBeNull();
        await st(s, { op: 'set', args: { key: 'p/2', value: 1 } });
        expect((await st(s, { op: 'list', args: { prefix: 'p/' } })).keys).toEqual(['p/2']);
        expect(await st(s, { op: 'delete', args: { key: 'k1' } })).toEqual({ deleted: true });
        expect(await st(s, { op: 'delete', args: { key: 'k1' } })).toEqual({ deleted: false });
    });
    it('aislamiento por usuario y por extension', async () => {
        const s = memoryStore();
        await st(s, { op: 'set', args: { key: 'k', value: 'mio' } });
        expect((await st(s, { op: 'get', args: { key: 'k' } }, { userId: 'u2', extensionId: 'ext.one' })).value).toBeNull();
        expect((await st(s, { op: 'get', args: { key: 'k' } }, { userId: 'u1', extensionId: 'ext.two' })).value).toBeNull();
    });
    it('valor > 64 KB => quota_exceeded; cuota total 256 KB => quota_exceeded; sobrescribir no suma dos veces', async () => {
        const s = memoryStore();
        expect(await code(st(s, { op: 'set', args: { key: 'big', value: 'x'.repeat(STORAGE_MAX_VALUE_BYTES) } }))).toBe('quota_exceeded');
        const chunk = 'x'.repeat(60 * 1024);
        for (let i = 0; i < 4; i++) expect(await code(st(s, { op: 'set', args: { key: `c${i}`, value: chunk } }))).toBe('no-error');
        expect(await code(st(s, { op: 'set', args: { key: 'c4', value: chunk } }))).toBe('quota_exceeded');
        expect(await code(st(s, { op: 'set', args: { key: 'c0', value: chunk } }))).toBe('no-error'); // misma clave: reemplaza
        // Otra extension del mismo usuario tiene su propia cuota
        expect(await code(st(s, { op: 'set', args: { key: 'c4', value: chunk } }, { userId: 'u1', extensionId: 'ext.two' }))).toBe('no-error');
    });
});

// ---- notify ----------------------------------------------------------------------------------------------------
function notifyDeps(over: Partial<NotifyDeps> = {}) {
    const rows: any[] = [];
    const deps: NotifyDeps = {
        store: {
            enqueue: async (n, max) => {
                if (rows.filter((r) => r.userId === n.userId && r.extensionId === n.extensionId).length >= max) return false;
                rows.push(n);
                return true;
            },
            takePending: async () => [],
        },
        rateLimit: async () => ({ ok: true, retryAfter: 0 }),
        newId: (() => { let i = 0; return () => `id${++i}`; })(),
        ...over,
    };
    return { deps, rows };
}
const nt = (deps: NotifyDeps, args: Record<string, unknown>, who = base) =>
    handleNotify(deps, notifyRequest.parse({ ...who, op: 'toast', args }) as NotifyRequest) as Promise<any>;

describe('services.notify', () => {
    it('esquema estricto: limites, nivel, claves desconocidas', () => {
        const ok = (args: unknown) => notifyRequest.safeParse({ ...base, op: 'toast', args }).success;
        expect(ok({ message: 'hola' })).toBe(true);
        expect(ok({})).toBe(false);
        expect(ok({ message: '' })).toBe(false);
        expect(ok({ message: 'x'.repeat(201) })).toBe(false);
        expect(ok({ message: 'a', title: 'x'.repeat(81) })).toBe(false);
        expect(ok({ message: 'a', level: 'fatal' })).toBe(false);
        expect(ok({ message: 'a', extra: 1 })).toBe(false);
        expect(ok({ message: 'a', url: 'javascript:alert(1)' })).toBe(false);
    });
    it('persiste saneado, con nivel por defecto info y atribuido a la extension', async () => {
        const { deps, rows } = notifyDeps();
        expect(await nt(deps, { message: 'Hola\r\nmundo', title: 'T\u0007' })).toEqual({ delivered: true });
        expect(rows[0]).toMatchObject({ userId: 'u1', extensionId: 'ext.one', level: 'info', message: 'Hola mundo', title: 'T', url: null });
    });
    it('tope de 20 pendientes por (usuario, extension) => rate_limited; otra extension no se ve afectada', async () => {
        const { deps } = notifyDeps();
        for (let i = 0; i < NOTIFY_MAX_PENDING; i++) await nt(deps, { message: `m${i}` });
        expect(await code(nt(deps, { message: 'extra' }))).toBe('rate_limited');
        expect(await code(nt(deps, { message: 'otra' }, { userId: 'u1', extensionId: 'ext.two' }))).toBe('no-error');
    });
    it('rate limit por minuto => rate_limited con Retry-After', async () => {
        const rateLimit = vi.fn(async () => ({ ok: false, retryAfter: 12 }));
        const { deps, rows } = notifyDeps({ rateLimit });
        const err = await nt(deps, { message: 'a' }).catch((e) => e);
        expect(err).toBeInstanceOf(BridgeError);
        expect(err).toMatchObject({ code: 'rate_limited', retryAfter: 12 });
        expect(rateLimit).toHaveBeenCalledWith('ext-notify:u1:ext.one', 30, 60_000);
        expect(rows).toHaveLength(0);
    });
});

describe('url segura de toast', () => {
    it.each([
        ['/calendar', '/calendar'],
        ['/mail/inbox?x=1#a', '/mail/inbox?x=1#a'],
        ['https://example.com/a', 'https://example.com/a'],
    ])('acepta %s', (input, out) => expect(safeToastUrl(input)).toBe(out));
    it.each([
        '//evil.com', '/\\evil.com', 'javascript:alert(1)', 'data:text/html,x', 'http://example.com', 'https://u:p@example.com',
        'ftp://x.test/a', '/a\nb', ' /a b', 'calendar', '', 'https://', null, 42, `/${'a'.repeat(2001)}`,
    ])('rechaza %j', (input) => expect(safeToastUrl(input)).toBeNull());
});

describe('toast de cliente', () => {
    const mkToasts = () => {
        const calls: Array<{ level: string; msg: string; opts: any }> = [];
        const fns = Object.fromEntries(['info', 'success', 'warning', 'error'].map((l) => [l, (msg: string, opts: any) => { calls.push({ level: l, msg, opts }); }]));
        return { calls, fns };
    };
    it('usa el nivel, el titulo como encabezado y una accion solo con url segura', () => {
        const { calls, fns } = mkToasts();
        const navigate = vi.fn();
        showExtensionToast({ id: '1', level: 'success', title: 'Listo', message: 'Se guardo', url: '/calendar' }, { openLabel: 'Abrir', navigate, toasts: fns });
        expect(calls[0]).toMatchObject({ level: 'success', msg: 'Listo', opts: { description: 'Se guardo', action: { label: 'Abrir' } } });
        calls[0].opts.action.onClick();
        expect(navigate).toHaveBeenCalledWith('/calendar');
    });
    it('una url peligrosa (aunque llegue del servidor) no genera accion; nivel desconocido => info', () => {
        const { calls, fns } = mkToasts();
        showExtensionToast({ id: '2', level: 'rara', message: 'hola', url: 'javascript:alert(1)' }, { openLabel: 'Abrir', navigate: vi.fn(), toasts: fns });
        expect(calls[0]).toMatchObject({ level: 'info', msg: 'hola' });
        expect(calls[0].opts.action).toBeUndefined();
        expect(calls[0].opts.description).toBeUndefined();
    });
});

// ---- formats ---------------------------------------------------------------------------------------------------
const fm = (body: Record<string, unknown>) => handleFormats(defaultFormatsDeps, formatsRequest.parse({ ...base, ...body }) as FormatsRequest) as Promise<any>;

describe('services.formats (remotas)', () => {
    it('esquema estricto: variables escalares, <=50 claves, sin claves de prototipo, limites de tamano', () => {
        const ok = (args: unknown) => formatsRequest.safeParse({ ...base, op: 'renderTemplate', args }).success;
        expect(ok({ template: 'x', variables: { a: 1, b: 'x', c: true, d: null } })).toBe(true);
        expect(ok({ template: 'x', variables: { a: { b: 1 } } })).toBe(false);
        expect(ok({ template: 'x', variables: { a: [1] } })).toBe(false);
        expect(ok({ template: 'x', variables: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, i])) })).toBe(false);
        // Una clave __proto__ nunca llega al motor: o se rechaza o zod la descarta (no crea prototipo ni propiedad propia).
        const p = formatsRequest.safeParse({ ...base, op: 'renderTemplate', args: { template: 'x', variables: JSON.parse('{"__proto__": 1, "a": 2}') } });
        if (p.success) { const v = (p.data.args as any).variables; expect(Object.keys(v)).toEqual(['a']); expect(Object.getPrototypeOf(v)).toBe(Object.prototype); }
        expect(ok({ template: 'x'.repeat(20_001), variables: {} })).toBe(false);
        expect(ok({ template: 'x', variables: {}, extra: 1 })).toBe(false);
        expect(formatsRequest.safeParse({ ...base, op: 'sanitizeHtml', args: { html: 'x'.repeat(200_001) } }).success).toBe(false);
        expect(formatsRequest.safeParse({ ...base, op: 'formatDate', args: {} }).success).toBe(false); // local al backend
    });
    it('renderTemplate renderiza con Liquid', async () => {
        expect(await fm({ op: 'renderTemplate', args: { template: 'Hola {{ name | upcase }} x{{ n }}', variables: { name: 'ana', n: 3 } } })).toEqual({ text: 'Hola ANA x3' });
    });
    it('si el render falla => invalid_args y jamas la plantilla cruda', async () => {
        for (const template of ['{% if %}', '{% for i in (1..99999999) %}x{% endfor %}', '{{ x | nofiltro }}', '{% unknown_tag %}']) {
            const err = await fm({ op: 'renderTemplate', args: { template, variables: { x: 1 } } }).catch((e) => e);
            expect(err, template).toBeInstanceOf(BridgeError);
            expect(err.code).toBe('invalid_args');
        }
    });
    it('sanitizeHtml conserva el formato seguro (DOMPurify con DOM en servidor) y elimina lo activo', async () => {
        const { html } = await fm({ op: 'sanitizeHtml', args: { html: '<p onclick="x()">hola <b>mundo</b></p><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a><a href="https://ok.test/">ok</a><form action="/x"><input name=a></form>' } });
        expect(html).toContain('<b>mundo</b>');
        expect(html).toContain('<p>');
        expect(html).not.toMatch(/<script|onerror=|onclick=|javascript:|<form|<input/i);
        expect(html).toContain('href="https://ok.test/"');
        expect(html).toContain('rel="noopener noreferrer nofollow"');
    }, 60_000); // la primera carga de jsdom es lenta
    it('sanitizeHtml sin DOM (sanitizer del cliente en servidor) degrada a texto escapado sin etiquetas', async () => {
        const { sanitizeHtml } = await import('@/lib/sanitizeHtml');
        const out = sanitizeHtml('<p onclick="x()">hola</p><script>alert(1)</script>');
        expect(out).not.toMatch(/<script|<p|onclick=\s*"/i);
    });
});
