import { describe, expect, it } from 'vitest';
import { evaluateSpam } from '../engine';
import type { RecipientContext, SpamInput } from '../types';
import { SIGNAL_IDS, explainSignal } from '../reasons';

const OWN = ['bloomx.test'];
const NOW = new Date('2026-05-04T10:00:00Z');
const auth = (o: { spf?: string; dkim?: string; dmarc?: string; d?: string; from?: string; env?: string } = {}) =>
    `mx.bloomx.test; spf=${o.spf ?? 'pass'} smtp.mailfrom=${o.env ?? o.from ?? 'sender.example'}; dkim=${o.dkim ?? 'pass'} header.d=${o.d ?? o.from ?? 'sender.example'}; dmarc=${o.dmarc ?? 'pass'} header.from=${o.from ?? 'sender.example'}`;

function mk(o: Partial<SpamInput> & { hdr?: Record<string, unknown> } = {}): SpamInput {
    const { hdr, ...rest } = o;
    return {
        headers: { 'authentication-results': auth(), 'message-id': '<a1@sender.example>', date: 'Mon, 04 May 2026 09:00:00 +0000', received: ['from mail.sender.example ([203.0.113.9]) by mx.bloomx.test'], ...(hdr ?? {}) },
        from: { name: 'Ana Ruiz', email: 'ana@sender.example' },
        subject: 'Reunión', text: 'Hola, nos vemos mañana para revisar el proyecto con calma.', html: '', attachments: [], recipients: ['u@bloomx.test'], now: NOW,
        ...rest,
    };
}
const ids = (i: SpamInput, ctx?: RecipientContext, cfg = {}) => evaluateSpam(i, { ownDomains: OWN, ...cfg }, ctx).signals.map((s) => s.id);
const has = (i: SpamInput, id: string, ctx?: RecipientContext) => ids(i, ctx).includes(id);

describe('correo limpio', () => {
    it('no dispara ninguna senal grave', () => {
        const r = evaluateSpam(mk(), { ownDomains: OWN });
        expect(r.score).toBeLessThan(10);
        expect(r.signals.filter((s) => s.weight > 0)).toEqual([]);
    });
});

describe('autenticacion', () => {
    it('DMARC/SPF/DKIM fail', () => {
        const i = mk({ hdr: { 'authentication-results': auth({ spf: 'fail', dkim: 'fail', dmarc: 'fail' }) } });
        expect(ids(i)).toEqual(expect.arrayContaining(['auth.dmarc_fail', 'auth.spf_fail', 'auth.dkim_fail']));
    });
    it('softfail, neutral y permerror', () => {
        expect(has(mk({ hdr: { 'authentication-results': auth({ spf: 'softfail' }) } }), 'auth.spf_softfail')).toBe(true);
        expect(has(mk({ hdr: { 'authentication-results': auth({ spf: 'neutral' }) } }), 'auth.spf_neutral')).toBe(true);
        expect(has(mk({ hdr: { 'authentication-results': auth({ spf: 'permerror' }) } }), 'auth.spf_error')).toBe(true);
    });
    it('sin Authentication-Results: auth.none; con todo none: no_results', () => {
        expect(has(mk({ hdr: { 'authentication-results': undefined } }), 'auth.none')).toBe(true);
        expect(has(mk({ hdr: { 'authentication-results': 'mx; spf=none; dkim=none; dmarc=none' } }), 'auth.no_results')).toBe(true);
    });
    it('alineacion: DKIM pasa pero con otro dominio y sin DMARC pass', () => {
        const i = mk({ hdr: { 'authentication-results': 'mx; spf=pass smtp.mailfrom=esp.example; dkim=pass header.d=esp.example' } });
        expect(has(i, 'auth.not_aligned')).toBe(true);
        const aligned = mk({ hdr: { 'authentication-results': 'mx; spf=pass smtp.mailfrom=bounce.sender.example; dkim=pass header.d=sender.example' } });
        expect(has(aligned, 'auth.not_aligned')).toBe(false);
    });
    it('DMARC pass resta salvo en correo gratuito; ARC', () => {
        expect(has(mk(), 'auth.dmarc_pass')).toBe(true);
        expect(has(mk({ from: { name: 'Ana', email: 'ana@gmail.com' }, hdr: { 'authentication-results': auth({ from: 'gmail.com' }) } }), 'auth.dmarc_pass')).toBe(false);
        expect(has(mk({ hdr: { 'authentication-results': 'mx; spf=fail; dkim=pass header.d=sender.example; dmarc=pass; arc=fail' } }), 'auth.arc_fail')).toBe(true);
        expect(has(mk({ hdr: { 'authentication-results': 'mx; spf=fail; dkim=fail; dmarc=fail; arc=pass' } }), 'auth.arc_pass')).toBe(true);
    });
});

