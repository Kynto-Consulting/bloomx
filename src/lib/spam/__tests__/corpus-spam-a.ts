// Corpus sintetico (spam/phishing), parte A.
import type { AttachmentInfo } from '../types';
import { Gen, NAMES, NOW, hdr, html, person, slug, type Lang, type Sample } from './corpus-core';

export const RISKY = ['xyz', 'top', 'click', 'work', 'icu', 'buzz', 'cyou', 'sbs', 'tk', 'ml'];
export const rword = (g: Gen) => g.pick(['secure', 'login', 'verify', 'account', 'update', 'service', 'portal', 'support', 'online', 'center', 'alert', 'help']);
export const junkDomain = (g: Gen) => `${g.pick(['mx', 'net', 'my', 'get', 'go', 'app', 'web'])}${g.int(10, 9999)}-${rword(g)}.${g.pick(RISKY)}`;
export const freeMail = ['gmail.com', 'outlook.com', 'yahoo.com', 'hotmail.com', 'mail.com', 'aol.com'];

export const BRANDS_SP: Array<[string, string, string]> = [
    ['PayPal', 'paypal', 'com'], ['Microsoft', 'microsoft', 'com'], ['Apple', 'apple', 'com'], ['Amazon', 'amazon', 'com'], ['Netflix', 'netflix', 'com'], ['BBVA', 'bbva', 'es'], ['Santander', 'santander', 'com'],
    ['Bancolombia', 'bancolombia', 'com'], ['Itaú', 'itau', 'com.br'], ['Bradesco', 'bradesco', 'com.br'], ['DHL', 'dhl', 'com'], ['Google', 'google', 'com'], ['Correos', 'correos', 'es'], ['Mercado Libre', 'mercadolibre', 'com'],
];

export function spamBankPhishing(g: Gen): Sample[] {
    const out: Sample[] = [];
    const P = {
        es: ['Hemos detectado actividad inusual en su cuenta. Verifique su cuenta de inmediato para evitar el bloqueo: haga clic aquí para verificar.', 'Su tarjeta ha sido bloqueada por seguridad. Confirme su identidad y actualice sus datos en el siguiente enlace.', 'Su cuenta ha sido suspendida. Inicie sesión para evitar el bloqueo definitivo y restablecer su acceso.', 'Acceso no autorizado a su cuenta. Por seguridad debe validar su cuenta en las próximas 24 horas.'],
        en: ['We detected unusual activity on your account. Verify your account immediately to avoid suspension: click here to verify.', 'Your card has been blocked for security reasons. Confirm your identity and update your payment details at the link below.', 'Your account has been suspended. Sign in to avoid permanent closure and restore your access.', 'Unauthorized login attempt on your account. For security you must verify your identity within 24 hours.'],
        pt: ['Detectamos atividade incomum na sua conta. Verifique sua conta imediatamente para evitar o bloqueio: clique aqui para verificar.', 'Seu cartão foi bloqueado por segurança. Confirme sua identidade e atualize seus dados no link abaixo.', 'Sua conta foi suspensa. Faça login para evitar o bloqueio definitivo e restaurar seu acesso.', 'Acesso não autorizado à sua conta. Por segurança você deve validar sua conta em 24 horas.'],
    } as const;
    const S = {
        es: ['Aviso de seguridad: verifique su cuenta', 'Su cuenta ha sido bloqueada', 'Acción requerida: confirme sus datos', 'Tarjeta bloqueada'],
        en: ['Security notice: verify your account', 'Your account has been locked', 'Action required: confirm your details', 'Card blocked'],
        pt: ['Aviso de segurança: verifique sua conta', 'Sua conta foi bloqueada', 'Ação necessária: confirme seus dados', 'Cartão bloqueado'],
    } as const;
    for (let i = 0; i < 52; i++) {
        const lang = g.pick(['es', 'en', 'pt'] as const);
        const [bn, bl, tld] = g.pick(BRANDS_SP);
        const mode = g.int(0, 4);
        const dom = mode === 0 ? junkDomain(g) : mode === 1 ? `${bl}-${rword(g)}.${g.pick(RISKY)}` : mode === 2 ? `${bl.replace(/o/g, '0').replace(/l/g, '1')}.${g.pick(['com', 'net', 'info'])}` : mode === 3 ? g.pick(freeMail) : `secure-${bl}.${tld}.${g.pick(RISKY)}`;
        const linkHost = mode === 2 || mode === 4 || g.chance(0.3) ? junkDomain(g) : dom;
        const auth = g.pick(['none', 'fail', 'fail', 'soft']);
        const isFree = freeMail.includes(dom);
        const hd = hdr(g, {
            from: dom, env: g.chance(0.5) ? junkDomain(g) : dom, dkim: auth === 'fail' ? dom : null, dkimV: 'fail', spf: auth === 'soft' ? 'softfail' : auth === 'fail' ? 'fail' : 'none', dmarc: auth === 'none' ? 'none' : 'fail', noAuth: auth === 'none' && g.chance(0.4),
            msgDomain: g.chance(0.3) ? null : junkDomain(g), replyTo: g.chance(0.5) ? `help@${junkDomain(g)}` : undefined,
        });
        if (isFree) { hd['authentication-results'] = `mx.bloomx.test; spf=pass smtp.mailfrom=${dom}; dkim=pass header.d=${dom}; dmarc=pass header.from=${dom}`; }
        const text = g.pick(P[lang]);
        const url = `http${g.chance(0.3) ? '' : 's'}://${linkHost}/${g.pick(['verify', 'login', 'secure', 'auth'])}/${g.id()}`;
        out.push({
            label: 'spam', kind: 'bank-phishing', lang, hard: isFree, ctx: { firstTime: true },
            input: {
                headers: hd, from: { name: `${bn} ${g.pick(['Seguridad', 'Security', 'Support', 'Soporte'])}`, email: `${g.pick(['security', 'no-reply', 'alert', 'aviso'])}@${dom}` }, subject: g.pick(S[lang]),
                text: `${text}\n${url}`, html: html([text], [[url, g.chance(0.5) ? `https://www.${bl}.${tld}/login` : 'Verificar / Verify']]), attachments: [], recipients: ['usuario@bloomx.test'], now: NOW,
            },
        });
    }
    return out;
}

