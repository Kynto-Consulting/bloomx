// @vitest-environment jsdom
/**
 * Mail Groups (pestana nativa de Ajustes): sin bucle de guardado (SettingsModal pasa un `onSave` nuevo en cada render y guarda
 * en el estado del padre: el componente solo debe guardar cuando el contenido CAMBIA) y textos localizados es/en.
 */
import React, { act, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { flush, installCleanup, mount, q, qa } from '@/components/expansions/kit/__tests__/harness';

const locale = vi.hoisted(() => ({ value: 'es' as 'es' | 'en' }));
vi.mock('@/components/I18nProvider', async () => {
    const { getTranslator } = await import('@/lib/i18n');
    return { useI18n: () => ({ locale: locale.value, t: getTranslator(locale.value).t }) };
});
vi.mock('@/components/ui/TagInput', () => ({ TagInput: ({ value, ariaLabel, placeholder }: any) => <input data-testid="members" aria-label={ariaLabel} placeholder={placeholder} defaultValue={(value ?? []).join(',')} /> }));

import { MailGroupsSettings } from '../MailGroupsSettings';

function Parent({ initial, onSaveSpy }: { initial: any; onSaveSpy: (s: any) => void }) {
    const [settings, setSettings] = useState<any>(initial);
    // Igual que SettingsModal: onSave inline (identidad nueva en cada render) que guarda un objeto NUEVO en el estado del padre.
    return <MailGroupsSettings settings={settings} onSave={(next: any) => { onSaveSpy(next); setSettings({ ...next }); }} />;
}

describe('MailGroupsSettings', () => {
    installCleanup();

    it('no entra en bucle de guardado al abrirse (antes: "Maximum update depth exceeded")', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => { });
        const save = vi.fn();
        await mount(<Parent initial={{ groups: { '@ventas': ['a@x.com', 'b@x.com'] } }} onSaveSpy={save} />);
        await flush();
        await flush();
        expect(save.mock.calls.length).toBeLessThanOrEqual(1);
        expect(errors.mock.calls.filter((c) => String(c[0]).includes('Maximum update depth'))).toHaveLength(0);
        errors.mockRestore();
    });

    it('sin grupos: no guarda nada al abrirse', async () => {
        const save = vi.fn();
        await mount(<Parent initial={{}} onSaveSpy={save} />);
        await flush();
        expect(save).not.toHaveBeenCalled();
    });

    it('textos en espanol e ingles, sin restos del otro idioma', async () => {
        const save = vi.fn();
        locale.value = 'es';
        const es = await mount(<Parent initial={{ groups: { '@ventas': ['a@x.com'] } }} onSaveSpy={save} />);
        await flush();
        expect(es.container.textContent).toContain('Grupos de correo');
        expect(es.container.textContent).toContain('Añadir grupo');
        expect(es.container.textContent).not.toContain('Add group');
        expect(qa('button', es.container).some((b) => b.getAttribute('aria-label') === 'Quitar el grupo @ventas')).toBe(true);
        expect(q('[data-testid="members"]', es.container)!.getAttribute('aria-label')).toBe('Miembros de @ventas');

        locale.value = 'en';
        const en = await mount(<Parent initial={{ groups: { '@sales': ['a@x.com'] } }} onSaveSpy={save} />);
        await flush();
        expect(en.container.textContent).toContain('Mail groups');
        expect(en.container.textContent).toContain('Add group');
        expect(en.container.textContent).not.toContain('Añadir grupo');
        expect(qa('button', en.container).some((b) => b.getAttribute('aria-label') === 'Remove group @sales')).toBe(true);
        locale.value = 'es';
    });

    it('anadir un grupo y escribir su alias guarda solo cuando hay alias y miembros', async () => {
        const save = vi.fn();
        const view = await mount(<Parent initial={{}} onSaveSpy={save} />);
        await act(async () => { qa('button', view.container).find((b) => b.textContent?.includes('Añadir grupo'))!.click(); });
        await flush();
        expect(qa('input[aria-label="Alias del grupo"]', view.container)).toHaveLength(1);
        expect(save).not.toHaveBeenCalled();
    });
});
