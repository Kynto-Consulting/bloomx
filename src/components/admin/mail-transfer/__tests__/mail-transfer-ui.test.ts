// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/components/I18nProvider';
import { MissingMailboxesDialog, defaultDecision, validateDecision } from '../MissingMailboxesDialog';
import { PasswordMeter } from '../PasswordMeter';
import { ReauthDialog } from '../ReauthDialog';
import { checkPassword } from '@/lib/mail-transfer/password-policy';
import { credentialsToCsv } from '../credentials';
import { adminConsoleEn, adminConsoleEs } from '@/lib/i18n/messages/admin-console';
import { flattenMessages } from '@/lib/i18n';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

const wrap = (el: React.ReactElement) => React.createElement(I18nProvider, { locale: 'es', children: el });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 320)); });
const setValue = async (el: HTMLInputElement | HTMLSelectElement, value: string) => {
    await act(async () => {
        const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    });
};
const byLabel = (label: string) => document.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const submitBtn = () => Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Guardar y continuar') as HTMLButtonElement;

describe('politica de contrasena (espejo del servidor)', () => {
    it('12+ caracteres, no comun, no repetida, 72 bytes, sin el nombre del correo', () => {
        expect(checkPassword('corta').issues).toContain('length');
        expect(checkPassword('password123').issues).toContain('length');
        expect(checkPassword('aaaaaaaaaaaaaa').issues).toContain('repeated');
        expect(checkPassword('x'.repeat(40) + 'é'.repeat(20)).issues).toContain('bytes');
        expect(checkPassword('mariana-clave-1234', 'mariana@x.test').issues).toContain('email');
        const ok = checkPassword('Cielo-Azul-Luna-77');
        expect(ok).toMatchObject({ ok: true, score: 3 });
    });
    it('el CSV de credenciales neutraliza formulas', () => {
        const csv = credentialsToCsv([{ email: 'a@x.test', password: '=cmd|x', mustChange: true }]);
        expect(csv).toContain("'=cmd|x");
        expect(csv).toContain('yes');
    });
    it('paridad de claves es/en en el diccionario de importar/exportar', () => {
        const es = Object.keys(flattenMessages(adminConsoleEs.transfer as any)).sort();
        const en = Object.keys(flattenMessages(adminConsoleEn.transfer as any)).sort();
        expect(en).toEqual(es);
    });
});

describe('validateDecision', () => {
    const domains = ['example.test'];
    const item = { address: 'x@gmail.test', count: 3, status: 'foreign_domain' as const };
    it('crear exige dominio de la instancia; mapear exige buzon existente', () => {
        expect(validateDecision(item, { action: 'create', target: 'x@gmail.test' }, { domains, existing: () => undefined, createdElsewhere: new Set() })).toMatch(/invalidDomain/);
        expect(validateDecision(item, { action: 'create', target: 'x@example.test' }, { domains, existing: () => undefined, createdElsewhere: new Set() })).toBeNull();
        expect(validateDecision(item, { action: 'map', target: 'nadie@example.test' }, { domains, existing: () => false, createdElsewhere: new Set() })).toMatch(/notFound/);
        expect(validateDecision(item, { action: 'map', target: 'ok@example.test' }, { domains, existing: () => true, createdElsewhere: new Set() })).toBeNull();
        expect(validateDecision(item, { action: 'create', target: 'no es correo' }, { domains, existing: () => undefined, createdElsewhere: new Set() })).toMatch(/invalidAddress/);
        expect(validateDecision(item, { action: 'discard', target: '' }, { domains, existing: () => undefined, createdElsewhere: new Set() })).toBeNull();
        expect(defaultDecision({ address: 'a@example.test', count: 1, status: 'missing' }, domains)).toEqual({ action: 'create', target: 'a@example.test' });
        expect(defaultDecision(item, domains).action).toBe('map');
    });
});

