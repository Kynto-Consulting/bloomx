// Corpus sintetico (spam/phishing), parte B.
import type { AttachmentInfo } from '../types';
import { Gen, NAMES, NOW, hdr, html, person, slug, type Lang, type Sample } from './corpus-core';

import { BRANDS_SP, RISKY, freeMail, junkDomain, rword } from './corpus-spam-a';

export function spamCrypto(g: Gen): Sample[] {
    const out: Sample[] = [];
    const B = {
        en: ['Guaranteed returns! Double your bitcoin in 48 hours with our trading signals. Investment opportunity for a limited time, passive income guaranteed profit. Send your wallet seed phrase to verify.', 'Airdrop alert: claim your free crypto tokens now. Connect your wallet and enter your recovery phrase.'],
        es: ['¡Ganancias garantizadas! Duplica tu bitcoin en 48 horas con nuestras señales de trading. Oportunidad de inversión por tiempo limitado, ingresos pasivos. Envía tu frase semilla para verificar.', 'Alerta de airdrop: reclama tus tokens cripto gratis ahora. Conecta tu wallet e ingresa tu frase de recuperación.'],
        pt: ['Retorno garantido! Dobre seu bitcoin em 48 horas com nossos sinais de trading. Oportunidade de investimento por tempo limitado, renda passiva. Envie sua frase de recuperação para verificar.', 'Alerta de airdrop: resgate seus tokens cripto grátis agora. Conecte sua carteira e informe sua frase de recuperação.'],
    } as const;
    for (let i = 0; i < 32; i++) {
        const lang = g.pick(['en', 'es', 'pt'] as const);
        const dom = g.chance(0.5) ? junkDomain(g) : g.pick(freeMail);
        const free = freeMail.includes(dom);
        const url = `https://${junkDomain(g)}/invest/${g.id()}`;
        out.push({
            label: 'spam', kind: 'crypto', lang, hard: free, ctx: { firstTime: true },
            input: {
                headers: hdr(g, { from: dom, dkim: free ? dom : null, spf: free ? 'pass' : 'none', dmarc: free ? 'pass' : 'none', msgDomain: free ? dom : null }),
                from: { name: g.pick(['Crypto Alerts', 'Trading VIP', 'Inversión Segura', 'Cripto Ganancias']), email: `alerts${g.int(1, 99)}@${dom}` }, subject: g.pick({ en: ['Double your bitcoin', 'Airdrop: claim now'], es: ['Duplica tu bitcoin', 'Airdrop: reclama ahora'], pt: ['Dobre seu bitcoin', 'Airdrop: resgate agora'] }[lang]),
                text: `${g.pick(B[lang])}\n${url}`, html: '', attachments: [], recipients: ['usuario@bloomx.test'], now: NOW,
            },
        });
    }
    return out;
}

