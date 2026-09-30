import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { isSafeRelativePath } from "@/lib/security";

const OAUTH_STATE_COOKIE = "bloomx_oauth_state";

function resolveSafeReturnTo(returnTo: string | null) {
    if (!isSafeRelativePath(returnTo)) {
        return '/dashboard';
    }

    return returnTo;
}

export async function GET(req: NextRequest) {
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const REDIRECT_URI = `${process.env.NEXTAUTH_URL}/api/auth/callback/google`;
    // Nonce ligado al navegador via cookie (anti login-CSRF, RFC 6749 10.12 / NIST IA-2)
    const nonce = randomBytes(24).toString('base64url');
    const state = Buffer.from(JSON.stringify({
        returnTo: resolveSafeReturnTo(req.nextUrl.searchParams.get('returnTo')),
        nonce,
    }), 'utf8').toString('base64url');

    if (!GOOGLE_CLIENT_ID) {
        return NextResponse.json({ error: "Google Client ID not configured" }, { status: 500 });
    }

    const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: "code",
        scope: "openid email profile https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/meetings.space.created",
        access_type: "offline",
        prompt: "consent",
        state,
    });

    const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
    res.cookies.set(OAUTH_STATE_COOKIE, nonce, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/api/auth/callback/google",
        maxAge: 600,
    });
    return res;
}
