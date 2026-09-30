import { NextRequest, NextResponse } from 'next/server';
import { getClientIp, rateLimit } from '@/lib/security';
import { SECURE_ID_RE } from '@/lib/sealed/schema';
import { consume, defaultDeps, getMeta } from '@/lib/sealed/store';

/**
 * Abrir un mensaje sellado (publico: el destinatario no tiene cuenta; el id es un UUID v4 no adivinable y el contenido
 * va cifrado con una clave que este servidor no tiene).
 *
 *   GET  -> metadatos (sin contenido, NO cuenta vista): formato, si pide contrasena, remitente, caducidad, vistas restantes.
 *   POST -> entrega el sobre cifrado y CUENTA una vista (al agotarlas el objeto se borra).
 * Un id inexistente, caducado o agotado responde igual (404).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' };
const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: HEADERS });

type Ctx = { params: Promise<{ id: string }> };

function limited(req: NextRequest, id: string, kind: 'meta' | 'open'): NextResponse | null {
    const ip = getClientIp(req);
    const perIp = rateLimit(`secure-${kind}:ip:${ip}`, kind === 'open' ? 60 : 120, 60_000);
    const perId = rateLimit(`secure-${kind}:id:${id}`, kind === 'open' ? 120 : 240, 60 * 60_000);
    if (!perIp.ok || !perId.ok) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { ...HEADERS, 'Retry-After': String(Math.max(perIp.retryAfter, perId.retryAfter)) } });
    }
    return null;
}

export async function GET(req: NextRequest, { params }: Ctx) {
    const { id } = await params;
    if (!SECURE_ID_RE.test(id)) return NOT_FOUND();
    const blocked = limited(req, id, 'meta');
    if (blocked) return blocked;
    try {
        const meta = await getMeta(await defaultDeps(), id);
        return meta ? NextResponse.json({ success: true, ...meta }, { headers: HEADERS }) : NOT_FOUND();
    } catch (e: any) {
        console.error('Secure meta error', String(e?.message || 'error').slice(0, 120));
        return NextResponse.json({ error: 'Failed' }, { status: 500, headers: HEADERS });
    }
}

export async function POST(req: NextRequest, { params }: Ctx) {
    const { id } = await params;
    if (!SECURE_ID_RE.test(id)) return NOT_FOUND();
    const blocked = limited(req, id, 'open');
    if (blocked) return blocked;
    try {
        const result = await consume(await defaultDeps(), id);
        return result ? NextResponse.json({ success: true, ...result }, { headers: HEADERS }) : NOT_FOUND();
    } catch (e: any) {
        console.error('Secure open error', String(e?.message || 'error').slice(0, 120));
        return NextResponse.json({ error: 'Failed' }, { status: 500, headers: HEADERS });
    }
}
