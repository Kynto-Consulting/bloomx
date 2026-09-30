/**
 * Lexico multilingue (es/en/pt) de frases de phishing, fraude y spam. Las frases van NORMALIZADAS (minusculas, sin acentos)
 * porque el texto se normaliza antes de buscar (ver text.ts#normalizeText). Cada categoria tiene un tope para que una sola
 * familia de frases no baste por si sola, y el conjunto del lexico tiene su propio tope en signals-content.ts.
 */

export type LexCategory = 'bec' | 'phishing' | 'fraud' | 'crypto' | 'invoice' | 'pharma' | 'adult' | 'gambling' | 'loan' | 'marketing' | 'urgency';

export interface LexCategoryDef { cap: number; phrases: Array<[string, number]> }

export const LEXICON: Record<LexCategory, LexCategoryDef> = {
    bec: {
        cap: 30,
        phrases: [
            ['wire transfer', 5], ['gift cards', 8], ['buy gift cards', 10], ['send me the codes', 10], ['i am in a meeting', 8], ['are you available', 5], ['do not mention it to anyone', 10], ['it is confidential', 5], ['respond immediately here', 9],
            ['change of bank details', 10], ['new bank account', 6], ['update our payment details', 8], ['urgent wire', 9], ['keep this between us', 9], ['make an urgent wire', 9],
            ['transferencia urgente', 9], ['tarjetas de regalo', 8], ['compres tarjetas', 10], ['envies los codigos', 10], ['estoy en una reunion', 8], ['estas disponible', 4], ['no lo comentes con nadie', 10], ['es confidencial', 5], ['responde inmediatamente por este medio', 9],
            ['cambio de datos bancarios', 10], ['nueva cuenta bancaria', 6], ['transferencia a un proveedor', 8], ['hagas una transferencia', 8],
            ['cartoes-presente', 8], ['cartoes presente', 8], ['me envie os codigos', 10], ['estou em reuniao', 8], ['nao comente com ninguem', 10], ['e confidencial', 5], ['responda imediatamente por aqui', 9], ['faca uma transferencia', 8],
        ],
    },
    phishing: {
        cap: 34,
        phrases: [
            // en
            ['verify your account', 9], ['confirm your account', 8], ['your account has been suspended', 10], ['your account will be closed', 9], ['account has been locked', 9],
            ['account has been limited', 9], ['unusual activity', 5], ['unusual sign-in', 6], ['suspicious activity', 5], ['password has expired', 10], ['password expires', 7], ['your password will expire', 8],
            ['update your payment', 7], ['update your billing', 7], ['security alert', 3], ['click here to verify', 10], ['log in to restore', 9], ['validate your identity', 8],
            ['action required', 3], ['mailbox is full', 8], ['mailbox quota', 6], ['confirm your identity', 8], ['re-enter your password', 9], ['unauthorized login', 7], ['verify your identity', 8],
            ['sign in to avoid', 8], ['to avoid suspension', 9], ['your card has been blocked', 9], ['restore your access', 8], ['sign in with your email', 8], ['document has been shared with you', 6], ['update your password now', 8], ['will stop receiving messages', 8], ['or it will be deleted', 9], ['loss of access', 5], ['view the file', 3],
            // es
            ['verifica tu cuenta', 9], ['verificar su cuenta', 9], ['verifique su cuenta', 9], ['confirma tu cuenta', 8], ['confirme su cuenta', 8], ['tu cuenta ha sido suspendida', 10], ['su cuenta ha sido suspendida', 10],
            ['cuenta sera cerrada', 9], ['cuenta bloqueada', 8], ['cuenta ha sido bloqueada', 9], ['actividad inusual', 5], ['actividad sospechosa', 6], ['contrasena ha caducado', 10], ['contrasena caducada', 10], ['contrasena expira', 8],
            ['contrasena esta por expirar', 9], ['actualiza tus datos', 7], ['actualice sus datos', 7], ['acceso no autorizado', 7], ['confirme su identidad', 8], ['confirma tu identidad', 8], ['buzon lleno', 8], ['buzon esta lleno', 8],
            ['restablecer su acceso', 8], ['tarjeta bloqueada', 8], ['tarjeta ha sido bloqueada', 9], ['validar su cuenta', 9], ['haga clic aqui para verificar', 10], ['haz clic aqui para verificar', 10],
            ['inicie sesion para evitar', 9], ['para evitar la suspension', 9], ['para evitar el bloqueo', 9], ['por seguridad debe', 6], ['por su seguridad debe', 6], ['verifique sus datos', 8], ['inicie sesion con su correo', 8], ['documento compartido con usted', 6], ['actualice su contrasena ahora', 8], ['dejara de recibir mensajes', 8], ['o sera eliminada', 9], ['perdida de acceso', 5], ['ver el archivo', 3], ['verificar sus datos', 8],
            // pt
            ['verifique sua conta', 9], ['confirme sua conta', 8], ['sua conta foi suspensa', 10], ['sua conta sera bloqueada', 9], ['sua conta foi bloqueada', 9], ['atividade incomum', 5], ['atividade suspeita', 6],
            ['senha expirou', 10], ['senha expira', 8], ['sua senha vai expirar', 9], ['atualize seus dados', 7], ['acesso nao autorizado', 7], ['confirme sua identidade', 8], ['caixa de correio cheia', 8], ['caixa postal cheia', 8],
            ['cartao bloqueado', 8], ['seu cartao foi bloqueado', 9], ['clique aqui para verificar', 10], ['para evitar o bloqueio', 9], ['restaurar seu acesso', 8], ['faca login com seu e-mail', 8], ['documento compartilhado com voce', 6], ['atualize sua senha agora', 8], ['deixara de receber mensagens', 8], ['ou sera excluida', 9], ['perda de acesso', 5], ['ver o arquivo', 3],
        ],
    },
    fraud: {
        cap: 46,
        phrases: [
            // en
            ['you have won', 10], ['you won', 6], ['lottery', 6], ['claim your prize', 10], ['congratulations you', 5], ['inheritance', 8], ['next of kin', 10], ['million dollars', 7], ['million usd', 7],
            ['transfer the funds', 9], ['dear friend', 6], ['business proposal', 6], ['unclaimed funds', 10], ['confidential business', 8], ['beneficiary', 5], ['dear beneficiary', 9],
            ['i am a widow', 9], ['late husband', 8], ['barrister', 6], ['bank transfer fee', 6], ['claim your reward', 8], ['selected as a winner', 10], ['you have been selected', 6], ['gift card', 3],
            ['urgent and confidential', 9], ['am contacting you', 5], ['god bless', 4], ['western union', 6], ['moneygram', 6],
            // es
            ['ha ganado', 6], ['has ganado', 8], ['felicidades has sido seleccionado', 10], ['fuiste seleccionado', 6], ['premio', 3], ['loteria', 6], ['herencia', 7], ['beneficiario', 5], ['millones de dolares', 8],
            ['querido amigo', 7], ['estimado amigo', 6], ['propuesta de negocio', 6], ['fondos no reclamados', 10], ['reclama tu premio', 10], ['reclame su premio', 10], ['sorteo', 3], ['viuda', 3],
            ['transferir los fondos', 9], ['confidencial y urgente', 9], ['seleccionado como ganador', 10], ['comision del', 4], ['tarjeta de regalo', 3],
            // pt
            ['voce ganhou', 8], ['voce foi selecionado', 6], ['parabens voce', 5], ['loteria', 6], ['heranca', 7], ['milhoes de dolares', 8], ['caro amigo', 7], ['proposta de negocio', 6], ['fundos nao reclamados', 10],
            ['resgate seu premio', 10], ['transferir os fundos', 9], ['selecionado como vencedor', 10], ['cartao presente', 3],
        ],
    },
    crypto: {
        cap: 34,
        phrases: [
            ['bitcoin', 3], ['crypto', 2], ['cripto', 2], ['double your', 8], ['investment opportunity', 6], ['guaranteed returns', 9], ['guaranteed profit', 9], ['passive income', 4], ['trading signals', 6],
            ['ganancias garantizadas', 9], ['duplica tu', 8], ['duplique su', 8], ['oportunidad de inversion', 6], ['rentabilidad garantizada', 9], ['senales de trading', 6], ['ingresos pasivos', 4],
            ['retorno garantido', 9], ['lucro garantido', 9], ['oportunidade de investimento', 6], ['dobre seu', 8], ['sinais de trading', 6], ['renda passiva', 4],
            ['wallet', 2], ['seed phrase', 9], ['claim your free', 7], ['connect your wallet', 8], ['free tokens', 6], ['free crypto', 7], ['frase semilla', 9], ['frase de recuperacion', 9], ['reclama tus tokens', 7], ['conecta tu wallet', 8], ['tokens gratis', 6], ['cripto gratis', 7], ['recovery phrase', 9], ['frase de recuperacao', 9], ['resgate seus tokens', 7], ['conecte sua carteira', 8], ['airdrop', 5],
        ],
    },
    invoice: {
        cap: 24,
        phrases: [
            ['invoice attached', 8], ['see attached invoice', 8], ['payment overdue', 6], ['remittance advice', 8], ['wire confirmation', 8], ['purchase order attached', 8], ['your package', 3],
            ['shipment on hold', 9], ['delivery failed', 5], ['customs fee', 9], ['unable to deliver your parcel', 9], ['reschedule delivery', 6], ['pending payment', 4], ['outstanding balance', 4],
            ['factura adjunta', 8], ['adjuntamos la factura', 6], ['pago pendiente', 5], ['envio retenido', 9], ['paquete retenido', 9], ['no pudimos entregar su paquete', 9], ['tasa de aduana', 9], ['reprogramar la entrega', 6],
            ['aviso de pago', 4], ['comprobante de pago adjunto', 8], ['orden de compra adjunta', 8], ['saldo pendiente', 4],
            ['fatura anexa', 8], ['fatura em anexo', 8], ['pagamento pendente', 5], ['encomenda retida', 9], ['taxa alfandegaria', 9], ['nao conseguimos entregar', 7], ['comprovante de pagamento anexo', 8], ['boleto em anexo', 7],
        ],
    },
    pharma: {
        cap: 34,
        phrases: [
            ['viagra', 10], ['cialis', 10], ['levitra', 10], ['online pharmacy', 9], ['no prescription', 10], ['without prescription', 9], ['cheap meds', 9], ['lose weight fast', 9], ['weight loss', 4], ['male enhancement', 10],
            ['enlargement', 9], ['penis', 9], ['erectile', 9],
            ['farmacia en linea', 9], ['sin receta', 8], ['sin receta medica', 10], ['adelgaza rapido', 9], ['pastillas para adelgazar', 10], ['potenciador masculino', 10], ['medicamentos baratos', 8],
            ['farmacia online', 9], ['sem receita', 9], ['emagrecer rapido', 9], ['pilulas para emagrecer', 10], ['medicamentos baratos', 8], ['aumento peniano', 10],
        ],
    },
    adult: {
        cap: 30,
        phrases: [
            ['hot singles', 10], ['xxx', 8], ['naked', 5], ['nudes', 8], ['adult dating', 10], ['meet singles', 7], ['sexy girls', 10], ['sex tonight', 10], ['live cam', 6], ['webcam girls', 9],
            ['mujeres solteras', 8], ['citas para adultos', 10], ['conoce mujeres', 7], ['chicas sexis', 10], ['sexo esta noche', 10], ['fotos intimas', 8],
            ['mulheres solteiras', 8], ['encontros adultos', 10], ['conheca mulheres', 7], ['garotas sexy', 10], ['sexo hoje', 9],
        ],
    },
    gambling: {
        cap: 26,
        phrases: [
            ['online casino', 8], ['jackpot', 5], ['free spins', 9], ['bet now', 8], ['sports betting', 6], ['poker', 3], ['slot machines', 6], ['casino bonus', 9], ['no deposit bonus', 9],
            ['casino en linea', 8], ['apuesta ahora', 8], ['apuestas deportivas', 6], ['tragamonedas', 6], ['giros gratis', 9], ['bono sin deposito', 9], ['bono de bienvenida', 4],
            ['cassino online', 8], ['aposte agora', 8], ['apostas esportivas', 6], ['caca-niqueis', 6], ['rodadas gratis', 9], ['bonus sem deposito', 9],
        ],
    },
    loan: {
        cap: 20,
        phrases: [
            ['pre-approved loan', 8], ['preapproved loan', 8], ['loan approved', 6], ['credit repair', 7], ['no credit check', 8], ['debt relief', 6], ['payday loan', 8], ['instant loan', 7], ['low interest rate loan', 5],
            ['prestamo aprobado', 7], ['prestamos sin buro', 9], ['credito inmediato', 6], ['prestamo inmediato', 7], ['sin verificacion de credito', 8], ['prestamo sin aval', 7], ['reparacion de credito', 7],
            ['emprestimo aprovado', 7], ['emprestimo sem consulta', 9], ['credito imediato', 6], ['emprestimo imediato', 7], ['limpar nome', 4],
        ],
    },
    marketing: {
        cap: 18,
        phrases: [
            ['buy now', 3], ['100% free', 6], ['risk free', 5], ['no obligation', 4], ['order now', 3], ['click below', 3], ['cash bonus', 6], ['earn money', 5], ['work from home', 5], ['make money fast', 9],
            ['extra income', 5], ['be your own boss', 6], ['miracle', 5], ['act fast', 3], ['once in a lifetime', 5], ['no strings attached', 5], ['this is not spam', 9], ['unsubscribe here if you', 3],
            ['gana dinero desde casa', 8], ['trabaja desde casa', 5], ['compra ahora', 3], ['sin compromiso', 3], ['100% gratis', 6], ['sin riesgo', 4], ['gana dinero rapido', 9], ['ingresos extra', 5], ['sea su propio jefe', 6],
            ['oferta unica', 4], ['esto no es spam', 9], ['haga clic abajo', 3],
            ['ganhe dinheiro', 6], ['trabalhe em casa', 5], ['compre agora', 3], ['sem compromisso', 3], ['100% gratis', 6], ['sem risco', 4], ['ganhe dinheiro rapido', 9], ['renda extra', 5], ['oferta imperdivel', 3],
            ['isso nao e spam', 9], ['clique abaixo', 3],
        ],
    },
    urgency: {
        cap: 8,
        phrases: [
            ['act now', 3], ['expires today', 3], ['within 24 hours', 4], ['final notice', 4], ['last warning', 5], ['immediately', 1], ['urgent', 2], ['respond immediately', 4],
            ['actua ahora', 3], ['expira hoy', 3], ['en 24 horas', 4], ['aviso final', 4], ['ultimo aviso', 5], ['inmediatamente', 1], ['urgente', 2], ['responda de inmediato', 4], ['en las proximas 24 horas', 4],
            ['aja agora', 3], ['expira hoje', 3], ['em 24 horas', 4], ['ultimo aviso', 5], ['imediatamente', 1], ['responda imediatamente', 4],
        ],
    },
};

