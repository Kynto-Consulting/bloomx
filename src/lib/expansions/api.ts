
import { toast } from "sonner";

export interface ExpansionActionResponse {
    success: boolean;
    result?: any;
    error?: string;
    suggestedActions?: any[];
}

/**
 * Fetch expansions for a specific trigger/mount point.
 */
export async function fetchExpansions(trigger: string): Promise<any[]> {
    try {
        const res = await fetch(`/api/expansions?trigger=${trigger}`);
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
 * Execute a backend action for an extension.
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
            throw new Error(errData.error || `Action failed with status ${res.status}`);
        }

        return await res.json();
    } catch (error: any) {
        console.error("Extension action failed", error);
        return { success: false, error: error.message };
    }
}
