/**
 * Fachada de conferencias: crear / borrar / probar reuniones delegando en la extension del proveedor.
 *
 * Garantias:
 *  - PROPIEDAD: `actor.userId` sale de la sesion del servidor; el `auth` inyectado a la extension son las cuentas
 *    vinculadas de ESE usuario. Borrar/actualizar exige haber creado la reunion (registro ConferenceMeeting).
 *  - IDEMPOTENCIA persistente por (usuario, proveedor, Idempotency-Key), ver ledger.ts.
 *  - ERRORES TIPADOS (ConferencingError) y resultado validado (normalize.ts).
 *  - COMPATIBILIDAD: si la extension no esta instalada o el backend no responde y el usuario tiene su cuenta vinculada,
 *    se usa el adaptador fino del host (core-adapters.ts) para no romper lo que ya funcionaba.
 */
import { analyzeMeetingUrl } from './hosts';
import { callExtension, type CallExtensionInit } from './bridge';
import { getLinkedAuth, type LinkedAuthResult } from './auth-context';
import { createGoogleMeetWithUserToken, createZoomWithUserToken } from './core-adapters';
import { claimMeeting, completeMeeting, markMeetingDeleted, releaseClaim, userOwnsGoogleEvent, userOwnsMeeting, waitForMeeting } from './ledger';
import { normalizeMeeting } from './normalize';
import type { Actor } from './status';
import { invalidateStatusCache } from './status';
import { createHash } from 'node:crypto';
import {
    ConferencingError,
    PROVIDER_INFO,
    type ConferencingMeeting,
    type ConferencingProviderId,
    type CreateMeetingInput,
} from './types';

export interface ServiceDeps {
    call?: (init: CallExtensionInit) => ReturnType<typeof callExtension>;
    linked?: (userId: string) => Promise<LinkedAuthResult>;
}

const TOPIC_MAX = 200;
const MAX_ATTENDEES = 100;
const EMAIL_RE = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,255}$/;

/** Saneo del input (la ruta ya valida con zod; esto protege tambien a las llamadas internas, p. ej. appointments). */
export function sanitizeInput(input: CreateMeetingInput): CreateMeetingInput {
    const iso = (v: unknown) => {
        if (typeof v !== 'string' || !v) return null;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
    };
    const startsAt = iso(input.startsAt);
    const endsAt = iso(input.endsAt);
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
        throw new ConferencingError('invalid_input', 'The end must be after the start');
    }
    let timeZone = typeof input.timeZone === 'string' ? input.timeZone.trim() : '';
    if (timeZone) {
        try {
            new Intl.DateTimeFormat('en-US', { timeZone });
        } catch {
            timeZone = '';
        }
    }
    const attendees = Array.from(
        new Set((Array.isArray(input.attendees) ? input.attendees : []).map((e) => String(e).trim().toLowerCase()).filter((e) => EMAIL_RE.test(e))),
    ).slice(0, MAX_ATTENDEES);
    return {
        topic: String(input.topic || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, TOPIC_MAX) || undefined,
        startsAt,
        endsAt,
        timeZone: timeZone || null,
        attendees,
        ...(input.customUrl ? { customUrl: input.customUrl } : {}),
        ...(input.attachToEventId ? { attachToEventId: String(input.attachToEventId).slice(0, 200) } : {}),
    };
}

/** Reunion de tipo `custom`: enlace propio validado (https, sin credenciales). No llama a nadie. */
export function customMeeting(input: CreateMeetingInput): ConferencingMeeting {
    const info = analyzeMeetingUrl(input.customUrl);
    if (!info) throw new ConferencingError('invalid_input', 'The link must be a valid https URL');
    return {
        provider: 'custom',
        providerName: info.recognized ? info.providerName : PROVIDER_INFO.custom.name,
        joinUrl: info.url,
        hostUrl: null,
        meetingId: `custom:${createHash('sha256').update(info.url).digest('hex').slice(0, 16)}`,
        topic: input.topic || null,
        mode: 'custom-link',
    };
}

function extensionAuthFor(provider: 'google-meet' | 'zoom', linked: LinkedAuthResult) {
    const entry = provider === 'zoom' ? linked.auth.zoom : linked.auth.google;
    return entry ? { [provider === 'zoom' ? 'zoom' : 'google']: entry } : {};
}

export async function createMeeting(
    actor: Actor,
    provider: ConferencingProviderId,
    rawInput: CreateMeetingInput,
    opts: { idempotencyKey?: string | null; deps?: ServiceDeps } = {},
): Promise<ConferencingMeeting> {
    const input = sanitizeInput(rawInput);
    if (provider === 'custom') return customMeeting(input);

    const deps = opts.deps ?? {};
    const key = opts.idempotencyKey || null;

    if (input.attachToEventId) {
        if (provider !== 'google-meet') throw new ConferencingError('invalid_input', 'attachToEventId is only valid for Google Meet');
        if (!(await userOwnsGoogleEvent(actor.userId, input.attachToEventId))) {
            throw new ConferencingError('invalid_input', 'The event does not belong to this user');
        }
    }

    const claim = await claimMeeting({ userId: actor.userId, provider, idempotencyKey: key });
    if (claim.kind === 'replay') return claim.meeting;
    if (claim.kind === 'in_progress') {
        const done = await waitForMeeting({ userId: actor.userId, provider, idempotencyKey: key! });
        if (done) return done;
        throw new ConferencingError('rate_limited', 'A meeting with this key is already being created', { retryAfter: 3 });
    }

    try {
        const meeting = await createViaProvider(actor, provider, input, key, deps);
        await completeMeeting(claim.id, { userId: actor.userId, provider, idempotencyKey: key }, meeting);
        invalidateStatusCache(actor);
        return meeting;
    } catch (error) {
        await releaseClaim(claim.id);
        throw error;
    }
}

