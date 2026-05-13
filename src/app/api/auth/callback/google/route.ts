import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, setSessionCookie } from "@/lib/session";
import { patchAllUserMeetRooms } from "@/lib/google/meet";

function resolveReturnTo(state: string | null) {
    if (!state) {
        return '/dashboard';
    }

    try {
        const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
        if (typeof decoded?.returnTo === 'string' && decoded.returnTo.startsWith('/')) {
            return decoded.returnTo;
        }
    } catch {
        // Ignore malformed state.
    }

    return '/dashboard';
}

export async function GET(req: NextRequest) {
    const code = req.nextUrl.searchParams.get("code");
    const returnTo = resolveReturnTo(req.nextUrl.searchParams.get('state'));
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    const REDIRECT_URI = `${process.env.NEXTAUTH_URL}/api/auth/callback/google`;

    if (!code || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/login?error=ConfigurationError`);
    }

    try {
        // 1. Exchange code for tokens
        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                code,
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                redirect_uri: REDIRECT_URI,
                grant_type: "authorization_code",
            }),
        });

        const tokens = await tokenResponse.json();

        if (tokens.error) {
            console.error("Google Token Error:", tokens.error);
            return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/login?error=GoogleAuthFailed`);
        }

        // 2. Get User Profile
        const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
        });

        const profile = await profileResponse.json();

        if (!profile.email) {
            return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/login?error=NoEmail`);
        }

        // 3. Link Google to the current Bloomx user when available.
        const currentUser = await getCurrentUser();
        const existingGoogleAccount = await prisma.account.findUnique({
            where: {
                provider_providerAccountId: {
                    provider: 'google',
                    providerAccountId: profile.id,
                },
            },
        });

        if (currentUser && existingGoogleAccount && existingGoogleAccount.userId !== currentUser.id) {
            return NextResponse.redirect(`${process.env.NEXTAUTH_URL}${returnTo}?error=GoogleAlreadyLinked`);
        }

        let user = currentUser ? await prisma.user.findUnique({ where: { id: currentUser.id } }) : await prisma.user.findUnique({
            where: { email: profile.email },
        });

        if (!user) {
            user = await prisma.user.create({
                data: {
                    email: profile.email,
                    name: profile.name,
                    avatar: profile.picture,
                    password: "", // No password for OAuth users
                },
            });
        }

        // 4. Link Account (Optional, but good for tracking)
        await prisma.account.upsert({
            where: {
                provider_providerAccountId: {
                    provider: "google",
                    providerAccountId: profile.id,
                },
            },
            create: {
                userId: user.id,
                type: "oauth",
                provider: "google",
                providerAccountId: profile.id,
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                id_token: tokens.id_token,
                scope: tokens.scope,
                token_type: tokens.token_type,
                expires_at: Math.floor(Date.now() / 1000 + tokens.expires_in),
            },
            update: {
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token ?? undefined,
                id_token: tokens.id_token,
                scope: tokens.scope,
                expires_at: Math.floor(Date.now() / 1000 + tokens.expires_in),
            },
        });

        // 5. Create Session
        await setSessionCookie({
            sub: user.id,
            email: user.email,
            name: user.name,
        });

        // Patch existing Meet rooms in the background after reconnect.
        // Only fires if the new token has the meetings.space.created scope.
        // Only works for rooms originally created via the Meet REST API.
        if (tokens.scope?.includes('meetings.space.created')) {
            after(patchAllUserMeetRooms(user.id, tokens.access_token).catch(() => undefined));
        }

        return NextResponse.redirect(`${process.env.NEXTAUTH_URL}${returnTo}`);

    } catch (error) {
        console.error("Google Callback Error:", error);
        return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/login?error=ServerAuthError`);
    }
}
