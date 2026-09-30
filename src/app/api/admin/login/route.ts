
import { NextResponse } from "next/server";
import { getClientIp, rateLimit } from "@/lib/security";

export async function POST(req: Request) {
    try {
        const rl = rateLimit(`adminlogin:${getClientIp(req)}`, 10, 15 * 60_000);
        if (!rl.ok) {
            return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
        }
        const body = await req.json();
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.bloomx.arubik.dev';

        // Forward request to Backend
        const res = await fetch(`${backendUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        // No se registra el cuerpo de la respuesta (puede contener credenciales/sesion)
        const responseText = await res.text();
        console.log("[ADMIN_LOGIN_PROXY] Backend Status:", res.status);

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.error("[ADMIN_LOGIN_PROXY] Failed to parse backend JSON");
            return NextResponse.json({ error: "Backend returned invalid response" }, { status: 502 });
        }

        if (!res.ok) {
            return NextResponse.json(data, { status: res.status });
        }

        // Extract Set-Cookie header from backend response
        const setCookieHeader = res.headers.get('set-cookie');

        // Create response and forward the cookie
        const response = NextResponse.json(data);

        if (setCookieHeader) {
            // We need to pass this cookie to the client.
            // Since we are on the same domain (conceptually, via proxy), we can just set it.
            // However, verify if 'secure' flag needs stripping for localhost 
            // (Backend handles this ideally, but let's just forward the header value)
            response.headers.set('Set-Cookie', setCookieHeader);
        }

        return response;

    } catch (error) {
        console.error("[ADMIN_LOGIN_PROXY]", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