/** Frases que indican que el cuerpo cita una contrasena de archivo comprimido (att.archive_password). */
export const ARCHIVE_PASSWORD_HINTS = [
    'password:', 'password is', 'the password', 'archive password', 'zip password', 'contrasena:', 'la contrasena', 'clave:', 'la clave es', 'contrasena del archivo', 'senha:', 'a senha e', 'senha do arquivo', 'pwd:',
];

/** Fragmentos de X-Mailer / User-Agent de herramientas de envio masivo asociadas a spam. */
export const SUSPICIOUS_MAILERS = [
    'mass mailer', 'atomic mail sender', 'send-safe', 'sendsafe', 'stormpost', 'advanced mass sender', 'gammadyne', 'bulk mailer', 'turbo mailer', 'mailer pro', 
    'emailblaster', 'phpmailer 5', 'phpmailer 4', 'swiftmailer 3', 'the bat! spam', 'dark mailer', 'massmail', 'senderx', 'supermailer', 'mail.ru mass',
];

export const URL_SHORTENERS = new Set([
    'bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'cutt.ly', 'shorturl.at', 'rebrand.ly', 'tiny.cc', 'rb.gy', 'v.gd', 'bl.ink', 't.ly', 'shorte.st', 'adf.ly',
    'lnkd.in', 'soo.gd', 'clck.ru', 'qr.ae', 'trib.al', 'u.to', 's.id', 'urlz.fr', 'hyperurl.co', 'cli.re', 'x.co', 'ouo.io', 'bc.vc',
]);

