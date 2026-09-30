// Corpus sintetico (ham), parte A. Ver corpus-core.ts.
import type { AttachmentInfo } from '../types';
import { Gen, NAMES, NOW, hdr, html, person, slug, type Lang, type Sample } from './corpus-core';

export function hamNewsletters(g: Gen): Sample[] {
    const out: Sample[] = [];
    const shops: Array<[string, string, Lang]> = [
        ['Café Aurora', 'cafeaurora-mail.com', 'es'], ['Librería del Sol', 'libreriadelsol.es', 'es'], ['TechNova Weekly', 'technova-news.com', 'en'], ['Green Fork Kitchen', 'greenfork.example', 'en'],
        ['Viagens Brisa', 'viagensbrisa.com.br', 'pt'], ['Estúdio Lume', 'estudiolume.com.br', 'pt'], ['Bici Norte', 'bicinorte.es', 'es'], ['Northwind Books', 'northwind-books.com', 'en'], ['Loja Maré', 'lojamare.com.br', 'pt'],
    ];
    const esp = ['sendgrid.net', 'mailchimp.com', 'list-manage.com', 'mandrillapp.com', 'sparkpostmail.com'];
    const pool = {
        es: ['Esta semana estrenamos colección de primavera y queremos que la veas primero.', 'Te contamos las novedades del mes: nuevos horarios, talleres y una charla abierta.', 'Aprovecha la oferta de temporada con envío gratis en pedidos superiores a 40 euros.', 'Hemos actualizado nuestra política de privacidad; puedes leerla en nuestra web.', 'Gracias por acompañarnos durante todo el año, seguimos creciendo gracias a ti.', 'Descubre la selección de lecturas recomendadas por nuestro equipo.', 'Compra ahora las entradas para el evento del sábado, plazas limitadas.', 'Recuerda que el descuento para socios termina este domingo.'],
        en: ['This week we are launching our spring collection and wanted you to see it first.', 'Here is what is new this month: updated hours, workshops and an open Q&A.', 'Take advantage of our seasonal sale with free shipping on orders over $40.', 'We have updated our privacy policy; you can read it on our website.', 'Thank you for being with us all year, we keep growing thanks to you.', 'Discover the reading list picked by our team.', 'Buy now: tickets for Saturday\'s event are limited.', 'Remember that the members discount ends this Sunday.'],
        pt: ['Esta semana lançamos a coleção de primavera e queremos que você veja primeiro.', 'Contamos as novidades do mês: novos horários, oficinas e uma conversa aberta.', 'Aproveite a oferta de temporada com frete grátis em pedidos acima de 200 reais.', 'Atualizamos nossa política de privacidade; você pode lê-la em nosso site.', 'Obrigado por nos acompanhar o ano todo, seguimos crescendo graças a você.', 'Descubra a seleção de leituras recomendadas pela nossa equipe.', 'Compre agora os ingressos do evento de sábado, vagas limitadas.', 'Lembre-se de que o desconto para sócios termina neste domingo.'],
    } as const;
    const subj = {
        es: ['Novedades de {s} para esta semana', 'Ofertas de temporada en {s}', 'Boletín de {s}: lo que viene', 'Tu resumen mensual de {s}', 'Nuevos horarios y talleres — {s}', '{s}: descuento para socios'],
        en: ['News from {s} this week', 'Seasonal deals at {s}', '{s} newsletter: what is coming', 'Your monthly digest from {s}', 'New hours and workshops — {s}', '{s}: members discount'],
        pt: ['Novidades da {s} desta semana', 'Ofertas de temporada na {s}', 'Boletim da {s}: o que vem por aí', 'Seu resumo mensal da {s}', 'Novos horários e oficinas — {s}', '{s}: desconto para sócios'],
    } as const;
    const foot = { es: 'Recibes este correo porque te suscribiste en nuestra web. Cancelar suscripción: ', en: 'You receive this email because you subscribed on our website. Unsubscribe: ', pt: 'Você recebe este e-mail porque se inscreveu em nosso site. Cancelar inscrição: ' } as const;
    for (let i = 0; i < 66; i++) {
        const [name, dom, lang] = g.pick(shops);
        const e = g.pick(esp);
        const paras = g.pickN(pool[lang], g.int(2, 4));
        const links: Array<[string, string]> = [];
        const nlinks = g.int(2, 9);
        for (let k = 0; k < nlinks; k++) links.push([`https://click.${e}/track/${g.id()}?u=https%3A%2F%2F${dom}%2Fp%2F${k}`, g.pick(['Ver más', 'Comprar', 'Leer artículo', 'See more', 'Shop', 'Ler mais', 'Saiba mais'])]);
        if (g.chance(0.12)) links.push(['https://bit.ly/3' + g.id().slice(0, 5), 'Ver en el navegador']);
        if (g.chance(0.15)) links.push([`https://click.${e}/track/${g.id()}`, `www.${dom}`]);
        const unsub = `https://${dom}/baja/${g.id()}`;
        const body = `${g.pick(['Hola', 'Hello', 'Olá'])} ${g.pick(NAMES)},\n\n${paras.join('\n\n')}\n\n${foot[lang]}${unsub}`;
        const subject = g.pick(subj[lang]).replace('{s}', name) + (g.chance(0.12) ? ' 🎉' : '') + (g.chance(0.1) ? '!' : '');
        const img = g.chance(0.5) ? `<img src="https://${dom}/img/${g.id()}.jpg" alt="">` : '';
        out.push({
            label: 'ham', kind: 'newsletter', lang, hard: false,
            input: {
                headers: hdr(g, { from: dom, env: `bounce.${e}`, dkim: dom, msgDomain: e, listUnsub: true, listId: g.chance(0.4), bulk: g.chance(0.5) }),
                from: { name, email: `news@${dom}` }, subject, text: body,
                html: html([...paras], links, `${img}<p style="font-size:11px">${foot[lang]}<a href="${unsub}">${lang === 'en' ? 'here' : 'aquí'}</a></p>`),
                attachments: [], recipients: ['usuario@bloomx.test'], now: NOW,
            },
            ctx: { firstTime: g.chance(0.3) },
        });
    }
    return out;
}