describe('cabeceras', () => {
    it('Message-ID ausente o de otro dominio', () => {
        expect(has(mk({ hdr: { 'message-id': undefined } }), 'hdr.msgid_missing')).toBe(true);
        expect(has(mk({ hdr: { 'message-id': '<x@otro.example>' } }), 'hdr.msgid_mismatch')).toBe(true);
    });
    it('fecha ausente, invalida y futura', () => {
        expect(has(mk({ hdr: { date: undefined } }), 'hdr.date_missing')).toBe(true);
        expect(has(mk({ hdr: { date: 'no es fecha' } }), 'hdr.date_invalid')).toBe(true);
        expect(has(mk({ hdr: { date: 'Mon, 04 May 2027 09:00:00 +0000' } }), 'hdr.date_future')).toBe(true);
    });
    it('Reply-To de otro dominio y sobre distinto', () => {
        expect(has(mk({ hdr: { 'reply-to': 'x@otro.example' } }), 'hdr.replyto_mismatch')).toBe(true);
        expect(has(mk({ hdr: { 'return-path': '<b@otro.example>', 'authentication-results': 'mx; spf=pass smtp.mailfrom=otro.example; dkim=none' } }), 'hdr.envelope_mismatch')).toBe(true);
    });
    it('Received con IP literal o anomalo', () => {
        expect(has(mk({ hdr: { received: ['from [203.0.113.7] by mx'] } }), 'hdr.received_ip')).toBe(true);
        expect(has(mk({ hdr: { received: ['from localhost (unknown [1.2.3.4]) by mx'] } }), 'hdr.received_odd')).toBe(true);
    });
    it('X-Mailer sospechoso, muchos destinatarios, bulk sin baja, baja presente', () => {
        expect(has(mk({ hdr: { 'x-mailer': 'Atomic Mail Sender 8' } }), 'hdr.mailer')).toBe(true);
        const many = Array.from({ length: 25 }, (_, i) => `u${i}@x.test`).join(', ');
        expect(has(mk({ hdr: { to: many } }), 'hdr.recipients')).toBe(true);
        expect(has(mk({ hdr: { precedence: 'bulk' } }), 'hdr.bulk_no_unsub')).toBe(true);
        const unsub = evaluateSpam(mk({ hdr: { precedence: 'bulk', 'list-unsubscribe': '<mailto:u@x>' } }), { ownDomains: OWN });
        expect(unsub.signals.map((s) => s.id)).toContain('hdr.list_unsub');
        expect(unsub.signals.map((s) => s.id)).not.toContain('hdr.bulk_no_unsub');
        expect(unsub.category).toBe('promotional');
    });
    it('dominio de remitente con TLD de riesgo', () => {
        expect(has(mk({ from: { name: 'X', email: 'x@promo-1234.xyz' } }), 'hdr.from_risky_tld')).toBe(true);
    });
    it('X-Spam-* del origen es una senal mas', () => {
        expect(has(mk({ hdr: { 'x-spam-flag': 'YES' } }), 'origin.xspam')).toBe(true);
        expect(has(mk({ hdr: { 'x-spam-score': '4.0' } }), 'origin.xspam_partial')).toBe(true);
        expect(ids(mk({ hdr: { 'x-spam-score': '0.5' } }))).not.toContain('origin.xspam_partial');
    });
});