export const RISKY_TLDS = new Set([
    'zip', 'mov', 'top', 'xyz', 'click', 'work', 'icu', 'gq', 'cf', 'tk', 'ml', 'ga', 'cyou', 'buzz', 'sbs', 'rest', 'monster', 'quest', 'lol', 'bar', 'cam', 'country', 'kim', 'loan', 'men', 'party', 'review', 'stream', 'download', 'racing', 'win', 'bid', 'trade', 'date', 'faith', 'science', 'accountant', 'cricket',
]);

export const DANGEROUS_EXT = new Set([
    'exe', 'scr', 'bat', 'cmd', 'com', 'pif', 'msi', 'msp', 'jar', 'js', 'jse', 'vbs', 'vbe', 'wsf', 'wsh', 'ps1', 'psm1', 'lnk', 'iso', 'img', 'hta', 'cpl', 'reg', 'dll', 'apk', 'appx', 'msix', 'sh', 'bin', 'gadget', 'inf', 'scf', 'vhd', 'vhdx',
]);
export const MACRO_EXT = new Set(['docm', 'xlsm', 'pptm', 'xlam', 'dotm', 'xlsb', 'ppam', 'sldm']);
export const HTML_EXT = new Set(['html', 'htm', 'shtml', 'xhtml', 'svg', 'mht', 'mhtml']);
export const ARCHIVE_EXT = new Set(['zip', 'rar', '7z', 'gz', 'tgz', 'tar', 'ace', 'cab', 'arj', 'z']);
export const DOC_EXT = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'jpg', 'jpeg', 'png', 'gif', 'rtf', 'csv', 'odt']);

export const FREEMAIL = new Set([
    'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.es', 'yahoo.com.br', 'ymail.com', 'aol.com', 'mail.com', 'gmx.com', 'gmx.net', 'gmx.es',
    'proton.me', 'protonmail.com', 'icloud.com', 'me.com', 'yandex.com', 'yandex.ru', 'zoho.com', 'mail.ru', 'qq.com', '163.com', 'hotmail.es', 'outlook.es', 'hotmail.com.br', 'outlook.com.br', 'bol.com.br', 'uol.com.br', 'terra.com.br',
]);

/** Palabras de rol/organizacion que, en el nombre visible de una cuenta de correo gratuito, indican suplantacion de una organizacion. */
export const ROLE_WORDS = /\b(helpdesk|help desk|admin|administrator|administrador|security|seguridad|seguranca|support|soporte|suporte|billing|facturacion|faturamento|accounts?|contabilidade|payments?|pagos|pagamentos|team|equipo|equipe|service|servicio|servico|customer|cliente|delivery|noreply|no-reply|notification|notificacion|verification|official|oficial)\b/i;