export function hamPersonal(g: Gen): Sample[] {
    const out: Sample[] = [];
    const free = ['gmail.com', 'outlook.com', 'yahoo.com', 'hotmail.com', 'proton.me', 'icloud.com'];
    const biz = ['estudiojuridico-vega.es', 'consultoraandina.com', 'taller-mora.com', 'clinicasilva.com.br', 'arquitectospaz.com', 'lopez-hermanos.es'];
    const bodies = {
        es: ['Hola, te escribo para confirmar la reunión del jueves a las 10. ¿Te va bien? Avísame y reservo la sala.', 'Gracias por tu mensaje. Te paso los datos que me pediste; cualquier duda me dices y lo vemos por teléfono.', 'Buenas, adjunto el borrador del contrato para que lo revises. Me gustaría cerrar los comentarios antes del viernes.', '¿Qué tal el fin de semana? Te mando las fotos del viaje, salieron geniales. Un abrazo.', 'Recordatorio: mañana la cena es a las 9, en el sitio de siempre. Trae el postre, por favor.', 'He revisado tu propuesta y me parece bien. Solo cambiaría el plazo de entrega; ¿podemos hablarlo mañana?'],
        en: ['Hi, writing to confirm Thursday\'s meeting at 10. Does that work for you? Let me know and I will book the room.', 'Thanks for your message. Here is the information you asked for; if you have questions we can talk by phone.', 'Hello, attached is the draft agreement for you to review. I would like to close the comments before Friday.', 'How was your weekend? Sending you the photos from the trip, they came out great. Cheers.', 'Reminder: tomorrow\'s dinner is at 9, the usual place. Please bring dessert.', 'I reviewed your proposal and it looks good. I would only change the delivery date; can we discuss tomorrow?'],
        pt: ['Oi, escrevo para confirmar a reunião de quinta às 10. Fica bom para você? Me avise que eu reservo a sala.', 'Obrigado pela mensagem. Segue o que você pediu; qualquer dúvida a gente conversa por telefone.', 'Olá, segue o rascunho do contrato para você revisar. Gostaria de fechar os comentários até sexta.', 'Como foi o fim de semana? Mandando as fotos da viagem, ficaram ótimas. Abraço.', 'Lembrete: o jantar de amanhã é às 9, no lugar de sempre. Traga a sobremesa, por favor.', 'Revisei sua proposta e achei boa. Só mudaria o prazo de entrega; podemos falar amanhã?'],
    } as const;
    const subs = {
        es: ['Reunión del jueves', 'Re: datos solicitados', 'Borrador del contrato', 'Fotos del viaje', 'Cena de mañana', 'Re: tu propuesta', 'Consulta rápida', 'Sobre lo de ayer'],
        en: ['Thursday meeting', 'Re: requested information', 'Contract draft', 'Trip photos', 'Tomorrow\'s dinner', 'Re: your proposal', 'Quick question', 'About yesterday'],
        pt: ['Reunião de quinta', 'Re: dados solicitados', 'Rascunho do contrato', 'Fotos da viagem', 'Jantar de amanhã', 'Re: sua proposta', 'Pergunta rápida', 'Sobre ontem'],
    } as const;
    for (let i = 0; i < 66; i++) {
        const lang = g.pick(['es', 'en', 'pt'] as const);
        const isFree = g.chance(0.55);
        const dom = isFree ? g.pick(free) : g.pick(biz);
        const nm = person(g);
        const noAuth = g.chance(0.12);
        const known = g.chance(0.4);
        const att: AttachmentInfo[] = g.chance(0.2) ? [{ filename: g.pick(['contrato.pdf', 'fotos.zip', 'informe.docx', 'presupuesto.xlsx', 'viagem.jpg']), mimeType: 'application/octet-stream' }] : [];
        out.push({
            label: 'ham', kind: 'personal', lang, hard: noAuth, ctx: known ? { senderInContacts: true, userRepliedBefore: g.chance(0.6), hamFromSender: g.int(0, 5) } : { firstTime: g.chance(0.5) },
            input: {
                headers: hdr(g, { from: dom, noAuth, dkim: isFree ? dom : g.chance(0.7) ? dom : null, dmarc: isFree ? 'pass' : undefined, msgDomain: isFree ? (dom === 'gmail.com' ? 'mail.gmail.com' : dom) : dom, mailer: g.chance(0.2) ? 'Apple Mail (2.3774.500.171)' : undefined }),
                from: { name: nm, email: `${slug(nm)}@${dom}` }, subject: g.pick(subs[lang]), text: `${g.pick(bodies[lang])}\n\n${nm.split(' ')[0]}`,
                html: '', attachments: att, recipients: ['usuario@bloomx.test'], now: NOW,
            },
        });
    }
    return out;
}

