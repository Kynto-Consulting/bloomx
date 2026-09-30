import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { dictionaries, flattenMessages } from '@/lib/i18n';
import { FIELD_DEFS, FIELD_GROUPS } from '../rules/conditionMeta';
import { LABEL_ICONS } from '@/lib/labels/model';
import { TEMPLATE_IDS } from '../rules/ruleTemplates';

const ROOT = path.resolve(__dirname, '../../..');
const es = flattenMessages(dictionaries.es!);
const en = flattenMessages(dictionaries.en!);

function files(dir: string): string[] {
    return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? [] : [`${dir}/${d.name}`]));
}
const SOURCES = [...files('src/components/labels'), ...files('src/components/rules'), 'src/components/settings/LabelsSettings.tsx', 'src/components/settings/RulesSettings.tsx', 'src/components/Sidebar.tsx']
    .filter((f) => /\.tsx?$/.test(f));

describe('i18n de etiquetas y reglas', () => {
    it('todas las claves literales existen en es y en', () => {
        const missing: string[] = [];
        for (const f of SOURCES) {
            const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
            for (const m of src.matchAll(/'((?:labelTree|ruleBuilder)\.[A-Za-z0-9_.]+)'/g)) {
                if (!(m[1] in es) || !(m[1] in en)) missing.push(`${f}: ${m[1]}`);
            }
        }
        expect(missing).toEqual([]);
    });

    it('las claves dinamicas cubren todos los campos, grupos, iconos y plantillas', () => {
        const need: string[] = [];
        for (const f of FIELD_DEFS) need.push(`ruleBuilder.fields.${f.id}`);
        for (const g of FIELD_GROUPS) need.push(`ruleBuilder.groups.${g}`);
        for (const i of LABEL_ICONS) need.push(`labelTree.icons.${i}`);
        for (const t of TEMPLATE_IDS) need.push(`ruleBuilder.templates.${t}`);
        for (const a of ['addLabel', 'removeLabel', 'moveToLabelFolder', 'markRead', 'star', 'archive', 'moveToFolder', 'delete', 'markSpam', 'forwardTo', 'snooze', 'stopProcessing']) need.push(`ruleBuilder.editor.actions.${a}`);
        for (const o of ['contains', 'notContains', 'equals', 'notEquals', 'startsWith', 'endsWith', 'regex', 'notRegex', 'in', 'notIn', 'containsAny', 'wildcard', 'notWildcard', 'exists', 'notExists']) need.push(`ruleBuilder.ops.${o}`);
        for (const e of ['cycle', 'depth', 'conflict', 'limit', 'network', 'generic']) need.push(`labelTree.errors.${e}`);
        expect(need.filter((k) => !(k in es) || !(k in en))).toEqual([]);
    });

    it('es y en tienen las mismas claves en los nuevos espacios', () => {
        const pick = (m: Record<string, string>) => Object.keys(m).filter((k) => k.startsWith('labelTree.') || k.startsWith('ruleBuilder.')).sort();
        expect(pick(en)).toEqual(pick(es));
    });
});
