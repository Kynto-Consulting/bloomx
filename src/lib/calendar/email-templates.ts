// Typed builders for outgoing calendar/meeting emails.
//
// The HTML itself comes from the canonical, framework-free renderer in
// ./invite-template.js — the SAME template the email extensions inline. This
// file only owns date formatting (es-PE / timezone) and the typed public API;
// it does not contain any HTML. Edit the look in invite-template.js.

import { renderInviteEmailHtml } from './invite-template.js';

// Brand from env — white-label, no "BloomX" in outgoing emails
const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME || 'Bloom';
const BRAND_COLOR = process.env.NEXT_PUBLIC_BRAND_COLOR || '#2563EB';

// Fallback timezone for human-readable date labels when a caller doesn't supply
// one. WITHOUT this, Intl falls back to the runtime tz — which is UTC on the
// server — so a 11:00 Lima event renders as "4:00 p. m." in invite emails.
// Override per-deployment via DEFAULT_TIMEZONE; defaults to Peru.
export const DEFAULT_TIMEZONE =
    process.env.DEFAULT_TIMEZONE || process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE || 'America/Lima';

/** Validate an IANA tz string; fall back to DEFAULT_TIMEZONE if missing/invalid. */
export function resolveTimeZone(tz?: string | null): string {
    const candidate = String(tz || '').trim();
    if (!candidate) return DEFAULT_TIMEZONE;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: candidate });
        return candidate;
    } catch {
        return DEFAULT_TIMEZONE;
    }
}

function formatDateLabel(date: Date, timezone?: string | null) {
    return new Intl.DateTimeFormat('es-PE', {
        timeZone: timezone || undefined,
        weekday: 'long',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        ...(timezone ? { timeZoneName: 'short' } : {}),
    }).format(date);
}

function formatTimeLabel(date: Date, timezone?: string | null) {
    return new Intl.DateTimeFormat('es-PE', {
        timeZone: timezone || undefined,
        hour: 'numeric',
        minute: '2-digit',
    }).format(date);
}

// ─── Unified branded email template (typed entry point) ──────────────────────

export interface EmailTemplateOptions {
    type: 'invitation' | 'appointment' | 'meeting' | 'update' | 'cancellation';
    title: string;
    when?: { start: Date; end: Date; timezone?: string | null } | null;
    location?: string | null;
    meetUrl?: string | null;
    description?: string | null;
    attendees?: Array<{ email: string; name?: string | null }>;
    organizer?: { email: string; name?: string | null } | null;
    primaryAction?: { label: string; url: string } | null;
    secondaryActions?: Array<{ label: string; url: string }>;
    hint?: string | null;
    brandName?: string;
    brandColor?: string;
}

export function buildEmailHtml(opts: EmailTemplateOptions): string {
    const whenLabel = opts.when
        ? `${formatDateLabel(opts.when.start, opts.when.timezone)} — ${formatTimeLabel(opts.when.end, opts.when.timezone)}`
        : null;

    return renderInviteEmailHtml({
        type: opts.type,
        title: opts.title,
        whenLabel,
        location: opts.location ?? null,
        meetUrl: opts.meetUrl ?? null,
        description: opts.description ?? null,
        attendees: opts.attendees,
        organizer: opts.organizer ?? null,
        primaryAction: opts.primaryAction ?? null,
        secondaryActions: opts.secondaryActions,
        hint: opts.hint ?? null,
        brandName: opts.brandName || BRAND_NAME,
        brandColor: opts.brandColor || BRAND_COLOR,
    });
}

// ─── Specific builders (use buildEmailHtml underneath) ───────────────────────

export function buildCalendarInviteHtml(options: {
    title: string;
    startsAt: Date;
    endsAt: Date;
    timezone?: string | null;
    location?: string | null;
    description?: string | null;
    organizer?: { email: string; name?: string | null } | null;
    attendees?: Array<{ email: string; name?: string | null }>;
}) {
    return buildEmailHtml({
        type: 'invitation',
        title: options.title,
        when: { start: options.startsAt, end: options.endsAt, timezone: resolveTimeZone(options.timezone) },
        location: options.location,
        description: options.description,
        organizer: options.organizer,
        attendees: options.attendees,
        hint: 'El archivo .ics está adjunto para agregar esta invitación a tu calendario.',
    });
}

export function buildAppointmentConfirmationHtml(options: {
    guestName: string;
    guestEmail: string;
    hostName: string;
    hostEmail: string;
    scheduleName: string;
    startsAt: Date;
    endsAt: Date;
    meetUrl: string | null;
    cancelUrl: string;
    timezone: string;
}) {
    return buildEmailHtml({
        type: 'appointment',
        title: `${options.scheduleName} · ${options.guestName}`,
        when: { start: options.startsAt, end: options.endsAt, timezone: options.timezone },
        location: options.meetUrl,
        organizer: { email: options.hostEmail, name: options.hostName },
        attendees: [{ email: options.guestEmail, name: options.guestName }],
        secondaryActions: [{ label: 'Cancelar cita', url: options.cancelUrl }],
        hint: 'Recibirás una invitación de calendario adjunta. Si reenvías este correo, otras personas podrían cancelar la cita.',
    });
}

export function buildMeetingAnnouncementHtml(options: {
    topic: string;
    meetUrl: string;
    startsAt?: Date | null;
    endsAt?: Date | null;
    timezone?: string | null;
    attendees?: Array<{ email: string; name?: string | null }>;
    organizer?: { email: string; name?: string | null } | null;
}) {
    return buildEmailHtml({
        type: 'meeting',
        title: options.topic,
        when: options.startsAt && options.endsAt
            ? { start: options.startsAt, end: options.endsAt, timezone: resolveTimeZone(options.timezone) }
            : null,
        location: options.meetUrl,
        organizer: options.organizer,
        attendees: options.attendees,
        hint: 'El archivo .ics está adjunto para agregar este evento a tu calendario.',
    });
}
