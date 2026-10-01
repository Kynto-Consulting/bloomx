import { adminRoute } from '@/lib/admin/http';
import { getPublicAiState } from '@/lib/ai/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET -> estado publico (enabled, configured, source, features, extensiones desactivadas para IA). */
export const GET = adminRoute({ scope: 'ai.read', limit: 120 }, async () => ({ ...(await getPublicAiState()) }));
