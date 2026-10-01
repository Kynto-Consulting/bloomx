import { createHandoffHandler } from '@/lib/oauth/handoff';

/** Entrega de credenciales OAuth desde el backend (migracion a GoogleLib). Cerrada por defecto: ver src/lib/oauth/handoff.ts. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createHandoffHandler();
