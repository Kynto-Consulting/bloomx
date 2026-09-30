import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { dictionaries, flattenMessages } from '@/lib/i18n';

const ROOT = path.resolve(__dirname, '../../../..');
const es = flattenMessages(dictionaries.es!);
const en = flattenMessages(dictionaries.en!);

function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
            if (e.name !== '__tests__') walk(path.join(dir, e.name), out);
        } else if (/\.tsx?$/.test(e.name)) out.push(path.join(dir, e.name));
    }
    return out;
}

const FILES = [
    ...walk(path.join(ROOT, 'src/components/conferencing')),
    'src/components/settings/IntegrationsSettings.tsx',
    'src/lib/conferencing/admin-form.ts',
    'src/components/ComposeModal.tsx',
    'src/components/SettingsModal.tsx',
    'src/components/calendar/CreateEventForm.tsx',
    'src/app/appointments/page.tsx',
].map((f) => (path.isAbsolute(f) ? f : path.join(ROOT, f)));

const KEY_RE = /'(conferencing\.[A-Za-z0-9_.]+)'/g;

describe('i18n de conferencing', () => {
    it('todas las claves literales usadas existen en es y en', () => {
        const missing: string[] = [];
        for (const file of FILES) {
            const src = fs.readFileSync(file, 'utf8');
            for (const m of src.matchAll(KEY_RE)) {
                if (!(m[1] in es)) missing.push(`${path.basename(file)}: ${m[1]} (es)`);
                if (!(m[1] in en)) missing.push(`${path.basename(file)}: ${m[1]} (en)`);
            }
        }
        expect(missing).toEqual([]);
    });

    it('claves construidas dinamicamente existen (errores de campo, codigos tipados, estados, modos, fuentes)', () => {
        const keys = [
            ...['empty', 'tooLong', 'control'].map((c) => `conferencing.admin.errors.field.${c}`),
            ...['not_connected', 'token_revoked', 'invalid_credentials', 'rate_limited', 'provider_error', 'invalid_input', 'not_supported', 'unavailable', 'unauthorized'].map((c) => `conferencing.errors.${c}`),
            ...['ready', 'connect', 'reconnect', 'unavailable', 'admin'].map((c) => `conferencing.state.${c}`),
            ...['serverToServer', 'userOauth', 'serviceAccount', 'googleAccount', 'customLink', 'unknown'].map((c) => `conferencing.mode.${c}`),
            ...['instance', 'userOauth', 'extension', 'none'].map((c) => `conferencing.source.${c}`),
        ];
        for (const k of keys) {
            expect(es[k], k).toBeTruthy();
            expect(en[k], k).toBeTruthy();
        }
    });

    it('es y en tienen las mismas claves y los mismos {parametros}', () => {
        const esKeys = Object.keys(es).filter((k) => k.startsWith('conferencing.'));
        const enKeys = Object.keys(en).filter((k) => k.startsWith('conferencing.'));
        expect([...enKeys].sort()).toEqual([...esKeys].sort());
        const params = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) || []).sort().join(',');
        for (const k of esKeys) expect(params(en[k]), k).toBe(params(es[k]));
    });
});
