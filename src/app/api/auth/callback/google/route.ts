import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, setSessionCookie } from "@/lib/session";
import { patchAllUserMeetRooms } from "@/lib/google/meet";
import { auditLog, getClientIp, isSafeRelativePath, safeEqual } from "@/lib/security";

function decodeState(state: string | null): { returnTo: string; nonce: string | null } {
    const fallback = { returnTo: '/dashboard', nonce: null as string | null };
    if (!state) return fallback;

    try {
        const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
        return {
            returnTo: isSafeRelativePath(decoded?.returnTo) ? decoded.returnTo : '/dashboard',
            nonce: typeof decoded?.nonce === 'string' ? decoded.nonce : null,
        };
    } catch {
        // Ignore malformed state.
    }

    return fallback;
}

export async function GET(req: NextRequest) {
    const code = req.nextUrl.searchParams.get("code");
    const { returnTo, nonce } = decodeState(req.nextUrl.searchParams.get('state'));
    const cookieNonce = req.cookies.get('bloomx_oauth_state')?.value ?? null;
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    const REDIRECT_URI = `${process.env.NEXTAUTH_URL}/api/auth/callback/google`;

    if (!code || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/login?error=ConfigurationError`);
    }

    // Validar state/nonce contra la cookie (anti login-CSRF)
    if (!nonce || !cookieNonce || !safeEqual(nonce, cookieNonce)) {
        auditLog('auth.google.state_mismatch', { ip: getClientIp(req) });
        const bad = NextResponse.redirect(`${process.env.NEXTAUTH_URL}/login?error=InvalidState`);
        bad.cookies.set('bloomx_oauth_state', '', { path: '/api/auth/callback/google', maxAge: 0 });
        return bad;
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
            console.error("Google Token Error:", String(tokens.error).slice(0, 100));
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

        // Solo emails verificados por Google (evita toma de cuenta por coincidencia de email)
        if (profile.verified_email === false) {
            auditLog('auth.google.unverified_email', { email: profile.email });
            return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/login?error=EmailNotVerified`);
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

        auditLog('auth.google.success', { userId: user.id, email: user.email, ip: getClientIp(req) });
        const ok = NextResponse.redirect(`${process.env.NEXTAUTH_URL}${returnTo}`);
        ok.cookies.set('bloomx_oauth_state', '', { path: '/api/auth/callback/google', maxAge: 0 });
        return ok;

    } catch (error) {
        console.error("Google Callback Error:", error instanceof Error ? error.message : "unknown");
        return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/login?error=ServerAuthError`);
    }
}
