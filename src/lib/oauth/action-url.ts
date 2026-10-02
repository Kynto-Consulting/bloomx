import { buildActionPath, extraHost, type OAuthActionDef } from '@/lib/expansions/oauth-schema';
import { providerUrlOk, type ProviderRuntime } from './providers';

/**
 * URL FINAL de una accion del broker (y de `onUnlink`). Unico sitio donde se compone: el host sale de la declaracion del proveedor o del dato extra
 * VALIDADO de la cuenta del usuario (`apiHostExtra`, p. ej. la instancia de Salesforce), jamas de la peticion; los marcadores `pathExtras`
 * (id/token del webhook de Discord) salen de la cuenta; los parametros de quien llama van codificados. Devuelve null (= prohibido) si:
 *  - falta la base, el dato extra o no cumple su patron/sufijo;
 *  - el host no esta en allowedHosts del proveedor (checkOAuthEndpointUrl: https, puerto 443, sin credenciales, DNS publico);
 *  - tras normalizar la URL la ruta o el host no son EXACTAMENTE los construidos (.., //, %2e, @, etc.).
 */
export function buildActionRequestUrl(
    provider: Pick<ProviderRuntime, 'allowedHosts' | 'apiBase' | 'extras'>,
    action: Pick<OAuthActionDef, 'path' | 'apiBase' | 'apiHostExtra' | 'pathExtras' | 'fixedQuery'>,
    input: { path: Record<string, string | number>; query: Record<string, string> },
    extras: Record<string, string>,
): string | null {
    let base: string;
    let expectedHost: string | null = null;
    if (action.apiHostExtra) {
        expectedHost = extraHost(provider.extras?.[action.apiHostExtra], extras[action.apiHostExtra]);
        if (!expectedHost) return null;
        base = `https://${expectedHost}`;
    } else {
        const declared = action.apiBase ?? provider.apiBase;
        if (!declared) return null;
        base = declared.replace(/\/+$/, '');
    }
    const pathValues: Record<string, string | number> = { ...input.path };
    for (const [placeholder, extraName] of Object.entries(action.pathExtras ?? {})) {
        const value = extras[extraName];
        if (typeof value !== 'string' || !value) return null;
        pathValues[placeholder] = value;
    }
    const query = new URLSearchParams({ ...(action.fixedQuery ?? {}), ...input.query });
    const url = `${base}${buildActionPath(action.path, pathValues)}${query.toString() ? `?${query.toString()}` : ''}`;
    const bare = url.split('?')[0];
    if (!providerUrlOk(provider, bare)) return null;
    let parsed: URL;
    try { parsed = new URL(url); } catch { return null; }
    // Defensa en profundidad: la ruta efectiva (tras normalizar) debe ser EXACTAMENTE la construida; si un parametro la altera (.., //, %2e) no se envia.
    if (parsed.pathname !== bare.replace(/^https:\/\/[^/]+/, '')) return null;
    if (expectedHost && parsed.hostname !== expectedHost) return null;
    if (parsed.username || parsed.password || parsed.port) return null;
    return url;
}
