/**
 * Motivos legibles (es/en) de cada senal. Se guardan SOLO ids y parametros; el texto se genera al mostrarlo, asi que cambia de idioma
 * con el usuario y nunca se persiste contenido del correo. Los parametros se escapan al insertarse (son texto plano en React).
 */
export type Lang = 'es' | 'en';

const T: Record<string, { es: string; en: string }> = {
    'origin.xspam': { es: 'El servidor de origen ya lo marcó como spam (X-Spam, {score}).', en: 'The originating server already flagged it as spam (X-Spam, {score}).' },
    'origin.xspam_partial': { es: 'El servidor de origen le dio una puntuación de spam intermedia ({score}).', en: 'The originating server gave it a moderate spam score ({score}).' },

    'auth.none': { es: 'No trae ninguna información de autenticación (SPF/DKIM/DMARC).', en: 'It carries no authentication information (SPF/DKIM/DMARC).' },
    'auth.no_results': { es: 'SPF, DKIM y DMARC no dieron resultado: el remitente no se puede verificar.', en: 'SPF, DKIM and DMARC returned nothing: the sender cannot be verified.' },
    'auth.dmarc_fail': { es: 'Falló DMARC: el remitente no está autorizado a usar ese dominio.', en: 'DMARC failed: the sender is not authorized to use that domain.' },
    'auth.dmarc_pass': { es: 'Pasó DMARC (el remitente es quien dice ser).', en: 'DMARC passed (the sender is who they claim to be).' },
    'auth.spf_fail': { es: 'Falló SPF: el servidor de envío no está autorizado por el dominio.', en: 'SPF failed: the sending server is not authorized by the domain.' },
    'auth.spf_softfail': { es: 'SPF dudoso (softfail): el servidor de envío no es el habitual del dominio.', en: 'SPF softfail: the sending server is not the domain\'s usual one.' },
    'auth.spf_error': { es: 'Error permanente al comprobar SPF.', en: 'Permanent error while checking SPF.' },
    'auth.spf_neutral': { es: 'SPF neutral: el dominio no se pronuncia.', en: 'SPF neutral: the domain takes no position.' },
    'auth.dkim_fail': { es: 'Falló la firma DKIM: el mensaje pudo alterarse o la firma es falsa.', en: 'The DKIM signature failed: the message may have been altered or the signature is fake.' },
    'auth.not_aligned': { es: 'La autenticación pasa, pero no está alineada con el dominio del remitente visible.', en: 'Authentication passes, but not aligned with the visible sender domain.' },
    'auth.arc_fail': { es: 'Falló la cadena ARC de reenvío.', en: 'The ARC forwarding chain failed.' },
    'auth.arc_pass': { es: 'Reenviado con cadena ARC válida (resta sospecha).', en: 'Forwarded with a valid ARC chain (reduces suspicion).' },

    'hdr.from_missing': { es: 'No tiene una dirección de remitente válida.', en: 'It has no valid sender address.' },
    'hdr.from_risky_tld': { es: 'El dominio del remitente usa una extensión de alto riesgo (.{tld}).', en: 'The sender domain uses a high-risk extension (.{tld}).' },
    'hdr.msgid_missing': { es: 'Falta el identificador Message-ID.', en: 'The Message-ID is missing.' },
    'hdr.msgid_mismatch': { es: 'El Message-ID pertenece a otro dominio ({domain}).', en: 'The Message-ID belongs to a different domain ({domain}).' },
    'hdr.date_missing': { es: 'Falta la fecha del mensaje.', en: 'The message date is missing.' },
    'hdr.date_invalid': { es: 'La fecha del mensaje no es válida.', en: 'The message date is invalid.' },
    'hdr.date_future': { es: 'La fecha del mensaje está en el futuro.', en: 'The message date is in the future.' },
    'hdr.replyto_mismatch': { es: 'Las respuestas irían a otro dominio ({domain}).', en: 'Replies would go to a different domain ({domain}).' },
    'hdr.envelope_mismatch': { es: 'El remitente técnico (Return-Path, {domain}) no coincide con el visible.', en: 'The technical sender (Return-Path, {domain}) does not match the visible one.' },
    'hdr.received_ip': { es: 'Salió de un servidor identificado solo por una dirección IP.', en: 'It came from a server identified only by an IP address.' },
    'hdr.received_odd': { es: 'La ruta de servidores (Received) es anómala.', en: 'The server path (Received) is anomalous.' },
    'hdr.mailer': { es: 'Enviado con una herramienta de envío masivo asociada a spam ({mailer}).', en: 'Sent with a mass-mailing tool associated with spam ({mailer}).' },
    'hdr.recipients': { es: 'Va dirigido a {n} destinatarios.', en: 'It is addressed to {n} recipients.' },
    'hdr.bulk_no_unsub': { es: 'Se declara envío masivo pero no ofrece darse de baja.', en: 'It declares bulk mail but offers no unsubscribe.' },
    'hdr.list_unsub': { es: 'Ofrece darse de baja (envío legítimo de lista, promocional).', en: 'It offers an unsubscribe link (legitimate list mail, promotional).' },

    'content.lex.phishing': { es: 'Frases típicas de phishing ({phrases}).', en: 'Typical phishing phrases ({phrases}).' },
    'content.lex.fraud': { es: 'Frases típicas de estafa o premio ({phrases}).', en: 'Typical scam or prize phrases ({phrases}).' },
    'content.lex.crypto': { es: 'Ofertas de criptomonedas o inversión ({phrases}).', en: 'Crypto or investment offers ({phrases}).' },
    'content.lex.invoice': { es: 'Frases de factura, pago o envío falsos ({phrases}).', en: 'Fake invoice, payment or shipping phrases ({phrases}).' },
    'content.lex.pharma': { es: 'Ofertas farmacéuticas ({phrases}).', en: 'Pharmaceutical offers ({phrases}).' },
    'content.lex.adult': { es: 'Contenido para adultos ({phrases}).', en: 'Adult content ({phrases}).' },
    'content.lex.gambling': { es: 'Apuestas o casinos ({phrases}).', en: 'Gambling or casinos ({phrases}).' },
    'content.lex.loan': { es: 'Ofertas de préstamos ({phrases}).', en: 'Loan offers ({phrases}).' },
    'content.lex.marketing': { es: 'Lenguaje de marketing agresivo ({phrases}).', en: 'Aggressive marketing language ({phrases}).' },
    'content.lex.urgency': { es: 'Lenguaje de urgencia ({phrases}).', en: 'Urgency language ({phrases}).' },
    'content.lex.bec': { es: 'Frases típicas de fraude del director/proveedor ({phrases}).', en: 'Typical CEO/vendor fraud phrases ({phrases}).' },
    'content.density': { es: 'Muchas frases sospechosas a la vez ({n}).', en: 'Many suspicious phrases at once ({n}).' },
    'content.link_only': { es: 'Solo contiene un enlace, sin texto que lo explique.', en: 'It contains just a link, with no explanatory text.' },
    'content.subject_caps': { es: 'El asunto está casi todo en mayúsculas.', en: 'The subject is almost all capitals.' },
    'content.subject_exclaim': { es: 'El asunto abusa de los signos de exclamación.', en: 'The subject overuses exclamation marks.' },
    'content.body_caps': { es: 'Proporción anómala de mayúsculas en el cuerpo.', en: 'Abnormal proportion of capitals in the body.' },
    'content.body_exclaim': { es: 'Abuso de signos de exclamación en el cuerpo.', en: 'Overuse of exclamation marks in the body.' },
    'content.hidden_text': { es: 'Contiene texto oculto ({chars} caracteres).', en: 'It contains hidden text ({chars} characters).' },
    'content.image_only': { es: 'Es solo una imagen, sin texto legible.', en: 'It is just an image, with no readable text.' },
    'content.html_broken': { es: 'HTML mal formado (etiquetas sin cerrar).', en: 'Malformed HTML (unclosed tags).' },
    'content.html_ratio': { es: 'Mucho HTML para muy poco texto visible.', en: 'A lot of HTML for very little visible text.' },
    'content.base64': { es: 'Bloque enorme codificado en base64 dentro del cuerpo.', en: 'A huge base64-encoded block inside the body.' },
    'content.homoglyph': { es: 'Mezcla letras de alfabetos distintos para imitar palabras (homoglifos).', en: 'It mixes letters from different alphabets to mimic words (homoglyphs).' },
    'content.zero_width': { es: 'Caracteres invisibles de ancho cero ({n}) para evadir filtros.', en: 'Invisible zero-width characters ({n}) to evade filters.' },
    'content.spaced': { es: 'Texto partido con espacios o puntos para evadir filtros.', en: 'Text split with spaces or dots to evade filters.' },
    'content.subject_encoded': { es: 'Asunto codificado sin necesidad (texto simple en base64/QP).', en: 'Subject needlessly encoded (plain text in base64/QP).' },

    'link.ip_host': { es: 'Un enlace apunta a una dirección IP ({host}).', en: 'A link points to an IP address ({host}).' },
    'link.homograph': { es: 'Enlace con dominio que imita a otro con letras parecidas ({host}).', en: 'Link with a look-alike domain using similar letters ({host}).' },
    'link.punycode': { es: 'Enlace con dominio internacional codificado (punycode, {host}).', en: 'Link with an encoded international domain (punycode, {host}).' },
    'link.shortener': { es: 'Usa acortadores de enlaces ({n}) que ocultan el destino.', en: 'Uses link shorteners ({n}) that hide the destination.' },
    'link.risky_tld': { es: 'Enlace a un dominio de alto riesgo (.{tld}).', en: 'Link to a high-risk domain (.{tld}).' },
    'link.odd_port': { es: 'Enlace con puerto poco habitual ({port}).', en: 'Link with an unusual port ({port}).' },
    'link.userinfo': { es: 'Enlace con usuario o contraseña incrustados (disfraza el destino real: {host}).', en: 'Link with embedded credentials (disguises the real target: {host}).' },
    'link.long_redirect': { es: 'Enlace con una redirección larga hacia otra dirección.', en: 'Link with a long redirect to another address.' },
    'link.lookalike': { es: 'Enlace a un dominio que imita a una marca conocida ({host}).', en: 'Link to a domain imitating a well-known brand ({host}).' },
    'link.text_mismatch': { es: 'El enlace muestra {shown} pero lleva a {host}.', en: 'The link displays {shown} but goes to {host}.' },
    'link.text_mismatch_soft': { es: 'El enlace muestra {shown} y pasa por {host} (posible seguimiento).', en: 'The link displays {shown} and goes through {host} (possible tracking).' },
    'link.many': { es: 'Contiene {n} enlaces.', en: 'It contains {n} links.' },

    'att.blocked_type': { es: 'Adjunto peligroso detectado por contenido ({file}).', en: 'Dangerous attachment detected by content ({file}).' },
    'att.dangerous_ext': { es: 'Adjunto ejecutable o peligroso ({file}).', en: 'Executable or dangerous attachment ({file}).' },
    'att.macro': { es: 'Documento con macros ({file}).', en: 'Document with macros ({file}).' },
    'att.html': { es: 'Adjunto HTML/SVG ({file}): se usa para páginas de phishing.', en: 'HTML/SVG attachment ({file}): used for phishing pages.' },
    'att.double_ext': { es: 'Doble extensión engañosa ({file}).', en: 'Deceptive double extension ({file}).' },
    'att.type_mismatch': { es: 'El tipo real del adjunto no coincide con el declarado ({file}).', en: 'The real attachment type does not match the declared one ({file}).' },
    'att.archive': { es: 'Adjunto comprimido ({file}): el antivirus no puede inspeccionarlo a simple vista.', en: 'Compressed attachment ({file}): hard to inspect at a glance.' },
    'att.archive_password': { es: 'Archivo comprimido con la contraseña indicada en el cuerpo (evita el antivirus).', en: 'Compressed archive with its password given in the body (evades antivirus).' },

    'imp.name_brand': { es: 'El nombre dice ser una marca ({brand}) pero el dominio es {domain}.', en: 'The name claims to be a brand ({brand}) but the domain is {domain}.' },
    'imp.brand_noauth': { es: 'Dice ser una marca y no supera ninguna autenticación alineada.', en: 'It claims to be a brand and passes no aligned authentication.' },
    'imp.lookalike_from': { es: 'El dominio del remitente ({domain}) imita a una marca conocida.', en: 'The sender domain ({domain}) imitates a well-known brand.' },
    'imp.brand_domain_fail': { es: 'Usa el dominio de una marca conocida pero falla la autenticación: falsificación.', en: 'It uses a well-known brand\'s domain but fails authentication: spoofing.' },
    'imp.own_domain_spoof': { es: 'Falsifica el dominio de esta organización y falla la autenticación.', en: 'It forges this organization\'s domain and fails authentication.' },
    'imp.freemail_role': { es: 'Nombre de departamento u organización enviado desde una cuenta gratuita ({domain}).', en: 'Department or organization name sent from a free account ({domain}).' },
    'imp.name_address': { es: 'El nombre visible muestra otra dirección ({shown}).', en: 'The visible name shows a different address ({shown}).' },
    'imp.name_domain': { es: 'El nombre visible menciona otro dominio ({shown}).', en: 'The visible name mentions a different domain ({shown}).' },
    'imp.allow_spoof': { es: 'Posible suplantación: el remitente está en la lista de permitidos pero falla la autenticación alineada.', en: 'Possible spoofing: the sender is on the allow list but fails aligned authentication.' },

    'combo.families': { es: 'Varias señales independientes coinciden ({n} familias).', en: 'Several independent signals agree ({n} families).' },
    'ctx.contact': { es: 'El remitente está en tus contactos.', en: 'The sender is in your contacts.' },
    'ctx.replied': { es: 'Ya le respondiste antes.', en: 'You have replied to them before.' },
    'ctx.thread': { es: 'Responde a un mensaje que enviaste tú.', en: 'It replies to a message you sent.' },
    'ctx.ham_history': { es: 'Has recibido {n} correo(s) legítimo(s) de este remitente o dominio.', en: 'You have received {n} legitimate message(s) from this sender or domain.' },
    'ctx.spam_history': { es: 'Has marcado {n} correo(s) de este remitente o dominio como spam.', en: 'You have marked {n} message(s) from this sender or domain as spam.' },
    'ctx.first_contact': { es: 'Es la primera vez que este remitente te escribe.', en: 'This is the first time this sender writes to you.' },

    'learn.bayes': { es: 'Se parece a correos que marcaste antes ({tokens} términos coinciden).', en: 'It resembles messages you marked before ({tokens} matching terms).' },
};

export const SIGNAL_IDS: readonly string[] = Object.keys(T);

function fill(tpl: string, params: Record<string, string | number> | undefined): string {
    return tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? '').replace(/[\u0000-\u001f​-‏‪-‮]/g, ''));
}

export function explainSignal(s: { id: string; params?: Record<string, string | number> }, lang: Lang = 'es'): string {
    const t = T[s.id];
    if (!t) return s.id;
    return fill(t[lang] ?? t.es, s.params);
}

export const REASON_TABLE = T;

/** Reglas de bloqueo y decisiones no basadas en senales (para el registro). */
export const BLOCK_REASON: Record<string, { es: string; en: string }> = {
    'block.email': { es: 'Remitente bloqueado (dirección exacta).', en: 'Blocked sender (exact address).' },
    'block.domain': { es: 'Dominio bloqueado.', en: 'Blocked domain.' },
    'block.wildcard': { es: 'Comodín *@dominio bloqueado.', en: 'Blocked *@domain wildcard.' },
    'block.tld': { es: 'Extensión de dominio (TLD) bloqueada.', en: 'Blocked top-level domain.' },
    'block.regex': { es: 'Coincide con una regla de expresión regular de bloqueo.', en: 'Matches a blocking regular-expression rule.' },
};
