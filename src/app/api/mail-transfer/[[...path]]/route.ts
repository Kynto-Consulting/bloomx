import type { NextRequest } from 'next/server';
import { dispatch } from '@/lib/mail-transfer/router';

/**
 * "Mi buzon": cada usuario exporta / importa SOLO su propio buzon (Ajustes). Sesion normal; jamas otros buzones ni crear usuarios.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ path?: string[] }> };
const handle = async (req: NextRequest, ctx: Ctx) => dispatch(req, (await ctx.params).path, 'self');

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
