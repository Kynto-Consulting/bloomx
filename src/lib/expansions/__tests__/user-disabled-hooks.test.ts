/**
 * Preferencias del usuario -> hooks de servidor: `disabledExtensions` viaja en el cuerpo FIRMADO solo en dominios firmados, con
 * usuario y fuera de CRON; validada y acotada; los fallos de lectura no bloquean nada. Legado (sin clave): no se envia.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateEd25519KeyPair } from '@/lib/bloomx-signature';
import { EMPTY_PREFS, disabledIdsForServer, isMandatoryExtension, normalizePrefs, applyPrefsToExtensions } from '@/lib/expansions/client/prefs';
import { MAX_DISABLED_FOR_SERVER, disabledFromSettings, invalidateDisabledCache } from '../user-disabled';
import { callBackendHooks, fireLifecycleHook, runCronHooks, runEmailPreSendHooks, runEmailReceivedHooks, sanitizeDisabledForRequest, withUserDisabled } from '../server-hooks';

const json = (body: any, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as any;
const savedEnv = { ...process.env };
const withKey = () => { process.env.BLOOMX_DOMAIN_PRIVATE_KEY = generateEd25519KeyPair().privatePem; };
const bodyOf = (fetchImpl: any) => JSON.parse((fetchImpl.mock.calls[0] as any)[1].body);
const msg = { subject: 's', text: 't', to: ['a@x.com'] };

beforeEach(() => {
    for (const k of ['EXTENSION_HOOKS_DISABLED', 'EXTENSION_HOOKS_FAIL_CLOSED', 'BLOOMX_DOMAIN_PRIVATE_KEY', 'NEXT_PUBLIC_APP_URL']) delete process.env[k];
    vi.spyOn(console, 'error').mockImplementation(() => { });
    invalidateDisabledCache();
});
afterEach(() => { process.env = { ...savedEnv }; vi.restoreAllMocks(); });

describe('sanitizeDisabledForRequest / disabledFromSettings', () => {
    it('solo ids validos, sin duplicados, acotada; cualquier otra forma => vacia', () => {
        expect(sanitizeDisabledForRequest(['a', 'a', 'core-x.y', '../x', '', 5, null, {}, 'x'.repeat(101)])).toEqual(['a', 'core-x.y']);
        for (const bad of [undefined, null, 'a', 3, { 0: 'a' }]) expect(sanitizeDisabledForRequest(bad)).toEqual([]);
        expect(sanitizeDisabledForRequest(Array.from({ length: 5000 }, (_, i) => `e${i}`))).toHaveLength(MAX_DISABLED_FOR_SERVER);
    });

    it('lee system:extension-prefs de las expansionSettings ya descifradas y tolera basura', () => {
        expect(disabledFromSettings({ 'system:extension-prefs': { disabled: ['zoom', 'giphy'], order: ['zoom'] } })).toEqual(['zoom', 'giphy']);
        for (const bad of [null, undefined, [], 'x', { 'system:extension-prefs': 'x' }, { 'system:extension-prefs': { disabled: 'zoom' } }, { 'system:extension-prefs': { disabled: [1, '../x'] } }]) {
            expect(disabledFromSettings(bad as any)).toEqual([]);
        }
        const huge = { 'system:extension-prefs': { disabled: Array.from({ length: 9000 }, (_, i) => `e${i}`) } };
        expect(disabledFromSettings(huge).length).toBeLessThanOrEqual(MAX_DISABLED_FOR_SERVER);
    });
});

describe('cuerpo firmado de callBackendHooks', () => {
    it('dominio FIRMADO con usuario: incluye disabledExtensions saneada dentro del cuerpo firmado', async () => {
        withKey();
        const fetchImpl = vi.fn(async () => json({}));
        await callBackendHooks('EMAIL_PRE_SEND', { subject: 's' }, { fetchImpl: fetchImpl as any, backendUrl: 'https://be', host: 'acme.com', userId: 'u1', disabledExtensions: ['zoom', 'zoom', '../x'] });
        const init = (fetchImpl.mock.calls[0] as any)[1];
        expect(JSON.parse(init.body)).toEqual({ event: 'EMAIL_PRE_SEND', context: { subject: 's' }, disabledExtensions: ['zoom'] });
        expect(init.headers['X-BloomX-Signature']).toBeTruthy();
    });

    it('LEGADO (sin clave): nunca se envia la lista', async () => {
        const fetchImpl = vi.fn(async () => json({}));
        await callBackendHooks('EMAIL_PRE_SEND', {}, { fetchImpl: fetchImpl as any, backendUrl: 'https://be', host: 'acme.com', userId: 'u1', disabledExtensions: ['zoom'] });
        expect(bodyOf(fetchImpl)).toEqual({ event: 'EMAIL_PRE_SEND', context: {} });
    });

    it('CRON y llamadas sin usuario: nunca se envia la lista', async () => {
        withKey();
        const fetchImpl = vi.fn(async () => json({}));
        await callBackendHooks('CRON', {}, { fetchImpl: fetchImpl as any, backendUrl: 'https://be', host: 'acme.com', userId: 'u1', internal: true, disabledExtensions: ['zoom'] });
        expect(bodyOf(fetchImpl)).not.toHaveProperty('disabledExtensions');
        const f2 = vi.fn(async () => json({}));
        await callBackendHooks('EMAIL_PRE_SEND', {}, { fetchImpl: f2 as any, backendUrl: 'https://be', host: 'acme.com', disabledExtensions: ['zoom'] });
        expect(bodyOf(f2)).not.toHaveProperty('disabledExtensions');
        const f3 = vi.fn(async () => json({}));
        await runCronHooks('daily', { fetchImpl: f3 as any, backendUrl: 'https://be', host: 'acme.com', disabledExtensions: ['zoom'] });
        expect(bodyOf(f3)).toEqual({ event: 'CRON', context: { schedule: 'daily' } });
    });

    it('lista vacia => el cuerpo es identico al de siempre', async () => {
        withKey();
        const fetchImpl = vi.fn(async () => json({}));
        await callBackendHooks('EMAIL_PRE_SEND', {}, { fetchImpl: fetchImpl as any, backendUrl: 'https://be', host: 'acme.com', userId: 'u1', disabledExtensions: [] });
        expect(bodyOf(fetchImpl)).toEqual({ event: 'EMAIL_PRE_SEND', context: {} });
    });
});

describe('withUserDisabled y los envoltorios', () => {
    it('EMAIL_PRE_SEND firmado: lee las preferencias del usuario en el servidor y las envia', async () => {
        withKey();
        const loadDisabled = vi.fn(async () => ['zoom', 'giphy']);
        const fetchImpl = vi.fn(async () => json({}));
        await runEmailPreSendHooks(msg, { fetchImpl: fetchImpl as any, backendUrl: 'https://be', host: 'acme.com', userId: 'u1', loadDisabled });
        expect(loadDisabled).toHaveBeenCalledWith('u1');
        expect(bodyOf(fetchImpl).disabledExtensions).toEqual(['zoom', 'giphy']);
    });

    it('EMAIL_PRE_SEND en LEGADO: ni siquiera se leen las preferencias', async () => {
        const loadDisabled = vi.fn(async () => ['zoom']);
        const fetchImpl = vi.fn(async () => json({}));
        await runEmailPreSendHooks(msg, { fetchImpl: fetchImpl as any, backendUrl: 'https://be', host: 'acme.com', userId: 'u1', loadDisabled });
        expect(loadDisabled).not.toHaveBeenCalled();
        expect(bodyOf(fetchImpl)).not.toHaveProperty('disabledExtensions');
    });

    it('si no se pueden leer las preferencias (BD caida) NO se bloquea nada: se envia sin lista', async () => {
        withKey();
        const loadDisabled = vi.fn(async () => { throw new Error('db down'); });
        const fetchImpl = vi.fn(async () => json({}));
        const result = await runEmailPreSendHooks(msg, { fetchImpl: fetchImpl as any, backendUrl: 'https://be', host: 'acme.com', userId: 'u1', loadDisabled });
        expect(result.stop).toBe(false);
        expect(bodyOf(fetchImpl)).not.toHaveProperty('disabledExtensions');
    });

    it('withUserDisabled respeta una lista ya indicada y no relee', async () => {
        withKey();
        const loadDisabled = vi.fn(async () => ['x']);
        const t = await withUserDisabled({ userId: 'u1', disabledExtensions: ['a'], loadDisabled });
        expect(t.disabledExtensions).toEqual(['a']);
        expect(loadDisabled).not.toHaveBeenCalled();
        const none = await withUserDisabled({ loadDisabled });
        expect(none.disabledExtensions).toBeUndefined();
    });

    it('EMAIL_RECEIVED y ciclo de vida tambien la incluyen', async () => {
        withKey();
        const f1 = vi.fn(async () => json({ results: [] }));
        await runEmailReceivedHooks({ emailId: 'e1', userId: 'u1', domain: 'acme.com' }, { fetchImpl: f1 as any, backendUrl: 'https://be', loadDisabled: async () => ['notes'] });
        expect(bodyOf(f1).disabledExtensions).toEqual(['notes']);

        const f2 = vi.fn(async () => json({}));
        expect(fireLifecycleHook('CONTACT_DELETED', 'u-life-dis', { contactId: 'c' }, { fetchImpl: f2 as any, backendUrl: 'https://be', host: 'acme.com', inline: true, loadDisabled: async () => ['notes'] })).toBe(true);
        await new Promise((r) => setTimeout(r, 20));
        expect(bodyOf(f2)).toEqual({ event: 'CONTACT_DELETED', context: { contactId: 'c' }, disabledExtensions: ['notes'] });
    });
});

describe('obligatorias en el cliente', () => {
    it('isMandatoryExtension: manifest.mandatory, politica del dominio (config) o campo derivado del backend; el resto no', () => {
        expect(isMandatoryExtension({ id: 'a', template: { mandatory: true } })).toBe(true);
        expect(isMandatoryExtension({ id: 'a', settings: { meta: { mandatory: true } } })).toBe(true);
        expect(isMandatoryExtension({ id: 'a', mandatory: true })).toBe(true);
        for (const not of [{ id: 'a' }, { id: 'a', mandatory: 'true' }, { id: 'a', template: { mandatory: 1 } }, null, undefined, 'x']) expect(isMandatoryExtension(not)).toBe(false);
    });

    it('applyPrefsToExtensions nunca oculta una obligatoria aunque este en disabled; disabledIdsForServer lista solo ids validos', () => {
        const prefs = normalizePrefs({ disabled: ['dlp', 'zoom', '../x'], order: [] });
        const kept = applyPrefsToExtensions([{ id: 'dlp', template: { mandatory: true } }, { id: 'zoom' }, { id: 'other' }] as any, prefs).map((e) => e.id);
        expect(kept).toEqual(['dlp', 'other']);
        expect(disabledIdsForServer(prefs)).toEqual(['dlp', 'zoom']);
        expect(disabledIdsForServer(EMPTY_PREFS)).toEqual([]);
    });
});
