import { NextRequest, NextResponse } from "next/server";

function resolveSafeReturnTo(returnTo: string | null) {
    if (!returnTo || !returnTo.startsWith('/')) {
        return '/dashboard';
    }

    return returnTo;
}

export async function GET(req: NextRequest) {
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const REDIRECT_URI = `${process.env.NEXTAUTH_URL}/api/auth/callback/google`;
    const state = Buffer.from(JSON.stringify({
        returnTo: resolveSafeReturnTo(req.nextUrl.searchParams.get('returnTo')),
    }), 'utf8').toString('base64url');

    if (!GOOGLE_CLIENT_ID) {
        return NextResponse.json({ error: "Google Client ID not configured" }, { status: 500 });
    }

    const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: "code",
        scope: "openid email profile https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/contacts.readonly",
        access_type: "offline",
        prompt: "consent",
        state,
    });

    return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
