/**
 * CORPUS DE CORREOS DE MUESTRA: todas las variantes de la plantilla unica de reuniones / eventos / citas, con datos
 * ficticios, en es/en y con cualquier marca. Lo usan:
 *  - `__tests__/email-lint.test.ts` (compatibilidad de clientes + legibilidad en modo oscuro sobre TODO el corpus);
 *  - la pagina de desarrollo `/dev/email-preview` (revision visual).
 * Pasa por las MISMAS funciones tipadas que los envios reales (`email-templates.ts`); nada de HTML aqui.
 */
import { getEmailBrand, type EmailBrand, type EmailLocale } from './email-brand';
import {
    appointmentConfirmationOptions,
    buildEmailHtml,
    calendarInviteOptions,
    eventCancellationOptions,
    hostCancellationOptions,
    hostNotificationOptions,
    inviteResponseOptions,
    type EmailTemplateOptions,
} from './email-templates';

export interface SampleBrandSpec {
    id: string;
    label: string;
    name: string;
    primary: string;
    /** Con logo https (claro); sin el, la cabecera es una banda con el nombre. */
    logo?: boolean;
    footer?: string;
}

/** Marcas de referencia: azul, amarillo (saturado y pastel), negra, verde saturado, blanca, pastel, gris medio y azul marino. */
export const SAMPLE_BRANDS: readonly SampleBrandSpec[] = [
    { id: 'blue', label: 'Azul', name: 'Acme Azul', primary: '#2563eb', footer: 'Av. Principal 123, Lima' },
    { id: 'yellow', label: 'Amarillo', name: 'Sol Amarillo', primary: '#ffcc00' },
    { id: 'yellow-pastel', label: 'Amarillo pastel', name: 'Pastel Sol', primary: '#fff3a3', footer: 'Calle Sol 45' },
    { id: 'black', label: 'Negra', name: 'Noir Studio', primary: '#000000' },
    { id: 'green', label: 'Verde saturado', name: 'Verde Vivo', primary: '#00ff00' },
    { id: 'white', label: 'Blanca', name: 'Blanco Puro', primary: '#ffffff', footer: 'Jr. Nieve 1' },
    { id: 'pink-pastel', label: 'Rosa pastel', name: 'Rosa Suave', primary: '#ffd6e7' },
    { id: 'grey', label: 'Gris medio', name: 'Gris Medio', primary: '#888888' },
    { id: 'navy', label: 'Azul marino', name: 'Marino SAC', primary: '#0a1f44', logo: true },
];

export const SAMPLE_LOGO = 'https://cdn.acme.example/logo.png';

export function sampleBrand(spec: SampleBrandSpec, withLogo = spec.logo ?? false): EmailBrand {
    return getEmailBrand({
        name: 'mail.acme.example',
        displayName: spec.name,
        theme: {
            palette: { light: { primary: spec.primary } },
            landing: { ...(withLogo ? { logo: { light: SAMPLE_LOGO } } : {}), ...(spec.footer ? { footer: { text: spec.footer } } : {}) },
        },
    });
}

const TEXT = {
    es: {
        event: 'Revisión de roadmap del tercer trimestre', short: 'Sincronización', schedule: 'Asesoría de producto', notes: 'Traer el informe de ventas.\nRevisar las métricas del último mes.',
        organizer: 'Laura Gómez', guest: 'Ana Torres', guestTwo: 'Diego Ríos', room: 'Sala 2, piso 4',
        long: 'Presentación de resultados anuales y plan estratégico consolidado para todas las áreas de la compañía',
    },
    en: {
        event: 'Q3 roadmap review', short: 'Sync', schedule: 'Product advisory', notes: 'Bring the sales report.\nReview last month metrics.',
        organizer: 'Laura Gomez', guest: 'Ana Torres', guestTwo: 'Diego Rios', room: 'Room 2, 4th floor',
        long: 'Annual results presentation and consolidated strategic plan for every area of the company',
    },
} as const;

export interface SampleVariant {
    id: string;
    label: string;
    build: (ctx: { brand: EmailBrand; locale: EmailLocale }) => EmailTemplateOptions;
}

function times() {
    const start = new Date('2030-03-05T15:00:00Z');
    return { startsAt: start, endsAt: new Date(start.getTime() + 60 * 60 * 1000), timezone: 'America/Lima' };
}