export function hamInvoices(g: Gen): Sample[] {
    const out: Sample[] = [];
    const cos: Array<[string, string, Lang]> = [['Suministros Delta', 'suministrosdelta.es', 'es'], ['Cloud Harbor', 'cloudharbor.io', 'en'], ['Serviços Prisma', 'servicosprisma.com.br', 'pt'], ['Energía Verde SA', 'energiaverde.com.pe', 'es'], ['Fibra Norte', 'fibranorte.net', 'es'], ['Quill Software', 'quillsoft.com', 'en']];
    const T = {
        es: [['Factura {n} de {c}', 'Adjuntamos la factura {n} correspondiente al mes de abril. El pago pendiente vence el día 15. Gracias por confiar en nosotros.'], ['Recibo de pago {n}', 'Hemos recibido su pago. Adjuntamos el recibo {n} en PDF. Si observa algún error, responda a este correo.'], ['Recordatorio: pago pendiente de la factura {n}', 'Le recordamos que la factura {n} tiene un saldo pendiente. Puede abonarla desde su área de cliente. Si ya pagó, ignore este aviso.']],
        en: [['Invoice {n} from {c}', 'Please find attached invoice {n} for April. Payment is due on the 15th. Thank you for your business.'], ['Payment receipt {n}', 'We have received your payment. Your receipt {n} is attached as a PDF. Reply to this email if anything looks wrong.'], ['Reminder: invoice {n} payment overdue', 'This is a reminder that invoice {n} has an outstanding balance. You can pay it from your customer area. If you already paid, please disregard this notice.']],
        pt: [['Fatura {n} da {c}', 'Segue em anexo a fatura {n} referente ao mês de abril. O pagamento pendente vence no dia 15. Obrigado pela confiança.'], ['Recibo de pagamento {n}', 'Recebemos seu pagamento. Segue o recibo {n} em PDF. Se notar algum erro, responda este e-mail.'], ['Lembrete: pagamento pendente da fatura {n}', 'Lembramos que a fatura {n} tem saldo pendente. Você pode pagá-la pela área do cliente. Se já pagou, ignore este aviso.']],
    } as const;
    for (let i = 0; i < 44; i++) {
        const [c, dom, lang] = g.pick(cos);
        const [s, b] = g.pick(T[lang] as unknown as ReadonlyArray<readonly [string, string]>);
        const n = `F-${g.int(1000, 9999)}`;
        out.push({
            label: 'ham', kind: 'invoice', lang, hard: true, ctx: g.chance(0.5) ? { hamFromDomain: g.int(0, 4) } : { firstTime: true },
            input: {
                headers: hdr(g, { from: dom, msgDomain: dom, dkim: dom, listUnsub: g.chance(0.3) }),
                from: { name: `${c} Facturación`, email: `facturas@${dom}` }, subject: s.replace('{n}', n).replace('{c}', c), text: `${b.replace(/\{n\}/g, n)}\n\n${c}`,
                html: '', attachments: [{ filename: `factura-${n}.pdf`, mimeType: 'application/pdf' }], recipients: ['usuario@bloomx.test'], now: NOW,
            },
        });
    }
    return out;
}

