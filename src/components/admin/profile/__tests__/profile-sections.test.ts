// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const theme = vi.hoisted(() => ({
    setPreference: vi.fn(),
    value: {
        themes: [
            { id: 'light', label: 'Claro', scheme: 'light' },
            { id: 'dark', label: 'Oscuro', scheme: 'dark' },
        ],
        preference: 'system',
    },
}));
vi.mock('@/components/ThemeProvider', () => ({
    useTheme: () => ({ ...theme.value, setPreference: theme.setPreference }),
}));
// MfaEnrollForm real hace peticiones y genera un QR: aqui basta saber que se monta y avisa al terminar.
vi.mock('@/components/MfaPanels', () => ({
    MfaEnrollForm: ({ onDone }: { onDone: (r: object) => void }) =>
        React.createElement('button', { type: 'button', onClick: () => onDone({}) }, 'enroll-stub-done'),
}));

import { PasswordSection } from '../PasswordSection';
import { MfaSection } from '../MfaSection';
import { SessionsSection } from '../SessionsSection';
import { SigningKeySection } from '../SigningKeySection';
import { PreferencesSection } from '../PreferencesSection';
import { DENSITY_KEY } from '@/components/admin/console';
import {
    button, byLabelText, calls, click, dialog, flush, mountRoot, radio, render, routeFetch, setValue, submit, textOf, unmountRoot,
} from './test-utils';

beforeEach(() => { mountRoot(); window.localStorage.clear(); theme.setPreference.mockReset(); });
afterEach(async () => { await unmountRoot(); vi.unstubAllGlobals(); });

const h = React.createElement;

describe('PasswordSection', () => {
    const form = () => document.querySelector('form')!;
    const fill = async (cur: string, next: string, conf: string) => {
        await setValue(byLabelText('Contraseña actual'), cur);
        await setValue(byLabelText('Nueva contraseña'), next);
        await setValue(byLabelText('Repite la nueva contraseña'), conf);
    };

    it('valida en el cliente (vacia, corta, no coincide, igual) sin llamar a la API', async () => {
        routeFetch({});
        await render(h(PasswordSection, {}));
        await submit(form());
        expect(textOf()).toContain('Escribe tu contraseña actual.');
        expect(textOf()).toContain('al menos 12 caracteres');

        await fill('Actual-123456789', 'corta', 'corta');
        await submit(form());
        expect(textOf()).toContain('al menos 12 caracteres');

        await fill('Actual-123456789', 'Nueva-Larga-123456', 'Otra-Larga-1234567');
        await submit(form());
        expect(textOf()).toContain('no coinciden');

        await fill('Actual-123456789', 'Actual-123456789', 'Actual-123456789');
        await submit(form());
        expect(textOf()).toContain('distinta de la actual');
        expect(calls).toHaveLength(0);
        expect(byLabelText('Nueva contraseña')!.getAttribute('aria-invalid')).toBe('true');
    });

    it('exito: PUT con ambas contrasenas, mensaje en role=status y campos vaciados', async () => {
        routeFetch({ 'PUT /api/admin/profile/password': () => ({ body: { success: true } }) });
        await render(h(PasswordSection, {}));
        await fill('Actual-123456789', 'Nueva-Larga-123456', 'Nueva-Larga-123456');
        await submit(form());
        expect(calls[0]).toMatchObject({ method: 'PUT', path: '/api/admin/profile/password', body: { currentPassword: 'Actual-123456789', newPassword: 'Nueva-Larga-123456' } });
        expect(document.querySelector('[role="status"]')?.textContent).toContain('Contraseña actualizada');
        expect(byLabelText('Contraseña actual')!.value).toBe('');
        expect(byLabelText('Nueva contraseña')!.value).toBe('');
    });

    it('errores del servidor traducidos (actual incorrecta, politica, limite)', async () => {
        let code = 'incorrect_current_password';
        let status = 400;
        routeFetch({ 'PUT /api/admin/profile/password': () => ({ status, body: { error: 'x', code } }) });
        await render(h(PasswordSection, {}));
        await fill('Actual-123456789', 'Nueva-Larga-123456', 'Nueva-Larga-123456');
        await submit(form());
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('La contraseña actual no es correcta.');

        code = 'password_common'; await submit(form());
        expect(textOf()).toContain('demasiado común');
        status = 429; code = 'rate_limited'; await submit(form());
        expect(textOf()).toContain('Demasiados intentos');
        expect(document.querySelector('[role="status"]')).toBeNull();
    });

    it('muestra el aviso de cambio pedido por un administrador', async () => {
        routeFetch({});
        await render(h(PasswordSection, { mustChange: true }));
        expect(textOf()).toContain('Un administrador pidió que cambies tu contraseña.');
    });
});