export function spamMalwareInvoice(g: Gen): Sample[] {
    const out: Sample[] = [];
    const B = {
        es: ['Adjuntamos la factura pendiente. Pago pendiente vencido: revise el archivo adjunto. La contraseña del archivo es 1234.', 'Comprobante de pago adjunto. Orden de compra adjunta, por favor confirme la recepción hoy.'],
        en: ['Invoice attached. Payment overdue: please review the attached file. The password for the archive is 1234.', 'Remittance advice attached. Purchase order attached, please confirm receipt today.'],
        pt: ['Fatura em anexo. Pagamento pendente vencido: revise o arquivo anexo. A senha do arquivo é 1234.', 'Comprovante de pagamento anexo. Ordem de compra anexa, por favor confirme o recebimento hoje.'],
    } as const;
    const files = ['factura_0453.exe', 'invoice-2026.pdf.exe', 'pago.scr', 'orden.docm', 'presupuesto.xlsm', 'imagen.iso', 'documento.js', 'boleto.pdf.vbs', 'factura.zip', 'invoice.rar', 'archivo.lnk', 'scan.pdf.js', 'setup.msi', 'nota.jar', 'aviso.hta', 'comprobante.html', 'fatura.pdf .exe'];
    for (let i = 0; i < 46; i++) {
        const lang = g.pick(['es', 'en', 'pt'] as const);
        const f = g.pick(files);
        const dom = g.chance(0.5) ? junkDomain(g) : g.pick(freeMail);
        const free = freeMail.includes(dom);
        out.push({
            label: 'spam', kind: 'malware-attachment', lang, hard: free && /zip|rar|html/.test(f), ctx: { firstTime: true },
            input: {
                headers: hdr(g, { from: dom, dkim: free ? dom : null, spf: free ? 'pass' : g.pick(['none', 'softfail']), dmarc: free ? 'pass' : 'none', msgDomain: free ? dom : null }),
                from: { name: g.pick(['Facturación', 'Accounts', 'Contabilidade', 'Pagos']), email: `${g.pick(['billing', 'facturas', 'accounts'])}${g.int(1, 99)}@${dom}` }, subject: g.pick({ es: ['Factura adjunta', 'Pago pendiente', 'Orden de compra'], en: ['Invoice attached', 'Payment overdue', 'Purchase order'], pt: ['Fatura anexa', 'Pagamento pendente', 'Ordem de compra'] }[lang]),
                text: g.pick(B[lang]), html: '', attachments: [{ filename: f, mimeType: 'application/octet-stream', dangerous: /\.(exe|scr|msi|jar)$/.test(f) && g.chance(0.5) }], recipients: ['usuario@bloomx.test'], now: NOW,
            },
        });
    }
    return out;
}

export function spamShipping(g: Gen): Sample[] {
    const out: Sample[] = [];
    const B = {
        es: ['Su envío retenido: no pudimos entregar su paquete. Pague la tasa de aduana de 1,99 EUR para reprogramar la entrega.', 'Paquete retenido en aduana. Reprogramar la entrega y confirmar su dirección en el enlace.'],
        en: ['Your shipment on hold: we were unable to deliver your parcel. Pay the customs fee of $1.99 to reschedule delivery.', 'Package held at customs. Reschedule delivery and confirm your address at the link.'],
        pt: ['Sua encomenda retida: não conseguimos entregar. Pague a taxa alfandegária de R$ 1,99 para reagendar a entrega.', 'Encomenda retida na alfândega. Reagende a entrega e confirme seu endereço no link.'],
    } as const;
    for (let i = 0; i < 34; i++) {
        const lang = g.pick(['es', 'en', 'pt'] as const);
        const [bn, bl] = g.pick([['DHL', 'dhl'], ['Correos', 'correos'], ['FedEx', 'fedex'], ['Correios', 'correios'], ['UPS', 'ups']] as const);
        const dom = g.chance(0.5) ? g.pick(freeMail) : `${bl}-${rword(g)}.${g.pick(RISKY)}`;
        const short = g.chance(0.5) ? `https://bit.ly/${g.id().slice(0, 6)}` : `https://${junkDomain(g)}/track/${g.id()}`;
        const free = freeMail.includes(dom);
        out.push({
            label: 'spam', kind: 'shipping-scam', lang, hard: false, ctx: { firstTime: true },
            input: {
                headers: hdr(g, { from: dom, dkim: free ? dom : null, spf: free ? 'pass' : g.pick(['none', 'fail']), dmarc: free ? 'pass' : 'fail', msgDomain: free ? dom : null }),
                from: { name: `${bn} Delivery`, email: `delivery@${dom}` }, subject: g.pick({ es: ['Envío retenido', 'Intento de entrega fallido'], en: ['Shipment on hold', 'Delivery failed'], pt: ['Encomenda retida', 'Falha na entrega'] }[lang]),
                text: `${g.pick(B[lang])}\n${short}`, html: html([g.pick(B[lang])], [[short, 'Track / Rastrear']]), attachments: [], recipients: ['usuario@bloomx.test'], now: NOW,
            },
        });
    }
    return out;
}

