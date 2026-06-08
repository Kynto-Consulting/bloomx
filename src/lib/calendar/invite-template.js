// ════════════════════════════════════════════════════════════════════════════
// CANONICAL INVITE EMAIL TEMPLATE — single source of truth.
//
// Renders the branded "style 1" calendar/meeting invite email. Pure, framework
// free, string-in / string-out: no Date math, no Intl, no Node APIs. Callers
// format `whenLabel` themselves and pass it in. Safe in the browser, in Next.js
// server code, and inside the extension `vm` sandbox.
//
// Consumed by:
//   • Internal app  → imported by src/lib/calendar/email-templates.ts
//   • Extensions     → inlined into each server.js by
//                      bloomx-extensions/_shared/sync-invite-template.mjs
//
// EDIT HERE ONLY. After changing the rendering, re-run the extension sync script
// so the inlined copies stay identical:
//     node bloomx-extensions/_shared/sync-invite-template.mjs
// ════════════════════════════════════════════════════════════════════════════

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function darkenHex(hex, amount) {
    amount = amount == null ? 0.3 : amount;
    const clean = String(hex || '#2563EB').replace(/[^0-9a-fA-F]/g, '').padEnd(6, '0').slice(0, 6);
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    const d = (c) => Math.max(0, Math.round(c * (1 - amount))).toString(16).padStart(2, '0');
    return `#${d(r)}${d(g)}${d(b)}`;
}

function getMeetProvider(url) {
    if (!url) return null;
    if (url.includes('meet.google.com')) return 'Google Meet';
    if (url.includes('zoom.us') || url.includes('zoom.com')) return 'Zoom';
    if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return 'Microsoft Teams';
    return 'Videollamada';
}

const TYPE_LABELS = {
    invitation: 'Invitación',
    appointment: 'Cita confirmada',
    meeting: 'Reunión',
    update: 'Actualización de evento',
    cancellation: 'Evento cancelado',
};

// ─── Row builder ─────────────────────────────────────────────────────────────

function inviteRow(label, value, isHtml) {
    // Inline styles only — no CSS classes / <style> rules. Some webmail viewers
    // inject the email body into their own DOM and any <style> we ship leaks out
    // as global CSS, so everything must be self-contained inline.
    return `
      <tr>
        <td style="padding:12px 0;border-top:1px solid #e5e7eb;font-size:13px;color:#6b7280;width:110px;vertical-align:top;">${escapeHtml(label)}</td>
        <td style="padding:12px 0;border-top:1px solid #e5e7eb;font-size:14px;color:#111827;font-weight:500;">${isHtml ? value : escapeHtml(value)}</td>
      </tr>`;
}

// ─── Main renderer ───────────────────────────────────────────────────────────

/**
 * Render the branded invite email.
 *
 * @param {Object} opts
 * @param {('invitation'|'appointment'|'meeting'|'update'|'cancellation')} [opts.type]
 * @param {string}  opts.title
 * @param {string|null}  [opts.whenLabel]    Pre-formatted date/time range string.
 * @param {string|null}  [opts.location]     Free-text location OR a meeting URL.
 * @param {string|null}  [opts.meetUrl]      Explicit meeting URL (wins over location).
 * @param {string|null}  [opts.description]
 * @param {Array<{email:string,name?:string|null}>} [opts.attendees]
 * @param {{email:string,name?:string|null}|null}    [opts.organizer]
 * @param {{label:string,url:string}|null}            [opts.primaryAction]
 * @param {Array<{label:string,url:string}>}          [opts.secondaryActions]
 * @param {string|null}  [opts.hint]         Footer note (e.g. about the .ics attachment).
 * @param {string}  [opts.brandName]
 * @param {string}  [opts.brandColor]
 * @returns {string} Full HTML document.
 */
