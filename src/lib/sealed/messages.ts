/**
 * Textos es/en del envio sellado (composer y visor). Diccionario propio y puro (sin React) para poder probarlo y para no
 * mezclarlo con los diccionarios generales. Uso: `const m = sealedMessages(locale)`.
 */
export type SealedLocale = 'es' | 'en';

interface Shape {
    // ---- visor
    viewerTitle: string; viewerSubtitle: string; opening: string; notFound: string; noKey: string; unavailable: string;
    generic: string; altered: string; wrongPassword: string; gateLimited: string; gateRemaining: (n: number) => string;
    gateButton: string; passwordIntro: string; passwordCountsView: string; passwordLabel: string; unlock: string;
    from: string; sent: string; footerUnlimited: string; footerRemaining: (n: number) => string; footerLast: string;
    // ---- composer
    composerLegend: string; sealToggle: string; sealIntro: string; passwordField: string; passwordHint: string;
    passwordRisk: string; passwordMissingConfirm: string; viewsField: string; viewsUnlimited: string;
    views1: string; views3: string; views10: string; copyLink: string; copyLinkHelp: string; copying: string;
    copied: string; copyFailed: string; copyEmpty: string; noAttachments: string;
}

const es: Shape = {
    viewerTitle: 'Mensaje seguro',
    viewerSubtitle: 'Cifrado de extremo a extremo en el navegador del remitente',
    opening: 'Abriendo mensaje...',
    notFound: 'Este mensaje no existe, ha caducado o alcanzó su límite de vistas.',
    noKey: 'El enlace está incompleto: falta la clave de descifrado (la parte después de # en la dirección). Abre de nuevo el enlace original.',
    unavailable: 'Tu navegador no puede descifrar este mensaje (WebCrypto no disponible). Usa un navegador actual con HTTPS.',
    generic: 'No se pudo abrir el mensaje. Inténtalo más tarde.',
    altered: 'No se pudo descifrar el mensaje: el enlace está incompleto o fue alterado.',
    wrongPassword: 'Contraseña incorrecta, o el enlace fue alterado.',
    gateLimited: 'Este mensaje se puede abrir un número limitado de veces. Al pulsar "Ver mensaje" se gasta una vista.',
    gateRemaining: (n) => `Vistas restantes: ${n}.`,
    gateButton: 'Ver mensaje',
    passwordIntro: 'Este mensaje también está protegido con una contraseña. Pídesela al remitente.',
    passwordCountsView: 'Si el mensaje tiene límite de vistas, al desbloquearlo se cuenta una; los reintentos de contraseña no gastan más.',
    passwordLabel: 'Contraseña',
    unlock: 'Desbloquear',
    from: 'De:',
    sent: 'Enviado:',
    footerUnlimited: 'Este mensaje se envió de forma segura. El enlace puede caducar. Al recargar la página se pierde el mensaje: guarda lo que necesites.',
    footerRemaining: (n) => `Este enlace se puede abrir ${n} vez/veces más. Recargar la página NO gasta vistas, pero cierra el mensaje: la clave ya no está en el enlace.`,
    footerLast: 'Esta fue la última vista permitida: el mensaje se borró del servidor. Recargar no funcionará.',
    composerLegend: 'Opciones de envío sellado',
    sealToggle: 'Enviar sellado (cifrado de extremo a extremo)',
    sealIntro: 'El mensaje se cifra en este navegador; el correo lleva solo un enlace y la clave va en la parte del enlace que nunca llega al servidor web. No admite adjuntos y el asunto viaja en claro.',
    passwordField: 'Contraseña (recomendada, mínimo 8)',
    passwordHint: 'Sin contraseña, quien lea el correo puede abrir el mensaje.',
    passwordRisk: 'Aviso: la clave viaja dentro del enlace del correo. Los servidores de correo (y los sistemas DLP o antivirus que analizan enlaces) pueden leerla. Comparte la contraseña por OTRO canal (mensajería, llamada), nunca en el mismo correo.',
    passwordMissingConfirm: 'Vas a enviar sin contraseña: cualquiera con acceso al correo (incluido el servidor de correo) podrá leer el mensaje. ¿Enviar de todos modos?',
    viewsField: 'Límite de vistas',
    viewsUnlimited: 'Sin límite (hasta que caduque)',
    views1: '1 vista', views3: '3 vistas', views10: '10 vistas',
    copyLink: 'Copiar enlace',
    copyLinkHelp: 'Crea el mensaje sellado y copia el enlace sin enviar ningún correo, para compartirlo por otro canal.',
    copying: 'Creando enlace...',
    copied: 'Enlace copiado. No se envió ningún correo.',
    copyFailed: 'No se pudo copiar el enlace automáticamente. Cópialo manualmente:',
    copyEmpty: 'Escribe un mensaje antes de copiar el enlace.',
    noAttachments: 'El envío sellado no admite adjuntos: quítalos o desactiva "Enviar sellado".',
};

