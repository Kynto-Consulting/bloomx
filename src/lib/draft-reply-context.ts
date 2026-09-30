// Contexto de respuesta de un borrador (Draft.inReplyToEmailId / Draft.replyMode), con SQL crudo TOLERANTE: si las columnas aun no existen
// (despliegue sin db:ensure) no se guarda ni se devuelve nada y el borrador funciona como siempre. Al reabrir un borrador de respuesta se
// conserva el vinculo con el original, asi el envio sigue emitiendo In-Reply-To / References.
import { isMissingRelation, query, execute } from '@/lib/admin/sql';

export type DraftReplyMode = 'reply' | 'replyAll' | 'forward';

export interface DraftReplyContext {
    inReplyToEmailId: string | null;
    replyMode: DraftReplyMode | null;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Valida lo que llega del cliente: id con forma de id y modo conocido; cualquier otra cosa se descarta. */
export function parseDraftReplyContext(body: { inReplyToEmailId?: unknown; replyMode?: unknown } | null | undefined): DraftReplyContext {
    const id = typeof body?.inReplyToEmailId === 'string' && ID_RE.test(body.inReplyToEmailId.trim()) ? body.inReplyToEmailId.trim() : null;
    const mode = body?.replyMode === 'reply' || body?.replyMode === 'replyAll' || body?.replyMode === 'forward' ? body.replyMode : null;
    return { inReplyToEmailId: id, replyMode: id ? mode : null };
}

/** Guarda el contexto (solo si el cliente lo envio: `undefined` no borra el existente). Devuelve false si no hay columnas. */
export async function saveDraftReplyContext(draftId: string, sent: { inReplyToEmailId?: unknown; replyMode?: unknown } | null | undefined): Promise<boolean> {
    if (!sent || (sent.inReplyToEmailId === undefined && sent.replyMode === undefined)) return true;
    const ctx = parseDraftReplyContext(sent);
    try {
        await execute(`UPDATE "Draft" SET "inReplyToEmailId" = $2, "replyMode" = $3 WHERE "id" = $1`, draftId, ctx.inReplyToEmailId, ctx.replyMode);
        return true;
    } catch (error) {
        if (isMissingRelation(error)) return false;
        throw error;
    }
}

/** id de borrador -> contexto (solo los que lo tienen). Vacio si no hay columnas. */
export async function loadDraftReplyContexts(draftIds: string[]): Promise<Map<string, DraftReplyContext>> {
    const out = new Map<string, DraftReplyContext>();
    if (draftIds.length === 0) return out;
    try {
        const rows = await query<{ id: string; inReplyToEmailId: string | null; replyMode: string | null }>(
            `SELECT "id", "inReplyToEmailId", "replyMode" FROM "Draft" WHERE "id" = ANY($1::text[]) AND "inReplyToEmailId" IS NOT NULL`, draftIds,
        );
        for (const r of rows) out.set(r.id, parseDraftReplyContext(r));
    } catch (error) {
        if (!isMissingRelation(error)) throw error;
    }
    return out;
}
