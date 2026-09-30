import { describe, expect, it } from 'vitest';
import { buildToolbarItems, expandMenuMounts, type ToolbarMount } from '../ExtensionToolbar';

const mount = (component: any, extra: Partial<ToolbarMount> = {}): ToolbarMount => ({ extensionId: 'core-calendar', extensionName: 'Calendar', component, ...extra });

describe('expandMenuMounts', () => {
    it('convierte un BUTTON con menuOptions en una accion de barra por opcion', () => {
        const out = expandMenuMounts([mount({ type: 'BUTTON', props: { label: 'Event', icon: 'CalendarDays', menuOptions: [
            { label: 'New event', icon: 'CalendarPlus', onClick: { action: 'OPEN_OVERLAY', targetId: 'a' } },
            { separator: true },
            { label: 'Select event', onClick: { action: 'OPEN_OVERLAY', targetId: 'b' } },
        ] } }, { id: 'ev' })]);
        expect(out.map((m) => m.component.type)).toEqual(['BUTTON', 'BUTTON']);
        expect(out.map((m) => m.component.props.label)).toEqual(['New event', 'Select event']);
        expect(out[0].component.props.icon).toBe('CalendarPlus');
        expect(out[1].component.props.icon).toBe('CalendarDays'); // hereda el del boton
        expect(out.map((m) => m.id)).toEqual(['ev-opt0', 'ev-opt1']);
    });

    it('un MENU con items tambien se expande; un boton normal queda igual', () => {
        const plain = mount({ type: 'BUTTON', props: { label: 'Plain', onClick: { action: 'TOAST', message: 'x' } } });
        const menu = mount({ type: 'MENU', props: { label: 'M', items: [{ label: 'One', onClick: { action: 'TOAST', message: '1' } }] } }, { id: 'm' });
        const out = expandMenuMounts([plain, menu]);
        expect(out[0]).toBe(plain);
        expect(out[1].component.props.label).toBe('One');
    });

    it('buildToolbarItems da a cada opcion su propia clave estable', () => {
        const { items } = buildToolbarItems('COMPOSER_TOOLBAR', [mount({ type: 'BUTTON', props: { label: 'Event', menuOptions: [
            { label: 'New', onClick: { action: 'TOAST', message: 'n' } }, { label: 'Pick', onClick: { action: 'TOAST', message: 'p' } },
        ] } }, { id: 'ev' })]);
        expect(items.map((i) => i.label)).toEqual(['New', 'Pick']);
        expect(new Set(items.map((i) => i.key)).size).toBe(2);
    });
});
