import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, getSessionCookie } from "@/lib/session";
import { auditLog, getClientIp } from "@/lib/security";

export async function POST(req: NextRequest) {
    const session = await getSessionCookie().catch(() => null);
    await clearSessionCookie();
    auditLog("auth.logout", { userId: session?.sub ? String(session.sub) : undefined, ip: getClientIp(req) });
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
