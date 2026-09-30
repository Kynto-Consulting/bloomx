// @vitest-environment jsdom
/** Ajustes -> Spam: interruptor de aprendizaje, sensibilidad (bloqueada por el dominio), estado del modelo, borrado con confirmacion y listas. */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/components/I18nProvider';
import { click, flush, installCleanup, kitSuite, mount, q, qa } from '@/components/expansions/kit/__tests__/harness';

vi.mock('../SpamListEditor', () => ({
    SpamListEditor: (p: any) => <div data-list-editor={p.kind} data-api={p.apiBase} data-variant={p.variant} />,
}));

import { SpamSettings } from '../SpamSettings';

const wrap = (node: React.ReactElement, locale: 'es' | 'en' = 'es') => <I18nProvider locale={locale}>{node}</I18nProvider>;

const view = (over: any = {}) => ({
    prefs: { learn: true, sensitivity: 0, ...(over.prefs || {}) },
    domain: { level: 'balanced', allowUserSensitivity: true, learningAllowed: true, externalEnabled: true, ...(over.domain || {}) },
    effectiveThreshold: 60, baseThreshold: 60,
    model: { spamMessages: 12, hamMessages: 30, tokens: 850, minMessages: 20, active: true, ...(over.model || {}) },
});

let state: ReturnType<typeof view>;
let calls: Array<{ url: string; method: string; body: any }>;
beforeEach(() => {
    state = view();
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body) : undefined });
        if (url !== '/api/spam/settings') return { ok: false, status: 404, json: async () => ({}) };
        if (method === 'PUT') { const b = JSON.parse(init.body); state = view({ prefs: { ...state.prefs, ...b }, domain: state.domain, model: state.model }); }
        if (method === 'DELETE') state = view({ prefs: state.prefs, domain: state.domain, model: { spamMessages: 0, hamMessages: 0, tokens: 0, active: false } });
        return { ok: true, status: 200, json: async () => state };
    }));
});
afterEach(() => vi.unstubAllGlobals());

const sw = () => q<HTMLButtonElement>('[role="switch"]')!;
const radios = () => qa<HTMLInputElement>('input[type="radio"]');

