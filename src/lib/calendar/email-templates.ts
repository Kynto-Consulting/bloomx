// Typed builders for outgoing calendar/meeting/appointment emails.
//
// The HTML itself comes from the canonical, framework-free renderer in
// ./invite-template.js — the SAME template the email extensions inline. This
// file owns the typed public API, the company brand (email-brand.ts) and the
// language; it does not contain any HTML. Edit the look in invite-template.js.
//
// EVERY email about events/meetings/bookings goes through here:
//   invitation · update · cancellation (event) · response (RSVP) · meeting announcement
//   · appointment (guest confirmation) · hostNotification (new booking) · host cancellation

import {
    formatWhenRange,
    inviteSubject,
    inviteText,
    renderInviteEmailHtml,
    renderInviteEmailText,
} from './invite-template.js';
import { resolveJoinLink } from './join-link';
import { defaultEmailBrand, type EmailBrand, type EmailLocale } from './email-brand';

export type { EmailBrand, EmailLocale } from './email-brand';

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

/** Fecha/hora legible en el idioma y la zona horaria indicados (mismo formato que el cuerpo del correo). */
export function formatEmailWhen(start: Date, end: Date | null, timezone: string | null | undefined, locale: EmailLocale = 'es'): string {
    return formatWhenRange(start, end, resolveTimeZone(timezone), locale) as string;
}

// ─── Unified branded email template (typed entry point) ──────────────────────

export interface EmailDialIn {
    country?: string;
    number: string;
    code?: string;
}

export type EmailPerson = { email: string; name?: string | null };

export type EmailType = 'invitation' | 'appointment' | 'meeting' | 'update' | 'cancellation' | 'response' | 'hostNotification';

export interface EmailTemplateOptions {
    type: EmailType;
    title: string;
    when?: { start: Date; end: Date; timezone?: string | null } | null;
    location?: string | null;
    meetUrl?: string | null;
    /** Datos de marcacion de la conferencia (se muestran solo si existen). */
    passcode?: string | null;
    dialIn?: EmailDialIn[];
    description?: string | null;
    attendees?: EmailPerson[];
    organizer?: EmailPerson | null;
    /** Quien actua (invitado que reserva / cancela / responde). Por defecto, el organizador. */
    actor?: EmailPerson | null;
    cancelledBy?: 'organizer' | 'guest';
    response?: 'accepted' | 'declined' | 'tentative';
    intro?: string | null;
    primaryAction?: { label: string; url: string } | null;
    secondaryActions?: Array<{ label: string; url: string }>;
    rsvp?: { accept?: string; maybe?: string; decline?: string };
    addToCalendarUrl?: string | null;
    /** Nota al pie: texto libre o una clave del diccionario (`hintKey`). */
    hint?: string | null;
    hintKey?: 'icsInvite' | 'icsMeeting' | 'icsCancel' | 'cancelledEvent' | 'appointment' | 'hostNotification' | 'hostCancellation';
    /** Marca de la empresa (getEmailBrand). Sin ella se usa la marca por defecto. */
    brand?: EmailBrand | null;
    locale?: EmailLocale;
    /** Solo vista previa: fuerza la variante clara u oscura. */
    colorScheme?: 'light' | 'dark';
    /** @deprecated usa `brand.name` / `brand.color`. */
    brandName?: string;
    /** @deprecated usa `brand.color`. */
    brandColor?: string;
}

type RenderInput = Parameters<typeof renderInviteEmailHtml>[0];

function toTemplateInput(opts: EmailTemplateOptions): RenderInput {
    // Enlace de reunion: se normaliza por HOST exacto (join-link.ts); un enlace de texto libre en `location` tambien cuenta.
    const join = resolveJoinLink({ meetUrl: opts.meetUrl, location: opts.location });
    const meetUrl = join.kind === 'join' ? join.url : (opts.meetUrl ?? null);
    const brand = opts.brand ?? defaultEmailBrand();
    return {
        type: opts.type,
        title: opts.title,
        locale: opts.locale ?? brand.locale ?? 'es',
        brand: {
            name: opts.brandName || brand.name,
            color: opts.brandColor || brand.color,
            logoUrl: brand.logoUrl ?? undefined,
            url: brand.url ?? undefined,
            footer: brand.footer ?? undefined,
        },
        when: opts.when ? { start: opts.when.start, end: opts.when.end, timeZone: resolveTimeZone(opts.when.timezone) } : null,
        location: opts.location ?? null,
        meetUrl,
        passcode: opts.passcode ?? null,
        dialIn: opts.dialIn,
        description: opts.description ?? null,
        attendees: opts.attendees,
        organizer: opts.organizer ?? null,
        actor: opts.actor ?? null,
        cancelledBy: opts.cancelledBy,
        response: opts.response,
        intro: opts.intro ?? undefined,
        primaryAction: opts.primaryAction ?? null,
        secondaryActions: opts.secondaryActions,
        rsvp: opts.rsvp,
        addToCalendarUrl: opts.addToCalendarUrl ?? undefined,
        hint: opts.hint ?? null,
        hintKey: opts.hintKey,
        colorScheme: opts.colorScheme,
    } as RenderInput;
}

