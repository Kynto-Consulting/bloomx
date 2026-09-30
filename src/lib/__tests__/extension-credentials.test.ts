import { describe, expect, it } from 'vitest';
import {
    MAX_CREDENTIAL_LENGTH,
    MAX_SERVICE_ACCOUNT_LENGTH,
    buildCredentialPayload,
    credentialsHttpErrorKey,
    declaredCredentialKeys,
    validateCredentialValue,
    validateDraft,
} from '../extension-credentials';

describe('declaredCredentialKeys', () => {
    it('deriva los campos de ENV_READ y descarta reservadas, invalidas y duplicadas', () => {
        const template = {
            permissions: [
                'READ_EMAIL',
                'ENV_READ:NOTION_API_KEY',
                'ENV_READ: NOTION_DATABASE_ID ',
                'ENV_READ:NOTION_API_KEY',
                'ENV_READ:DATABASE_URL',
                'ENV_READ:ADMIN_PASSWORD',
                'ENV_READ:lowercase',
                'ENV_READ:',
            ],
        };
        expect(declaredCredentialKeys(template)).toEqual(['NOTION_API_KEY', 'NOTION_DATABASE_ID']);
    });

    it('acepta el template como string JSON y tolera basura', () => {
        expect(declaredCredentialKeys(JSON.stringify({ permissions: ['ENV_READ:GIPHY_API_KEY'] }))).toEqual(['GIPHY_API_KEY']);
        expect(declaredCredentialKeys('{no json')).toEqual([]);
        expect(declaredCredentialKeys(null)).toEqual([]);
        expect(declaredCredentialKeys({ permissions: 'x' })).toEqual([]);
    });
});

describe('validateCredentialValue', () => {
    it('reglas iguales a las del backend', () => {
        expect(validateCredentialValue('secret_abc')).toBeNull();
        expect(validateCredentialValue('   ')).toBe('empty');
        expect(validateCredentialValue('a\nb')).toBe('control');
        expect(validateCredentialValue('a\u0000b')).toBe('control');
        expect(validateCredentialValue('x'.repeat(MAX_CREDENTIAL_LENGTH))).toBeNull();
        expect(validateCredentialValue('x'.repeat(MAX_CREDENTIAL_LENGTH + 1))).toBe('tooLong');
    });
});

describe('GOOGLE_SERVICE_ACCOUNT_JSON', () => {
    it('admite 16384 caracteres y saltos de linea solo en esa clave', () => {
        const key = 'GOOGLE_SERVICE_ACCOUNT_JSON';
        expect(validateCredentialValue('{\n  "a": 1\r\n}', key)).toBeNull();
        expect(validateCredentialValue('x'.repeat(MAX_SERVICE_ACCOUNT_LENGTH), key)).toBeNull();
        expect(validateCredentialValue('x'.repeat(MAX_SERVICE_ACCOUNT_LENGTH + 1), key)).toBe('tooLong');
        expect(validateCredentialValue('a\u0000b', key)).toBe('control');
        expect(validateCredentialValue('a\nb', 'OTHER_KEY')).toBe('control');
        expect(validateCredentialValue('x'.repeat(MAX_CREDENTIAL_LENGTH + 1), 'OTHER_KEY')).toBe('tooLong');
        expect(validateDraft({ values: { [key]: '{\n}' }, removals: [] })).toEqual({});
    });
});

describe('borrador -> payload', () => {
    it('valores nuevos se recortan, borrados van como null y los vacios no viajan', () => {
        const payload = buildCredentialPayload({
            values: { A_KEY: '  nuevo  ', B_KEY: '', C_KEY: 'ignorado' },
            removals: ['C_KEY', 'D_KEY'],
        });
        expect(payload).toEqual({ A_KEY: 'nuevo', C_KEY: null, D_KEY: null });
    });

    it('sin cambios el payload esta vacio', () => {
        expect(buildCredentialPayload({ values: { A: '' }, removals: [] })).toEqual({});
    });

    it('validateDraft solo marca campos escritos y no borrados', () => {
        expect(validateDraft({ values: { A: '  ', B: 'ok', C: 'a\tb', D: '' }, removals: [] })).toEqual({ A: 'empty', C: 'control' });
        expect(validateDraft({ values: { A: '  ' }, removals: new Set(['A']) })).toEqual({});
    });
});

describe('credentialsHttpErrorKey', () => {
    it('mapea estados HTTP a claves i18n', () => {
        expect(credentialsHttpErrorKey(401)).toBe('unauthorized');
        expect(credentialsHttpErrorKey(403)).toBe('forbidden');
        expect(credentialsHttpErrorKey(404)).toBe('notInstalled');
        expect(credentialsHttpErrorKey(429)).toBe('tooMany');
        expect(credentialsHttpErrorKey(503)).toBe('encryptionUnavailable');
        expect(credentialsHttpErrorKey(500)).toBe('generic');
    });
});