describe('MfaSection', () => {
    const enabledRequired = { available: true, enabled: true, pendingEnrollment: false, recoveryCodesLeft: 7, required: true };

    it('estado activo y obligatorio: muestra restantes y deshabilita desactivar con explicacion', async () => {
        routeFetch({});
        await render(h(MfaSection, { mfa: enabledRequired, onChanged: vi.fn() }));
        expect(textOf()).toContain('Activada');
        expect(textOf()).toContain('Obligatoria por política');
        expect(textOf()).toContain('Códigos de recuperación restantes');
        expect(document.querySelector('strong')?.textContent).toBe('7');
        const disable = button('Desactivar')!;
        expect(disable.disabled).toBe(true);
        expect(disable.getAttribute('aria-describedby')).toBeTruthy();
        expect(textOf()).toContain('no se puede desactivar');
    });

    it('regenerar: pide codigo, confirma, muestra los codigos UNA vez y se pueden descartar', async () => {
        routeFetch({ 'POST /api/auth/mfa/recovery-codes': () => ({ body: { recoveryCodes: ['AAAAA-11111', 'BBBBB-22222'] } }) });
        const onChanged = vi.fn();
        const writeText = vi.fn(async () => undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        await render(h(MfaSection, { mfa: enabledRequired, onChanged }));

        const regen = button('Regenerar códigos')!;
        expect(regen.disabled).toBe(true);
        await setValue(byLabelText('Código actual de la aplicación'), '123456');
        expect(regen.disabled).toBe(false);
        await click(regen);
        expect(dialog()).not.toBeNull();
        expect(calls).toHaveLength(0); // nada hasta confirmar
        await click(button('Regenerar', dialog()!));

        expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/auth/mfa/recovery-codes', body: { code: '123456' } });
        expect(onChanged).toHaveBeenCalled();
        const list = document.querySelector('[data-testid="recovery-codes"]')!;
        expect(list.textContent).toContain('AAAAA-11111');
        expect(textOf()).toContain('Se muestran solo ahora');
        expect((byLabelText('Código actual de la aplicación') as HTMLInputElement).value).toBe('');

        await click(button('Copiar códigos'));
        expect(writeText).toHaveBeenCalledWith('AAAAA-11111\nBBBBB-22222');
        expect(button('Descargar .txt')).toBeDefined();

        await click(button('Ya los guardé'));
        expect(document.querySelector('[data-testid="recovery-codes"]')).toBeNull();
        expect(textOf()).not.toContain('AAAAA-11111');
    });

    it('codigo invalido: mensaje y no muestra codigos', async () => {
        routeFetch({ 'POST /api/auth/mfa/recovery-codes': () => ({ status: 400, body: { error: 'Invalid code' } }) });
        await render(h(MfaSection, { mfa: enabledRequired, onChanged: vi.fn() }));
        await setValue(byLabelText('Código actual de la aplicación'), '000000');
        await click(button('Regenerar códigos'));
        await click(button('Regenerar', dialog()!));
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('Código no válido.');
        expect(document.querySelector('[data-testid="recovery-codes"]')).toBeNull();
        expect(dialog()).toBeNull();
    });

    it('sin MFA: boton de activar monta el enrolamiento y refresca al terminar', async () => {
        routeFetch({});
        const onChanged = vi.fn();
        await render(h(MfaSection, { mfa: { available: true, enabled: false, pendingEnrollment: false, recoveryCodesLeft: 0, required: false }, onChanged }));
        expect(textOf()).toContain('Desactivada');
        await click(button('Activar verificación en dos pasos'));
        await click(button('enroll-stub-done'));
        expect(onChanged).toHaveBeenCalled();
        expect(textOf()).toContain('Verificación en dos pasos activada.');
    });

    it('opcional: desactivar pide contrasena + codigo y confirmacion', async () => {
        routeFetch({ 'POST /api/auth/mfa/disable': () => ({ body: { success: true } }) });
        const onChanged = vi.fn();
        await render(h(MfaSection, { mfa: { ...enabledRequired, required: false }, onChanged }));
        const disable = button('Desactivar')!;
        expect(disable.disabled).toBe(true);
        await setValue(byLabelText('Código actual de la aplicación'), '123456');
        await setValue(byLabelText('Contraseña'), 'Mi-Contrasena-123');
        await click(button('Desactivar')!);
        await click(button('Desactivar', dialog()!));
        expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/auth/mfa/disable', body: { password: 'Mi-Contrasena-123', code: '123456' } });
        expect(onChanged).toHaveBeenCalled();
        expect(textOf()).toContain('Verificación en dos pasos desactivada.');
    });

    it('sin tabla de MFA: aviso', async () => {
        routeFetch({});
        await render(h(MfaSection, { mfa: { available: false, enabled: false, pendingEnrollment: false, recoveryCodesLeft: 0, required: true }, onChanged: vi.fn() }));
        expect(textOf()).toContain('falta migrar la base de datos');
    });
});

describe('SessionsSection', () => {
    const session = (jti: string, current = false) => ({
        jti, ip: '10.0.0.1', userAgent: current ? 'Firefox en Windows' : 'Safari en iPhone', createdAt: '2026-09-01T10:00:00.000Z', expiresAt: '2026-10-01T10:00:00.000Z', mfa: true, current,
    });

    it('lista, marca esta sesion y no ofrece cerrarla', async () => {
        routeFetch({ 'GET /api/admin/profile/sessions': () => ({ body: { sessions: [session('a', true), session('b')] } }) });
        await render(h(SessionsSection, {}));
        expect(textOf()).toContain('Esta sesión');
        expect(textOf()).toContain('Firefox en Windows');
        expect(button('Cerrar la sesión de Firefox en Windows')).toBeUndefined();
        expect(button('Cerrar la sesión de Safari en iPhone')).toBeDefined();
    });

    it('cerrar una sesion pide confirmacion, llama a DELETE [jti] y recarga', async () => {
        let sessions = [session('a', true), session('b/raro')];
        routeFetch({
            'GET /api/admin/profile/sessions': () => ({ body: { sessions } }),
            'DELETE /api/admin/profile/sessions/b%2Fraro': () => { sessions = [session('a', true)]; return { body: { success: true } }; },
        });
        await render(h(SessionsSection, {}));
        await click(button('Cerrar la sesión de Safari en iPhone'));
        expect(dialog()?.textContent).toContain('¿Cerrar esta sesión?');
        expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
        await click(button('Cerrar sesión', dialog()!));
        expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/admin/profile/sessions/b%2Fraro')).toBe(true);
        expect(document.querySelector('[role="status"]')?.textContent).toContain('Sesión cerrada.');
        expect(textOf()).not.toContain('Safari en iPhone');
    });

    it('cancelar la confirmacion no cierra nada', async () => {
        routeFetch({ 'GET /api/admin/profile/sessions': () => ({ body: { sessions: [session('a', true), session('b')] } }) });
        await render(h(SessionsSection, {}));
        await click(button('Cerrar todas las demás'));
        await click(button('Cancelar', dialog()!));
        expect(dialog()).toBeNull();
        expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    });

    it('Escape cierra el dialogo de confirmacion', async () => {
        routeFetch({ 'GET /api/admin/profile/sessions': () => ({ body: { sessions: [session('a', true), session('b')] } }) });
        await render(h(SessionsSection, {}));
        await click(button('Cerrar todas las demás'));
        expect(dialog()).not.toBeNull();
        await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        await flush();
        expect(dialog()).toBeNull();
    });

    it('cerrar todas las demas: DELETE /sessions y aviso', async () => {
        const onChanged = vi.fn();
        routeFetch({
            'GET /api/admin/profile/sessions': () => ({ body: { sessions: [session('a', true), session('b')] } }),
            'DELETE /api/admin/profile/sessions': () => ({ body: { success: true, revoked: 1 } }),
        });
        await render(h(SessionsSection, { onChanged }));
        await click(button('Cerrar todas las demás'));
        await click(button('Cerrar sesión', dialog()!));
        expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/admin/profile/sessions')).toBe(true);
        expect(textOf()).toContain('Se cerraron las demás sesiones.');
        expect(onChanged).toHaveBeenCalled();
    });

    it('error al cerrar: role=alert', async () => {
        routeFetch({
            'GET /api/admin/profile/sessions': () => ({ body: { sessions: [session('a', true), session('b')] } }),
            'DELETE /api/admin/profile/sessions/b': () => ({ status: 500, body: { error: 'x' } }),
        });
        await render(h(SessionsSection, {}));
        await click(button('Cerrar la sesión de Safari en iPhone'));
        await click(button('Cerrar sesión', dialog()!));
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('No se pudo cerrar la sesión.');
    });
});

describe('SigningKeySection', () => {
    const PUB = 'Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyMTI';
    const status = (over: object = {}) => ({ registered: true, fingerprint: 'abcd1234abcd1234', requireSignature: false, legacyMode: false, ...over });
    const props = { kind: 'manager' as const, domainId: 'dom-1', instanceSigning: true };
    const keyField = () => byLabelText('Clave pública (Ed25519)') as HTMLTextAreaElement;

    it('muestra estado derivado: clave registrada, huella, exigir firma activo, instancia firma y guia', async () => {
        routeFetch({ 'GET /api/admin/domain-key': () => ({ body: status() }) });
        await render(h(SigningKeySection, props));
        expect(calls[0].search).toBe('?domainId=dom-1');
        const t = textOf();
        expect(t).toContain('Clave registrada');
        expect(t).toContain('abcd1234abcd1234');
        expect(t).toContain('Activo');
        expect(t).toContain('Sí: hay una clave privada válida desplegada');
        expect(t).toContain('node scripts/gen-domain-keypair.mjs');
        expect(t).toContain('BLOOMX_DOMAIN_PRIVATE_KEY');
        expect(document.querySelector('[role="alert"]')).toBeNull();
        expect(button('Rotar clave')).toBeDefined();
    });

    it('avisa del riesgo si hay clave registrada y la instancia no firma', async () => {
        routeFetch({ 'GET /api/admin/domain-key': () => ({ body: status() }) });
        await render(h(SigningKeySection, { ...props, instanceSigning: false }));
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('Riesgo de interrupción');
        expect(textOf()).toContain('No: no hay clave privada válida en el servidor');
    });

    it('sin clave: boton Registrar; y exigir firma inactivo (modo heredado)', async () => {
        routeFetch({ 'GET /api/admin/domain-key': () => ({ body: status({ registered: false, fingerprint: null, legacyMode: true }) }) });
        await render(h(SigningKeySection, props));
        expect(textOf()).toContain('Sin clave registrada');
        expect(textOf()).toContain('Inactivo (modo heredado)');
        expect(button('Registrar clave')).toBeDefined();
    });

    it('rotar exige ConfirmDialog con aviso de actualizar la privada; solo entonces envia la publica', async () => {
        let s = status();
        routeFetch({
            'GET /api/admin/domain-key': () => ({ body: s }),
            'POST /api/admin/domain-key': () => { s = status({ fingerprint: 'ffff0000ffff0000' }); return { body: { success: true, registered: true, fingerprint: 'ffff0000ffff0000' } }; },
        });
        await render(h(SigningKeySection, props));
        await setValue(keyField(), `  ${PUB}  `);
        await submit(document.querySelector('form'));
        expect(dialog()?.textContent).toContain('¿Rotar la clave de firma?');
        expect(dialog()?.textContent).toContain('actualizar la clave privada de esta instancia');
        expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);

        await click(button('Rotar clave', dialog()!));
        const posted = calls.find((c) => c.method === 'POST')!;
        expect(posted.body).toEqual({ domainId: 'dom-1', signingPublicKey: PUB });
        expect(document.querySelector('[role="status"]')?.textContent).toContain('ffff0000ffff0000');
        expect(keyField().value).toBe('');
        expect(textOf()).toContain('ffff0000ffff0000'); // huella actualizada por la recarga
    });

    it('cancelar la confirmacion no envia nada', async () => {
        routeFetch({ 'GET /api/admin/domain-key': () => ({ body: status() }) });
        await render(h(SigningKeySection, props));
        await setValue(keyField(), PUB);
        await submit(document.querySelector('form'));
        await click(button('Cancelar', dialog()!));
        expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
        expect(keyField().value).toBe(PUB);
    });

    it('rechaza una clave privada en el cliente: no abre dialogo, no envia y vacia el campo', async () => {
        routeFetch({ 'GET /api/admin/domain-key': () => ({ body: status() }) });
        await render(h(SigningKeySection, props));
        await setValue(keyField(), '-----BEGIN PRIVATE KEY-----\nMC4CAQAw...\n-----END PRIVATE KEY-----');
        await submit(document.querySelector('form'));
        expect(dialog()).toBeNull();
        expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('parece una clave privada');
        expect(keyField().value).toBe('');
        expect(keyField().getAttribute('aria-invalid')).toBe('true');
    });

    it('error del servidor (clave invalida) traducido', async () => {
        routeFetch({
            'GET /api/admin/domain-key': () => ({ body: status({ registered: false, fingerprint: null }) }),
            'POST /api/admin/domain-key': () => ({ status: 400, body: { error: 'x', code: 'invalid_signing_key' } }),
        });
        await render(h(SigningKeySection, props));
        await setValue(keyField(), 'basura');
        await submit(document.querySelector('form'));
        await click(button('Registrar', dialog()!));
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('No es una clave pública Ed25519 válida.');
        expect(dialog()).toBeNull();
    });

    it('usuario de la app: explica que hace falta sesion de gestor, sin formulario ni llamadas', async () => {
        routeFetch({});
        await render(h(SigningKeySection, { kind: 'user', domainId: 'dom-1', instanceSigning: false }));
        expect(textOf()).toContain('sesión de gestor');
        expect(document.querySelector('form')).toBeNull();
        expect(textOf()).toContain('node scripts/gen-domain-keypair.mjs');
        expect(calls).toHaveLength(0);
    });
});

