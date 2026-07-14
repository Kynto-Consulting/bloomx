
import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { verifyJWT, COOKIE_NAME } from "@/lib/jwt";

export async function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl;

    // 1. Define public paths (login, register, api auth routes, static files)

    //if path is just "/" 

    if (
        pathname.startsWith('/login') ||
        pathname.startsWith('/register') ||
        pathname === '/manifest.webmanifest' ||
        pathname === '/sw.js' ||
        pathname === '/icon.svg' ||
        pathname.startsWith('/tumiai.svg') ||
        pathname === '/icon-maskable.svg' ||
        pathname.startsWith('/api/register') || // Allow register API
        pathname.startsWith('/api/auth') || // Allow all auth routes
        pathname.startsWith('/api/cron') || // Allow cron routes
        pathname.startsWith('/api/config') || // Allow cron routes

        pathname.startsWith('/api/webhooks') || // Allow cron routes
        pathname.startsWith('/api/molt') || // Allow cron routes
        (pathname.startsWith('/api/emails/') && pathname.endsWith('/process-attachments')) || // internal async job (guarded by INTERNAL_SECRET)
        pathname.startsWith('/api/assets') || // Allow asset downloads
        pathname.startsWith('/SKILL') || // Allow cron routes
        pathname.startsWith('/_next') ||
        pathname.startsWith('/static') ||
        pathname.startsWith('/api/admin') || // Allow admin APIs (auth handled in route)
        pathname.startsWith('/admin') ||
        pathname.startsWith('/docs') ||
        pathname.startsWith('/book') ||
        pathname.startsWith('/api/appointments/book') ||
        (pathname.startsWith('/api/appointments/schedules/') && (pathname.includes('/slots') || pathname.includes('/public')))
    ) {
        return NextResponse.next();
    }

    try {
        // 2. Token Verification using custom JWT logic
        const token = req.cookies.get(COOKIE_NAME)?.value;

        // console.log("[MIDDLEWARE] Checking token for:", pathname);

        if (!token) {
            // console.log("[MIDDLEWARE] No token found");
            throw new Error("No token found");
        }

        const payload = await verifyJWT(token);

        if (!payload) {
            console.log("[MIDDLEWARE] Verify failed for token");
            throw new Error("Invalid token");
        }

        // console.log("[MIDDLEWARE] Valid token:", payload.email);

        // 3. Authorized
        return NextResponse.next();

    } catch (error) {
        console.error(`[MIDDLEWARE-ERROR] Path: ${pathname}, Error:`, error);
        // On error, also redirect to login
        const url = req.nextUrl.clone();
        url.pathname = "/login";
        url.searchParams.set("callbackUrl", req.url);
        return NextResponse.redirect(url);
    }
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icon.svg|icon-maskable.svg).*)"],
};
