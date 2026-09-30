// Corpus sintetico (ham), parte B.
import type { AttachmentInfo } from '../types';
import { Gen, NAMES, NOW, hdr, html, person, slug, type Lang, type Sample } from './corpus-core';

export function hamCarriersBanks(g: Gen): Sample[] {
    const out: Sample[] = [];
    const items: Array<[string, string, Lang, string, string]> = [
        ['DHL Express', 'dhl.com', 'en', 'Your shipment is on its way', 'Your package with tracking 1Z999AA10123456784 is on its way and will be delivered tomorrow. Track your package here.'],
        ['Correos', 'correos.es', 'es', 'Tu paquete está en reparto', 'Tu paquete se está repartiendo hoy. Si no estás en casa, pasaremos a recogerlo otro día o lo dejaremos en tu oficina más cercana.'],
        ['BBVA', 'bbva.es', 'es', 'Aviso de movimiento en tu cuenta', 'Se ha realizado un cargo de 24,90 EUR con tu tarjeta terminada en 4821. Si no reconoces la operación, llama al teléfono de atención al cliente que figura en tu tarjeta.'],
        ['Santander', 'santander.com', 'es', 'Su extracto mensual está disponible', 'Ya puede consultar su extracto mensual desde la banca online. Nunca le pediremos su contraseña por correo.'],
        ['Itaú', 'itau.com.br', 'pt', 'Comprovante de transferência', 'Sua transferência foi realizada com sucesso. O comprovante está disponível no aplicativo.'],
        ['PayPal', 'paypal.com', 'en', 'Receipt for your payment', 'You sent a payment of $24.00 USD. View the transaction details in your PayPal account.'],
        ['Amazon.com', 'amazon.com', 'en', 'Your Amazon order has shipped', 'Your order has shipped. Arriving tomorrow. Track your package in Your Orders.'],
        ['Microsoft account team', 'accountprotection.microsoft.com', 'en', 'Microsoft account security info was added', 'A security info was added to your Microsoft account. If this was you, no action is required.'],
        ['Google', 'accounts.google.com', 'en', 'Security alert', 'New sign-in on Windows. If this was you, you don\'t need to do anything.'],
    ];
    for (let i = 0; i < 45; i++) {
        const [name, dom, lang, s, b] = g.pick(items);
        out.push({
            label: 'ham', kind: 'carrier-bank', lang, hard: true, ctx: g.chance(0.5) ? { hamFromDomain: g.int(1, 5) } : { firstTime: false },
            input: {
                headers: hdr(g, { from: dom, msgDomain: dom, dkim: dom, listUnsub: g.chance(0.3) }),
                from: { name, email: `no-reply@${dom}` }, subject: s, text: `${b}\nhttps://www.${dom}/track/${g.id()}`,
                html: html([b], [[`https://www.${dom}/t/${g.id()}`, lang === 'en' ? 'Track' : 'Ver detalle']]), attachments: [], recipients: ['usuario@bloomx.test'], now: NOW,
            },
        });
    }
    return out;
}

export function hamMarketing(g: Gen): Sample[] {
    const out: Sample[] = [];
    const shops: Array<[string, string, Lang]> = [['MegaModa', 'megamoda-ofertas.com', 'es'], ['Urban Kicks', 'urbankicks.com', 'en'], ['SuperPlus', 'superplus.com.br', 'pt'], ['Electro Hogar', 'electrohogar.es', 'es']];
    const S = {
        es: ['¡GRAN LIQUIDACIÓN DE VERANO! Hasta 50% de descuento', 'BLACK FRIDAY: ¡Ofertas únicas solo hoy!', '¡Últimas horas! Oferta exclusiva para ti', 'Envío GRATIS + 20% extra, compra ahora'],
        en: ['HUGE SUMMER CLEARANCE! Up to 50% off', 'BLACK FRIDAY: One-time deals today only!', 'Last hours! Exclusive offer for you', 'FREE shipping + extra 20% off, buy now'],
        pt: ['GRANDE LIQUIDAÇÃO DE VERÃO! Até 50% de desconto', 'BLACK FRIDAY: Ofertas imperdíveis só hoje!', 'Últimas horas! Oferta exclusiva para você', 'Frete GRÁTIS + 20% extra, compre agora'],
    } as const;
    const P = {
        es: ['Aprovecha esta oferta exclusiva: camisetas, zapatillas y accesorios con descuentos de hasta el 50%. Compra ahora antes de que se agoten. La promoción termina hoy.', 'Nuestra oferta de temporada incluye envío gratis y devoluciones sin coste. Válido hasta fin de existencias.'],
        en: ['Take advantage of this exclusive offer: shirts, sneakers and accessories up to 50% off. Buy now before they sell out. The promotion ends today.', 'Our seasonal offer includes free shipping and free returns. While supplies last.'],
        pt: ['Aproveite esta oferta exclusiva: camisetas, tênis e acessórios com até 50% de desconto. Compre agora antes que acabem. A promoção termina hoje.', 'Nossa oferta de temporada inclui frete grátis e devoluções sem custo. Enquanto durarem os estoques.'],
    } as const;
    for (let i = 0; i < 28; i++) {
        const [name, dom, lang] = g.pick(shops);
        out.push({
            label: 'ham', kind: 'aggressive-marketing', lang, hard: true, ctx: { firstTime: g.chance(0.4) },
            input: {
                headers: hdr(g, { from: dom, env: 'mail.sendgrid.net', msgDomain: 'sendgrid.net', dkim: dom, listUnsub: true, bulk: true }),
                from: { name, email: `ofertas@${dom}` }, subject: g.pick(S[lang]), text: `${g.pick(P[lang])}\nhttps://${dom}/oferta?c=${g.id()}\nUnsubscribe: https://${dom}/u/${g.id()}`,
                html: html([g.pick(P[lang])], [[`https://u123.ct.sendgrid.net/ls/click?upn=${g.id()}`, 'COMPRAR AHORA']], `<p><a href="https://${dom}/u">unsubscribe</a></p>`), attachments: [], recipients: ['usuario@bloomx.test'], now: NOW,
            },
        });
    }
    return out;
}

