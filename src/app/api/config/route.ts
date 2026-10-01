
import { clientVersionHeaders } from '@/lib/expansions/client/capabilities';
import { NextResponse, type NextRequest } from 'next/server';
import { resolveEdgeIdentity } from '@/lib/ext-edge-identity';
import { stripAdminMounts } from '@/lib/expansions/page-auth';
import { getPublicAiState } from '@/lib/ai/settings';
import { annotateExtensionsWithAi } from '@/lib/ai/extension-block';
import { splitPausedConfigExtensions } from '@/lib/expansions/dependency-filter';

export async function GET(req: Request) {
    // In production, this call would go to the backend service.
    // For now, we mock it or call the backend URL from env.
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.bloomx.arubik.dev';

    // We need to pass the host header to identify the domain.
    // In Dev/Local, we use TOP_DOMAIN from env to simulate the real domain.
    const host = process.env.TOP_DOMAIN || req.headers.get('host');

    try {
        // Send domain as query param to avoid proxy header stripping issues
        const targetUrl = new URL(`${backendUrl}/api/config`);
        if (host) targetUrl.searchParams.set('domain', host.split(':')[0]);

        const res = await fetch(targetUrl.toString(), {
            headers: {
                'x-forwarded-host': host || '',
                'Cache-Control': 'no-cache',
                ...clientVersionHeaders()
            },
            cache: 'no-store'
        });

        if (!res.ok) {
            console.error("[CONFIG_PROXY] Backend returned error:", res.status);
            return NextResponse.json({ error: "Backend error" }, { status: res.status });
        }

        const data = await res.json();
        // Bloqueo por IA: cada extension lleva `aiBlock` (misma funcion pura que usa el backend). Estado cacheado 30 s en proceso.
        // Si no se puede leer el estado de IA no se marca nada (la ejecucion igualmente la rechaza el backend con ai_disabled).
        if (data && Array.isArray(data.extensions)) {
            try { data.extensions = annotateExtensionsWithAi(data.extensions, await getPublicAiState()); } catch (e) { console.error('[CONFIG_PROXY] AI state unavailable:', e); }
        }
        // auth: "admin" en paginas: quien no tiene el nivel NO recibe el arbol de componentes ni el estado inicial de esas paginas (no basta ocultarlas).
        if (data && Array.isArray(data.extensions)) {
            const identity = await resolveEdgeIdentity(req as NextRequest).catch(() => null);
            data.extensions = stripAdminMounts(data.extensions, identity?.level ?? null);
        }
        return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });

    } catch (e) {
        console.error("[CONFIG_PROXY] Failed to fetch config:", e);
        return NextResponse.json({ error: "Failed to load config" }, { status: 500 });
    }
}
