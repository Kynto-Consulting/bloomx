
import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { verifyJWT, isSessionPayload, renewSessionIfNeeded } from "@/lib/jwt";
import { readSessionCookie, writeSessionCookie } from "@/lib/session-cookie";

// Rutas de /api/auth que SI cambian estado con la cookie de sesion y por tanto necesitan la defensa CSRF por Origin.
// El resto de /api/auth (NextAuth, callbacks OAuth de terceros) queda exento.
const CSRF_ENFORCED_AUTH_PREFIXES = [
    '/api/auth/login',
    '/api/auth/logout',
    '/api/auth/set-cookie',
    '/api/auth/refresh',
    '/api/auth/mfa',
    '/api/auth/unlink',
];

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
    if (CSRF_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p) && !(p === '/api/auth' && CSRF_ENFORCED_AUTH_PREFIXES.some((e) => pathname.startsWith(e))))) return false;
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

    // /api/admin/*: el middleware no valida el rol (cada ruta usa requireAdmin de @/lib/admin-auth), pero como defensa en
    // profundidad exige al menos una cookie de sesion (usuario o manager) salvo el login. NIST AC-3 / CIS 6.8.
    if (pathname.startsWith('/api/admin') && pathname !== '/api/admin/login') {
        const hasCred = readSessionCookie(req.cookies).token || req.cookies.get('auth_session')?.value ||
            req.headers.get('authorization')?.startsWith('Bearer ');
        if (!hasCred) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Herramientas de extensiones (playground, galeria, gestion) para PRUEBAS LOCALES sin sesion: solo en desarrollo y con
    // NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE definida (la misma condicion que getThemeOverride; en produccion nunca aplica).
    // No abre ninguna API: las paginas solo usan datos simulados y el resto de rutas siguen exigiendo sesion.
    if (
        process.env.NODE_ENV !== 'production' &&
        Boolean(process.env.NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE) &&
        (pathname === '/extensions' || pathname.startsWith('/extensions/playground') || pathname.startsWith('/extensions/components') || pathname === '/dev/email-preview')
    ) {
        return NextResponse.next();
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
        pathname === '/offline.html' ||
        pathname === '/apple-touch-icon.png' ||
        /^\/icon-(192|512|maskable-512)\.png$/.test(pathname) ||
        pathname.startsWith('/api/register') || // Allow register API
        pathname.startsWith('/api/auth') || // Allow all auth routes
        pathname.startsWith('/api/cron') || // Allow cron routes
        pathname.startsWith('/api/config') || // Allow cron routes

        pathname.startsWith('/api/webhooks') || // Allow cron routes
        pathname.startsWith('/api/molt') || // Allow cron routes
        (pathname.startsWith('/api/emails/') && pathname.endsWith('/process-attachments')) || // internal async job (guarded by the derived internal key, lib/internal-auth.ts)
        pathname.startsWith('/api/assets') || // Allow asset downloads
        pathname.startsWith('/api/internal/') || // servidor-a-servidor (backend de extensiones); cada ruta verifica la firma Ed25519 del backend
        pathname.startsWith('/secure/') || // mensajes sellados: el destinatario no tiene cuenta (el contenido va cifrado; la clave en el #fragmento)
        pathname.startsWith('/api/secure-message') || // crear exige sesion en la ruta; abrir/consumir es publico por id no adivinable
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
        const { token, source } = readSessionCookie(req.cookies);

        // console.log("[MIDDLEWARE] Checking token for:", pathname);

        if (!token) {
            // console.log("[MIDDLEWARE] No token found");
            throw new Error("No token found");
        }

        const payload = await verifyJWT(token);

        // Solo tokens de SESION (no molt_access ni el paso intermedio de MFA). La revocacion (jti/tokenVersion)
        // requiere BD y se comprueba en las rutas via getSessionCookie/getCurrentUser (Edge no accede a Prisma).
        if (!isSessionPayload(payload)) {
            throw new Error("Invalid token");
        }

        // 3. Authorized (+ renovacion deslizante de la cookie: SESSION_TTL_SECONDS por inactividad, tope absoluto)
        const res = NextResponse.next();
        try {
            const renewed = await renewSessionIfNeeded(payload);
            if (renewed) {
                // Nombre actual (`__Host-` en produccion) + expira la cookie antigua si existia
                writeSessionCookie(res.cookies, renewed.token, renewed.ttl);
            } else if (source === 'legacy' && typeof payload.exp === 'number') {
                // Migracion: la sesion llego por la cookie antigua; se re-emite con el nombre nuevo y el tiempo restante
                const left = Math.floor(payload.exp - Date.now() / 1000);
                if (left > 60) writeSessionCookie(res.cookies, token!, left);
            }
        } catch {
            // La renovacion es best-effort: nunca debe tumbar la peticion
        }
        return res;

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
