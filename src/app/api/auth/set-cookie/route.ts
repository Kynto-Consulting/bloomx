import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/jwt";
import { SESSION_COOKIE_OPTIONS, verifySessionToken } from "@/lib/session";
import { auditLog, getClientIp, rateLimitAsync } from "@/lib/security";

export async function POST(req: NextRequest) {
    try {
        const ip = getClientIp(req);
        const rl = await rateLimitAsync(`setcookie:${ip}`, 60, 60_000);
        if (!rl.ok) {
            return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
        }

        const body = await req.json();
        const { token } = body;

        if (!token || typeof token !== "string" || token.length > 4096) {
            return NextResponse.json({ error: "Missing token" }, { status: 400 });
        }

        // Solo se acepta un JWT de SESION firmado por este servidor, vigente y no revocado
        // (evita fijacion de sesion / cookie arbitraria / reutilizar tokens de logout).
        const payload = await verifySessionToken(token);
        if (!payload || !payload.sub) {
            auditLog("session.set_cookie.rejected", { ip });
            return NextResponse.json({ error: "Invalid token" }, { status: 401 });
        }

        const remaining = typeof payload.exp === "number" ? Math.max(60, payload.exp - Math.floor(Date.now() / 1000)) : SESSION_COOKIE_OPTIONS.maxAge;
        (await cookies()).set(COOKIE_NAME, token, { ...SESSION_COOKIE_OPTIONS, maxAge: Math.min(remaining, SESSION_COOKIE_OPTIONS.maxAge) });

        auditLog("session.switch", { userId: String(payload.sub), ip });
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: "Failed to set session" }, { status: 500 });
    }
}