describe('SpamSettings', () => {
    installCleanup();

    it('carga con role=status y luego muestra el interruptor de aprender (activo por defecto)', async () => {
        const real = (globalThis.fetch as any).getMockImplementation();
        let release!: () => void;
        (globalThis.fetch as any).mockImplementationOnce(async (...a: any[]) => { await new Promise<void>((r) => { release = r; }); return real(...a); });
        await mount(wrap(<SpamSettings />));
        expect(q('[role="status"]')!.textContent).toContain('Cargando');
        await React.act(async () => { release(); });
        await flush();
        expect(sw().getAttribute('aria-checked')).toBe('true');
        expect(document.getElementById(sw().getAttribute('aria-labelledby')!)!.textContent).toBe('Aprender de mis marcas');
    });

    it('error de carga: alerta con boton Reintentar', async () => {
        (globalThis.fetch as any).mockImplementationOnce(async () => ({ ok: false, status: 500, json: async () => ({}) }));
        await mount(wrap(<SpamSettings />));
        await flush();
        expect(q('[role="alert"]')!.textContent).toContain('No se pudieron cargar');
        await click(qa('button').find((b) => b.textContent === 'Reintentar')!);
        await flush();
        expect(sw()).toBeTruthy();
    });

    it('apagar el interruptor hace PUT {learn:false}', async () => {
        await mount(wrap(<SpamSettings />));
        await flush();
        await click(sw());
        await flush();
        expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ learn: false });
        expect(sw().getAttribute('aria-checked')).toBe('false');
    });

    it('sensibilidad: tres opciones, la actual marcada, y elegir una hace PUT {sensitivity}', async () => {
        await mount(wrap(<SpamSettings />));
        await flush();
        expect(radios().map((r) => r.value)).toEqual(['-1', '0', '1']);
        expect(radios().map((r) => r.checked)).toEqual([false, true, false]);
        await click(radios()[2]);
        await flush();
        expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ sensitivity: 1 });
        expect(qa('label').map((l) => l.textContent)).toEqual(expect.arrayContaining(['Más permisiva', 'Igual que el dominio', 'Más estricta']));
    });

    it('sensibilidad bloqueada si el dominio no la permite: deshabilitada y con explicacion asociada', async () => {
        state = view({ domain: { allowUserSensitivity: false } });
        await mount(wrap(<SpamSettings />));
        await flush();
        const fs = q<HTMLFieldSetElement>('fieldset')!;
        expect(fs.disabled).toBe(true);
        expect(radios().every((r) => r.matches(':disabled'))).toBe(true);
        const note = q('[data-sensitivity-locked]')!;
        expect(note.textContent).toContain('no permite cambiar la sensibilidad');
        expect(fs.getAttribute('aria-describedby')).toBe(note.id);
    });

    it('dominio Desactivado: sensibilidad bloqueada con su propia explicacion', async () => {
        state = view({ domain: { level: 'off' } });
        await mount(wrap(<SpamSettings />));
        await flush();
        expect(q<HTMLFieldSetElement>('fieldset')!.disabled).toBe(true);
        expect(q('[data-sensitivity-locked]')!.textContent).toContain('desactivado');
    });

    it('el dominio puede prohibir el aprendizaje: interruptor deshabilitado y explicado', async () => {
        state = view({ domain: { learningAllowed: false } });
        await mount(wrap(<SpamSettings />));
        await flush();
        expect(sw().disabled).toBe(true);
        expect(q('[data-spam-settings]')!.textContent).toContain('ha desactivado el aprendizaje');
    });

    it('estado del modelo: n spam / n no spam / tokens y minimo para activarse', async () => {
        state = view({ model: { spamMessages: 3, hamMessages: 4, tokens: 120, active: false, minMessages: 20 } });
        await mount(wrap(<SpamSettings />));
        await flush();
        expect(q('[data-model-stats]')!.textContent).toBe('3 como spam · 4 como no spam · 120 términos');
        expect(q('[data-spam-settings]')!.textContent).toContain('al menos 20 mensajes');
    });

    it('borrar lo aprendido pide confirmacion: cancelar no llama; confirmar hace DELETE y deja el modelo vacio', async () => {
        await mount(wrap(<SpamSettings />));
        await flush();
        await click(q('[data-clear-model]'));
        const dlg = q('[role="dialog"]')!;
        expect(dlg.textContent).toContain('¿Borrar lo aprendido?');
        await click(qa('button', dlg).find((b) => b.textContent === 'Cancelar')!);
        expect(q('[role="dialog"]')).toBeNull();
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
        await click(q('[data-clear-model]'));
        await click(qa('button', q('[role="dialog"]')!).find((b) => b.textContent === 'Borrar')!);
        await flush();
        expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
        expect(q('[data-spam-message]')!.getAttribute('role')).toBe('status');
        expect(q('[data-model-stats]')).toBeNull();
        expect(q<HTMLButtonElement>('[data-clear-model]')!.disabled).toBe(true);
    });

    it('un fallo al guardar muestra una alerta', async () => {
        await mount(wrap(<SpamSettings />));
        await flush();
        (globalThis.fetch as any).mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
        await click(sw());
        await flush();
        expect(q('[data-spam-message]')!.getAttribute('role')).toBe('alert');
    });

    it('las tres listas personales usan el editor compartido (user, /api/spam/lists); externos solo si el dominio los usa', async () => {
        await mount(wrap(<SpamSettings />));
        await flush();
        expect(qa('[data-list-editor]').map((e) => e.getAttribute('data-list-editor'))).toEqual(['block', 'allow', 'external']);
        expect(qa('[data-list-editor]').every((e) => e.getAttribute('data-api') === '/api/spam/lists' && e.getAttribute('data-variant') === 'user')).toBe(true);
    });

    it('externos desactivados por el dominio: no se muestra ese editor', async () => {
        state = view({ domain: { externalEnabled: false } });
        await mount(wrap(<SpamSettings />));
        await flush();
        expect(qa('[data-list-editor]').map((e) => e.getAttribute('data-list-editor'))).toEqual(['block', 'allow']);
    });

    it('en ingles', async () => {
        await mount(wrap(<SpamSettings />, 'en'));
        await flush();
        expect(document.body.textContent).toContain('Learn from my marks');
        expect(document.body.textContent).toContain('Stricter');
    });
});

kitSuite('SpamSettings (temas)', () => wrap(<SpamSettings />));
