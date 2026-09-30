import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { recordUnsubscribe, verifyUnsubscribeToken } from '@/lib/unsubscribe';
import { escapeHtmlText } from '@/lib/mail-validation';
import { getClientIp, rateLimitAsync } from '@/lib/security';

/**
 * Endpoint publico de baja (RFC 8058).
 *  - POST  : baja "one-click" (clientes de correo: cuerpo `List-Unsubscribe=One-Click`) o desde el formulario.
 *  - GET   : pagina de confirmacion. NO da de baja por GET (los escaneres/prefetch de enlaces lo activarian).
 * La pagina es bilingue (es/en segun `?lang=` o Accept-Language), legible en claro/oscuro y sin JavaScript.
 */

export const dynamic = 'force-dynamic';

type Lang = 'es' | 'en';

const HTML_HEADERS = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
};

const T = {
    es: {
        confirmTitle: 'Darte de baja',
        confirmBody: (rcpt: string, sender: string) => `¿Quieres dejar de recibir correos de <strong>${sender}</strong> en <strong>${rcpt}</strong>?`,
        confirmHint: 'Solo afecta a esta dirección y a este remitente. Puedes cerrar esta página si fue un error.',
        button: 'Confirmar baja',
        doneTitle: 'Listo, te has dado de baja',
        doneBody: (rcpt: string, sender: string) => `<strong>${rcpt}</strong> ya no recibirá correos de <strong>${sender}</strong>.`,
        doneHint: 'Los cambios pueden tardar unos minutos en aplicarse a envíos que ya estén en curso.',
        invalidTitle: 'Enlace no válido',
        invalidBody: 'Este enlace de baja no es válido o está incompleto. Usa el enlace del correo más reciente o responde al remitente para pedir la baja.',
        errorTitle: 'No pudimos completar la baja',
        errorBody: 'Ocurrió un problema. Inténtalo de nuevo en unos minutos.',
        tooMany: 'Demasiadas solicitudes. Inténtalo de nuevo en un momento.',
        sender: 'este remitente',
        other: 'English',
    },
    en: {
        confirmTitle: 'Unsubscribe',
        confirmBody: (rcpt: string, sender: string) => `Stop receiving emails from <strong>${sender}</strong> at <strong>${rcpt}</strong>?`,
        confirmHint: 'This only affects this address and this sender. You can close this page if this was a mistake.',
        button: 'Confirm unsubscribe',
        doneTitle: 'You have been unsubscribed',
        doneBody: (rcpt: string, sender: string) => `<strong>${rcpt}</strong> will no longer receive emails from <strong>${sender}</strong>.`,
        doneHint: 'It may take a few minutes to apply to sends that are already in progress.',
        invalidTitle: 'Invalid link',
        invalidBody: 'This unsubscribe link is invalid or incomplete. Use the link from the most recent email, or reply to the sender to ask to be removed.',
        errorTitle: 'We could not complete the request',
        errorBody: 'Something went wrong. Please try again in a few minutes.',
        tooMany: 'Too many requests. Please try again in a moment.',
        sender: 'this sender',
        other: 'Español',
    },
} as const;

function pickLang(req: NextRequest): Lang {
    const q = req.nextUrl.searchParams.get('lang');
    if (q === 'es' || q === 'en') return q;
    const al = (req.headers.get('accept-language') || '').toLowerCase();
    return al.startsWith('es') || /(^|,)\s*es\b/.test(al) ? 'es' : 'en';
}

const CSS = `
:root{color-scheme:light dark;--bg:#f5f6f8;--card:#fff;--fg:#16181d;--muted:#5b6270;--border:#e2e5ea;--accent:#2563eb;--accent-fg:#fff;--ok:#15803d}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a21;--fg:#eceef2;--muted:#a3a9b6;--border:#2a2f3a;--accent:#3b82f6;--accent-fg:#fff;--ok:#4ade80}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{width:100%;max-width:460px;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:32px 28px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
h1{font-size:22px;line-height:1.25;margin:0 0 14px}p{margin:0 0 14px}.hint{color:var(--muted);font-size:14px}
strong{overflow-wrap:anywhere}
button{width:100%;padding:13px 18px;font:inherit;font-weight:600;border-radius:10px;border:0;background:var(--accent);color:var(--accent-fg);cursor:pointer}
button:hover{filter:brightness(1.08)}button:focus-visible,a:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.ok{color:var(--ok)}footer{margin-top:20px;font-size:13px;text-align:center}a{color:var(--muted)}
`;

function page(lang: Lang, req: NextRequest | null, title: string, body: string, status = 200, cls = '') {
    const other: Lang = lang === 'es' ? 'en' : 'es';
    let switchHref = '';
    if (req) {
        const u = new URL(req.nextUrl.toString());
        u.searchParams.set('lang', other);
        switchHref = `${u.pathname}${u.search}`;
    }
    return new NextResponse(
        `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">` +
        `<title>${escapeHtmlText(title)}</title><style>${CSS}</style></head>` +
        `<body><main><h1 class="${cls}">${escapeHtmlText(title)}</h1>${body}` +
        (switchHref ? `<footer><a href="${escapeHtmlText(switchHref)}" hreflang="${other}">${T[lang].other}</a></footer>` : '') +
        `</main></body></html>`,
        { status, headers: HTML_HEADERS },
    );
}

async function senderLabel(senderId: string, lang: Lang): Promise<string> {
    try {
        const u = await prisma.user.findUnique({ where: { id: senderId }, select: { name: true, email: true } });
        const label = (u?.name || u?.email || '').toString().slice(0, 120);
        if (label) return escapeHtmlText(label);
    } catch { /* sin datos del remitente: texto generico */ }
    return T[lang].sender;
}

export async function GET(req: NextRequest) {
    const lang = pickLang(req);
    const t = T[lang];
    const token = req.nextUrl.searchParams.get('t') || '';
    const data = verifyUnsubscribeToken(token);
    if (!data) return page(lang, req, t.invalidTitle, `<p>${t.invalidBody}</p>`, 400);

    const sender = await senderLabel(data.sender, lang);
    return page(
        lang, req, t.confirmTitle,
        `<p>${t.confirmBody(escapeHtmlText(data.recipient), sender)}</p>` +
        `<form method="POST" action="/api/webhooks/unsubscribe?t=${encodeURIComponent(token)}&amp;lang=${lang}"><button type="submit">${t.button}</button></form>` +
        `<p class="hint" style="margin-top:14px">${t.confirmHint}</p>`,
    );
}

export async function POST(req: NextRequest) {
    const lang = pickLang(req);
    const t = T[lang];
    const limit = await rateLimitAsync(`unsub:${getClientIp(req)}`, 30, 60_000);
    if (!limit.ok) {
        return new NextResponse(t.tooMany, { status: 429, headers: { 'Retry-After': String(limit.retryAfter), 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    const token = req.nextUrl.searchParams.get('t') || '';
    const data = verifyUnsubscribeToken(token);
    if (!data) return page(lang, req, t.invalidTitle, `<p>${t.invalidBody}</p>`, 400);

    try {
        await recordUnsubscribe(data.sender, data.recipient);
    } catch {
        console.error('Unsubscribe failed');
        return page(lang, req, t.errorTitle, `<p>${t.errorBody}</p>`, 500);
    }

    const sender = await senderLabel(data.sender, lang);
    return page(
        lang, req, t.doneTitle,
        `<p>${t.doneBody(escapeHtmlText(data.recipient), sender)}</p><p class="hint">${t.doneHint}</p>`,
        200, 'ok',
    );
}
