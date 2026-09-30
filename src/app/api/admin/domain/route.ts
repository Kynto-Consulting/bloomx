
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { DOMAIN_CONFIG_TAG } from "@/lib/domain-config-cache";

export async function GET(req: Request) {
    const guard = await requireAdmin(req);
    if (!guard.ok) return guard.response;

    try {
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.bloomx.arubik.dev';
        const cookieStore = req.headers.get("cookie") || "";

        const res = await fetch(`${backendUrl}/api/admin/domain`, {
            headers: { 'Cookie': cookieStore }
        });

        const data = await res.json();
        return NextResponse.json(data, { status: res.status });
    } catch (error) {
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function PUT(req: Request) {
    const guard = await requireAdmin(req);
    if (!guard.ok) return guard.response;

    try {
        const body = await req.json();
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.bloomx.arubik.dev';

        // We need to forward the auth cookie manually since we are proxying
        const cookieStore = req.headers.get("cookie") || "";

        const res = await fetch(`${backendUrl}/api/admin/domain`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookieStore // Forward auth_session
            },
            body: JSON.stringify(body)
        });

        const data = await res.json();

        if (!res.ok) {
            return NextResponse.json(data, { status: res.status });
        }

        // El layout cachea /api/config 60 s: se invalida para que el proximo SSR (login, recarga) ya use el tema nuevo.
        try { revalidateTag(DOMAIN_CONFIG_TAG, { expire: 0 }); } catch { /* fuera de contexto de Next (tests) */ }

        return NextResponse.json(data);

    } catch (error) {
        console.error("[ADMIN_DOMAIN_PROXY]", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
