import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { dictionaries, flattenMessages } from '../i18n';
import { SHORTCUT_DEFS } from '../shortcuts';
import { ACTION_META } from '../../components/mail/action-meta';
import { DATE_BUCKET_KEYS } from '../../components/mail/date-buckets';
import { MAIL_FOLDERS } from '../mail-actions';
import { QUICK_FILTERS } from '../mail-list-view';
import { DENSITIES, SORTS } from '../mail-prefs';

// Cada clave i18n literal usada por la bandeja, el lector, el Sidebar y los componentes de src/components/mail
// debe existir en es Y en en (si falta, el usuario veria "emailList.xyz" en pantalla).
const SRC = path.resolve(__dirname, '../..');
const es = flattenMessages(dictionaries.es!);
const en = flattenMessages(dictionaries.en!);

function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(p);
        return /\.tsx?$/.test(e.name) ? [p] : [];
    });
}

const FILES = [
    ...walk(path.join(SRC, 'components/mail')),
    ...['EmailList', 'MailView', 'Sidebar', 'RealTimeListener', 'VirtualMailRows'].map((n) => path.join(SRC, 'components', `${n}.tsx`)),
    ...['mail-actions', 'mail-list-view', 'mail-list', 'shortcuts', 'mail-view-state', 'mail-prefs'].map((n) => path.join(SRC, 'lib', `${n}.ts`)),
];
const NS = ['emailList', 'sidebar', 'mailView'];
const KEY_RE = new RegExp(`'((?:${NS.join('|')})\\.[A-Za-z0-9_.]+)'`, 'g');
const PLURAL_RE = /pluralKey\(\s*(?:[^'"]*?\?\s*)?'([A-Za-z0-9_.]+)'/g;

function usedKeys(): Map<string, string> {
    const used = new Map<string, string>();
    for (const f of FILES) {
        const src = fs.readFileSync(f, 'utf8');
        for (const m of src.matchAll(KEY_RE)) used.set(m[1], path.relative(SRC, f));
    }
    return used;
}

const placeholders = (s: string) => Array.from(s.matchAll(/\{(\w+)\}/g), (m) => m[1]).sort().join(',');

describe('i18n de bandeja, lector y sidebar', () => {
    it('todas las claves usadas existen en es y en (las bases de plural tienen One y Many)', () => {
        const missing: string[] = [];
        for (const [key, file] of usedKeys()) {
            const isPluralBase = !(key in es) && `${key}One` in es && `${key}Many` in es;
            if (isPluralBase) {
                if (!(`${key}One` in en) || !(`${key}Many` in en)) missing.push(`${key}(One|Many) en en [${file}]`);
                continue;
            }
            if (!(key in es)) missing.push(`${key} en es [${file}]`);
            if (!(key in en)) missing.push(`${key} en en [${file}]`);
        }
        expect(missing).toEqual([]);
    });

    it('las bases de plural usadas con pluralKey(...) tienen One y Many en ambos idiomas', () => {
        const missing: string[] = [];
        for (const f of FILES.filter((x) => x.endsWith('.tsx') || x.endsWith('.ts'))) {
            const src = fs.readFileSync(f, 'utf8');
            for (const m of src.matchAll(PLURAL_RE)) {
                for (const suffix of ['One', 'Many']) {
                    if (!(`${m[1]}${suffix}` in es)) missing.push(`${m[1]}${suffix} en es`);
                    if (!(`${m[1]}${suffix}` in en)) missing.push(`${m[1]}${suffix} en en`);
                }
            }
        }
        expect(missing).toEqual([]);
    });

    it('familias de claves dinamicas: acciones, atajos, fechas, filtros, vista, posponer, carpetas vacias', () => {
        const keys: string[] = [
            ...Object.values(ACTION_META).map((m) => m.labelKey),
            ...SHORTCUT_DEFS.map((d) => d.labelKey),
            ...['navigate', 'act', 'compose'].map((g) => `emailList.shortcuts.groups.${g}`),
            ...Object.values(DATE_BUCKET_KEYS),
            ...QUICK_FILTERS.map((f) => `emailList.filters.${f}`),
            ...DENSITIES.map((d) => `emailList.view.density.${d}`),
            ...SORTS.map((s) => `emailList.view.sort.${s}`),
            ...[0, 1, 2].map((n) => `emailList.view.preview.${n}`),
            ...['laterToday', 'tomorrow', 'weekend', 'nextWeek'].map((p) => `emailList.snooze.${p}`),
            ...MAIL_FOLDERS.map((f) => `sidebar.folders.${f}`),
            ...MAIL_FOLDERS.flatMap((f) => [`emailList.empty.folders.${f}.title`, `emailList.empty.folders.${f}.hint`]),
            ...['accepted', 'tentative', 'declined'].map((r) => `mailView.invite.responded.${r}`),
            ...['pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror', 'unknown'].map((v) => `mailView.auth.verdict.${v}`),
            ...['verified', 'partial', 'failed', 'unknown'].map((s) => `mailView.auth.${s}`),
        ];
        const missing = keys.filter((k) => !(k in es) || !(k in en));
        expect(missing).toEqual([]);
    });

    it('es y en usan los mismos parametros {x} en cada mensaje de estos espacios', () => {
        const bad: string[] = [];
        for (const key of Object.keys(es)) {
            if (!NS.some((ns) => key.startsWith(`${ns}.`))) continue;
            if (key in en && placeholders(es[key]) !== placeholders(en[key])) bad.push(`${key}: ${placeholders(es[key])} vs ${placeholders(en[key])}`);
        }
        expect(bad).toEqual([]);
    });

    it('mismas claves en es y en para estos espacios', () => {
        const onlyEs = Object.keys(es).filter((k) => NS.some((ns) => k.startsWith(`${ns}.`)) && !(k in en));
        const onlyEn = Object.keys(en).filter((k) => NS.some((ns) => k.startsWith(`${ns}.`)) && !(k in es));
        expect(onlyEs).toEqual([]);
        expect(onlyEn).toEqual([]);
    });
});
