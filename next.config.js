const isProd = process.env.NODE_ENV === 'production';

// Cabeceras de seguridad (CIS 16.x / CIS Benchmarks web, NIST SC-8 / SC-18 / SI-10, ISO 27002 8.26 / 8.28).
// CSP: Next.js requiere 'unsafe-inline' para sus scripts de hidratacion sin nonces; 'unsafe-eval' solo en desarrollo.
// Se restringe todo lo demas (object-src, base-uri, form-action, frame-ancestors).
const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"} https://accounts.google.com https://apis.google.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    // Imagenes de la landing de cada empresa (Domain.theme.landing: hero, fondo, logos, avatares): el sanitizer
    // (src/lib/landing-config.ts) solo acepta https:, y se pintan con <img referrerPolicy="no-referrer">, nunca con CSS url().
    // Por eso basta el esquema https: ya permitido aqui; no se abre nada mas (ni http:, ni comodines de host).
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https: wss:",
    "media-src 'self' data: blob: https:",
    "frame-src 'self' blob: data: about: https://accounts.google.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    isProd ? 'upgrade-insecure-requests' : '',
].filter(Boolean).join('; ');

const securityHeaders = [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
    { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
    poweredByHeader: false,
    env: {
        NEXT_PUBLIC_BRAND_NAME: process.env.BRAND_NAME,
        NEXT_PUBLIC_BRAND_COLOR: process.env.BRAND_COLOR,
        NEXT_PUBLIC_BRAND_LOGO: process.env.BRAND_LOGO,
    },
    async headers() {
        return [
            { source: '/:path*', headers: securityHeaders },
            // Las respuestas de autenticacion nunca deben cachearse
            { source: '/api/auth/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
            // Mensajes sellados: la clave viaja en el #fragmento; jamas debe salir en un Referer ni cachearse.
            {
                source: '/secure/:path*',
                headers: [
                    { key: 'Referrer-Policy', value: 'no-referrer' },
                    { key: 'Cache-Control', value: 'no-store' },
                    { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
                ],
            },
            { source: '/api/secure-message/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }, { key: 'Referrer-Policy', value: 'no-referrer' }] },
        ];
    },
};

module.exports = nextConfig;
