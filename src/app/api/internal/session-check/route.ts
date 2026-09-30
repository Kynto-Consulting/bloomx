import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { checkSessionNotRevoked } from '@/lib/session-revocation';
import { safeEqual } from '@/lib/security';

/**
 * Comprobacion de revocacion de sesion para bloomx-backend cuando NO comparte base de datos con el frontend.
 *
 * Auth: firma HMAC-SHA256 (hex) de `${timestamp}.${cuerpo}` con INTERNAL_SECRET (o EXTENSION_HOOKS_SECRET), en
 * `x-bloomx-signature` + `x-bloomx-timestamp` (ventana de +-60 s). El secreto nunca viaja. Sin secreto => 503 (fail-closed).
 * Es solo lectura: un reenvio dentro de la ventana no cambia ningun estado. El cuerpo NO incluye el JWT, solo claims.
 * Respuesta: { valid: boolean, reason? }.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 2048;
const MAX_SKEW_SECONDS = 60;
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req: NextRequest) {
    const secret = process.env.INTERNAL_SECRET || process.env.EXTENSION_HOOKS_SECRET;
    if (!secret) return NextResponse.json({ error: 'Service not configured' }, { status: 503, headers: NO_STORE });

    const ts = Number(req.headers.get('x-bloomx-timestamp'));
    const signature = req.headers.get('x-bloomx-signature') || '';
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > MAX_SKEW_SECONDS || !/^[0-9a-f]{64}$/.test(signature)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
    }

    const declared = Number(req.headers.get('content-length') || 0);
    if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: 'Payload too large' }, { status: 413, headers: NO_STORE });
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Payload too large' }, { status: 413, headers: NO_STORE });

    const expected = crypto.createHmac('sha256', secret).update(`${Math.trunc(ts)}.${raw}`).digest('hex');
    if (!safeEqual(signature, expected)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
    }

    let body: any = null;
    try { body = JSON.parse(raw); } catch { body = null; }
    if (!body || typeof body.sub !== 'string' || !body.sub || body.sub.length > 128
        || (body.jti !== null && body.jti !== undefined && (typeof body.jti !== 'string' || body.jti.length > 128))) {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: NO_STORE });
    }

    const result = await checkSessionNotRevoked({
        sub: body.sub,
        jti: typeof body.jti === 'string' ? body.jti : undefined,
        tv: typeof body.tv === 'number' ? body.tv : 0,
        // Sin jti (token heredado) la antiguedad ya la valido el backend con el iat firmado; aqui solo importa tv.
        iat: typeof body.jti === 'string' && typeof body.iat === 'number' ? body.iat : Math.floor(Date.now() / 1000),
    });
    // "error" = fallo de BD del frontend: 503 para que el backend aplique su politica fail-open/closed.
    if (!result.valid && result.reason === 'error') {
        return NextResponse.json({ error: 'Unavailable' }, { status: 503, headers: NO_STORE });
    }
    return NextResponse.json(result.valid ? { valid: true } : { valid: false, reason: result.reason }, { headers: NO_STORE });
}
