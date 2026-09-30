import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extensionsEn, extensionsEs } from '@/lib/i18n/messages/admin-console/extensions';
import { KNOWN_MOUNT_POINTS } from '@/lib/expansions/manifest-schema';
import { CATEGORIES } from '@/lib/admin/extensions-manifest';
import { STATUS_FILTERS } from '@/lib/admin/extensions-view';

const root = path.resolve(__dirname, '../../../..');
const dirs = [path.join(root, 'src/components/admin/extensions'), path.join(root, 'src/app/admin/(console)/extensions')];

function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name);
        if (name === '__tests__') return [];
        return statSync(full).isDirectory() ? sources(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
    });
}

const resolvePath = (dict: any, key: string) => key.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), dict);

describe('i18n de la seccion de extensiones', () => {
    it('toda clave admin.console.extensions.* usada en los componentes existe en es y en', () => {
        const used = new Set<string>();
        for (const file of dirs.flatMap(sources)) {
            for (const m of readFileSync(file, 'utf8').matchAll(/admin\.console\.extensions\.([A-Za-z0-9_.]+)/g)) used.add(m[1]);
        }
        expect(used.size).toBeGreaterThan(40);
        const missing: string[] = [];
        for (const key of used) {
            const prefix = key.endsWith('.');
            const k = prefix ? key.slice(0, -1) : key;
            for (const [lang, dict] of [['es', extensionsEs], ['en', extensionsEn]] as const) {
                const v = resolvePath(dict, k);
                const ok = prefix ? v && typeof v === 'object' : typeof v === 'string';
                if (!ok) missing.push(`${lang}:${key}`);
            }
        }
        expect(missing).toEqual([]);
    });

    it('cubre todos los valores de los enumerados dinamicos (categorias, estados, puntos de montaje, riesgos)', () => {
        for (const dict of [extensionsEs, extensionsEn] as any[]) {
            for (const c of CATEGORIES) expect(typeof dict.filters.categories[c], c).toBe('string');
            for (const s of STATUS_FILTERS) expect(typeof dict.filters.statuses[s], s).toBe('string');
            for (const p of KNOWN_MOUNT_POINTS) expect(typeof dict.mounts[p], p).toBe('string');
            for (const r of ['high', 'medium', 'low']) expect(typeof dict.permissions.risk[r], r).toBe('string');
        }
    });

    it('es y en tienen las mismas claves y ningun valor vacio', () => {
        const flat = (o: any, prefix = ''): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : flat(v, `${prefix}${k}.`)));
        expect(flat(extensionsEn).sort()).toEqual(flat(extensionsEs).sort());
        for (const dict of [extensionsEs, extensionsEn]) for (const k of flat(dict)) expect(resolvePath(dict, k).trim().length, k).toBeGreaterThan(0);
    });
});
