// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ThemeProvider', () => ({
    useTheme: () => ({ themes: [{ id: 'light', label: 'Claro', scheme: 'light' }], preference: 'system', setPreference: vi.fn() }),
}));
vi.mock('@/components/MfaPanels', () => ({ MfaEnrollForm: () => React.createElement('div') }));

import { ProfileView } from '../ProfileView';
import { ConsoleContext } from '@/components/admin/console';
import { button, calls, click, mountRoot, render, routeFetch, textOf, unmountRoot } from './test-utils';

const h = React.createElement;

const userProfile = {
    me: { kind: 'user', id: 'u1', name: 'Ada Lovelace', email: 'ada@empresa.com', avatar: null, lastLoginAt: '2026-09-01T10:00:00.000Z', mustChangePassword: false },
    mfa: { available: true, enabled: true, pendingEnrollment: false, recoveryCodesLeft: 5, required: true },
    sessions: { active: 2 },
    instanceSigning: true,
};
const managerProfile = {
    me: { kind: 'manager', id: 'm1', name: null, email: 'gestor@empresa.com', avatar: null, lastLoginAt: null, mustChangePassword: false },
    mfa: null,
    sessions: null,
    instanceSigning: false,
};

const withConsole = (kind: 'user' | 'manager') => (el: React.ReactElement) =>
    h(ConsoleContext.Provider, {
        value: {
            me: { kind, id: 'x', email: 'x@y.z', userId: kind === 'user' ? 'u1' : null, instanceDomain: 'mail.empresa.com' },
            domain: { id: 'dom-1', name: 'mail.empresa.com', displayName: 'Empresa', logo: null },
            setDirty: () => undefined,
            setCrumbTail: () => undefined,
        },
        children: el,
    });

const userHandlers = () => ({
    'GET /api/admin/profile': () => ({ body: userProfile }),
    'GET /api/admin/profile/sessions': () => ({ body: { sessions: [] } }),
    'GET /api/admin/domain-key': () => ({ status: 409, body: { code: 'manager_session_required' } }),
});

beforeEach(() => { mountRoot(); window.history.replaceState(null, '', '/admin/profile'); });
afterEach(async () => { await unmountRoot(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

describe('ProfileView', () => {
    it('usuario: cabecera con datos propios, rol de solo lectura e indice con las 5 secciones y sus anclas', async () => {
        routeFetch(userHandlers());
        await render(h(ProfileView), 'es', withConsole('user'));
        expect(document.querySelector('h1')?.textContent).toBe('Mi perfil');
        expect(textOf()).toContain('Ada Lovelace');
        expect(textOf()).toContain('ada@empresa.com');
        expect(textOf()).toContain('Usuario de la aplicación');
        expect(textOf()).toContain('ADMIN_EMAILS');
        const links = Array.from(document.querySelectorAll('nav a')).map((a) => [a.textContent, a.getAttribute('href')]);
        expect(links).toEqual([
            ['Contraseña', '#password'], ['Verificación en dos pasos', '#mfa'], ['Sesiones', '#sessions'], ['Clave de firma', '#signing-key'], ['Preferencias', '#preferences'],
        ]);
        for (const id of ['password', 'mfa', 'sessions', 'signing-key', 'preferences']) expect(document.getElementById(id)).not.toBeNull();
        expect(textOf()).toContain('Cambiar contraseña');
        expect(textOf()).toContain('Verificación en dos pasos (TOTP)');
    });

    it('respeta window.location.hash: hace foco en la seccion al abrir', async () => {
        window.history.replaceState(null, '', '/admin/profile#signing-key');
        routeFetch(userHandlers());
        await render(h(ProfileView), 'es', withConsole('user'));
        expect(document.activeElement?.id).toBe('signing-key');
        expect(document.querySelector('nav a[aria-current="location"]')?.textContent).toBe('Clave de firma');
    });

    it('el indice mueve el foco a la seccion y actualiza la URL', async () => {
        routeFetch(userHandlers());
        await render(h(ProfileView), 'es', withConsole('user'));
        await click(document.querySelector('nav a[href="#preferences"]'));
        expect(document.activeElement?.id).toBe('preferences');
        expect(window.location.hash).toBe('#preferences');
    });

    it('manager: sin contrasena/MFA/sesiones de la app, con explicacion; clave de firma y preferencias si', async () => {
        routeFetch({
            'GET /api/admin/profile': () => ({ body: managerProfile }),
            'GET /api/admin/domain-key': () => ({ body: { registered: false, fingerprint: null, requireSignature: false, legacyMode: true } }),
        });
        await render(h(ProfileView), 'es', withConsole('manager'));
        expect(textOf()).toContain('Gestor del backend');
        expect(textOf()).toContain('Credenciales gestionadas en el backend');
        expect(textOf()).not.toContain('Cambiar contraseña');
        expect(button('Regenerar códigos')).toBeUndefined();
        expect(calls.some((c) => c.path === '/api/admin/profile/sessions')).toBe(false);
        // anclas de compatibilidad para la busqueda global
        for (const id of ['password', 'mfa', 'sessions', 'signing-key', 'preferences']) expect(document.getElementById(id)).not.toBeNull();
        expect(Array.from(document.querySelectorAll('nav a')).map((a) => a.textContent)).toEqual(['Credenciales', 'Clave de firma', 'Preferencias']);
        // la clave de firma consulta el dominio de la consola
        expect(calls.find((c) => c.path === '/api/admin/domain-key')?.search).toBe('?domainId=dom-1');
        expect(textOf()).toContain('Sin clave registrada');
        expect(button('Registrar clave')).toBeDefined();
    });

    it('usuario: nunca consulta la clave de firma (sin cookie de manager) y lo explica', async () => {
        routeFetch(userHandlers());
        await render(h(ProfileView), 'es', withConsole('user'));
        expect(calls.some((c) => c.path === '/api/admin/domain-key')).toBe(false);
        expect(textOf()).toContain('sesión de gestor');
    });

    it('error de carga: alerta con Reintentar que vuelve a pedir', async () => {
        let fail = true;
        routeFetch({ 'GET /api/admin/profile': () => (fail ? { status: 500, body: {} } : { body: managerProfile }), 'GET /api/admin/domain-key': () => ({ body: {} }) });
        await render(h(ProfileView), 'es', withConsole('manager'));
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('No se pudo cargar tu perfil.');
        fail = false;
        await click(button('Reintentar'));
        expect(textOf()).toContain('Gestor del backend');
    });

    it('en ingles todo el texto sale traducido', async () => {
        routeFetch(userHandlers());
        await render(h(ProfileView), 'en', withConsole('user'));
        expect(document.querySelector('h1')?.textContent).toBe('My profile');
        expect(textOf()).toContain('Change password');
        expect(textOf()).not.toContain('admin.console.');
    });
});
