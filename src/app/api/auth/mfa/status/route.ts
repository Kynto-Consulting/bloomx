import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getMfaStatus, mfaRequiredFor } from "@/lib/mfa";
import { refreshPermissions } from "@/lib/permissions";

const NO_STORE = { "Cache-Control": "no-store" };

/** GET /api/auth/mfa/status: estado de MFA del usuario con sesion. */
export async function GET() {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    const status = await getMfaStatus(user.id);
    await refreshPermissions();
    return NextResponse.json({ ...status, required: mfaRequiredFor(user.email) }, { headers: NO_STORE });
}