export function hamNotifications(g: Gen): Sample[] {
    const out: Sample[] = [];
    const svc: Array<[string, string, Lang, string, string]> = [
        ['GitHub', 'github.com', 'en', 'New sign-in to your account', 'We noticed a new sign-in to your account from a new device. If this was you, no action is needed. If not, you can review your sessions and reset your password in settings.'],
        ['Notion', 'mail.notion.so', 'en', 'Verify your email address', 'Welcome! Please verify your email address to finish setting up your workspace. This link expires in 24 hours.'],
        ['Slack', 'slack.com', 'en', 'You have unread messages', 'You have 3 unread messages in #general and 1 direct message. Open Slack to catch up.'],
        ['Calendario', 'calendar.servicio-web.com', 'es', 'Invitación: reunión de equipo', 'Se te ha invitado a la reunión de equipo del martes a las 11:00. Responde con Sí, No o Quizás.'],
        ['Soporte Rueda', 'rueda-app.com', 'es', 'Restablecer tu contraseña', 'Recibimos una solicitud para restablecer tu contraseña. Si fuiste tú, usa el enlace de abajo; si no, ignora este correo.'],
        ['Tienda Faro', 'tiendafaro.com', 'es', 'Tu pedido ha sido enviado', 'Tu pedido 48211 ha salido de nuestro almacén y llegará en 2 o 3 días laborables. Puedes seguir el envío desde tu cuenta.'],
        ['Banco Rio', 'bancorio.com.br', 'pt', 'Nova entrada na sua conta', 'Identificamos um novo acesso à sua conta de outro dispositivo. Se foi você, não precisa fazer nada.'],
        ['Meetly', 'meetly.app', 'en', 'Your meeting starts in 15 minutes', 'Reminder: your meeting with the design team starts at 3:00 PM. Join from the calendar.'],
        ['Lojas Alfa', 'lojasalfa.com.br', 'pt', 'Seu pedido foi entregue', 'Seu pedido 77120 foi entregue. Avalie sua compra e ajude outros clientes.'],
        ['Cloud Harbor', 'cloudharbor.io', 'en', 'Security alert: password changed', 'The password for your account was changed. If you made this change, you can ignore this message. Otherwise, contact support immediately.'],
        ['Gestor Docs', 'gestordocs.es', 'es', 'Documento pendiente de firma', 'Tienes un documento pendiente de firma. Accede a tu bandeja para revisarlo. El enlace caduca en 7 días.'],
        ['Travel Desk', 'traveldesk.example', 'en', 'Action required: confirm your itinerary', 'Please confirm your itinerary for the March conference. Action required before Friday.'],
    ];
    for (let i = 0; i < 52; i++) {
        const [name, dom, lang, s, b] = g.pick(svc);
        const links: Array<[string, string]> = [[`https://${dom}/a/${g.id()}`, lang === 'en' ? 'Open' : 'Abrir']];
        if (g.chance(0.4)) links.push([`https://${dom}/settings`, 'Settings']);
        out.push({
            label: 'ham', kind: 'notification', lang, hard: /password|contrase|verify|sign-in|acesso|acceso/i.test(s + b), ctx: g.chance(0.4) ? { hamFromDomain: g.int(1, 6) } : { firstTime: g.chance(0.3) },
            input: {
                headers: hdr(g, { from: dom, env: `bounces.${dom}`, msgDomain: dom, dkim: dom, listUnsub: g.chance(0.35), bulk: g.chance(0.2) }),
                from: { name, email: `no-reply@${dom}` }, subject: s, text: `${b}\n\n${links.map((l) => l[0]).join('\n')}`,
                html: html([b], links), attachments: [], recipients: ['usuario@bloomx.test'], now: NOW,
            },
        });
    }
    return out;
}

