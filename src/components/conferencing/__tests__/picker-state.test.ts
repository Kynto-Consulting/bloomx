import { describe, expect, it } from 'vitest';
import { ConferencingError, type ConferencingProviderStatus } from '@/lib/conferencing/types';
import {
    buildCreateInput,
    canDeleteRemote,
    checkCustomLink,
    clampWait,
    contextSignature,
    createIdempotencyKeeper,
    defaultProviderId,
    errorPlan,
    isInternalPath,
    locationWithoutLink,
    meetingFromCustomLink,
    meetingFromLink,
    orderProviders,
    providerReasonKey,
    providerState,
    remainingSeconds,
    resolveConnectHref,
    safeConnectHref,
} from '../picker-state';

const base = { icon: 'zoom', connected: false, mode: null, source: 'none', origin: 'extension' } as const;
const status = (over: Partial<ConferencingProviderStatus>): ConferencingProviderStatus =>
    ({ id: 'zoom', name: 'Zoom', configured: false, ...base, ...over }) as ConferencingProviderStatus;

describe('providerState / providerReasonKey', () => {
    it('configurado => ready, sin motivo', () => {
        const s = status({ configured: true, connected: true });
        expect(providerState(s)).toBe('ready');
        expect(providerReasonKey(s)).toBeNull();
    });
    it('no configurado con OAuth => connect', () => {
        const s = status({ reason: 'not_connected', connect: { type: 'oauth', url: '/api/auth/zoom' } });
        expect(providerState(s)).toBe('connect');
        expect(providerReasonKey(s)).toBe('conferencing.reason.not_connected');
    });
    it('token revocado => reconnect (con conexion) o unavailable (sin ella)', () => {
        expect(providerState(status({ reason: 'token_revoked', configured: true, connect: { type: 'oauth', url: '/x' } }))).toBe('reconnect');
        expect(providerState(status({ reason: 'token_revoked' }))).toBe('unavailable');
    });
    it('credenciales invalidas => admin; extension ausente o dominio legado => unavailable', () => {
        expect(providerState(status({ reason: 'invalid_credentials' }))).toBe('admin');
        expect(providerState(status({ reason: 'extension_not_installed' }))).toBe('unavailable');
        expect(providerState(status({ reason: 'legacy_domain', configured: true }))).toBe('unavailable');
        expect(providerReasonKey(status({ reason: 'legacy_domain' }))).toBe('conferencing.reason.legacy_domain');
    });
    it('custom siempre esta listo', () => {
        expect(providerState(status({ id: 'custom', configured: false }))).toBe('ready');
    });
});

describe('orderProviders / defaultProviderId', () => {
    const list = [status({ id: 'zoom', configured: true }), status({ id: 'google-meet', name: 'Google Meet' })];
    it('orden fijo, filtro allowed y custom sintetico solo si allowCustom', () => {
        expect(orderProviders(list).map((p) => p.id)).toEqual(['google-meet', 'zoom']);
        expect(orderProviders(list, { allowed: ['zoom'] }).map((p) => p.id)).toEqual(['zoom']);
        expect(orderProviders(list, { allowCustom: true }).map((p) => p.id)).toEqual(['google-meet', 'zoom', 'custom']);
        expect(orderProviders(list, { allowed: ['custom'], allowCustom: true }).map((p) => p.id)).toEqual(['custom']);
    });
    it('proveedor inicial: el actual, si no el primero listo', () => {
        const ordered = orderProviders(list);
        expect(defaultProviderId(ordered)).toBe('zoom');
        expect(defaultProviderId(ordered, 'google-meet')).toBe('google-meet');
        expect(defaultProviderId([])).toBeNull();
    });
});