describe('PreferencesSection', () => {
    it('cambia el idioma (la pantalla se traduce al instante)', async () => {
        routeFetch({});
        await render(h(PreferencesSection));
        expect(document.querySelector('h2')?.textContent).toBe('Preferencias');
        expect(radio('Español')!.checked).toBe(true);
        await click(radio('English'));
        expect(document.querySelector('h2')?.textContent).toBe('Preferences');
        expect(radio('English')!.checked).toBe(true);
        expect(document.documentElement.lang).toBe('en');
    });

    it('lista los temas disponibles con nombre y cambia la preferencia', async () => {
        routeFetch({});
        await render(h(PreferencesSection));
        expect(radio('Sistema')!.checked).toBe(true);
        expect(radio('Claro')).not.toBeNull();
        await click(radio('Oscuro'));
        expect(theme.setPreference).toHaveBeenCalledWith('dark');
    });

    it('cambia la densidad y la guarda en este navegador', async () => {
        routeFetch({});
        await render(h(PreferencesSection));
        expect(radio('Cómoda')!.checked).toBe(true);
        await click(radio('Compacta'));
        expect(window.localStorage.getItem(DENSITY_KEY)).toBe('compact');
        expect(radio('Compacta')!.checked).toBe(true);
    });

    it('a11y: cada grupo es un fieldset con legend y los radios comparten nombre', async () => {
        routeFetch({});
        await render(h(PreferencesSection));
        const sets = Array.from(document.querySelectorAll('fieldset'));
        expect(sets.map((f) => f.querySelector('legend')?.textContent)).toEqual(['Idioma', 'Tema', 'Densidad de la consola']);
        for (const f of sets) {
            const names = new Set(Array.from(f.querySelectorAll('input[type=radio]')).map((i) => (i as HTMLInputElement).name));
            expect(names.size).toBe(1);
        }
    });
});