export function spamSpoof(g: Gen): Sample[] {
    const out: Sample[] = [];
    const B = {
        es: ['Hola, necesito que hagas una transferencia urgente a un proveedor. Es confidencial, no lo comentes con nadie. Responde inmediatamente por este medio.', 'Estoy en una reunión y no puedo hablar. Necesito que compres tarjetas de regalo hoy y me envíes los códigos.'],
        en: ['Hi, I need you to make an urgent wire transfer to a vendor. It is confidential, do not mention it to anyone. Respond immediately here.', 'I am in a meeting and cannot talk. I need you to buy gift cards today and send me the codes.'],
        pt: ['Olá, preciso que você faça uma transferência urgente para um fornecedor. É confidencial, não comente com ninguém. Responda imediatamente por aqui.', 'Estou em reunião e não posso falar. Preciso que você compre cartões-presente hoje e me envie os códigos.'],
    } as const;
    for (let i = 0; i < 30; i++) {
        const lang = g.pick(['es', 'en', 'pt'] as const);
        const nm = person(g);
        const mode = g.int(0, 2);
        const dom = g.pick(freeMail);
        const name = mode === 0 ? nm : mode === 1 ? `${nm} <${slug(nm)}@bloomx.test>` : `${nm} (bloomx.test)`;
        out.push({
            label: 'spam', kind: 'name-spoof', lang, hard: true, ctx: { firstTime: true },
            input: {
                headers: hdr(g, { from: dom, dkim: dom, msgDomain: dom, replyTo: g.chance(0.6) ? `${slug(nm)}${g.int(1, 99)}@${g.pick(freeMail)}` : undefined }),
                from: { name: name, email: `${slug(nm)}.${g.int(100, 999)}@${dom}` }, subject: g.pick({ es: ['Urgente', 'Tarea rápida', 'Necesito un favor'], en: ['Urgent', 'Quick task', 'Need a favor'], pt: ['Urgente', 'Tarefa rápida', 'Preciso de um favor'] }[lang]),
                text: g.pick(B[lang]), html: '', attachments: [], recipients: ['usuario@bloomx.test'], now: NOW,
            },
            // El nombre suplantado de un companero: la deteccion de "companero" es de la capa externa; aqui cuenta la senal de nombre/direccion.
        });
    }
    return out;
}

export function spamMarketing(g: Gen): Sample[] {
    const out: Sample[] = [];
    const B = {
        es: ['Gana dinero desde casa: trabaja desde casa y consigue ingresos extra. 100% gratis, sin compromiso, sin riesgo. Sea su propio jefe. Esto no es spam. ¡Oferta única, actúa ahora!'],
        en: ['Make money fast from home: work from home and earn extra income. 100% free, no obligation, risk free. Be your own boss. This is not spam. Once in a lifetime offer, act now!'],
        pt: ['Ganhe dinheiro rápido: trabalhe em casa e tenha renda extra. 100% grátis, sem compromisso, sem risco. Seja seu próprio chefe. Isso não é spam. Oferta imperdível, aja agora!'],
    } as const;
    for (let i = 0; i < 32; i++) {
        const lang = g.pick(['es', 'en', 'pt'] as const);
        const dom = junkDomain(g);
        const validAuth = g.chance(0.4);
        const url = `http://${junkDomain(g)}/r/${g.id()}`;
        out.push({
            label: 'spam', kind: 'aggressive-spam', lang, hard: validAuth, ctx: { firstTime: true },
            input: {
                headers: hdr(g, { from: dom, dkim: validAuth ? dom : null, spf: validAuth ? 'pass' : 'none', dmarc: validAuth ? 'pass' : 'none', msgDomain: dom, listUnsub: g.chance(0.3), bulk: g.chance(0.5) }),
                from: { name: g.pick(['Ganancias', 'Money Club', 'Renda Extra']), email: `club${g.int(1, 99)}@${dom}` }, subject: g.pick({ es: ['GANA DINERO DESDE CASA!!!', 'Oferta única para ti', '¡¡¡Ingresos extra!!!'], en: ['MAKE MONEY FAST!!!', 'One-time offer for you', 'Extra income!!!'], pt: ['GANHE DINHEIRO RÁPIDO!!!', 'Oferta única para você', 'Renda extra!!!'] }[lang]),
                text: `${g.pick(B[lang])}\n${url}`, html: html([g.pick(B[lang])], [[url, 'CLICK HERE']]), attachments: [], recipients: ['usuario@bloomx.test'], now: NOW,
            },
        });
    }
    return out;
}

