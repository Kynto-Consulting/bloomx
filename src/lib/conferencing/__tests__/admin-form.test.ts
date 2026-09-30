import { describe, expect, it } from 'vitest';
import {
    SERVICE_ACCOUNT_MAX_BYTES,
    buildClearPayload,
    buildProviderPayload,
    initialMode,
    isKeyConfigured,
    parseAdminData,
    planWrites,
    targetExtensions,
    validateProviderDraft,
    validateServiceAccountJson,
} from '../admin-form';

const PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----\n';
const sa = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ type: 'service_account', project_id: 'proj-1', client_email: 'bot@proj-1.iam.gserviceaccount.com', private_key: PRIVATE_KEY, ...over }, null, 2);

describe('validateServiceAccountJson', () => {
    it('JSON valido: devuelve solo client_email y project_id y un JSON compacto', () => {
        const check = validateServiceAccountJson(sa());
        expect(check.ok).toBe(true);
        if (!check.ok) return;
        expect(check.clientEmail).toBe('bot@proj-1.iam.gserviceaccount.com');
        expect(check.projectId).toBe('proj-1');
        expect(check.normalized).not.toContain('\n  ');
        expect(JSON.parse(check.normalized).private_key).toBe(PRIVATE_KEY);
        // el resultado que se muestra en la UI nunca contiene la clave privada
        expect(Object.keys(check).sort()).toEqual(['clientEmail', 'normalized', 'ok', 'projectId']);
        expect(JSON.stringify({ clientEmail: check.clientEmail, projectId: check.projectId })).not.toContain('PRIVATE');
    });

    it('rechaza cada caso invalido con un error tipado', () => {
        expect(validateServiceAccountJson('')).toEqual({ ok: false, error: 'empty' });
        expect(validateServiceAccountJson(undefined)).toEqual({ ok: false, error: 'empty' });
        expect(validateServiceAccountJson('{no json')).toEqual({ ok: false, error: 'notJson' });
        expect(validateServiceAccountJson('[1]')).toEqual({ ok: false, error: 'notObject' });
        expect(validateServiceAccountJson('null')).toEqual({ ok: false, error: 'notObject' });
        expect(validateServiceAccountJson(sa({ type: 'authorized_user' }))).toEqual({ ok: false, error: 'wrongType' });
        expect(validateServiceAccountJson(sa({ client_email: 'no-es-correo' }))).toEqual({ ok: false, error: 'missingClientEmail' });
        expect(validateServiceAccountJson(sa({ client_email: undefined }))).toEqual({ ok: false, error: 'missingClientEmail' });
        expect(validateServiceAccountJson(sa({ private_key: '' }))).toEqual({ ok: false, error: 'missingPrivateKey' });
        expect(validateServiceAccountJson(sa({ private_key: 'abc' }))).toEqual({ ok: false, error: 'badPrivateKey' });
        expect(validateServiceAccountJson(sa({ project_id: '' }))).toEqual({ ok: false, error: 'missingProjectId' });
    });

    it('rechaza mas de 16 KB (en bytes)', () => {
        const big = sa({ padding: 'x'.repeat(SERVICE_ACCOUNT_MAX_BYTES) });
        expect(validateServiceAccountJson(big)).toEqual({ ok: false, error: 'tooLarge' });
        // multibyte: pocos caracteres pero mas de 16 KB en UTF-8
        expect(validateServiceAccountJson(sa({ note: 'é'.repeat(SERVICE_ACCOUNT_MAX_BYTES / 2) }))).toEqual({ ok: false, error: 'tooLarge' });
        expect(SERVICE_ACCOUNT_MAX_BYTES).toBe(16384);
    });
});

describe('payload', () => {
    it('Zoom server-to-server: modo + credenciales recortadas; vacias no viajan', () => {
        const payload = buildProviderPayload({
            provider: 'zoom',
            mode: 'server-to-server',
            values: { ZOOM_ACCOUNT_ID: ' acc ', ZOOM_CLIENT_ID: 'cid', ZOOM_CLIENT_SECRET: '' },
        });
        expect(payload).toEqual({ ZOOM_AUTH_MODE: 'server-to-server', ZOOM_ACCOUNT_ID: 'acc', ZOOM_CLIENT_ID: 'cid' });
    });

    it('Zoom user-oauth solo guarda el modo (no toca las credenciales S2S)', () => {
        expect(buildProviderPayload({ provider: 'zoom', mode: 'user-oauth', values: { ZOOM_ACCOUNT_ID: 'x' } })).toEqual({ ZOOM_AUTH_MODE: 'user-oauth' });
    });

    it('Zoom: borrar una clave la manda como null', () => {
        expect(buildProviderPayload({ provider: 'zoom', mode: 'server-to-server', values: { ZOOM_CLIENT_ID: 'ignorado' }, removals: ['ZOOM_CLIENT_ID'] })).toEqual({
            ZOOM_AUTH_MODE: 'server-to-server',
            ZOOM_CLIENT_ID: null,
        });
    });

    it('Google service-account: JSON compacto + usuario a suplantar; cuenta de Google solo el modo', () => {
        const payload = buildProviderPayload({
            provider: 'google-meet',
            mode: 'service-account',
            values: { GOOGLE_SERVICE_ACCOUNT_JSON: sa(), GOOGLE_IMPERSONATE_USER: ' admin@empresa.com ' },
        });
        expect(payload.GOOGLE_AUTH_MODE).toBe('service-account');
        expect(payload.GOOGLE_IMPERSONATE_USER).toBe('admin@empresa.com');
        expect(typeof payload.GOOGLE_SERVICE_ACCOUNT_JSON).toBe('string');
        expect(payload.GOOGLE_SERVICE_ACCOUNT_JSON).not.toContain('\n  ');
        expect(buildProviderPayload({ provider: 'google-meet', mode: 'google-account', values: { GOOGLE_SERVICE_ACCOUNT_JSON: sa() } })).toEqual({ GOOGLE_AUTH_MODE: 'google-account' });
    });

    it('un JSON invalido no entra al payload', () => {
        expect(buildProviderPayload({ provider: 'google-meet', mode: 'service-account', values: { GOOGLE_SERVICE_ACCOUNT_JSON: '{}' } })).toEqual({ GOOGLE_AUTH_MODE: 'service-account' });
    });

    it('buildClearPayload pone a null todo lo del proveedor', () => {
        expect(buildClearPayload('zoom')).toEqual({ ZOOM_AUTH_MODE: null, ZOOM_ACCOUNT_ID: null, ZOOM_CLIENT_ID: null, ZOOM_CLIENT_SECRET: null });
        const g = buildClearPayload('google-meet');
        expect(Object.values(g).every((v) => v === null)).toBe(true);
        expect(Object.keys(g)).toEqual(expect.arrayContaining(['GOOGLE_AUTH_MODE', 'GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_IMPERSONATE_USER', 'GOOGLE_ORGANIZER_REFRESH_TOKEN']));
    });
});