export const SAMPLE_VARIANTS: readonly SampleVariant[] = [
    {
        id: 'invitation-rich', label: 'Invitación completa (Zoom, RSVP, teléfono, notas)',
        build: ({ brand, locale }) => {
            const t = TEXT[locale];
            return {
                ...calendarInviteOptions({
                    title: t.event, ...times(), location: 'https://us02web.zoom.us/j/81234567890', meetUrl: 'https://us02web.zoom.us/j/81234567890',
                    passcode: '493021', dialIn: [{ country: 'PE', number: '+51 1 700 0000', code: '81234567890' }, { country: 'US', number: '+1 646 558 8656' }],
                    description: t.notes, organizer: { email: 'laura@example.com', name: t.organizer },
                    attendees: [{ email: 'ana@example.com', name: t.guest }, { email: 'diego@example.com', name: t.guestTwo }, { email: 'sofia@example.com' }],
                    brand, locale,
                }),
                rsvp: { accept: 'https://mail.acme.example/rsvp/1/accept', maybe: 'https://mail.acme.example/rsvp/1/maybe', decline: 'https://mail.acme.example/rsvp/1/decline' },
                addToCalendarUrl: 'https://mail.acme.example/ics/1',
            };
        },
    },
    {
        id: 'invitation-meet', label: 'Invitación (Google Meet)',
        build: ({ brand, locale }) => calendarInviteOptions({
            title: TEXT[locale].short, ...times(), location: 'https://meet.google.com/abc-defg-hij', meetUrl: 'https://meet.google.com/abc-defg-hij',
            organizer: { email: 'laura@example.com', name: TEXT[locale].organizer }, attendees: [{ email: 'ana@example.com', name: TEXT[locale].guest }], brand, locale,
        }),
    },
    {
        id: 'invitation-plain', label: 'Invitación sin enlace (lugar físico)',
        build: ({ brand, locale }) => calendarInviteOptions({
            title: TEXT[locale].short, ...times(), location: TEXT[locale].room, organizer: { email: 'laura@example.com', name: TEXT[locale].organizer }, brand, locale,
        }),
    },
    {
        id: 'update', label: 'Actualización de evento',
        build: ({ brand, locale }) => calendarInviteOptions({
            kind: 'update', title: TEXT[locale].event, ...times(), location: 'https://meet.google.com/abc-defg-hij', meetUrl: 'https://meet.google.com/abc-defg-hij',
            organizer: { email: 'laura@example.com', name: TEXT[locale].organizer }, attendees: [{ email: 'ana@example.com', name: TEXT[locale].guest }], brand, locale,
        }),
    },
    {
        id: 'cancellation', label: 'Evento cancelado',
        build: ({ brand, locale }) => eventCancellationOptions({
            title: TEXT[locale].event, ...times(), location: TEXT[locale].room, organizer: { email: 'laura@example.com', name: TEXT[locale].organizer }, brand, locale,
        }),
    },
    {
        id: 'appointment', label: 'Cita confirmada (invitado)',
        build: ({ brand, locale }) => appointmentConfirmationOptions({
            guestName: TEXT[locale].guest, guestEmail: 'ana@example.com', hostName: TEXT[locale].organizer, hostEmail: 'laura@example.com',
            scheduleName: TEXT[locale].schedule, ...times(), meetUrl: 'https://zoom.us/j/123456789', cancelUrl: 'https://mail.acme.example/book/1/cancel/token', brand, locale,
        }),
    },
    {
        id: 'host-notification', label: 'Nueva reserva (anfitrión)',
        build: ({ brand, locale }) => hostNotificationOptions({
            guestName: TEXT[locale].guest, guestEmail: 'ana@example.com', guestNotes: TEXT[locale].notes, scheduleName: TEXT[locale].schedule,
            ...times(), meetUrl: 'https://zoom.us/j/123456789', brand, locale,
        }),
    },
    {
        id: 'host-cancellation', label: 'Cita cancelada por el invitado',
        build: ({ brand, locale }) => hostCancellationOptions({
            guestName: TEXT[locale].guest, guestEmail: 'ana@example.com', scheduleName: TEXT[locale].schedule, ...times(), brand, locale,
        }),
    },
    ...(['accepted', 'declined', 'tentative'] as const).map<SampleVariant>((response) => ({
        id: `response-${response}`, label: `Respuesta: ${response}`,
        build: ({ brand, locale }) => inviteResponseOptions({
            title: TEXT[locale].event, response, responderName: TEXT[locale].guest, responderEmail: 'ana@example.com', ...times(), location: TEXT[locale].room, brand, locale,
        }),
    })),
    {
        id: 'meeting', label: 'Aviso de reunión (Meet, teléfono)',
        build: ({ brand, locale }) => ({
            type: 'meeting', title: TEXT[locale].short, when: { start: times().startsAt, end: times().endsAt, timezone: times().timezone }, location: 'https://meet.google.com/abc-defg-hij', meetUrl: 'https://meet.google.com/abc-defg-hij',
            passcode: '123456', dialIn: [{ country: 'US', number: '+1 555 0100', code: '123456' }],
            organizer: { email: 'laura@example.com', name: TEXT[locale].organizer }, attendees: [{ email: 'ana@example.com', name: TEXT[locale].guest }],
            hintKey: 'icsMeeting', brand, locale,
        }),
    },
    {
        id: 'long-content', label: 'Contenido largo (título, notas y 34 invitados)',
        build: ({ brand, locale }) => calendarInviteOptions({
            title: TEXT[locale].long, ...times(), location: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%7d',
            meetUrl: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%7d',
            description: `${TEXT[locale].notes}\n${TEXT[locale].notes}\n${TEXT[locale].notes}`, organizer: { email: 'laura@example.com', name: TEXT[locale].organizer },
            attendees: Array.from({ length: 34 }, (_, i) => ({ email: `invitado${i + 1}@example.com`, name: `${TEXT[locale].guest} ${i + 1}` })), brand, locale,
        }),
    },
];

export function buildSampleHtml(input: { variant: string; brand: EmailBrand; locale: EmailLocale; scheme?: 'light' | 'dark' }): string {
    const variant = SAMPLE_VARIANTS.find((v) => v.id === input.variant) ?? SAMPLE_VARIANTS[0];
    return buildEmailHtml({ ...variant.build({ brand: input.brand, locale: input.locale }), colorScheme: input.scheme });
}