describe('contenido', () => {
    const body = (t: string) => mk({ subject: 'Aviso', text: t });
    it('lexico multilingue: es, en y pt', () => {
        expect(has(body('Verifique su cuenta ahora: su contraseña ha caducado.'), 'content.lex.phishing')).toBe(true);
        expect(has(body('Your account has been suspended, verify your account now.'), 'content.lex.phishing')).toBe(true);
        expect(has(body('Sua conta foi suspensa, confirme sua identidade.'), 'content.lex.phishing')).toBe(true);
        expect(has(body('You have won the lottery, claim your prize'), 'content.lex.fraud')).toBe(true);
        expect(has(body('Compra viagra sin receta médica'), 'content.lex.pharma')).toBe(true);
        expect(has(body('Casino en línea: giros gratis y bono sin depósito'), 'content.lex.gambling')).toBe(true);
        expect(has(body('Factura adjunta, pago pendiente'), 'content.lex.invoice')).toBe(true);
        expect(has(body('Guaranteed returns with bitcoin'), 'content.lex.crypto')).toBe(true);
        expect(has(body('Buy gift cards and send me the codes'), 'content.lex.bec')).toBe(true);
    });
    it('el lexico ve a traves de acentos, homoglifos y letras separadas', () => {
        expect(has(body('V i a g r a barato'), 'content.lex.pharma')).toBe(true);
        expect(has(body('vіagra sin receta'), 'content.lex.pharma')).toBe(true); // i cirilica
        expect(has(body('Verífíque su cuenta'), 'content.lex.phishing')).toBe(true);
    });
    it('mayusculas y exclamaciones', () => {
        expect(has(mk({ subject: 'GRAN OFERTA SOLO HOY' }), 'content.subject_caps')).toBe(true);
        expect(has(mk({ subject: 'Hola!!!' }), 'content.subject_exclaim')).toBe(true);
        expect(has(body('COMPRA YA '.repeat(20)), 'content.body_caps')).toBe(true);
        expect(has(body('Increible!!! oferta'), 'content.body_exclaim')).toBe(true);
    });
    it('texto oculto grande, pero no el preheader corto', () => {
        const long = 'x'.repeat(400);
        expect(has(mk({ text: '', html: `<p>Hola</p><div style="display:none">${long}</div>` }), 'content.hidden_text')).toBe(true);
        expect(has(mk({ text: '', html: '<p>Hola qué tal, esto es un boletín</p><div style="display:none">Vista previa corta</div>' }), 'content.hidden_text')).toBe(false);
        expect(has(mk({ text: '', html: `<p>Hola</p><span style="color:#ffffff">${'palabra '.repeat(20)}</span>` }), 'content.hidden_text')).toBe(true);
    });
    it('correo solo imagen', () => {
        expect(has(mk({ text: '', html: '<a href="https://x.example/a"><img src="https://x.example/i.jpg"></a>' }), 'content.image_only')).toBe(true);
    });
    it('base64 enorme en el cuerpo (no en data: URI)', () => {
        expect(has(mk({ text: 'QUJD'.repeat(500) }), 'content.base64')).toBe(true);
        expect(has(mk({ text: '', html: `<p>Hola mundo, texto normal aquí</p><img src="data:image/png;base64,${'QUJD'.repeat(500)}">` }), 'content.base64')).toBe(false);
    });
    it('ofuscacion: homoglifos, ancho cero y texto partido', () => {
        expect(has(mk({ subject: 'Рayраl aviso' }), 'content.homoglyph')).toBe(true);
        expect(has(mk({ text: 'ha​l​l​o​ mundo' }), 'content.zero_width')).toBe(true);
        expect(has(mk({ text: 'f r e e  m o n e y  n o w' }), 'content.spaced')).toBe(true);
    });
    it('asunto codificado sin necesidad', () => {
        const enc = `=?UTF-8?B?${Buffer.from('Special offer inside just for you').toString('base64')}?=`;
        expect(has(mk({ hdr: { subject: enc } }), 'content.subject_encoded')).toBe(true);
        const real = `=?UTF-8?B?${Buffer.from('Reunión de mañana').toString('base64')}?=`;
        expect(has(mk({ hdr: { subject: real } }), 'content.subject_encoded')).toBe(false);
    });
    it('HTML roto y razon texto/HTML', () => {
        expect(has(mk({ text: '', html: '<div><table><tr><td><span><font>' .repeat(14) + 'hola'.repeat(20) }), 'content.html_broken')).toBe(true);
        expect(has(mk({ text: '', html: `<p>hola</p>${'<!-- x -->' + '<br>'.repeat(1) + ' '.repeat(1)}${'<p style="margin:0"></p>'.repeat(400)}` }), 'content.html_ratio')).toBe(true);
    });
    it('densidad: muchas frases de spam a la vez', () => {
        const t = 'Viagra, cialis, sin receta, farmacia online, adelgaza rapido, compra ahora, 100% gratis, sin riesgo, oferta unica';
        expect(has(body(t), 'content.density')).toBe(true);
    });
});

