import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/db/pool', () => ({ getDbPool: () => { throw new Error('no db'); } }));
const audits = vi.hoisted(() => [] as Array<{ event: string; data: any }>);
vi.mock('@/lib/security', async () => {
    const actual = await vi.importActual<typeof import('@/lib/security')>('@/lib/security');
    return { ...actual, auditLog: vi.fn((event: string, data: any) => { audits.push({ event, data }); }) };
});

import { divertOAuthCredentials, oauthCredentialStatus } from '../credentials-admin';
import { __setOAuthStore, createMemoryOAuthStore } from '../store';
import { __setExtensionsSource, getProvider } from '../providers';
import { generateKeyPairSync } from 'node:crypto';

const lib = () => ({
    id: 'core-googlelib', settings: { config: { GOOGLE_CLIENT_ID: 'cid', GOOGLE_IMPERSONATE_USER: 'a@b.test' } },
    template: {
        id: 'core-googlelib', version: '1.0.0',
        settingsSchema: { fields: [
            { key: 'GOOGLE_CLIENT_ID', type: 'string', label: 'I' }, { key: 'GOOGLE_CLIENT_SECRET', type: 'string', secret: true, label: 'S' }, { key: 'GOOGLE_SERVICE_ACCOUNT_JSON', type: 'string', secret: true, label: 'J' },
            { key: 'GOOGLE_IMPERSONATE_USER', type: 'string', label: 'U' },
        ] },
        oauthProviders: [{
            id: 'google', displayName: 'G', authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', apiBase: 'https://www.googleapis.com',
            allowedHosts: ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com'], scopes: [{ id: 'openid', group: 'userinfo', es: 'a', en: 'a', risk: 'low' }],
            pkce: true, clientIdSetting: 'GOOGLE_CLIENT_ID', clientSecretCredential: 'GOOGLE_CLIENT_SECRET', redirectPath: '/api/auth/callback/google',
            principals: { serviceAccountJson: 'GOOGLE_SERVICE_ACCOUNT_JSON', impersonateUser: 'GOOGLE_IMPERSONATE_USER' },
        }],
    },
});
const saJson = () => JSON.stringify({ type: 'service_account', client_email: 's@p.iam.gserviceaccount.com', private_key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });

let store: ReturnType<typeof createMemoryOAuthStore>;
beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ENCRYPTION_KEY', 'unit-test-key-0123456789abcdef0123456789');
    store = createMemoryOAuthStore();
    __setOAuthStore(store);
    __setExtensionsSource(async () => [lib()]);
    audits.length = 0;
});
afterEach(() => { __setOAuthStore(null); __setExtensionsSource(null); vi.unstubAllEnvs(); });

describe('panel de credenciales: las del nucleo se desvian a la instancia', () => {
    it('divertOAuthCredentials separa las credenciales OAuth del resto y las guarda cifradas', async () => {
        const r = await divertOAuthCredentials('core-googlelib', { GOOGLE_CLIENT_SECRET: 'nuevo-secreto', GOOGLE_SERVICE_ACCOUNT_JSON: saJson(), OTRA_CLAVE: 'va-al-backend' }, 'admin1');
        expect(r.error).toBeUndefined();
        expect(r.applied.sort()).toEqual(['GOOGLE_CLIENT_SECRET', 'GOOGLE_SERVICE_ACCOUNT_JSON']);
        expect(r.remaining).toEqual({ OTRA_CLAVE: 'va-al-backend' });
        expect(JSON.stringify(store.configs.get('google'))).not.toMatch(/nuevo-secreto/);
        const status = await oauthCredentialStatus('core-googlelib');
        expect(status.find((s) => s.name === 'GOOGLE_CLIENT_SECRET')).toMatchObject({ configured: true, source: 'domain' });
        expect(status.find((s) => s.name === 'GOOGLE_SERVICE_ACCOUNT_JSON')).toMatchObject({ configured: true });
        // borrar un valor (null/"") solo borra ESA credencial
        const del = await divertOAuthCredentials('core-googlelib', { GOOGLE_SERVICE_ACCOUNT_JSON: null }, 'admin1');
        expect(del.removed).toEqual(['GOOGLE_SERVICE_ACCOUNT_JSON']);
        const after = await oauthCredentialStatus('core-googlelib');
        expect(after.find((s) => s.name === 'GOOGLE_SERVICE_ACCOUNT_JSON')?.configured).toBe(false);
        expect(after.find((s) => s.name === 'GOOGLE_CLIENT_SECRET')?.configured).toBe(true);
    });

    it('una cuenta de servicio invalida se rechaza y NO se guarda nada; extension sin proveedores no desvia nada', async () => {
        const bad = await divertOAuthCredentials('core-googlelib', { GOOGLE_SERVICE_ACCOUNT_JSON: '{"type":"user"}' }, 'a');
        expect(bad.error).toBe('invalid_service_account');
        expect(store.configs.size).toBe(0);
        const other = await divertOAuthCredentials('core-notion', { GOOGLE_CLIENT_SECRET: 'x' }, 'a');
        expect(other.applied).toEqual([]);
        expect(other.remaining).toEqual({ GOOGLE_CLIENT_SECRET: 'x' });
    });

    it('el estado marca el entorno heredado como server-env solo con endpoints oficiales', async () => {
        vi.stubEnv('GOOGLE_CLIENT_SECRET', 'del-entorno');
        const p = await getProvider('google');
        expect(p?.clientSecret).toBe('del-entorno');
        const status = await oauthCredentialStatus('core-googlelib');
        expect(status.find((s) => s.name === 'GOOGLE_CLIENT_SECRET')).toMatchObject({ configured: true, source: 'server-env' });
    });
});
