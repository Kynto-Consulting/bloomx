
import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { verifyJWT, COOKIE_NAME } from "@/lib/jwt";

// Rutas que legitimamente reciben POST cross-origin (webhooks, clientes externos, reservas publicas embebibles)
const CSRF_EXEMPT_PREFIXES = [
    '/api/auth',            // NextAuth aplica su propio token CSRF
    '/api/webhooks',
    '/api/cron',
    '/api/molt',
    '/api/config',
    '/api/register',
    '/api/appointments/book',
    '/api/appointments/schedules/',
];

// Defensa CSRF en profundidad (CIS 16.x, NIST SC-23, OWASP ASVS 4.2.2): para peticiones que cambian estado
// y usan la cookie de sesion, si el navegador envia Origin este debe coincidir con el host.
function isCrossOriginStateChange(req: NextRequest): boolean {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
    const { pathname } = req.nextUrl;
    if (!pathname.startsWith('/api/')) return false;
    if (CSRF_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p) && !(p === '/api/auth' && (pathname === '/api/auth/login' || pathname === '/api/auth/logout' || pathname === '/api/auth/set-cookie')))) return false;
    if (req.headers.get('authorization')?.startsWith('Bearer ')) return false; // no depende de cookie ambiente
    const origin = req.headers.get('origin');
    if (!origin) return false; // clientes no-navegador
    try {
        const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || req.nextUrl.host;
        return new URL(origin).host !== host;
    } catch {
        return true;
    }
}

export async function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl;

    if (isCrossOriginStateChange(req)) {
        console.warn(`[MIDDLEWARE] Blocked cross-origin ${req.method} ${pathname}`);
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

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
            throw new Error("Invalid token");
        }

        // console.log("[MIDDLEWARE] Valid token:", payload.email);

        // 3. Authorized
        return NextResponse.next();

    } catch (error) {
        // Sin volcar el error completo ni tokens al log
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