describe('validateProviderDraft', () => {
    it('marca JSON invalido, correo invalido y saltos de linea en claves de una linea', () => {
        const errors = validateProviderDraft({
            provider: 'google-meet',
            mode: 'service-account',
            values: { GOOGLE_SERVICE_ACCOUNT_JSON: '{}', GOOGLE_IMPERSONATE_USER: 'no-correo' },
        });
        expect(errors).toEqual([
            { key: 'GOOGLE_SERVICE_ACCOUNT_JSON', error: 'wrongType' },
            { key: 'GOOGLE_IMPERSONATE_USER', error: 'invalidEmail' },
        ]);
        expect(validateProviderDraft({ provider: 'zoom', mode: 'server-to-server', values: { ZOOM_CLIENT_ID: 'a\nb' } })).toEqual([{ key: 'ZOOM_CLIENT_ID', error: 'control' }]);
    });
    it('campos vacios o borrados no dan error; JSON valido pasa', () => {
        expect(validateProviderDraft({ provider: 'zoom', mode: 'server-to-server', values: { ZOOM_CLIENT_ID: '' } })).toEqual([]);
        expect(validateProviderDraft({ provider: 'google-meet', mode: 'service-account', values: { GOOGLE_SERVICE_ACCOUNT_JSON: '{}' }, removals: ['GOOGLE_SERVICE_ACCOUNT_JSON'] })).toEqual([]);
        expect(validateProviderDraft({ provider: 'google-meet', mode: 'service-account', values: { GOOGLE_SERVICE_ACCOUNT_JSON: sa() } })).toEqual([]);
    });
});

describe('datos del panel y escrituras', () => {
    const data = parseAdminData({
        domainId: 'd1',
        isAdmin: true,
        extensions: {
            'core-zoom': { installed: true, keys: [{ name: 'ZOOM_CLIENT_ID', configured: true }, { name: 'ZOOM_ACCOUNT_ID', configured: false }] },
            'core-google-meet': { installed: true, keys: [{ name: 'GOOGLE_SERVICE_ACCOUNT_JSON', configured: true }] },
            'core-calendar': { installed: true, keys: [] },
        },
    })!;

    it('parseAdminData tolera basura', () => {
        expect(parseAdminData(null)).toBeNull();
        expect(parseAdminData({ domainId: '' })).toBeNull();
        expect(parseAdminData({ domainId: 'd', extensions: { x: { installed: 1, keys: [{ name: 5 }, { name: 'A', configured: true }] } } })!.extensions.x).toEqual({
            installed: false,
            keys: [{ name: 'A', configured: true }],
        });
    });

    it('isKeyConfigured mira solo lo instalado', () => {
        expect(isKeyConfigured(data, 'zoom', 'ZOOM_CLIENT_ID')).toBe(true);
        expect(isKeyConfigured(data, 'zoom', 'ZOOM_ACCOUNT_ID')).toBe(false);
        expect(isKeyConfigured(data, 'google-meet', 'GOOGLE_SERVICE_ACCOUNT_JSON')).toBe(true);
    });

    it('Google se escribe en core-google-meet y core-calendar (si esta instalada); Zoom solo en core-zoom', () => {
        expect(targetExtensions('google-meet', data)).toEqual(['core-google-meet', 'core-calendar']);
        expect(targetExtensions('zoom', data)).toEqual(['core-zoom']);
        const noCal = { ...data, extensions: { ...data.extensions, 'core-calendar': { installed: false, keys: [] } } };
        expect(targetExtensions('google-meet', noCal)).toEqual(['core-google-meet']);
        expect(planWrites('google-meet', { GOOGLE_AUTH_MODE: 'service-account' }, data)).toEqual([
            { extensionId: 'core-google-meet', credentials: { GOOGLE_AUTH_MODE: 'service-account' } },
            { extensionId: 'core-calendar', credentials: { GOOGLE_AUTH_MODE: 'service-account' } },
        ]);
        expect(planWrites('zoom', {}, { ...data, extensions: {} })).toEqual([]);
    });

    it('initialMode valida el modo activo', () => {
        expect(initialMode('zoom', 'user-oauth')).toBe('user-oauth');
        expect(initialMode('zoom', 'service-account')).toBe('server-to-server');
        expect(initialMode('google-meet', null)).toBe('service-account');
    });
});
