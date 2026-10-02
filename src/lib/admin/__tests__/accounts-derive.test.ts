import { describe, expect, it } from 'vitest';
import { deriveIntegrations } from '../accounts-store';

// Vista "Cuentas vinculadas" (consola): integraciones que permiten los scopes concedidos de cada proveedor OAuth de extension.
describe('deriveIntegrations: Microsoft, Zoom y Slack', () => {
    it('microsoft: calendario, reuniones de Teams, contactos, correo, archivos y directorio segun los scopes (nombres cortos de Graph)', () => {
        expect(deriveIntegrations('microsoft', ['openid', 'offline_access', 'User.Read', 'Calendars.ReadWrite', 'OnlineMeetings.ReadWrite'])).toEqual(['calendar', 'meetings']);
        expect(deriveIntegrations('microsoft', ['Contacts.Read', 'Mail.Send', 'Files.Read', 'User.ReadBasic.All'])).toEqual(['contacts', 'mail', 'files', 'directory']);
        expect(deriveIntegrations('microsoft', ['openid', 'User.Read'])).toEqual([]);
    });
    it('zoom: reuniones con scopes granulares o con la cuenta heredada sin scopes', () => {
        expect(deriveIntegrations('zoom', ['meeting:write:meeting', 'user:read:user'])).toEqual(['meetings']);
        expect(deriveIntegrations('zoom', [])).toEqual(['meetings']);
        expect(deriveIntegrations('zoom', ['user:read:user'])).toEqual([]);
    });
    it('slack: separa chat, canales y usuarios, tanto del bot como del usuario (prefijo user:)', () => {
        expect(deriveIntegrations('slack', ['chat:write', 'channels:read', 'users:read'])).toEqual(['chat', 'channels', 'users']);
        expect(deriveIntegrations('slack', ['user:chat:write'])).toEqual(['chat']);
        expect(deriveIntegrations('slack', ['groups:read'])).toEqual(['channels']);
    });
    it('google no cambia', () => {
        expect(deriveIntegrations('google', ['https://www.googleapis.com/auth/calendar'])).toEqual(['calendar']);
    });
});
