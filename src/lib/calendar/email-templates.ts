// Brand from env — white-label, no "BloomX" in outgoing emails
const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME || 'Bloom';
const BRAND_COLOR = process.env.NEXT_PUBLIC_BRAND_COLOR || '#2563EB';

function escapeHtml(value: string | null | undefined) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function darkenHex(hex: string, amount = 0.25): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const d = (c: number) => Math.max(0, Math.round(c * (1 - amount))).toString(16).padStart(2, '0');
    return `#${d(r)}${d(g)}${d(b)}`;
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

function getMeetProvider(url: string | null | undefined) {
    if (!url) return null;
    if (url.includes('meet.google.com')) return 'Google Meet';
    if (url.includes('zoom.us')) return 'Zoom';
    if (url.includes('teams.microsoft.com')) return 'Microsoft Teams';
    return 'Videollamada';
}

// ─── Shared row builder ───────────────────────────────────────────────────────

function row(label: string, value: string, isHtml = false) {
    return `
      <tr>
        <td style="padding:12px 0;border-top:1px solid #e5e7eb;font-size:13px;color:#6b7280;width:110px;vertical-align:top;">${escapeHtml(label)}</td>
        <td style="padding:12px 0;border-top:1px solid #e5e7eb;font-size:14px;color:#111827;font-weight:500;">${isHtml ? value : escapeHtml(value)}</td>
      </tr>`;
}

// ─── Unified branded email template ─────────────────────────────────────────

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

const TYPE_LABELS: Record<EmailTemplateOptions['type'], string> = {
    invitation: 'Invitación',
    appointment: 'Cita confirmada',
    meeting: 'Reunión',
    update: 'Actualización de evento',
    cancellation: 'Evento cancelado',
};

export function buildEmailHtml(opts: EmailTemplateOptions): string {
    const brandName = opts.brandName || BRAND_NAME;
    const brandColor = opts.brandColor || BRAND_COLOR;
    const darkColor = darkenHex(brandColor, 0.3);
    const typeLabel = TYPE_LABELS[opts.type] || opts.type;

    const whenLabel = opts.when
        ? `${formatDateLabel(opts.when.start, opts.when.timezone)} — ${formatTimeLabel(opts.when.end, opts.when.timezone)}`
        : null;

    const effectiveMeetUrl = opts.meetUrl || (opts.location?.startsWith('http') ? opts.location : null);
    const meetProvider = getMeetProvider(effectiveMeetUrl ?? opts.location);
    const isMeetUrl = !!effectiveMeetUrl;

    const attendeeRows = opts.attendees && opts.attendees.length > 0
        ? opts.attendees.map(a => {
            const display = a.name && a.name !== a.email
                ? `${escapeHtml(a.name)} <span style="color:#6b7280;font-weight:400;">(${escapeHtml(a.email)})</span>`
                : escapeHtml(a.email);
            return `<div style="padding:2px 0;">${display}</div>`;
        }).join('')
        : null;

    const organizerLabel = opts.organizer
        ? `${opts.organizer.name || opts.organizer.email} <span style="color:#6b7280;font-weight:400;">(${escapeHtml(opts.organizer.email)})</span>`
        : null;

    const rows = [
        whenLabel ? row('Cuándo', whenLabel) : '',
        opts.location || effectiveMeetUrl
            ? isMeetUrl
                ? row('Enlace', `<a href="${escapeHtml(effectiveMeetUrl!)}" style="color:${escapeHtml(brandColor)};font-weight:600;word-break:break-all;">${escapeHtml(meetProvider || effectiveMeetUrl!)}</a>`, true)
                : row('Lugar', opts.location!)
            : '',
        organizerLabel ? row('Organizador', organizerLabel, true) : '',
        attendeeRows ? row('Invitados', attendeeRows, true) : '',
        opts.description ? row('Notas', opts.description) : '',
    ].join('');

    const primaryBtn = opts.primaryAction
        ? `<a href="${escapeHtml(opts.primaryAction.url)}" style="display:inline-block;padding:12px 20px;background:${escapeHtml(brandColor)};color:#fff;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;margin-top:20px;">${escapeHtml(opts.primaryAction.label)}</a>`
        : effectiveMeetUrl
            ? `<a href="${escapeHtml(effectiveMeetUrl)}" style="display:inline-block;padding:12px 20px;background:${escapeHtml(brandColor)};color:#fff;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;margin-top:20px;">Unirse a ${escapeHtml(meetProvider || 'la reunión')}</a>`
            : '';

    const secondaryBtns = (opts.secondaryActions || []).map(a =>
        `<a href="${escapeHtml(a.url)}" style="display:inline-block;padding:11px 16px;border:1px solid #d1d5db;color:${escapeHtml(brandColor)};text-decoration:none;border-radius:10px;font-size:14px;font-weight:600;background:#fff;margin:4px 8px 4px 0;">${escapeHtml(a.label)}</a>`
    ).join('');

    const hintBlock = opts.hint
        ? `<div style="margin-top:20px;padding:14px 16px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;color:#475569;font-size:13px;line-height:1.6;">${escapeHtml(opts.hint)}</div>`
        : '';

    return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:32px 16px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,Helvetica,sans-serif;color:#111827;">
    <div style="max-width:560px;margin:0 auto;">
      <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,.10);">
        <!-- Header -->
        <div style="padding:28px 32px;background:linear-gradient(135deg,${escapeHtml(brandColor)} 0%,${escapeHtml(darkColor)} 100%);color:#fff;">
          <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;opacity:.75;">${escapeHtml(brandName)}</div>
          <div style="display:inline-block;margin-top:10px;padding:3px 10px;border-radius:99px;background:rgba(255,255,255,.2);font-size:12px;font-weight:600;">${escapeHtml(typeLabel)}</div>
          <h1 style="margin:10px 0 0;font-size:22px;line-height:1.3;font-weight:700;">${escapeHtml(opts.title)}</h1>
          ${whenLabel ? `<p style="margin:8px 0 0;font-size:14px;opacity:.85;">${escapeHtml(whenLabel)}</p>` : ''}
        </div>
        <!-- Body -->
        <div style="padding:28px 32px;">
          ${rows ? `<table style="width:100%;border-collapse:collapse;">${rows}</table>` : ''}
          ${primaryBtn}
          ${secondaryBtns ? `<div style="margin-top:${primaryBtn ? '12px' : '20px'}">${secondaryBtns}</div>` : ''}
          ${hintBlock}
        </div>
        <!-- Footer -->
        <div style="padding:14px 32px;border-top:1px solid #e5e7eb;background:#f8fafc;">
          <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">${escapeHtml(brandName)} · ${new Date().getFullYear()}</p>
        </div>
      </div>
    </div>
  </body>
</html>`;
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
        when: { start: options.startsAt, end: options.endsAt, timezone: options.timezone },
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
            ? { start: options.startsAt, end: options.endsAt, timezone: options.timezone }
            : null,
        location: options.meetUrl,
        organizer: options.organizer,
        attendees: options.attendees,
        hint: 'El archivo .ics está adjunto para agregar este evento a tu calendario.',
    });
}
