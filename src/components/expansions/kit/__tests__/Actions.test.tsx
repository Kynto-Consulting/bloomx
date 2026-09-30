// @vitest-environment jsdom
import React, { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button, ButtonGroup, IconButton, Menu } from '../Actions';
import { click, flush, installCleanup, key, kitSuite, mount, q, qa } from './harness';

const TONES = ['neutral', 'primary', 'success', 'warning', 'danger', 'info'] as const;
const VARIANTS = ['solid', 'soft', 'outline', 'ghost', 'link'] as const;

async function mouseDown(el: Element) {
    await act(async () => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
}

kitSuite('Actions', () => (
    <div>
        {VARIANTS.map((v) => TONES.map((t) => <Button key={`${v}${t}`} label="Ok" variant={v} tone={t} icon="Check" />))}
        <Button label="Cargando" loading />
        <Button label="Icono" showLabel={false} icon="Plus" />
        <IconButton icon="Trash2" label="Borrar" tone="danger" variant="soft" />
        <ButtonGroup attached><Button label="A" variant="outline" /><Button label="B" variant="outline" /></ButtonGroup>
        <Menu label="Mas" items={[{ label: 'Uno', icon: 'Pencil' }, { separator: true }, { label: 'Borrar', tone: 'danger' }]} />
    </div>
));

describe('Button', () => {
    installCleanup();
    it('props hostiles no rompen y el texto hostil es texto', async () => {
        const bad = '<img src=x onerror=alert(1)><script>x</script>';
        await mount(<Button label={bad} tone={'rainbow' as never} variant={'x' as never} size={{} as never} icon={{} as never} />);
        expect(q('button')!.textContent).toBe(bad);
        expect(q('img')).toBeNull();
        expect(q('script')).toBeNull();
        await mount(<Button label={{} as never} iconPosition={7 as never} />);
    });
    it('onPress, submit, disabled y loading', async () => {
        const fn = vi.fn();
        const m = await mount(<Button label="Go" onPress={fn} />);
        await click(q('button'));
        expect(fn).toHaveBeenCalledTimes(1);
        expect(q('button')!.getAttribute('type')).toBe('button');
        await m.render(<Button label="Go" submit onPress={fn} />);
        expect(q('button')!.getAttribute('type')).toBe('submit');
        await m.render(<Button label="Go" loading onPress={fn} />);
        const b = q<HTMLButtonElement>('button')!;
        expect(b.disabled).toBe(true);
        expect(b.getAttribute('aria-busy')).toBe('true');
        expect(b.querySelector('svg')).toBeTruthy();
        await click(b);
        expect(fn).toHaveBeenCalledTimes(1);
    });
    it('showLabel=false deja aria-label y title', async () => {
        await mount(<Button label="Anadir" icon="Plus" showLabel={false} />);
        const b = q('button')!;
        expect(b.getAttribute('aria-label')).toBe('Anadir');
        expect(b.getAttribute('title')).toBe('Anadir');
        expect(b.textContent).toBe('');
    });
    it('usa solo tokens: solid primary por defecto', async () => {
        await mount(<Button label="x" />);
        expect(q('button')!.className).toContain('bg-primary');
        expect(q('button')!.className).toContain('focus-visible:ring-ring');
    });
});

describe('IconButton', () => {
    installCleanup();
    it('label como aria-label y title; ghost por defecto', async () => {
        const fn = vi.fn();
        await mount(<IconButton icon="Trash2" label="Borrar" onPress={fn} />);
        const b = q('button')!;
        expect(b.getAttribute('aria-label')).toBe('Borrar');
        expect(b.getAttribute('title')).toBe('Borrar');
        expect(b.className).toContain('hover:bg-accent');
        await click(b);
        expect(fn).toHaveBeenCalled();
    });
});

describe('ButtonGroup', () => {
    installCleanup();
    it('role=group y attached', async () => {
        await mount(<ButtonGroup attached gap={'x' as never} align={{} as never}><Button label="A" /><Button label="B" /></ButtonGroup>);
        const g = q('[role=group]')!;
        expect(g).toBeTruthy();
        expect(g.className).toContain('rounded-s-none');
        expect(qa('button', g)).toHaveLength(2);
    });
});

describe('Menu', () => {
    installCleanup();
    const items = [{ label: 'Uno' }, { separator: true }, { label: 'Dos', disabled: true }, { label: 'Tres', tone: 'danger' as const }];
    it('ARIA y apertura con clic', async () => {
        await mount(<Menu label="Acciones" items={items} />);
        const t = q('button')!;
        expect(t.getAttribute('aria-haspopup')).toBe('menu');
        expect(t.getAttribute('aria-expanded')).toBe('false');
        expect(q('[role=menu]')).toBeNull();
        await click(t);
        expect(t.getAttribute('aria-expanded')).toBe('true');
        expect(qa('[role=menuitem]')).toHaveLength(3);
        expect(q('[role=separator]')).toBeTruthy();
        expect(document.activeElement).toBe(qa('[role=menuitem]')[0]);
    });
    it('flechas y Home/End saltan deshabilitados; Escape devuelve el foco', async () => {
        await mount(<Menu label="Acciones" items={items} />);
        const t = q('button')!;
        t.focus();
        await key(t, 'ArrowDown');
        const mi = qa('[role=menuitem]');
        expect(document.activeElement).toBe(mi[0]);
        await key(mi[0], 'ArrowDown');
        expect(document.activeElement).toBe(mi[2]);
        await key(mi[2], 'ArrowDown');
        expect(document.activeElement).toBe(mi[0]);
        await key(mi[0], 'End');
        expect(document.activeElement).toBe(mi[2]);
        await key(mi[2], 'Home');
        expect(document.activeElement).toBe(mi[0]);
        await key(mi[0], 'Escape');
        expect(q('[role=menu]')).toBeNull();
        expect(document.activeElement).toBe(t);
    });
    it('ArrowUp abre en el ultimo; Enter y Espacio en el trigger abren', async () => {
        await mount(<Menu label="A" items={items} />);
        const t = q('button')!;
        await key(t, 'ArrowUp');
        expect(document.activeElement).toBe(qa('[role=menuitem]')[2]);
        await key(document.activeElement, 'Escape');
        await key(t, 'Enter');
        expect(q('[role=menu]')).toBeTruthy();
        await key(document.activeElement, 'Escape');
        await key(t, ' ');
        expect(q('[role=menu]')).toBeTruthy();
    });
    it('onSelect(indice), onPress del item, cierra y enfoca el trigger', async () => {
        const onSelect = vi.fn();
        const onPress = vi.fn();
        await mount(<Menu label="A" items={[{ label: 'Uno', onPress }, ...items]} onSelect={onSelect} />);
        const t = q('button')!;
        await click(t);
        await click(qa('[role=menuitem]')[3]);
        expect(onSelect).toHaveBeenCalledWith(4);
        expect(q('[role=menu]')).toBeNull();
        expect(document.activeElement).toBe(t);
        await click(t);
        await key(document.activeElement, 'Enter');
        expect(onPress).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenLastCalledWith(0);
    });
    it('elementos deshabilitados no seleccionan; clic fuera cierra', async () => {
        const onSelect = vi.fn();
        await mount(<div><Menu label="A" items={items} onSelect={onSelect} /><p id="out">fuera</p></div>);
        await click(q('button'));
        await click(qa('[role=menuitem]').find((el) => el.textContent === 'Uno') ?? null);
        expect(onSelect).toHaveBeenCalledTimes(1);
        await click(q('button'));
        await flush();
        await mouseDown(q('#out')!);
        expect(q('[role=menu]')).toBeNull();
    });
    it('showLabel=false usa aria-label; items hostiles no rompen', async () => {
        await mount(<Menu label="Mas" showLabel={false} tone={'rainbow' as never} items={[null as never, { label: {} as never }, 5 as never, { label: '<script>x</script>' }]} align="end" />);
        const t = q('button')!;
        expect(t.getAttribute('aria-label')).toBe('Mas');
        await click(t);
        expect(q('script')).toBeNull();
        expect(q('[role=menu]')!.className).toContain('end-0');
        await mount(<Menu items={'x' as never} />);
    });
});