export function buildEmailHtml(opts: EmailTemplateOptions): string {
    return renderInviteEmailHtml(toTemplateInput(opts));
}

/** Version de texto plano con los mismos datos e idioma que el HTML. */
export function buildEmailText(opts: EmailTemplateOptions): string {
    return renderInviteEmailText(toTemplateInput(opts));
}

/** Texto localizado del diccionario de la plantilla (`a.b.c`, con {variables}). Sin HTML. */
export function emailText(locale: EmailLocale, path: string, vars?: Record<string, string | number>): string {
    return inviteText(locale, path, vars) as string;
}

/** Asunto localizado y sin CR/LF. */
export function emailSubject(
    locale: EmailLocale,
    kind: 'invitation' | 'update' | 'cancellation' | 'appointment' | 'meeting' | 'response' | 'hostNotification' | 'hostCancellation',
    title: string,
    vars?: Record<string, string>,
): string {
    return inviteSubject(locale, kind, title, vars) as string;
}

// ─── Specific builders (use buildEmailHtml underneath) ───────────────────────

interface Common {
    brand?: EmailBrand | null;
    locale?: EmailLocale;
}

export function buildCalendarInviteHtml(options: Common & {
    title: string;
    startsAt: Date;
    endsAt: Date;
    timezone?: string | null;
    location?: string | null;
    meetUrl?: string | null;
    passcode?: string | null;
    dialIn?: EmailDialIn[];
    description?: string | null;
    organizer?: EmailPerson | null;
    attendees?: EmailPerson[];
    /** 'update' cuando se reenvia una version nueva del evento. */
    kind?: 'invitation' | 'update';
}) {
    return buildEmailHtml(calendarInviteOptions(options));
}

export function calendarInviteOptions(options: Parameters<typeof buildCalendarInviteHtml>[0]): EmailTemplateOptions {
    return {
        type: options.kind ?? 'invitation',
        title: options.title,
        when: { start: options.startsAt, end: options.endsAt, timezone: resolveTimeZone(options.timezone) },
        location: options.location,
        meetUrl: options.meetUrl,
        passcode: options.passcode,
        dialIn: options.dialIn,
        description: options.description,
        organizer: options.organizer,
        attendees: options.attendees,
        hintKey: 'icsInvite',
        brand: options.brand,
        locale: options.locale,
    };
}

export function buildAppointmentConfirmationHtml(options: Common & {
    guestName: string;
    guestEmail: string;
    hostName: string;
    hostEmail: string;
    scheduleName: string;
    startsAt: Date;
    endsAt: Date;
    meetUrl: string | null;
    passcode?: string | null;
    dialIn?: EmailDialIn[];
    cancelUrl: string;
    timezone: string;
}) {
    return buildEmailHtml(appointmentConfirmationOptions(options));
}

export function appointmentConfirmationOptions(options: Parameters<typeof buildAppointmentConfirmationHtml>[0]): EmailTemplateOptions {
    const locale = options.locale ?? options.brand?.locale ?? 'es';
    return {
        type: 'appointment',
        title: `${options.scheduleName} · ${options.guestName}`,
        when: { start: options.startsAt, end: options.endsAt, timezone: options.timezone },
        location: options.meetUrl,
        meetUrl: options.meetUrl,
        passcode: options.passcode,
        dialIn: options.dialIn,
        organizer: { email: options.hostEmail, name: options.hostName },
        actor: { email: options.hostEmail, name: options.hostName },
        attendees: [{ email: options.guestEmail, name: options.guestName }],
        secondaryActions: [{ label: emailText(locale, 'cancelAppointment'), url: options.cancelUrl }],
        hintKey: 'appointment',
        brand: options.brand,
        locale,
    };
}

