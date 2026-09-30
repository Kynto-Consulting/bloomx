import { z } from 'zod';
import { adminEmails } from '@/lib/mfa';
import { countActiveSessions } from './session-registry';
import { loadQuotaViews } from '@/lib/mail-quota';
import { num, query, tolerant, toIso } from './sql';

/**
 * Consultas de la seccion USUARIOS de la consola (SQL crudo, siempre parametrizado).
 *
 * - `listUsers(filters, paging)` construye la consulta con FRAGMENTOS FIJOS del codigo (las columnas de orden salen de una lista
 *   blanca) y cada valor del usuario viaja como parametro ($n). Nunca se lee ni devuelve `password` ni tokens.
 * - Tolerancia a tablas ausentes (UserAdminState, UserMfa, Account, Attachment): se comprueba una vez con `to_regclass` y, si
 *   falta alguna, su columna se sustituye por una constante (disabled=false, mfa=false...) y el filtro correspondiente
 *   deja de coincidir en vez de romper la pagina.
 */

export const USER_SORTS = ['createdAt', 'email', 'name', 'lastLogin', 'storage'] as const;
export type UserSort = (typeof USER_SORTS)[number];

export const userFiltersSchema = z.object({
    q: z.string().trim().max(100).optional(),
    status: z.enum(['active', 'disabled']).optional(),
    role: z.enum(['admin', 'user']).optional(),
    mfa: z.enum(['yes', 'no']).optional(),
    google: z.enum(['yes', 'no']).optional(),
    sort: z.enum(USER_SORTS).optional(),
    dir: z.enum(['asc', 'desc']).optional(),
});
export type UserFilters = z.infer<typeof userFiltersSchema>;

export interface UserListRow {
    id: string;
    /** Cuota de buzon efectiva en MB (null = sin limite) y de donde sale. */
    quotaMb: number | null;
    quotaSource: 'user' | 'domain' | 'env' | 'none';
    name: string | null;
    email: string;
    avatar: boolean;
    createdAt: string | null;
    disabled: boolean;
    isAdmin: boolean;
    mfaEnabled: boolean;
    googleLinked: boolean;
    lastLoginAt: string | null;
    storageBytes: number;
    sessions: number;
}

/** El admin actual es este usuario (los managers del backend nunca lo son). */
export function isSelf(actor: { kind: string; id?: string }, id: string): boolean {
    return actor.kind === 'user' && !!actor.id && actor.id === id;
}

