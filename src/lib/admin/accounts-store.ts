import { z } from 'zod';
import { escapeLike, splitScopes } from './users-store';
import { execute, num, query, toIso } from './sql';

/**
 * Cuentas vinculadas (tabla "Account") para la consola.
 *
 * SEGURIDAD: aqui se usa SQL crudo con columnas EXPLICITAS. `prisma.account` descifra los tokens al leer
 * (lib/account-tokens.ts) y no debe usarse para esta vista: solo se seleccionan booleanos derivados
 * (`refresh_token IS NOT NULL AND <> ''`) y `expires_at`. Ningun valor de token sale de la base de datos.
 *
 * El estado se DERIVA de lo almacenado; no se consulta al proveedor (no se puede saber si Google revoco el acceso hasta usar el token):
 *  - revoked: sin access_token y sin refresh_token (es lo que la app escribe tras un invalid_grant o al pedir reconexion).
 *  - valid:   hay refresh_token (la app puede renovar el acceso) o el access_token aun no ha caducado.
 *  - expired: access_token caducado y sin refresh_token.
 */

export type AccountStatus = 'valid' | 'expired' | 'revoked';
export const ACCOUNT_STATUSES = ['valid', 'expired', 'revoked'] as const;

export const accountFiltersSchema = z.object({
    q: z.string().trim().max(100).optional(),
    provider: z.string().trim().regex(/^[A-Za-z0-9_.-]{1,50}$/).optional(),
    status: z.enum(ACCOUNT_STATUSES).optional(),
});
export type AccountFilters = z.infer<typeof accountFiltersSchema>;

/** Fragmento FIJO (sin entrada del usuario). */
const STATUS_SQL = `CASE
    WHEN COALESCE(a."access_token", '') = '' AND COALESCE(a."refresh_token", '') = '' THEN 'revoked'
    WHEN COALESCE(a."refresh_token", '') <> '' THEN 'valid'
    WHEN a."expires_at" IS NULL OR a."expires_at" > EXTRACT(EPOCH FROM NOW()) THEN 'valid'
    ELSE 'expired' END`;

export interface AccountRow {
    id: string;
    userId: string;
    userEmail: string;
    userName: string | null;
    provider: string;
    providerAccountId: string;
    scopes: string[];
    expiresAt: string | null;
    status: AccountStatus;
    hasRefreshToken: boolean;
    integrations: string[];
}

/** 3 primeros + 2 ultimos caracteres; los ids cortos se ocultan casi por completo. */
export function maskProviderAccountId(value: string): string {
    const s = String(value ?? '');
    if (s.length <= 6) return s ? `${s.slice(0, 1)}…` : '';
    return `${s.slice(0, 3)}…${s.slice(-2)}`;
}

/** Integraciones que los scopes concedidos permiten (derivado; no se inspeccionan manifests de extensiones). */
export function deriveIntegrations(provider: string, scopes: string[]): string[] {
    const has = (re: RegExp) => scopes.some((s) => re.test(s));
    const out: string[] = [];
    const p = provider.toLowerCase();
    if (p === 'google' || p === 'google-organizer') {
        if (has(/auth\/calendar/)) out.push('calendar');
        if (has(/auth\/contacts|m8\/feeds/)) out.push('contacts');
        if (has(/auth\/gmail|mail\.google\.com/)) out.push('gmail');
        if (has(/auth\/drive/)) out.push('drive');
        if (has(/meetings\.space|auth\/meetings/)) out.push('meet');
        if (has(/auth\/tasks/)) out.push('tasks');
    } else if (p === 'zoom') {
        if (scopes.length === 0 || has(/meeting/)) out.push('meetings');
    } else if (p === 'microsoft') {
        if (has(/^Calendars\./i)) out.push('calendar');
        if (has(/^OnlineMeetings\./i)) out.push('meetings');
        if (has(/^Contacts\./i)) out.push('contacts');
        if (has(/^Mail\./i)) out.push('mail');
        if (has(/^Files\./i)) out.push('files');
        if (has(/^User\.ReadBasic\.All$/i)) out.push('directory');
    } else if (p === 'slack') {
        // Las cuentas de Slack son dos por usuario (bot y usuario): los scopes de usuario llevan el prefijo "user:".
        if (has(/^(user:)?chat:write/)) out.push('chat');
        if (has(/^(user:)?(channels|groups):read/)) out.push('channels');
        if (has(/^(user:)?users:read/)) out.push('users');
    }
    return out;
}

