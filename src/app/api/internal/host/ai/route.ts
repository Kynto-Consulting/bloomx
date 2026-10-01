import { createAiBridgeHandler } from '@/lib/ai/bridge';

/** Puente `services.ai.*` del sandbox de extensiones (backend compartido -> instancia). Ver src/lib/ai/bridge.ts. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createAiBridgeHandler();
