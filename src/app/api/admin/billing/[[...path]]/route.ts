import { adminRoute } from '@/lib/admin/http';
import { proxyPayments } from '@/lib/admin/payments-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /api/admin/billing/** -> backend /api/payments/** (compra de extensiones de pago con PayPal, suscripciones, facturacion, recibos y cuenta PayPal).
 * Solo el dueno del dominio (nivel 4) + step-up reciente en lo que mueve o muestra dinero; firmado con la clave de dominio de la instancia
 * (modo legado => 403 signature_required). Lista blanca de rutas en lib/admin/payments-proxy.ts.
 */
type P = { path?: any };
export const GET = adminRoute<P>({ scope: 'billing.read', minLevel: 4, limit: 120 }, (ctx, params) => proxyPayments(ctx, 'billing', params.path ?? []));
export const POST = adminRoute<P>({ scope: 'billing.write', minLevel: 4, write: true, limit: 30 }, (ctx, params) => proxyPayments(ctx, 'billing', params.path ?? []));
