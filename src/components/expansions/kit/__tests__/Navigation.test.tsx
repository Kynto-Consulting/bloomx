// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { installCleanup, kitSuite, mount, click, key, typeInto, q, qa } from './harness';
import { Tabs, Accordion, Wizard, WizardControlsContext } from '../Navigation';

const tabs = [
    { label: 'Uno', value: 'one', content: <input aria-label="campo" /> },
    { label: 'Dos', value: 'two', icon: 'Mail', content: <p>dos</p> },
    { label: 'Tres', value: 'three', content: <p>tres</p> },
];
const sections = [{ title: 'A', content: <p>ca</p>, defaultOpen: true }, { title: 'B', content: <p>cb</p> }, { title: 'C', content: <p>cc</p>, defaultOpen: true }];
const steps = [{ title: 'Uno', content: <input aria-label="n" /> }, { title: 'Dos', description: 'desc', content: <p>p2</p> }, { title: 'Tres', content: <p>p3</p> }];

kitSuite('Tabs underline', () => <Tabs tabs={tabs} />);
kitSuite('Tabs pills', () => <Tabs tabs={tabs} variant="pills" defaultValue="two" />);
kitSuite('Accordion', () => <Accordion sections={sections} />);
kitSuite('Wizard', () => <Wizard steps={steps} defaultStep={1} />);

const tab = (i: number) => qa('[role="tab"]')[i];

