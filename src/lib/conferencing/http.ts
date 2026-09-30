/** Utilidades HTTP compartidas por las rutas /api/calendar/conferencing/**. */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { rateLimitAsync } from '@/lib/security';
import { errorBody } from './errors';
import type { Actor } from './status';
import { CONFERENCING_ERROR_STATUS, ConferencingError, isConferencingError, isConferencingProviderId, type ConferencingProviderId } from './types';

const NO_STORE = { 'Cache-Control': 'no-store' };

/** Mismo criterio que /api/expansions: dominio del tenant = TOP_DOMAIN o Host. */
export function resolveDomain(req: Request): string {
    return (process.env.TOP_DOMAIN || req.headers.get('host') || '').split(':')[0].toLowerCase();
}

export async function requireActor(req: Request): Promise<{ ok: true; actor: Actor } | { ok: false; response: NextResponse }> {
    const user = await getCurrentUser();
    if (!user?.id) {
        return { ok: false, response: NextResponse.json(errorBody(new ConferencingError('unauthorized', 'Unauthorized')), { status: 401, headers: NO_STORE }) };
    }
    return { ok: true, actor: { userId: user.id, email: user.email || null, domain: resolveDomain(req) } };
}

export function errorResponse(error: unknown, extra: Record<string, unknown> = {}): NextResponse {
    if (isConferencingError(error)) {
        const headers: Record<string, string> = { ...NO_STORE };
        if (error.retryAfter) headers['Retry-After'] = String(error.retryAfter);
        return NextResponse.json(errorBody(error, extra), { status: CONFERENCING_ERROR_STATUS[error.code], headers });
    }
    console.error('[CONFERENCING] unexpected error:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json(errorBody(new ConferencingError('provider_error', 'Unexpected error'), extra), { status: 500, headers: NO_STORE });
}

export async function limit(key: string, max: number, windowMs: number): Promise<ConferencingError | null> {
    const rl = await rateLimitAsync(key, max, windowMs);
    return rl.ok ? null : new ConferencingError('rate_limited', 'Too many requests', { retryAfter: rl.retryAfter });
}

export function parseProvider(raw: string): ConferencingProviderId | null {
    return isConferencingProviderId(raw) ? raw : null;
}

export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_.:\-]{8,128}$/;

export function readIdempotencyKey(req: Request): string | null | 'invalid' {
    const raw = req.headers.get('idempotency-key');
    if (raw === null || raw === '') return null;
    return IDEMPOTENCY_KEY_RE.test(raw) ? raw : 'invalid';
}

export const createMeetingSchema = z
    .object({
        topic: z.string().max(200).optional(),
        startsAt: z.string().max(40).nullable().optional(),
        endsAt: z.string().max(40).nullable().optional(),
        timeZone: z.string().max(64).nullable().optional(),
        attendees: z.array(z.string().max(320)).max(100).optional(),
        customUrl: z.string().max(2048).optional(),
        attachToEventId: z.string().max(200).optional(),
    })
    .strict();

export const NO_STORE_HEADERS = NO_STORE;