export function spamCredential(g: Gen): Sample[] {
    const out: Sample[] = [];
    const B = {
        es: ['Su contraseña ha caducado. Para evitar la pérdida de acceso a su buzón, actualice su contraseña ahora. Su buzón está lleno y dejará de recibir mensajes.', 'Documento compartido con usted: Nómina_2026. Inicie sesión con su correo para ver el archivo. Su contraseña expira hoy.', 'Aviso del administrador de TI: su buzón excedió la cuota. Confirme su cuenta o será eliminada en 24 horas.'],
        en: ['Your password has expired. To avoid losing access to your mailbox, update your password now. Your mailbox is full and will stop receiving messages.', 'A document has been shared with you: Payroll_2026. Sign in with your email to view the file. Your password expires today.', 'IT administrator notice: your mailbox exceeded its quota. Confirm your account or it will be deleted in 24 hours.'],
        pt: ['Sua senha expirou. Para evitar perder o acesso à sua caixa de correio, atualize sua senha agora. Sua caixa de correio está cheia e deixará de receber mensagens.', 'Documento compartilhado com você: Folha_2026. Faça login com seu e-mail para ver o arquivo. Sua senha expira hoje.', 'Aviso do administrador de TI: sua caixa excedeu a cota. Confirme sua conta ou ela será excluída em 24 horas.'],
    } as const;
    for (let i = 0; i < 42; i++) {
        const lang = g.pick(['es', 'en', 'pt'] as const);
        const dom = g.chance(0.4) ? g.pick(freeMail) : junkDomain(g);
        const useAtt = g.chance(0.4);
        const ipLink = g.chance(0.25);
        const url = ipLink ? `http://${g.int(11, 199)}.${g.int(1, 250)}.${g.int(1, 250)}.${g.int(1, 250)}/owa/${g.id()}` : `https://${junkDomain(g)}/office/${g.id()}`;
        const free = freeMail.includes(dom);
        const hd = hdr(g, { from: dom, dkim: free ? dom : null, spf: free ? 'pass' : g.pick(['none', 'softfail', 'fail']), dmarc: free ? 'pass' : g.pick(['none', 'fail']), msgDomain: free ? dom : junkDomain(g) });
        out.push({
            label: 'spam', kind: 'credential-phishing', lang, hard: free, ctx: { firstTime: true },
            input: {
                headers: hd, from: { name: g.pick(['Microsoft 365', 'Office 365 Team', 'IT Helpdesk', 'Administrador', 'Mail Admin', 'Soporte TI']), email: `${g.pick(['admin', 'helpdesk', 'it', 'noreply'])}@${dom}` },
                subject: g.pick({ es: ['Contraseña caducada', 'Documento compartido', 'Buzón lleno'], en: ['Password expired', 'Shared document', 'Mailbox full'], pt: ['Senha expirada', 'Documento compartilhado', 'Caixa cheia'] }[lang]),
                text: `${g.pick(B[lang])}\n${url}`, html: html([g.pick(B[lang])], [[url, 'Verify / Acceder']]), attachments: useAtt ? [{ filename: g.pick(['Documento.html', 'Nomina.htm', 'scan.svg', 'voicemail.html']), mimeType: 'text/html' }] : [], recipients: ['usuario@bloomx.test'], now: NOW,
            },
        });
    }
    return out;
}

