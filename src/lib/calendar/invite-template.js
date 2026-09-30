// ════════════════════════════════════════════════════════════════════════════
// CANONICAL MEETING / EVENT / APPOINTMENT EMAIL TEMPLATE — single source of truth.
//
// ONE template ("style 1") for every email about events, meetings and bookings:
//   invitation · update · cancellation · response (RSVP) · meeting (announcement)
//   · appointment (guest confirmation) · hostNotification (new booking for the host)
//
// Pure, framework free, string-in / string-out. No Node APIs. `Intl` is used only by
// `formatWhenRange` (wrapped in try/catch). Safe in the browser, in Next.js server code
// and inside the extension `vm` sandbox.
//
// Consumed by:
//   • Internal app  → imported by src/lib/calendar/email-templates.ts
//   • Extensions     → inlined into each server.js by
//                      bloomx-extensions/_shared/sync-invite-template.mjs
//
// EDIT HERE ONLY. After changing the rendering, re-run the extension sync script
// so the inlined copies stay identical:
//     node bloomx-extensions/_shared/sync-invite-template.mjs
//
// DESIGN CONTRACT (email clients are not browsers — do not "improve" this casually):
//  1. Brand = { name, color, logoUrl, url, footer }. The ONLY colours in the output are the brand colour and the fixed
//     neutral palette below. The brand hue stays EXACT on decorative/background surfaces (header band, solid button,
//     top strip); the text/icon colour ON those surfaces (`onColor`) is picked by contrast (white or near-black, >= 4.5:1).
//     Only where the brand is used AS text/link colour over the white card (outline buttons, links) a corrected version
//     is used (`linkColor`, AA on white; `colorOnDark` on the dark card). A yellow brand gives a yellow header.
//  2. Layout with tables (`role="presentation"`), width 600, inline styles on every element, bulletproof
//     buttons (bgcolor on the <td> + padded <a>). No external CSS, no web fonts, no JS.
//  3. The only <style> block is a progressive enhancement for dark mode / small screens, with namespaced
//     classes (`bxm-*`). Without it the email is complete and readable (light palette, explicit colours).
//  4. Text is bilingual (es / en) from the dictionary INVITE_COPY. Dates come pre-formatted (`whenLabel`) or
//     are formatted from `when` with `formatWhenRange` (locale + IANA time zone).
//  5. Every link is validated: meeting links by EXACT host (analyzeMeetLink), everything else https
//     (http only for localhost in development) or mailto. An unsafe URL is never rendered as a link.
// ════════════════════════════════════════════════════════════════════════════

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Una sola linea de texto: sin caracteres de control (incluye CR/LF, U+2028/9), espacios colapsados, longitud acotada.
function inviteLine(value, max) {
    const text = String(value == null ? '' : value)
        .replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, ' ')
        .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    return max && text.length > max ? text.slice(0, max) : text;
}

// Texto multilinea (notas): se conservan los saltos de linea como \n; el resto de controles se elimina.
function inviteMultiline(value, max) {
    const text = String(value == null ? '' : value)
        .replace(/\r\n|\r|\u2028|\u2029/g, '\n')
        .replace(/[\u0000-\u0009\u000b-\u001f\u007f\u0085]/g, '')
        .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return max && text.length > max ? text.slice(0, max) : text;
}

function inviteMultilineHtml(value, max) {
    return escapeHtml(inviteMultiline(value, max)).replace(/\n/g, '<br>');
}