const PUBLIC_COLUMNS = `a."id", a."userId", u."email" AS "userEmail", u."name" AS "userName", a."provider", a."providerAccountId", a."scope",
    a."expires_at" AS "expiresAt",
    (a."refresh_token" IS NOT NULL AND a."refresh_token" <> '') AS "hasRefresh",
    ${STATUS_SQL} AS "status"`;

interface RawAccount {
    id: string; userId: string; userEmail: string; userName: string | null; provider: string; providerAccountId: string;
    scope: string | null; expiresAt: number | null; hasRefresh: boolean; status: AccountStatus;
}

function toRow(r: RawAccount): AccountRow {
    const scopes = splitScopes(r.scope);
    return {
        id: r.id,
        userId: r.userId,
        userEmail: r.userEmail,
        userName: r.userName,
        provider: r.provider,
        providerAccountId: maskProviderAccountId(r.providerAccountId),
        scopes,
        expiresAt: r.expiresAt ? toIso(new Date(Number(r.expiresAt) * 1000)) : null,
        status: (ACCOUNT_STATUSES as readonly string[]).includes(r.status) ? r.status : 'valid',
        hasRefreshToken: !!r.hasRefresh,
        integrations: deriveIntegrations(r.provider, scopes),
    };
}

function where(filters: AccountFilters): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const conds: string[] = [];
    if (filters.q) {
        params.push(escapeLike(filters.q));
        conds.push(`(u."email" ILIKE $${params.length} ESCAPE '\\' OR COALESCE(u."name", '') ILIKE $${params.length} ESCAPE '\\')`);
    }
    if (filters.provider) {
        params.push(filters.provider);
        conds.push(`a."provider" = $${params.length}`);
    }
    if (filters.status) {
        params.push(filters.status);
        conds.push(`(${STATUS_SQL}) = $${params.length}`);
    }
    return { sql: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
}

export async function listAccounts(filters: AccountFilters, paging: { limit: number; offset: number }): Promise<{ rows: AccountRow[]; total: number; providers: string[] }> {
    const w = where(filters);
    const from = `FROM "Account" a JOIN "User" u ON u."id" = a."userId"`;
    const total = num((await query<{ n: bigint | number }>(`SELECT COUNT(*) AS n ${from} ${w.sql}`, ...w.params))[0]?.n);
    const params = [...w.params, Math.max(1, Math.trunc(paging.limit)), Math.max(0, Math.trunc(paging.offset))];
    const raw = await query<RawAccount>(
        `SELECT ${PUBLIC_COLUMNS} ${from} ${w.sql}
         ORDER BY lower(u."email") ASC, a."provider" ASC, a."id" ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        ...params,
    );
    const providers = (await query<{ provider: string }>(`SELECT DISTINCT "provider" FROM "Account" ORDER BY "provider" LIMIT 50`)).map((r) => String(r.provider));
    return { rows: raw.map(toRow), total, providers };
}

export async function getAccountBrief(id: string): Promise<{ id: string; userId: string; provider: string; hasRefresh: boolean } | null> {
    const rows = await query<{ id: string; userId: string; provider: string; hasRefresh: boolean }>(
        `SELECT "id", "userId", "provider", ("refresh_token" IS NOT NULL AND "refresh_token" <> '') AS "hasRefresh" FROM "Account" WHERE "id" = $1`,
        id,
    );
    return rows[0] ? { ...rows[0], hasRefresh: !!rows[0].hasRefresh } : null;
}

export async function deleteAccount(id: string): Promise<boolean> {
    return (await execute(`DELETE FROM "Account" WHERE "id" = $1`, id)) > 0;
}

/**
 * Pide la reconexion sin tocar al proveedor:
 *  - 'reconnect': anula access y refresh token (mismo estado que escribe la app tras un invalid_grant); a partir de ahi las
 *    llamadas de Google/Zoom responden "reconectar" y el usuario ve el aviso. Reversible: el usuario reconecta por OAuth.
 *  - 'refresh': solo invalida el access_token (expires_at=0): fuerza un refresco en la siguiente llamada, sin perder el refresh_token.
 */
export async function requestReconnect(id: string, mode: 'reconnect' | 'refresh'): Promise<boolean> {
    const sql = mode === 'reconnect'
        ? `UPDATE "Account" SET "access_token" = NULL, "refresh_token" = NULL, "expires_at" = 0 WHERE "id" = $1`
        : `UPDATE "Account" SET "access_token" = NULL, "expires_at" = 0 WHERE "id" = $1`;
    return (await execute(sql, id)) > 0;
}