export function spamAdvanceFee(g: Gen): Sample[] {
    const out: Sample[] = [];
    const B = {
        en: ['Dear friend, I am a widow with a confidential business proposal. My late husband left an inheritance of 8.5 million dollars and I need a trustworthy partner to transfer the funds. God bless you.', 'Congratulations! You have won the international lottery. Claim your prize of 1,200,000 USD. Contact the claims agent and pay the transfer fee. Western Union accepted.', 'I am a barrister and I am contacting you about unclaimed funds. You have been selected as the next of kin and beneficiary of 4.2 million dollars. Urgent and confidential.'],
        es: ['Querido amigo, soy viuda y tengo una propuesta de negocio confidencial. Mi difunto esposo dejó una herencia de 8,5 millones de dólares y necesito un socio de confianza para transferir los fondos. Dios lo bendiga.', '¡Felicidades! Ha ganado la lotería internacional. Reclame su premio de 1.200.000 USD. Contacte con el agente y pague la comisión de transferencia. Se acepta Western Union.', 'Soy abogado y me pongo en contacto con usted por fondos no reclamados. Ha sido seleccionado como beneficiario de 4,2 millones de dólares. Confidencial y urgente.'],
        pt: ['Caro amigo, sou viúva e tenho uma proposta de negócio confidencial. Meu falecido marido deixou uma herança de 8,5 milhões de dólares e preciso de um sócio de confiança para transferir os fundos. Deus o abençoe.', 'Parabéns! Você ganhou a loteria internacional. Resgate seu prêmio de 1.200.000 USD. Contate o agente e pague a taxa de transferência. Western Union aceito.', 'Sou advogado e entro em contato sobre fundos não reclamados. Você foi selecionado como beneficiário de 4,2 milhões de dólares. Confidencial e urgente.'],
    } as const;
    for (let i = 0; i < 42; i++) {
        const lang = g.pick(['en', 'es', 'pt'] as const);
        const dom = g.pick(freeMail);
        const rp = `${slug(person(g))}${g.int(1, 99)}@${g.pick(freeMail)}`;
        out.push({
            label: 'spam', kind: 'advance-fee', lang, hard: true, ctx: { firstTime: true },
            input: {
                headers: hdr(g, { from: dom, dkim: dom, msgDomain: dom, replyTo: g.chance(0.7) ? rp : undefined }),
                from: { name: person(g), email: `${slug(person(g))}${g.int(10, 999)}@${dom}` }, subject: g.pick({ en: ['URGENT BUSINESS PROPOSAL', 'You have won!!!', 'Inheritance notification'], es: ['PROPUESTA DE NEGOCIO URGENTE', '¡¡¡Ha ganado!!!', 'Notificación de herencia'], pt: ['PROPOSTA DE NEGÓCIO URGENTE', 'Você ganhou!!!', 'Notificação de herança'] }[lang]),
                text: g.pick(B[lang]), html: '', attachments: [], recipients: ['usuario@bloomx.test'], now: NOW,
            },
        });
    }
    return out;
}