async function createViaProvider(
    actor: Actor,
    provider: 'google-meet' | 'zoom',
    input: CreateMeetingInput,
    key: string | null,
    deps: ServiceDeps,
): Promise<ConferencingMeeting> {
    const linked = await (deps.linked ?? getLinkedAuth)(actor.userId);
    const call = deps.call ?? callExtension;
    const info = PROVIDER_INFO[provider];

    const res = await call({
        domain: actor.domain,
        userId: actor.userId,
        email: actor.email,
        extensionId: info.extensionId!,
        action: 'createMeeting',
        params: {
            topic: input.topic,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            timeZone: input.timeZone,
            attendees: input.attendees,
            ...(input.attachToEventId ? { attachToEventId: input.attachToEventId } : {}),
            ...(key ? { idempotencyKey: key } : {}),
        },
        context: { auth: extensionAuthFor(provider, linked), sender: { email: actor.email || '' } },
        timeoutMs: 25_000,
    });

    if (res.ok) return normalizeMeeting(provider, res.result);

    // Extension ausente / backend caido: adaptador del host con la cuenta vinculada DEL PROPIO usuario.
    if (res.kind === 'not_installed' || res.kind === 'unreachable') {
        const entry = provider === 'zoom' ? linked.auth.zoom : linked.auth.google;
        if (entry) {
            return provider === 'zoom' ? createZoomWithUserToken(entry.accessToken, input) : createGoogleMeetWithUserToken(entry.accessToken);
        }
        const problem = provider === 'zoom' ? linked.problems.zoom : linked.problems.google;
        if (problem === 'token_revoked') throw new ConferencingError('token_revoked', 'Your account needs to be reconnected');
        throw new ConferencingError('not_connected', 'Connect your account to create meetings');
    }
    throw res.error;
}

export async function deleteMeeting(actor: Actor, provider: ConferencingProviderId, meetingId: string, deps: ServiceDeps = {}): Promise<void> {
    if (provider === 'custom') return;
    if (!meetingId || meetingId.length > 200) throw new ConferencingError('invalid_input', 'Invalid meetingId');
    // Propiedad estricta: en modo instancia el token del proveedor es de toda la cuenta.
    if (!(await userOwnsMeeting(actor.userId, provider, meetingId))) {
        throw new ConferencingError('invalid_input', 'Unknown meeting');
    }
    const linked = await (deps.linked ?? getLinkedAuth)(actor.userId);
    const call = deps.call ?? callExtension;
    const res = await call({
        domain: actor.domain,
        userId: actor.userId,
        email: actor.email,
        extensionId: PROVIDER_INFO[provider].extensionId!,
        action: 'deleteMeeting',
        params: { meetingId },
        context: { auth: extensionAuthFor(provider, linked) },
        timeoutMs: 20_000,
    });
    if (!res.ok) {
        // Sin extension no se puede borrar en el proveedor: la reunion simplemente queda sin gestionar (no es un error grave).
        if (res.kind === 'not_installed' || res.kind === 'unreachable') {
            await markMeetingDeleted(actor.userId, provider, meetingId);
            return;
        }
        throw res.error;
    }
    await markMeetingDeleted(actor.userId, provider, meetingId);
}

/** `testConnection` de la extension (solo admin: la ruta exige requireAdmin). Usa la cuenta del admin como usuario. */
export async function testConnection(actor: Actor, provider: 'google-meet' | 'zoom', deps: ServiceDeps = {}): Promise<{ mode?: string; detail?: string }> {
    const linked = await (deps.linked ?? getLinkedAuth)(actor.userId);
    const call = deps.call ?? callExtension;
    const res = await call({
        domain: actor.domain,
        userId: actor.userId,
        email: actor.email,
        extensionId: PROVIDER_INFO[provider].extensionId!,
        action: 'testConnection',
        params: {},
        context: { auth: extensionAuthFor(provider, linked) },
        timeoutMs: 20_000,
    });
    if (!res.ok) {
        if (res.kind === 'not_installed') throw new ConferencingError('unavailable', 'The extension is not installed');
        throw res.error;
    }
    const r = (res.result || {}) as Record<string, unknown>;
    if (r.ok === false) throw new ConferencingError('provider_error', typeof r.detail === 'string' ? r.detail.slice(0, 200) : 'Connection test failed');
    return {
        mode: typeof r.mode === 'string' ? r.mode.slice(0, 40) : undefined,
        detail: typeof r.detail === 'string' ? r.detail.slice(0, 200) : undefined,
    };
}
