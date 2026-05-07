function escapeHtml(value: string) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatDateLabel(date: Date, timezone?: string) {
    const options: Intl.DateTimeFormatOptions = {
        timeZone: timezone,
        weekday: 'long',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    };

    if (timezone) {
        options.timeZoneName = 'long';
    }

    return new Intl.DateTimeFormat('es-PE', options).format(date);
}

  function formatTimeLabel(date: Date, timezone?: string) {
    return new Intl.DateTimeFormat('es-PE', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }

function formatTimezoneLabel(date: Date, timezone?: string) {
    if (!timezone) return '';

    const formatted = new Intl.DateTimeFormat('es-PE', {
        timeZone: timezone,
        timeZoneName: 'long',
    }).format(date);

    return formatted.split(', ').pop() || timezone;
}

function getMeetLabel(meetUrl: string | null) {
    if (!meetUrl) return null;
    if (meetUrl.includes('zoom')) return 'Zoom';
    if (meetUrl.includes('meet.google.com')) return 'Google Meet';
    return 'Meeting link';
}

export function buildCalendarInviteHtml(options: {
    title: string;
    startsAtLabel: string;
    endsAtLabel: string;
    location?: string | null;
    organizerLabel?: string | null;
    attendeeCount?: number;
}) {
    const attendeeLabel = options.attendeeCount === 1
        ? '1 invitado'
        : `${options.attendeeCount || 0} invitados`;

    const locationBlock = options.location ? `
      <tr>
        <td style="padding:12px 0;border-top:1px solid #e5e7eb;font-size:13px;color:#6b7280;width:92px;">Lugar</td>
        <td style="padding:12px 0;border-top:1px solid #e5e7eb;font-size:14px;color:#111827;font-weight:500;">${escapeHtml(options.location)}</td>
      </tr>
    ` : '';

    const organizerBlock = options.organizerLabel ? `
      <tr>
        <td style="padding:12px 0;border-top:1px solid #e5e7eb;font-size:13px;color:#6b7280;width:92px;">Organizador</td>
        <td style="padding:12px 0;border-top:1px solid #e5e7eb;font-size:14px;color:#111827;font-weight:500;">${escapeHtml(options.organizerLabel)}</td>
      </tr>
    ` : '';

    return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f6f8fc;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <div style="max-width:680px;margin:24px auto;padding:0 16px;">
      <div style="background:#ffffff;border:1px solid #dbe3f3;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,.08);">
        <div style="padding:28px 32px 24px;background:linear-gradient(135deg,#1d4ed8 0%,#2563eb 55%,#0f172a 100%);color:#fff;">
          <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;opacity:.9;">Calendario BloomX</div>
          <h1 style="margin:10px 0 0;font-size:28px;line-height:1.2;font-weight:700;">${escapeHtml(options.title || 'Nuevo evento')}</h1>
          <p style="margin:10px 0 0;font-size:15px;line-height:1.5;color:#dbeafe;">${escapeHtml(options.startsAtLabel)} · ${escapeHtml(options.endsAtLabel)}</p>
        </div>
        <div style="padding:30px 32px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:12px 0;border-top:1px solid #e5e7eb;font-size:13px;color:#6b7280;width:92px;">Invitados</td>
              <td style="padding:12px 0;border-top:1px solid #e5e7eb;font-size:14px;color:#111827;font-weight:500;">${escapeHtml(attendeeLabel)}</td>
            </tr>
            ${locationBlock}
            ${organizerBlock}
          </table>
          <div style="margin-top:24px;padding:16px 18px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;color:#475569;font-size:13px;line-height:1.6;">
            El archivo .ics está adjunto para agregar esta invitación a tu calendario.
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;
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
  const whenLabel = `${formatDateLabel(options.startsAt, options.timezone)} · ${formatTimeLabel(options.startsAt, options.timezone)} – ${formatTimeLabel(options.endsAt, options.timezone)}${options.timezone ? ` (${formatTimezoneLabel(options.startsAt, options.timezone)})` : ''}`;
    const meetLabel = getMeetLabel(options.meetUrl);
    const meetButton = options.meetUrl ? `
      <a href="${escapeHtml(options.meetUrl)}" style="display:inline-block;margin-top:8px;background:#2563eb;color:#fff;text-decoration:none;padding:11px 18px;border-radius:10px;font-size:14px;font-weight:700;">${escapeHtml(meetLabel ? `Unirse con ${meetLabel}` : 'Unirse a la reunión')}</a>
    ` : '';

    return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f7f7fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <div style="max-width:760px;margin:24px auto;padding:0 16px;">
      <div style="background:#ffffff;border:1px solid #d9dee8;border-radius:18px;overflow:hidden;box-shadow:0 10px 32px rgba(15,23,42,.08);">
        <div style="padding:28px 32px 22px;background:linear-gradient(135deg,#2563eb 0%,#1d4ed8 48%,#0f172a 100%);color:#fff;">
          <div style="font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;opacity:.9;">Cita confirmada</div>
          <h1 style="margin:10px 0 0;font-size:28px;line-height:1.2;font-weight:700;">${escapeHtml(options.scheduleName)} (${escapeHtml(options.guestName)})</h1>
          <p style="margin:10px 0 0;font-size:15px;line-height:1.5;color:#dbeafe;">${escapeHtml(whenLabel)}</p>
        </div>
        <div style="padding:30px 32px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:12px 0;border-top:1px solid #e5e7eb;font-size:13px;color:#6b7280;width:120px;">Booked by</td>
              <td style="padding:12px 0;border-top:1px solid #e5e7eb;font-size:14px;color:#111827;">
                <div style="font-weight:600;">${escapeHtml(options.guestName)}</div>
                <div style="margin-top:4px;color:#2563eb;"><a href="mailto:${escapeHtml(options.guestEmail)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(options.guestEmail)}</a></div>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 0;border-top:1px solid #e5e7eb;font-size:13px;color:#6b7280;width:120px;">Organizadores</td>
              <td style="padding:12px 0;border-top:1px solid #e5e7eb;font-size:14px;color:#111827;">
                <div style="font-weight:600;">${escapeHtml(options.hostName)}</div>
                <div style="margin-top:4px;color:#2563eb;"><a href="mailto:${escapeHtml(options.hostEmail)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(options.hostEmail)}</a></div>
              </td>
            </tr>
          </table>

          <div style="margin-top:18px;padding:16px 18px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
            <div style="font-size:13px;color:#6b7280;">Horario</div>
            <div style="margin-top:4px;font-size:15px;font-weight:600;color:#111827;">${escapeHtml(whenLabel)}</div>
          </div>

          ${options.meetUrl ? `
            <div style="margin-top:22px;">
              <div style="font-size:13px;color:#6b7280;margin-bottom:8px;">Videollamada</div>
              ${meetButton}
              <div style="margin-top:10px;font-size:13px;line-height:1.6;color:#4b5563;word-break:break-word;">${escapeHtml(options.meetUrl)}</div>
            </div>
          ` : ''}

          <div style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap;">
            <a href="${escapeHtml(options.cancelUrl)}" style="display:inline-block;border:1px solid #d1d5db;color:#2563eb;text-decoration:none;padding:10px 16px;border-radius:10px;font-size:14px;font-weight:600;background:#fff;">Cancelar cita</a>
          </div>

          <p style="margin:24px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">Recibiste este correo porque tienes una cita reservada en BloomX. Si reenvías esta invitación, otras personas podrían cancelar la cita en tu nombre.</p>
        </div>
      </div>
    </div>
  </body>
</html>`;
}