export function spamPharmaAdult(g: Gen): Sample[] {
    const out: Sample[] = [];
    const B: Array<[Lang, string, string]> = [
        ['en', 'Cheap meds online', 'Order viagra and cialis from our online pharmacy, no prescription needed! Cheap meds, lose weight fast. Buy now, limited offer, 100% free shipping.'],
        ['es', 'Farmacia en línea', 'Compra viagra y cialis en nuestra farmacia en línea, sin receta médica. Medicamentos baratos, adelgaza rápido. Compra ahora, oferta única, 100% gratis el envío.'],
        ['pt', 'Farmácia online', 'Compre viagra e cialis na nossa farmácia online, sem receita. Medicamentos baratos, emagrecer rápido. Compre agora, oferta imperdível, frete 100% grátis.'],
        ['en', 'Hot singles near you', 'Meet singles tonight! Adult dating, sexy girls waiting for you. Live cam and sex tonight, nudes and more. Join now, 100% free.'],
        ['es', 'Mujeres solteras cerca', 'Conoce mujeres solteras esta noche. Citas para adultos, chicas sexis te esperan. Fotos íntimas y sexo esta noche. Únete ya, 100% gratis.'],
        ['pt', 'Mulheres solteiras perto', 'Conheça mulheres solteiras hoje à noite. Encontros adultos, garotas sexy esperando por você. Sexo hoje, nudes e mais. Entre agora, 100% grátis.'],
        ['en', 'Online casino bonus', 'Online casino: no deposit bonus and free spins! Jackpot waiting, bet now, casino bonus for new players. Sports betting and poker too.'],
        ['es', 'Casino en línea', 'Casino en línea: bono sin depósito y giros gratis. Jackpot esperándote, apuesta ahora, bono de bienvenida para nuevos jugadores. Apuestas deportivas y póker.'],
        ['pt', 'Cassino online', 'Cassino online: bônus sem depósito e rodadas grátis. Jackpot esperando, aposte agora, bônus de boas-vindas para novos jogadores. Apostas esportivas e pôquer.'],
        ['en', 'Pre-approved loan', 'Your pre-approved loan is ready. No credit check, instant loan, debt relief and credit repair. Apply now, guaranteed approval.'],
        ['es', 'Préstamo aprobado', 'Su préstamo aprobado está listo. Préstamos sin buró, crédito inmediato y reparación de crédito. Solicítelo ahora, aprobación garantizada.'],
        ['pt', 'Empréstimo aprovado', 'Seu empréstimo aprovado está pronto. Empréstimo sem consulta, crédito imediato. Solicite agora, aprovação garantida.'],
    ];
    for (let i = 0; i < 54; i++) {
        const [lang, subj, body] = g.pick(B);
        const dom = junkDomain(g);
        const validAuth = g.chance(0.3);
        const url = `https://${junkDomain(g)}/${g.id()}`;
        out.push({
            label: 'spam', kind: 'pharma-adult-gambling-loan', lang, hard: validAuth, ctx: { firstTime: true },
            input: {
                headers: hdr(g, { from: dom, dkim: validAuth ? dom : null, spf: validAuth ? 'pass' : g.pick(['none', 'softfail', 'fail']), dmarc: validAuth ? 'pass' : g.pick(['none', 'fail']), msgDomain: g.chance(0.4) ? null : dom, mailer: g.chance(0.2) ? 'Mass Mailer 2.1' : undefined, listUnsub: g.chance(0.15) }),
                from: { name: g.pick(['Offers', 'Best Deals', 'Ofertas', 'Promo', 'VIP']), email: `${g.pick(['info', 'promo', 'deals', 'contact'])}${g.int(1, 99)}@${dom}` }, subject: `${subj}${g.chance(0.5) ? '!!!' : ''}`.toUpperCase().slice(0, g.chance(0.4) ? 60 : 8) + (g.chance(0.5) ? '' : ` ${subj}`),
                text: `${body}\n${url}`, html: html([body], [[url, 'Click here / Haga clic aquí']]), attachments: [], recipients: ['usuario@bloomx.test'], now: NOW,
            },
        });
    }
    return out;
}

