/**
 * Plantilla UNICA de correos de reuniones/eventos/citas: todas las variantes x es/en x con/sin logo x marcas variadas.
 * Contraste AA, solo colores de marca + paleta neutra fija, sin XSS ni CR/LF, enlaces solo https / host reconocido.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
    INVITE_COPY,
    INVITE_NEUTRAL,
    formatWhenRange,
    inviteSubject,
    renderInviteEmailHtml,
    renderInviteEmailText,
    resolveBrandFromContext,
    resolveInviteBrand,
} from '../invite-template.js';
import { contrast, ensureContrast, readableOnAA } from '@/lib/color';

const TYPES = ['invitation', 'update', 'cancellation', 'response', 'meeting', 'appointment', 'hostNotification'] as const;
const LOCALES = ['es', 'en'] as const;
const LOGO = 'https://cdn.acme.example/logo.png';

// Marcas variadas: muy claras, muy oscuras, saturadas, grises medios, abreviadas e invalidas.
const COLORS = ['#2563eb', '#ffcc00', '#ffffff', '#000000', '#ff0000', '#888888', '#7c3aed', '#fff', '#f5e6c8', '#0a1f44', '#00ff00', 'red', '', '#12345', '#ggg', 'javascript:1'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const base = (over: Record<string, unknown> = {}): any => ({
    type: 'invitation',
    title: 'Revision de roadmap',
    locale: 'es',
    whenLabel: 'martes, 15 ene 2030, 10:00',
    organizer: { email: 'laura@example.com', name: 'Laura' },
    attendees: [{ email: 'ana@example.com', name: 'Ana' }],
    actor: { email: 'ana@example.com', name: 'Ana' },
    meetUrl: 'https://zoom.us/j/123456789',
    passcode: '1234',
    description: 'Traer el informe',
    response: 'accepted',
    hintKey: 'icsInvite',
    ...over,
});

const hexes = (html: string) => Array.from(new Set((html.match(/#[0-9a-f]{6}\b/gi) ?? []).map((h) => h.toLowerCase())));
const attr = (html: string, name: string) => Array.from(html.matchAll(new RegExp(`\\b${name}="([^"]*)"`, 'g'))).map((m) => m[1].replace(/&amp;/g, '&'));

describe('resolveInviteBrand: tono exacto en superficies, contraste por texto', () => {
    for (const color of COLORS) {
        it(`color ${JSON.stringify(color)}: texto sobre la marca, enlace sobre blanco y bordes cumplen su contraste`, () => {
            const b = resolveInviteBrand({ name: 'Acme', color });
            expect(b.color).toMatch(/^#[0-9a-f]{6}$/);
            // Superficie (banda / boton): el texto encima se elige por contraste.
            expect(contrast(b.color, b.onColor)).toBeGreaterThanOrEqual(4.5);
            // Marca usada COMO texto/enlace sobre blanco (tarjeta clara) y sobre la tarjeta oscura.
            expect(contrast(b.linkColor, INVITE_NEUTRAL.card)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(b.colorOnDark, INVITE_NEUTRAL.darkCard)).toBeGreaterThanOrEqual(4.5);
            // Bordes de componentes de interfaz (WCAG 1.4.11).
            expect(contrast(b.edge, INVITE_NEUTRAL.card)).toBeGreaterThanOrEqual(3);
            expect(contrast(b.edgeOnDark, INVITE_NEUTRAL.darkCard)).toBeGreaterThanOrEqual(3);
            expect(b.textAdjusted).toBe(b.linkColor !== b.color);
        });
    }

    it('matriz de pares texto/fondo con marcas amarilla, blanca, negra, saturada y pastel', () => {
        const n = INVITE_NEUTRAL;
        for (const color of ['#ffcc00', '#ffeb3b', '#ffffff', '#000000', '#00ff00', '#ff00ff', '#ffe0f0', '#f5e6c8', '#2563eb', '#888888', '#767676']) {
            const b = resolveInviteBrand({ color });
            expect(b.color, color).toBe(color); // el tono de la marca NO se toca
            const pairs: Array<[string, string, string, number]> = [
                ['onColor / marca (banda y boton)', b.onColor, b.color, 4.5],
                ['linkColor / tarjeta clara', b.linkColor, n.card, 4.5],
                ['linkColor / pagina clara', b.linkColor, n.page, 4.5],
                ['colorOnDark / tarjeta oscura', b.colorOnDark, n.darkCard, 4.5],
                ['colorOnDark / pagina oscura', b.colorOnDark, n.darkPage, 4.5],
                ['ink / tarjeta', n.ink, n.card, 4.5],
                ['muted / tarjeta', n.muted, n.card, 4.5],
                ['muted / pagina', n.muted, n.page, 4.5],
                ['darkInk / tarjeta oscura', n.darkInk, n.darkCard, 4.5],
                ['darkMuted / tarjeta oscura', n.darkMuted, n.darkCard, 4.5],
                ['darkMuted / pagina oscura', n.darkMuted, n.darkPage, 4.5],
                ['edge / tarjeta', b.edge, n.card, 3],
                ['edgeOnDark / tarjeta oscura', b.edgeOnDark, n.darkCard, 3],
            ];
            for (const [label, fg, bg, min] of pairs) expect(contrast(fg, bg), `${color} ${label}`).toBeGreaterThanOrEqual(min);
        }
    });

    it('un amarillo sigue siendo amarillo: banda y boton en el tono exacto; el texto encima es casi negro', () => {
        const b = resolveInviteBrand({ color: '#ffcc00' });
        expect(b.color).toBe('#ffcc00');
        expect(b.onColor).toBe('#0a0a0a');
        expect(b.textAdjusted).toBe(true);
        const html = renderInviteEmailHtml(base({ brand: { name: 'Sol', color: '#ffcc00' }, meetUrl: 'https://zoom.us/j/123456789' }));
        expect(html).toContain('bgcolor="#ffcc00" style="padding:18px 32px;background-color:#ffcc00;');
        expect(html).toContain('background-color:#ffcc00;border-radius:6px;mso-padding-alt:12px 24px;"><a href="https://zoom.us/j/123456789" class="bxm-btn"');
        expect(html).toContain('color:#0a0a0a;text-decoration:none;');
        expect(html).not.toContain(`bgcolor="${b.linkColor}"`);
    });

    it('idempotente y coincide con src/lib/color.ts (paridad de la copia autocontenida)', () => {
        for (const color of COLORS.filter((c) => /^#[0-9a-f]{6}$/i.test(c))) {
            const once = resolveInviteBrand({ color });
            expect(resolveInviteBrand({ color: once.color }).linkColor).toBe(once.linkColor);
            expect(contrast(once.linkColor, '#ffffff')).toBeGreaterThanOrEqual(4.5);
            expect(contrast(ensureContrast(color.toLowerCase(), ['#ffffff'], 4.5), '#ffffff')).toBeGreaterThanOrEqual(4.5);
            expect(once.onColor).toBe(readableOnAA(once.color));
        }
    });

    it('un color que ya cumple AA no se corrige como texto', () => {
        expect(resolveInviteBrand({ color: '#2563EB' }).linkColor).toBe('#2563eb');
        expect(resolveInviteBrand({ color: '#1e3a8a' }).textAdjusted).toBe(false);
    });

    it('nombre/pie: texto plano sin < >, sin control y acotado; logo y sitio solo https', () => {
        const b = resolveInviteBrand({
            name: '<b>Acme</b>\r\nBcc: x@y.z' + 'x'.repeat(200),
            footer: '<script>1</script>\nLinea',
            logoUrl: 'http://evil.example/l.png',
            url: 'javascript:alert(1)',
        });
        expect(b.name).not.toMatch(/[<>\r\n]/);
        expect(b.name.length).toBeLessThanOrEqual(60);
        expect(b.footer).not.toMatch(/[<>\r\n]/);
        expect(b.logoUrl).toBeNull();
        expect(b.url).toBeNull();
        for (const bad of ['https://user:pw@evil.example/l.png', 'https://evil.example:8443/l.png', 'https://localhost/l.png', 'data:image/png;base64,AA', '//evil.example/l.png', 'https://evil.example/a b.png', 'https://evil.example/"x.png']) {
            expect(resolveInviteBrand({ logoUrl: bad }).logoUrl, bad).toBeNull();
        }
        expect(resolveInviteBrand({ logoUrl: LOGO }).logoUrl).toBe(LOGO);
    });

    it('sin marca: comportamiento historico (Bloom, azul)', () => {
        const b = resolveInviteBrand(undefined);
        expect(b.name).toBe('Bloom');
        expect(b.color).toBe('#2563eb');
    });

    it('resolveBrandFromContext (extensiones): ctx.brand > domain.displayName > env > Bloom; se vuelve a sanear', () => {
        expect(resolveBrandFromContext({ brand: { name: 'Acme', color: '#7c3aed', locale: 'en' }, domain: { displayName: 'Otro' } })).toMatchObject({ name: 'Acme', color: '#7c3aed', locale: 'en' });
        expect(resolveBrandFromContext({ domain: { displayName: 'Universidad' } })).toMatchObject({ name: 'Universidad', locale: null });
        expect(resolveBrandFromContext({ env: { NEXT_PUBLIC_BRAND_NAME: 'Envco' } }).name).toBe('Envco');
        expect(resolveBrandFromContext(null).name).toBe('Bloom');
        const hostile = resolveBrandFromContext({ brand: { name: '<i>x</i>', color: 'url(x)', logoUrl: 'http://x.example/a.png', locale: 'fr' } });
        expect(hostile.name).not.toMatch(/[<>]/);
        expect(hostile.logoUrl).toBeNull();
        expect((hostile as { locale?: string | null }).locale).toBeNull();
        expect(contrast(hostile.linkColor, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    });
});

describe('variantes x idiomas x logo x marcas', () => {
    for (const type of TYPES) {
        for (const locale of LOCALES) {
            for (const withLogo of [false, true]) {
                it(`${type} / ${locale} / ${withLogo ? 'con' : 'sin'} logo: estructura, idioma y colores`, () => {
                    for (const color of ['#2563eb', '#ffcc00', '#ffffff', '#0a1f44', '#888888', 'invalido']) {
                        const brand = { name: 'Acme', color, logoUrl: withLogo ? LOGO : undefined, footer: 'Av. Principal 123' };
                        const html = renderInviteEmailHtml(base({ type, locale, brand }));
                        const b = resolveInviteBrand(brand);

                        expect(html).toContain(`<html lang="${locale}"`);
                        expect(html).toContain(INVITE_COPY[locale].types[type]);
                        expect(html).toContain('role="presentation"');
                        expect(html).toContain('width="600"');
                        expect(html).toContain('Av. Principal 123');
                        expect(html).not.toMatch(/undefined|\[object|NaN|\{actor\}|\{answer\}|\{provider\}/);

                        // Logo: <img> con texto alternativo = nombre de marca; sin logo, la cabecera lleva el nombre como texto.
                        if (withLogo) expect(html).toContain(`<img src="${LOGO}" alt="Acme"`);
                        else expect(html).not.toContain('<img');
                        expect(html).toContain('Acme');

                        // Solo colores de marca (AA) + paleta neutra fija.
                        const allowed = new Set<string>([...Object.values(INVITE_NEUTRAL), b.color, b.onColor, b.linkColor, b.colorOnDark, b.edge, b.edgeOnDark].map((c) => c.toLowerCase()));
                        expect(hexes(html).filter((h) => !allowed.has(h))).toEqual([]);

                        // Boton principal (Unirse / CTA): fondo de marca con texto legible AA.
                        if (html.includes(`bgcolor="${b.color}" style="background-color:${b.color};border-radius:6px;mso-padding-alt:12px 24px;"`)) {
                            expect(contrast(b.color, b.onColor)).toBeGreaterThanOrEqual(4.5);
                        }
                        // Cabecera sin logo: banda con el tono EXACTO de la marca y el nombre en onColor.
                        if (!withLogo) expect(html).toContain(`background-color:${b.color};border-radius:8px 8px 0 0;`);
                        // Enlaces y contornos (texto de marca sobre blanco) usan la version corregida.
                        if (html.includes('class="bxm-olink"')) expect(html).toContain(`color:${b.linkColor};`);
                    }
                });
            }
        }
    }

    it('el idioma no se mezcla: es no lleva etiquetas en ingles y en no lleva etiquetas en espanol', () => {
        const common = { organizer: { email: 'l@example.com', name: 'Laura' }, attendees: [{ email: 'a@example.com', name: 'Ana' }], description: 'x', passcode: '1', dialIn: [{ number: '+1', code: '2' }], meetUrl: 'https://zoom.us/j/123456789', whenLabel: 'L 10:00', rsvp: { accept: 'https://a.example.com/y', maybe: 'https://a.example.com/m', decline: 'https://a.example.com/n' }, addToCalendarUrl: 'https://a.example.com/ics', hintKey: 'icsInvite' };
        const es = renderInviteEmailHtml(base({ ...common, locale: 'es' })).replace(/<style[\s\S]*?<\/style>/, '');
        const en = renderInviteEmailHtml(base({ ...common, locale: 'en' })).replace(/<style[\s\S]*?<\/style>/, '');
        for (const word of ['Cuándo', 'Enlace', 'Contraseña', 'Teléfono', 'Organizador', 'Invitados', 'Notas', 'Unirse a Zoom', 'Aceptar', 'Rechazar', 'Quizá', 'Añadir al calendario', 'Invitación']) expect(es, word).toContain(word);
        for (const word of ['When', 'Link', 'Passcode', 'Phone', 'Organizer', 'Guests', 'Notes', 'Join Zoom', 'Accept', 'Decline', 'Maybe', 'Add to calendar', 'Invitation']) expect(en, word).toContain(word);
        for (const word of ['Cuándo', 'Invitados', 'Unirse', 'Aceptar', 'Contraseña']) expect(en, word).not.toContain(word);
        for (const word of ['>When<', '>Guests<', 'Join Zoom', '>Accept<', '>Passcode<']) expect(es, word).not.toContain(word);
    });

    it('idioma desconocido => es; el texto plano sale en el mismo idioma que el HTML', () => {
        expect(renderInviteEmailHtml(base({ locale: 'fr' }))).toContain('<html lang="es"');
        const txtEn = renderInviteEmailText(base({ locale: 'en', type: 'hostNotification' }));
        const txtEs = renderInviteEmailText(base({ locale: 'es', type: 'hostNotification' }));
        expect(txtEn).toContain('New booking');
        expect(txtEn).toContain('has booked an appointment with you');
        expect(txtEs).toContain('Nueva reserva');
        expect(txtEs).toContain('ha reservado una cita contigo');
    });

    it('hostNotification: invitado (enlace mailto), cuando, notas y sin fila Organizador', () => {
        const html = renderInviteEmailHtml(base({ type: 'hostNotification', locale: 'en', organizer: undefined, attendees: undefined, description: 'Linea 1\nLinea 2' }));
        expect(html).toContain('href="mailto:ana@example.com"');
        expect(html).toContain('Linea 1<br>Linea 2');
        expect(html).toContain('>Guest<');
        expect(html).not.toContain('>Organizer<');
        expect(html).not.toContain('Cancel');
    });

    it('cancellation: chip Cancelado, fecha tachada; aviso de invitado vs organizador', () => {
        const org = renderInviteEmailHtml(base({ type: 'cancellation', locale: 'es' }));
        expect(org).toContain('>Cancelado<');
        expect(org).toContain('text-decoration:line-through');
        expect(org).toContain('ha cancelado este evento');
        const guest = renderInviteEmailHtml(base({ type: 'cancellation', cancelledBy: 'guest', locale: 'en' }));
        expect(guest).toContain('has cancelled their appointment');
        expect(guest).toContain('>Cancelled<');
    });

    it('response (RSVP): chip con la respuesta y frase localizada', () => {
        expect(renderInviteEmailHtml(base({ type: 'response', response: 'declined', locale: 'es' }))).toContain('ha rechazado tu invitación');
        expect(renderInviteEmailHtml(base({ type: 'response', response: 'tentative', locale: 'en' }))).toContain('has replied &quot;maybe&quot; to your invitation');
        expect(renderInviteEmailHtml(base({ type: 'response', response: 'accepted', locale: 'en' }))).toContain('>Accepted<');
    });

    it('botones RSVP y "Añadir al calendario": solo con URL segura', () => {
        const html = renderInviteEmailHtml(base({ rsvp: { accept: 'https://a.example.com/y', decline: 'javascript:alert(1)' }, addToCalendarUrl: 'http://evil.example/x.ics' }));
        expect(html).toContain('>Aceptar</a>');
        expect(html).not.toContain('>Rechazar</a>');
        expect(html).not.toContain('Añadir al calendario');
    });

    it('modo oscuro: por defecto con media query; forzado (vista previa) sin ella; claro forzado sin reglas oscuras', () => {
        const auto = renderInviteEmailHtml(base());
        expect(auto).toContain('@media (prefers-color-scheme:dark){');
        expect(auto).toContain('<meta name="color-scheme" content="light dark">');
        const dark = renderInviteEmailHtml(base({ colorScheme: 'dark' }));
        expect(dark).not.toContain('prefers-color-scheme');
        expect(dark).toContain(`.bxm-card{background-color:${INVITE_NEUTRAL.darkCard} !important}`);
        const light = renderInviteEmailHtml(base({ colorScheme: 'light' }));
        expect(light).not.toContain(INVITE_NEUTRAL.darkCard);
        // Con o sin el <style> el HTML lleva colores explicitos (clientes que lo descartan siguen legibles).
        expect(auto.replace(/<style[\s\S]*?<\/style>/, '')).toContain(`background-color:${INVITE_NEUTRAL.card}`);
    });

    it('todo texto pasa por el diccionario: es y en tienen las mismas claves', () => {
        const keys = (o: unknown, p = ''): string[] => Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
        expect(keys(INVITE_COPY.en)).toEqual(keys(INVITE_COPY.es));
    });
});

describe('seguridad: XSS, CR/LF y enlaces', () => {
    const LS = String.fromCharCode(0x2028);
    const evil = {
        title: '<script>alert(1)</script>"><img src=x onerror=alert(1)>\r\nBcc: evil@example.com',
        description: '<svg onload=alert(1)>\r\nBcc: evil@example.com\n\n\n\nfin' + LS + 'X',
        passcode: '"><b>1</b>',
        location: '<iframe src=javascript:alert(1)>',
        organizer: { email: 'a@b.co"><script>x</script>', name: '<b>Org</b>\r\nBcc: x@y.z' },
        attendees: [{ email: 'javascript:alert(1)', name: '"><script>y</script>' }, { email: 'ok@example.com', name: 'Ok\r\nSubject: hacked' }],
        actor: { email: 'x@y.co', name: '<img src=x onerror=1>' },
        brand: { name: '<script>brand</script>\r\nBcc: x', color: '#fff;}</style><script>1</script>', logoUrl: 'https://evil.example/l.png"onerror="alert(1)', url: 'javascript:alert(1)', footer: '<img src=x>\nBcc: z' },
        primaryAction: { label: '<b>go</b>', url: 'javascript:alert(1)' },
        secondaryActions: [{ label: 'x', url: 'data:text/html,<script>1</script>' }, { label: 'ok', url: 'https://app.example.com/cancel?a=1&b=2' }],
        rsvp: { accept: 'https://a.example.com/"><script>1</script>' },
    };

    for (const type of TYPES) {
        for (const locale of LOCALES) {
            it(`${type}/${locale}: datos hostiles no inyectan etiquetas, atributos ni cabeceras`, () => {
                const html = renderInviteEmailHtml({ ...base({ type, locale }), ...evil });
                const text = renderInviteEmailText({ ...base({ type, locale }), ...evil });
                const visible = html.replace(/<style[\s\S]*?<\/style>/, '');

                // Solo etiquetas de la plantilla (los datos llegan escapados como texto: "&lt;script&gt;" no es una etiqueta).
                const tags = Array.from(visible.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g));
                const allowedTags = new Set(['html', 'head', 'meta', 'title', 'body', 'div', 'table', 'tr', 'td', 'a', 'img', 'span', 'strong', 'br', 'p']);
                expect(tags.filter((m) => !allowedTags.has(m[1].toLowerCase())).map((m) => m[1])).toEqual([]);
                for (const m of tags) {
                    expect(m[2], m[0]).not.toMatch(/\son[a-z]+\s*=/i);
                    expect(m[2], m[0]).not.toMatch(/javascript:/i);
                }
                expect(tags.filter((m) => m[1].toLowerCase() === 'img').length).toBeLessThanOrEqual(1);
                expect(html).not.toMatch(/href="javascript:|src="javascript:/i);
                expect(html).not.toContain('<b>Org</b>');
                // CR/LF: ningun valor de usuario puede abrir una linea nueva ("Bcc:" solo aparece pegado a texto, nunca al inicio de linea).
                expect(html).not.toMatch(/(^|[\r\n])\s*(Bcc|Subject):/);
                expect(text).not.toMatch(/(^|[\r\n])(Bcc|Subject):/);
                expect(html).not.toContain(LS);
                expect(html).not.toContain('\r');
                // Cada href/src es https, mailto o localhost.
                for (const url of [...attr(html, 'href'), ...attr(html, 'src')]) expect(url).toMatch(/^(https:\/\/|mailto:[^\s"<>]+$)/);
                // El correo malformado no se convierte en mailto.
                expect(html).not.toContain('href="mailto:javascript');
                expect(html).not.toContain('a@b.co"&gt;');
            });
        }
    }

    it('asuntos: sin CR/LF ni separadores unicode, acotados y localizados', () => {
        const hostile = `Hola\r\nBcc: x@y.z${LS}fin` + 'x'.repeat(500);
        for (const locale of LOCALES) {
            for (const kind of ['invitation', 'update', 'cancellation', 'appointment', 'meeting', 'response', 'hostNotification', 'hostCancellation']) {
                const subject = inviteSubject(locale, kind, hostile, { answer: 'Aceptó\r\nX' });
                expect(subject).not.toMatch(/[\r\n\u2028\u2029]/);
                expect(subject.length).toBeLessThanOrEqual(200);
                expect(subject).toContain('Hola');
            }
        }
        expect(inviteSubject('es', 'cancellation', 'Demo')).toBe('Cancelado: Demo');
        expect(inviteSubject('en', 'cancellation', 'Demo')).toBe('Cancelled: Demo');
        expect(inviteSubject('en', 'hostNotification', 'Ana — Demo')).toBe('New booking: Ana — Demo');
    });

    it('enlaces de reunion: boton solo con https validado por HOST exacto; el resto, texto', () => {
        const cases: Array<[string, boolean, string?]> = [
            ['https://meet.google.com/abc-defg-hij', true, 'Google Meet'],
            ['https://acme.zoom.us/j/123456789', true, 'Zoom'],
            ['https://teams.microsoft.com/l/meetup-join/x', true, 'Microsoft Teams'],
            ['https://sala.empresa.pe/reunion', true],
            ['http://meet.google.com/abc-defg-hij', false],
            ['https://meet.google.com@evil.com/abc-defg-hij', false],
            ['https://zoom.us.evil.com/j/123456789', true], // https valido pero host NO reconocido: boton generico, nunca "Zoom"
            ['javascript:alert(1)', false],
            ['https://user:pw@zoom.us/j/1', false],
            ['https://zoom.us:8443/j/1', false],
        ];
        for (const [url, button, provider] of cases) {
            const html = renderInviteEmailHtml(base({ meetUrl: url, locale: 'en' }));
            if (!button) {
                expect(html, url).not.toContain('>Join');
                expect(html, url).not.toContain(`href="${url}"`);
            } else if (provider) {
                expect(html, url).toContain(`>Join ${provider}</a>`);
            } else {
                expect(html, url).toContain('>Join the meeting</a>');
                expect(html, url).not.toContain('Join Zoom');
            }
        }
    });

    it('mailto con parametros y URLs localhost de desarrollo se aceptan; http remoto no', () => {
        const ok = renderInviteEmailHtml(base({ secondaryActions: [{ label: 'Dev', url: 'http://localhost:3000/book/1/cancel/t' }, { label: 'Mail', url: 'mailto:a@b.co?subject=x' }] }));
        expect(ok).toContain('href="http://localhost:3000/book/1/cancel/t"');
        expect(ok).toContain('href="mailto:a@b.co?subject=x"');
        const bad = renderInviteEmailHtml(base({ secondaryActions: [{ label: 'Remoto', url: 'http://evil.example/x' }] }));
        expect(bad).not.toContain('>Remoto</a>');
    });
});

describe('fechas por idioma y zona horaria', () => {
    const start = new Date('2030-01-15T15:00:00Z');
    const end = new Date('2030-01-15T16:30:00Z');

    it('respeta locale y zona horaria del evento', () => {
        const es = formatWhenRange(start, end, 'America/Lima', 'es');
        const en = formatWhenRange(start, end, 'America/Lima', 'en');
        expect(es).toMatch(/martes/i);
        expect(en).toMatch(/Tuesday/);
        expect(es).toContain('10:00');
        expect(en).toContain('10:00');
        expect(formatWhenRange(start, end, 'Asia/Tokyo', 'en')).toMatch(/Wednesday/);
        expect(formatWhenRange(start, end, 'Europe/Madrid', 'es')).toMatch(/4:00/);
    });

    it('zona invalida => UTC; fecha invalida => vacio; fin en otro dia => fecha completa del fin', () => {
        expect(formatWhenRange(start, end, 'No/Existe', 'en')).toContain('3:00');
        expect(formatWhenRange('no-es-fecha', end, 'UTC', 'es')).toBe('');
        const next = new Date('2030-01-16T15:00:00Z');
        expect(formatWhenRange(start, next, 'UTC', 'en')).toMatch(/Jan 15.*Jan 16/);
    });

    it('when {start,end,timeZone} se formatea dentro de la plantilla con el idioma del correo', () => {
        const html = renderInviteEmailHtml(base({ whenLabel: undefined, when: { start, end, timeZone: 'America/Lima' }, locale: 'en' }));
        expect(html).toContain('Tuesday');
        expect(html).toContain('10:00');
    });
});

describe('copias de las extensiones', () => {
    it('sync-invite-template.mjs --check: las copias inlined coinciden con la fuente unica', () => {
        const script = path.resolve(__dirname, '../../../../../bloomx-extensions/_shared/sync-invite-template.mjs');
        if (!existsSync(script)) return; // repo hermano ausente
        expect(() => execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' })).not.toThrow();
    });
});