export function hamNoAuthSmall(g: Gen): Sample[] {
    const out: Sample[] = [];
    const B = {
        es: ['Buenos días, le confirmo que su pedido está listo para recoger en tienda. Estamos abiertos de lunes a sábado.', 'Hola, te recuerdo tu cita de mañana a las 16:30 en la clínica. Si necesitas cambiarla, responde a este correo.', 'Estimado cliente, adjuntamos el presupuesto solicitado. Tiene una validez de 30 días.'],
        en: ['Good morning, your order is ready for pickup at the shop. We are open Monday to Saturday.', 'Hi, a reminder of your appointment tomorrow at 4:30 PM at the clinic. Reply to this email if you need to change it.', 'Dear customer, attached is the quote you requested. It is valid for 30 days.'],
        pt: ['Bom dia, confirmo que seu pedido está pronto para retirada na loja. Abrimos de segunda a sábado.', 'Olá, lembro sua consulta amanhã às 16h30 na clínica. Se precisar remarcar, responda este e-mail.', 'Prezado cliente, segue o orçamento solicitado. Tem validade de 30 dias.'],
    } as const;
    const doms = ['ferreteriapaz.com', 'floristeriaviva.es', 'clinicadental-luz.com', 'papelarialima.com.br', 'talleres-ortiz.es'];
    for (let i = 0; i < 24; i++) {
        const lang = g.pick(['es', 'en', 'pt'] as const);
        const d = g.pick(doms);
        out.push({
            label: 'ham', kind: 'small-business-noauth', lang, hard: true, ctx: { firstTime: g.chance(0.5), hamFromDomain: g.int(0, 2) },
            input: {
                headers: hdr(g, { from: d, noAuth: true, msgDomain: d }),
                from: { name: person(g), email: `info@${d}` }, subject: g.pick(['Su pedido', 'Recordatorio de cita', 'Presupuesto', 'Your order', 'Appointment reminder', 'Quote', 'Seu pedido', 'Lembrete de consulta']),
                text: g.pick(B[lang]), html: '', attachments: g.chance(0.3) ? [{ filename: 'presupuesto.pdf' }] : [], recipients: ['usuario@bloomx.test'], now: NOW,
            },
        });
    }
    return out;
}

export function hamInvites(g: Gen): Sample[] {
    const out: Sample[] = [];
    for (let i = 0; i < 16; i++) {
        const lang = g.pick(['es', 'en', 'pt'] as const);
        const dom = g.pick(['calendar.servicio-web.com', 'agenda.equipo.example']);
        out.push({
            label: 'ham', kind: 'invite', lang, hard: false, ctx: { senderInContacts: g.chance(0.5) },
            input: {
                headers: hdr(g, { from: dom, msgDomain: dom, dkim: dom }),
                from: { name: person(g), email: `invitaciones@${dom}` }, subject: g.pick(['Invitación: revisión de proyecto', 'Invitation: project review', 'Convite: revisão do projeto']),
                text: g.pick({ es: ['Te invito a la revisión del proyecto. Ver detalles en el calendario adjunto.'], en: ['You are invited to the project review. See the attached calendar for details.'], pt: ['Você está convidado para a revisão do projeto. Veja os detalhes no calendário anexo.'] }[lang]),
                html: '', attachments: [{ filename: 'invite.ics', mimeType: 'text/calendar' }], recipients: ['usuario@bloomx.test'], now: NOW,
            },
        });
    }
    return out;
}
