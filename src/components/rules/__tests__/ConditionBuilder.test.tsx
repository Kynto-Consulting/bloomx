// @vitest-environment jsdom
/** Constructor de condiciones: grupos anidados, limites, chips, regex en vivo, teclado/ARIA y temas (3 paletas x claro/oscuro). */
import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { click, flush, installCleanup, key, kitSuite, mount, q, qa, typeInto } from '@/components/expansions/kit/__tests__/harness';

vi.mock('@/components/I18nProvider', async () => {
    const { getTranslator } = await import('@/lib/i18n');
    return { useI18n: () => ({ locale: 'es', t: getTranslator('es').t }) };
});

import { ConditionBuilder } from '../ConditionBuilder';
import { templateConditions } from '../ruleTemplates';
import { defaultLeaf } from '../conditionMeta';
import { MAX_DEPTH, MAX_LEAVES, validateConditionsV2, type ConditionsV2 } from '@/lib/rules/conditions';

let latest: ConditionsV2;
function Harness({ initial }: { initial: ConditionsV2 }) {
    const [v, setV] = useState(initial);
    latest = v;
    return <ConditionBuilder value={v} onChange={setV} labels={[]} contacts={['ana@empresa.com']} />;
}
const base = (): ConditionsV2 => ({ v: 2, root: { type: 'group', op: 'and', children: [{ field: 'subject', op: 'contains', value: 'factura' }] } });
const btn = (name: string) => qa<HTMLButtonElement>('button').find((b) => b.textContent?.includes(name) || b.getAttribute('aria-label')?.includes(name)) ?? null;

kitSuite('ConditionBuilder', () => <Harness initial={{ v: 2, root: { type: 'group', op: 'and', children: [defaultLeaf('fromDomain'), { type: 'group', op: 'not', children: [defaultLeaf('hasAttachment'), defaultLeaf('size'), defaultLeaf('date'), defaultLeaf('header'), defaultLeaf('auth'), defaultLeaf('dayOfWeek')] }] } }} />);