export function hamCorporate(g: Gen): Sample[] {
    const out: Sample[] = [];
    const dom = 'bloomx.test';
    const B = {
        es: ['Necesito tu ayuda urgente con el informe de ventas: el cliente lo espera hoy. ¿Puedes revisarlo antes de las 17:00?', 'Adjunto las actas de la reunión. Por favor respondan inmediatamente si hay correcciones, para cerrarlas hoy.', 'Aviso importante: mañana el servidor de archivos estará en mantenimiento entre las 22:00 y las 23:00.', 'Os comparto la agenda del comité del lunes. Confirmad asistencia antes del viernes.', 'Actualización de vacaciones: recordad registrar vuestras fechas en el portal de RR. HH.'],
        en: ['I need your urgent help with the sales report: the client expects it today. Can you review it before 5 PM?', 'Attached are the meeting minutes. Please respond immediately if there are corrections so we can close them today.', 'Important notice: tomorrow the file server will be under maintenance between 10 and 11 PM.', 'Sharing Monday\'s committee agenda. Please confirm attendance before Friday.', 'Holiday update: remember to log your dates in the HR portal.'],
        pt: ['Preciso da sua ajuda urgente com o relatório de vendas: o cliente espera hoje. Consegue revisar antes das 17h?', 'Segue a ata da reunião. Por favor responda imediatamente se houver correções, para fecharmos hoje.', 'Aviso importante: amanhã o servidor de arquivos ficará em manutenção entre 22h e 23h.', 'Compartilho a pauta do comitê de segunda. Confirmem presença até sexta.', 'Atualização de férias: lembrem-se de registrar as datas no portal de RH.'],
    } as const;
    for (let i = 0; i < 44; i++) {
        const lang = g.pick(['es', 'en', 'pt'] as const);
        const nm = person(g);
        out.push({
            label: 'ham', kind: 'corporate', lang, hard: true, ctx: { senderInContacts: g.chance(0.6), hamFromDomain: g.int(0, 8) },
            input: {
                headers: hdr(g, { from: dom, msgDomain: dom, dkim: dom, to: `${slug(person(g))}@${dom}`, received: [`from mail.${dom} ([10.0.0.${g.int(2, 200)}]) by mx.bloomx.test`] }),
                from: { name: nm, email: `${slug(nm)}@${dom}` }, subject: g.pick(['Informe de ventas', 'Actas de la reunión', 'Mantenimiento programado', 'Agenda del comité', 'Vacaciones', 'Sales report', 'Meeting minutes', 'Maintenance window', 'Relatório de vendas', 'Ata da reunião']),
                text: `${g.pick(B[lang])}\n\n${nm.split(' ')[0]}`, html: '', attachments: g.chance(0.3) ? [{ filename: 'informe.xlsx' }] : [], recipients: [`${slug(person(g))}@${dom}`, `${slug(person(g))}@${dom}`], now: NOW,
            },
        });
    }
    return out;
}

