/**
 * Logica comun de las listas para las rutas de administrador (ambito 'domain') y de usuario (ambito 'user'): listar, anadir,
 * borrar, importar y exportar CSV. El propietario (ownerKey) lo fija SIEMPRE la ruta a partir de la sesion, nunca el cliente.
 */
import { z } from 'zod';
import { adminEmails } from '@/lib/mfa';
import { getSpamConfig } from './config-store';
import { csvToInputs, entriesToCsv, MAX_CSV_BYTES } from './lists-csv';
import { LIST_KINDS, MATCH_TYPES, type ListKind, type ListScope, type Protected } from './lists-core';
import { DOMAIN_OWNER, addEntries, clearList, deleteEntries, exportEntries, listEntries, limitFor, type AddResult } from './lists-store';
import { internalDomainsFor } from './pipeline';

export const kindSchema = z.enum(LIST_KINDS);

export const entrySchema = z.object({
    matchType: z.enum(MATCH_TYPES),
    value: z.string().min(1).max(300),
    includeSubdomains: z.boolean().optional(),
    reason: z.string().max(400).nullish(),
    expiresAt: z.string().max(40).nullish(),
}).strict();

export const addBodySchema = z.object({ entries: z.array(entrySchema).min(1).max(1000) }).strict();
export const deleteBodySchema = z.union([
    z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(1000) }).strict(),
    z.object({ all: z.literal(true), confirm: z.literal(true) }).strict(),
]);
export const importBodySchema = z.object({ csv: z.string().min(1).max(MAX_CSV_BYTES) }).strict();
export const listQuerySchema = z.object({
    q: z.string().max(100).optional(),
    matchType: z.enum(MATCH_TYPES).optional(),
    status: z.enum(['active', 'expired', 'all']).optional(),
    sort: z.enum(['createdAt', 'hits', 'value', 'expiresAt']).optional(),
    page: z.coerce.number().int().min(1).max(100_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export interface Owner { scope: ListScope; ownerKey: string; actor: string }
export const domainOwner = (actor: string): Owner => ({ scope: 'domain', ownerKey: DOMAIN_OWNER, actor });
export const userOwner = (userId: string): Owner => ({ scope: 'user', ownerKey: userId, actor: userId });

export async function protectedFor(owner: Owner): Promise<Protected> {
    const cfg = await getSpamConfig();
    return { ownDomains: internalDomainsFor(cfg), adminEmails: owner.scope === 'domain' ? adminEmails() : [] };
}

export async function apiList(owner: Owner, kind: ListKind, q: z.infer<typeof listQuerySchema>) {
    const r = await listEntries({ scope: owner.scope, ownerKey: owner.ownerKey, kind, ...q });
    const now = Date.now();
    return {
        limit: r.limit,
        total: r.total,
        rows: r.rows.map((e) => ({
            id: e.id, matchType: e.matchType, value: e.value, includeSubdomains: e.includeSubdomains, reason: e.reason,
            expiresAt: e.expiresAt ? e.expiresAt.toISOString() : null, expired: !!e.expiresAt && e.expiresAt.getTime() <= now,
            createdBy: owner.scope === 'domain' ? e.createdBy : null, hits: e.hits, lastHitAt: e.lastHitAt ? e.lastHitAt.toISOString() : null, createdAt: e.createdAt.toISOString(),
        })),
    };
}

export async function apiAdd(owner: Owner, kind: ListKind, body: z.infer<typeof addBodySchema>): Promise<AddResult> {
    const guard = kind === 'block' ? await protectedFor(owner) : null;
    return addEntries(body.entries, { scope: owner.scope, ownerKey: owner.ownerKey, kind, actor: owner.actor, guard });
}

export async function apiDelete(owner: Owner, kind: ListKind, body: z.infer<typeof deleteBodySchema>): Promise<{ deleted: number }> {
    if ('all' in body) return { deleted: await clearList(owner.scope, owner.ownerKey, kind, owner.actor) };
    return { deleted: await deleteEntries(body.ids, owner.scope, owner.ownerKey, owner.actor) };
}

export async function apiExportCsv(owner: Owner, kind: ListKind): Promise<string> {
    return entriesToCsv(await exportEntries(owner.scope, owner.ownerKey, kind));
}

export interface ImportResult extends AddResult { lines: number; errors: Array<{ line: number; error: string }> }

/** Importa en lotes de 1000; los errores llevan el numero de linea del CSV (sin repetir el valor recibido). */
export async function apiImportCsv(owner: Owner, kind: ListKind, csv: string): Promise<ImportResult> {
    const parsed = csvToInputs(csv);
    const out: ImportResult = { added: 0, duplicates: 0, invalid: [], limitReached: false, lines: parsed.entries.length, errors: [...parsed.errors] };
    const guard = kind === 'block' ? await protectedFor(owner) : null;
    for (let i = 0; i < parsed.entries.length && !out.limitReached; i += 1000) {
        const chunk = parsed.entries.slice(i, i + 1000);
        const r = await addEntries(chunk.map((c) => c.input), { scope: owner.scope, ownerKey: owner.ownerKey, kind, actor: owner.actor, guard });
        out.added += r.added; out.duplicates += r.duplicates; out.limitReached = r.limitReached;
        for (const bad of r.invalid) out.errors.push({ line: chunk[bad.index].line, error: bad.error });
    }
    out.errors = out.errors.slice(0, 200);
    return out;
}

export { limitFor };