function renderInviteEmailHtml(opts) {
    opts = opts || {};
    const brandName = opts.brandName || 'Bloom';
    const brandColor = opts.brandColor || '#2563EB';
    const darkColor = darkenHex(brandColor, 0.3);
    const typeLabel = TYPE_LABELS[opts.type] || opts.type || 'Invitación';
    const whenLabel = opts.whenLabel || null;

    const effectiveMeetUrl = opts.meetUrl
        || (opts.location && String(opts.location).startsWith('http') ? opts.location : null);
    const isMeetUrl = !!effectiveMeetUrl;
    const meetProvider = getMeetProvider(effectiveMeetUrl || opts.location);

    const attendees = Array.isArray(opts.attendees) ? opts.attendees : [];
    const attendeeRows = attendees.length > 0
        ? attendees.map((a) => {
            const display = a.name && a.name !== a.email
                ? `${escapeHtml(a.name)} <span style="color:#6b7280;font-weight:400;">(${escapeHtml(a.email)})</span>`
                : escapeHtml(a.email);
            return `<div style="padding:2px 0;">${display}</div>`;
        }).join('')
        : null;

    const organizerLabel = opts.organizer
        ? `${escapeHtml(opts.organizer.name || opts.organizer.email)} <span style="color:#6b7280;font-weight:400;">(${escapeHtml(opts.organizer.email)})</span>`
        : null;

    const rows = [
        whenLabel ? inviteRow('Cuándo', whenLabel) : '',
        (opts.location || effectiveMeetUrl)
            ? (isMeetUrl
                ? inviteRow('Enlace', `<a href="${escapeHtml(effectiveMeetUrl)}" style="color:${escapeHtml(brandColor)};font-weight:600;word-break:break-all;">${escapeHtml(meetProvider || effectiveMeetUrl)}</a>`, true)
                : inviteRow('Lugar', opts.location))
            : '',
        organizerLabel ? inviteRow('Organizador', organizerLabel, true) : '',
        attendeeRows ? inviteRow('Invitados', attendeeRows, true) : '',
        opts.description ? inviteRow('Notas', opts.description) : '',
    ].join('');

    const primaryBtn = opts.primaryAction
        ? `<a href="${escapeHtml(opts.primaryAction.url)}" style="display:inline-block;padding:12px 20px;background:${escapeHtml(brandColor)};color:#ffffff;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;margin-top:20px;">${escapeHtml(opts.primaryAction.label)}</a>`
        : (effectiveMeetUrl
            ? `<a href="${escapeHtml(effectiveMeetUrl)}" style="display:inline-block;padding:12px 20px;background:${escapeHtml(brandColor)};color:#ffffff;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;margin-top:20px;">Unirse a ${escapeHtml(meetProvider || 'la reunión')}</a>`
            : '');

    const secondaryBtns = (Array.isArray(opts.secondaryActions) ? opts.secondaryActions : []).map((a) =>
        `<a href="${escapeHtml(a.url)}" style="display:inline-block;padding:11px 16px;border:1px solid #d1d5db;color:${escapeHtml(brandColor)};text-decoration:none;border-radius:10px;font-size:14px;font-weight:600;background:#ffffff;margin:4px 8px 4px 0;">${escapeHtml(a.label)}</a>`
    ).join('');

    const hintBlock = opts.hint
        ? `<div style="margin-top:20px;padding:14px 16px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;color:#475569;font-size:13px;line-height:1.6;">${escapeHtml(opts.hint)}</div>`
        : '';

    const year = new Date().getFullYear();

    // INLINE STYLES ONLY — no <style> block, no CSS classes, no media queries.
    // Webmail viewers that inject the email body into their own DOM (BloomX does
    // this) would otherwise leak our <style> rules as global page CSS; a
    // prefers-color-scheme:dark rule then flips text to light while the page
    // background stays light → invisible white-on-white text. Every element
    // carries an explicit dark-on-light inline color so it renders the same,
    // readable, in light and dark clients. `color-scheme: light` tells native
    // mail clients not to auto-invert.
    return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
  </head>
  <body style="margin:0;padding:32px 16px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,Helvetica,sans-serif;color:#111827;">
    <div style="max-width:560px;margin:0 auto;">
      <div style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,.10);">
        <!-- Header (solid background-color fallback for Outlook, gradient on top) -->
        <div style="padding:28px 32px;background-color:${escapeHtml(brandColor)};background:linear-gradient(135deg,${escapeHtml(brandColor)} 0%,${escapeHtml(darkColor)} 100%);color:#ffffff;">
          <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;opacity:.85;color:#ffffff;">${escapeHtml(brandName)}</div>
          <div style="display:inline-block;margin-top:10px;padding:3px 10px;border-radius:99px;background:rgba(255,255,255,.2);font-size:12px;font-weight:600;color:#ffffff;">${escapeHtml(typeLabel)}</div>
          <h1 style="margin:10px 0 0;font-size:22px;line-height:1.3;font-weight:700;color:#ffffff;">${escapeHtml(opts.title)}</h1>
          ${whenLabel ? `<p style="margin:8px 0 0;font-size:14px;opacity:.9;color:#ffffff;">${escapeHtml(whenLabel)}</p>` : ''}
        </div>
        <!-- Body -->
        <div style="padding:28px 32px;background:#ffffff;">
          ${rows ? `<table style="width:100%;border-collapse:collapse;">${rows}</table>` : ''}
          ${primaryBtn}
          ${secondaryBtns ? `<div style="margin-top:${primaryBtn ? '12px' : '20px'}">${secondaryBtns}</div>` : ''}
          ${hintBlock}
        </div>
        <!-- Footer -->
        <div style="padding:14px 32px;border-top:1px solid #e5e7eb;background:#f8fafc;">
          <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">${escapeHtml(brandName)} · ${year}</p>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

module.exports = { escapeHtml, darkenHex, getMeetProvider, renderInviteEmailHtml };