describe('enlaces', () => {
    const link = (href: string, text = 'aqui') => mk({ text: '', html: `<p>Mire este enlace de prueba con bastante texto alrededor</p><a href="${href}">${text}</a>` });
    it('host IP (decimal y hexadecimal)', () => {
        expect(has(link('http://203.0.113.9/login'), 'link.ip_host')).toBe(true);
        expect(has(link('http://0x7f000001/x'), 'link.ip_host')).toBe(true);
    });
    it('punycode y homografo', () => {
        expect(has(link('https://xn--caf-dma.example/'), 'link.punycode')).toBe(true);
        expect(has(link('https://xn--pypal-4ve.com/login'), 'link.homograph')).toBe(true);
    });
    it('acortadores, TLD de riesgo, puerto raro, credenciales embebidas', () => {
        expect(has(link('https://bit.ly/abc123'), 'link.shortener')).toBe(true);
        expect(has(link('https://oferta.xyz/a'), 'link.risky_tld')).toBe(true);
        expect(has(link('https://shop.example:8443/a'), 'link.odd_port')).toBe(true);
        expect(has(link('https://paypal.com@evil.example/a'), 'link.userinfo')).toBe(true);
    });
    it('texto del enlace muestra un dominio y el href va a otro', () => {
        expect(has(link('https://evil.example/a', 'www.paypal.com'), 'link.text_mismatch')).toBe(true);
        expect(has(link('https://click.sendgrid.net/a', 'www.tienda.example'), 'link.text_mismatch_soft')).toBe(true);
        expect(has(link('https://www.tienda.example/a', 'tienda.example'), 'link.text_mismatch')).toBe(false);
    });
    it('exceso de enlaces y redireccion larga', () => {
        const many = Array.from({ length: 30 }, (_, i) => `<a href="https://s${i}.example/x">l${i}</a>`).join('');
        expect(has(mk({ text: '', html: `<p>lista de enlaces con texto suficiente</p>${many}` }), 'link.many')).toBe(true);
        expect(has(link(`https://r.example/go?u=https%3A%2F%2Fdestino.example%2F${'a'.repeat(400)}`), 'link.long_redirect')).toBe(true);
    });
    it('dominio parecido a una marca (edicion 1-2)', () => {
        expect(has(link('https://paypa1-secure.com/a'), 'link.lookalike')).toBe(true);
        expect(has(link('https://micr0soft-support.net/a'), 'link.lookalike')).toBe(true);
        expect(has(link('https://www.paypal.com/a'), 'link.lookalike')).toBe(false);
        expect(has(link('https://applebees.com/a'), 'link.lookalike')).toBe(false);
    });
});

