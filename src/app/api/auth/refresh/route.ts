import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, isSessionPayload, renewSessionIfNeeded, verifyJWT } from "@/lib/jwt";
import { SESSION_COOKIE_OPTIONS } from "@/lib/session";
import { checkSessionNotRevoked } from "@/lib/session-revocation";
import { getClientIp, rateLimit } from "@/lib/security";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * POST /api/auth/refresh  { token }   (o Authorization: Bearer)
 * Renovacion deslizante de un JWT de sesion valido (misma jti, respeta el tope absoluto).
 * Lo usa la boveda multicuenta del cliente para que las cuentas inactivas no caduquen mientras se sigan usando.
 * No resucita tokens caducados ni revocados. Si el token es el de la cookie actual, tambien renueva la cookie.
 */
export async function POST(req: NextRequest) {
    const ip = getClientIp(req);
    const rl = rateLimit(`refresh:${ip}`, 120, 60_000);
    if (!rl.ok) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { ...NO_STORE, "Retry-After": String(rl.retryAfter) } });
    }

    const body = await req.json().catch(() => ({} as any));
    const authHeader = req.headers.get("authorization");
    const token: string | null =
        typeof body?.token === "string" ? body.token : authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token || token.length > 4096) {
        return NextResponse.json({ error: "Missing token" }, { status: 400, headers: NO_STORE });
    }

    const verified = await verifyJWT(token);
    if (!isSessionPayload(verified)) return NextResponse.json({ error: "Invalid token" }, { status: 401, headers: NO_STORE });
    const check = await checkSessionNotRevoked(verified as any);
    if (!check.valid) {
        // Un fallo de infraestructura NO debe hacer que el cliente descarte la cuenta: 503 (reintentable) y no 401
        if (check.reason === "error") return NextResponse.json({ error: "Temporarily unavailable" }, { status: 503, headers: NO_STORE });
        return NextResponse.json({ error: "Invalid token" }, { status: 401, headers: NO_STORE });
    }
    const payload = verified;

    const renewed = await renewSessionIfNeeded(payload);
    const outToken = renewed?.token ?? token;

    const cookieStore = await cookies();
    if (renewed && cookieStore.get(COOKIE_NAME)?.value === token) {
        cookieStore.set(COOKIE_NAME, renewed.token, { ...SESSION_COOKIE_OPTIONS, maxAge: renewed.ttl });
    }

    return NextResponse.json(
        { token: outToken, renewed: !!renewed, expiresAt: (renewed ? undefined : payload.exp) ?? null },
        { headers: NO_STORE }
    );
}
