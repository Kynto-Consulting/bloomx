import { adminRoute } from '@/lib/admin/http';
import { proxyPayments } from '@/lib/admin/payments-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /api/admin/developer/** -> backend /api/developer/** (portal de desarrolladores: terminos, validacion en vivo, envio a revision, precio,
 * prueba en el dominio y retirada). Mismas garantias que /api/admin/billing: nivel 4, step-up reciente al publicar/cambiar dinero y firma de dominio.
 * La validacion en vivo (POST validate) llega con debounce desde el editor, de ahi el limite mayor.
 */
type P = { path?: any };
export const GET = adminRoute<P>({ scope: 'developer.read', minLevel: 4, limit: 120 }, (ctx, params) => proxyPayments(ctx, 'developer', params.path ?? []));
export const POST = adminRoute<P>({ scope: 'developer.write', minLevel: 4, write: true, limit: 120 }, (ctx, params) => proxyPayments(ctx, 'developer', params.path ?? []));