describe('adjuntos', () => {
    const att = (filename: string, extra = {}) => mk({ attachments: [{ filename, ...extra }] });
    it('ejecutables, macros, html/svg', () => {
        expect(has(att('setup.exe'), 'att.dangerous_ext')).toBe(true);
        for (const f of ['a.scr', 'a.js', 'a.vbs', 'a.jar', 'a.iso', 'a.img', 'a.lnk']) expect(has(att(f), 'att.dangerous_ext')).toBe(true);
        expect(has(att('informe.docm'), 'att.macro')).toBe(true);
        expect(has(att('hoja.xlsm'), 'att.macro')).toBe(true);
        expect(has(att('form.html'), 'att.html')).toBe(true);
        expect(has(att('logo.svg'), 'att.html')).toBe(true);
        expect(has(att('informe.pdf'), 'att.dangerous_ext')).toBe(false);
    });
    it('doble extension', () => {
        expect(has(att('factura.pdf.exe'), 'att.double_ext')).toBe(true);
        expect(has(att('foto.jpg.js'), 'att.double_ext')).toBe(true);
        expect(has(att('doc‮gpj.exe'), 'att.double_ext')).toBe(true);
    });
    it('tipo real peligroso segun file-type.ts', () => {
        expect(has(att('inocente.pdf', { dangerous: true }), 'att.blocked_type')).toBe(true);
        expect(has(att('inocente.pdf', { mismatch: true }), 'att.type_mismatch')).toBe(true);
    });
    it('comprimido con contrasena citada en el cuerpo', () => {
        expect(has(mk({ text: 'La contraseña del archivo es 1234', attachments: [{ filename: 'factura.zip' }] }), 'att.archive_password')).toBe(true);
        expect(has(mk({ text: 'Adjunto el archivo', attachments: [{ filename: 'fotos.zip' }] }), 'att.archive_password')).toBe(false);
    });
});

describe('suplantacion', () => {
    it('nombre de marca con dominio que no le corresponde', () => {
        const i = mk({ from: { name: 'PayPal Seguridad', email: 'aviso@correo-seguro.example' } });
        expect(has(i, 'imp.name_brand')).toBe(true);
        expect(has(mk({ from: { name: 'PayPal', email: 'service@paypal.com' }, hdr: { 'authentication-results': auth({ from: 'paypal.com' }) } }), 'imp.name_brand')).toBe(false);
        // "Apple Valley Dental" no es la marca
        expect(has(mk({ from: { name: 'Apple Valley Dental', email: 'citas@applevalley.example' } }), 'imp.name_brand')).toBe(false);
    });
    it('dominio del From parecido a una marca', () => {
        expect(has(mk({ from: { name: 'Soporte', email: 'x@amaz0n-login.info' } }), 'imp.lookalike_from')).toBe(true);
    });
    it('dominio de una marca con autenticacion fallida = falsificacion', () => {
        const i = mk({ from: { name: 'Google', email: 'no-reply@google.com' }, hdr: { 'authentication-results': auth({ spf: 'fail', dkim: 'fail', dmarc: 'fail', from: 'google.com' }) } });
        expect(has(i, 'imp.brand_domain_fail')).toBe(true);
    });
    it('falsifica el dominio propio desde fuera', () => {
        const i = mk({ from: { name: 'Admin', email: 'admin@bloomx.test' }, hdr: { 'authentication-results': auth({ spf: 'fail', dkim: 'fail', dmarc: 'fail', from: 'bloomx.test' }) } });
        expect(has(i, 'imp.own_domain_spoof')).toBe(true);
    });
    it('nombre visible con otra direccion o dominio; con el propio dominio pesa mas', () => {
        const a = evaluateSpam(mk({ from: { name: 'soporte@banco.example', email: 'x@otro.example' } }), { ownDomains: OWN });
        expect(a.signals.map((s) => s.id)).toContain('imp.name_address');
        const own = evaluateSpam(mk({ from: { name: 'rrhh@bloomx.test', email: 'x@otro.example' } }), { ownDomains: OWN });
        expect(own.signals.find((s) => s.id === 'imp.name_address')!.weight).toBeGreaterThan(a.signals.find((s) => s.id === 'imp.name_address')!.weight);
        expect(has(mk({ from: { name: 'Pedro (tienda.example)', email: 'x@otro.example' } }), 'imp.name_domain')).toBe(true);
    });
    it('rol de organizacion en cuenta gratuita', () => {
        expect(has(mk({ from: { name: 'IT Helpdesk', email: 'it.help@gmail.com' } }), 'imp.freemail_role')).toBe(true);
        expect(has(mk({ from: { name: 'Ana Ruiz', email: 'ana@gmail.com' } }), 'imp.freemail_role')).toBe(false);
    });
});