describe('seguridad de las URL de conexion', () => {
    it('solo rutas internas o https del proveedor', () => {
        expect(isInternalPath('/api/auth/google')).toBe(true);
        for (const bad of ['//evil.com', '/\\evil', 'javascript:alert(1)', 'https://evil.com', '', '/a\nb']) expect(isInternalPath(bad)).toBe(false);
        expect(safeConnectHref('/api/auth/google', '/calendar?x=1')).toBe('/api/auth/google?returnTo=%2Fcalendar%3Fx%3D1');
        expect(safeConnectHref('/api/auth/zoom?a=1', '/cal')).toBe('/api/auth/zoom?a=1&returnTo=%2Fcal');
        expect(safeConnectHref('/api/auth/google?returnTo=%2Fx', '/cal')).toBe('/api/auth/google?returnTo=%2Fx');
        expect(safeConnectHref('/api/auth/google', '//evil.com')).toBe('/api/auth/google');
        expect(safeConnectHref('https://accounts.google.com/o/oauth2/v2/auth?x=1')).toBe('https://accounts.google.com/o/oauth2/v2/auth?x=1');
        expect(safeConnectHref('https://zoom.us/oauth/authorize')).toBe('https://zoom.us/oauth/authorize');
        for (const bad of ['https://evil.com/zoom.us', 'https://zoom.us.evil.com/x', 'http://zoom.us/x', 'javascript:alert(1)', '//evil.com', 'https://user:pw@zoom.us/x', null, undefined, 5]) {
            expect(safeConnectHref(bad as any)).toBeNull();
        }
    });
    it('resolveConnectHref: usa la URL del servidor, o la ruta por defecto, y nada para Ajustes', () => {
        expect(resolveConnectHref(status({ connect: { type: 'oauth', url: '/api/auth/zoom' } }), 'zoom', '/c')).toBe('/api/auth/zoom?returnTo=%2Fc');
        expect(resolveConnectHref(null, 'google-meet', '/c')).toBe('/api/auth/google?returnTo=%2Fc');
        expect(resolveConnectHref(status({ connect: { type: 'settings', section: 'integrations' } }), 'zoom', '/c')).toBeNull();
        expect(resolveConnectHref(status({ connect: { type: 'oauth', url: 'https://evil.com' } }), 'zoom', '/c')).toBeNull();
    });
});

describe('errorPlan (codigo tipado -> accion)', () => {
    const plan = (code: any, opts?: any) => errorPlan(new ConferencingError(code, 'x', opts));
    it('mapea cada codigo', () => {
        expect(plan('not_connected').action).toBe('connect');
        expect(plan('token_revoked').action).toBe('reconnect');
        expect(plan('invalid_credentials').action).toBe('admin');
        expect(plan('provider_error').action).toBe('retry');
        expect(plan('unavailable').action).toBe('retry');
        expect(plan('invalid_input').action).toBe('none');
        expect(plan('not_supported').action).toBe('none');
        expect(plan('unauthorized').action).toBe('none');
        expect(plan('token_revoked').messageKey).toBe('conferencing.errors.token_revoked');
    });
    it('rate_limited usa retryAfter acotado (30 s por defecto)', () => {
        expect(plan('rate_limited', { retryAfter: 12 })).toMatchObject({ action: 'wait', waitSeconds: 12 });
        expect(plan('rate_limited').waitSeconds).toBe(30);
        expect(clampWait(99999)).toBe(300);
        expect(clampWait(-3)).toBe(30);
        expect(clampWait(0.2)).toBe(1);
    });
    it('un error ajeno se trata como provider_error', () => {
        expect(errorPlan(new Error('boom'))).toMatchObject({ code: 'provider_error', action: 'retry' });
        expect(errorPlan(null).code).toBe('provider_error');
    });
    it('remainingSeconds nunca es negativo', () => {
        expect(remainingSeconds(10_500, 10_000)).toBe(1);
        expect(remainingSeconds(10_000, 12_000)).toBe(0);
    });
});

