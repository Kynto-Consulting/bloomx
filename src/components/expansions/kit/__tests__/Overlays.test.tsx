// @vitest-environment jsdom
import React, { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../Actions';
import { Dialog, DrawerPanel, KitPopover, ModalFrame, Tooltip } from '../Overlays';
import { click, flush, installCleanup, key, kitSuite, mount, q, qa } from './harness';

const mouseDown = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
const fire = (el: Element, type: string) => act(async () => { el.dispatchEvent(new Event(type, { bubbles: true })); });

kitSuite('Overlays', () => (
    <div>
        <Dialog open title="Titulo" description="Descripcion" icon="Info" footer={<Button label="Ok" />}>Cuerpo</Dialog>
        <ModalFrame title="Marco" icon="Sparkles" description="d" footer={<Button label="Ok" />}>Cuerpo</ModalFrame>
        <DrawerPanel open title="Panel" side="left" footer={<Button label="x" />}>Cuerpo</DrawerPanel>
        <KitPopover triggerLabel="Abrir" title="Info">Contenido</KitPopover>
        <Tooltip text="Ayuda"><Button label="Hover" /></Tooltip>
    </div>
));

describe('Dialog', () => {
    installCleanup();
    it('role=dialog, aria-modal, aria-labelledby, cerrar y Escape', async () => {
        const onClose = vi.fn();
        await mount(<Dialog open onClose={onClose} title="Mi titulo" description="desc" width="lg" footer={<Button label="Guardar" />}><button type="button">dentro</button></Dialog>);
        await flush();
        const d = q('[role=dialog]')!;
        expect(d.getAttribute('aria-modal')).toBe('true');
        const h = document.getElementById(d.getAttribute('aria-labelledby')!)!;
        expect(h.textContent).toBe('Mi titulo');
        expect(d.className).toContain('bg-card');
        expect(d.className).toContain('max-w-2xl');
        expect(document.querySelector('.bg-overlay')).toBeTruthy();
        const closeBtn = q('button[aria-label="Cerrar"]')!;
        await click(closeBtn);
        expect(onClose).toHaveBeenCalledTimes(1);
        await key(document.body, 'Escape');
        expect(onClose).toHaveBeenCalledTimes(2);
    });
    it('foco inicial dentro y atrapado con Tab', async () => {
        await mount(<Dialog open title="T"><button type="button" id="last">ultimo</button></Dialog>);
        await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
        const d = q('[role=dialog]')!;
        expect(d.contains(document.activeElement)).toBe(true);
        (q('#last') as HTMLElement).focus();
        await key(document.activeElement, 'Tab');
        expect(d.contains(document.activeElement)).toBe(true);
    });
    it('cerrado no renderiza; props hostiles y HTML como texto', async () => {
        const m = await mount(<Dialog open={false} title="x" />);
        expect(q('[role=dialog]')).toBeNull();
        await m.render(<Dialog open title={'<img src=x onerror=alert(1)>'} description={{} as never} width={'zzz' as never} icon={{} as never}>{'<script>x</script>'}</Dialog>);
        expect(q('img')).toBeNull();
        expect(q('script')).toBeNull();
        expect(q('h2')!.textContent).toContain('<img');
    });
});

describe('ModalFrame', () => {
    installCleanup();
    it('sin backdrop ni posicion fija; titulo, icono y pie', async () => {
        await mount(<ModalFrame title="Marco" description="d" icon="Sparkles" footer={<Button label="Ok" />}>Cuerpo</ModalFrame>);
        expect(q('.fixed')).toBeNull();
        expect(q('.bg-overlay')).toBeNull();
        expect(q('h2')!.textContent).toBe('Marco');
        expect(q('section')!.getAttribute('aria-labelledby')).toBe(q('h2')!.id);
        expect(q('.text-primary')).toBeTruthy();
        expect(document.body.textContent).toContain('Cuerpo');
        expect(document.body.textContent).toContain('Ok');
    });
});

describe('DrawerPanel', () => {
    installCleanup();
    it('dialogo accesible, lado, cierre con boton y Escape', async () => {
        const onClose = vi.fn();
        await mount(<DrawerPanel open onClose={onClose} title="Filtros" side="left" width="lg"><p>hola</p></DrawerPanel>);
        await flush();
        const d = q('[role=dialog]')!;
        expect(d.getAttribute('aria-modal')).toBe('true');
        expect(document.getElementById(d.getAttribute('aria-labelledby')!)!.textContent).toBe('Filtros');
        expect(d.className).toContain('start-0');
        expect(d.className).toContain('w-[32rem]');
        await click(q('button[aria-label="Cerrar"]'));
        await key(document.body, 'Escape');
        expect(onClose).toHaveBeenCalledTimes(2);
    });
    it('cerrado no renderiza; derecha por defecto y valores raros', async () => {
        const m = await mount(<DrawerPanel title="x" />);
        expect(q('[role=dialog]')).toBeNull();
        await m.render(<DrawerPanel open side={'up' as never} width={{} as never} title={7 as never}>c</DrawerPanel>);
        expect(q('[role=dialog]')!.className).toContain('end-0');
    });
});

describe('KitPopover', () => {
    installCleanup();
    it('abre, aria-expanded/controls, Escape devuelve el foco, clic fuera cierra', async () => {
        await mount(<div><KitPopover triggerLabel="Abrir" title="Detalle" align="end"><button type="button" id="inner">dentro</button></KitPopover><p id="out">fuera</p></div>);
        const t = q('button')!;
        expect(t.getAttribute('aria-expanded')).toBe('false');
        await click(t);
        const panel = q('[role=dialog]')!;
        expect(t.getAttribute('aria-expanded')).toBe('true');
        expect(t.getAttribute('aria-controls')).toBe(panel.id);
        expect(panel.getAttribute('aria-label')).toBe('Detalle');
        expect(panel.className).toContain('end-0');
        expect(panel.contains(document.activeElement)).toBe(true);
        await key(document.activeElement, 'Escape');
        expect(q('[role=dialog]')).toBeNull();
        expect(document.activeElement).toBe(t);
        await click(t);
        await mouseDown(q('#out')!);
        expect(q('[role=dialog]')).toBeNull();
    });
    it('acepta un elemento como trigger (Button del kit y boton DOM)', async () => {
        const onPress = vi.fn();
        const m = await mount(<KitPopover trigger={<Button label="Kit" onPress={onPress} />}>c1</KitPopover>);
        const t = q('button')!;
        await click(t);
        expect(onPress).toHaveBeenCalled();
        expect(t.getAttribute('aria-expanded')).toBe('true');
        expect(document.body.textContent).toContain('c1');
        await m.unmount();
        await mount(<KitPopover trigger={<button type="button">Dom</button>}>c2</KitPopover>);
        await click(q('button'));
        expect(q('button')!.getAttribute('aria-expanded')).toBe('true');
    });
    it('sin trigger ni label hay un boton con nombre; hostil', async () => {
        await mount(<KitPopover title={'<script>x</script>'} align={'zz' as never} triggerLabel={{} as never}>{'<script>x</script>'}</KitPopover>);
        expect(q('button')!.getAttribute('aria-label')).toBeTruthy();
        await click(q('button'));
        expect(q('script')).toBeNull();
    });
});

describe('Tooltip', () => {
    installCleanup();
    it('aparece en focus y hover (con retardo), role=tooltip, aria-describedby y Escape', async () => {
        await mount(<Tooltip text="Ayuda util"><Button label="Hover" /></Tooltip>);
        const b = q('button')!;
        expect(q('[role=tooltip]')).toBeNull();
        await act(async () => { b.focus(); });
        const tip = q('[role=tooltip]')!;
        expect(tip.textContent).toBe('Ayuda util');
        expect(b.getAttribute('aria-describedby')).toBe(tip.id);
        await key(document.body, 'Escape');
        expect(q('[role=tooltip]')).toBeNull();
        await act(async () => { b.blur(); });
        await fire(b.parentElement!, 'mouseover');
        await act(async () => { b.parentElement!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
        await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
        expect(q('[role=tooltip]')).toBeTruthy();
        await act(async () => { b.parentElement!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); });
        expect(q('[role=tooltip]')).toBeNull();
    });
    it('hijo que no es elemento: el envoltorio es enfocable y describe; sin texto solo hijos; hostil', async () => {
        const m = await mount(<Tooltip text="t">solo texto</Tooltip>);
        const w = q('span[tabindex="0"]')!;
        expect(w.getAttribute('aria-describedby')).toBeTruthy();
        await m.render(<Tooltip text={{} as never}><button type="button">x</button></Tooltip>);
        expect(qa('[tabindex]')).toHaveLength(0);
        await m.render(<Tooltip text={'<img src=x onerror=alert(1)>'}><button type="button">x</button></Tooltip>);
        await act(async () => { q('button')!.focus(); });
        expect(q('img')).toBeNull();
        expect(q('[role=tooltip]')!.textContent).toContain('<img');
    });
});