describe('contexto del destinatario', () => {
    const spammy = () => mk({ subject: 'Aviso', text: 'Verifique su cuenta: su contraseña ha caducado. Urgente.' });
    it('contactos, respuesta previa, hilo propio e historial ham reducen', () => {
        const base = evaluateSpam(spammy(), { ownDomains: OWN }).score;
        for (const ctx of [{ senderInContacts: true }, { userRepliedBefore: true }, { inReplyToOwn: true }, { hamFromSender: 4 }, { hamFromDomain: 3 }] as RecipientContext[]) {
            expect(evaluateSpam(spammy(), { ownDomains: OWN }, ctx).score).toBeLessThan(base);
        }
    });
    it('historial spam sube; primera vez sube poco y solo con otras senales', () => {
        const base = evaluateSpam(spammy(), { ownDomains: OWN }).score;
        expect(evaluateSpam(spammy(), { ownDomains: OWN }, { spamFromSender: 2 }).score).toBeGreaterThan(base);
        expect(evaluateSpam(spammy(), { ownDomains: OWN }, { firstTime: true }).score).toBeGreaterThan(base);
        expect(evaluateSpam(mk(), { ownDomains: OWN }, { firstTime: true }).signals.map((s) => s.id)).not.toContain('ctx.first_contact');
    });
    it('el contexto tiene suelo y se recorta si hay una senal grave', () => {
        const ctx: RecipientContext = { senderInContacts: true, userRepliedBefore: true, inReplyToOwn: true, hamFromSender: 9 };
        const soft = evaluateSpam(spammy(), { ownDomains: OWN }, ctx);
        expect(soft.signals.filter((s) => s.family === 'context').reduce((a, s) => a + s.weight, 0)).toBeGreaterThanOrEqual(-40);
        const hard = evaluateSpam(mk({ attachments: [{ filename: 'factura.pdf.exe' }] }), { ownDomains: OWN }, ctx);
        expect(hard.score).toBeGreaterThanOrEqual(30); // una cuenta conocida comprometida no queda a cero
        expect(hard.dangerousAttachment).toBe(true);
    });
});

