import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { spamEn, spamEs } from '@/lib/i18n/messages/admin-console/spam';
import { spamListsEn, spamListsEs } from '@/lib/i18n/messages/spam-lists';
import { dictionaries, flattenMessages } from '@/lib/i18n';
import { RAW_CLASS, RAW_LITERAL } from '@/lib/__tests__/helpers/raw-colors';

const flat = (o: unknown) => flattenMessages(o as any) as Record<string, string>;
const params = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');

describe.each([
    ['admin.console.spam', spamEs, spamEn],
    ['spam.lists', spamListsEs, spamListsEn],
])('paridad es/en de %s', (_name, es, en) => {
    const a = flat(es);
    const b = flat(en);
    it('mismas claves, sin cadenas vacias y mismos parametros', () => {
        expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
        for (const k of Object.keys(a)) {
            expect(a[k].trim().length, k).toBeGreaterThan(0);
            expect(b[k].trim().length, k).toBeGreaterThan(0);
            expect(params(b[k]), k).toBe(params(a[k]));
        }
    });
});

describe('registro en los diccionarios reales', () => {
    const es = flat(dictionaries.es);
    const en = flat(dictionaries.en);
    it('admin.console.spam y spam.lists estan montados en es y en', () => {
        for (const k of Object.keys(flat(spamEs))) expect(es[`admin.console.spam.${k}`], k).toBeTruthy();
        for (const k of Object.keys(flat(spamEn))) expect(en[`admin.console.spam.${k}`], k).toBeTruthy();
        for (const k of Object.keys(flat(spamListsEs))) expect(es[`spam.lists.${k}`], k).toBeTruthy();
        for (const k of Object.keys(flat(spamListsEn))) expect(en[`spam.lists.${k}`], k).toBeTruthy();
        expect(es['admin.console.shell.nav.spam']).toBeTruthy();
        expect(en['admin.console.shell.nav.spam']).toBeTruthy();
        expect(es['admin.console.shell.search.settings.spam']).toBeTruthy();
        expect(en['admin.console.shell.search.settings.spam']).toBeTruthy();
    });
});

describe('sin colores crudos en la seccion', () => {
    const root = path.resolve(__dirname, '../../../..');
    const files = [
        'src/components/spam/SpamListEditor.tsx',
        'src/app/admin/(console)/spam/page.tsx',
        ...fs.readdirSync(path.join(root, 'src/components/admin/spam')).map((f) => `src/components/admin/spam/${f}`),
    ];
    it.each(files)('%s usa solo tokens de tema', (rel) => {
        const src = fs.readFileSync(path.join(root, rel), 'utf8');
        expect([...src.matchAll(RAW_CLASS)].map((m) => m[0])).toEqual([]);
        if (rel.endsWith('.tsx')) expect([...src.matchAll(RAW_LITERAL)].map((m) => m[0])).toEqual([]);
    });
});