describe('idempotencia', () => {
    const ctx = { title: 'Sync', startsAt: '2026-10-01T10:00:00Z', endsAt: '2026-10-01T11:00:00Z', timeZone: 'UTC', attendees: ['B@x.com', 'a@x.com'] };
    it('misma firma => misma clave; cambia proveedor/contexto => clave nueva; renew => nueva', () => {
        let n = 0;
        const keeper = createIdempotencyKeeper(() => `k${++n}`);
        const sig = contextSignature('zoom', ctx);
        expect(keeper.keyFor(sig)).toBe('k1');
        expect(keeper.keyFor(sig)).toBe('k1');
        expect(keeper.keyFor(contextSignature('google-meet', ctx))).toBe('k2');
        expect(keeper.keyFor(contextSignature('google-meet', { ...ctx, title: 'Otro' }))).toBe('k3');
        keeper.renew();
        expect(keeper.keyFor(contextSignature('google-meet', { ...ctx, title: 'Otro' }))).toBe('k4');
    });
    it('la firma ignora el orden y mayusculas de los invitados', () => {
        expect(contextSignature('zoom', ctx)).toBe(contextSignature('zoom', { ...ctx, attendees: ['a@x.com', 'b@x.com'] }));
    });
});

describe('buildCreateInput', () => {
    it('omite vacios, limita y usa el tema por defecto', () => {
        expect(buildCreateInput({}, 'Reunion')).toEqual({ topic: 'Reunion' });
        const input = buildCreateInput(
            { title: ' Plan ', startsAt: '2026-10-01T10:00:00Z', endsAt: null, timeZone: 'UTC', attendees: ['a@x.com', 'a@x.com', 'sin-arroba'], attachToEventId: 'ev1' },
            'Reunion',
        );
        expect(input).toEqual({ topic: 'Plan', startsAt: '2026-10-01T10:00:00Z', timeZone: 'UTC', attendees: ['a@x.com'], attachToEventId: 'ev1' });
        expect(buildCreateInput({ attendees: Array.from({ length: 150 }, (_, i) => `u${i}@x.com`) }, 'R').attendees).toHaveLength(100);
    });
});

describe('enlace propio', () => {
    it('vacio / invalido / reconocido / no reconocido', () => {
        expect(checkCustomLink('  ').status).toBe('empty');
        for (const bad of ['http://zoom.us/j/1', 'javascript:alert(1)', 'https://user:pw@zoom.us/j/1', 'no es url', 'https://exa mple.com']) expect(checkCustomLink(bad).status).toBe('invalid');
        const ok = checkCustomLink('https://zoom.us/j/123456');
        expect(ok.status).toBe('valid');
        const other = checkCustomLink('https://sala.example.com/abc');
        expect(other.status).toBe('unrecognized');
        expect(meetingFromCustomLink((other as any).info)).toMatchObject({ provider: 'custom', joinUrl: 'https://sala.example.com/abc', meetingId: '' });
    });
    it('meetingFromLink solo reconoce Zoom y Meet del registro', () => {
        expect(meetingFromLink('https://meet.google.com/abc-defg-hij')).toMatchObject({ provider: 'google-meet', providerName: 'Google Meet' });
        expect(meetingFromLink('https://us02web.zoom.us/j/123')).toMatchObject({ provider: 'zoom' });
        expect(meetingFromLink('https://teams.microsoft.com/l/meetup-join/x')).toBeNull();
        expect(meetingFromLink('Sala 3')).toBeNull();
    });
    it('canDeleteRemote y locationWithoutLink', () => {
        expect(canDeleteRemote({ provider: 'zoom', meetingId: '99' })).toBe(true);
        expect(canDeleteRemote({ provider: 'zoom', meetingId: '' })).toBe(false);
        expect(canDeleteRemote({ provider: 'custom', meetingId: '99' })).toBe(false);
        expect(canDeleteRemote(null)).toBe(false);
        expect(locationWithoutLink('https://zoom.us/j/1', 'https://zoom.us/j/1')).toBe('');
        expect(locationWithoutLink('Sala 3 - https://zoom.us/j/1', 'https://zoom.us/j/1')).toBe('Sala 3');
    });
});