export function spamHardMinimal(g: Gen): Sample[] {
    const out: Sample[] = [];
    // Correos cortos con enlace, obfuscados y solo imagen
    for (let i = 0; i < 26; i++) {
        const lang = g.pick(['es', 'en', 'pt'] as const);
        const dom = junkDomain(g);
        const url = `https://${junkDomain(g)}/${g.id()}`;
        const kind = i % 3;
        const text = kind === 0
            ? { es: 'Mira esto, te va a interesar: ', en: 'Check this out, you will like it: ', pt: 'Veja isto, você vai gostar: ' }[lang] + url
            : kind === 1
                ? { es: 'V i a g r a  y  C i a l i s  b a r a t o s  s i n  r e c e t a  ', en: 'V i a g r a  a n d  C i a l i s  c h e a p  n o  p r e s c r i p t i o n  ', pt: 'V i a g r a  e  C i a l i s  b a r a t o s  s e m  r e c e i t a  ' }[lang] + url
                : '';
        const imgOnly = kind === 2;
        out.push({
            label: 'spam', kind: 'minimal-obfuscated', lang, hard: true, ctx: { firstTime: true },
            input: {
                headers: hdr(g, { from: dom, dkim: dom, spf: 'pass', dmarc: 'pass', msgDomain: dom, replyTo: g.chance(0.4) ? `x${g.int(1, 99)}@${junkDomain(g)}` : undefined }),
                from: { name: g.pick(['Oferta', 'Info', 'Promo', 'News']), email: `x${g.int(1, 999)}@${dom}` }, subject: g.pick({ es: ['Para ti', 'Hola', 'Interesante'], en: ['For you', 'Hello', 'Interesting'], pt: ['Para você', 'Olá', 'Interessante'] }[lang]),
                text: imgOnly ? '' : text, html: imgOnly ? `<html><body><a href="${url}"><img src="https://${dom}/i/${g.id()}.jpg"></a></body></html>` : '', attachments: [], recipients: ['usuario@bloomx.test'], now: NOW,
            },
        });
    }
    return out;
}

export function spamHomograph(g: Gen): Sample[] {
    const out: Sample[] = [];
    // Dominios con homoglifos y suplantacion por marca con autenticacion aparentemente valida
    const doms = ['xn--pypal-4ve.com', 'xn--80ak6aa92e.com', 'paypa1-secure.com', 'micros0ft-support.net', 'amaz0n-login.info', 'goog1e-accounts.com', 'app1e-id-verify.com'];
    for (let i = 0; i < 20; i++) {
        const lang = g.pick(['es', 'en', 'pt'] as const);
        const dom = g.pick(doms);
        const [bn] = g.pick(BRANDS_SP);
        const url = `https://${dom}/signin/${g.id()}`;
        out.push({
            label: 'spam', kind: 'lookalike-domain', lang, hard: true, ctx: { firstTime: true },
            input: {
                headers: hdr(g, { from: dom, dkim: dom, spf: 'pass', dmarc: 'pass', msgDomain: dom }),
                from: { name: `${bn} Security`, email: `service@${dom}` }, subject: g.pick({ es: ['Confirme su cuenta', 'Problema con su pago'], en: ['Confirm your account', 'Problem with your payment'], pt: ['Confirme sua conta', 'Problema com seu pagamento'] }[lang]),
                text: `${{ es: 'Confirme su cuenta para continuar usando el servicio.', en: 'Confirm your account to keep using the service.', pt: 'Confirme sua conta para continuar usando o serviço.' }[lang]}\n${url}`, html: '', attachments: [], recipients: ['usuario@bloomx.test'], now: NOW,
            },
        });
    }
    return out;
}
