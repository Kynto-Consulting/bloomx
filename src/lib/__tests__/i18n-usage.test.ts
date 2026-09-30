import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { dictionaries, flattenMessages } from '../i18n';

// Cada clave usada como literal en las pantallas migradas (Sidebar, citas, reservas, calendario, lista de correo)
// debe existir en es Y en en. Una clave que falte se veria como "sidebar.xyz" en pantalla.
const ROOT = path.resolve(__dirname, '../../..');
const FILES = [
    'src/components/Sidebar.tsx',
    'src/components/EmailList.tsx',
    'src/app/(app)/appointments/page.tsx',
    'src/app/book/[scheduleId]/page.tsx',
    'src/app/book/[scheduleId]/cancel/[token]/page.tsx',
    'src/app/(app)/calendar/page.tsx',
    'src/components/calendar/AddCalendarForm.tsx',
    'src/components/calendar/CreateEventForm.tsx',
    'src/lib/i18n/format.ts',
];
const NAMESPACES = ['sidebar', 'appointments', 'calendar', 'emailList', 'book', 'common'];
const KEY_RE = new RegExp(`'((?:${NAMESPACES.join('|')})\\.[A-Za-z0-9_.]+)'`, 'g');
const PLURAL_RE = /pluralKey\(\s*(?:[^'"]*?\?\s*)?'([A-Za-z0-9_.]+)'/g;

const es = flattenMessages(dictionaries.es!);
const en = flattenMessages(dictionaries.en!);

function keysUsedIn(file: string): string[] {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const keys = new Set<string>();
    for (const m of src.matchAll(KEY_RE)) keys.add(m[1]);
    return [...keys];
}

describe('claves i18n usadas en las pantallas migradas', () => {
    for (const file of FILES) {
        it(`${file}: todas las claves existen en es y en`, () => {
            const used = keysUsedIn(file);
            const missing: string[] = [];
            for (const key of used) {
                // Bases de plural (pluralKey('x.y', n)) se resuelven a x.yOne / x.yMany.
                const isPluralBase = !(key in es) && `${key}One` in es && `${key}Many` in es;
                if (isPluralBase) {
                    if (!(`${key}One` in en) || !(`${key}Many` in en)) missing.push(`${key}(One|Many) en en`);
                    continue;
                }
                if (!(key in es)) missing.push(`${key} en es`);
                if (!(key in en)) missing.push(`${key} en en`);
            }
            expect(missing).toEqual([]);
        });
    }

    it('las bases de plural usadas con pluralKey(...) tienen One y Many en ambos idiomas', () => {
        const missing: string[] = [];
        for (const file of FILES) {
            const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
            if (!file.endsWith('.tsx')) continue;
            for (const m of src.matchAll(PLURAL_RE)) {
                for (const suffix of ['One', 'Many']) {
                    if (!(`${m[1]}${suffix}` in es)) missing.push(`${m[1]}${suffix} en es`);
                    if (!(`${m[1]}${suffix}` in en)) missing.push(`${m[1]}${suffix} en en`);
                }
            }
        }
        expect(missing).toEqual([]);
    });

    it('cada carpeta usada como sidebar.folders.<id> existe (la lista de correos las traduce por clave dinamica)', () => {
        for (const id of ['inbox', 'drafts', 'sent', 'scheduled', 'spam', 'trash', 'archive']) {
            expect(es[`sidebar.folders.${id}`], id).toBeTruthy();
            expect(en[`sidebar.folders.${id}`], id).toBeTruthy();
        }
    });

    it('las claves book.errors.* devueltas por bookingErrorKey existen', () => {
        for (const k of ['failed', 'rateLimited', 'slotTaken', 'expired', 'notFound', 'invalid']) {
            expect(es[`book.errors.${k}`], k).toBeTruthy();
            expect(en[`book.errors.${k}`], k).toBeTruthy();
        }
    });

    it('los espacios de nombres solicitados existen y no estan vacios', () => {
        for (const ns of ['sidebar', 'appointments', 'calendar', 'emailList']) {
            expect(Object.keys(es).filter((k) => k.startsWith(`${ns}.`)).length, ns).toBeGreaterThan(10);
        }
    });
});

describe('las pantallas migradas no dejan texto suelto en ingles', () => {
    // Heuristica barata: textos JSX literales tipo ">Some words<" o placeholder/aria-label/title con frase en ingles.
    const SUSPECT = />\s*(Cancel|Save|Delete|Loading|Settings|Inbox|Drafts|Sent|Trash|Archive|Today|Create Event|New Message|Add range|Unavailable|Inactive|Sign out|Compose|Unread|Reintentar)\s*</;
    for (const file of FILES.filter((f) => f.endsWith('.tsx'))) {
        it(`${file}`, () => {
            const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
            expect(SUSPECT.test(src)).toBe(false);
            expect(/(?:title|aria-label|placeholder)="[A-Za-zÀ-ÿ][^"{}]* [^"{}]*"/.test(src)).toBe(false);
        });
    }
});