describe('Tabs', () => {
    installCleanup();
    it('roles ARIA y roving tabindex', async () => {
        await mount(<Tabs tabs={tabs} />);
        expect(q('[role="tablist"]')).toBeTruthy();
        const t = qa('[role="tab"]');
        expect(t.map((x) => x.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
        expect(t.map((x) => x.tabIndex)).toEqual([0, -1, -1]);
        const panel = q('[role="tabpanel"]')!;
        expect(t[0].getAttribute('aria-controls')).toBe(panel.id);
        expect(panel.getAttribute('aria-labelledby')).toBe(t[0].id);
    });
    it('flechas, Inicio/Fin y activacion automatica con onChange', async () => {
        const onChange = vi.fn();
        await mount(<Tabs tabs={tabs} onChange={onChange} />);
        await key(tab(0), 'ArrowRight');
        expect(onChange).toHaveBeenLastCalledWith('two');
        expect(tab(1).getAttribute('aria-selected')).toBe('true');
        await key(tab(1), 'End');
        expect(onChange).toHaveBeenLastCalledWith('three');
        await key(tab(2), 'ArrowRight');
        expect(onChange).toHaveBeenLastCalledWith('one');
        await key(tab(0), 'ArrowLeft');
        expect(onChange).toHaveBeenLastCalledWith('three');
        await key(tab(2), 'Home');
        expect(onChange).toHaveBeenLastCalledWith('one');
    });
    it('paneles inactivos montados con hidden y estado conservado', async () => {
        await mount(<Tabs tabs={tabs} />);
        expect(qa('[role="tabpanel"]').map((p) => (p as HTMLElement).hidden)).toEqual([false, true, true]);
        await typeInto(q<HTMLInputElement>('input[aria-label="campo"]'), 'hola');
        await click(tab(1));
        await click(tab(0));
        expect(q<HTMLInputElement>('input[aria-label="campo"]')!.value).toBe('hola');
    });
    it('keepMounted=false desmonta; controlado por value (o label)', async () => {
        const m = await mount(<Tabs tabs={tabs} keepMounted={false} value="Dos" />);
        expect(qa('[role="tabpanel"]').length).toBe(1);
        expect(q('[role="tabpanel"]')?.textContent).toBe('dos');
        await click(tab(2));
        expect(tab(1).getAttribute('aria-selected')).toBe('true'); // controlado: no cambia solo
        await m.render(<Tabs tabs={tabs} value="three" />);
        expect(tab(2).getAttribute('aria-selected')).toBe('true');
    });
    it('clases de variante y entradas hostiles', async () => {
        await mount(<Tabs tabs={tabs} variant="pills" />);
        expect(tab(0).className).toContain('bg-primary text-primary-foreground');
        await mount(<Tabs tabs={[null, { label: { a: 1 } }, 5] as any} variant={'x' as any} />);
        await mount(<Tabs tabs={'x' as any} />);
    });
});

describe('Accordion', () => {
    installCleanup();
    it('ARIA, estado inicial y toggle', async () => {
        await mount(<Accordion sections={sections} />);
        const b = qa('button[aria-expanded]');
        expect(b.map((x) => x.getAttribute('aria-expanded'))).toEqual(['true', 'false', 'true']);
        expect(b[0].parentElement?.tagName).toBe('H3');
        const r = qa('[role="region"]');
        expect(r.map((x) => (x as HTMLElement).hidden)).toEqual([false, true, false]);
        expect(b[1].getAttribute('aria-controls')).toBe(r[1].id);
        expect(r[1].getAttribute('aria-labelledby')).toBe(b[1].id);
        await click(b[1]);
        expect(qa('button[aria-expanded]')[1].getAttribute('aria-expanded')).toBe('true');
        expect(qa('[role="region"]').length).toBe(3);
    });
    it('multiple=false solo deja una abierta', async () => {
        await mount(<Accordion sections={sections} multiple={false} />);
        expect(qa('button[aria-expanded="true"]').length).toBe(1);
        await click(qa('button[aria-expanded]')[1]);
        expect(qa('button[aria-expanded]').map((x) => x.getAttribute('aria-expanded'))).toEqual(['false', 'true', 'false']);
    });
    it('flechas mueven el foco entre cabeceras', async () => {
        await mount(<Accordion sections={sections} />);
        const b = qa('button[aria-expanded]');
        b[0].focus();
        await key(b[0], 'ArrowDown');
        expect(document.activeElement).toBe(b[1]);
        await key(b[1], 'End');
        expect(document.activeElement).toBe(b[2]);
        await key(b[2], 'ArrowDown');
        expect(document.activeElement).toBe(b[0]);
        await key(b[0], 'ArrowUp');
        expect(document.activeElement).toBe(b[2]);
        await key(b[2], 'Home');
        expect(document.activeElement).toBe(b[0]);
    });
    it('hostil', async () => {
        await mount(<Accordion sections={[null, { title: { a: 1 } }] as any} />);
        await mount(<Accordion sections={undefined} />);
    });
});

describe('Wizard', () => {
    installCleanup();
    it('indicador accesible y texto de paso', async () => {
        await mount(<Wizard steps={steps} />);
        expect(qa('ol li').map((l) => l.getAttribute('aria-current'))).toEqual(['step', null, null]);
        expect(document.body.textContent).toContain('Paso 1 de 3');
    });
    it('nav auto: Atras/Siguiente/Finalizar y onFinish; conserva el estado de inputs', async () => {
        const onFinish = vi.fn(), onStepChange = vi.fn();
        await mount(<Wizard steps={steps} onFinish={onFinish} onStepChange={onStepChange} />);
        const btn = (t: string) => qa('button').find((b) => b.textContent === t) ?? null;
        expect(btn('Atras')).toBeNull();
        await typeInto(q<HTMLInputElement>('input[aria-label="n"]'), 'keep');
        await click(btn('Siguiente'));
        expect(onStepChange).toHaveBeenLastCalledWith(1);
        expect(document.body.textContent).toContain('Paso 2 de 3');
        expect(q('ol li[aria-current]')?.textContent).toContain('Dos');
        await click(btn('Siguiente'));
        expect(btn('Siguiente')).toBeNull();
        await click(btn('Atras'));
        await click(btn('Atras'));
        expect(q<HTMLInputElement>('input[aria-label="n"]')!.value).toBe('keep');
        await click(btn('Siguiente'));
        await click(btn('Siguiente'));
        await click(btn('Finalizar'));
        expect(onFinish).toHaveBeenCalledTimes(1);
    });
    it('nav manual (solo Atras) con contexto', async () => {
        let ctl: any;
        const Probe = () => { ctl = React.useContext(WizardControlsContext); return <button type="button" id="go" onClick={() => ctl.next()}>ir</button>; };
        await mount(<Wizard nav="manual" backLabel="Volver" steps={[{ title: 'A', content: <Probe /> }, { title: 'B', content: <p>b</p> }]} />);
        expect(qa('button').map((b) => b.textContent)).toEqual(['ir']);
        expect(ctl).toMatchObject({ step: 0, total: 2 });
        await click(q('#go'));
        expect(ctl.step).toBe(1);
        expect(qa('button').map((b) => b.textContent)).toEqual(['ir', 'Volver']);
        await click(qa('button')[1]);
        expect(ctl.step).toBe(0);
    });
    it('controlado por step y entradas hostiles', async () => {
        const m = await mount(<Wizard steps={steps} step={2} />);
        expect(document.body.textContent).toContain('Paso 3 de 3');
        await m.render(<Wizard steps={steps} step={-5} />);
        expect(document.body.textContent).toContain('Paso 1 de 3');
        await mount(<Wizard steps={[null, { title: { a: 1 } }] as any} nav={'x' as any} step={'q' as any} />);
        await mount(<Wizard steps={'x' as any} />);
    });
});