// href permitido en acciones (cancelar, responder...): https, mailto, o http SOLO hacia localhost (desarrollo).
// Cualquier otra cosa (javascript:, data:, http remoto, credenciales, espacios, comillas) => null (no se dibuja enlace).
function safeUrl(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw || raw.length > 2048) return null;
    if (/[^!-~]/.test(raw) || /["'<>\\`]/.test(raw)) return null;
    if (/^mailto:[^\s?#]+(\?[^\s#]*)?$/i.test(raw)) return raw;
    const m = /^(https?):\/\/([^/?#:@]+)(?::(\d{1,5}))?(?:[/?#]|$)/i.exec(raw);
    if (!m) return null;
    const host = m[2].toLowerCase();
    if (m[1].toLowerCase() === 'https') return /^[a-z0-9.-]+$/.test(host) && host.indexOf('.') > 0 ? raw : (host === 'localhost' ? raw : null);
    return host === 'localhost' || host === '127.0.0.1' ? raw : null;
}

// Solo https para recursos cargados o enlaces de marca (logo, sitio). Sin credenciales, sin puerto distinto de 443.
function inviteHttpsUrl(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text || text.length > 2048) return null;
    if (/[^!-~]/.test(text) || /["'<>\\`]/.test(text)) return null;
    const m = /^https:\/\/([^/?#:@]+)(?::(\d+))?(?:[/?#]|$)/i.exec(text);
    if (!m) return null;
    if (m[2] && m[2] !== '443') return null;
    const host = m[1].toLowerCase().replace(/\.$/, '');
    if (!/^[a-z0-9.-]+$/.test(host) || host.indexOf('.') < 1 || /\.\.|^\.|^-/.test(host)) return null;
    return text;
}

function inviteEmail(value) {
    const text = String(value == null ? '' : value).trim();
    return /^[^\s@<>"',;:\\()[\]]{1,64}@[^\s@<>"',;:\\()[\]]{1,255}\.[^\s@<>"',;:\\()[\]]{2,63}$/.test(text) ? text : null;
}

// ─── Color: contraste WCAG (copia autocontenida de src/lib/color.ts; la paridad la comprueba un test) ─────────────

function inviteNormalizeHex(value) {
    const text = String(value == null ? '' : value).trim();
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
    if (!m) return null;
    let hex = m[1].toLowerCase();
    if (hex.length === 3) hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
    return '#' + hex;
}

function inviteRgb(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function inviteLuminance(hex) {
    const c = inviteRgb(hex).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function inviteContrast(a, b) {
    const la = inviteLuminance(a);
    const lb = inviteLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function inviteMix(a, b, t) {
    const x = inviteRgb(a);
    const y = inviteRgb(b);
    const h = (i) => Math.max(0, Math.min(255, Math.round(x[i] + (y[i] - x[i]) * t))).toString(16).padStart(2, '0');
    return '#' + h(0) + h(1) + h(2);
}

// Acerca `color` a `target` (negro o blanco) hasta alcanzar `min` contra `against`; conserva el matiz lo mas posible.
function inviteEnsureContrast(color, against, target, min) {
    if (inviteContrast(color, against) >= min) return color;
    for (let i = 1; i <= 40; i++) {
        const candidate = inviteMix(color, target, i / 40);
        if (inviteContrast(candidate, against) >= min) return candidate;
    }
    return target;
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

// ─── Paleta neutra FIJA (la unica aparte del color de marca) ─────────────────────────────────────────────────────

const INVITE_NEUTRAL = {
    page: '#f3f4f6', card: '#ffffff', ink: '#1f2937', muted: '#4b5563', rule: '#e5e7eb',
    darkPage: '#0f1115', darkCard: '#1b1e24', darkInk: '#f3f4f6', darkMuted: '#b8bec9', darkRule: '#343a44',
};
const INVITE_DEFAULT_COLOR = '#2563eb';
const INVITE_FONT = 'Arial,Helvetica,sans-serif';

// Texto (o icono) legible sobre `bg`: blanco o casi negro, el que de >= 4.5:1; en grises medios, blanco/negro puros.
function inviteReadableOn(bg) {
    const first = inviteContrast(bg, '#ffffff') >= inviteContrast(bg, '#0a0a0a') ? '#ffffff' : '#0a0a0a';
    if (inviteContrast(first, bg) >= 4.5) return first;
    return inviteContrast('#000000', bg) >= inviteContrast('#ffffff', bg) ? '#000000' : '#ffffff';
}

/**
 * Marca saneada. NUNCA lanza.
 *  - name: texto plano (sin control, sin < >), <= 60.
 *  - color: el TONO EXACTO de la marca (#rrggbb) para superficies decorativas: banda de cabecera, boton solido, franja.
 *  - onColor: texto/iconos SOBRE `color` (blanco o casi negro, el que de >= 4.5:1).
 *  - linkColor: la marca corregida a AA (>= 4.5) sobre BLANCO; solo para texto/enlaces/contorno sobre la tarjeta clara.
 *  - colorOnDark: la marca aclarada a AA sobre la tarjeta oscura (enlaces y contornos en modo oscuro).
 *  - edge / edgeOnDark: borde del boton solido y de la banda (>= 3:1 contra la tarjeta clara / oscura, WCAG 1.4.11).
 *  - requested: color pedido normalizado; textAdjusted: true si linkColor != color (como texto la marca no llega a AA).
 *  - logoUrl / url: solo https validado; footer: texto plano <= 160.
 * @param {*} brand {name, color, logoUrl, url, footer}
 * @param {*} [legacy] {brandName, brandColor} (opciones antiguas)
 */
function resolveInviteBrand(brand, legacy) {
    const b = brand && typeof brand === 'object' ? brand : {};
    const l = legacy && typeof legacy === 'object' ? legacy : {};
    const name = inviteLine(b.name || l.brandName, 60).replace(/[<>]/g, '') || 'Bloom';
    const requested = inviteNormalizeHex(b.color) || inviteNormalizeHex(l.brandColor) || INVITE_DEFAULT_COLOR;
    // AA tambien sobre el fondo de pagina (mas oscuro que la tarjeta): el pie y los enlaces cercanos al borde se leen igual.
    const linkColor = inviteEnsureContrast(requested, INVITE_NEUTRAL.page, '#000000', 4.5);
    const dark = INVITE_NEUTRAL.darkCard;
    return {
        name,
        color: requested,
        onColor: inviteReadableOn(requested),
        linkColor,
        colorOnDark: inviteEnsureContrast(requested, dark, '#ffffff', 4.5),
        // Borde >= 3:1 sobre blanco; y si la marca es tan oscura que se pierde sobre un fondo invertido/oscuro (negro), gris neutro
        // que se ve en ambos.
        edge: (function () {
            const e = inviteEnsureContrast(requested, '#ffffff', '#000000', 3);
            return inviteContrast(e, '#000000') >= 3 ? e : '#8a8f98';
        })(),
        edgeOnDark: inviteEnsureContrast(requested, dark, '#ffffff', 3),
        requested,
        textAdjusted: linkColor !== requested,
        logoUrl: inviteHttpsUrl(b.logoUrl),
        url: inviteHttpsUrl(b.url),
        footer: inviteLine(b.footer, 160).replace(/[<>]/g, '') || null,
    };
}

/**
 * Marca para una extension a partir del contexto de ejecucion. `ctx.brand` lo inyecta el host (ya validado); se vuelve a
 * sanear aqui. Sin marca (dominio legado): displayName del dominio / NEXT_PUBLIC_BRAND_NAME / "Bloom".
 */
function resolveBrandFromContext(ctx) {
    const c = ctx && typeof ctx === 'object' ? ctx : {};
    const injected = c.brand && typeof c.brand === 'object' ? c.brand : {};
    const domain = c.domain && typeof c.domain === 'object' ? c.domain : {};
    const env = c.env && typeof c.env === 'object' ? c.env : {};
    const name = injected.name || domain.displayName || env.NEXT_PUBLIC_BRAND_NAME || 'Bloom';
    const out = resolveInviteBrand({ name, color: injected.color, logoUrl: injected.logoUrl, url: injected.url, footer: injected.footer });
    out.locale = injected.locale === 'en' ? 'en' : (injected.locale === 'es' ? 'es' : null);
    return out;
}

// ─── Textos por idioma ───────────────────────────────────────────────────────────────────────────────────────────

const INVITE_COPY = {
    es: {
        htmlLang: 'es',
        types: {
            invitation: 'Invitación',
            update: 'Actualización de evento',
            cancellation: 'Evento cancelado',
            appointment: 'Cita confirmada',
            meeting: 'Reunión',
            response: 'Respuesta a tu invitación',
            hostNotification: 'Nueva reserva',
        },
        intro: {
            invitation: '{actor} te ha invitado a este evento.',
            update: '{actor} ha actualizado este evento.',
            cancellationOrganizer: '{actor} ha cancelado este evento.',
            cancellationGuest: '{actor} ha cancelado su cita.',
            appointment: 'Tu cita con {actor} está confirmada.',
            meeting: '{actor} comparte esta reunión contigo.',
            response: '{actor} {answer} tu invitación.',
            hostNotification: '{actor} ha reservado una cita contigo.',
        },
        answers: { accepted: 'ha aceptado', declined: 'ha rechazado', tentative: 'ha respondido «quizá» a' },
        chips: { cancelled: 'Cancelado', accepted: 'Aceptó', declined: 'Rechazó', tentative: 'Quizá' },
        labels: {
            when: 'Cuándo', where: 'Lugar', link: 'Enlace', passcode: 'Contraseña', phone: 'Teléfono', organizer: 'Organizador',
            guests: 'Invitados', guest: 'Invitado', notes: 'Notas', code: 'Código', more: 'y {n} más',
        },
        join: 'Unirse a {provider}',
        joinGeneric: 'Unirse a la reunión',
        rsvpTitle: 'Tu respuesta',
        accept: 'Aceptar',
        decline: 'Rechazar',
        maybe: 'Quizá',
        addToCalendar: 'Añadir al calendario',
        cancelAppointment: 'Cancelar cita',
        hints: {
            icsInvite: 'El archivo .ics está adjunto para agregar esta invitación a tu calendario.',
            icsMeeting: 'El archivo .ics está adjunto para agregar este evento a tu calendario.',
            icsCancel: 'El archivo .ics adjunto cancela este evento en tu calendario.',
            cancelledEvent: 'Este evento fue cancelado. Tu calendario se actualizará con el archivo .ics adjunto.',
            appointment: 'Recibirás una invitación de calendario adjunta. Si reenvías este correo, otras personas podrían cancelar la cita.',
            hostNotification: 'La cita ya está en tu calendario; el archivo .ics adjunto la añade a otros calendarios.',
            hostCancellation: 'El hueco vuelve a estar libre en tu agenda.',
        },
        subjects: {
            invitation: 'Invitación: {title}',
            update: 'Actualización: {title}',
            cancellation: 'Cancelado: {title}',
            appointment: 'Confirmado: {title}',
            meeting: 'Reunión: {title}',
            response: '{answer}: {title}',
            hostNotification: 'Nueva reserva: {title}',
            hostCancellation: 'Cancelada: {title}',
        },
        defaultTitle: 'Nuevo evento',
        icsIntro: 'Tienes una cita confirmada.',
        icsWith: 'Con',
        // Textos de las extensiones de conferencia / calendario (asunto, texto plano, descripcion del ICS).
        conf: {
            meeting: 'Reunión', join: 'Unirse', joinMeeting: 'Unirse a la reunión', joinProvider: 'Unirse a la reunión de {provider}',
            meetingId: 'ID de reunión', accessCode: 'Código de acceso', dialIn: 'Marcación telefónica', pin: 'PIN',
            unverifiedLink: 'Enlace sin verificar', videocall: 'Videollamada', guestCount: 'Invitados',
            reminder: 'Recordatorio', calendarName: 'Calendario', location: 'Ubicación',
        },
        locale: 'es-PE',
    },
    en: {
        htmlLang: 'en',
        types: {
            invitation: 'Invitation',
            update: 'Event update',
            cancellation: 'Event cancelled',
            appointment: 'Appointment confirmed',
            meeting: 'Meeting',
            response: 'Reply to your invitation',
            hostNotification: 'New booking',
        },
        intro: {
            invitation: '{actor} has invited you to this event.',
            update: '{actor} has updated this event.',
            cancellationOrganizer: '{actor} has cancelled this event.',
            cancellationGuest: '{actor} has cancelled their appointment.',
            appointment: 'Your appointment with {actor} is confirmed.',
            meeting: '{actor} is sharing this meeting with you.',
            response: '{actor} {answer} your invitation.',
            hostNotification: '{actor} has booked an appointment with you.',
        },
        answers: { accepted: 'has accepted', declined: 'has declined', tentative: 'has replied "maybe" to' },
        chips: { cancelled: 'Cancelled', accepted: 'Accepted', declined: 'Declined', tentative: 'Maybe' },
        labels: {
            when: 'When', where: 'Where', link: 'Link', passcode: 'Passcode', phone: 'Phone', organizer: 'Organizer',
            guests: 'Guests', guest: 'Guest', notes: 'Notes', code: 'Code', more: 'and {n} more',
        },
        join: 'Join {provider}',
        joinGeneric: 'Join the meeting',
        rsvpTitle: 'Your reply',
        accept: 'Accept',
        decline: 'Decline',
        maybe: 'Maybe',
        addToCalendar: 'Add to calendar',
        cancelAppointment: 'Cancel appointment',
        hints: {
            icsInvite: 'The .ics file is attached so you can add this invitation to your calendar.',
            icsMeeting: 'The .ics file is attached so you can add this event to your calendar.',
            icsCancel: 'The attached .ics file cancels this event in your calendar.',
            cancelledEvent: 'This event was cancelled. Your calendar will update with the attached .ics file.',
            appointment: 'A calendar invitation is attached. If you forward this email, other people could cancel the appointment.',
            hostNotification: 'The appointment is already in your calendar; the attached .ics file adds it to other calendars.',
            hostCancellation: 'The slot is free again in your schedule.',
        },
        subjects: {
            invitation: 'Invitation: {title}',
            update: 'Updated: {title}',
            cancellation: 'Cancelled: {title}',
            appointment: 'Confirmed: {title}',
            meeting: 'Meeting: {title}',
            response: '{answer}: {title}',
            hostNotification: 'New booking: {title}',
            hostCancellation: 'Cancelled: {title}',
        },
        defaultTitle: 'New event',
        icsIntro: 'You have a confirmed appointment.',
        icsWith: 'With',
        conf: {
            meeting: 'Meeting', join: 'Join', joinMeeting: 'Join the meeting', joinProvider: 'Join the {provider} meeting',
            meetingId: 'Meeting ID', accessCode: 'Access code', dialIn: 'Dial-in', pin: 'PIN',
            unverifiedLink: 'Unverified link', videocall: 'Video call', guestCount: 'Guests',
            reminder: 'Reminder', calendarName: 'Calendar', location: 'Location',
        },
        locale: 'en-US',
    },
};

function inviteLocale(value) {
    return /^en/i.test(String(value == null ? '' : value).trim()) ? 'en' : 'es';
}

/** Texto del diccionario (`a.b.c`) con `{variables}` (sin HTML: el llamador escapa). Clave desconocida => cadena vacia. */
function inviteText(locale, path, vars) {
    let node = INVITE_COPY[inviteLocale(locale)];
    const parts = String(path).split('.');
    for (let i = 0; i < parts.length && node != null; i++) node = node[parts[i]];
    if (typeof node !== 'string') return '';
    return node.replace(/\{(\w+)\}/g, (all, key) => (vars && vars[key] != null ? String(vars[key]) : ''));
}

/** Asunto localizado y SIN CR/LF (un asunto es una cabecera SMTP). kind: invitation|update|cancellation|appointment|meeting|response|hostNotification|hostCancellation */
function inviteSubject(locale, kind, title, vars) {
    const t = inviteLine(title, 160) || inviteText(locale, 'defaultTitle');
    const extra = Object.assign({}, vars || {}, { title: t });
    return inviteLine(inviteText(locale, 'subjects.' + kind, extra), 200) || t;
}

// ─── ICS: PRODID / X-WR-CALNAME con la marca del dominio ─────────────────────────────────────────────────────────

// Nombre de marca apto para un valor TEXT de ICS: una linea, sin control ni < > " \ /, ; y , escapados (RFC 5545 3.3.11),
// acotado a 60 caracteres. Vacio => "Bloom".
function inviteIcsBrand(name) {
    const clean = inviteLine(name, 60).replace(/[<>"]/g, '').replace(/\\/g, '').replace(/\//g, '-').trim() || 'Bloom';
    return clean.replace(/;/g, '\\;').replace(/,/g, '\\,');
}

/** `-//<Marca>//BloomX Calendar//ES|EN` (identificador FPI). Nunca contiene CR/LF ni caracteres de control. */
function inviteProdId(name, locale) {
    return '-//' + inviteIcsBrand(name) + '//BloomX Calendar//' + (inviteLocale(locale) === 'en' ? 'EN' : 'ES');
}

/** Valor de X-WR-CALNAME (nombre del calendario para METHOD:PUBLISH): la marca del dominio, saneada. */
function inviteCalName(name) {
    return inviteIcsBrand(name);
}

// ─── Textos de conferencia (plano) localizados: los usan las extensiones zoom / google-meet / calendar ──────────────

/** Texto plano del aviso de reunion (messageText) en el idioma indicado. o: {topic, joinUrl, meetingId?, passcode?, whenLabel?, guests?} */
function inviteMeetingText(locale, o) {
    o = o || {};
    const t = (path) => inviteText(locale, path);
    return [
        t('conf.meeting') + ': ' + inviteLine(o.topic, 200),
        t('conf.join') + ': ' + inviteLine(o.joinUrl, 2048),
        o.meetingId ? t('conf.meetingId') + ': ' + inviteLine(o.meetingId, 64) : '',
        o.passcode ? t('conf.accessCode') + ': ' + inviteLine(o.passcode, 64) : '',
        o.whenLabel ? t('labels.when') + ': ' + inviteLine(o.whenLabel, 200) : '',
        t('conf.guestCount') + ': ' + (Number(o.guests) || 0),
    ].filter(Boolean).join('\n');
}

/** Lineas de detalle de una conferencia (descripcion del ICS / notas). o: {providerName?, joinUrl, meetingId?, passcode?, dialIn?: [{number,country?,pin?}]} */
function inviteConferenceLines(locale, o) {
    o = o || {};
    const t = (path, vars) => inviteText(locale, path, vars);
    const lines = [(o.providerName ? t('conf.joinProvider', { provider: o.providerName }) : t('conf.joinMeeting')) + ': ' + inviteLine(o.joinUrl, 2048)];
    if (o.meetingId) lines.push(t('conf.meetingId') + ': ' + inviteLine(o.meetingId, 64));
    if (o.passcode) lines.push(t('conf.accessCode') + ': ' + inviteLine(o.passcode, 64));
    const dial = (Array.isArray(o.dialIn) ? o.dialIn : []).filter((d) => d && d.number).slice(0, 3);
    if (dial.length) {
        lines.push(t('conf.dialIn') + ': ' + dial.map((d) => inviteLine(d.number, 40) + (d.country ? ' (' + inviteLine(d.country, 40) + ')' : '') + (d.pin ? ' ' + t('conf.pin') + ' ' + inviteLine(d.pin, 20) : '')).join(' | '));
    }
    return lines;
}

// ─── Fechas ──────────────────────────────────────────────────────────────────────────────────────────────────────

function inviteToDate(value) {
    const d = value instanceof Date ? value : new Date(value);
    return isNaN(d.getTime()) ? null : d;
}

/**
 * "martes, 15 ene 2030, 10:00 a. m. GMT-5 — 11:00 a. m." (mismo dia) o con la fecha de fin si cambia el dia.
 * `timeZone`: IANA (si es invalida se usa UTC). Nunca lanza.
 */
function formatWhenRange(start, end, timeZone, locale) {
    const a = inviteToDate(start);
    const b = inviteToDate(end);
    if (!a) return '';
    const loc = INVITE_COPY[inviteLocale(locale)].locale;
    const make = (opts, tz) => new Intl.DateTimeFormat(loc, Object.assign({ timeZone: tz }, opts));
    const full = { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
    const timeOnly = { hour: 'numeric', minute: '2-digit' };
    const dayKey = { year: 'numeric', month: 'numeric', day: 'numeric' };
    let tz = inviteLine(timeZone, 64) || 'UTC';
    try {
        make(timeOnly, tz);
    } catch (e) {
        tz = 'UTC';
    }
    try {
        const head = make(full, tz).format(a);
        if (!b) return head;
        const sameDay = make(dayKey, tz).format(a) === make(dayKey, tz).format(b);
        return head + ' — ' + (sameDay ? make(timeOnly, tz).format(b) : make(full, tz).format(b));
    } catch (e) {
        return a.toISOString();
    }
}

// ─── Enlaces de reunion (por HOST, sin `new URL`: el sandbox `vm` de las extensiones no lo tiene) ─────────────────
//
// Espejo de src/lib/conferencing/hosts.ts (analyzeMeetingUrl). Si cambias las reglas alli, cambialas aqui
// (src/lib/calendar/__tests__/invite-template.test.ts compara ambas implementaciones con un corpus).
// Regla: solo https, sin credenciales, puerto 443, sin caracteres peligrosos; el proveedor se decide por el HOST
// (igual al dominio o subdominio real), NUNCA con `includes` (zoom.us.evil.com no es Zoom).
const MEET_RULES = [
    { key: 'google-meet', name: 'Google Meet', domains: ['meet.google.com'], path: /^\/(?:[a-z]{3}-[a-z]{4}-[a-z]{3}|lookup\/[A-Za-z0-9_-]+|_meet\/[A-Za-z0-9_-]+)\/?$/i },
    { key: 'zoom', name: 'Zoom', domains: ['zoom.us', 'zoom.com', 'zoomgov.com'], path: /^\/(?:j|s|w|wc|my|meeting)\//i },
    { key: 'teams', name: 'Microsoft Teams', domains: ['teams.microsoft.com', 'teams.live.com', 'teams.microsoft.us'], path: /^\/(?:l\/meetup-join|meet|meeting)\//i },
    { key: 'webex', name: 'Webex', domains: ['webex.com'], path: /^\/(?:meet|join|[^/]+\/j\.php|wbxmjs)/i },
    { key: 'jitsi', name: 'Jitsi Meet', domains: ['meet.jit.si', '8x8.vc'], path: /^\/[^/]{3,}/ },
];

/**
 * @param {*} raw
 * @returns {{url:string, host:string, provider:string, providerName:string, recognized:boolean}|null}
 *   null si NO es un https seguro (entonces no hay boton ni href: se muestra como texto).
 */
function analyzeMeetLink(raw) {
    if (typeof raw !== 'string') return null;
    const text = raw.trim();
    if (!text || text.length > 2048) return null;
    // Solo ASCII imprimible sin espacios, comillas, <, >, \ ni `.
    if (/[^!-~]/.test(text) || /["'<>\\`]/.test(text)) return null;
    const m = /^https:\/\/([^/?#:@]+)(?::(\d+))?(\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$/i.exec(text);
    if (!m) return null; // esquema distinto de https, credenciales (@) o forma invalida
    if (m[2] && m[2] !== '443') return null;
    const host = m[1].toLowerCase().replace(/\.$/, '');
    if (!/^[a-z0-9.-]+$/.test(host) || host.indexOf('.') < 1 || /\.\.|^\.|^-/.test(host)) return null;
    const pathname = m[3] || '/';
    for (let i = 0; i < MEET_RULES.length; i++) {
        const rule = MEET_RULES[i];
        const hostOk = rule.domains.some((d) => host === d || host.endsWith('.' + d));
        if (hostOk && rule.path.test(pathname)) {
            return { url: text, host, provider: rule.key, providerName: rule.name, recognized: true };
        }
    }
    return { url: text, host, provider: 'custom', providerName: host, recognized: false };
}

// Nombre del proveedor para un enlace (por host). 'Videollamada' para cualquier otro valor no nulo.
function getMeetProvider(url) {
    if (!url) return null;
    const info = analyzeMeetLink(url);
    return info && info.recognized ? info.providerName : 'Videollamada';
}

// ─── Modelo: todo lo que se muestra, ya saneado (lo comparten el HTML y el texto plano) ──────────────────────────

function inviteActor(person) {
    if (!person || typeof person !== 'object') return null;
    const email = inviteEmail(person.email);
    const name = inviteLine(person.name, 120);
    if (!email && !name) return null;
    return { name: name && name !== person.email ? name : '', email, label: name && email && name !== email ? name + ' (' + email + ')' : (name || email) };
}

function inviteModel(opts) {
    opts = opts || {};
    const locale = inviteLocale(opts.locale);
    const copy = INVITE_COPY[locale];
    const brand = resolveInviteBrand(opts.brand, opts);
    const type = INVITE_COPY.es.types[opts.type] ? opts.type : 'invitation';
    const title = inviteLine(opts.title, 200) || copy.defaultTitle;

    let whenLabel = opts.whenLabel ? inviteLine(opts.whenLabel, 200) : '';
    if (!whenLabel && opts.when && opts.when.start) {
        whenLabel = formatWhenRange(opts.when.start, opts.when.end, opts.when.timeZone || opts.when.timezone, locale);
    }

    // Enlace de reunion: opts.meetUrl gana; si no, una ubicacion que parezca URL http(s).
    const locText = opts.location == null ? '' : inviteLine(opts.location, 300);
    const rawMeet = opts.meetUrl ? inviteLine(opts.meetUrl, 2048) : (locText && /^https?:\/\//i.test(locText) ? locText : '');
    const meetLink = rawMeet ? analyzeMeetLink(rawMeet) : null;
    const providerName = meetLink && meetLink.recognized ? meetLink.providerName : null;

    const actor = inviteActor(opts.actor) || inviteActor(opts.organizer);
    const organizer = inviteActor(opts.organizer);
    const attendeeList = (Array.isArray(opts.attendees) ? opts.attendees : []).map(inviteActor).filter(Boolean);

    let introKey = type;
    if (type === 'cancellation') introKey = opts.cancelledBy === 'guest' ? 'cancellationGuest' : 'cancellationOrganizer';
    const answer = copy.answers[opts.response] || '';
    const actorText = actor ? actor.label : '';
    let introText = opts.intro ? inviteLine(opts.intro, 300) : '';
    if (!introText && actorText && copy.intro[introKey]) introText = inviteText(locale, 'intro.' + introKey, { actor: actorText, answer });
    const introHtml = opts.intro
        ? escapeHtml(introText)
        : (actorText && copy.intro[introKey]
            ? escapeHtml(copy.intro[introKey]).replace('{actor}', '<strong>' + escapeHtml(actorText) + '</strong>').replace('{answer}', escapeHtml(answer))
            : '');

    let chip = '';
    if (type === 'cancellation') chip = copy.chips.cancelled;
    else if (type === 'response' && copy.chips[opts.response]) chip = copy.chips[opts.response];

    const passcode = opts.passcode ? inviteLine(opts.passcode, 64) : '';
    const dialIn = (Array.isArray(opts.dialIn) ? opts.dialIn : [])
        .filter((d) => d && d.number)
        .slice(0, 6)
        .map((d) => ({
            country: d.country ? inviteLine(d.country, 40) : '',
            number: inviteLine(d.number, 40),
            code: d.code ? inviteLine(d.code, 64) : '',
        }));

    const hint = opts.hint
        ? inviteLine(opts.hint, 400)
        : (opts.hintKey && copy.hints[opts.hintKey] ? copy.hints[opts.hintKey] : '');

    const description = opts.description ? inviteMultiline(opts.description, 2000) : '';

    const secondary = [];
    (Array.isArray(opts.secondaryActions) ? opts.secondaryActions : []).slice(0, 4).forEach((a) => {
        const url = a && safeUrl(a.url);
        const label = a && inviteLine(a.label, 60);
        if (url && label) secondary.push({ url, label });
    });
    const calendarUrl = opts.addToCalendarUrl ? safeUrl(opts.addToCalendarUrl) : null;
    if (calendarUrl) secondary.push({ url: calendarUrl, label: copy.addToCalendar });

    const rsvp = [];
    if (opts.rsvp && typeof opts.rsvp === 'object') {
        [['accept', copy.accept], ['maybe', copy.maybe], ['decline', copy.decline]].forEach((pair) => {
            const url = safeUrl(opts.rsvp[pair[0]]);
            if (url) rsvp.push({ url, label: pair[1] });
        });
    }

    let primary = null;
    if (opts.primaryAction) {
        const url = safeUrl(opts.primaryAction.url);
        const label = inviteLine(opts.primaryAction.label, 60);
        if (url && label) primary = { url, label };
    } else if (meetLink) {
        primary = { url: meetLink.url, label: providerName ? inviteText(locale, 'join', { provider: providerName }) : copy.joinGeneric };
    }

    return {
        locale, copy, brand, type, title, whenLabel, typeLabel: copy.types[type],
        introText, introHtml, chip,
        location: locText, rawMeet, meetLink, providerName,
        passcode, dialIn, organizer, attendeeList, actor,
        description, hint, primary, secondary, rsvp,
        cancelled: type === 'cancellation',
        guestLabelKey: type === 'hostNotification' ? 'guest' : null,
        year: new Date().getFullYear(),
    };
}

// ─── HTML ────────────────────────────────────────────────────────────────────────────────────────────────────────

function inviteStyle(brand, forcedScheme) {
    const n = INVITE_NEUTRAL;
    const dark =
        '.bxm-page{background-color:' + n.darkPage + ' !important}' +
        '.bxm-card{background-color:' + n.darkCard + ' !important}' +
        '.bxm-ink{color:' + n.darkInk + ' !important}' +
        '.bxm-muted{color:' + n.darkMuted + ' !important}' +
        '.bxm-rule{border-color:' + n.darkRule + ' !important}' +
        '.bxm-olink{color:' + brand.colorOnDark + ' !important;border-color:' + brand.colorOnDark + ' !important}' +
        '.bxm-btn{border-color:' + brand.edgeOnDark + ' !important}' +
        '.bxm-band{border:1px solid ' + brand.edgeOnDark + ' !important}' +
        '[data-ogsc] .bxm-olink{color:' + brand.colorOnDark + ' !important}' +
        '[data-ogsc] .bxm-ink{color:' + n.darkInk + ' !important}' +
        '[data-ogsc] .bxm-muted{color:' + n.darkMuted + ' !important}' +
        '[data-ogsb] .bxm-page{background-color:' + n.darkPage + ' !important}' +
        '[data-ogsb] .bxm-card{background-color:' + n.darkCard + ' !important}';
    const small = '@media (max-width:620px){.bxm-pad{padding-left:20px !important;padding-right:20px !important}.bxm-outer{padding:12px 0 !important}}';
    let darkBlock = '@media (prefers-color-scheme:dark){' + dark + '}';
    if (forcedScheme === 'dark') darkBlock = dark;
    if (forcedScheme === 'light') darkBlock = '';
    return small + darkBlock;
}

function inviteRow(label, valueHtml) {
    // Inline styles on every element; classes only mirror them for the dark-mode enhancement.
    const n = INVITE_NEUTRAL;
    return `
      <tr>
        <td class="bxm-rule bxm-muted" width="110" valign="top" style="width:110px;padding:10px 12px 10px 0;border-top:1px solid ${n.rule};font-family:${INVITE_FONT};font-size:13px;line-height:1.5;color:${n.muted};">${escapeHtml(label)}</td>
        <td class="bxm-rule bxm-ink" valign="top" style="padding:10px 0;border-top:1px solid ${n.rule};font-family:${INVITE_FONT};font-size:14px;line-height:1.5;color:${n.ink};">${valueHtml}</td>
      </tr>`;
}

// Boton "a prueba de balas": el color de fondo vive en el <td> (bgcolor) Y en el <a>; funciona sin CSS de clase ni imagenes.
function inviteFilledButton(url, label, brand) {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;margin:0 10px 10px 0;"><tr><td align="center" bgcolor="${brand.color}" style="background-color:${brand.color};border-radius:6px;mso-padding-alt:12px 24px;"><a href="${escapeHtml(url)}" class="bxm-btn" target="_blank" style="display:inline-block;padding:12px 24px;border:1px solid ${brand.edge};border-radius:6px;background-color:${brand.color};font-family:${INVITE_FONT};font-size:15px;font-weight:bold;line-height:1.2;color:${brand.onColor};text-decoration:none;">${escapeHtml(label)}</a></td></tr></table>`;
}

function inviteOutlineButton(url, label, brand) {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;margin:0 10px 10px 0;"><tr><td align="center" style="border-radius:6px;mso-padding-alt:10px 20px;mso-border-alt:1px solid ${brand.linkColor};"><a class="bxm-olink" href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:10px 20px;border:1px solid ${brand.linkColor};border-radius:6px;font-family:${INVITE_FONT};font-size:14px;font-weight:bold;line-height:1.2;color:${brand.linkColor};text-decoration:none;">${escapeHtml(label)}</a></td></tr></table>`;
}

function inviteHeader(m) {
    const n = INVITE_NEUTRAL;
    const b = m.brand;
    const label = escapeHtml(m.typeLabel);
    if (b.logoUrl) {
        const img = `<img src="${escapeHtml(b.logoUrl)}" alt="${escapeHtml(b.name)}" height="40" style="display:block;border:0;outline:none;height:40px;width:auto;max-width:220px;">`;
        const logo = b.url ? `<a href="${escapeHtml(b.url)}" target="_blank" style="text-decoration:none;">${img}</a>` : img;
        return `
            <tr><td height="4" bgcolor="${b.color}" style="height:4px;font-size:0;line-height:0;background-color:${b.color};border-radius:8px 8px 0 0;">&nbsp;</td></tr>
            <tr>
              <td class="bxm-pad" style="padding:20px 32px 4px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
                  <td align="left" valign="middle">${logo}</td>
                  <td align="right" valign="middle" class="bxm-muted" style="font-family:${INVITE_FONT};font-size:12px;line-height:1.4;color:${n.muted};">${label}</td>
                </tr></table>
              </td>
            </tr>`;
    }
    // Sin logo: banda con el color de marca y el nombre en texto (AA: onColor sobre color).
    const name = b.url
        ? `<a href="${escapeHtml(b.url)}" target="_blank" style="color:${b.onColor};text-decoration:none;">${escapeHtml(b.name)}</a>`
        : escapeHtml(b.name);
    return `
            <tr>
              <td class="bxm-pad bxm-band" bgcolor="${b.color}" style="padding:18px 32px;background-color:${b.color};border-radius:8px 8px 0 0;${inviteContrast(b.color, '#ffffff') < 1.5 ? 'border-bottom:1px solid ' + n.rule + ';' : ''}">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
                  <td align="left" valign="middle" style="font-family:${INVITE_FONT};font-size:18px;font-weight:bold;line-height:1.3;color:${b.onColor};">${name}</td>
                  <td align="right" valign="middle" style="font-family:${INVITE_FONT};font-size:12px;line-height:1.4;color:${b.onColor};">${label}</td>
                </tr></table>
              </td>
            </tr>`;
}

/**
 * Render the branded email.
 *
 * @param {Object} opts
 * @param {('invitation'|'update'|'cancellation'|'response'|'meeting'|'appointment'|'hostNotification')} [opts.type]
 * @param {string}  opts.title
 * @param {'es'|'en'} [opts.locale]          Idioma de todos los textos fijos (por defecto es).
 * @param {{name?:string,color?:string,logoUrl?:string,url?:string,footer?:string}} [opts.brand]  Marca de la empresa.
 * @param {string}  [opts.brandName]         (legado) equivale a brand.name.
 * @param {string}  [opts.brandColor]        (legado) equivale a brand.color.
 * @param {string|null}  [opts.whenLabel]    Fecha/hora ya formateada; o bien:
 * @param {{start:Date|string,end?:Date|string,timeZone?:string}|null} [opts.when]  se formatea con locale + zona horaria.
 * @param {string|null}  [opts.location]     Texto libre o URL de reunion.
 * @param {string|null}  [opts.meetUrl]      Enlace de reunion (gana sobre location). Solo un https validado es boton/enlace.
 * @param {string|null}  [opts.passcode]
 * @param {Array<{country?:string,number:string,code?:string}>} [opts.dialIn]
 * @param {string|null}  [opts.description]  Notas (multilinea).
 * @param {Array<{email:string,name?:string|null}>} [opts.attendees]
 * @param {{email:string,name?:string|null}|null}    [opts.organizer]
 * @param {{email:string,name?:string|null}|null}    [opts.actor]   Quien actua (invitado que reserva/cancela/responde). Por defecto el organizador.
 * @param {'organizer'|'guest'} [opts.cancelledBy]   Para type "cancellation": frase del aviso.
 * @param {'accepted'|'declined'|'tentative'} [opts.response]  Para type "response".
 * @param {string} [opts.intro]              Frase de apertura propia (sustituye a la del diccionario).
 * @param {{label:string,url:string}|null}            [opts.primaryAction]
 * @param {Array<{label:string,url:string}>}          [opts.secondaryActions]
 * @param {{accept?:string,maybe?:string,decline?:string}} [opts.rsvp]  URLs de respuesta (botones Aceptar/Quizá/Rechazar).
 * @param {string} [opts.addToCalendarUrl]   Boton "Añadir al calendario".
 * @param {string|null}  [opts.hint]         Nota al pie (texto) o bien
 * @param {string} [opts.hintKey]            clave del diccionario (hints.*).
 * @param {'light'|'dark'} [opts.colorScheme]  Solo vista previa: fuerza la variante clara/oscura.
 * @returns {string} Full HTML document.
 */
function renderInviteEmailHtml(opts) {
    const m = inviteModel(opts);
    const n = INVITE_NEUTRAL;
    const b = m.brand;
    const c = m.copy;
    const linkStyle = `color:${b.linkColor};word-break:break-all;`;

    const rows = [];
    if (m.whenLabel) {
        const when = m.cancelled ? `<span style="text-decoration:line-through;">${escapeHtml(m.whenLabel)}</span>` : escapeHtml(m.whenLabel);
        rows.push(inviteRow(c.labels.when, when));
    }
    if (m.rawMeet) {
        if (m.meetLink) {
            rows.push(inviteRow(c.labels.link, `<a class="bxm-olink" href="${escapeHtml(m.meetLink.url)}" target="_blank" style="${linkStyle}">${escapeHtml(m.providerName || m.meetLink.url)}</a>`));
        } else {
            // Enlace no https / invalido: texto plano, sin <a>.
            rows.push(inviteRow(c.labels.link, `<span style="word-break:break-all;">${escapeHtml(m.rawMeet)}</span>`));
        }
    } else if (m.location) {
        rows.push(inviteRow(c.labels.where, escapeHtml(m.location)));
    }
    if (m.passcode) rows.push(inviteRow(c.labels.passcode, escapeHtml(m.passcode)));
    if (m.dialIn.length) {
        rows.push(inviteRow(c.labels.phone, m.dialIn.map((d) => {
            const country = d.country ? `${escapeHtml(d.country)}: ` : '';
            const code = d.code ? ` &middot; ${escapeHtml(c.labels.code)} ${escapeHtml(d.code)}` : '';
            return `<div style="padding:1px 0;">${country}${escapeHtml(d.number)}${code}</div>`;
        }).join('')));
    }
    const person = (p) => {
        const text = escapeHtml(p.label);
        return p.email ? `<a class="bxm-olink" href="mailto:${escapeHtml(p.email)}" style="color:${b.linkColor};text-decoration:none;">${text}</a>` : text;
    };
    if (m.type === 'hostNotification' && m.actor) {
        rows.push(inviteRow(c.labels.guest, `<div style="padding:1px 0;">${person(m.actor)}</div>`));
    }
    if (m.organizer && m.type !== 'hostNotification') rows.push(inviteRow(c.labels.organizer, `<div style="padding:1px 0;">${person(m.organizer)}</div>`));
    if (m.attendeeList.length) {
        const shown = m.attendeeList.slice(0, 30).map((a) => `<div style="padding:1px 0;">${person(a)}</div>`).join('');
        const more = m.attendeeList.length > 30 ? `<div style="padding:1px 0;">${escapeHtml(inviteText(m.locale, 'labels.more', { n: m.attendeeList.length - 30 }))}</div>` : '';
        rows.push(inviteRow(c.labels.guests, shown + more));
    }
    if (m.description) rows.push(inviteRow(c.labels.notes, inviteMultilineHtml(m.description, 2000)));

    const chip = m.chip
        ? `<span class="bxm-ink bxm-rule" style="display:inline-block;margin:0 0 8px;padding:2px 10px;border:1px solid ${n.muted};border-radius:12px;font-family:${INVITE_FONT};font-size:12px;font-weight:bold;line-height:1.5;color:${n.ink};">${escapeHtml(m.chip)}</span>`
        : '';

    const buttons = [];
    if (m.primary) buttons.push(inviteFilledButton(m.primary.url, m.primary.label, b));
    const rsvpHtml = m.rsvp.length
        ? `<p class="bxm-muted" style="margin:0 0 8px;font-family:${INVITE_FONT};font-size:13px;line-height:1.5;color:${n.muted};">${escapeHtml(c.rsvpTitle)}</p>${m.rsvp.map((r) => inviteOutlineButton(r.url, r.label, b)).join('')}`
        : '';
    const secondaryHtml = m.secondary.map((s) => inviteOutlineButton(s.url, s.label, b)).join('');

    const body = [
        chip ? `<tr><td class="bxm-pad" style="padding:20px 32px 0;">${chip}</td></tr>` : '',
        `<tr><td class="bxm-pad bxm-ink" style="padding:${chip ? '0' : '20px'} 32px 4px;font-family:${INVITE_FONT};font-size:22px;font-weight:bold;line-height:1.3;color:${n.ink};${m.cancelled ? 'text-decoration:line-through;' : ''}">${escapeHtml(m.title)}</td></tr>`,
        m.introHtml ? `<tr><td class="bxm-pad bxm-muted" style="padding:4px 32px 0;font-family:${INVITE_FONT};font-size:14px;line-height:1.6;color:${n.muted};">${m.introHtml}</td></tr>` : '',
        rows.length ? `<tr><td class="bxm-pad" style="padding:16px 32px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">${rows.join('')}</table></td></tr>` : '',
        buttons.length ? `<tr><td class="bxm-pad" style="padding:20px 32px 0;">${buttons.join('')}</td></tr>` : '',
        rsvpHtml ? `<tr><td class="bxm-pad" style="padding:${buttons.length ? '6px' : '20px'} 32px 0;">${rsvpHtml}</td></tr>` : '',
        secondaryHtml ? `<tr><td class="bxm-pad" style="padding:${buttons.length || rsvpHtml ? '6px' : '20px'} 32px 0;">${secondaryHtml}</td></tr>` : '',
        m.hint ? `<tr><td class="bxm-pad bxm-muted" style="padding:16px 32px 0;font-family:${INVITE_FONT};font-size:13px;line-height:1.6;color:${n.muted};">${escapeHtml(m.hint)}</td></tr>` : '',
        `<tr><td height="28" style="height:28px;font-size:0;line-height:0;">&nbsp;</td></tr>`,
    ].join('\n            ');

    const footerText = b.footer ? `${escapeHtml(b.footer)}<br>` : '';
    const preheader = escapeHtml(inviteLine([m.title, m.introText, m.whenLabel].filter(Boolean).join(' · '), 140));

    return `<!DOCTYPE html>
<html lang="${c.htmlLang}" xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <title>${escapeHtml(m.typeLabel)}: ${escapeHtml(m.title)}</title>
    <style type="text/css">${inviteStyle(b, opts && opts.colorScheme)}</style>
  </head>
  <body class="bxm-page" bgcolor="${n.page}" style="margin:0;padding:0;background-color:${n.page};">
    <div style="display:none;max-height:0;max-width:0;overflow:hidden;font-size:1px;line-height:1px;">${preheader}</div>
    <table role="presentation" class="bxm-page" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${n.page}" style="background-color:${n.page};">
      <tr>
        <td class="bxm-outer" align="center" style="padding:24px 12px;">
          <table role="presentation" class="bxm-card" cellpadding="0" cellspacing="0" border="0" width="600" bgcolor="${n.card}" style="width:100%;max-width:600px;background-color:${n.card};border-radius:8px;text-align:left;">
            ${inviteHeader(m)}
            ${body}
          </table>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;">
            <tr>
              <td class="bxm-pad bxm-muted" align="center" style="padding:16px 32px 0;font-family:${INVITE_FONT};font-size:12px;line-height:1.6;color:${n.muted};">${footerText}${escapeHtml(b.name)} &middot; ${m.year}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Version de texto plano con los MISMOS datos e idioma que el HTML (una discrepancia texto/HTML es senal de spam). */
function renderInviteEmailText(opts) {
    const m = inviteModel(opts);
    const c = m.copy;
    const lines = [m.brand.name + ' · ' + m.typeLabel, m.title];
    if (m.introText) lines.push(m.introText);
    lines.push('');
    if (m.whenLabel) lines.push(c.labels.when + ': ' + m.whenLabel);
    if (m.rawMeet) lines.push(c.labels.link + ': ' + m.rawMeet);
    else if (m.location) lines.push(c.labels.where + ': ' + m.location);
    if (m.passcode) lines.push(c.labels.passcode + ': ' + m.passcode);
    m.dialIn.forEach((d) => lines.push(c.labels.phone + ': ' + (d.country ? d.country + ': ' : '') + d.number + (d.code ? ' · ' + c.labels.code + ' ' + d.code : '')));
    if (m.type === 'hostNotification' && m.actor) lines.push(c.labels.guest + ': ' + m.actor.label);
    if (m.organizer && m.type !== 'hostNotification') lines.push(c.labels.organizer + ': ' + m.organizer.label);
    if (m.attendeeList.length) lines.push(c.labels.guests + ': ' + m.attendeeList.map((a) => a.label).join(', '));
    if (m.description) lines.push(c.labels.notes + ': ' + m.description.replace(/\n+/g, ' / '));
    m.secondary.concat(m.rsvp, m.primary ? [m.primary] : []).forEach((a) => lines.push(a.label + ': ' + a.url));
    if (m.hint) lines.push('', m.hint);
    return lines.join('\n');
}

module.exports = {
    inviteProdId, inviteCalName, inviteMeetingText, inviteConferenceLines, inviteReadableOn, inviteContrast,
    escapeHtml, darkenHex, getMeetProvider, analyzeMeetLink, renderInviteEmailHtml, renderInviteEmailText,
    resolveInviteBrand, resolveBrandFromContext, inviteText, inviteSubject, inviteLocale, formatWhenRange,
    INVITE_COPY, INVITE_NEUTRAL,
};