export function buildMeetingAnnouncementHtml(options: Common & {
    topic: string;
    meetUrl: string;
    passcode?: string | null;
    dialIn?: EmailDialIn[];
    startsAt?: Date | null;
    endsAt?: Date | null;
    timezone?: string | null;
    attendees?: EmailPerson[];
    organizer?: EmailPerson | null;
}) {
    return buildEmailHtml({
        type: 'meeting',
        title: options.topic,
        when: options.startsAt && options.endsAt
            ? { start: options.startsAt, end: options.endsAt, timezone: resolveTimeZone(options.timezone) }
            : null,
        location: options.meetUrl,
        meetUrl: options.meetUrl,
        passcode: options.passcode,
        dialIn: options.dialIn,
        organizer: options.organizer,
        attendees: options.attendees,
        hintKey: 'icsMeeting',
        brand: options.brand,
        locale: options.locale,
    });
}

/** Aviso al ANFITRION: alguien ha reservado una cita (nueva reserva). */
export function buildHostNotificationHtml(options: Common & {
    guestName: string;
    guestEmail: string;
    guestNotes?: string | null;
    scheduleName: string;
    startsAt: Date;
    endsAt: Date;
    timezone: string;
    meetUrl?: string | null;
    hostName?: string | null;
    hostEmail?: string | null;
}) {
    return buildEmailHtml(hostNotificationOptions(options));
}

export function hostNotificationOptions(options: Parameters<typeof buildHostNotificationHtml>[0]): EmailTemplateOptions {
    return {
        type: 'hostNotification',
        title: options.scheduleName,
        when: { start: options.startsAt, end: options.endsAt, timezone: options.timezone },
        actor: { email: options.guestEmail, name: options.guestName },
        description: options.guestNotes,
        location: options.meetUrl ?? null,
        meetUrl: options.meetUrl ?? null,
        hintKey: 'hostNotification',
        brand: options.brand,
        locale: options.locale,
    };
}

/** Aviso al ANFITRION: el invitado ha cancelado su cita. */
export function buildHostCancellationHtml(options: Common & {
    guestName: string;
    guestEmail: string;
    scheduleName: string;
    startsAt: Date;
    endsAt: Date;
    timezone: string;
}) {
    return buildEmailHtml(hostCancellationOptions(options));
}

export function hostCancellationOptions(options: Parameters<typeof buildHostCancellationHtml>[0]): EmailTemplateOptions {
    return {
        type: 'cancellation',
        cancelledBy: 'guest',
        title: options.scheduleName,
        when: { start: options.startsAt, end: options.endsAt, timezone: options.timezone },
        actor: { email: options.guestEmail, name: options.guestName },
        hintKey: 'hostCancellation',
        brand: options.brand,
        locale: options.locale,
    };
}

/** Cancelacion de un evento del calendario (a los invitados). */
export function buildEventCancellationHtml(options: Common & {
    title: string;
    startsAt: Date;
    endsAt: Date;
    timezone?: string | null;
    location?: string | null;
    organizer?: EmailPerson | null;
}) {
    return buildEmailHtml(eventCancellationOptions(options));
}

export function eventCancellationOptions(options: Parameters<typeof buildEventCancellationHtml>[0]): EmailTemplateOptions {
    return {
        type: 'cancellation',
        title: options.title,
        when: { start: options.startsAt, end: options.endsAt, timezone: resolveTimeZone(options.timezone) },
        location: options.location,
        organizer: options.organizer,
        hintKey: 'cancelledEvent',
        brand: options.brand,
        locale: options.locale,
    };
}

/** Respuesta (RSVP) de un invitado al organizador. */
export function buildInviteResponseHtml(options: Common & {
    title: string;
    response: 'accepted' | 'declined' | 'tentative';
    responderName?: string | null;
    responderEmail: string;
    startsAt?: Date | null;
    endsAt?: Date | null;
    timezone?: string | null;
    location?: string | null;
}) {
    return buildEmailHtml(inviteResponseOptions(options));
}

export function inviteResponseOptions(options: Parameters<typeof buildInviteResponseHtml>[0]): EmailTemplateOptions {
    return {
        type: 'response',
        response: options.response,
        title: options.title,
        when: options.startsAt && options.endsAt
            ? { start: options.startsAt, end: options.endsAt, timezone: resolveTimeZone(options.timezone) }
            : null,
        location: options.location,
        actor: { email: options.responderEmail, name: options.responderName },
        brand: options.brand,
        locale: options.locale,
    };
}
