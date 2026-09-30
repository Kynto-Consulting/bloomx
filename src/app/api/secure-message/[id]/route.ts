import { NextRequest, NextResponse } from 'next/server';
import { getClientIp, rateLimitAsync } from '@/lib/security';
import { SECURE_ID_RE } from '@/lib/sealed/schema';
import { consume, defaultDeps, getMeta } from '@/lib/sealed/store';

/**
 * Abrir un mensaje sellado (publico: el destinatario no tiene cuenta; el id es un UUID v4 no adivinable y el contenido
 * va cifrado con una clave que este servidor no tiene).
 *
 *   GET  -> metadatos (sin contenido, NO cuenta vista): formato, si pide contrasena, remitente, caducidad, vistas restantes.
 *           Los escaneres/prefetch de enlaces (GET sin JS) nunca consumen vistas.
 *   POST -> "reveal": entrega el sobre cifrado y CUENTA una vista de forma atomica en BD (al agotarlas el objeto se
 *           borra). Solo lo llama el visor tras un gesto del usuario (o automaticamente si no hay limite de vistas) y
 *           exige la cabecera `X-Sealed-Reveal: 1` (un formulario o <img> de terceros no puede gastar vistas).
 * Un id inexistente, caducado o agotado responde igual (404).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' };
const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: HEADERS });

type Ctx = { params: Promise<{ id: string }> };

async function limited(req: NextRequest, id: string, kind: 'meta' | 'open'): Promise<NextResponse | null> {
    const ip = getClientIp(req);
    const perIp = await rateLimitAsync(`secure-${kind}:ip:${ip}`, kind === 'open' ? 60 : 120, 60_000);
    const perId = await rateLimitAsync(`secure-${kind}:id:${id}`, kind === 'open' ? 120 : 240, 60 * 60_000);
    if (!perIp.ok || !perId.ok) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { ...HEADERS, 'Retry-After': String(Math.max(perIp.retryAfter, perId.retryAfter)) } });
    }
    return null;
}

export async function GET(req: NextRequest, { params }: Ctx) {
    const { id } = await params;
    if (!SECURE_ID_RE.test(id)) return NOT_FOUND();
    const blocked = await limited(req, id, 'meta');
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
    if (req.headers.get('x-sealed-reveal') !== '1') {
        return NextResponse.json({ error: 'Bad request' }, { status: 400, headers: HEADERS });
    }
    const blocked = await limited(req, id, 'open');
    if (blocked) return blocked;
    try {
        const result = await consume(await defaultDeps(), id);
        return result ? NextResponse.json({ success: true, ...result }, { headers: HEADERS }) : NOT_FOUND();
    } catch (e: any) {
        console.error('Secure open error', String(e?.message || 'error').slice(0, 120));
        return NextResponse.json({ error: 'Failed' }, { status: 500, headers: HEADERS });
    }
}