describe('ConditionBuilder', () => {
    installCleanup();

    it('anade y quita condiciones y grupos', async () => {
        await mount(<Harness initial={base()} />);
        expect(qa('li').length).toBeGreaterThan(0);
        await click(btn('Añadir condición'));
        expect((latest.root.children as any[]).length).toBe(2);
        await click(btn('Añadir grupo'));
        expect((latest.root.children[2] as any).type).toBe('group');
        await click(btn('Quitar grupo'));
        expect(latest.root.children.length).toBe(2);
        await click(qa<HTMLButtonElement>('button[aria-label="Quitar condición"]')[0]);
        expect(latest.root.children.length).toBe(1);
    });

    it('cambiar el campo reinicia la condicion con un valor valido para ese campo', async () => {
        await mount(<Harness initial={base()} />);
        const field = q<HTMLSelectElement>('select[aria-label="Campo"]');
        await typeInto(field, 'size');
        expect(latest.root.children[0]).toMatchObject({ field: 'size', op: 'gt' });
        await typeInto(q<HTMLSelectElement>('select[aria-label="Campo"]'), 'hasAttachment');
        expect(latest.root.children[0]).toMatchObject({ field: 'hasAttachment', value: true });
    });

    it('cambiar el tipo de grupo a "Ninguna"', async () => {
        await mount(<Harness initial={base()} />);
        await typeInto(q<HTMLSelectElement>('select[aria-label^="Tipo de grupo"]'), 'not');
        expect(latest.root.op).toBe('not');
    });

    it('operador "esta en la lista": fichas con Intro, coma y pegado; Backspace quita la ultima; sin repetidos', async () => {
        await mount(<Harness initial={{ v: 2, root: { type: 'group', op: 'and', children: [{ field: 'fromDomain', op: 'equals', value: '' }] } }} />);
        await typeInto(q<HTMLSelectElement>('select[aria-label="Operador"]'), 'in');
        const chip = () => q<HTMLInputElement>('input[aria-label="Valor"]')!;
        await typeInto(chip(), 'empresa.com');
        await key(chip(), 'Enter');
        await typeInto(chip(), 'otra.org,');
        await typeInto(chip(), 'EMPRESA.com');
        await key(chip(), 'Enter');
        expect((latest.root.children[0] as any).values).toEqual(['empresa.com', 'otra.org']);
        await key(chip(), 'Backspace');
        expect((latest.root.children[0] as any).values).toEqual(['empresa.com']);
        await click(q('button[aria-label="Quitar empresa.com"]'));
        expect((latest.root.children[0] as any).values).toEqual([]);
    });

    it('regex: validacion en vivo (rechaza anidados), ejemplo y prueba con texto', async () => {
        await mount(<Harness initial={{ v: 2, root: { type: 'group', op: 'and', children: [{ field: 'subject', op: 'regex', value: '' }] } }} />);
        const re = () => q<HTMLInputElement>('input[aria-label="Valor"]')!;
        await typeInto(re(), '(a+)+$');
        expect(re().getAttribute('aria-invalid')).toBe('true');
        expect(document.body.textContent).toContain('cuantificador anidado');
        await typeInto(re(), '^factura\\s*\\d+');
        expect(re().getAttribute('aria-invalid')).toBe('false');
        expect(document.body.textContent).toContain('Expresión válida');
        await typeInto(q<HTMLInputElement>('input[aria-label="Texto de prueba"]'), 'Factura 123');
        expect(document.body.textContent).toContain('Coincide');
        await typeInto(q<HTMLInputElement>('input[aria-label="Texto de prueba"]'), 'nada');
        expect(document.body.textContent).toContain('No coincide');
        await click(qa<HTMLButtonElement>('details button')[0]);
        expect(re().value).toContain('factura');
    });

    it('respeta el maximo de condiciones y de niveles (botones deshabilitados) y lo que produce es valido', async () => {
        const leaves = Array.from({ length: MAX_LEAVES }, () => defaultLeaf('hasAttachment'));
        const first = await mount(<Harness initial={{ v: 2, root: { type: 'group', op: 'or', children: leaves } }} />);
        expect(btn('Añadir condición')!.disabled).toBe(true);
        expect(btn('Añadir grupo')!.disabled).toBe(true);
        expect(document.body.textContent).toContain(`${MAX_LEAVES} de ${MAX_LEAVES} condiciones`);

        await first.unmount();
        let deep: any = defaultLeaf('hasAttachment');
        for (let i = 0; i < MAX_DEPTH; i++) deep = { type: 'group', op: 'and', children: [deep] };
        const m = await mount(<Harness initial={{ v: 2, root: deep }} />);
        const addGroups = qa<HTMLButtonElement>('button').filter((b) => b.textContent?.includes('Añadir grupo'));
        expect(addGroups[0].disabled).toBe(true); // el grupo mas interno esta en el nivel maximo
        expect(addGroups[addGroups.length - 1].disabled).toBe(false); // la raiz aun puede anidar
        await m.unmount();

        await mount(<Harness initial={templateConditions('invoices')} />);
        await flush();
        expect(validateConditionsV2(latest.root ? latest : templateConditions('invoices')).ok).toBe(true);
    });

    it('todos los controles tienen nombre accesible', async () => {
        await mount(<Harness initial={templateConditions('automated')} />);
        const unnamed = qa('select, input:not([type=hidden])').filter((el) => !(el.getAttribute('aria-label') || el.closest('label')?.textContent?.trim()));
        expect(unnamed.map((e) => e.outerHTML)).toEqual([]);
        const unnamedButtons = qa('button').filter((b) => !b.textContent?.trim() && !b.getAttribute('aria-label'));
        expect(unnamedButtons).toHaveLength(0);
    });

    it('sugerencias de contactos en remitente', async () => {
        await mount(<Harness initial={{ v: 2, root: { type: 'group', op: 'and', children: [{ field: 'from', op: 'contains', value: '' }] } }} />);
        expect(q('datalist option[value="ana@empresa.com"]')).toBeTruthy();
    });
});
