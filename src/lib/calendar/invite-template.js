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

// Mid-gray reads acceptably against both a white and a dark background, so it is
// the ONE color we hard-code. Everything else inherits the client's own palette.
const RULE = '#808080';

function inviteRow(label, value, isHtml) {
    // Inline styles only — no CSS classes / <style> rules. Some webmail viewers
    // inject the email body into their own DOM and any <style> we ship leaks out
    // as global CSS, so everything must be self-contained inline.
    return `
      <tr>
        <td width="110" style="padding:8px 12px 8px 0;border-top:1px solid ${RULE};font-size:13px;vertical-align:top;">${escapeHtml(label)}</td>
        <td style="padding:8px 0;border-top:1px solid ${RULE};font-size:14px;">${isHtml ? value : escapeHtml(value)}</td>
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
                ? `${escapeHtml(a.name)} (${escapeHtml(a.email)})`
                : escapeHtml(a.email);
            return `<div style="padding:1px 0;">${display}</div>`;
        }).join('')
        : null;

    const organizerLabel = opts.organizer
        ? `${escapeHtml(opts.organizer.name || opts.organizer.email)} (${escapeHtml(opts.organizer.email)})`
        : null;

    const rows = [
        whenLabel ? inviteRow('Cuándo', whenLabel) : '',
        (opts.location || effectiveMeetUrl)
            ? (isMeetUrl
                ? inviteRow('Enlace', `<a href="${escapeHtml(effectiveMeetUrl)}" style="word-break:break-all;">${escapeHtml(meetProvider || effectiveMeetUrl)}</a>`, true)
                : inviteRow('Lugar', opts.location))
            : '',
        organizerLabel ? inviteRow('Organizador', organizerLabel, true) : '',
        attendeeRows ? inviteRow('Invitados', attendeeRows, true) : '',
        opts.description ? inviteRow('Notas', opts.description) : '',
    ].join('');

    // Buttons are bordered links, not colored blocks: a solid brand background with
    // hard-coded white text turns unreadable if a dark-mode client repaints the
    // background but keeps our text color (or vice versa). A border + inherited
    // text color survives both schemes.
    const btn = (url, label) =>
        `<a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 18px;border:1px solid ${RULE};text-decoration:none;font-size:14px;font-weight:bold;">${escapeHtml(label)}</a>`;

    const primaryBtn = opts.primaryAction
        ? btn(opts.primaryAction.url, opts.primaryAction.label)
        : (effectiveMeetUrl ? btn(effectiveMeetUrl, `Unirse a ${meetProvider || 'la reunión'}`) : '');

    const secondaryBtns = (Array.isArray(opts.secondaryActions) ? opts.secondaryActions : [])
        .map((a) => `<span style="padding-right:12px;">${btn(a.url, a.label)}</span>`)
        .join('');

    const year = new Date().getFullYear();

    // DESIGN RULES (do not "improve" this back into a marketing template):
    //
    // 1. NO background-color and NO text color anywhere. The client paints its own
    //    background and default text color, so the mail is readable in light AND
    //    dark mode for free. Hard-coding #ffffff/#111827 is exactly what breaks:
    //    a dark-mode client that repaints the background but keeps our dark text
    //    (or inverts our text but not our background) yields unreadable mail.
    //    The only hard-coded color is RULE (mid-gray), which reads on both.
    // 2. Tables for layout — divs with padding/max-width are unreliable in Outlook.
    // 3. Web-safe font stack only. `-apple-system`/`Segoe UI` resolve to a
    //    different face on every OS, so the mail rendered differently per machine.
    // 4. No gradient / box-shadow / border-radius / rgba / opacity: Outlook drops
    //    them, and the heavy CSS-in-HTML blob is itself a spam signal.
    // 5. Inline styles ONLY — no <style>, no classes, no media queries. Webmail
    //    viewers that inject the body into their own DOM (BloomX does) leak our
    //    <style> rules as global page CSS.
    // 6. color-scheme light dark => tells native clients we render correctly in
    //    both, so they don't force-invert us.
    return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <title>${escapeHtml(typeLabel)}: ${escapeHtml(opts.title)}</title>
  </head>
  <body style="margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:100%;max-width:560px;text-align:left;">
            <tr>
              <td style="padding:0 0 6px;font-size:12px;">${escapeHtml(brandName)} &middot; ${escapeHtml(typeLabel)}</td>
            </tr>
            <tr>
              <td style="padding:0 0 6px;font-size:20px;font-weight:bold;">${escapeHtml(opts.title)}</td>
            </tr>
            ${whenLabel ? `<tr><td style="padding:0 0 12px;font-size:14px;">${escapeHtml(whenLabel)}</td></tr>` : ''}
            ${rows ? `<tr><td><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">${rows}</table></td></tr>` : ''}
            ${primaryBtn ? `<tr><td style="padding:18px 0 0;">${primaryBtn}</td></tr>` : ''}
            ${secondaryBtns ? `<tr><td style="padding:${primaryBtn ? '10px' : '18px'} 0 0;">${secondaryBtns}</td></tr>` : ''}
            ${opts.hint ? `<tr><td style="padding:18px 0 0;font-size:13px;">${escapeHtml(opts.hint)}</td></tr>` : ''}
            <tr>
              <td style="padding:16px 0 0;border-top:1px solid ${RULE};font-size:12px;">${escapeHtml(brandName)} &middot; ${year}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

module.exports = { escapeHtml, darkenHex, getMeetProvider, renderInviteEmailHtml };