describe('motor: pesos, topes y explicacion', () => {
    it('multiplicador de familia 0 apaga la familia; 2 la duplica hasta su tope', () => {
        const i = mk({ text: 'Verifique su cuenta: su contraseña ha caducado' });
        const one = evaluateSpam(i, { ownDomains: OWN }).score;
        const zero = evaluateSpam(i, { ownDomains: OWN, familyWeights: { auth: 1, headers: 1, content: 0, links: 1, attachments: 1, impersonation: 1 } }).score;
        const two = evaluateSpam(i, { ownDomains: OWN, familyWeights: { auth: 1, headers: 1, content: 2, links: 1, attachments: 1, impersonation: 1 } }).score;
        expect(zero).toBeLessThan(one);
        expect(two).toBeGreaterThan(one);
    });
    it('una sola familia no supera su tope', () => {
        const i = mk({ hdr: { 'authentication-results': auth({ spf: 'fail', dkim: 'fail', dmarc: 'fail' }), 'x-mailer': 'Mass Mailer' } });
        const r = evaluateSpam(i, { ownDomains: OWN });
        expect(r.signals.filter((s) => s.family === 'auth' && s.weight > 0).reduce((a, s) => a + s.weight, 0)).toBeLessThanOrEqual(55);
    });
    it('el score esta acotado a 0-100 y es determinista', () => {
        const i = mk({ attachments: [{ filename: 'a.exe' }, { filename: 'b.pdf.scr' }], text: 'viagra cialis casino bitcoin verifique su cuenta gift cards ganaste herencia', hdr: { 'x-spam-flag': 'YES', 'authentication-results': auth({ spf: 'fail', dkim: 'fail', dmarc: 'fail' }) } });
        const a = evaluateSpam(i, { ownDomains: OWN }), b = evaluateSpam(i, { ownDomains: OWN });
        expect(a.score).toBeLessThanOrEqual(100);
        expect(a.score).toBeGreaterThanOrEqual(90);
        expect(a).toEqual(b);
    });
    it('interruptores del motor', () => {
        const i = mk({ text: 'Verifique su cuenta: su contraseña ha caducado' });
        expect(ids(i, undefined, { contentEnabled: false }).some((x) => x.startsWith('content.'))).toBe(false);
        const l = mk({ text: '', html: '<a href="http://203.0.113.9/x">x</a>' });
        expect(ids(l, undefined, { linksEnabled: false }).some((x) => x.startsWith('link.'))).toBe(false);
        expect(ids(mk(), { bayes: { points: 15, tokens: 5, samples: 20 } }, { learningEnabled: false })).not.toContain('learn.bayes');
        expect(ids(mk(), { bayes: { points: 15, tokens: 5, samples: 20 } })).toContain('learn.bayes');
        expect(ids(mk(), { senderInContacts: true }, { contextEnabled: false })).not.toContain('ctx.contact');
    });
    it('toda senal emitida tiene motivo legible en es y en', () => {
        const noisy = mk({
            from: { name: 'PayPal Seguridad admin@x.example', email: 'a@paypa1-secure.xyz' },
            text: 'Verifique su cuenta viagra casino bitcoin gift cards factura adjunta herencia V i a g r a ' + 'A'.repeat(120) + '!!!',
            html: '<div style="display:none">' + 'x'.repeat(400) + '</div><a href="http://203.0.113.9:8080/a">www.paypal.com</a><a href="https://bit.ly/x">b</a><a href="https://a.xyz">c</a><img src="i.jpg">',
            attachments: [{ filename: 'f.pdf.exe' }, { filename: 'g.docm' }, { filename: 'h.html' }, { filename: 'i.zip' }],
            hdr: { 'reply-to': 'x@otro.example', 'x-mailer': 'Mass Mailer', 'x-spam-flag': 'YES', 'message-id': undefined, date: undefined },
        });
        const r = evaluateSpam(noisy, { ownDomains: OWN }, { senderInContacts: true, hamFromSender: 2, firstTime: true, bayes: { points: 9, tokens: 4, samples: 20 } });
        expect(r.signals.length).toBeGreaterThan(15);
        for (const s of r.signals) {
            expect(SIGNAL_IDS).toContain(s.id);
            expect(explainSignal(s, 'es').length).toBeGreaterThan(8);
            expect(explainSignal(s, 'en').length).toBeGreaterThan(8);
            expect(explainSignal(s, 'es')).not.toMatch(/\{\w+\}/);
        }
    });
    it('paridad es/en: mismos marcadores {param} en ambos idiomas', async () => {
        const { REASON_TABLE } = await import('../reasons');
        for (const [id, t] of Object.entries(REASON_TABLE)) {
            const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
            expect(ph(t.es), id).toBe(ph(t.en));
        }
    });
});
