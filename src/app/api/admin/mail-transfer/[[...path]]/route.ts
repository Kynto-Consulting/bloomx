import type { NextRequest } from 'next/server';
import { dispatch } from '@/lib/mail-transfer/router';

/**
 * Importar / exportar correo (consola de administracion). Solo requireAdmin (dueno del dominio o ADMIN_EMAILS con MFA);
 * las operaciones sobre el dominio exigen ademas re-autenticacion reciente y escribir el nombre del dominio.
 * Ver src/lib/mail-transfer/router.ts (tabla de rutas) y docs "Importar y exportar correo".
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ path?: string[] }> };
const handle = async (req: NextRequest, ctx: Ctx) => dispatch(req, (await ctx.params).path, 'admin');

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
