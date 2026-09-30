import { NextRequest, NextResponse } from 'next/server';
import { recordUnsubscribe, verifyUnsubscribeToken } from '@/lib/unsubscribe';
import { escapeHtmlText } from '@/lib/mail-validation';
import { getClientIp, rateLimit } from '@/lib/security';

/**
 * Endpoint publico de baja (RFC 8058).
 *  - POST  : baja "one-click" (clientes de correo: cuerpo `List-Unsubscribe=One-Click`) o desde el formulario.
 *  - GET   : pagina de confirmacion. NO da de baja por GET (los escaneres/prefetch de enlaces lo activarian).
 */

const HTML_HEADERS = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
};

function page(title: string, body: string, status = 200) {
    return new NextResponse(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtmlText(title)}</title>` +
        `<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;color:#1a1a1a}button{padding:10px 18px;font-size:15px;border-radius:8px;border:0;background:#2563eb;color:#fff;cursor:pointer}</style></head>` +
        `<body><h1 style="font-size:20px">${escapeHtmlText(title)}</h1>${body}</body></html>`,
        { status, headers: HTML_HEADERS },
    );
}

export async function GET(req: NextRequest) {
    const token = req.nextUrl.searchParams.get('t') || '';
    const data = verifyUnsubscribeToken(token);
    if (!data) return page('Invalid link', '<p>This unsubscribe link is invalid.</p>', 400);

    return page(
        'Unsubscribe',
        `<p>Stop receiving messages sent to <strong>${escapeHtmlText(data.recipient)}</strong> from this sender?</p>` +
        `<form method="POST" action="/api/webhooks/unsubscribe?t=${encodeURIComponent(token)}"><button type="submit">Unsubscribe</button></form>`,
    );
}

export async function POST(req: NextRequest) {
    const limit = rateLimit(`unsub:${getClientIp(req)}`, 30, 60_000);
    if (!limit.ok) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } });
    }

    const token = req.nextUrl.searchParams.get('t') || '';
    const data = verifyUnsubscribeToken(token);
    if (!data) return page('Invalid link', '<p>This unsubscribe link is invalid.</p>', 400);

    try {
        await recordUnsubscribe(data.sender, data.recipient);
    } catch (error) {
        console.error('Unsubscribe failed');
        return page('Error', '<p>Something went wrong. Please try again later.</p>', 500);
    }

    return page('You have been unsubscribed', '<p>You will no longer receive messages from this sender.</p>');
}
