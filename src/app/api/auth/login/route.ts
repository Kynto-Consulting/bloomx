import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { setSessionCookie } from "@/lib/session";
import { auditLog, getClientIp, getDummyBcryptHash, rateLimit, rateLimitReset } from "@/lib/security";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: NextRequest) {
    const ip = getClientIp(req);
    try {
        // Rate limit por IP (CIS 5.x/6.x, NIST AC-7, ISO 27002 8.5)
        const ipRl = rateLimit(`login:ip:${ip}`, 20, 15 * 60_000);
        if (!ipRl.ok) {
            auditLog("auth.login.rate_limited", { ip, scope: "ip" });
            return NextResponse.json(
                { error: "Too many attempts. Try again later." },
                { status: 429, headers: { ...NO_STORE, "Retry-After": String(ipRl.retryAfter) } }
            );
        }

        const body = await req.json();
        const { email, password } = body ?? {};

        if (!email || !password || typeof email !== "string" || typeof password !== "string" || email.length > 254 || password.length > 1024) {
            return NextResponse.json({ error: "Missing fields" }, { status: 400, headers: NO_STORE });
        }

        // Lockout progresivo por cuenta: 10 fallos / 15 min
        const acctKey = `login:acct:${email.trim().toLowerCase()}`;
        const acctRl = rateLimit(acctKey, 10, 15 * 60_000);
        if (!acctRl.ok) {
            auditLog("auth.login.locked", { email, ip });
            return NextResponse.json(
                { error: "Too many attempts. Try again later." },
                { status: 429, headers: { ...NO_STORE, "Retry-After": String(acctRl.retryAfter) } }
            );
        }

        const user = await prisma.user.findUnique({
            where: { email },
        });

        // Se ejecuta siempre un bcrypt.compare para igualar tiempos (anti-enumeracion)
        const hash = user?.password || (await getDummyBcryptHash());
        const isValid = await bcrypt.compare(password, hash);

        if (!user || !user.password || !isValid) {
            auditLog("auth.login.failure", { email, ip });
            return NextResponse.json({ error: "Invalid credentials" }, { status: 401, headers: NO_STORE });
        }

        rateLimitReset(acctKey);

        // Create Session
        const token = await setSessionCookie({
            sub: user.id,
            email: user.email,
            name: user.name,
        });

        auditLog("auth.login.success", { userId: user.id, email: user.email, ip });

        return NextResponse.json(
            { success: true, token, user: { id: user.id, email: user.email, name: user.name } },
            { headers: NO_STORE }
        );

    } catch (error) {
        console.error("Login error:", error instanceof Error ? error.message : "unknown");
        return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
    }
}