/** Escapa \ % _ para ILIKE ... ESCAPE '\'. */
export function escapeLike(input: string): string {
    return `%${input.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

interface Availability {
    state: boolean;
    mfa: boolean;
    account: boolean;
    attachment: boolean;
}

async function tableAvailability(): Promise<Availability> {
    const rows = await query<{ state: boolean; mfa: boolean; account: boolean; attachment: boolean }>(
        `SELECT to_regclass('"UserAdminState"') IS NOT NULL AS state,
                to_regclass('"UserMfa"') IS NOT NULL AS mfa,
                to_regclass('"Account"') IS NOT NULL AS account,
                to_regclass('"Attachment"') IS NOT NULL AS attachment`,
    );
    const r = rows[0];
    return { state: !!r?.state, mfa: !!r?.mfa, account: !!r?.account, attachment: !!r?.attachment };
}

const ORDER_COLUMNS: Record<UserSort, string> = {
    createdAt: 'u."createdAt"',
    email: 'lower(u."email")',
    name: 'lower(COALESCE(u."name", \'\'))',
    lastLogin: '"lastLoginAt"',
    storage: '"storageBytes"',
};

interface Built {
    from: string;
    where: string;
    params: unknown[];
}

function build(filters: UserFilters, av: Availability): Built {
    const params: unknown[] = [];
    const p = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
    };
    const conds: string[] = [];

    let from = 'FROM "User" u';
    if (av.state) from += ' LEFT JOIN "UserAdminState" ast ON ast."userId" = u."id"';
    if (av.mfa) from += ' LEFT JOIN "UserMfa" mfa ON mfa."userId" = u."id"';

    if (filters.q) {
        const like = p(escapeLike(filters.q));
        conds.push(`(u."email" ILIKE ${like} ESCAPE '\\' OR COALESCE(u."name", '') ILIKE ${like} ESCAPE '\\')`);
    }
    if (filters.status) {
        // Sin la tabla de estado nadie esta deshabilitado.
        if (filters.status === 'disabled') conds.push(av.state ? 'COALESCE(ast."disabled", FALSE) = TRUE' : 'FALSE');
        else if (av.state) conds.push('COALESCE(ast."disabled", FALSE) = FALSE');
    }
    if (filters.role) {
        const admins = p(adminEmails());
        conds.push(filters.role === 'admin' ? `lower(u."email") = ANY(${admins}::text[])` : `NOT (lower(u."email") = ANY(${admins}::text[]))`);
    }
    if (filters.mfa) {
        if (filters.mfa === 'yes') conds.push(av.mfa ? 'COALESCE(mfa."enabled", FALSE) = TRUE' : 'FALSE');
        else if (av.mfa) conds.push('COALESCE(mfa."enabled", FALSE) = FALSE');
    }
    if (filters.google) {
        const exists = `EXISTS (SELECT 1 FROM "Account" ga WHERE ga."userId" = u."id" AND ga."provider" = 'google')`;
        if (filters.google === 'yes') conds.push(av.account ? exists : 'FALSE');
        else if (av.account) conds.push(`NOT ${exists}`);
    }
    return { from, where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
}

export async function countUsers(filters: UserFilters): Promise<number> {
    const av = await tableAvailability();
    const b = build(filters, av);
    const rows = await query<{ n: bigint | number }>(`SELECT COUNT(*) AS n ${b.from} ${b.where}`, ...b.params);
    return num(rows[0]?.n);
}

/** Lista usuarios con filtros, orden y paginacion (limit/offset ya acotados por el llamador). Devuelve tambien el total. */
export async function listUsers(
    filters: UserFilters,
    paging: { limit: number; offset: number },
): Promise<{ rows: UserListRow[]; total: number }> {
    const av = await tableAvailability();
    const b = build(filters, av);

    const total = num((await query<{ n: bigint | number }>(`SELECT COUNT(*) AS n ${b.from} ${b.where}`, ...b.params))[0]?.n);

    const sort = filters.sort && Object.prototype.hasOwnProperty.call(ORDER_COLUMNS, filters.sort) ? filters.sort : 'createdAt';
    const dir = filters.dir === 'asc' ? 'ASC' : 'DESC';
    const params = [...b.params];
    const adminsParam = `$${params.push(adminEmails())}`;
    const limitParam = `$${params.push(Math.max(1, Math.trunc(paging.limit)))}`;
    const offsetParam = `$${params.push(Math.max(0, Math.trunc(paging.offset)))}`;

    const storageJoin = av.attachment
        ? `LEFT JOIN (SELECT e."userId" AS uid, SUM(at."size") AS bytes FROM "Attachment" at JOIN "Email" e ON e."id" = at."emailId" GROUP BY e."userId") st ON st.uid = u."id"`
        : '';
    const sql = `SELECT u."id", u."name", u."email",
            (u."avatar" IS NOT NULL AND u."avatar" <> '') AS "hasAvatar",
            u."createdAt",
            ${av.state ? 'COALESCE(ast."disabled", FALSE)' : 'FALSE'} AS "disabled",
            ${av.state ? 'ast."lastLoginAt"' : 'NULL::timestamptz'} AS "lastLoginAt",
            (lower(u."email") = ANY(${adminsParam}::text[])) AS "isAdmin",
            ${av.mfa ? 'COALESCE(mfa."enabled", FALSE)' : 'FALSE'} AS "mfaEnabled",
            ${av.account ? `EXISTS (SELECT 1 FROM "Account" ga WHERE ga."userId" = u."id" AND ga."provider" = 'google')` : 'FALSE'} AS "googleLinked",
            ${av.attachment ? 'COALESCE(st.bytes, 0)' : '0'} AS "storageBytes"
        ${b.from} ${storageJoin} ${b.where}
        ORDER BY ${ORDER_COLUMNS[sort]} ${dir} NULLS LAST, u."id" ASC
        LIMIT ${limitParam} OFFSET ${offsetParam}`;

    const raw = await query<{
        id: string; name: string | null; email: string; hasAvatar: boolean; createdAt: Date | null; disabled: boolean;
        lastLoginAt: Date | null; isAdmin: boolean; mfaEnabled: boolean; googleLinked: boolean; storageBytes: bigint | number | string;
    }>(sql, ...params);

    const ids = raw.map((r) => r.id);
    const [sessions, quotas] = await Promise.all([countActiveSessions(ids), loadQuotaViews(ids)]);

    return {
        total,
        rows: raw.map((r) => ({
            id: r.id,
            name: r.name,
            email: r.email,
            avatar: !!r.hasAvatar,
            createdAt: toIso(r.createdAt),
            disabled: !!r.disabled,
            isAdmin: !!r.isAdmin,
            mfaEnabled: !!r.mfaEnabled,
            googleLinked: !!r.googleLinked,
            lastLoginAt: toIso(r.lastLoginAt),
            storageBytes: num(r.storageBytes),
            sessions: sessions[r.id] ?? 0,
            quotaMb: quotas.get(r.id)?.effectiveMb ?? null,
            quotaSource: quotas.get(r.id)?.source ?? 'none',
        })),
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Detalle
// ---------------------------------------------------------------------------------------------------------------------

export interface UserBasic {
    id: string;
    name: string | null;
    email: string;
    avatar: boolean;
    createdAt: string | null;
}

export async function getUserBasic(id: string): Promise<UserBasic | null> {
    const rows = await query<{ id: string; name: string | null; email: string; hasAvatar: boolean; createdAt: Date | null }>(
        `SELECT "id", "name", "email", ("avatar" IS NOT NULL AND "avatar" <> '') AS "hasAvatar", "createdAt" FROM "User" WHERE "id" = $1`,
        id,
    );
    const r = rows[0];
    return r ? { id: r.id, name: r.name, email: r.email, avatar: !!r.hasAvatar, createdAt: toIso(r.createdAt) } : null;
}

export async function existingUserIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await query<{ id: string }>(`SELECT "id" FROM "User" WHERE "id" = ANY($1::text[])`, ids);
    return new Set(rows.map((r) => r.id));
}

export async function userEmailTaken(email: string): Promise<boolean> {
    const rows = await query<{ id: string }>(`SELECT "id" FROM "User" WHERE lower("email") = lower($1) LIMIT 1`, email);
    return rows.length > 0;
}

export interface LinkedAccountSummary {
    id: string;
    provider: string;
    scopes: string[];
    expiresAt: string | null;
    hasRefreshToken: boolean;
}

/** Cuentas vinculadas de un usuario SIN tokens (solo booleanos y fechas; no se usa el modelo de Prisma que descifraria). */
export async function listUserAccounts(userId: string): Promise<LinkedAccountSummary[]> {
    const rows = await tolerant(
        () =>
            query<{ id: string; provider: string; scope: string | null; expiresAt: number | null; hasRefresh: boolean }>(
                `SELECT "id", "provider", "scope", "expires_at" AS "expiresAt",
                        ("refresh_token" IS NOT NULL AND "refresh_token" <> '') AS "hasRefresh"
                 FROM "Account" WHERE "userId" = $1 ORDER BY "provider", "id"`,
                userId,
            ),
        [],
    );
    return rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        scopes: splitScopes(r.scope),
        expiresAt: r.expiresAt ? new Date(Number(r.expiresAt) * 1000).toISOString() : null,
        hasRefreshToken: !!r.hasRefresh,
    }));
}

export function splitScopes(scope: string | null | undefined): string[] {
    return String(scope ?? '').split(/[\s,]+/).filter(Boolean).slice(0, 50);
}

export interface StorageSummary {
    attachmentBytes: number;
    attachmentCount: number;
    emailCount: number;
    folders: { folder: string; count: number }[];
}

/** Solo CONTEOS y bytes: nunca asuntos, cuerpos ni nombres de adjuntos. */
export async function getUserStorage(userId: string): Promise<StorageSummary> {
    const att = await tolerant(
        () =>
            query<{ bytes: bigint | number | null; n: bigint | number }>(
                `SELECT COALESCE(SUM(at."size"), 0) AS bytes, COUNT(*) AS n FROM "Attachment" at JOIN "Email" e ON e."id" = at."emailId" WHERE e."userId" = $1`,
                userId,
            ),
        [],
    );
    const folders = await tolerant(
        () => query<{ folder: string; n: bigint | number }>(`SELECT "folder", COUNT(*) AS n FROM "Email" WHERE "userId" = $1 GROUP BY "folder" ORDER BY COUNT(*) DESC LIMIT 50`, userId),
        [],
    );
    const list = folders.map((f) => ({ folder: String(f.folder), count: num(f.n) }));
    return {
        attachmentBytes: num(att[0]?.bytes),
        attachmentCount: num(att[0]?.n),
        emailCount: list.reduce((s, f) => s + f.count, 0),
        folders: list,
    };
}
