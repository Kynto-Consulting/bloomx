import { describe, it, expect } from 'vitest';
import {
    GoogleAuthError,
    buildReconnectUrl,
    classifyGoogleApiError,
    googleAuthErrorToResponse,
    isGoogleAuthError,
} from '../google/errors';
import { pickGoogleAccount } from '../google/pick-account';
import {
    chunk,
    fetchAllPages,
    getGoogleEventDate,
    isEventUnchanged,
    mapGoogleContacts,
    partitionGoogleEvents,
} from '../google/sync-utils';

describe('fetchAllPages (nextPageToken)', () => {
    it('sigue los tokens hasta agotar las paginas', async () => {
        const pages: Record<string, { items: number[]; nextPageToken?: string }> = {
            first: { items: [1, 2], nextPageToken: 'p2' },
            p2: { items: [3], nextPageToken: 'p3' },
            p3: { items: [4, 5] },
        };
        const seen: Array<string | undefined> = [];
        const result = await fetchAllPages<number>(async (token) => {
            seen.push(token);
            return pages[token ?? 'first'];
        });
        expect(result.items).toEqual([1, 2, 3, 4, 5]);
        expect(result.truncated).toBe(false);
        expect(result.pages).toBe(3);
        expect(seen).toEqual([undefined, 'p2', 'p3']);
    });

    it('marca truncado si alcanza maxPages (no se debe borrar por ausencia)', async () => {
        const result = await fetchAllPages<number>(async () => ({ items: [1], nextPageToken: 'more' }), 3);
        expect(result.truncated).toBe(true);
        expect(result.items).toHaveLength(3);
    });
});

describe('partitionGoogleEvents', () => {
    it('separa cancelados (para borrar) de vigentes y descarta eventos sin fechas', () => {
        const { upserts, cancelledIds } = partitionGoogleEvents([
            { id: 'a', summary: 'Reunion', start: { dateTime: '2026-10-01T10:00:00Z' }, end: { dateTime: '2026-10-01T11:00:00Z' }, attendees: [{ email: 'X@Y.com' }, {}] },
            { id: 'b', status: 'cancelled' },
            { id: 'c', start: { date: '2026-10-02' }, end: { date: '2026-10-03' } },
            { id: 'd', summary: 'sin fechas' },
        ]);
        expect(cancelledIds).toEqual(['b']);
        expect(upserts.map((u) => u.externalId)).toEqual(['a', 'c']);
        expect(upserts[0].attendees).toEqual([{ email: 'x@y.com', name: 'X@Y.com', responseStatus: null, isOrganizer: false }]);
        expect(upserts[1].allDay).toBe(true);
    });

    it('un id cancelado y vigente a la vez prevalece como vigente', () => {
        const { upserts, cancelledIds } = partitionGoogleEvents([
            { id: 'a', status: 'cancelled' },
            { id: 'a', start: { dateTime: '2026-10-01T10:00:00Z' }, end: { dateTime: '2026-10-01T11:00:00Z' } },
        ]);
        expect(cancelledIds).toEqual([]);
        expect(upserts).toHaveLength(1);
    });
});

describe('utilidades', () => {
    it('getGoogleEventDate maneja dia completo y fechas invalidas', () => {
        expect(getGoogleEventDate({ date: '2026-10-02' })?.allDay).toBe(true);
        expect(getGoogleEventDate({ dateTime: 'nope' })).toBeNull();
        expect(getGoogleEventDate({})).toBeNull();
    });

    it('isEventUnchanged compara con la marca de Google', () => {
        const older = new Date('2026-01-01T00:00:00Z');
        const newer = new Date('2026-02-01T00:00:00Z');
        expect(isEventUnchanged(newer, older)).toBe(true);
        expect(isEventUnchanged(older, newer)).toBe(false);
        expect(isEventUnchanged(null, newer)).toBe(false);
        expect(isEventUnchanged(older, null)).toBe(false);
    });

    it('chunk parte en lotes', () => {
        expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    });

    it('mapGoogleContacts deduplica por correo y usa el correo si no hay nombre', () => {
        const contacts = mapGoogleContacts([
            { resourceName: 'people/1', emailAddresses: [{ value: ' A@B.com ' }], names: [{ displayName: 'Ana' }] },
            { resourceName: 'people/2', emailAddresses: [{ value: 'a@b.com' }] },
            { resourceName: 'people/3', emailAddresses: [{ value: 'c@d.com' }] },
            { resourceName: 'people/4', emailAddresses: [] },
        ]);
        expect(contacts).toEqual([
            { email: 'a@b.com', name: 'Ana', notes: null, externalId: 'people/1' },
            { email: 'c@d.com', name: 'c@d.com', notes: null, externalId: 'people/3' },
        ]);
    });
});

describe('errores de Google', () => {
    it('token revocado -> 401 con reconexion; sin vincular -> 409', () => {
        const revoked = googleAuthErrorToResponse(new GoogleAuthError('GOOGLE_RECONNECT_REQUIRED'), '/calendar');
        expect(revoked.status).toBe(401);
        expect(revoked.body).toMatchObject({ code: 'GOOGLE_RECONNECT_REQUIRED', reconnect: true, reconnectUrl: '/api/auth/google?returnTo=%2Fcalendar' });
        const unlinked = googleAuthErrorToResponse(new GoogleAuthError('GOOGLE_NOT_LINKED'));
        expect(unlinked.status).toBe(409);
        expect(unlinked.body.code).toBe('GOOGLE_NOT_LINKED');
    });

    it('classifyGoogleApiError reconoce invalid_grant, 401 y scopes insuficientes', () => {
        expect(classifyGoogleApiError(400, { error: 'invalid_grant' })?.code).toBe('GOOGLE_RECONNECT_REQUIRED');
        expect(classifyGoogleApiError(401, { error: { status: 'UNAUTHENTICATED', message: 'x' } })?.code).toBe('GOOGLE_RECONNECT_REQUIRED');
        expect(classifyGoogleApiError(403, { error: { message: 'Request had insufficient authentication scopes.' } })?.code).toBe('GOOGLE_RECONNECT_REQUIRED');
        expect(classifyGoogleApiError(500, { error: { message: 'boom' } })).toBeNull();
        expect(classifyGoogleApiError(404, null)).toBeNull();
    });

    it('buildReconnectUrl rechaza redirecciones abiertas', () => {
        expect(buildReconnectUrl('//evil.com')).toBe('/api/auth/google?returnTo=%2F');
        expect(buildReconnectUrl('https://evil.com')).toBe('/api/auth/google?returnTo=%2F');
        expect(isGoogleAuthError(new GoogleAuthError('GOOGLE_NOT_LINKED'))).toBe(true);
        expect(isGoogleAuthError(new Error('x'))).toBe(false);
    });
});

describe('pickGoogleAccount', () => {
    it('prefiere la cuenta con refresh_token y el token mas vigente', () => {
        const a = { id: 'a', refresh_token: null, access_token: 'x', expires_at: 9999 };
        const b = { id: 'b', refresh_token: 'r', access_token: 'x', expires_at: 100 };
        const c = { id: 'c', refresh_token: 'r', access_token: 'x', expires_at: 200 };
        expect(pickGoogleAccount([a, b, c])?.id).toBe('c');
        expect(pickGoogleAccount([])).toBeNull();
    });
});
