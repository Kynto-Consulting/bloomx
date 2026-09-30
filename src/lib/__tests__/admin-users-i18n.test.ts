import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dictionaries, flattenMessages } from '../i18n';

/**
 * Todas las claves admin.console.users.* que usan las pantallas de usuarios y cuentas vinculadas existen en es y en en
 * (una clave ausente se veria tal cual en pantalla). Incluye las claves dinamicas (estado del token, integraciones).
 */
const ROOT = path.resolve(__dirname, '../../..');
const DIRS = ['src/components/admin/users', 'src/components/admin/accounts'];
const es = flattenMessages(dictionaries.es!);
const en = flattenMessages(dictionaries.en!);

function sources(): { file: string; src: string }[] {
    const out: { file: string; src: string }[] = [];
    for (const dir of DIRS) {
        for (const name of fs.readdirSync(path.join(ROOT, dir))) {
            if (/\.tsx?$/.test(name)) out.push({ file: `${dir}/${name}`, src: fs.readFileSync(path.join(ROOT, dir, name), 'utf8') });
        }
    }
    return out;
}

describe('i18n de usuarios y cuentas vinculadas', () => {
    it('las claves literales existen en es y en', () => {
        const missing: string[] = [];
        for (const { file, src } of sources()) {
            for (const m of src.matchAll(/'(admin\.console\.(?:users|common)\.[A-Za-z0-9_.]+)'/g)) {
                if (!(m[1] in es)) missing.push(`${file}: ${m[1]} (es)`);
                if (!(m[1] in en)) missing.push(`${file}: ${m[1]} (en)`);
            }
        }
        expect(missing).toEqual([]);
    });

    it('las claves de los ayudantes d(...) del detalle existen', () => {
        const missing: string[] = [];
        for (const { file, src } of sources()) {
            const prefix = file.endsWith('AccountDrawer.tsx') ? 'admin.console.users.accounts.detail.' : file.endsWith('UserDrawer.tsx') ? 'admin.console.users.detail.' : null;
            if (!prefix) continue;
            for (const m of src.matchAll(/\bd\('([A-Za-z0-9_]+)'/g)) {
                if (!(prefix + m[1] in es)) missing.push(`${file}: ${prefix}${m[1]} (es)`);
                if (!(prefix + m[1] in en)) missing.push(`${file}: ${prefix}${m[1]} (en)`);
            }
            // claves del detalle usadas con t(`${prefix}${key}`) en el codigo: d(key)
            for (const m of src.matchAll(/t\('admin\.console\.users\.detail\.sections\.([A-Za-z]+)'\)/g)) {
                if (!(`admin.console.users.detail.sections.${m[1]}` in es)) missing.push(`sections.${m[1]}`);
            }
        }
        expect(missing).toEqual([]);
    });

    it('claves dinamicas: estado del token, ayuda del estado e integraciones', () => {
        for (const dict of [es, en]) {
            for (const s of ['valid', 'expired', 'revoked']) {
                expect(dict[`admin.console.users.accounts.tokenStatus.${s}`]).toBeTruthy();
                expect(dict[`admin.console.users.accounts.statusHelp.${s}`]).toBeTruthy();
            }
            for (const i of ['calendar', 'contacts', 'gmail', 'drive', 'meet', 'tasks', 'meetings']) {
                expect(dict[`admin.console.users.accounts.integration.${i}`]).toBeTruthy();
            }
        }
    });

    it('es y en tienen las mismas claves y los mismos marcadores {param}', () => {
        const keys = Object.keys(es).filter((k) => k.startsWith('admin.console.users.'));
        expect(keys.length).toBeGreaterThan(100);
        const params = (s: unknown) => (String(s).match(/\{[A-Za-z]+\}/g) ?? []).sort().join(',');
        for (const k of keys) {
            expect(en[k], k).toBeDefined();
            expect(params(en[k]), k).toBe(params(es[k]));
        }
    });
});
