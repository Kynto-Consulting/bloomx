
import { toast } from "sonner";

export interface ExpansionActionResponse {
    success: boolean;
    result?: any;
    error?: string;
    suggestedActions?: any[];
}

/**
 * Handlers de las extensiones instaladas para un punto de montaje de middleware
 * (ON_RECIPIENTS_CHANGE_HANDLER, ...): [{ extensionId, handler, point, priority }].
 */
export async function fetchExpansions(trigger: string): Promise<any[]> {
    try {
        const res = await fetch(`/api/expansions?trigger=${encodeURIComponent(trigger)}`);
        if (!res.ok) {
            console.error(`Failed to fetch expansions for ${trigger}: ${res.statusText}`);
            return [];
        }
        return await res.json();
    } catch (error) {
        console.error("Error fetching expansions", error);
        return [];
    }
}

/**
 * Mensaje claro cuando la accion no existe en la version instalada de la extension (404 ACTION_NOT_FOUND del backend: tipico de una
 * version antigua cuyo manifest referencia una funcion que su script ya no exporta). Falla al usar el boton, nunca al cargar.
 */
export function actionNotFoundMessage(data: { action?: unknown; version?: unknown }, lang: string): string {
    const action = typeof data.action === 'string' ? data.action.replace(/[^\w$.-]/g, '').slice(0, 64) : '';
    const version = typeof data.version === 'string' ? data.version.slice(0, 40) : '';
    return lang.toLowerCase().startsWith('en')
        ? `The action "${action}" is not available in ${version ? `version ${version} of ` : ''}this extension. Update the extension from Extensions.`
        : `La acción "${action}" no existe en ${version ? `la versión ${version} de ` : ''}esta extensión. Actualiza la extensión desde Extensiones.`;
}

/**
 * Ejecuta una accion de servidor de una extension (CALL_BACKEND). El backend la invoca como handler(ctx) con
 * ctx.args = params y el resto de `context` (ver bloomx/expansions.md). `auth`, `user` y `env` los fija el servidor.
 */
export async function executeExtensionAction(
    extensionId: string,
    action: string,
    params: any = {},
    context: any = {}
): Promise<ExpansionActionResponse> {
    try {
        const res = await fetch(`/api/expansions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                extensionId,
                action,
                params,
                context
            })
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            if (errData?.code === 'ACTION_NOT_FOUND') {
                throw new Error(actionNotFoundMessage(errData, typeof document !== 'undefined' ? document.documentElement.lang || 'es' : 'es'));
            }
            throw new Error(errData.error || `Action failed with status ${res.status}`);
        }

        return await res.json();
    } catch (error: any) {
        console.error("Extension action failed", error);
        return { success: false, error: error.message };
    }
}