describe('dialogo "¿Desea crear los correos faltantes?"', () => {
    const items = [
        { address: 'nuevo@example.test', count: 5, status: 'missing' as const },
        { address: 'viejo@gmail.test', count: 2, status: 'foreign_domain' as const },
    ];
    const mount = async (onSave = vi.fn(), onClose = vi.fn()) => {
        await act(async () => {
            root.render(wrap(React.createElement(MissingMailboxesDialog, {
                open: true, items, domains: ['example.test'], initial: {}, initialPassword: { mode: 'random', generic: '', mustChange: true },
                checkExists: async (a: string) => a === 'existe@example.test', onSave, onClose,
            })));
        });
        await flush();
        return { onSave, onClose };
    };

    it('es un dialogo accesible con titulo, lista editable y opciones de contrasena; bloquea hasta resolver el dominio ajeno', async () => {
        const { onSave } = await mount();
        const dlg = document.querySelector('[role="dialog"]')!;
        expect(dlg.getAttribute('aria-modal')).toBe('true');
        expect(document.querySelector('h2')!.textContent).toBe('¿Desea crear los correos faltantes?');
        // el dominio ajeno arranca en "mapear" con destino vacio -> invalido
        expect(submitBtn().disabled).toBe(true);
        expect(document.querySelector('[role="alert"]')).not.toBeNull();
        // mapear a un buzon existente
        await setValue(byLabel('viejo@gmail.test: Buzón existente') as HTMLInputElement, 'existe@example.test');
        await flush();
        expect(submitBtn().disabled).toBe(false);
        // por defecto: contrasena aleatoria unica (recomendado) y cambio obligatorio activado
        const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type=radio]'));
        expect(radios[0].checked).toBe(true);
        const must = Array.from(document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')).find((c) => c.parentElement?.textContent?.includes('Obligar'))!;
        expect(must.checked).toBe(true);
        await act(async () => { submitBtn().click(); });
        expect(onSave).toHaveBeenCalledTimes(1);
        const res = onSave.mock.calls[0][0];
        expect(res.decisions['nuevo@example.test']).toEqual({ action: 'create', target: 'nuevo@example.test' });
        expect(res.decisions['viejo@gmail.test']).toEqual({ action: 'map', target: 'existe@example.test' });
        expect(res.password).toEqual({ mode: 'random', generic: '', mustChange: true });
    });

    it('contrasena generica: valida la politica, muestra medidor y no deja guardar una debil', async () => {
        await mount();
        await setValue(byLabel('viejo@gmail.test: Acción') as HTMLSelectElement, 'discard');
        const generic = Array.from(document.querySelectorAll<HTMLInputElement>('input[type=radio]'))[1];
        await act(async () => { generic.click(); });
        const pw = document.querySelector<HTMLInputElement>('input[autocomplete="new-password"]')!;
        expect(pw.type).toBe('password');
        await setValue(pw, 'corta');
        expect(submitBtn().disabled).toBe(true);
        expect(document.querySelector('[role=meter]')!.getAttribute('aria-valuetext')).toBe('Débil');
        await setValue(pw, 'Cielo-Azul-Luna-77');
        expect(submitBtn().disabled).toBe(false);
        expect(document.querySelector('[role=meter]')!.getAttribute('aria-valuetext')).toBe('Fuerte');
        // mostrar / ocultar accesible
        const toggle = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Mostrar')!;
        await act(async () => { toggle.click(); });
        expect(toggle.getAttribute('aria-pressed')).toBe('true');
        expect(pw.type).toBe('text');
    });

    it('cerrar con Escape no guarda nada', async () => {
        const { onSave, onClose } = await mount();
        await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        expect(onSave).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });
});

describe('re-autenticacion y medidor', () => {
    it('el dialogo pide contrasena, envia a /reauth y avisa al verificar; error accesible si es incorrecta', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ code: 'invalid_credentials' }) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
        vi.stubGlobal('fetch', fetchMock);
        const onVerified = vi.fn();
        await act(async () => { root.render(wrap(React.createElement(ReauthDialog, { open: true, base: '/api/admin/mail-transfer', mfaEnrolled: true, onVerified, onClose: () => undefined }))); });
        const input = document.querySelector<HTMLInputElement>('input[type=password]')!;
        await setValue(input, 'mala');
        await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
        await flush();
        expect(document.querySelector('[role=alert]')!.textContent).toContain('incorrectos');
        expect(onVerified).not.toHaveBeenCalled();
        await setValue(document.querySelector<HTMLInputElement>('input[type=password]')!, 'buena-contrasena-1');
        await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
        await flush();
        expect(onVerified).toHaveBeenCalled();
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ password: 'buena-contrasena-1' });
        expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/mail-transfer/reauth');
        vi.unstubAllGlobals();
    });
    it('PasswordMeter vacio no muestra fortaleza', async () => {
        await act(async () => { root.render(wrap(React.createElement(PasswordMeter, { id: 'm', password: '' }))); });
        expect(document.querySelector('[role=meter]')!.getAttribute('aria-valuenow')).toBe('0');
    });
});