const en: Shape = {
    viewerTitle: 'Secure Message',
    viewerSubtitle: "End-to-end encrypted in the sender's browser",
    opening: 'Opening message...',
    notFound: 'This message does not exist, has expired, or has reached its view limit.',
    noKey: 'This link is incomplete: the decryption key (the part after # in the address) is missing. Open the original link again.',
    unavailable: 'Your browser cannot decrypt this message (WebCrypto is unavailable). Use a current browser over HTTPS.',
    generic: 'The message could not be opened. Try again later.',
    altered: 'The message could not be decrypted: the link is incomplete or was altered.',
    wrongPassword: 'Wrong password, or the link was altered.',
    gateLimited: 'This message can only be opened a limited number of times. Pressing "View message" uses one view.',
    gateRemaining: (n) => `Views remaining: ${n}.`,
    gateButton: 'View message',
    passwordIntro: 'This message is also protected with a password. Ask the sender for it.',
    passwordCountsView: 'If the message has a view limit, unlocking it counts one; retrying the password does not use more.',
    passwordLabel: 'Password',
    unlock: 'Unlock',
    from: 'From:',
    sent: 'Sent:',
    footerUnlimited: 'This message was sent securely. The link may expire. Reloading the page loses the message: save what you need.',
    footerRemaining: (n) => `This link can be opened ${n} more time(s). Reloading the page does NOT use views, but it closes the message: the key is no longer in the link.`,
    footerLast: 'This was the last allowed view: the message has been deleted from the server. Reloading will not work.',
    composerLegend: 'Sealed send options',
    sealToggle: 'Send sealed (end-to-end encrypted)',
    sealIntro: 'The message is encrypted in this browser; the email carries only a link, and the key sits in the part of the link that never reaches the web server. Attachments are not supported and the subject travels in clear text.',
    passwordField: 'Password (recommended, minimum 8)',
    passwordHint: 'Without a password, anyone who reads the email can open the message.',
    passwordRisk: 'Warning: the key travels inside the link in the email. Mail servers (and DLP or antivirus systems that scan links) can read it. Share the password through ANOTHER channel (chat, phone), never in the same email.',
    passwordMissingConfirm: 'You are about to send without a password: anyone with access to the email (including the mail server) will be able to read the message. Send anyway?',
    viewsField: 'View limit',
    viewsUnlimited: 'Unlimited (until it expires)',
    views1: '1 view', views3: '3 views', views10: '10 views',
    copyLink: 'Copy link',
    copyLinkHelp: 'Creates the sealed message and copies the link without sending any email, so you can share it through another channel.',
    copying: 'Creating link...',
    copied: 'Link copied. No email was sent.',
    copyFailed: 'The link could not be copied automatically. Copy it manually:',
    copyEmpty: 'Write a message before copying the link.',
    noAttachments: 'Sealed sending does not support attachments: remove them or turn off "Send sealed".',
};

export type SealedMessages = Shape;

export const SEALED_DICTIONARIES: Record<SealedLocale, SealedMessages> = { es, en };

export function sealedMessages(locale: string | undefined | null): SealedMessages {
    return SEALED_DICTIONARIES[locale === 'en' ? 'en' : 'es'];
}
