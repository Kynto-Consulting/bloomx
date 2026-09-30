import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifyJWT } from "@/lib/jwt";
import { SESSION_COOKIE_OPTIONS } from "@/lib/session";
import { auditLog, getClientIp, rateLimit } from "@/lib/security";

export async function POST(req: NextRequest) {
    try {
        const ip = getClientIp(req);
        const rl = rateLimit(`setcookie:${ip}`, 60, 60_000);
        if (!rl.ok) {
            return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
        }

        const body = await req.json();
        const { token } = body;

        if (!token || typeof token !== "string" || token.length > 4096) {
            return NextResponse.json({ error: "Missing token" }, { status: 400 });
        }

        // Solo se acepta un JWT firmado por este servidor y vigente (evita fijacion de sesion / cookie arbitraria).
        const payload = await verifyJWT(token);
        if (!payload || !payload.sub) {
            auditLog("session.set_cookie.rejected", { ip });
            return NextResponse.json({ error: "Invalid token" }, { status: 401 });
        }

        (await cookies()).set(COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);

        auditLog("session.switch", { userId: String(payload.sub), ip });
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: "Failed to set session" }, { status: 500 });
    }
}
